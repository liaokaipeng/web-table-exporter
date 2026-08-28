/**
 * 导出格式序列化（纯函数，零 DOM 依赖）：CSV / JSON / Markdown / HTML
 * 输入为导出管线末端的 aoa（已应用列拆分/列筛选/列格式）：
 *   tables = [{ name, aoa, headerRows }]（name 与 Sheet 名同源，多表唯一）
 * 文本格式不还原合并单元格（aoa 为平面数据）；CSV 多表由调用方拆多文件
 * 依赖：util.escapeHtml；算法层模块，经 __h2x.format 挂载
 */
(() => {
  'use strict';
  const ns = window.__h2x;
  const { escapeHtml } = ns.util;

  /* ---------------- CSV（RFC 4180 + BOM，Excel 可直接识别 UTF-8） ---------------- */

  /** 单元格转义：含逗号/引号/换行时双引号包裹，内部引号翻倍 */
  function csvCell(v) {
    const s = v == null ? '' : String(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function toCsv(aoa) {
    const lines = (aoa || []).map(row => (row || []).map(csvCell).join(','));
    return '\ufeff' + lines.join('\r\n') + (lines.length ? '\r\n' : '');
  }

  /* ---------------- 行对象（JSON / Markdown 表头共用） ---------------- */

  /** 列名集合：headerRows>0 取末行表头（最贴近数据的叶子列名）；缺失补「列N」；
   *  重复列名追加序号（作对象键会静默覆盖丢数据） */
  function headerKeys(aoa, headerRows) {
    const h = headerRows || 0;
    const headRow = h > 0 ? (aoa[h - 1] || []) : [];
    const seen = new Map();
    let maxCols = 0;
    for (const row of aoa) if (row) maxCols = Math.max(maxCols, row.length);
    const keys = [];
    for (let c = 0; c < maxCols; c++) {
      let name = String(headRow[c] == null ? '' : headRow[c]).trim();
      if (!name) name = '列' + (c + 1);
      const n = (seen.get(name) || 0) + 1;
      seen.set(name, n);
      keys.push(n > 1 ? name + '(' + n + ')' : name);
    }
    return keys;
  }

  /** aoa → 行对象数组（数据行 = headerRows 之后；值原样传递，数字格式已数值化） */
  function rowObjects(aoa, headerRows) {
    const h = headerRows || 0;
    const keys = headerKeys(aoa, h);
    const out = [];
    for (let r = h; r < (aoa || []).length; r++) {
      const row = aoa[r] || [];
      const obj = {};
      keys.forEach((k, c) => { obj[k] = row[c] == null ? '' : row[c]; });
      out.push(obj);
    }
    return out;
  }

  /** JSON 文档：单表 = 行对象数组；多表 = { 表名: 行对象数组 } */
  function toJson(tables) {
    if (tables.length === 1) {
      return JSON.stringify(rowObjects(tables[0].aoa, tables[0].headerRows), null, 2);
    }
    const doc = {};
    tables.forEach(t => { doc[t.name] = rowObjects(t.aoa, t.headerRows); });
    return JSON.stringify(doc, null, 2);
  }

  /* ---------------- Markdown（GFM 表格） ---------------- */

  /** 单元格：竖线转义、换行转 <br>（GFM 单元格内不能有裸换行） */
  function mdCell(v) {
    return String(v == null ? '' : v)
      .replace(/\r/g, '')
      .replace(/\n/g, '<br>')
      .replace(/\|/g, '\\|');
  }

  /** 单表 Markdown 片段：无表头时生成「列N」表头行（GFM 表格必须有表头） */
  function mdTable(name, aoa, headerRows) {
    const h = headerRows || 0;
    const keys = headerKeys(aoa, h); // 复用列名规则（末行表头/列N/去重后缀）
    const lines = ['## ' + name, ''];
    lines.push('| ' + keys.map(mdCell).join(' | ') + ' |');
    lines.push('| ' + keys.map(() => '---').join(' | ') + ' |');
    for (let r = h; r < (aoa || []).length; r++) {
      const row = aoa[r] || [];
      lines.push('| ' + keys.map((_, c) => mdCell(row[c])).join(' | ') + ' |');
    }
    return lines.join('\n');
  }

  /** Markdown 文档：多表以二级标题分隔 */
  function toMarkdown(tables) {
    return tables.map(t => mdTable(t.name, t.aoa, t.headerRows)).join('\n\n') + '\n';
  }

  /* ---------------- HTML ---------------- */

  /** 单表 HTML 片段：前 headerRows 行入 thead（th），数据行入 tbody（td） */
  function htmlTable(name, aoa, headerRows) {
    const h = headerRows || 0;
    let html = '<h2>' + escapeHtml(name) + '</h2>\n<table>\n';
    if (h > 0) {
      html += '<thead>\n';
      for (let r = 0; r < h; r++) {
        html += '<tr>' + (aoa[r] || []).map(v => '<th>' + escapeHtml(v == null ? '' : String(v)) + '</th>').join('') + '</tr>\n';
      }
      html += '</thead>\n';
    }
    html += '<tbody>\n';
    for (let r = h; r < (aoa || []).length; r++) {
      html += '<tr>' + (aoa[r] || []).map(v => '<td>' + escapeHtml(v == null ? '' : String(v)) + '</td>').join('') + '</tr>\n';
    }
    return html + '</tbody>\n</table>';
  }

  /** HTML 完整文档（UTF-8 声明 + 极简表格样式，单文件可直接浏览器打开） */
  function toHtmlDocument(tables, title) {
    return [
      '<!DOCTYPE html>',
      '<html>',
      '<head>',
      '<meta charset="utf-8">',
      '<title>' + escapeHtml(title || '导出表格') + '</title>',
      '<style>body{font:14px/1.6 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif;color:#333;margin:24px;}h2{font-size:18px;margin:24px 0 8px;}table{border-collapse:collapse;}th,td{border:1px solid #ccc;padding:6px 12px;}th{background:#f5f7fa;}</style>',
      '</head>',
      '<body>',
      tables.map(t => htmlTable(t.name, t.aoa, t.headerRows)).join('\n'),
      '</body>',
      '</html>'
    ].join('\n');
  }

  ns.format = {
    csvCell: csvCell, toCsv: toCsv,
    headerKeys: headerKeys, rowObjects: rowObjects, toJson: toJson,
    mdCell: mdCell, toMarkdown: toMarkdown,
    toHtmlDocument: toHtmlDocument
  };
})();
