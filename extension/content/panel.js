/**
 * 列设置面板（Shadow DOM 内）：导出列筛选（含拆分新列）+ 三种拆分模式
 * （control/block/delimiter）、智能预填、前 3 行实时预览、硬校验；
 * 保存时草稿回写主 UI 内存 Map，并经 persist 模块落盘（跨会话恢复）
 * 依赖：主 UI 经 init() 注入 { host, selected, snapshots, splitRules,
 *   colFilters, isBusy, isAlive, updateBar, setHint, resetHint }（main.js 最后装配）；
 *   算法层经 __h2x 命名空间（util/table/split/persist）
 */
(() => {
  'use strict';
  const ns = window.__h2x;
  const { escapeHtml } = ns.util;
  const { extractTable, makeSheetName } = ns.table;
  const { splitSegments, splitColName, colKeys, ctrlCountOf, ctrlColNames } = ns.split;

  let deps = null; // 主 UI 注入的依赖接口（init 后可用）

  // 分隔符探测候选（优先级从高到低；空格最模糊放最后）
  const DELIM_CANDIDATES = ['、', ',', ':', ' '];
  const SPACE_MARK = '␣'; // 空格分隔符在输入框中的可见标记（空格本身不可见）

  let panelOpen = false;    // 列设置面板打开中（Esc 只关面板，主工具栏导出/取消禁用）
  let panelMask = null;
  let panelTable = null;    // 当前编辑的表格
  let panelSample = null;   // 当前表格取样通道 { aoa|rows, ctrl, text, headerRows, merges }
  let panelCols = null;     // 当前表格列信息 [{ name, hasCtrl }]
  let panelDrafts = null;   // Map: table -> { draft: [{checked,mode,pattern,limit,export,skipSegs}|null], cols, keys }

  // 段数上限解析：空/非法 → null（不限）；合法为 ≥2 的整数
  function parseLimit(s) {
    const n = parseInt(s, 10);
    return Number.isFinite(n) && n >= 2 ? n : null;
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

  /** 智能预填：多块文本列默认勾选拆分并预设 block（按换行拆）；含控件列预设
   *  control 但不勾选（由用户确认）；其余纯文本列探测分隔符预填（默认不勾选）。
   *  导出勾选默认全选（export: true），子列排除集默认为空 */
  function prefillDrafts(cols) {
    return cols.map(col => {
      const base = { export: true, skipSegs: new Set() };
      if (col.multiBlock) return Object.assign(base, { checked: true, mode: 'block', pattern: '', limit: '' });
      if (col.hasCtrl) return Object.assign(base, { checked: false, mode: 'control', pattern: col.delim, limit: '' });
      return Object.assign(base, { checked: false, mode: 'delimiter', pattern: col.delim, limit: '' });
    });
  }

  /** 已保存规则与列筛选 → 面板草稿（未配置的列回落到智能预填）
   *  keys：colKeys(sample) 的列标识数组；excluded：已保存的导出排除集 */
  function draftFromSaved(saved, cols, keys, excluded) {
    const draft = prefillDrafts(cols);
    if (excluded) {
      draft.forEach((d, c) => {
        if (excluded.has(keys[c])) d.export = false;
        const pre = String(keys[c]) + '#';
        for (const k of excluded) {
          if (typeof k === 'string' && k.indexOf(pre) === 0) {
            const n = parseInt(k.slice(pre.length), 10);
            if (n >= 1) d.skipSegs.add(n);
          }
        }
      });
    }
    if (!saved) return draft;
    for (const rule of saved) {
      let c = -1;
      for (let i = 0; i < cols.length; i++) {
        if (keys[i] === rule.col) { c = i; break; }
      }
      if (c < 0) continue;
      Object.assign(draft[c], {
        checked: true, mode: rule.mode,
        pattern: rule.pattern || '', limit: rule.limit == null ? '' : String(rule.limit)
      });
    }
    return draft;
  }

  function sampleChannels(table) {
    if (deps.snapshots.has(table)) return deps.snapshots.get(table); // 虚拟表用已采集快照
    return extractTable(table); // 普通表现跑 extractTable 取样
  }

  /** 拆分新列数（与导出/预览逻辑一致：control = 最大控件数 + 1 文本列，同格
   *  多控件各成一列；其余取数据行最大段数）。
   *  entry：面板草稿条目 { sample, cols, ... }（多表草稿保存时逐表取基准） */
  function segCountOf(entry, c, d) {
    if (d.mode === 'control') {
      const sample = entry.sample;
      return ctrlCountOf(sample.aoa || sample.rows, sample.ctrl || [], c, sample.headerRows || 0) + 1;
    }
    const sample = entry.sample;
    const aoa = sample.aoa || sample.rows;
    const headerRows = sample.headerRows || 0;
    const blocksCh = sample.blocks || [];
    let n = 1;
    for (let r = headerRows; r < aoa.length; r++) {
      const parts = splitSegments(d.mode, (aoa[r] || [])[c], (blocksCh[r] || [])[c], d.pattern, parseLimit(d.limit));
      if (parts.length > n) n = parts.length;
    }
    return n;
  }

  /** 拆分新列显示名（与导出列名规则一致；无表头时导出不写列名，此处用「段k」作 UI 标签） */
  function segNames(entry, c, d) {
    const raw = (entry.cols[c] && entry.cols[c].name) || '';
    if (d.mode === 'control') {
      const base = raw || ('列' + (c + 1));
      return entry.sample.headerRows ? ctrlColNames(base, segCountOf(entry, c, d) - 1)
        : Array.from({ length: segCountOf(entry, c, d) }, (_, k) => '段' + (k + 1));
    }
    const n = segCountOf(entry, c, d);
    return Array.from({ length: n }, (_, k) =>
      (entry.sample.headerRows ? splitColName(raw, k) : '段' + (k + 1)));
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
      '  .h2x-tools{display:flex;align-items:center;gap:8px;padding:6px 10px;background:#fafbfc;color:#666;font-size:12px;border-bottom:1px solid #e0e0e0;position:sticky;top:0;z-index:1;}',
      '  .h2x-tools b{color:#2e7d32;}',
      '  .h2x-mini{padding:2px 10px;border:1px solid #ccc;border-radius:4px;background:#fff;cursor:pointer;font:12px/1.4 -apple-system,"Segoe UI",sans-serif;color:#333;}',
      '  .h2x-mini:hover{border-color:#2e7d32;color:#2e7d32;}',
      '  .h2x-col-head{display:flex;gap:8px;align-items:center;padding:7px 10px;background:#f5f7fa;color:#666;font-size:12px;border-bottom:1px solid #e0e0e0;}',
      '  .h2x-col{display:flex;gap:8px;align-items:center;padding:6px 10px;border-bottom:1px solid #f0f0f0;background:#fff;}',
      '  .h2x-col.off .h2x-mode,.h2x-col.off .h2x-pattern,.h2x-col.off .h2x-limit{opacity:.45;pointer-events:none;}',
      '  .h2x-col.noexp .h2x-cname{color:#bbb;}',
      '  .h2x-h1{width:34px;flex:none;text-align:center;}',
      '  .h2x-h2{flex:2;min-width:0;}',
      '  .h2x-h3{width:34px;flex:none;text-align:center;}',
      '  .h2x-h4{flex:1.4;min-width:0;}',
      '  .h2x-h5{flex:1.6;min-width:0;}',
      '  .h2x-h6{flex:0.9;min-width:0;}',
      '  .h2x-ckw{width:34px;flex:none;display:flex;justify-content:center;}',
      '  .h2x-cname{flex:2;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;}',
      '  .h2x-tag{display:inline-block;background:#e3f2fd;color:#1565c0;border-radius:8px;padding:0 6px;font-size:11px;font-weight:400;font-style:normal;margin-left:4px;}',
      '  .h2x-mode{flex:1.4;min-width:0;}',
      '  .h2x-pattern{flex:1.6;min-width:0;}',
      '  .h2x-limit{flex:0.9;min-width:0;}',
      '  .h2x-sub{display:flex;flex-wrap:wrap;gap:4px 14px;padding:6px 10px 6px 44px;background:#f8fbf8;border-bottom:1px solid #f0f0f0;font-size:12px;color:#555;}',
      '  .h2x-sub .h2x-sub-label{color:#999;}',
      '  .h2x-sub label{display:flex;align-items:center;gap:4px;cursor:pointer;}',
      '  .h2x-sub label.noexp{color:#bbb;text-decoration:line-through;}',
      '  .h2x-pv{border:1px solid #e0e0e0;border-radius:8px;padding:10px;margin-bottom:12px;overflow:auto;}',
      '  .h2x-pv-title{font-size:12px;color:#666;margin-bottom:6px;}',
      '  .h2x-pv table{border-collapse:collapse;font-size:12px;}',
      '  .h2x-pv th,.h2x-pv td{border:1px solid #ddd;padding:4px 10px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '  .h2x-pv th{background:#f0f4f8;font-weight:600;}',
      '  .h2x-pv td.old{color:#999;background:#fafafa;}',
      '  .h2x-pv th.new{color:#2e7d32;}',
      '  .h2x-pv th.drop,.h2x-pv td.drop{text-decoration:line-through;color:#bbb;}',
      '  .h2x-panel-foot{display:flex;align-items:center;gap:10px;}',
      '  .h2x-err{color:#c62828;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '</style>',
      '<div class="h2x-panel">',
      '  <h3>列设置</h3>',
      '  <div class="h2x-panel-head">表格：<select class="h2x-tsel"></select></div>',
      '  <div class="h2x-note" hidden></div>',
      '  <div class="h2x-cols"></div>',
      '  <div class="h2x-pv"><div class="h2x-pv-title">前 3 行预览（划线列为不导出）</div><div class="h2x-pv-body"></div></div>',
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
    colsBox.addEventListener('click', onColClick); // 全选/全不选快捷按钮
  }

  function switchPanelTable(table) {
    if (!table || !deps.selected.has(table)) return;
    panelTable = table;
    let entry = panelDrafts.get(table);
    if (entry) {
      panelCols = entry.cols;   // 草稿的列索引基准
      panelSample = entry.sample; // 与草稿同基准（避免重复取样，也保证多表草稿一致性）
    } else {
      panelSample = sampleChannels(table);
      panelCols = buildPanelCols(panelSample);
      const keys = colKeys(panelSample); // 列标识（拆分规则与列筛选共用的定位基准）
      entry = {
        draft: draftFromSaved(deps.splitRules.get(table), panelCols, keys, deps.colFilters.get(table)),
        cols: panelCols, keys: keys, sample: panelSample
      };
      panelDrafts.set(table, entry);
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
    if (hasMerges) note.textContent = '该表格含合并单元格，拆分与列筛选不可用（导出保持原样）';
    renderColList();
    renderPreview();
  }

  /** 拆分子行 HTML：勾选拆分的列展示各新列的导出勾选（段名与导出列名一致） */
  function subHtmlOf(entry, c, d) {
    let html = '<div class="h2x-sub" data-c="' + c + '"><span class="h2x-sub-label">新列：</span>';
    segNames(entry, c, d).forEach((name, k) => {
      const on = !d.skipSegs.has(k + 1);
      html += '<label' + (on ? '' : ' class="noexp"') + '><input type="checkbox" class="h2x-ck-s" data-k="' +
        (k + 1) + '"' + (on ? ' checked' : '') + '>' + escapeHtml(name) + '</label>';
    });
    return html + '</div>';
  }

  /** 拆分子行同步：勾选/模式/分隔符/上限变化后刷新该列子行（只动子行，主行焦点不丢） */
  function syncSubRow(entry, c, d, row) {
    const old = panelMask.querySelector('.h2x-sub[data-c="' + c + '"]');
    const tmp = document.createElement('div');
    if (d.checked && !panelHasMerges()) {
      tmp.innerHTML = subHtmlOf(entry, c, d);
      if (old) old.replaceWith(tmp.firstChild);
      else row.after(tmp.firstChild);
    } else if (old) {
      old.remove();
    }
  }

  /** 导出列计数：已选/全部（原列 + 拆分新列都计入） */
  function updateTools() {
    const entry = panelDrafts.get(panelTable);
    if (!entry) return;
    let kept = 0, total = 0;
    entry.draft.forEach((d, c) => {
      const n = d.checked ? segNames(entry, c, d).length : 0;
      total += 1 + n;
      if (d.export) kept++;
      for (let k = 1; k <= n; k++) if (!d.skipSegs.has(k)) kept++;
    });
    const el = panelMask.querySelector('.h2x-exp-n');
    if (el) el.textContent = kept + '/' + total;
  }

  function renderColList() {
    const entry = panelDrafts.get(panelTable);
    const draft = entry.draft;
    const hasMerges = panelHasMerges();
    let html = '<div class="h2x-tools"><span>导出列 <b class="h2x-exp-n"></b></span>' +
      '<button type="button" class="h2x-mini h2x-all"' + (hasMerges ? ' disabled' : '') + '>全选</button>' +
      '<button type="button" class="h2x-mini h2x-none"' + (hasMerges ? ' disabled' : '') + '>全不选</button></div>';
    html += '<div class="h2x-col-head"><span class="h2x-h1">导出</span><span class="h2x-h2">列</span>' +
      '<span class="h2x-h3">拆分</span><span class="h2x-h4">模式</span><span class="h2x-h5">分隔符</span><span class="h2x-h6">段数上限</span></div>';
    panelCols.forEach((col, c) => {
      const d = draft[c];
      const name = col.name || ('列' + (c + 1));
      html += '<div class="h2x-col' + (d.checked ? '' : ' off') + (d.export ? '' : ' noexp') + '" data-c="' + c + '">' +
        '<label class="h2x-ckw"><input type="checkbox" class="h2x-ck-x"' + (d.export ? ' checked' : '') + (hasMerges ? ' disabled' : '') + '></label>' +
        '<span class="h2x-cname">' + escapeHtml(name) + (col.hasCtrl ? '<i class="h2x-tag">控件</i>' : '') + (col.multiBlock ? '<i class="h2x-tag">多行</i>' : '') + '</span>' +
        '<label class="h2x-ckw"><input type="checkbox" class="h2x-ck"' + (d.checked ? ' checked' : '') + (hasMerges ? ' disabled' : '') + '></label>' +
        '<select class="h2x-mode"' + (hasMerges ? ' disabled' : '') + '>' +
        '<option value="control"' + (d.mode === 'control' ? ' selected' : '') + '>控件值拆分</option>' +
        '<option value="block"' + (d.mode === 'block' ? ' selected' : '') + '>按换行拆分</option>' +
        '<option value="delimiter"' + (d.mode === 'delimiter' ? ' selected' : '') + '>分隔符拆分</option>' +
        '</select>' +
        '<input type="text" class="h2x-pattern" placeholder="如 、 ' + SPACE_MARK + '=空格" value="' +
        escapeHtml(d.pattern === ' ' ? SPACE_MARK : d.pattern) + '"' + (lockPattern(d) ? ' disabled' : '') + '>' +
        '<input type="text" class="h2x-limit" placeholder="不限" inputmode="numeric" value="' +
        escapeHtml(d.limit) + '"' + (lockLimit(d) ? ' disabled' : '') + '>' +
        '</div>';
      if (d.checked && !hasMerges) html += subHtmlOf(entry, c, d);
    });
    panelMask.querySelector('.h2x-cols').innerHTML = html;
    updateTools();
  }

  // 从列行事件解析草稿项：{ row, c, d } 或 null（面板未开 / 目标不在列行上）
  function draftAt(e) {
    if (!panelOpen) return null;
    const row = e.target.closest('.h2x-col');
    if (!row) return null;
    const c = parseInt(row.dataset.c, 10);
    return { row: row, c: c, d: panelDrafts.get(panelTable).draft[c] };
  }

  function onColChange(e) {
    // 拆分子列的导出勾选（位于 .h2x-sub 子行内，不在 .h2x-col 上）
    if (e.target.classList.contains('h2x-ck-s')) {
      const sub = e.target.closest('.h2x-sub');
      if (!sub) return;
      const c = parseInt(sub.dataset.c, 10);
      const d = panelDrafts.get(panelTable).draft[c];
      const k = parseInt(e.target.dataset.k, 10);
      if (e.target.checked) d.skipSegs.delete(k); else d.skipSegs.add(k);
      e.target.closest('label').classList.toggle('noexp', !e.target.checked);
      updateTools();
      renderPreview();
      return;
    }
    const hit = draftAt(e);
    if (!hit) return;
    const { row, c, d } = hit;
    if (e.target.classList.contains('h2x-ck-x')) {
      d.export = e.target.checked;
      row.classList.toggle('noexp', !d.export);
    } else if (e.target.classList.contains('h2x-ck')) {
      d.checked = e.target.checked;
      row.classList.toggle('off', !d.checked);
      syncSubRow(panelDrafts.get(panelTable), c, d, row);
    } else if (e.target.classList.contains('h2x-mode')) {
      d.mode = e.target.value;
      syncSubRow(panelDrafts.get(panelTable), c, d, row); // 段名/段数随模式变化
    }
    row.querySelector('.h2x-pattern').disabled = lockPattern(d);
    row.querySelector('.h2x-limit').disabled = lockLimit(d);
    updateTools();
    renderPreview();
  }

  function onColInput(e) {
    if (!(e.target instanceof HTMLInputElement)) return;
    const hit = draftAt(e);
    if (!hit) return;
    const { row, c, d } = hit;
    if (e.target.classList.contains('h2x-pattern')) {
      d.pattern = e.target.value === SPACE_MARK ? ' ' : e.target.value;
    } else if (e.target.classList.contains('h2x-limit')) {
      d.limit = e.target.value.replace(/[^\d]/g, '');
    } else {
      return;
    }
    // 分隔符/上限影响段数 → 刷新子行（只重建子行，输入焦点不丢）
    syncSubRow(panelDrafts.get(panelTable), c, d, row);
    updateTools();
    renderPreview();
  }

  // 全选/全不选快捷按钮（作用于当前表格的全部列与拆分子列）
  function onColClick(e) {
    if (!panelOpen || panelHasMerges()) return;
    const btn = e.target.closest('.h2x-mini');
    if (!btn) return;
    const entry = panelDrafts.get(panelTable);
    const all = btn.classList.contains('h2x-all');
    entry.draft.forEach((d, c) => {
      d.export = all;
      if (all) {
        d.skipSegs.clear();
      } else {
        const n = d.checked ? segNames(entry, c, d).length : 0;
        for (let k = 1; k <= n; k++) d.skipSegs.add(k);
      }
    });
    renderColList(); // 批量状态变化，整表重渲染
    renderPreview();
  }

  function renderPreview() {
    const body = panelMask.querySelector('.h2x-pv-body');
    const sample = panelSample;
    const aoa = sample.aoa || sample.rows;
    const headerRows = sample.headerRows || 0;
    if (panelHasMerges()) {
      body.innerHTML = '<span style="color:#999">该表格含合并单元格，不可拆分与筛选</span>';
      return;
    }
    const entry = panelDrafts.get(panelTable);
    const draft = entry.draft;
    const actives = [];
    draft.forEach((d, c) => { if (d && d.checked) actives.push({ c: c, d: d }); });
    if (!actives.length || aoa.length <= headerRows) {
      body.innerHTML = '<span style="color:#999">勾选列并选择模式后，此处显示前 3 行数据的拆分与导出效果</span>';
      return;
    }
    const ctrl = sample.ctrl || [];
    const text = sample.text || [];
    const blocksCh = sample.blocks || [];
    // 段值与列名与导出共用 splitSegments / splitColName，保证预览即所得
    const partsOf = (r, c, d) => splitSegments(
      d.mode, (aoa[r] || [])[c], (blocksCh[r] || [])[c], d.pattern, parseLimit(d.limit));
    let html = '<table><tr>';
    actives.forEach(({ c, d }) => {
      const raw = (panelCols[c] && panelCols[c].name) || '';
      const name = raw || ('列' + (c + 1));
      const dropSrc = d.export ? '' : ' drop';
      html += '<th' + (dropSrc ? ' class="drop"' : '') + '>原列 ' + escapeHtml(name) + '</th>';
      segNames(entry, c, d).forEach((segName, k) => {
        html += '<th class="new' + (d.skipSegs.has(k + 1) ? ' drop' : '') + '">' + escapeHtml(segName) + '</th>';
      });
    });
    html += '</tr>';
    for (let r = headerRows; r < Math.min(aoa.length, headerRows + 3); r++) {
      html += '<tr>';
      actives.forEach(({ c, d }) => {
        const before = (aoa[r] || [])[c];
        const dropSrc = d.export ? '' : ' drop';
        html += '<td class="old' + dropSrc + '">' + escapeHtml(before == null ? '' : String(before)) + '</td>';
        if (d.mode === 'control') {
          // ctrl 通道为按位控件值数组：多控件各成一列（短行补空）+ 末尾文本列
          const n = segCountOf(entry, c, d) - 1;
          const cv = ctrl[r] ? ctrl[r][c] : null;
          const vals = Array.isArray(cv) ? cv.slice() : [];
          while (vals.length < n) vals.push('');
          for (let k = 0; k < n; k++) {
            html += '<td' + (d.skipSegs.has(k + 1) ? ' class="drop"' : '') + '>' +
              escapeHtml(vals[k] == null ? '' : String(vals[k])) + '</td>';
          }
          const tv = text[r] ? text[r][c] : null;
          html += '<td' + (d.skipSegs.has(n + 1) ? ' class="drop"' : '') + '>' +
            escapeHtml(tv == null ? '' : String(tv)) + '</td>';
        } else {
          const n = segCountOf(entry, c, d);
          const parts = partsOf(r, c, d);
          while (parts.length < n) parts.push('');
          for (let k = 0; k < n; k++) {
            html += '<td' + (d.skipSegs.has(k + 1) ? ' class="drop"' : '') + '>' + escapeHtml(parts[k]) + '</td>';
          }
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
    // 硬校验：分隔符非空；段数上限为空（不限）或 ≥2 的整数；至少保留一个导出列
    let ti = 0;
    for (const entry of panelDrafts.values()) {
      ti++;
      const { draft, cols } = entry;
      for (let c = 0; c < draft.length; c++) {
        const d = draft[c];
        if (!d || !d.checked) continue;
        const label = (cols[c] && cols[c].name) || ('列' + (c + 1));
        if (d.mode === 'delimiter' && !d.pattern) {
          errEl.textContent = '表格' + ti + '：「' + label + '」的分隔符不能为空（' + SPACE_MARK + ' 表示空格）';
          return;
        }
        if (d.limit !== '' && parseLimit(d.limit) == null) {
          errEl.textContent = '表格' + ti + '：「' + label + '」的段数上限须为空（不限）或不小于 2 的整数';
          return;
        }
      }
      let kept = 0;
      draft.forEach((d, c) => {
        if (!d) return;
        if (d.export) kept++;
        const n = d.checked ? segCountOf(entry, c, d) : 0;
        for (let k = 1; k <= n; k++) if (!d.skipSegs.has(k)) kept++;
      });
      if (kept === 0) {
        errEl.textContent = '表格' + ti + '：至少保留一个导出列';
        return;
      }
    }
    for (const [table, entry] of panelDrafts) {
      const { draft, keys } = entry;
      const rules = [];
      const excluded = new Set(); // 导出列排除集（原列 key / 拆分新列 key#k）
      draft.forEach((d, c) => {
        if (!d) return;
        if (d.checked) {
          rules.push({ col: keys[c], mode: d.mode, pattern: d.pattern || '', limit: parseLimit(d.limit) });
        }
        if (!d.export) excluded.add(keys[c]);
        const n = d.checked ? segCountOf(entry, c, d) : 0;
        for (let k = 1; k <= n; k++) {
          if (d.skipSegs.has(k)) excluded.add(keys[c] + '#' + k);
        }
      });
      if (rules.length) deps.splitRules.set(table, rules);
      else deps.splitRules.delete(table);
      if (excluded.size) deps.colFilters.set(table, excluded);
      else deps.colFilters.delete(table);
      ns.persist.save(table, rules, excluded); // 持久化：均空时删除记录（即重置路径）
    }
    closeSplitPanel();
    deps.setHint('列设置已保存并记住，导出时生效', '#2e7d32');
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
