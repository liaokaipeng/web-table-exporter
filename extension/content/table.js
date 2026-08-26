/**
 * 表格提取：行获取（表头兜底 + 占位/隐藏行过滤）、合并单元格展开、Sheet 命名
 * 依赖：cell（cellParts 四通道取值）
 */
(() => {
  'use strict';
  const ns = window.__h2x;

  /** 行获取：常规 thead>tr>th；部分组件库 thead 直接嵌 th（无 tr 包裹）；
   *  过滤虚拟滚动占位空行与隐藏行。返回 [{ cells, el, isHeader }] */
  function getRows(table) {
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
    for (const tb of table.tBodies) for (const tr of tb.rows) push(tr.cells, tr);
    if (table.tFoot) for (const tr of table.tFoot.querySelectorAll('tr')) push(tr.cells, tr, true);

    return rows.filter(({ cells, el }) => {
      if (!cells.length) return false; // 虚拟滚动占位空行（无内容）
      if (el.className && /virtual/.test(el.className)) return false; // 各类虚拟滚动占位行
      if (getComputedStyle(el).display === 'none') return false; // 隐藏行
      return true;
    });
  }

  /** 表格 → 四通道网格：rowspan/colspan 展开成网格 + 生成 SheetJS !merges。
   *  每格一次取齐 cellParts() 四通道结果（合并延续格为 null），结尾按通道转置产出 */
  function extractTable(table) {
    const cellGrid = [];
    const merges = [];
    const rows = getRows(table);
    let headerRows = 0; // 前导表头行数（thead），列拆分用于表头命名与列名匹配
    while (headerRows < rows.length && rows[headerRows].isHeader) headerRows++;
    const ensureRow = (r) => { if (!cellGrid[r]) cellGrid[r] = []; };
    rows.forEach(({ cells }, r) => {
      ensureRow(r);
      let c = 0;
      for (const cell of cells) {
        while (cellGrid[r][c] !== undefined) c++; // 跳过已被合并占据的槽位
        const rs = cell.rowSpan || 1;
        const cs = cell.colSpan || 1;
        cellGrid[r][c] = ns.cell.cellParts(cell);
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

  ns.table = { getRows: getRows, extractTable: extractTable, makeSheetName: makeSheetName };
})();
