/**
 * 表格提取：行获取（表头兜底 + 占位/隐藏行过滤 + 分体表格合并 + div 网格表格
 * 适配器注册表：el-table-v2 / AG Grid / MUI X DataGrid / Tabulator）、
 * 合并单元格展开、Sheet 命名
 * 依赖：cell（openBatch 批量四通道取值）
 */
(() => {
  'use strict';
  const ns = window.__h2x;

  // i18n 取词（各内容脚本同构，见 architecture.md「国际化」节）：优先经 ns.i18n
  // （i18n.js 手动中英文统一入口）；词条缺失或无 chrome.i18n 环境（algo-check.cjs
  // 伪 window）→ 回落代码内中文，Node 回归断言零改动。就地定义，不依赖其他模块
  // （本文件被 algo-check.cjs 整文件独立加载；局部变量不与 t 同名，消除遮蔽）
  const t = (key, fb, ...subs) => {
    if (ns.i18n) return ns.i18n.t(key, fb, subs); // v2.6.1 手动语言开关优先
    if (typeof chrome !== 'undefined' && chrome.i18n && chrome.i18n.getMessage) {
      const m = chrome.i18n.getMessage(key, subs.length ? subs.map(String) : undefined);
      if (m) return m;
    }
    return fb;
  };

  /* ---------- 组件库分体表格：表头/表体被渲染成两个独立 <table>（如 Element Plus el-table） ---------- */

  /** thead 行数（兼容 thead 直接嵌 th 无 tr 的写法） */
  function headerRowCount(tbl) {
    if (!tbl.tHead) return 0;
    let n = 0;
    for (const tr of tbl.tHead.querySelectorAll('tr')) if (tr.cells.length) n++;
    if (!n) for (const el of tbl.tHead.children) if (el.tagName === 'TH' || el.tagName === 'TD') n++;
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
    return [...el.querySelectorAll('table')].filter(tb => {
      if (getComputedStyle(tb).display === 'none') return false;
      const outer = tb.parentElement.closest('table');
      return !outer || !el.contains(outer);
    });
  }

  /** 视觉矩形：数据表被垂直滚动容器裁剪时（滚动会移动 table 本身），top 取容器顶边；
   *  left/width 仍取 table 本身——水平滚动时组件库同步平移表头/表体（天然对齐），
   *  而容器宽度被水平裁剪（scrollable-x 时表宽 > 容器宽），不能用于宽度比较 */
  function visualRect(tbl, root) {
    const r = tbl.getBoundingClientRect();
    let el = tbl;
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

  function maxCols(tbl) {
    let n = 0;
    for (const tr of tbl.rows) n = Math.max(n, tr.cells.length);
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
    const descs = tables.map(tb => {
      const r = visualRect(tb, root);
      return {
        headerRows: headerRowCount(tb), bodyRows: bodyRowCount(tb), cols: maxCols(tb),
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

  /* ---------- div 网格表格：适配器注册表（v2.2） ----------
 * 组件库虚拟化表格无 <table> 元素，div + ARIA role 模拟表格结构，恒为虚拟滚动
 * （只渲染可见窗口行）。每组件一个适配器（name/rootSel + 五钩子），新增组件只加
 * 适配器——virtual/main/persist 均经本模块分发入口间接调用，自身零改动：
 *   rootSel            命中入口（gridRootOf 的 closest 用）
 *   isRoot(el)         根特征类判定
 *   headerRowsOf(root)  表头行 [{ cells, el, isHeader: true }]
 *   bodyRowsOf(root)    数据行 [{ cells, el, isHeader: false }]
 *   scrollElsOf(root)   采集滚动容器（多分区须联动滚动则返回多个）
 *   headerCellsOf(root) 持久化指纹表头格（表头不随滚动渲染，指纹稳定） */

  /** 多分区表头行按行号对齐合并（el-table-v2 / AG Grid 共用）：containers 为各
   *  分区表头容器（视觉列序），同一行号的表头格顺次拼接；cellFilter 剔除嵌套格 */
  function mergeHeaderRows(containers, rowSel, cellSel, cellFilter) {
    const byIndex = [];
    for (const c of containers) {
      if (!c) continue;
      c.querySelectorAll(rowSel).forEach((tr, r) => {
        let cells = Array.from(tr.querySelectorAll(cellSel));
        if (cellFilter) cells = cells.filter(cellFilter);
        if (!cells.length) return;
        if (!byIndex[r]) byIndex[r] = { el: tr, cells: [], isHeader: true };
        byIndex[r].cells.push(...cells);
      });
    }
    return byIndex.filter(Boolean);
  }

  /** 行序排序纯函数（algo-check 离线回归）：全部行均带 aria-rowindex 时按数值升序
   *  （AG Grid / MUI X 复用行节点，DOM 顺序非视觉顺序），否则保持 DOM 序
   *  （el-table-v2 整窗重建、Tabulator 追加序即视觉序）。入参出参同构 */
  function rowsSortedByRowIndex(rows) {
    if (rows.length && rows.every(r => r.el && typeof r.el.getAttribute === 'function' &&
        r.el.getAttribute('aria-rowindex') != null)) {
      return rows.slice().sort((a, b) =>
        Number(a.el.getAttribute('aria-rowindex')) - Number(b.el.getAttribute('aria-rowindex')));
    }
    return rows;
  }

  /** 容器内行取数公共步（各适配器 bodyRowsOf 共用）：行选择器 + 格选择器 →
   *  [{ el, cells }]；空行过滤 / 行序排序 / 最终包装由调用方按组件语义组合 */
  function rowsWithCells(container, rowSel, cellSel) {
    return Array.from(container.querySelectorAll(rowSel))
      .map(r => ({ el: r, cells: Array.from(r.querySelectorAll(cellSel)) }));
  }

  /** 适配器根特征判定（isRoot）工厂：DIV + 特征类即命中；extra 为组件附加结构
   *  校验（可省，如 Tabulator 须含 tableHolder 防同页普通元素类名形似误报） */
  const divRootIs = (cls, extra) => (el) =>
    !!(el && el.tagName === 'DIV' && el.classList.contains(cls) && (!extra || extra(el)));

  /** 多分区数据行按下标 zip 拼接（各分区渲染同一数据的行区间，行数一致）：
   *  rowLists 为各分区已按视觉序排好的 [{ el, cells }] */
  function zipBodyRows(rowLists) {
    const n = rowLists.reduce((m, rows) => Math.max(m, rows.length), 0);
    const rows = [];
    for (let i = 0; i < n; i++) {
      let el = null;
      const cells = [];
      for (const list of rowLists) {
        const r = list[i];
        if (!r) continue;
        if (!el) el = r.el;
        cells.push(...r.cells);
      }
      if (el && cells.length) rows.push({ cells: cells, el: el, isHeader: false });
    }
    return rows;
  }

  /* 适配器一：Element Plus el-table-v2（v2.1 引入，行为不变）。
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
   * 固定列时 left/main/right 三份网格渲染同一份数据的不同列，行按视觉列序拼接 */

  /** el-table-v2 参与取数的网格分区（视觉列序 left → main → right；无固定列时仅 main） */
  function elv2PartsOf(root) {
    const parts = [];
    for (const n of ['left', 'main', 'right']) {
      const el = root.querySelector('.el-table-v2__table.el-table-v2__' + n);
      if (el) parts.push(el);
    }
    if (!parts.length && root.querySelector('.el-table-v2__row')) parts.push(root); // 兜底：类名微调时不丢数
    return parts;
  }

  /** el-table-v2 行内数据格：排除无宽度列的占位格（el-table-v2__row-cell--placeholder） */
  function elv2RowCells(row) {
    return Array.from(row.querySelectorAll('.el-table-v2__row-cell'))
      .filter(c => !c.classList.contains('el-table-v2__row-cell--placeholder'));
  }

  const GRID_ADAPTER_EL_V2 = {
    name: 'el-table-v2',
    rootSel: '.el-table-v2__root',
    isRoot: divRootIs('el-table-v2__root'),
    headerRowsOf: (root) => mergeHeaderRows(elv2PartsOf(root), '.el-table-v2__dynamic-header-row', '.el-table-v2__header-cell'),
    bodyRowsOf: (root) => zipBodyRows(elv2PartsOf(root).map(p =>
      Array.from(p.querySelectorAll('.el-table-v2__body .el-table-v2__row'))
        .map(r => ({ el: r, cells: elv2RowCells(r) })))), // 整窗重建：DOM 序即视觉序
    scrollElsOf: (root) => { // 各分区 .el-table-v2__body 内首个子 div；固定列须多分区联动
      const els = [];
      for (const p of elv2PartsOf(root)) {
        const w = p.querySelector('.el-table-v2__body');
        for (const child of (w ? w.children : [])) {
          if (child.tagName === 'DIV') { els.push(child); break; }
        }
      }
      return els;
    },
    headerCellsOf: (root) => root.querySelectorAll('.el-table-v2__dynamic-header-row .el-table-v2__header-cell')
  };

  /* 适配器二：AG Grid（v28+）。结构（ag- 前缀类名稳定）：
   *   div.ag-root-wrapper(.ag-theme-*)          组件根（主题类挂在根或外层）
   *   └ div.ag-root[role=grid]
   *     ├ div.ag-header                          固定表头
   *     │ ├ div.ag-pinned-left-header            固定列表头（有固定列时）
   *     │ │ └ div.ag-header-row[role=row] > div.ag-header-cell
   *     │ ├ div.ag-header-viewport > div.ag-header-container
   *     │ │   └ div.ag-header-row > div.ag-header-cell
   *     │ └ div.ag-pinned-right-header
   *     └ div.ag-body
   *       └ div.ag-body-viewport                 垂直滚动容器（固定列容器是其子级，天然联动）
   *         ├ div.ag-center-cols-viewport > div.ag-center-cols-container
   *         │   └ div.ag-row[role=row][aria-rowindex]   数据行（absolute + transform）
   *         │     └ div.ag-cell[role=gridcell]
   *         ├ div.ag-pinned-left-cols-container > .ag-row
   *         └ div.ag-pinned-right-cols-container > .ag-row
   * 与 el-table-v2 差异：单垂直滚动容器（无需多分区联动）；行节点复用重排
   * （DOM 顺序非视觉顺序，须按 aria-rowindex 排序）。行容器须限定在
   * .ag-body-viewport 内——浮动行（floating top/bottom）复用同名容器类 */
  const GRID_ADAPTER_AG_GRID = {
    name: 'ag-grid',
    rootSel: '.ag-root-wrapper',
    isRoot: divRootIs('ag-root-wrapper'),
    headerRowsOf: (root) => mergeHeaderRows([
      root.querySelector('.ag-pinned-left-header'),
      root.querySelector('.ag-header .ag-header-container'), // 中区表头（pinned 表头为其兄弟节点）
      root.querySelector('.ag-pinned-right-header')
    ], '.ag-header-row', '.ag-header-cell'),
    bodyRowsOf: (root) => zipBodyRows(['.ag-pinned-left-cols-container', '.ag-center-cols-container', '.ag-pinned-right-cols-container']
      .map(s => root.querySelector('.ag-body-viewport ' + s)).filter(Boolean)
      .map(c => rowsSortedByRowIndex(rowsWithCells(c, '.ag-row', '.ag-cell')))),
    scrollElsOf: (root) => { const vp = root.querySelector('.ag-body-viewport'); return vp ? [vp] : []; },
    headerCellsOf: (root) => root.querySelectorAll('.ag-header-row .ag-header-cell')
  };

  /* 适配器三：MUI X DataGrid（v6/v7）。结构：
   *   div.MuiDataGrid-root                     组件根
   *   ├ div.MuiDataGrid-container--top
   *   │ └ div.MuiDataGrid-columnHeadersContainer  表头容器（sticky，不随垂直滚动）
   *   │   └ div.MuiDataGrid-columnHeaders[role=rowgroup]
   *   │     └ div.MuiDataGrid-row[role=row] > div.MuiDataGrid-columnHeader
   *   └ div.MuiDataGrid-virtualScroller           垂直滚动容器
   *     └ div.MuiDataGrid-virtualScrollerContent
   *       └ div.MuiDataGrid-virtualScrollerRenderZone
   *         └ div.MuiDataGrid-row[role=row][aria-rowindex]  数据行（absolute top）
   *           └ div.MuiDataGrid-cell
   * 与 el-table-v2 差异：单滚动容器；固定列（.MuiDataGrid-cell--pinned）为 sticky
   * cell 同行取数，无独立分区，无需列拼接；行节点复用，须按 aria-rowindex 排序 */
  const GRID_ADAPTER_MUI = {
    name: 'mui-data-grid',
    rootSel: '.MuiDataGrid-root',
    isRoot: divRootIs('MuiDataGrid-root'),
    headerRowsOf: (root) => mergeHeaderRows([root.querySelector('.MuiDataGrid-columnHeaders')],
      '.MuiDataGrid-row', '.MuiDataGrid-columnHeader'),
    bodyRowsOf: (root) => {
      const zone = root.querySelector('.MuiDataGrid-virtualScrollerRenderZone');
      if (!zone) return [];
      return rowsSortedByRowIndex(rowsWithCells(zone, '.MuiDataGrid-row', '.MuiDataGrid-cell'))
        .filter(r => r.cells.length)
        .map(r => ({ cells: r.cells, el: r.el, isHeader: false }));
    },
    scrollElsOf: (root) => { const sc = root.querySelector('.MuiDataGrid-virtualScroller'); return sc ? [sc] : []; },
    headerCellsOf: (root) => root.querySelectorAll('.MuiDataGrid-columnHeaders .MuiDataGrid-columnHeader')
  };

  /* 适配器四：Tabulator（v6）。结构：
   *   div.tabulator                            组件根
   *   ├ div.tabulator-header                   固定表头
   *   │ └ div.tabulator-headers                表头行容器
   *   │   └ div.tabulator-col                  表头格（分组表头嵌套 col，取顶层）
   *   └ div.tabulator-tableHolder              滚动容器
   *     └ div.tabulator-table
   *       └ div.tabulator-row                  数据行（vdom 模式 absolute 定位）
   *         └ div.tabulator-cell               数据格（冻结列同格 frozen，无需拼接）
   * 行追加序即视觉序（无节点复用重排），保持 DOM 序；isRoot 加 .tabulator-tableHolder
   * 结构校验，防同页普通元素类名形似误报 */
  const GRID_ADAPTER_TABULATOR = {
    name: 'tabulator',
    rootSel: '.tabulator',
    isRoot: divRootIs('tabulator', (el) => !!el.querySelector('.tabulator-tableHolder')),
    headerRowsOf: (root) => mergeHeaderRows([root.querySelector('.tabulator-header')],
      '.tabulator-headers', '.tabulator-col',
      (c) => !c.parentElement.closest('.tabulator-col')), // 分组表头取顶层 col（嵌套子 col 剔除）
    bodyRowsOf: (root) => {
      const tbl = root.querySelector('.tabulator-tableHolder .tabulator-table');
      if (!tbl) return [];
      return rowsWithCells(tbl, '.tabulator-row', '.tabulator-cell')
        .filter(r => r.cells.length)
        .map(r => ({ cells: r.cells, el: r.el, isHeader: false }));
    },
    scrollElsOf: (root) => { const h = root.querySelector('.tabulator-tableHolder'); return h ? [h] : []; },
    headerCellsOf: (root) => root.querySelectorAll('.tabulator-header .tabulator-col')
  };

  /* 通栏摘要格：原文全是 inline 元素、靠 CSS 间距分列，innerText 会粘成一串
   * （「退货退款退款单号:…订单号:…」）。克隆子节点并以空格分隔，读起来可辨；
   * 克隆只用于取值、不触碰原 DOM，摘要内无控件/图片（有图片时走 cell.js 图片通道） */
  function spacedCell(el) {
    if (!el.children.length) return el;
    const box = document.createElement('div');
    for (const child of el.children) {
      box.appendChild(child.cloneNode(true));
      box.appendChild(document.createTextNode(' '));
    }
    return box;
  }

  /* 适配器五：多客（Duoke）客服工作台自绘 todo 网格（v2.16）。结构：
   *   div.todo_grid                     组件根 + 纵向滚动容器（overflow:auto）
   *   └ div.todo_grid_inner
   *     ├ div.todo_grid_header          粘性表头（在滚动容器内）
   *     │ └ div.todo_grid_th ×N
   *     └ div.todo_grid_record ×M       每条记录
   *       ├ div.todo_grid_common_row    整行摘要（退款单号/订单号/买家/国家/店铺）
   *       └ div.todo_grid_row > div.todo_grid_td ×N
   * 行全量渲染（20 条/页，分页器 dk-pagination 自绘），故声明 virtual:false——
   * 点选即取数、不触发滚动采集；「采集全部页」走手动指定翻页按钮（分页器无稳定
   * 特征类，不另加分页适配器）。整行摘要在视觉上是表格上方一条通栏说明，导出为
   * 独立行（摘要落首列、其余列补空），丢失它等于丢掉退款单号/订单号/买家 */
  const GRID_ADAPTER_TODO = {
    name: 'todo-grid',
    rootSel: '.todo_grid',
    virtual: false,
    isRoot: divRootIs('todo_grid'),
    headerRowsOf: (root) => {
      const h = root.querySelector('.todo_grid_header');
      const cells = h ? Array.from(h.children).filter(c => c.classList.contains('todo_grid_th')) : [];
      return cells.length ? [{ cells: cells, el: h, isHeader: true }] : [];
    },
    bodyRowsOf: (root) => {
      const out = [];
      for (const rec of root.querySelectorAll('.todo_grid_record')) {
        const row = rec.querySelector('.todo_grid_row');
        if (!row) continue;
        const cells = Array.from(row.children).filter(c => c.classList.contains('todo_grid_td'));
        if (!cells.length) continue;
        const sum = rec.querySelector('.todo_grid_common_row');
        if (sum) { // 通栏摘要：首列放文本，其余列补空 div（保持行宽一致，不串列）
          const padded = [spacedCell(sum)];
          for (let i = 1; i < cells.length; i++) padded.push(document.createElement('div'));
          out.push({ cells: padded, el: sum, isHeader: false });
        }
        out.push({ cells: cells, el: row, isHeader: false });
      }
      return out;
    },
    scrollElsOf: (root) => [root],
    headerCellsOf: (root) => root.querySelectorAll('.todo_grid_header .todo_grid_th')
  };

  const GRID_ADAPTERS = [GRID_ADAPTER_EL_V2, GRID_ADAPTER_AG_GRID, GRID_ADAPTER_MUI, GRID_ADAPTER_TABULATOR, GRID_ADAPTER_TODO];
  const GRID_ROOT_SELECTOR = GRID_ADAPTERS.map(a => a.rootSel).join(', ');

  /* ---------- 通用 div 网格兜底（v2.16） ----------
   * 已知组件适配器都不命中时，按「结构重复 + 表头视觉列对齐」保守识别自绘 div
   * 表格（宁漏不误）：
   *   ① 单元格：父级下 ≥2 个同标签 + 同首类名的兄弟（首类名空的不参与，防误判）
   *   ② 行：该父级；向上逐层找同类名重复行（≥2 行、每行列数一致、可见）
   *   ③ 表头：首个可视行上方最近一组同列数、整组文字非空、左边界 ±8px /
   *     宽度 ±max(12px, 10%) 对齐的兄弟组
   * 任一条件不满足即放弃。识别结果按根缓存（根/行/单元格 → 根），取数时按选择器
   * 重查，翻页重建后仍可用；已知组件适配器优先级更高，不受影响。
   * 通用网格按虚拟表格处理（滚动采集）——宁可多滚一轮（非虚拟时按行元素重叠合并
   * 后零新增），不冒「只取到可见行」的风险；「采集全部页」仍走手动指定翻页按钮。 */

  const GENERIC_ROOT = new WeakMap(); // 元素（根/行/单元格）→ 通用网格根
  const GENERIC_INFO = new WeakMap(); // 根 → { rowSel, cellSel, n, headerEl, headerCellSel }
  const GENERIC_MISS = new WeakSet(); // 已判定非网格的候选行（负缓存）

  /** 首类名（className 字符串首个 token；SVG 的 SVGAnimatedString 返回空） */
  function firstClassOf(el) {
    const c = el && el.className;
    return (typeof c === 'string' && c.trim() ? c.trim().split(/\s+/)[0] : '');
  }

  /** 元素族选择器：标签 + 首类名（同列/同行共用；首 token 最稳定，状态类常追加在后） */
  function familySelOf(el) {
    const c = firstClassOf(el);
    const esc = (typeof CSS !== 'undefined' && CSS.escape) ? CSS.escape(c) : c;
    return el.tagName.toLowerCase() + (c ? '.' + esc : '');
  }

  function rectInfo(el) {
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  }

  /** 视觉列对齐纯函数（algo-check 离线回归）：hdr/data 为 { left, width } 数组；
   *  左边界差 ≤8px、宽度差 ≤max(12px, 数据列宽 10%) 记为同列，
   *  同列数 ≥ max(2, ceil(n*0.75)) 判定对齐 */
  function columnsAligned(hdr, data) {
    const n = Math.min(hdr.length, data.length);
    if (n < 2) return false;
    let ok = 0;
    for (let i = 0; i < n; i++) {
      const h = hdr[i];
      const d = data[i];
      if (!h || !d) continue;
      if (Math.abs(h.left - d.left) <= 8 && Math.abs(h.width - d.width) <= Math.max(12, d.width * 0.1)) ok++;
    }
    return ok >= Math.max(2, Math.ceil(n * 0.75));
  }

  /* ---------- 表头锚定网格（v2.18） ----------
   * 自绘表格的另一常见形态：真 <table> 只渲表头（tbody 是占位空行），数据行
   * 放在同级子树的 div 列表里，且同一行内每格 class 各不相同（TUX core-table /
   * TikTok 商家后台即此类）。通用兜底的「同首个类名兄弟」前提在这里不成立，
   * 故另设一层识别：以表头列几何（left/width）为锚点，在最近容器里找「≥2 行、
   * 每行可见格数 = 列数、且视觉列对齐」的重复行组。纯几何 + 结构，不依赖 class
   * 名（CSS Modules hash 变更无感），也不受界面语言影响。
   * 与通用兜底同走「结果按根缓存、取数按选择器重查」的路径，但声明
   * virtual:false（分页表格行全量渲染，点选即取数、不滚动采集）。 */

  const HEADER_ANCHOR_MISS = new WeakSet(); // 已判定无可锚定网格的悬停元素（负缓存）

  /** 纯表头表 → { el, cells, cols }；表体有任何非空文字行即判为普通表返回 null。
   *  先按行数快速排除（占位行只会是零星一两条，大表不必逐行读文本） */
  function headerAnchorOf(tbl) {
    if (!tbl || tbl.tagName !== 'TABLE' || !tbl.tHead) return null;
    let n = 0;
    for (const tb of tbl.tBodies) n += tb.rows.length;
    if (n > 3) return null;
    for (const tb of tbl.tBodies) {
      for (const tr of tb.rows) {
        if ((tr.textContent || '').replace(/\s+/g, '')) return null; // 有数据行：普通表格
      }
    }
    const trs = Array.from(tbl.tHead.rows).filter(tr => tr.cells.length >= 2);
    if (!trs.length) return null;
    // 多行表头取格数最多的一行作列锚点（最细粒度那行与数据行一一对应）
    let best = trs[0].cells;
    for (const tr of trs) if (tr.cells.length > best.length) best = tr.cells;
    const cells = Array.from(best).filter(c => {
      const r = c.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    if (cells.length < 2) return null;
    return { el: tbl, cells: cells, cols: cells.map(rectInfo) };
  }

  /** 表头锚定行判定（纯函数，algo-check 离线回归）：格数须与表头列数一致且
   *  视觉列对齐。左容差按列宽 6% 伸缩——表头 TH 与数据格的内边距不同，首列常
   *  错位十余像素（TikTok 实测 12px），固定 8px 会误杀真实表格 */
  function headerAnchoredRowOk(cols, cells) {
    if (!cols || !cells || cols.length < 2 || cells.length !== cols.length) return false;
    let ok = 0;
    for (let i = 0; i < cols.length; i++) {
      const h = cols[i];
      const d = cells[i];
      if (!h || !d) continue;
      if (Math.abs(h.left - d.left) <= Math.max(8, d.width * 0.06) &&
          Math.abs(h.width - d.width) <= Math.max(12, d.width * 0.1)) ok++;
    }
    return ok >= Math.max(2, Math.ceil(cols.length * 0.75));
  }

  /** 行的可见子格（宽高均 >0；隐藏列如 TikTok 的收藏列宽度为 0 须剔除）；
   *  超过列数即判定不是该表的行（早退，免全量子元素测量） */
  function visibleCellsOf(row, n) {
    const cells = [];
    for (const c of row.children) {
      const r = c.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) cells.push(c);
      if (cells.length > n) return null;
    }
    return cells.length === n ? cells : null;
  }

  /** 容器内找重复行组：父级的全部子元素都是「可见子格数 = 列数、位于表头下方、
   *  视觉列对齐、同一首类名选择器」的行，≥2 行即命中（取行数最多的一组）。
   *  要求整组子元素都是行（含一个非行元素即放弃），避免把页面级容器误当行组 */
  function rowGroupUnder(root, anchor, headerBottom) {
    const n = anchor.cols.length;
    let best = null;
    for (const p of root.querySelectorAll('*')) {
      const kids = Array.from(p.children);
      if (kids.length < 2 || kids.length > 200) continue;
      let rows = 0;
      let rowSel = '';
      for (const k of kids) {
        const cells = visibleCellsOf(k, n);
        if (!cells) break;
        const rr = k.getBoundingClientRect();
        if (rr.width <= 0 || rr.height <= 0 || rr.top < headerBottom - 1) break;
        if (!headerAnchoredRowOk(anchor.cols, cells.map(rectInfo))) break;
        if (!firstClassOf(k)) break; // 无类名的行无法按选择器重查，放弃
        const sel = familySelOf(k);
        if (!rowSel) rowSel = sel;
        else if (sel !== rowSel) break;
        rows++;
      }
      if (rows >= 2 && (!best || rows > best.rows)) best = { parent: p, rowSel: rowSel, rows: rows };
    }
    return best;
  }

  /** 识别入口：自鼠标元素向上 ≤10 层，找同时含「纯表头 table」与「对齐行组」的
   *  最近容器，命中后按根缓存。容器越紧越可信，故取首个命中 */
  function detectHeaderAnchoredGrid(el) {
    if (!(el && el.nodeType === 1) || HEADER_ANCHOR_MISS.has(el)) return null;
    let depth = 0;
    for (let a = el; a && a !== document.body && depth < 10; a = a.parentElement, depth++) {
      const tables = a.querySelectorAll('table');
      if (!tables.length || tables.length > 8) continue;
      for (const tbl of tables) {
        const anchor = headerAnchorOf(tbl);
        if (!anchor) continue;
        const headerBottom = tbl.getBoundingClientRect().bottom;
        const g = rowGroupUnder(a, anchor, headerBottom);
        if (!g) continue;
        // 只允许从「行组内」或「表头表内」起意：容器里的标题、筛选栏、分页器等
        // 不属于表格，不能因同处一个容器就被点选（否则翻页按钮会被拦成选表）
        if (!g.parent.contains(el) && !anchor.el.contains(el)) continue;
        // 根取「行组父级」而非更外层的 a：与 v2.16 通用兜底一致，且让组件分页器
        // （常在行组之外、同容器内）落在根之外，findPagerRoot 才能向上命中
        return rememberHeaderGrid(g.parent, g, anchor);
      }
    }
    HEADER_ANCHOR_MISS.add(el);
    return null;
  }

  /** 表头锚定结果缓存：根/表头表/表头格/行/格 → 根（hover 与点选据此快速命中）；
   *  选择器只存一次，取数时按 root.querySelectorAll 重查（翻页重建后仍可用） */
  function rememberHeaderGrid(root, group, anchor) {
    const info = {
      mode: 'header-anchored', rowSel: group.rowSel, n: anchor.cols.length,
      headerEl: anchor.el, virtual: false
    };
    GENERIC_INFO.set(root, info);
    GENERIC_ROOT.set(root, root);
    GENERIC_ROOT.set(anchor.el, root);
    for (const c of anchor.cells) GENERIC_ROOT.set(c, root);
    for (const tr of anchor.el.tHead.rows) GENERIC_ROOT.set(tr, root);
    for (const row of root.querySelectorAll(group.rowSel)) {
      GENERIC_ROOT.set(row, root);
      for (const c of row.children) GENERIC_ROOT.set(c, root);
    }
    return root;
  }

  /** 表头锚定网格 → 与组件适配器同构的钩子（不注册进 GRID_ADAPTERS，按需生成） */
  function headerAnchoredAdapter(root, info) {
    return {
      name: 'header-anchored-grid',
      rootSel: '',
      virtual: false, // 行全量渲染：点选即取数，不滚动
      isRoot: () => false,
      headerRowsOf: () => {
        const t = info.headerEl;
        return (t && t.isConnected) ? rowsOfTable(t).filter(r => r.isHeader) : [];
      },
      bodyRowsOf: (r) => {
        const out = [];
        for (const row of r.querySelectorAll(info.rowSel)) {
          const cells = visibleCellsOf(row, info.n);
          if (cells) out.push({ cells: cells, el: row, isHeader: false });
        }
        return out;
      },
      scrollElsOf: () => [],
      headerCellsOf: () => {
        const a = (info.headerEl && info.headerEl.isConnected) ? headerAnchorOf(info.headerEl) : null;
        return a ? a.cells : [];
      }
    };
  }

  /** 表头表 → 所属锚定网格根（main.js hitRoot 用）：纯表头表若已缓存/可探测出
   *  行组，返回其网格根；普通表（表体有数据）或找不到行组返回 null */
  function gridRootOfHeaderTable(tbl) {
    if (!headerAnchorOf(tbl)) return null;
    return genericRootOf(tbl) || detectHeaderAnchoredGrid(tbl);
  }

  /** 候选行（自鼠标元素向上 ≤8 层）：父级下同标签同首类名兄弟 2~30 个，
   *  且过半兄弟有文本（滤掉图标/装饰容器）；首类名为空的层不参与 */
  function candidateRows(el) {
    const out = [];
    let depth = 0;
    for (let a = el; a && a !== document.body && depth < 8; a = a.parentElement, depth++) {
      if (!firstClassOf(a)) continue;
      const p = a.parentElement;
      if (!p) break;
      const sel = familySelOf(a);
      const sibs = Array.from(p.children).filter(c => familySelOf(c) === sel);
      if (sibs.length < 2 || sibs.length > 30) continue;
      const withText = sibs.filter(c => (c.textContent || '').trim()).length;
      if (withText >= Math.max(2, Math.ceil(sibs.length * 0.6))) out.push({ row: p, cellSel: sel, n: sibs.length });
    }
    return out;
  }

  /** 候选行 → { root, rows }：向上 ≤6 层找同类重复行（取行数最多的一层），
   *  rows 按视觉 top 升序（行节点可能被复用重排） */
  function repeatedRows(cand) {
    const rowSel = familySelOf(cand.row);
    let best = null;
    let node = cand.row.parentElement;
    let depth = 0;
    for (; node && node !== document.body && depth < 6; node = node.parentElement, depth++) {
      const rows = [];
      for (const r of node.querySelectorAll(rowSel)) {
        const cells = Array.from(r.children).filter(c => familySelOf(c) === cand.cellSel);
        if (cells.length !== cand.n) continue;
        const rr = r.getBoundingClientRect();
        if (rr.width <= 0 || rr.height <= 0) continue; // 隐藏/未布局行
        rows.push({ el: r, top: rr.top });
      }
      if (rows.length > 500) return null; // 异常规模，放弃（防超慢查询）
      if (rows.length >= 2 && (!best || rows.length > best.rows.length)) {
        rows.sort((a, b) => a.top - b.top);
        best = { root: node, rows: rows.map(x => x.el) };
      }
    }
    return best;
  }

  /** 首行上方找表头：沿首行祖先的「前面的兄弟」逐层找同列数、整组文字非空、
   *  同标签、视觉列对齐且位于数据行上方的一组元素；找不到返回 null */
  function headerOf(firstRow, cand, dataRects) {
    let node = firstRow;
    let depth = 0;
    while (node && node.parentElement && depth < 8) {
      let p = node.previousElementSibling;
      for (let k = 0; p && k < 8; p = p.previousElementSibling, k++) {
        const kids = Array.from(p.children);
        if (kids.length !== cand.n) continue;
        if (kids.some(c => !(c.textContent || '').trim())) continue;
        const tag0 = kids[0].tagName;
        if (kids.some(c => c.tagName !== tag0)) continue;
        const rects = kids.map(rectInfo);
        if (rects.some(r => r.height <= 0 || r.width <= 0)) continue;
        if (rects[0].top > dataRects[0].top - 1) continue; // 必须在数据行上方
        if (!columnsAligned(rects, dataRects)) continue;
        return { el: p, cells: kids, cellSel: familySelOf(kids[0]) };
      }
      node = node.parentElement;
      depth++;
    }
    return null;
  }

  /** 通用网格探测入口：命中返回根元素并写缓存，否则 null。
   *  v2.18 先试表头锚定（纯表头 table + 异构 class 行组，见上方注释），
   *  不命中再走 v2.16 的同首类名结构重复兜底 */
  function detectGenericGrid(el) {
    if (!(el && el.nodeType === 1)) return null;
    const anchored = detectHeaderAnchoredGrid(el);
    if (anchored) return anchored;
    for (const cand of candidateRows(el)) {
      if (GENERIC_MISS.has(cand.row)) continue;
      const rep = repeatedRows(cand);
      if (!rep) { GENERIC_MISS.add(cand.row); continue; }
      const dataRects = Array.from(rep.rows[0].children)
        .filter(c => familySelOf(c) === cand.cellSel).map(rectInfo);
      const head = headerOf(rep.rows[0], cand, dataRects);
      if (!head) { GENERIC_MISS.add(cand.row); continue; }
      const info = {
        rowSel: familySelOf(cand.row), cellSel: cand.cellSel, n: cand.n,
        headerEl: head.el, headerCellSel: head.cellSel
      };
      GENERIC_INFO.set(rep.root, info);
      GENERIC_ROOT.set(rep.root, rep.root);
      for (const r of rep.rows) GENERIC_ROOT.set(r, rep.root);
      return rep.root;
    }
    return null;
  }

  /** 已识别根的元素查询（只查缓存，不触发探测） */
  function genericRootOf(el) {
    for (let a = el; a && a !== document.body; a = a.parentElement) {
      const r = GENERIC_ROOT.get(a);
      if (r) return r;
    }
    return null;
  }

  /** 通用网格根 → 与组件适配器同构的钩子（不注册进 GRID_ADAPTERS，按需生成） */
  function genericAdapterOf(root) {
    const info = GENERIC_INFO.get(root);
    if (!info) return null;
    if (info.mode === 'header-anchored') return headerAnchoredAdapter(root, info); // v2.18
    const headerEl = () => {
      if (info.headerEl && info.headerEl.isConnected) return info.headerEl;
      const first = root.querySelector(info.rowSel); // 翻页整根重建：按首行重找表头
      if (!first) return null;
      const rects = Array.from(first.children)
        .filter(c => familySelOf(c) === info.cellSel).map(rectInfo);
      const head = headerOf(first, { n: info.n, cellSel: info.cellSel }, rects);
      if (head) { info.headerEl = head.el; info.headerCellSel = head.cellSel; }
      return head ? head.el : null;
    };
    return {
      name: 'generic-div-grid',
      rootSel: '',
      virtual: true,
      isRoot: () => false,
      headerRowsOf: () => {
        const h = headerEl();
        const cells = h ? Array.from(h.children).filter(c => familySelOf(c) === info.headerCellSel) : [];
        return cells.length ? [{ cells: cells, el: h, isHeader: true }] : [];
      },
      bodyRowsOf: (r) => {
        const out = [];
        for (const row of r.querySelectorAll(info.rowSel)) {
          const cells = Array.from(row.children).filter(c => familySelOf(c) === info.cellSel);
          if (cells.length === info.n) out.push({ cells: cells, el: row, isHeader: false });
        }
        return out;
      },
      scrollElsOf: (r) => {
        for (let x = r; x && x !== document.body; x = x.parentElement) {
          const st = getComputedStyle(x);
          if ((st.overflowY === 'auto' || st.overflowY === 'scroll') && x.scrollHeight > x.clientHeight + 4) return [x];
        }
        return [];
      },
      headerCellsOf: () => {
        const h = headerEl();
        return h ? Array.from(h.children).filter(c => familySelOf(c) === info.headerCellSel) : [];
      }
    };
  }

  /** 网格适配器分发（按注册序首个命中） */
  function gridAdapterOf(el) {
    for (const a of GRID_ADAPTERS) if (a.isRoot(el)) return a;
    return genericAdapterOf(el); // v2.16：通用兜底（仅对已探测并缓存的根生效）
  }

  /** div 网格表格判定：组件适配器根特征命中，或已识别的通用网格根 */
  function isGridTable(el) {
    return !!gridAdapterOf(el);
  }

  /** 网格是否恒虚拟（virtual.js 滚动采集判定）：适配器可声明 virtual:false
   *  （分页网格行全量渲染，点选即取数）；未声明与通用网格按虚拟处理 */
  function gridIsVirtual(root) {
    const a = gridAdapterOf(root);
    return !a || a.virtual !== false;
  }

  /** 命中解析入口（main.js hitRoot 用）：最近的网格组件根；已知组件优先，
   *  都不命中时尝试通用兜底探测（结果缓存，失败不重复扫） */
  function gridRootOf(el) {
    if (!(el && typeof el.closest === 'function')) return null;
    for (const a of GRID_ADAPTERS) {
      const r = el.closest(a.rootSel);
      if (r) return r;
    }
    return genericRootOf(el) || detectGenericGrid(el);
  }

  /** div 网格表格行获取：表头行 + 数据行（getRows 分发入口，返回与 rowsOfTable 同构） */
  function gridRowsOf(root) {
    const a = gridAdapterOf(root);
    return a ? a.headerRowsOf(root).concat(a.bodyRowsOf(root)) : [];
  }

  /** 网格滚动容器列表（virtual.js 采集联动用；多分区须联动滚动则返回多个） */
  function gridScrollEls(root) {
    const a = gridAdapterOf(root);
    return a ? a.scrollElsOf(root) : [];
  }

  /** 指纹表头格分发（persist.js tableKeyOf 用）：按注册序取首个非空结果——各组件
   *  类名互斥无需先判根，且对对象桩友好（algo-check 离线回归直接走本分发） */
  function gridHeaderCellsOf(root) {
    if (!root || typeof root.querySelectorAll !== 'function') return null;
    for (const a of GRID_ADAPTERS) {
      const cells = a.headerCellsOf(root);
      if (cells && cells.length) return cells;
    }
    const g = genericAdapterOf(root); // v2.16：通用网格也提供稳定表头指纹
    const cells = g ? g.headerCellsOf(root) : null;
    return cells && cells.length ? cells : null;
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
    if (!base) base = t('tableN', '表格' + (index + 1), index + 1);
    let name = base, n = 2;
    while (used.has(name)) name = base.slice(0, 28) + '(' + n++ + ')';
    used.add(name);
    return name;
  }

  ns.table = {
    getRows: getRows, extractTable: extractTable, makeSheetName: makeSheetName,
    splitGroupOf: splitGroupOf, pairSplitGroup: pairSplitGroup,
    isGridTable: isGridTable, gridScrollEls: gridScrollEls, gridIsVirtual: gridIsVirtual,
    gridRootOf: gridRootOf, gridHeaderCellsOf: gridHeaderCellsOf,
    gridRootOfHeaderTable: gridRootOfHeaderTable, // v2.18 纯表头表 → 锚定网格根
    rowsSortedByRowIndex: rowsSortedByRowIndex, columnsAligned: columnsAligned,
    headerAnchoredRowOk: headerAnchoredRowOk,     // v2.18 纯函数（algo-check 离线回归）
    GRID_ROOT_SELECTOR: GRID_ROOT_SELECTOR, adapters: GRID_ADAPTERS
  };
})();
