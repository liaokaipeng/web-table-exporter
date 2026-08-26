/**
 * HTML2XLSX 内容脚本（由 background 按需注入）
 * 依赖：lib/xlsx.full.min.js 先于本文件注入，共享 isolated world 的全局 XLSX
 * 功能：悬浮高亮表格 → 点击多选 → 导出 xlsx（合并单元格 / 多 Sheet / 自定义文件名）
 * v1.1：
 *  - 虚拟滚动表格：点击后自动滚动采集全部行（此类表格 DOM 中只有可见窗口的行）
 *  - 单元格内 input/textarea/select 的值一并导出
 *  - 兼容 thead 直接嵌 th（无 tr 包裹）的组件表格；过滤虚拟占位空行/隐藏行
 *  - 单元格文本归一化：视觉上分离的文本块（换行/连续空格）统一为单个空格，
 *    本来连在一起的文本不加空格
 * v1.1.1（通用化）：
 *  - 采集改用「相邻窗口重叠合并」替代全局内容去重：保留数据中合法的重复行
 *  - 虚拟表格识别放宽为类名含 virtual / 带高度空占位行；识别误报时采集流程无损
 *  - 多行表头完整保留；渲染慢的组件自动补等重试
 * v1.2（控件值全覆盖）：
 *  - 单元格控件取值改为三层判定：原生表单 → ARIA 角色 → 组件库类名，见 controlValue()
 *  - select 导出「显示文本(value)」，多选用顿号分隔；input[type=hidden] 忽略
 *  - 开关/勾选类（含 ARIA switch、el/ant/van 组件开关）统一「是/否」
 * v1.3（列拆分）：
 *  - cellParts() 四通道取值：merged（默认导出，行为不变）/ ctrl（控件值）/ text（页面文本）
 *    / blocks（视觉文本块，按换行切分）
 *  - 「拆分列」面板：control（控件值+文本）/ block（按换行拆，如「标题/产品ID」双行格）
 *    / delimiter（分隔符）三种模式，原列保留、新列追加其后；智能预填 + 前 3 行实时预览；
 *    规则存内存 Map，不碰 chrome.storage
 *  - 含合并单元格的表格禁用拆分（面板标注 + 导出二次防御）
 */
