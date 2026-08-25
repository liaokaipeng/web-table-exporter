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
 */
(() => {
  'use strict';

  // 重复注入守卫：再次点击扩展图标 = 退出选择模式
  if (window.__html2xlsx) { window.__html2xlsx.toggle(); return; }

  let active = true;
  let host = null;
  let hoverBox = null, countEl = null, nameInput = null, exportBtn = null, cancelBtn = null, hintEl = null;
  let hoverTable = null;
  let rafId = 0;
  let collecting = false; // 虚拟表格滚动采集中
  let genToken = 0;       // 代际令牌：退出/重新采集时使旧采集任务失效

  const selected = new Map();   // table -> 覆盖层元素（Map 保持选择顺序 = Sheet 顺序）
  const snapshots = new Map();   // table -> 采集到的完整 aoa（虚拟滚动表格）

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

  /* ---------------- 单元格文本（含表单控件值） ---------------- */

  function cellText(cell) {
    const origs = cell.querySelectorAll('input,textarea,select');
    let target = cell, holder = null;
    if (origs.length) {
      // 含表单控件（如可编辑表格中的 input）：克隆单元格并把控件替换为其实时值，
      // 离屏渲染后取 innerText。注意：值必须从页面原元素读取——cloneNode 只复制 value 特性，
      // 用户输入/框架（Vue 等）通过 JS 属性设置的值不在特性里，克隆会丢失。
      const clone = cell.cloneNode(true);
      const clones = clone.querySelectorAll('input,textarea,select');
      origs.forEach((orig, i) => {
        let v;
        if (orig.tagName === 'SELECT') {
          const o = orig.selectedOptions && orig.selectedOptions[0];
          v = o ? o.textContent.trim() : '';
        } else if (orig.type === 'checkbox' || orig.type === 'radio') {
          v = orig.checked ? '是' : '否';
        } else {
          v = orig.value || '';
        }
        // 前后补空格作为与相邻文本的分隔（如 "2249" 与 "PHP"），最终统一归一化
        clones[i].replaceWith(document.createTextNode(' ' + v + ' '));
      });
      clone.querySelectorAll('img,video,svg,iframe').forEach(el => el.remove());
      // 离屏容器不能加 visibility:hidden（innerText 按规范会排除不可见文本），
      // 只需移出视口即可参与布局、正常产出 innerText
      holder = document.createElement('div');
      holder.style.cssText = 'position:fixed;left:-99999px;top:0;';
      holder.appendChild(clone);
      document.body.appendChild(holder);
      target = clone;
    }
    // 所有单元格统一归一化：视觉上分离的文本块（换行/连续空格/nbsp）压缩为单个空格；
    // 本来就连在一起的文本（无空白）保持相连不加空格
    const text = (target.innerText || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
    if (holder) holder.remove();
    return text;
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
    getRows(table).forEach(({ cells }, r) => {
      grid[r] = grid[r] || [];
      let c = 0;
      for (const cell of cells) {
        while (grid[r][c] !== undefined) c++; // 跳过已被合并占据的槽位
        const rs = cell.rowSpan || 1;
        const cs = cell.colSpan || 1;
        grid[r][c] = cellText(cell);
        if (rs > 1 || cs > 1) {
          merges.push({ s: { r: r, c: c }, e: { r: r + rs - 1, c: c + cs - 1 } });
        }
        for (let dr = 0; dr < rs; dr++) {
          for (let dc = 0; dc < cs; dc++) {
            if (dr === 0 && dc === 0) continue;
            grid[r + dr] = grid[r + dr] || [];
            grid[r + dr][c + dc] = null; // 合并延续占位（导出为空单元格）
          }
        }
        c += cs;
      }
    });
    return { aoa: grid, merges };
  }

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
    const dataSigs = [];       // 已累积数据行签名（重叠匹配用）
    const dataRows = [];       // 已累积数据行（值数组）

    // 提取当前窗口：表头只记录一份；数据行与已累积部分做后缀/前缀重叠合并
    let prevRefs = null; // 上一窗口数据行的 DOM 元素引用（判定窗口是否真的变化）
    const takeWindow = () => {
      const firstWin = prevRefs === null; // 首窗口收集全部表头行，后续窗口跳过
      const winRows = [];
      const winRefs = [];
      for (const { cells, el, isHeader } of getRows(table)) {
        const vals = [...cells].map(cellText);
        if (isHeader) { if (firstWin) headers.push(vals); continue; }
        winRows.push(vals);
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
      return [...headers, ...dataRows];
    } finally {
      setTop(originTop); // 还原用户滚动位置
    }
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
      '</style>',
      '<div class="h2x-hover" hidden></div>',
      '<div class="h2x-bar">',
      '  <span class="h2x-hint">点击选择表格（可多选）</span>',
      '  <span class="h2x-count">已选 <b>0</b> 个</span>',
      '  <input class="h2x-name" type="text" spellcheck="false" />',
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
    exportBtn.addEventListener('click', doExport);
    cancelBtn.addEventListener('click', exit);

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
    updateBar();
  }

  async function startCollect(table) {
    if (collecting) return;
    collecting = true;
    const gen = ++genToken;
    hoverBox.hidden = true;
    exportBtn.disabled = true;
    cancelBtn.disabled = true;
    hintEl.style.color = '#1976d2';
    try {
      const rows = await collectVirtual(
        table,
        (n) => { hintEl.textContent = '虚拟表格采集滚动中… 已采集 ' + n + ' 行'; },
        () => !active || gen !== genToken
      );
      if (!active || gen !== genToken) return; // 已退出/已作废
      snapshots.set(table, rows);
      addSelected(table);
      hintEl.textContent = '采集完成，共 ' + rows.length + ' 行（含表头）';
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
    exportBtn.disabled = selected.size === 0;
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
          // 虚拟滚动表格：使用采集到的全量快照
          ws = XLSX.utils.aoa_to_sheet(snapshots.get(table));
        } else {
          const { aoa, merges } = extractTable(table);
          ws = XLSX.utils.aoa_to_sheet(aoa);
          if (merges.length) ws['!merges'] = merges;
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
