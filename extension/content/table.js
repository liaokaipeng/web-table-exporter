/**
 * 表格提取：行获取（表头兜底 + 占位/隐藏行过滤 + 分体表格合并 + div 网格表格）、
 * 合并单元格展开、Sheet 命名
 * 依赖：cell（openBatch 批量四通道取值）
 */
(() => {
  'use strict';
  const ns = window.__h2x;

  /* ---------- 组件库分体表格：表头/表体被渲染成两个独立 <table>（如 Element Plus el-table） ---------- */

  /** thead 行数（兼容 thead 直接嵌 th 无 tr 的写法） */
  function headerRowCount(t) {
    if (!t.tHead) return 0;
    let n = 0;
    for (const tr of t.tHead.querySelectorAll('tr')) if (tr.cells.length) n++;
    if (!n) for (const el of t.tHead.children) if (el.tagName === 'TH' || el.tagName === 'TD') n++;
    return n;
  }

  /** tbody 行数（数据行） */
  function bodyRowCount(t) {
    let n = 0;
    for (const tb of t.tBodies) for (const tr of tb.rows) if (tr.cells.length) n++;
    return n;
  }

  /** 容器内顶层 table 列表（排除嵌套在容器内其它 table 里的、以及隐藏的） */
  function topLevelTables(el) {
    return [...el.querySelectorAll('table')].filter(t => {
      if (getComputedStyle(t).display === 'none') return false;
      const outer = t.parentElement.closest('table');
      return !outer || !el.contains(outer);
    });
  }

  /** 视觉矩形：数据表被垂直滚动容器裁剪时（滚动会移动 table 本身），top 取容器顶边；
   *  left/width 仍取 table 本身——水平滚动时组件库同步平移表头/表体（天然对齐），
   *  而容器宽度被水平裁剪（scrollable-x 时表宽 > 容器宽），不能用于宽度比较 */
  function visualRect(t, root) {
    const r = t.getBoundingClientRect();
    let el = t;
    while (el && el !== root) {
      const s = getComputedStyle(el);
      if ((s.overflowY === 'auto' || s.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 4) {
        const top = Math.max(el.getBoundingClientRect().top, r.top);
        return { top: top, bottom: top + r.height, left: r.left, width: r.width };
      }
      el = el.parentElement;
    }
    return r;
  }

  function maxCols(t) {
    let n = 0;
    for (const tr of t.rows) n = Math.max(n, tr.cells.length);
    return n;
  }

  /** 配对判定纯函数：h/b 为描述符 { headerRows, bodyRows, cols, top, bottom, left, width }。
   *  纯表头表与纯数据表纵向拼接：间隙小（-10~10px，容忍轻微重叠）、左对齐、宽度相近；
   *  列数差 ≤1 容忍表头为滚动条多出的 gutter 占位列 */
  function isStackedPair(h, b) {
    const gap = b.top - h.bottom;
    if (gap < -10 || gap > 10) return false;
    if (Math.abs(h.left - b.left) > 8) return false;
    if (Math.abs(h.width - b.width) > 24) return false;
    return Math.abs(h.cols - b.cols) <= 1;
  }

  /** 分体配对纯函数（不碰 DOM，algo-check.cjs 离线回归）：descs 为容器内全部
   *  顶层 table 的描述符（结构 headerRows/bodyRows/cols + 视觉矩形），
   *  返回 { h, b }（纯表头表/纯数据表在 descs 中的下标）或 null。
   *  完整表格（自带表头+数据）两侧都不参与——普通页零回归的保障 */
  function pairSplitGroup(descs) {
    for (let i = 0; i < descs.length; i++) {
      const h = descs[i];
      if (!(h.headerRows > 0 && h.bodyRows === 0)) continue; // 纯表头表
      for (let j = 0; j < descs.length; j++) {
        const b = descs[j];
        if (!(b.headerRows === 0 && b.bodyRows > 0)) continue; // 纯数据表
        if (isStackedPair(h, b)) return { h: i, b: j };
      }
    }
    return null;
  }

  /** 容器内寻找分体配对：DOM table → 描述符（结构 + visualRect 视觉矩形）
   *  → 纯函数 pairSplitGroup 配对。首个纯表头表 + 与之纵向拼接的首个纯数据表 */
  function matchSplitGroup(root, tables) {
    const descs = tables.map(t => {
      const r = visualRect(t, root);
      return {
        headerRows: headerRowCount(t), bodyRows: bodyRowCount(t), cols: maxCols(t),
        top: r.top, bottom: r.bottom, left: r.left, width: r.width
      };
    });
    const idx = pairSplitGroup(descs);
    return idx ? { headerTable: tables[idx.h], bodyTable: tables[idx.b] } : null;
  }

  /**
   * 解析分体表格。el 可为分体中的成员 table（悬浮/点击命中）或包装容器（选中态的键），
   * 返回 { root, headerTable, bodyTable }；非分体返回 null。
   * 成员 table 侧自最紧祖先向上找、首个命中即返回，避免误并远祖容器中的多个独立表格；
   * 完整表格（自带表头+数据）不参与合并，保证普通页零回归；
   * div 网格表格（el-table-v2）不参与分体配对（无 table 结构，gridRowsOf 自行取行）
   */
  function splitGroupOf(el) {
    if (isGridTable(el)) return null;
    if (el.tagName === 'TABLE') {
      const h = headerRowCount(el), b = bodyRowCount(el);
      if ((h > 0 && b > 0) || (h === 0 && b === 0)) return null; // 完整表 / 空表：只有片段才找配对
      let depth = 0;
      for (let a = el.parentElement; a && a !== document.body && depth < 12; a = a.parentElement, depth++) {
        const tops = topLevelTables(a);
        if (tops.length > 8) return null; // 页面级容器：真分体的包装容器很紧，不会隔这么多表
        if (tops.length < 2) continue;
        const g = matchSplitGroup(a, tops);
        if (g && (g.headerTable === el || g.bodyTable === el)) return { root: a, headerTable: g.headerTable, bodyTable: g.bodyTable };
      }
      return null;
    }
    // 包装容器（选中态键）：容器内直接配对
    const tops = topLevelTables(el);
    if (tops.length < 2 || tops.length > 8) return null;
    const g = matchSplitGroup(el, tops);
    return g ? { root: el, headerTable: g.headerTable, bodyTable: g.bodyTable } : null;
  }

  /* ---------- div 网格表格：Element Plus el-table-v2 虚拟化表格 ----------
   * 无 <table> 元素，div + ARIA role 模拟表格结构，恒为虚拟滚动（只渲染可见窗口行）。
   * 组件结构（源码 table-v2.tsx / table-grid.tsx / virtual-list）：
   *   div.el-table-v2__root                      组件根（同元素带 .el-table-v2 类）
   *   ├ div.el-table-v2__table.el-table-v2__main 主网格（固定列时另有 __left/__right 各渲染一份）
   *   │ ├ div.el-vl__wrapper.el-table-v2__body   Grid 根（class 透传合并）
   *   │ │ └ div(滚动 window, 无类名)             overflow:hidden 但编程式 scrollTop 有效，
   *   │ │   └ div(总高撑开层)                        组件监听 scroll 重渲染窗口行
   *   │ │     └ div.el-table-v2__row[role=row]   数据行（绝对定位 top=行号*行高）
   *   │ │       └ div.el-table-v2__row-cell[role=cell]
   *   │ └ div.el-table-v2__header-wrapper        固定表头
   *   │   └ div.el-table-v2__header
   *   │     └ div.el-table-v2__dynamic-header-row[role=row]
   *   │       └ div.el-table-v2__header-cell[role=columnheader]
   * 固定列时 left/main/right 三份网格渲染同一份数据的不同列，行按视觉列序（left→main→right）拼接 */

  /** div 网格表格判定：组件根元素特征类 */
  function isGridTable(el) {
    return !!(el && el.tagName === 'DIV' && el.classList.contains('el-table-v2__root'));
  }

  /** 参与取数的网格分区（视觉列序 left → main → right；无固定列时仅 main） */
  function gridPartsOf(root) {
    const parts = [];
    for (const n of ['left', 'main', 'right']) {
      const el = root.querySelector('.el-table-v2__table.el-table-v2__' + n);
      if (el) parts.push(el);
    }
    if (!parts.length && root.querySelector('.el-table-v2__row')) parts.push(root); // 兜底：类名微调时不丢数
    return parts;
  }

  /** 行内数据格：排除无宽度列的占位格（el-table-v2__row-cell--placeholder） */
  function gridRowCells(row) {
    return Array.from(row.querySelectorAll('.el-table-v2__row-cell'))
      .filter(c => !c.classList.contains('el-table-v2__row-cell--placeholder'));
  }

  /** 网格表头行：各分区 dynamic-header-row 的表头格按视觉列序拼接（多行表头逐行对齐；
   *  各分区表头行数一致——同列配置渲染，行号即 headerHeight 数组下标） */
  function gridHeaderRows(parts) {
    const byIndex = [];
    for (const p of parts) {
      p.querySelectorAll('.el-table-v2__dynamic-header-row').forEach((tr, r) => {
        const cells = Array.from(tr.querySelectorAll('.el-table-v2__header-cell'));
        if (!cells.length) return;
        if (!byIndex[r]) byIndex[r] = { el: tr, cells: [], isHeader: true };
        byIndex[r].cells.push(...cells);
      });
    }
    return byIndex.filter(Boolean);
  }

  /** 网格数据行：各分区 body 内 .el-table-v2__row 按 DOM 顺序 zip 拼接（分区渲染同一
   *  数据的窗口行，行区间一致）；固定行（fixedData，渲染于表头区）不在 body 范围，天然排除 */
  function gridBodyRows(parts) {
    const byPart = parts.map(p => Array.from(p.querySelectorAll('.el-table-v2__body .el-table-v2__row')));
    const n = byPart.reduce((m, rows) => Math.max(m, rows.length), 0);
    const rows = [];
    for (let i = 0; i < n; i++) {
      let el = null;
      const cells = [];
      for (const list of byPart) {
        const r = list[i];
        if (!r) continue;
        if (!el) el = r;
        cells.push(...gridRowCells(r));
      }
      if (el && cells.length) rows.push({ cells: cells, el: el, isHeader: false });
    }
    return rows;
  }

  /** div 网格表格行获取：表头行 + 数据行（getRows 分发入口，返回与 rowsOfTable 同构） */
  function gridRowsOf(root) {
    const parts = gridPartsOf(root);
    return gridHeaderRows(parts).concat(gridBodyRows(parts));
  }

  /** 网格滚动 window 列表：各分区 .el-table-v2__body（el-vl__wrapper）内首个子 div。
   *  固定列时返回多分区（采集滚动须联动，否则 left/right 渲染窗口与 main 错位） */
  function gridScrollEls(root) {
    const els = [];
    for (const p of gridPartsOf(root)) {
      const w = p.querySelector('.el-table-v2__body');
      for (const child of (w ? w.children : [])) {
        if (child.tagName === 'DIV') { els.push(child); break; }
      }
    }
    return els;
  }

  /** 单个物理 table 的行收集：常规 thead>tr>th；部分组件库 thead 直接嵌 th（无 tr 包裹）；
   *  无 thead 的手写表格（内网页/生成报表常见 <tr><th>… 写法）tbody 行全 th 也计为
   *  表头行——中间出现的全 th 行无害（extractTable 只数前导连续段作 headerRows） */
  function rowsOfTable(table) {
    const rows = [];
    const push = (cells, el, isHeader) => {
      if (cells && cells.length) rows.push({ cells, el, isHeader: !!isHeader });
    };

    if (table.tHead) {
      const trs = table.tHead.querySelectorAll('tr');
      if (trs.length) {
        for (const tr of trs) push(tr.cells, tr, true);
      } else {
        push([...table.tHead.children].filter(el => el.tagName === 'TH' || el.tagName === 'TD'), table.tHead, true);
      }
    }
    const allTh = (tr) => tr.cells.length > 0 && Array.from(tr.cells).every(c => c.tagName === 'TH');
    for (const tb of table.tBodies) for (const tr of tb.rows) push(tr.cells, tr, allTh(tr));
    if (table.tFoot) for (const tr of table.tFoot.querySelectorAll('tr')) push(tr.cells, tr, true);
    return rows;
  }

  /** 分体组行合并：表头表行在前（滚动条 gutter 占位列剔除）、数据表行在后 */
  function rowsOfGroup(group) {
    return rowsOfTable(group.headerTable)
      .map(r => ({
        cells: [...r.cells].filter(c => !c.classList.contains('gutter')),
        el: r.el,
        isHeader: r.isHeader
      }))
      .concat(rowsOfTable(group.bodyTable));
  }

  /** 行获取：参数可为普通 table、分体包装容器（表头表行在前、数据表行在后合并取行）
   *  或 div 网格表格（el-table-v2：gridRowsOf 取行，固定列分区拼接）；
   *  过滤虚拟滚动占位空行与隐藏行。group 传入调用方已解析的分体组（虚拟采集逐窗
   *  复用，免重复配对计算），undefined 时自行解析。返回 [{ cells, el, isHeader }] */
  function getRows(el, group) {
    if (isGridTable(el)) return gridRowsOf(el);
    const g = group !== undefined ? group : splitGroupOf(el);
    const rows = g ? rowsOfGroup(g) : rowsOfTable(el);
    return rows.filter(({ cells, el }) => {
      if (!cells.length) return false; // 虚拟滚动占位空行（无内容）
      if (el.className && /virtual/.test(el.className)) return false; // 各类虚拟滚动占位行
      if (getComputedStyle(el).display === 'none') return false; // 隐藏行
      return true;
    });
  }

  /** 表格 → 四通道网格：rowspan/colspan 展开成网格 + 生成 SheetJS !merges。
   *  参数可为普通 table 或分体包装容器（经 getRows 合并取行）。
   *  取值走 cell.js 批量两阶段：先预备全部单元格（纯 DOM 写），再一次集中读取
   *  （合并延续格为 null），结尾按通道转置产出 */
  function extractTable(table) {
    const cellGrid = [];
    const merges = [];
    const rows = getRows(table);
    let headerRows = 0; // 前导表头行数（thead），列拆分用于表头命名与列名匹配
    while (headerRows < rows.length && rows[headerRows].isHeader) headerRows++;
    // 两阶段批量取值：整表克隆统一挂载、集中两轮读取，回流次数 O(格数) → 常数
    const batch = ns.cell.openBatch();
    const preparedRows = rows.map(({ cells }) => Array.from(cells, (cell) => batch.prepare(cell)));
    batch.resolve();
    const ensureRow = (r) => { if (!cellGrid[r]) cellGrid[r] = []; };
    rows.forEach(({ cells }, r) => {
      ensureRow(r);
      let c = 0;
      const prepared = preparedRows[r];
      for (let i = 0; i < cells.length; i++) {
        while (cellGrid[r][c] !== undefined) c++; // 跳过已被合并占据的槽位
        const rs = cells[i].rowSpan || 1;
        const cs = cells[i].colSpan || 1;
        cellGrid[r][c] = prepared[i];
        if (rs > 1 || cs > 1) {
          merges.push({ s: { r: r, c: c }, e: { r: r + rs - 1, c: c + cs - 1 } });
        }
        for (let dr = 0; dr < rs; dr++) {
          for (let dc = 0; dc < cs; dc++) {
            if (dr === 0 && dc === 0) continue;
            ensureRow(r + dr);
            cellGrid[r + dr][c + dc] = null; // 合并延续占位（导出为空单元格）
          }
        }
        c += cs;
      }
    });
    // 四通道转置：aoa/ctrl/text/blocks 同形状（无控件格 ctrl 为 null）
    const channel = (k) => cellGrid.map(row => row.map(v => (v == null ? null : v[k])));
    return { aoa: channel('merged'), merges, ctrl: channel('ctrl'), text: channel('text'), blocks: channel('blocks'), headerRows: headerRows };
  }

  /** Sheet 命名：caption / aria-label / id 依次兜底，31 字符截断去重 */
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

  ns.table = {
    getRows: getRows, extractTable: extractTable, makeSheetName: makeSheetName,
    splitGroupOf: splitGroupOf, pairSplitGroup: pairSplitGroup,
    isGridTable: isGridTable, gridScrollEls: gridScrollEls
  };
})();