(() => {
  'use strict';

  // 重复注入守卫：再次点击扩展图标 = 退出选择模式
  if (window.__html2xlsx) { window.__html2xlsx.toggle(); return; }

  let active = true;
  let host = null;
  let hoverBox = null, countEl = null, nameInput = null, exportBtn = null, cancelBtn = null, hintEl = null, splitBtn = null;
  let hoverTable = null;
  let rafId = 0;
  let collecting = false; // 虚拟表格滚动采集中
  let genToken = 0;       // 代际令牌：退出/重新采集时使旧采集任务失效

  const selected = new Map();   // table -> 覆盖层元素（Map 保持选择顺序 = Sheet 顺序）
  const snapshots = new Map();   // table -> 虚拟滚动表格采集快照 { rows, ctrl, text, headerRows }
  const splitRules = new Map();  // table -> 列拆分规则 [{ col, mode, pattern, limit }]（内存态，不持久化）

  /* ---------------- 工具函数 ---------------- */

  const pad = (n) => String(n).padStart(2, '0');

  function timestamp() {
    const d = new Date();
    return (
      d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' +
      pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds())
    );
  }

  function sanitizeFilename(s) {
    return (s || '').replace(/[\\/:*?"<>|]/g, '_').trim();
  }

  /* ---------------- 控件值提取（A 原生 → B ARIA → C 组件类名） ---------------- */

  // 控件候选选择器：原生表单 + ARIA 控件角色 + 类名含 switch 的元素。
  // 候选统一送 controlValue() 精确判定，误匹配返回 null 保留原样（由 innerText 兜底）
  const CONTROL_SEL = 'input,textarea,select,output,[role=switch],[role=checkbox],[role=radio],' +
    '[role=slider],[role=spinbutton],[role=combobox],[role=listbox],[class*="switch"]';

  /** 原生 option 的统一格式：文本(value)；value 为空或与文本相同则只留文本 */
  function optionText(opt) {
    const text = (opt.textContent || '').trim();
    const value = (opt.value || '').trim();
    return (!value || text === value) ? text : (text + '(' + value + ')');
  }

  /** 控件取值（从页面原元素读取实时状态）。返回替换文本；
   *  返回 null 表示该元素不按控件处理，保留原样由 innerText 兜底 */
  function controlValue(el) {
    const tag = el.tagName;
    // A 原生表单
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'OUTPUT') {
      if (el.type === 'hidden') return ''; // 用户不可见，忽略
      if (el.type === 'checkbox' || el.type === 'radio') return el.checked ? '是' : '否';
      return el.value || '';
    }
    if (tag === 'SELECT') {
      const opts = [...el.selectedOptions];
      return opts.length ? opts.map(optionText).join('、') : ''; // 多选用顿号分隔
    }
    // B ARIA 控件角色
    const role = el.getAttribute('role');
    if (role === 'switch' || role === 'checkbox' || role === 'radio') {
      return el.getAttribute('aria-checked') === 'true' ? '是' : '否';
    }
    if (role === 'slider' || role === 'spinbutton') {
      return el.getAttribute('aria-valuenow') || '';
    }
    if (role === 'combobox' || role === 'listbox') {
      // 选项列表渲染在单元格内时取选中项；触发器场景无选中项则交由 innerText 兜底
      const sel = el.querySelectorAll('[aria-selected="true"]');
      if (!sel.length) return null;
      return [...sel].map(o => (o.textContent || '').trim()).filter(Boolean).join('、') || null;
    }
    // C 组件库类名兜底：el-switch / ant-switch / van-switch / n-switch 等开关
    if (typeof el.className === 'string') {
      const tokens = el.className.trim().split(/\s+/).filter(Boolean);
      if (tokens.some(t => t === 'switch' || t.endsWith('-switch'))) {
        const on = tokens.some(t =>
          (/checked/i.test(t) && !/unchecked/i.test(t)) || /--on$/i.test(t) || /--active$/i.test(t));
        return on ? '是' : '否';
      }
    }
    return null;
  }

  /* ---------------- 单元格文本（含表单控件值，三通道） ---------------- */

  // 归一化：视觉上分离的文本块（换行/连续空格/nbsp）压缩为单个空格；相连文本保持相连
  const normText = (s) => (s || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();

  /** 单元格四通道取值（v1.3 列拆分的数据基础）：
   *  - merged：控件替换为实时值后的完整文本（默认导出通道，行为与 v1.2 一致）
   *  - ctrl：控件实时值（多控件格过滤空值后按出现顺序顿号连接；无命中控件为 null）
   *  - text：移除命中控件后的页面文本（未命中候选的文本留在其中）
   *  - blocks：视觉文本块数组（块级元素边界即换行处切分，控件已替换为实时值）。
   *    如「标题/产品ID」列（两个 div 堆叠）→ [标题, 产品ID]；块内空格不拆
   *  实现沿用克隆骨架：一次克隆、一次离屏挂载、两轮 innerText（替换控件得 merged、
   *  移除注入的值节点得 text）；值直读原元素（cloneNode 只复制特性，JS 属性设值会丢）；
   *  离屏容器不加 visibility:hidden（innerText 按规范会排除不可见文本） */
  function cellParts(cell) {
    const origs = cell.querySelectorAll(CONTROL_SEL);
    if (!origs.length) {
      const text = normText(cell.innerText);
      return { merged: text, ctrl: null, text: text, blocks: splitBlocks(cell.innerText) };
    }
    const clone = cell.cloneNode(true);
    const clones = clone.querySelectorAll(CONTROL_SEL);
    // 命中控件：嵌套在已命中控件内的候选跳过（如 el-switch 内的 checkbox，避免重复计数）
    const hits = [];
    origs.forEach((orig, i) => {
      const v = controlValue(orig);
      if (v === null) return;
      if (hits.some(h => origs[h.i].contains(orig))) return;
      hits.push({ i: i, v: v });
    });
    // 第一轮：命中控件替换为其实时值（前后补空格作为与相邻文本的分隔，最终统一归一化）
    const marks = [];
    hits.forEach(h => {
      const node = document.createTextNode(' ' + h.v + ' ');
      clones[h.i].replaceWith(node);
      marks.push(node);
    });
    clone.querySelectorAll('img,video,svg,iframe').forEach(el => el.remove());
    const holder = document.createElement('div');
    holder.style.cssText = 'position:fixed;left:-99999px;top:0;';
    holder.appendChild(clone);
    document.body.appendChild(holder);
    const merged = normText(clone.innerText);
    const blocks = splitBlocks(clone.innerText); // 控件值替换后按视觉块切（控件值块保留其中）
    // 第二轮：移除注入的值节点，得纯页面文本
    let text = merged;
    if (marks.length) {
      marks.forEach(n => n.remove());
      text = normText(clone.innerText);
    }
    holder.remove();
    const vals = hits.map(h => h.v).filter(Boolean);
    return { merged: merged, ctrl: vals.length ? vals.join('、') : null, text: text, blocks: blocks };
  }

  /** 默认导出取完整文本（v1.2 行为，薄封装保回归） */
  function cellText(cell) {
    return cellParts(cell).merged;
  }

  /* ---------------- 行获取（表头兜底 + 占位/隐藏行过滤） ---------------- */

  function getRows(table) {
    const rows = [];
    const push = (cells, el, isHeader) => {
      if (cells && cells.length) rows.push({ cells, el, isHeader: !!isHeader });
    };

    // 表头：常规 thead>tr>th；部分组件库 thead 直接嵌 th（无 tr 包裹）
    if (table.tHead) {
      const trs = table.tHead.querySelectorAll('tr');
      if (trs.length) {
        for (const tr of trs) push(tr.cells, tr, true);
      } else {
        push([...table.tHead.children].filter(el => el.tagName === 'TH' || el.tagName === 'TD'), table.tHead, true);
      }
    }
    for (const tb of table.tBodies) for (const tr of tb.rows) push(tr.cells, tr);
    if (table.tFoot) for (const tr of table.tFoot.querySelectorAll('tr')) push(tr.cells, tr, true);

    return rows.filter(({ cells, el }) => {
      if (!cells.length) return false; // 虚拟滚动占位空行（无内容）
      if (el.className && /virtual/.test(el.className)) return false; // 各类虚拟滚动占位行
      if (getComputedStyle(el).display === 'none') return false; // 隐藏行
      return true;
    });
  }

  /* ---------------- 表格提取（合并单元格展开） ---------------- */

  function extractTable(table) {
    const grid = [];
    const merges = [];
    const ctrlGrid = [];   // ctrl 通道：与 aoa 同形状（无控件格为 null）
    const textGrid = [];   // text 通道：与 aoa 同形状
    const blocksGrid = []; // blocks 通道：视觉块数组，与 aoa 同形状
    const rows = getRows(table);
    let headerRows = 0; // 前导表头行数（thead），列拆分用于表头命名与列名匹配
    while (headerRows < rows.length && rows[headerRows].isHeader) headerRows++;
    rows.forEach(({ cells }, r) => {
      grid[r] = grid[r] || [];
      ctrlGrid[r] = ctrlGrid[r] || [];
      textGrid[r] = textGrid[r] || [];
      blocksGrid[r] = blocksGrid[r] || [];
      let c = 0;
      for (const cell of cells) {
        while (grid[r][c] !== undefined) c++; // 跳过已被合并占据的槽位
        const rs = cell.rowSpan || 1;
        const cs = cell.colSpan || 1;
        const parts = cellParts(cell);
        grid[r][c] = parts.merged;
        ctrlGrid[r][c] = parts.ctrl;
        textGrid[r][c] = parts.text;
        blocksGrid[r][c] = parts.blocks;
        if (rs > 1 || cs > 1) {
          merges.push({ s: { r: r, c: c }, e: { r: r + rs - 1, c: c + cs - 1 } });
        }
        for (let dr = 0; dr < rs; dr++) {
          for (let dc = 0; dc < cs; dc++) {
            if (dr === 0 && dc === 0) continue;
            grid[r + dr] = grid[r + dr] || [];
            ctrlGrid[r + dr] = ctrlGrid[r + dr] || [];
            textGrid[r + dr] = textGrid[r + dr] || [];
            blocksGrid[r + dr] = blocksGrid[r + dr] || [];
            grid[r + dr][c + dc] = null; // 合并延续占位（导出为空单元格）
            ctrlGrid[r + dr][c + dc] = null;
            textGrid[r + dr][c + dc] = null;
            blocksGrid[r + dr][c + dc] = null;
          }
        }
        c += cs;
      }
    });
    return { aoa: grid, merges, ctrl: ctrlGrid, text: textGrid, blocks: blocksGrid, headerRows: headerRows };
  }

  /* ---------------- 列拆分（纯函数，test/algo-check.cjs 按标记提取回归） ---------------- */
  // [h2x-split-begin]

  /** 分隔符拆值：各段去首尾空白；limit（≥2）生效时超限段连同分隔符并入末段 */
  function splitByDelimiter(value, pattern, limit) {
    const s = value == null ? '' : String(value);
    if (!pattern) return [s];
    let parts = s.split(pattern).map(p => p.trim());
    if (limit && limit >= 2 && parts.length > limit) {
      const head = parts.slice(0, limit - 1);
      head.push(parts.slice(limit - 1).join(pattern));
      parts = head;
    }
    return parts;
  }

  /** 视觉块切分（block 模式数据基础）：按换行（块级元素边界）切成文本块，
   *  各块内空白归一化、去首尾，过滤空块。如「标题\n产品ID」→ [标题, 产品ID]；
   *  空值 → []（拆分时与空单元格同语义，留一个空段） */
  function splitBlocks(s) {
    return String(s == null ? '' : s).split('\n')
      .map(p => p.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim())
      .filter(Boolean);
  }

  /** 块拆分段值：blocks 通道取值 + 段数上限（超限块以空格并入末块）；
   *  空值与 splitByDelimiter(null) 同语义返回 ['']（原值留首段） */
  function limitBlocks(blocks, limit) {
    const bl = (Array.isArray(blocks) ? blocks : []).filter(Boolean);
    if (!bl.length) return [''];
    if (limit && limit >= 2 && bl.length > limit) {
      const head = bl.slice(0, limit - 1);
      head.push(bl.slice(limit - 1).join(' '));
      return head;
    }
    return bl.slice();
  }

  /** 规则列定位：col 为表头文本（取首行表头首个命中）或列序号；未命中/越界返回 -1 */
  function resolveRuleCol(aoa, col, maxCols) {
    let idx = -1;
    if (typeof col === 'number') {
      idx = col;
    } else if (col !== null && col !== undefined && col !== '') {
      const header = aoa[0] || [];
      for (let i = 0; i < header.length; i++) {
        if ((header[i] == null ? '' : String(header[i])) === col) { idx = i; break; }
      }
    }
    return (idx >= 0 && idx < maxCols) ? idx : -1;
  }

  /** 列拆分主函数：把通道中命中的列拆为多列（原列保留，新列追加其后，错了可删）。
   *  ch：extractTable 结果 { aoa, merges, ctrl, text, blocks, headerRows }
   *      或虚拟快照 { rows, ctrl, text, blocks, headerRows }；rules：[{ col, mode, pattern, limit }]
   *  mode：control（控件值列+文本列）/ block（按换行视觉块拆）/ delimiter（按分隔符拆）
   *  返回新 aoa；未配规则 / 含合并单元格 / 规则全部解析不到时原样返回（零回归 + 二次防御） */
  function applyColumnSplits(ch, rules) {
    const src = ch.aoa || ch.rows;
    if (!rules || !rules.length) return src;
    if (ch.merges && ch.merges.length) return src; // 含合并单元格的表格禁用拆分
    const headerRows = ch.headerRows || 0;
    const ctrlCh = ch.ctrl || [];
    const textCh = ch.text || [];
    const blocksCh = ch.blocks || [];

    // 按最大列数补齐行（各通道同形状），便于按索引读写
    let maxCols = 0;
    for (const row of src) if (row) maxCols = Math.max(maxCols, row.length);
    const pad = (row) => {
      const r = Array.from(row || [], v => (v === undefined ? null : v));
      while (r.length < maxCols) r.push(null);
      return r;
    };
    const aoa = src.map(pad);
    const ctrl = ctrlCh.map(pad);
    const text = textCh.map(pad);
    const blocks = blocksCh.map(pad);

    // 规则解析到列索引（解析不到则静默跳过）；按原始索引从右到左应用，
    // 右侧先拆不影响左侧索引，逐条重排
    const resolved = [];
    for (const rule of rules) {
      const idx = resolveRuleCol(aoa, rule.col, maxCols);
      if (idx < 0) continue;
      resolved.push({ idx: idx, rule: rule });
    }
    if (!resolved.length) return src;
    resolved.sort((a, b) => b.idx - a.idx);

    // 新列名基准：首行表头文本（可为空）
    const baseName = (idx) => String((aoa[0] && aoa[0][idx]) || '').trim();

    for (const { idx, rule } of resolved) {
      if (rule.mode === 'control') {
        // control：控件值列 + 页面文本列；ctrl/text 通道按原始索引读取（不随插入重排）
        const base = baseName(idx) || ('列' + (idx + 1)); // 空表头名按列序号兜底
        for (let r = 0; r < aoa.length; r++) {
          let cells;
          if (r < headerRows) {
            // 多行表头只在首行写名，其余表头行留空
            cells = r === 0 ? [base + '_控件', base + '_文本'] : ['', ''];
          } else {
            const cv = ctrl[r] ? ctrl[r][idx] : null;
            const tv = text[r] ? text[r][idx] : null;
            cells = [cv == null ? '' : cv, tv == null ? '' : tv];
          }
          aoa[r].splice(idx + 1, 0, cells[0], cells[1]);
        }
      } else if (rule.mode === 'block') {
        // block：按视觉块（换行）拆，块内空格不拆。如「标题/产品ID」双行格 →
        // 标题列 + 产品ID 列。新列名与对齐逻辑同 delimiter（段数 = 数据行最大块数）
        const base = baseName(idx);
        let segCount = 1;
        for (let r = headerRows; r < aoa.length; r++) {
          const parts = limitBlocks(blocks[r] ? blocks[r][idx] : null, rule.limit);
          if (parts.length > segCount) segCount = parts.length;
        }
        for (let r = 0; r < aoa.length; r++) {
          let cells;
          if (r < headerRows) {
            cells = r === 0
              ? Array.from({ length: segCount }, (_, k) => base ? (base + (k + 1)) : String(k + 1))
              : Array.from({ length: segCount }, () => '');
          } else {
            const parts = limitBlocks(blocks[r] ? blocks[r][idx] : null, rule.limit);
            while (parts.length < segCount) parts.push('');
            cells = parts;
          }
          aoa[r].splice(idx + 1, 0, ...cells);
        }
      } else {
        // delimiter：新列名 = 原名+序号（空原名 → 裸序号）；
        // 新列数 = 数据行最大段数（≥1，各行对齐；无命中原值留首段）
        const base = baseName(idx);
        let segCount = 1;
        for (let r = headerRows; r < aoa.length; r++) {
          const parts = splitByDelimiter(aoa[r][idx], rule.pattern, rule.limit);
          if (parts.length > segCount) segCount = parts.length;
        }
        for (let r = 0; r < aoa.length; r++) {
          let cells;
          if (r < headerRows) {
            cells = r === 0
              ? Array.from({ length: segCount }, (_, k) => base ? (base + (k + 1)) : String(k + 1))
              : Array.from({ length: segCount }, () => '');
          } else {
            const parts = splitByDelimiter(aoa[r][idx], rule.pattern, rule.limit);
            while (parts.length < segCount) parts.push('');
            cells = parts;
          }
          aoa[r].splice(idx + 1, 0, ...cells);
        }
      }
    }
    return aoa;
  }
  // [h2x-split-end]

  /* ---------------- Sheet 命名 ---------------- */

  function makeSheetName(table, index, used) {
    const caption = table.querySelector('caption');
    const raw = (caption ? caption.innerText : '') ||
      table.getAttribute('aria-label') || table.id || '';
    let base = raw.replace(/[:\\/?*[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31);
    if (!base) base = '表格' + (index + 1);
    let name = base, n = 2;
    while (used.has(name)) name = base.slice(0, 28) + '(' + n++ + ')';
    used.add(name);
    return name;
  }

  /* ---------------- 虚拟滚动表格支持 ---------------- */

  function isVirtualTable(table) {
    // 显式虚拟滚动标记（占位行/占位元素类名，覆盖各类组件库）
    if (table.querySelector('[class*="virtual"]')) return true;
    // 兜底：tbody 里存在带高度的无单元格占位 tr
    for (const tb of table.tBodies) {
      for (const tr of tb.rows) {
        if (!tr.cells.length && tr.getBoundingClientRect().height > 0) return true;
      }
    }
    return false;
  }

  function findScrollContainer(table) {
    let el = table.parentElement;
    while (el && el !== document.body) {
      const s = getComputedStyle(el);
      if ((s.overflowY === 'auto' || s.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 4) return el;
      el = el.parentElement;
    }
    return null; // 无滚动容器则用窗口滚动
  }

  const settle = (ms) => new Promise(res => { requestAnimationFrame(() => setTimeout(res, ms)); });

  /** 已累积行（签名数组）的后缀与当前窗口前缀的最长公共长度，即两窗口的重叠行数。
   *  k 上限 cap 到一个视口的行数：滑动窗口的重叠不可能超过一屏，同时避免大表格 O(n²) 比较 */
  function overlapLen(acc, win) {
    const max = Math.min(acc.length, win.length, 200);
    for (let k = max; k >= 1; k--) {
      let ok = true;
      for (let i = 0; i < k; i++) {
        if (acc[acc.length - k + i] !== win[i]) { ok = false; break; }
      }
      if (ok) return k;
    }
    return 0;
  }

  /**
   * 自动滚动采集虚拟表格全部行：回顶 → 按视口 80% 步长逐步下滚 → 逐窗口提取。
   * 表头行剥离只保留一份；数据行用「相邻窗口重叠合并」（后缀/前缀匹配）衔接，
   * 既消除窗口重叠区的重复，也保留数据中合法的重复行。
   * 识别误报时（普通表格被当作虚拟表格）采集流程同样无损：每窗口都返回全量行，重叠合并后不变。
   */
  async function collectVirtual(table, onProgress, isCancelled) {
    const container = findScrollContainer(table);
    let headers = [];          // 表头行（值数组），首窗口确定，支持多行表头
    const headersCtrl = [];    // 表头行 ctrl 通道（与 headers 同索引）
    const headersText = [];    // 表头行 text 通道
    const headersBlocks = []; // 表头行 blocks 通道
    const dataSigs = [];       // 已累积数据行签名（重叠匹配用）
    const dataRows = [];       // 已累积数据行（值数组）
    const dataCtrl = [];       // 数据行 ctrl 通道（与 dataRows 同索引累积，重叠合并同步裁剪）
    const dataText = [];       // 数据行 text 通道
    const dataBlocks = [];     // 数据行 blocks 通道

    // 提取当前窗口：表头只记录一份；数据行与已累积部分做后缀/前缀重叠合并
    let prevRefs = null; // 上一窗口数据行的 DOM 元素引用（判定窗口是否真的变化）
    const takeWindow = () => {
      const firstWin = prevRefs === null; // 首窗口收集全部表头行，后续窗口跳过
      const winRows = [];
      const winCtrl = [];
      const winText = [];
      const winBlocks = [];
      const winRefs = [];
      for (const { cells, el, isHeader } of getRows(table)) {
        const vals = [], cv = [], tv = [], bk = [];
        for (const cell of cells) {
          const parts = cellParts(cell);
          vals.push(parts.merged);
          cv.push(parts.ctrl);
          tv.push(parts.text);
          bk.push(parts.blocks);
        }
        if (isHeader) {
          if (firstWin) { headers.push(vals); headersCtrl.push(cv); headersText.push(tv); headersBlocks.push(bk); }
          continue;
        }
        winRows.push(vals);
        winCtrl.push(cv);
        winText.push(tv);
        winBlocks.push(bk);
        winRefs.push(el);
      }
      // DOM 行元素与上一窗口完全相同（同一批节点）：
      // 非虚拟表格被误判时每窗口都是同一批行；虚拟表格渲染未完成时同理。均无新行。
      if (!firstWin && winRefs.length === prevRefs.length &&
          winRefs.every((el, i) => el === prevRefs[i])) {
        return 0;
      }
      prevRefs = winRefs;
      const winSigs = winRows.map(r => r.join('\x01'));
      const k = overlapLen(dataSigs, winSigs);
      for (let i = k; i < winRows.length; i++) {
        dataSigs.push(winSigs[i]);
        dataRows.push(winRows[i]);
        dataCtrl.push(winCtrl[i]);
        dataText.push(winText[i]);
        dataBlocks.push(winBlocks[i]);
      }
      return winRows.length - k; // 新增行数
    };

    const progress = () => onProgress(dataRows.length + headers.length);
    const getTop = () => (container ? container.scrollTop : window.scrollY);
    const setTop = (v) => { if (container) container.scrollTop = v; else window.scrollTo(0, v); };
    const getMax = () => container
      ? container.scrollHeight - container.clientHeight
      : document.documentElement.scrollHeight - window.innerHeight;

    const originTop = getTop();
    try {
      setTop(0); // 回顶，保证采集从第一行开始
      await settle(180);
      takeWindow();
      progress();

      const step = Math.max(240, (container ? container.clientHeight : window.innerHeight) * 0.8);
      let lastTop = -1;
      for (let i = 0; i < 10000; i++) {
        if (isCancelled()) return null;
        if (getTop() >= getMax() - 1) break; // 已到底
        setTop(Math.min(getTop() + step, getMax()));
        await settle(180); // 等组件重渲染窗口
        let added = takeWindow();
        if (added === 0) {
          // 渲染慢的组件：补等一次再采，仍无新行才视为稳定
          await settle(250);
          added = takeWindow();
        }
        progress();
        const nowTop = getTop();
        if (nowTop === lastTop && added === 0) break; // 滚动卡住且无新行，防死循环
        lastTop = nowTop;
      }
      takeWindow(); // 收尾补一次
      progress();
      // 快照升级为四通道 + 表头行数（列拆分数据流同普通表格）
      return {
        rows: [...headers, ...dataRows],
        ctrl: [...headersCtrl, ...dataCtrl],
        text: [...headersText, ...dataText],
        blocks: [...headersBlocks, ...dataBlocks],
        headerRows: headers.length
      };
    } finally {
      setTop(originTop); // 还原用户滚动位置
    }
  }

  /* ---------------- 列拆分面板 ---------------- */

  // 分隔符探测候选（优先级从高到低；空格最模糊放最后）
  const DELIM_CANDIDATES = ['、', ',', ':', ' '];
  const SPACE_MARK = '␣'; // 空格分隔符在输入框中的可见标记（空格本身不可见）

  let panelOpen = false;    // 拆分面板打开中（Esc 只关面板，主工具栏导出/取消禁用）
  let panelMask = null;
  let panelTable = null;    // 当前编辑的表格
  let panelSample = null;   // 当前表格取样通道 { aoa|rows, ctrl, text, headerRows, merges }
  let panelCols = null;     // 当前表格列信息 [{ name, hasCtrl }]
  let panelDrafts = null;   // Map: table -> { draft: [{checked,mode,pattern,limit}|null], cols }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, ch => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
    ));
  }

  // 段数上限解析：空/非法 → null（不限）；合法为 ≥2 的整数
  function parseLimit(s) {
    const n = parseInt(s, 10);
    return Number.isFinite(n) && n >= 2 ? n : null;
  }

  // 规则列标识：表头文本唯一且非空 → 文本；否则列序号（无表头/重名兜底）
  function colKeyFor(cols, c) {
    const name = cols[c].name;
    if (name && !cols.some((o, i) => i !== c && o.name === name)) return name;
    return c;
  }

  /** 分隔符探测：该列全部非空数据值都含候选符号才预填（保守，避免误拆） */
  function detectDelimiter(values) {
    const vals = values.filter(v => v != null && String(v).trim() !== '');
    if (vals.length < 2) return '';
    for (const d of DELIM_CANDIDATES) {
      if (vals.every(v => String(v).includes(d))) return d;
    }
    return '';
  }

  /** 列信息：表头名（多行表头取首行）、是否含控件、分隔符/多块探测结果 */
  function buildPanelCols(sample) {
    const aoa = sample.aoa || sample.rows;
    const headerRows = sample.headerRows || 0;
    let maxCols = 0;
    for (const row of aoa) if (row) maxCols = Math.max(maxCols, row.length);
    const cols = [];
    for (let c = 0; c < maxCols; c++) {
      const name = headerRows > 0 ? String((aoa[0] && aoa[0][c]) || '').trim() : '';
      let hasCtrl = false;
      const allVals = [];
      const blockCounts = []; // 各非空数据行的视觉块数
      for (let r = headerRows; r < aoa.length; r++) {
        const row = aoa[r] || [];
        allVals.push(row[c]);
        if (sample.ctrl && sample.ctrl[r] && sample.ctrl[r][c] != null) hasCtrl = true;
        const bl = sample.blocks && sample.blocks[r] ? sample.blocks[r][c] : null;
        if (bl && bl.length) blockCounts.push(bl.length);
      }
      // 多块列探测（保守，同分隔符探测）：非空数据行 ≥2 且全部 ≥2 块（如「标题/产品ID」双行格）
      const multiBlock = !hasCtrl && blockCounts.length >= 2 && blockCounts.every(n => n >= 2);
      cols.push({ name: name, hasCtrl: hasCtrl, delim: detectDelimiter(allVals), multiBlock: multiBlock });
    }
    return cols;
  }

  /** 智能预填：多块文本列默认勾选并预设 block（按换行拆）；含控件列预设 control
   *  但不勾选（由用户确认）；其余纯文本列探测分隔符预填（默认不勾选） */
  function prefillDrafts(cols) {
    return cols.map(col => {
      if (col.multiBlock) return { checked: true, mode: 'block', pattern: '', limit: '' };
      if (col.hasCtrl) return { checked: false, mode: 'control', pattern: col.delim, limit: '' };
      return { checked: false, mode: 'delimiter', pattern: col.delim, limit: '' };
    });
  }

  /** 已保存规则 → 面板草稿（未配置的列回落到智能预填） */
  function draftFromSaved(saved, cols) {
    const draft = prefillDrafts(cols);
    if (!saved) return draft;
    for (const rule of saved) {
      let c = -1;
      for (let i = 0; i < cols.length; i++) {
        if (colKeyFor(cols, i) === rule.col) { c = i; break; }
      }
      if (c < 0) continue;
      draft[c] = {
        checked: true, mode: rule.mode,
        pattern: rule.pattern || '', limit: rule.limit == null ? '' : String(rule.limit)
      };
    }
    return draft;
  }

  function sampleChannels(table) {
    if (snapshots.has(table)) return snapshots.get(table); // 虚拟表用已采集快照
    return extractTable(table); // 普通表现跑 extractTable 取样
  }

  function openSplitPanel() {
    if (panelOpen || collecting || !selected.size) return;
    panelOpen = true;
    panelDrafts = new Map();
    updateBar(); // 主工具栏导出/取消/拆分列同步禁用
    buildPanelDOM();
    switchPanelTable(selected.keys().next().value);
  }

  function buildPanelDOM() {
    panelMask = document.createElement('div');
    panelMask.className = 'h2x-mask';
    panelMask.innerHTML = [
      '<div class="h2x-panel">',
      '  <h3>拆分列</h3>',
      '  <div class="h2x-panel-head">表格：<select class="h2x-tsel"></select></div>',
      '  <div class="h2x-note" hidden></div>',
      '  <div class="h2x-cols"></div>',
      '  <div class="h2x-pv"><div class="h2x-pv-title">前 3 行拆分预览</div><div class="h2x-pv-body"></div></div>',
      '  <div class="h2x-panel-foot">',
      '    <span class="h2x-err"></span>',
      '    <button class="h2x-btn h2x-primary h2x-save">保存</button>',
      '    <button class="h2x-btn h2x-ghost h2x-pcancel">取消 (Esc)</button>',
      '  </div>',
      '</div>'
    ].join('');
    host.shadowRoot.appendChild(panelMask);
    panelMask.querySelector('.h2x-save').addEventListener('click', saveSplitPanel);
    panelMask.querySelector('.h2x-pcancel').addEventListener('click', closeSplitPanel);
    const tsel = panelMask.querySelector('.h2x-tsel');
    tsel.addEventListener('change', () => {
      const idx = parseInt(tsel.value, 10);
      const tables = [...selected.keys()];
      if (idx >= 0 && idx < tables.length) switchPanelTable(tables[idx]);
    });
    const colsBox = panelMask.querySelector('.h2x-cols');
    colsBox.addEventListener('change', onColChange);
    colsBox.addEventListener('input', onColInput);
  }

  function switchPanelTable(table) {
    if (!table || !selected.has(table)) return;
    panelTable = table;
    panelSample = sampleChannels(table);
    const entry = panelDrafts.get(table);
    if (entry) {
      panelCols = entry.cols; // 草稿的列索引基准
    } else {
      panelCols = buildPanelCols(panelSample);
      panelDrafts.set(table, { draft: draftFromSaved(splitRules.get(table), panelCols), cols: panelCols });
    }
    renderPanel();
  }

  function renderPanel() {
    const tsel = panelMask.querySelector('.h2x-tsel');
    const used = new Set();
    let html = '';
    let i = 0;
    for (const t of selected.keys()) {
      html += '<option value="' + i + '"' + (t === panelTable ? ' selected' : '') + '>' +
        (i + 1) + '. ' + escapeHtml(makeSheetName(t, i, used)) + '</option>';
      i++;
    }
    tsel.innerHTML = html;
    const hasMerges = !!(panelSample.merges && panelSample.merges.length);
    const note = panelMask.querySelector('.h2x-note');
    note.hidden = !hasMerges;
    if (hasMerges) note.textContent = '该表格含合并单元格，拆分不可用（导出保持原样）';
    renderColList(hasMerges);
    renderPreview();
  }

  function renderColList(hasMerges) {
    const draft = panelDrafts.get(panelTable).draft;
    let html = '<div class="h2x-col-head"><span class="h2x-h1"></span><span class="h2x-h2">列</span>' +
      '<span class="h2x-h4">模式</span><span class="h2x-h5">分隔符</span><span class="h2x-h6">段数上限</span></div>';
    panelCols.forEach((col, c) => {
      const d = draft[c];
      const name = col.name || ('列' + (c + 1));
      // 参数可用性：control 无分隔符/上限；block 无分隔符（上限可用）；delimiter 全可用
      const lockPattern = hasMerges || d.mode !== 'delimiter';
      const lockLimit = hasMerges || d.mode === 'control';
      html += '<div class="h2x-col' + (d.checked ? '' : ' off') + '" data-c="' + c + '">' +
        '<input type="checkbox" class="h2x-ck"' + (d.checked ? ' checked' : '') + (hasMerges ? ' disabled' : '') + '>' +
        '<span class="h2x-cname">' + escapeHtml(name) + (col.hasCtrl ? '<i class="h2x-tag">控件</i>' : '') + (col.multiBlock ? '<i class="h2x-tag">多行</i>' : '') + '</span>' +
        '<select class="h2x-mode"' + (hasMerges ? ' disabled' : '') + '>' +
        '<option value="control"' + (d.mode === 'control' ? ' selected' : '') + '>控件值拆分</option>' +
        '<option value="block"' + (d.mode === 'block' ? ' selected' : '') + '>按换行拆分</option>' +
        '<option value="delimiter"' + (d.mode === 'delimiter' ? ' selected' : '') + '>分隔符拆分</option>' +
        '</select>' +
        '<input type="text" class="h2x-pattern" placeholder="如 、 ' + SPACE_MARK + '=空格" value="' +
        escapeHtml(d.pattern === ' ' ? SPACE_MARK : d.pattern) + '"' + (lockPattern ? ' disabled' : '') + '>' +
        '<input type="text" class="h2x-limit" placeholder="不限" inputmode="numeric" value="' +
        escapeHtml(d.limit) + '"' + (lockLimit ? ' disabled' : '') + '>' +
        '</div>';
    });
    panelMask.querySelector('.h2x-cols').innerHTML = html;
  }

  function onColChange(e) {
    const row = e.target.closest('.h2x-col');
    if (!row || !panelOpen) return;
    const c = parseInt(row.dataset.c, 10);
    const d = panelDrafts.get(panelTable).draft[c];
    const hasMerges = !!(panelSample.merges && panelSample.merges.length);
    if (e.target.classList.contains('h2x-ck')) {
      d.checked = e.target.checked;
      row.classList.toggle('off', !d.checked);
    } else if (e.target.classList.contains('h2x-mode')) {
      d.mode = e.target.value;
    }
    row.querySelector('.h2x-pattern').disabled = hasMerges || d.mode !== 'delimiter';
    row.querySelector('.h2x-limit').disabled = hasMerges || d.mode === 'control';
    renderPreview();
  }

  function onColInput(e) {
    if (!(e.target instanceof HTMLInputElement) || !panelOpen) return;
    const row = e.target.closest('.h2x-col');
    if (!row) return;
    const c = parseInt(row.dataset.c, 10);
    const d = panelDrafts.get(panelTable).draft[c];
    if (e.target.classList.contains('h2x-pattern')) {
      d.pattern = e.target.value === SPACE_MARK ? ' ' : e.target.value;
    } else if (e.target.classList.contains('h2x-limit')) {
      d.limit = e.target.value.replace(/[^\d]/g, '');
    }
    renderPreview();
  }

  function renderPreview() {
    const body = panelMask.querySelector('.h2x-pv-body');
    const sample = panelSample;
    const aoa = sample.aoa || sample.rows;
    const headerRows = sample.headerRows || 0;
    if (sample.merges && sample.merges.length) {
      body.innerHTML = '<span style="color:#999">该表格含合并单元格，不可拆分</span>';
      return;
    }
    const draft = panelDrafts.get(panelTable).draft;
    const actives = [];
    draft.forEach((d, c) => { if (d && d.checked) actives.push({ c: c, d: d }); });
    if (!actives.length || aoa.length <= headerRows) {
      body.innerHTML = '<span style="color:#999">勾选列并选择模式后，此处显示前 3 行数据的拆分效果</span>';
      return;
    }
    const ctrl = sample.ctrl || [];
    const text = sample.text || [];
    const blocksCh = sample.blocks || [];
    // 各规则的新列数（与导出逻辑一致：取全部数据行的最大段数/块数）
    const counts = actives.map(({ c, d }) => {
      if (d.mode === 'control') return 2;
      let n = 1;
      for (let r = headerRows; r < aoa.length; r++) {
        const parts = d.mode === 'block'
          ? limitBlocks((blocksCh[r] || [])[c], parseLimit(d.limit))
          : splitByDelimiter((aoa[r] || [])[c], d.pattern, parseLimit(d.limit));
        if (parts.length > n) n = parts.length;
      }
      return n;
    });
    let html = '<table><tr>';
    actives.forEach(({ c, d }, k) => {
      const raw = (panelCols[c] && panelCols[c].name) || '';
      const name = raw || ('列' + (c + 1));
      html += '<th>原列 ' + escapeHtml(name) + '</th>';
      if (d.mode === 'control') {
        html += '<th class="new">' + escapeHtml(name) + '_控件</th><th class="new">' + escapeHtml(name) + '_文本</th>';
      } else {
        // 与导出命名一致：原名+序号（空原名 → 裸序号）
        for (let s = 0; s < counts[k]; s++) {
          html += '<th class="new">' + escapeHtml(raw ? (raw + (s + 1)) : String(s + 1)) + '</th>';
        }
      }
    });
    html += '</tr>';
    for (let r = headerRows; r < Math.min(aoa.length, headerRows + 3); r++) {
      html += '<tr>';
      actives.forEach(({ c, d }, k) => {
        const before = (aoa[r] || [])[c];
        html += '<td class="old">' + escapeHtml(before == null ? '' : String(before)) + '</td>';
        if (d.mode === 'control') {
          const cv = ctrl[r] ? ctrl[r][c] : null;
          const tv = text[r] ? text[r][c] : null;
          html += '<td>' + escapeHtml(cv == null ? '' : cv) + '</td><td>' + escapeHtml(tv == null ? '' : tv) + '</td>';
        } else if (d.mode === 'block') {
          const parts = limitBlocks((blocksCh[r] || [])[c], parseLimit(d.limit));
          while (parts.length < counts[k]) parts.push('');
          for (const p of parts) html += '<td>' + escapeHtml(p) + '</td>';
        } else {
          const parts = splitByDelimiter(before, d.pattern, parseLimit(d.limit));
          while (parts.length < counts[k]) parts.push('');
          for (const p of parts) html += '<td>' + escapeHtml(p) + '</td>';
        }
      });
      html += '</tr>';
    }
    html += '</table>';
    body.innerHTML = html;
  }

  function saveSplitPanel() {
    const errEl = panelMask.querySelector('.h2x-err');
    errEl.textContent = '';
    // 硬校验：分隔符非空；段数上限为空（不限）或 ≥2 的整数
    for (const { draft, cols } of panelDrafts.values()) {
      for (let c = 0; c < draft.length; c++) {
        const d = draft[c];
        if (!d || !d.checked) continue;
        const label = (cols[c] && cols[c].name) || ('列' + (c + 1));
        if (d.mode === 'delimiter' && !d.pattern) {
          errEl.textContent = '「' + label + '」的分隔符不能为空（' + SPACE_MARK + ' 表示空格）';
          return;
        }
        if (d.limit !== '' && parseLimit(d.limit) == null) {
          errEl.textContent = '「' + label + '」的段数上限须为空（不限）或不小于 2 的整数';
          return;
        }
      }
    }
    for (const [table, { draft, cols }] of panelDrafts) {
      const rules = [];
      draft.forEach((d, c) => {
        if (!d || !d.checked) return;
        rules.push({ col: colKeyFor(cols, c), mode: d.mode, pattern: d.pattern || '', limit: parseLimit(d.limit) });
      });
      if (rules.length) splitRules.set(table, rules);
      else splitRules.delete(table);
    }
    closeSplitPanel();
    hintEl.textContent = '拆分规则已保存，导出时生效';
    hintEl.style.color = '#2e7d32';
    setTimeout(() => { if (active && !panelOpen) resetHint(); }, 2500);
  }

  function closeSplitPanel() {
    if (!panelOpen) return;
    panelOpen = false;
    panelDrafts = null;
    panelTable = null;
    panelSample = null;
    panelCols = null;
    if (panelMask) { panelMask.remove(); panelMask = null; }
    updateBar(); // 恢复主工具栏按钮
  }

  /* ---------------- UI 构建（Shadow DOM 隔离页面样式） ---------------- */

  function buildUI() {
    host = document.createElement('div');
    host.style.cssText =
      'all:initial;display:block;position:absolute;top:0;left:0;width:0;height:0;' +
      'z-index:2147483647;pointer-events:none;';
    document.documentElement.appendChild(host);

    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = [
      '<style>',
      '  .h2x-hover{position:absolute;pointer-events:none;box-sizing:border-box;border:2px solid #1976d2;background:rgba(25,118,210,.14);border-radius:2px;}',
      '  .h2x-sel{position:absolute;pointer-events:none;box-sizing:border-box;border:2px solid #2e7d32;background:rgba(46,125,50,.10);border-radius:2px;}',
      '  .h2x-badge{position:absolute;top:-12px;left:-12px;min-width:22px;height:22px;padding:0 6px;box-sizing:border-box;border-radius:11px;background:#2e7d32;color:#fff;font:700 12px/22px -apple-system,"Segoe UI",sans-serif;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.35);}',
      '  .h2x-bar{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);pointer-events:auto;display:flex;align-items:center;gap:10px;padding:10px 14px;background:#fff;border-radius:10px;box-shadow:0 4px 20px rgba(0,0,0,.25);font:13px/1.4 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif;color:#333;white-space:nowrap;}',
      '  .h2x-hint{color:#666;}',
      '  .h2x-count b{color:#2e7d32;}',
      '  .h2x-name{width:240px;max-width:40vw;padding:6px 10px;border:1px solid #ccc;border-radius:6px;font:13px/1.2 -apple-system,"Segoe UI",sans-serif;color:#333;outline:none;}',
      '  .h2x-name:focus{border-color:#2e7d32;}',
      '  .h2x-btn{padding:6px 16px;border:none;border-radius:6px;cursor:pointer;font:13px/1.2 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif;}',
      '  .h2x-primary{background:#2e7d32;color:#fff;}',
      '  .h2x-primary:disabled{background:#b0bec5;cursor:not-allowed;}',
      '  .h2x-ghost{background:#f5f5f5;color:#666;}',
      '  .h2x-ghost:disabled{color:#bbb;cursor:not-allowed;}',
      '  .h2x-split{background:#fff;color:#2e7d32;border:1px solid #2e7d32;}',
      '  .h2x-split:disabled{background:#f5f5f5;color:#bbb;border-color:#ccc;cursor:not-allowed;}',
      '  .h2x-mask{position:fixed;inset:0;pointer-events:auto;background:rgba(0,0,0,.28);display:flex;align-items:center;justify-content:center;z-index:1;}',
      '  .h2x-panel{background:#fff;border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.3);width:min(780px,94vw);max-height:86vh;overflow:auto;padding:18px 20px;box-sizing:border-box;font:13px/1.5 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif;color:#333;}',
      '  .h2x-panel h3{margin:0 0 12px;font-size:15px;font-weight:600;}',
      '  .h2x-panel-head{display:flex;align-items:center;gap:8px;margin-bottom:10px;}',
      '  .h2x-panel-head select,.h2x-cols select,.h2x-cols input{padding:4px 8px;border:1px solid #ccc;border-radius:6px;font:12px/1.4 -apple-system,"Segoe UI",sans-serif;color:#333;box-sizing:border-box;background:#fff;}',
      '  .h2x-note{background:#fff8e1;color:#8d6e00;border-radius:6px;padding:6px 10px;margin-bottom:10px;}',
      '  .h2x-cols{border:1px solid #e0e0e0;border-radius:8px;margin-bottom:12px;max-height:34vh;overflow-y:auto;}',
      '  .h2x-col-head{display:flex;gap:8px;align-items:center;padding:7px 10px;background:#f5f7fa;color:#666;font-size:12px;border-bottom:1px solid #e0e0e0;position:sticky;top:0;}',
      '  .h2x-col{display:flex;gap:8px;align-items:center;padding:6px 10px;border-bottom:1px solid #f0f0f0;background:#fff;}',
      '  .h2x-col:last-child{border-bottom:none;}',
      '  .h2x-col.off .h2x-mode,.h2x-col.off .h2x-pattern,.h2x-col.off .h2x-limit{opacity:.45;pointer-events:none;}',
      '  .h2x-h1{width:16px;flex:none;}',
      '  .h2x-h2{flex:2;min-width:0;}',
      '  .h2x-h4{flex:1.4;min-width:0;}',
      '  .h2x-h5{flex:1.6;min-width:0;}',
      '  .h2x-h6{flex:0.9;min-width:0;}',
      '  .h2x-cname{flex:2;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;}',
      '  .h2x-tag{display:inline-block;background:#e3f2fd;color:#1565c0;border-radius:8px;padding:0 6px;font-size:11px;font-weight:400;font-style:normal;margin-left:4px;}',
      '  .h2x-mode{flex:1.4;min-width:0;}',
      '  .h2x-pattern{flex:1.6;min-width:0;}',
      '  .h2x-limit{flex:0.9;min-width:0;}',
      '  .h2x-pv{border:1px solid #e0e0e0;border-radius:8px;padding:10px;margin-bottom:12px;overflow:auto;}',
      '  .h2x-pv-title{font-size:12px;color:#666;margin-bottom:6px;}',
      '  .h2x-pv table{border-collapse:collapse;font-size:12px;}',
      '  .h2x-pv th,.h2x-pv td{border:1px solid #ddd;padding:4px 10px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '  .h2x-pv th{background:#f0f4f8;font-weight:600;}',
      '  .h2x-pv td.old{color:#999;background:#fafafa;}',
      '  .h2x-pv th.new{color:#2e7d32;}',
      '  .h2x-panel-foot{display:flex;align-items:center;gap:10px;}',
      '  .h2x-err{color:#c62828;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '</style>',
      '<div class="h2x-hover" hidden></div>',
      '<div class="h2x-bar">',
      '  <span class="h2x-hint">点击选择表格（可多选）</span>',
      '  <span class="h2x-count">已选 <b>0</b> 个</span>',
      '  <input class="h2x-name" type="text" spellcheck="false" />',
      '  <button class="h2x-btn h2x-split" disabled>拆分列</button>',
      '  <button class="h2x-btn h2x-primary" disabled>导出 Excel</button>',
      '  <button class="h2x-btn h2x-ghost">取消 (Esc)</button>',
      '</div>'
    ].join('');

    hoverBox = root.querySelector('.h2x-hover');
    countEl = root.querySelector('.h2x-count b');
    nameInput = root.querySelector('.h2x-name');
    exportBtn = root.querySelector('.h2x-primary');
    cancelBtn = root.querySelector('.h2x-ghost');
    hintEl = root.querySelector('.h2x-hint');
    splitBtn = root.querySelector('.h2x-split');
    exportBtn.addEventListener('click', doExport);
    cancelBtn.addEventListener('click', exit);
    splitBtn.addEventListener('click', openSplitPanel);

    nameInput.value = sanitizeFilename(document.title) + '_' + timestamp();
  }

  function resetHint() {
    hintEl.textContent = '点击选择表格（可多选）';
    hintEl.style.color = '#666';
  }

  /* ---------------- 事件处理 ---------------- */

  function onMouseOver(e) {
    if (!active || collecting || !(e.target instanceof Element)) return;
    const table = e.target.closest('table');
    if (table) { hoverTable = table; positionBox(hoverBox, table); }
    else { hoverTable = null; hoverBox.hidden = true; }
  }

  function onClickCapture(e) {
    if (!active) return;
    // 工具栏自身的点击不拦截（按钮/输入框正常工作）
    if (e.composedPath().includes(host)) return;
    e.preventDefault();
    e.stopPropagation();
    if (collecting) return; // 采集滚动中不响应表格点击
    if (e.target instanceof Element) {
      const table = e.target.closest('table');
      if (table) toggleSelect(table);
    }
  }

  function onKeyDown(e) {
    if (!active) return;
    if (panelOpen) {
      // 面板打开时：Esc 只关面板；Enter 保存（焦点在按钮/下拉上时走默认行为）
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeSplitPanel();
      } else if (e.key === 'Enter' && !e.isComposing) {
        const focused = host.shadowRoot && host.shadowRoot.activeElement;
        if (focused && (focused.tagName === 'BUTTON' || focused.tagName === 'SELECT')) return;
        e.preventDefault();
        e.stopPropagation();
        saveSplitPanel();
      }
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      exit();
    } else if (e.key === 'Enter' && !e.isComposing && !collecting) {
      // 焦点在工具栏按钮上时，Enter 走按钮默认行为（触发 click）
      const focused = host.shadowRoot && host.shadowRoot.activeElement;
      if (focused && focused.tagName === 'BUTTON') return;
      e.preventDefault();
      e.stopPropagation();
      doExport();
    }
  }

  function onReposition() {
    if (rafId || !active) return;
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      if (hoverTable && hoverTable.isConnected) positionBox(hoverBox, hoverTable);
      else { hoverTable = null; hoverBox.hidden = true; }
      for (const [table, box] of selected) {
        if (table.isConnected) positionBox(box, table);
        else removeSelected(table);
      }
    });
  }

  /* ---------------- 选中状态管理 ---------------- */

  function toggleSelect(table) {
    if (selected.has(table)) { removeSelected(table); return; }
    if (snapshots.has(table)) { addSelected(table); return; } // 已采集过：直接复用快照
    if (isVirtualTable(table)) { startCollect(table); return; } // 虚拟表格：滚动采集
    addSelected(table);
  }

  function addSelected(table) {
    const box = document.createElement('div');
    box.className = 'h2x-sel';
    const badge = document.createElement('span');
    badge.className = 'h2x-badge';
    box.appendChild(badge);
    host.shadowRoot.appendChild(box);
    selected.set(table, box);
    positionBox(box, table);
    updateBar();
  }

  function removeSelected(table) {
    const box = selected.get(table);
    if (box) box.remove();
    selected.delete(table);
    snapshots.delete(table); // 虚拟表快照随取消失效，重选时重新采集最新数据
    splitRules.delete(table); // 该表的拆分规则同步删除
    if (panelDrafts) panelDrafts.delete(table);
    if (panelOpen && table === panelTable) closeSplitPanel(); // 面板正在编辑该表：直接关闭
    updateBar();
  }

  async function startCollect(table) {
    if (collecting) return;
    collecting = true;
    const gen = ++genToken;
    hoverBox.hidden = true;
    exportBtn.disabled = true;
    splitBtn.disabled = true;
    cancelBtn.disabled = true;
    hintEl.style.color = '#1976d2';
    try {
      const snap = await collectVirtual(
        table,
        (n) => { hintEl.textContent = '虚拟表格采集滚动中… 已采集 ' + n + ' 行'; },
        () => !active || gen !== genToken
      );
      if (!active || gen !== genToken) return; // 已退出/已作废
      snapshots.set(table, snap);
      addSelected(table);
      hintEl.textContent = '采集完成，共 ' + snap.rows.length + ' 行（含表头）';
      hintEl.style.color = '#2e7d32';
      setTimeout(() => { if (active && !collecting) resetHint(); }, 2500);
    } catch (err) {
      console.error('[HTML2XLSX] 虚拟表格采集失败：', err);
      hintEl.textContent = '采集失败：' + (err && err.message ? err.message : err);
      hintEl.style.color = '#c62828';
    } finally {
      collecting = false;
      cancelBtn.disabled = false;
      updateBar();
    }
  }

  function updateBar() {
    // 徽标重新编号（与 Sheet 顺序一致）
    let i = 0;
    for (const box of selected.values()) {
      box.firstChild.textContent = String(++i);
    }
    countEl.textContent = String(selected.size);
    const busy = collecting || panelOpen; // 面板打开时主工具栏同步禁用
    exportBtn.disabled = busy || selected.size === 0;
    splitBtn.disabled = busy || selected.size === 0;
  }

  function positionBox(box, table) {
    const r = table.getBoundingClientRect();
    box.style.left = (r.left + window.scrollX) + 'px';
    box.style.top = (r.top + window.scrollY) + 'px';
    box.style.width = r.width + 'px';
    box.style.height = r.height + 'px';
    box.hidden = false;
  }

  /* ---------------- 导出 ---------------- */

  function arrayBufferToBase64(buf) {
    const bytes = new Uint8Array(buf);
    let binary = '';
    const CHUNK = 0x8000; // 分块避免 String.fromCharCode.apply 栈溢出
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(binary);
  }

  function downloadViaBlob(buf, name) {
    const blob = new Blob([buf], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  function showError(msg) {
    hintEl.textContent = msg;
    hintEl.style.color = '#c62828';
  }

  function finish() {
    hintEl.textContent = '已开始下载…';
    hintEl.style.color = '#2e7d32';
    setTimeout(exit, 600);
  }

  function doExport() {
    if (collecting || !selected.size) return;
    let buf, name;
    try {
      if (typeof XLSX === 'undefined') throw new Error('XLSX 库未加载');
      const used = new Set();
      const wb = XLSX.utils.book_new();
      let i = 0;
      for (const table of selected.keys()) {
        let ws;
        if (snapshots.has(table)) {
          // 虚拟滚动表格：使用采集到的全量快照（列拆分规则一并应用）
          ws = XLSX.utils.aoa_to_sheet(applyColumnSplits(snapshots.get(table), splitRules.get(table)));
        } else {
          const ex = extractTable(table);
          ws = XLSX.utils.aoa_to_sheet(applyColumnSplits(ex, splitRules.get(table)));
          if (ex.merges.length) ws['!merges'] = ex.merges;
        }
        XLSX.utils.book_append_sheet(wb, ws, makeSheetName(table, i++, used));
      }
      buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });

      name = sanitizeFilename(nameInput.value) || ('export_' + timestamp());
      if (!/\.xlsx$/i.test(name)) name += '.xlsx';
      name = name.replace(/^\.+/, ''); // chrome.downloads 不允许以点开头
    } catch (err) {
      console.error('[HTML2XLSX] 生成 xlsx 失败：', err);
      showError('导出失败：' + (err && err.message ? err.message : err));
      return;
    }

    // 首选经后台 chrome.downloads 下载（不受页面 CSP 限制）；失败回退页面内 blob 下载
    try {
      chrome.runtime.sendMessage(
        { type: 'html2xlsx-download', data: arrayBufferToBase64(buf), filename: name },
        (resp) => {
          const err = chrome.runtime.lastError;
          if (!err && resp && resp.ok) { finish(); return; }
          console.error('[HTML2XLSX] 后台下载失败，回退 blob 下载：', err, resp);
          downloadViaBlob(buf, name);
          finish();
        }
      );
    } catch (err) {
      // 扩展上下文失效（如开发中重新加载了扩展）时 sendMessage 会同步抛错
      console.error('[HTML2XLSX] sendMessage 失败，回退 blob 下载：', err);
      downloadViaBlob(buf, name);
      finish();
    }
  }

  /* ---------------- 退出与清理 ---------------- */

  function exit() {
    if (!active) return;
    active = false;
    genToken++; // 使进行中的采集任务失效
    document.removeEventListener('mouseover', onMouseOver, true);
    document.removeEventListener('click', onClickCapture, true);
    document.removeEventListener('keydown', onKeyDown, true);
    document.removeEventListener('scroll', onReposition, true);
    window.removeEventListener('resize', onReposition);
    if (rafId) cancelAnimationFrame(rafId);
    if (host) host.remove();
    selected.clear();
    snapshots.clear();
    splitRules.clear(); // 列拆分规则仅存内存（权限最小化，不碰 chrome.storage）
    panelOpen = false;
    panelDrafts = null;
    window.__html2xlsx = null;
  }

  window.__html2xlsx = { toggle: exit };

  /* ---------------- 启动 ---------------- */

  buildUI();
  document.addEventListener('mouseover', onMouseOver, true);
  document.addEventListener('click', onClickCapture, true);
  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('scroll', onReposition, true);
  window.addEventListener('resize', onReposition);
})();
