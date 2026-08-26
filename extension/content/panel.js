/**
 * 列拆分配置面板（Shadow DOM 内）：三种模式（control/block/delimiter）、智能预填、
 * 前 3 行实时预览、硬校验；草稿与规则均存内存（不碰 chrome.storage）
 * 依赖：主 UI 经 init() 注入 { host, selected, snapshots, splitRules,
 *   isBusy, isAlive, updateBar, setHint, resetHint }（main.js 最后装配）；
 *   算法层经 __h2x 命名空间（util/table/split）
 */
(() => {
  'use strict';
  const ns = window.__h2x;
  const { escapeHtml } = ns.util;
  const { extractTable, makeSheetName } = ns.table;
  const { splitSegments, splitColName } = ns.split;

  let deps = null; // 主 UI 注入的依赖接口（init 后可用）

  // 分隔符探测候选（优先级从高到低；空格最模糊放最后）
  const DELIM_CANDIDATES = ['、', ',', ':', ' '];
  const SPACE_MARK = '␣'; // 空格分隔符在输入框中的可见标记（空格本身不可见）

  let panelOpen = false;    // 拆分面板打开中（Esc 只关面板，主工具栏导出/取消禁用）
  let panelMask = null;
  let panelTable = null;    // 当前编辑的表格
  let panelSample = null;   // 当前表格取样通道 { aoa|rows, ctrl, text, headerRows, merges }
  let panelCols = null;     // 当前表格列信息 [{ name, hasCtrl }]
  let panelDrafts = null;   // Map: table -> { draft: [{checked,mode,pattern,limit}|null], cols }

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
    if (deps.snapshots.has(table)) return deps.snapshots.get(table); // 虚拟表用已采集快照
    return extractTable(table); // 普通表现跑 extractTable 取样
  }

  // 当前面板表格是否含合并单元格（拆分禁用判定，渲染/交互/预览共用）
  function panelHasMerges() {
    return !!(panelSample && panelSample.merges && panelSample.merges.length);
  }

  // 参数可用性：control 无分隔符/上限；block 无分隔符（上限可用）；delimiter 全可用
  const lockPattern = (d) => panelHasMerges() || d.mode !== 'delimiter';
  const lockLimit = (d) => panelHasMerges() || d.mode === 'control';

  // 从列行事件解析草稿项：{ row, d } 或 null（面板未开 / 目标不在列行上）
  function draftAt(e) {
    if (!panelOpen) return null;
    const row = e.target.closest('.h2x-col');
    if (!row) return null;
    const c = parseInt(row.dataset.c, 10);
    return { row: row, d: panelDrafts.get(panelTable).draft[c] };
  }

  function openSplitPanel() {
    if (panelOpen || deps.isBusy() || !deps.selected.size) return;
    panelOpen = true;
    panelDrafts = new Map();
    deps.updateBar(); // 主工具栏导出/取消/拆分列同步禁用
    buildPanelDOM();
    switchPanelTable(deps.selected.keys().next().value);
  }

  function buildPanelDOM() {
    panelMask = document.createElement('div');
    panelMask.className = 'h2x-mask';
    panelMask.innerHTML = [
      // 面板专属样式随面板自持；按钮样式（h2x-btn/primary/ghost）由主 UI 的
      // <style> 提供（工具栏与面板共用同一 Shadow DOM）
      '<style>',
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
    deps.host.shadowRoot.appendChild(panelMask);
    panelMask.querySelector('.h2x-save').addEventListener('click', saveSplitPanel);
    panelMask.querySelector('.h2x-pcancel').addEventListener('click', closeSplitPanel);
    const tsel = panelMask.querySelector('.h2x-tsel');
    tsel.addEventListener('change', () => {
      const idx = parseInt(tsel.value, 10);
      const tables = [...deps.selected.keys()];
      if (idx >= 0 && idx < tables.length) switchPanelTable(tables[idx]);
    });
    const colsBox = panelMask.querySelector('.h2x-cols');
    colsBox.addEventListener('change', onColChange);
    colsBox.addEventListener('input', onColInput);
  }

  function switchPanelTable(table) {
    if (!table || !deps.selected.has(table)) return;
    panelTable = table;
    panelSample = sampleChannels(table);
    const entry = panelDrafts.get(table);
    if (entry) {
      panelCols = entry.cols; // 草稿的列索引基准
    } else {
      panelCols = buildPanelCols(panelSample);
      panelDrafts.set(table, { draft: draftFromSaved(deps.splitRules.get(table), panelCols), cols: panelCols });
    }
    renderPanel();
  }

  function renderPanel() {
    const tsel = panelMask.querySelector('.h2x-tsel');
    const used = new Set();
    let html = '';
    let i = 0;
    for (const t of deps.selected.keys()) {
      html += '<option value="' + i + '"' + (t === panelTable ? ' selected' : '') + '>' +
        (i + 1) + '. ' + escapeHtml(makeSheetName(t, i, used)) + '</option>';
      i++;
    }
    tsel.innerHTML = html;
    const hasMerges = panelHasMerges();
    const note = panelMask.querySelector('.h2x-note');
    note.hidden = !hasMerges;
    if (hasMerges) note.textContent = '该表格含合并单元格，拆分不可用（导出保持原样）';
    renderColList();
    renderPreview();
  }

  function renderColList() {
    const draft = panelDrafts.get(panelTable).draft;
    let html = '<div class="h2x-col-head"><span class="h2x-h1"></span><span class="h2x-h2">列</span>' +
      '<span class="h2x-h4">模式</span><span class="h2x-h5">分隔符</span><span class="h2x-h6">段数上限</span></div>';
    panelCols.forEach((col, c) => {
      const d = draft[c];
      const name = col.name || ('列' + (c + 1));
      html += '<div class="h2x-col' + (d.checked ? '' : ' off') + '" data-c="' + c + '">' +
        '<input type="checkbox" class="h2x-ck"' + (d.checked ? ' checked' : '') + (panelHasMerges() ? ' disabled' : '') + '>' +
        '<span class="h2x-cname">' + escapeHtml(name) + (col.hasCtrl ? '<i class="h2x-tag">控件</i>' : '') + (col.multiBlock ? '<i class="h2x-tag">多行</i>' : '') + '</span>' +
        '<select class="h2x-mode"' + (panelHasMerges() ? ' disabled' : '') + '>' +
        '<option value="control"' + (d.mode === 'control' ? ' selected' : '') + '>控件值拆分</option>' +
        '<option value="block"' + (d.mode === 'block' ? ' selected' : '') + '>按换行拆分</option>' +
        '<option value="delimiter"' + (d.mode === 'delimiter' ? ' selected' : '') + '>分隔符拆分</option>' +
        '</select>' +
        '<input type="text" class="h2x-pattern" placeholder="如 、 ' + SPACE_MARK + '=空格" value="' +
        escapeHtml(d.pattern === ' ' ? SPACE_MARK : d.pattern) + '"' + (lockPattern(d) ? ' disabled' : '') + '>' +
        '<input type="text" class="h2x-limit" placeholder="不限" inputmode="numeric" value="' +
        escapeHtml(d.limit) + '"' + (lockLimit(d) ? ' disabled' : '') + '>' +
        '</div>';
    });
    panelMask.querySelector('.h2x-cols').innerHTML = html;
  }

  function onColChange(e) {
    const hit = draftAt(e);
    if (!hit) return;
    const { row, d } = hit;
    if (e.target.classList.contains('h2x-ck')) {
      d.checked = e.target.checked;
      row.classList.toggle('off', !d.checked);
    } else if (e.target.classList.contains('h2x-mode')) {
      d.mode = e.target.value;
    }
    row.querySelector('.h2x-pattern').disabled = lockPattern(d);
    row.querySelector('.h2x-limit').disabled = lockLimit(d);
    renderPreview();
  }

  function onColInput(e) {
    if (!(e.target instanceof HTMLInputElement)) return;
    const hit = draftAt(e);
    if (!hit) return;
    const d = hit.d;
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
    if (panelHasMerges()) {
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
    // 段值与列名与导出共用 splitSegments / splitColName，保证预览即所得
    const partsOf = (r, c, d) => splitSegments(
      d.mode, (aoa[r] || [])[c], (blocksCh[r] || [])[c], d.pattern, parseLimit(d.limit));
    // 各规则的新列数（与导出逻辑一致：取全部数据行的最大段数/块数）
    const counts = actives.map(({ c, d }) => {
      if (d.mode === 'control') return 2;
      let n = 1;
      for (let r = headerRows; r < aoa.length; r++) {
        const parts = partsOf(r, c, d);
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
        for (let s = 0; s < counts[k]; s++) {
          html += '<th class="new">' + escapeHtml(splitColName(raw, s)) + '</th>';
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
        } else {
          const parts = partsOf(r, c, d);
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
      if (rules.length) deps.splitRules.set(table, rules);
      else deps.splitRules.delete(table);
    }
    closeSplitPanel();
    deps.setHint('拆分规则已保存，导出时生效', '#2e7d32');
    setTimeout(() => { if (deps.isAlive() && !panelOpen) deps.resetHint(); }, 2500);
  }

  function closeSplitPanel() {
    if (!panelOpen) return;
    panelOpen = false;
    panelDrafts = null;
    panelTable = null;
    panelSample = null;
    panelCols = null;
    if (panelMask) { panelMask.remove(); panelMask = null; }
    deps.updateBar(); // 恢复主工具栏按钮
  }

  /** 某表被取消选中：草稿同步删除；面板正在编辑该表则直接关闭 */
  function onTableRemoved(table) {
    if (panelDrafts) panelDrafts.delete(table);
    if (panelOpen && table === panelTable) closeSplitPanel();
  }

  /** 退出选择模式时清面板状态（面板 DOM 随主 UI 的 host 一并移除，此处只清引用） */
  function resetPanel() {
    panelOpen = false;
    panelDrafts = null;
    panelTable = null;
    panelSample = null;
    panelCols = null;
    panelMask = null;
  }

  /** 主 UI 装配依赖接口（main.js 在 buildUI 后调用一次） */
  function initPanel(d) {
    deps = d;
  }

  ns.panel = {
    init: initPanel,
    open: openSplitPanel,
    close: closeSplitPanel,
    save: saveSplitPanel,
    isOpen: () => panelOpen,
    onTableRemoved: onTableRemoved,
    reset: resetPanel
  };
})();
