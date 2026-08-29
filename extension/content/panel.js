/**
 * 列设置面板（Shadow DOM 内）：导出列筛选（含拆分新列）+ 三种拆分模式
 * （control/block/delimiter）+ 列格式（文本/数字，作用于该列及其拆分新列）、
 * 智能预填、最终输出全列预览、校验错误就地标红；
 * v2.0 面板重构：列行 7 控件收敛为 4 元素折叠式（拆分配置收进展开子行，
 * 模式/分隔符/上限键入时只局部刷新新列勾选区，焦点不丢）、多表下拉改页签
 * （含已配置状态点）、校验错误就地标红 + 滚动定位、focus trap + role="dialog"。
 * 保存时草稿回写主 UI 内存 Map，并经 persist 模块落盘（跨会话恢复）。
 * 依赖：主 UI 经 init() 注入 { host, selected, snapshots, splitRules,
 *   colFilters, colFormats, isBusy, isAlive, updateBar, toast }（main.js 最后装配）；
 *   算法层经 __h2x 命名空间（util/table/split/persist）
 */
(() => {
  'use strict';
  const ns = window.__h2x;
  const { escapeHtml } = ns.util;
  const { extractTable, makeSheetName } = ns.table;
  const { splitSegments, splitColName, colKeys, ctrlCountOf, ctrlColNames, toNumValue } = ns.split;

  let deps = null; // 主 UI 注入的依赖接口（init 后可用）

  // 分隔符探测候选（优先级从高到低；空格最模糊放最后）
  const DELIM_CANDIDATES = ['、', ',', ':', ' '];
  const SPACE_MARK = '␣'; // 空格分隔符在输入框中的可见标记（空格本身不可见）
  // focus trap 可聚焦控件（面板内 Tab 圈定用；disabled 已过滤，面板无 hidden 控件区）
  const FOCUSABLE_SEL = 'button:not(:disabled),select:not(:disabled),input:not(:disabled)';

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
   *  导出勾选默认全选（export: true），子列排除集默认为空，列格式默认文本 */
  function prefillDrafts(cols) {
    return cols.map(col => {
      const base = { export: true, skipSegs: new Set(), fmt: 'text' };
      if (col.multiBlock) return Object.assign(base, { checked: true, mode: 'block', pattern: '', limit: '' });
      if (col.hasCtrl) return Object.assign(base, { checked: false, mode: 'control', pattern: col.delim, limit: '' });
      return Object.assign(base, { checked: false, mode: 'delimiter', pattern: col.delim, limit: '' });
    });
  }

  /** 已保存规则与列筛选 → 面板草稿（未配置的列回落到智能预填）
   *  keys：colKeys(sample) 的列标识数组；excluded：已保存的导出排除集；
   *  fmts：已保存的列格式 Map<colKey, 'number'>（文本为默认，无需保存） */
  function draftFromSaved(saved, cols, keys, excluded, fmts) {
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
    if (fmts) draft.forEach((d, c) => { if (fmts.get(keys[c]) === 'number') d.fmt = 'number'; });
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
   *  entry：面板草稿条目 { sample, cols, ... }（多表草稿保存时逐表取基准）。
   *  结果按 (列, 模式, 分隔符, 上限) 记忆化于 entry.segCache：面板每次勾选/
   *  键入都触发全列全行重扫，万行虚拟快照下交互会明显卡顿；sample 在面板
   *  生命周期内不变，缓存键即全部输入，无需失效 */
  function segCountOf(entry, c, d) {
    const lim = parseLimit(d.limit);
    const key = c + '\x01' + d.mode + '\x01' + d.pattern + '\x01' + (lim == null ? '' : lim);
    const cache = entry.segCache || (entry.segCache = new Map());
    if (cache.has(key)) return cache.get(key);
    const sample = entry.sample;
    const aoa = sample.aoa || sample.rows;
    let n;
    if (d.mode === 'control') {
      n = ctrlCountOf(aoa, sample.ctrl || [], c, sample.headerRows || 0) + 1;
    } else {
      const headerRows = sample.headerRows || 0;
      const blocksCh = sample.blocks || [];
      n = 1;
      for (let r = headerRows; r < aoa.length; r++) {
        const parts = splitSegments(d.mode, (aoa[r] || [])[c], (blocksCh[r] || [])[c], d.pattern, lim);
        if (parts.length > n) n = parts.length;
      }
    }
    cache.set(key, n);
    return n;
  }

  /** 拆分新列显示名（与导出列名规则一致；无表头时导出不写列名，此处用「段k」作 UI 标签） */
  function segNames(entry, c, d) {
    const raw = (entry.cols[c] && entry.cols[c].name) || '';
    const n = segCountOf(entry, c, d);
    if (d.mode === 'control') {
      const base = raw || ('列' + (c + 1));
      return entry.sample.headerRows ? ctrlColNames(base, n - 1)
        : Array.from({ length: n }, (_, k) => '段' + (k + 1));
    }
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

  /** 拆分按钮 title：智能预填建议（探测依据 buildPanelCols 的 delim/multiBlock/hasCtrl） */
  function splitHint(col) {
    if (col.multiBlock) return '建议：按换行拆分（该列多为多行文本）';
    if (col.hasCtrl) return '建议：控件值拆分（该列含表单控件）';
    if (col.delim) return '建议：按「' + (col.delim === ' ' ? '空格' : col.delim) + '」分隔符拆分';
    return '拆分为多列（控件值 / 换行 / 分隔符）';
  }

  function openSplitPanel() {
    if (panelOpen || deps.isBusy() || !deps.selected.size) return;
    panelOpen = true;
    panelDrafts = new Map();
    deps.updateBar(); // 主工具栏导出/取消/拆分列同步禁用
    buildPanelDOM();
    switchPanelTable(deps.selected.keys().next().value);
    // v2.0：打开即聚焦首个控件（键盘可达；Tab 圈定面板内）
    // 多表聚焦首个页签；单表页签区隐藏（hidden 内 focus 无效），回落首个列勾选框
    const tabsEl = panelMask.querySelector('.h2x-tabs');
    const focusTarget = (!tabsEl.hidden && tabsEl.querySelector('.h2x-tab')) ||
      panelMask.querySelector('.h2x-cols ' + FOCUSABLE_SEL);
    if (focusTarget) focusTarget.focus();
  }

  function buildPanelDOM() {
    panelMask = document.createElement('div');
    panelMask.className = 'h2x-mask';
    panelMask.setAttribute('role', 'dialog');
    panelMask.setAttribute('aria-modal', 'true');
    panelMask.setAttribute('aria-label', '列设置');
    panelMask.innerHTML = [
      // 面板专属样式随面板自持；颜色/圆角复用主 UI :host 设计 token（同一
      // shadowRoot 共享，深色模式经 main.js 的 prefers 覆写自动生效）；
      // 按钮样式（h2x-btn/primary/ghost）由主 UI的 <style> 提供
      '<style>',
      '  .h2x-mask{position:fixed;inset:0;pointer-events:auto;background:rgba(0,0,0,.28);display:flex;align-items:center;justify-content:center;z-index:1;animation:h2x-fade .15s ease-out;}',
      '  .h2x-panel{background:var(--c-bg);color:var(--c-text);border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.3);width:min(900px,95vw);max-height:86vh;overflow:auto;padding:18px 20px 16px;box-sizing:border-box;font:13px/1.5 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif;animation:h2x-pop .15s ease-out;}',
      '  .h2x-panel-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;}',
      '  .h2x-panel-top h3{margin:0;font-size:15px;font-weight:600;}',
      '  .h2x-px{border:none;background:none;color:var(--c-text-3);cursor:pointer;font:18px/1 -apple-system,"Segoe UI",sans-serif;padding:2px 6px;border-radius:4px;}',
      '  .h2x-px:hover{color:var(--c-text);}',
      '  .h2x-tabs{display:flex;gap:6px;overflow-x:auto;margin-bottom:10px;padding-bottom:2px;scrollbar-width:thin;}',
      '  .h2x-tab{flex:none;display:inline-flex;align-items:center;gap:6px;max-width:240px;padding:5px 12px;border:1px solid var(--c-border);border-radius:999px;background:var(--c-bg);color:var(--c-text-2);cursor:pointer;font:12px/1.4 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif;}',
      '  .h2x-tab span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '  .h2x-tab:hover{border-color:var(--c-primary);color:var(--c-primary);}',
      '  .h2x-tab.h2x-tab-on{border-color:var(--c-primary);color:var(--c-primary);background:var(--c-bg-2);font-weight:600;}',
      '  .h2x-tab-dot{width:6px;height:6px;flex:none;border-radius:50%;background:var(--c-info);}',
      '  .h2x-tab-dot.h2x-off{opacity:0;}',  /* 未配置：占位不显点，页签宽度稳定 */
      '  .h2x-note{background:rgba(141,110,0,.12);color:var(--c-warn);border-radius:var(--r-s);padding:6px 10px;margin-bottom:10px;}',
      '  @media (prefers-color-scheme: dark){.h2x-note{background:rgba(255,213,79,.14);}}',
      '  .h2x-cols{border:1px solid var(--c-border-2);border-radius:var(--r);margin-bottom:12px;max-height:38vh;overflow-y:auto;}',
      '  .h2x-cols select,.h2x-cols input{padding:4px 8px;border:1px solid var(--c-border);border-radius:var(--r-s);font:12px/1.4 -apple-system,"Segoe UI",sans-serif;color:var(--c-text);box-sizing:border-box;background:var(--c-input);min-width:0;}',
      '  .h2x-cols select:focus,.h2x-cols input:focus{border-color:var(--c-primary);outline:none;}',
      '  .h2x-tools{display:flex;align-items:center;gap:8px;padding:6px 10px;background:var(--c-bg-3);color:var(--c-text-2);font-size:12px;border-bottom:1px solid var(--c-border-2);position:sticky;top:0;z-index:1;}',
      '  .h2x-tools b{color:var(--c-primary);}',
      '  .h2x-mini{padding:2px 10px;border:1px solid var(--c-border);border-radius:4px;background:var(--c-bg);cursor:pointer;font:12px/1.4 -apple-system,"Segoe UI",sans-serif;color:var(--c-text);}',
      '  .h2x-mini:hover:not(:disabled){border-color:var(--c-primary);color:var(--c-primary);}',
      '  .h2x-mini:disabled{color:var(--c-disable-fg);cursor:not-allowed;}',
      '  .h2x-col-head{display:flex;gap:8px;align-items:center;padding:7px 10px;background:var(--c-bg-2);color:var(--c-text-2);font-size:12px;border-bottom:1px solid var(--c-border-2);}',
      '  .h2x-h1{width:34px;flex:none;text-align:center;}',
      '  .h2x-h2{flex:1;min-width:0;}',
      '  .h2x-h3{width:86px;flex:none;box-sizing:border-box;}',
      '  .h2x-h4{width:92px;flex:none;text-align:center;}',
      '  .h2x-col{display:flex;gap:8px;align-items:center;padding:6px 10px;border-bottom:1px solid var(--c-border-2);background:var(--c-bg);}',
      '  .h2x-col.noexp .h2x-cname{color:var(--c-text-3);}',
      '  .h2x-ckw{width:34px;flex:none;display:flex;justify-content:center;}',
      '  .h2x-cname{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;}',
      '  .h2x-tag{display:inline-block;background:rgba(25,118,210,.12);color:var(--c-info);border-radius:8px;padding:0 6px;font-size:11px;font-weight:400;font-style:normal;margin-left:4px;}',
      '  @media (prefers-color-scheme: dark){.h2x-tag{background:rgba(100,181,246,.18);}}',
      '  .h2x-fmt{width:86px;flex:none;}',
      '  .h2x-sbtn{width:92px;flex:none;padding:4px 0;border:1px solid var(--c-border);border-radius:var(--r-s);background:var(--c-bg);color:var(--c-text-2);cursor:pointer;font:12px/1.4 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif;box-sizing:border-box;}',
      '  .h2x-sbtn:hover:not(:disabled){border-color:var(--c-primary);color:var(--c-primary);}',
      '  .h2x-sbtn:disabled{color:var(--c-disable-fg);cursor:not-allowed;}',
      '  .h2x-sbtn.h2x-on{border-color:var(--c-primary);color:var(--c-primary);background:var(--c-bg-2);}',
      '  .h2x-sub{padding:8px 10px 8px 52px;background:var(--c-bg-2);border-bottom:1px solid var(--c-border-2);}',
      '  .h2x-sub-cfg{display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center;}',
      '  .h2x-sub-cfg label{display:flex;align-items:center;gap:5px;color:var(--c-text-2);font-size:12px;}',
      '  .h2x-sub-cols{display:flex;flex-wrap:wrap;gap:4px 14px;margin-top:6px;font-size:12px;color:var(--c-text-2);}',
      '  .h2x-sub-cols label{display:flex;align-items:center;gap:4px;cursor:pointer;}',
      '  .h2x-sub-cols label.noexp{color:var(--c-text-3);text-decoration:line-through;}',
      '  .h2x-invalid{border-color:var(--c-danger)!important;box-shadow:0 0 0 1px var(--c-danger);}',  /* 校验错误就地标红 */
      '  .h2x-pv{border:1px solid var(--c-border-2);border-radius:var(--r);padding:10px;margin-bottom:12px;overflow:auto;}',
      '  .h2x-pv-title{font-size:12px;color:var(--c-text-2);margin-bottom:6px;}',
      '  .h2x-pv table{border-collapse:collapse;font-size:12px;}',
      '  .h2x-pv th,.h2x-pv td{border:1px solid var(--c-border);padding:4px 10px;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '  .h2x-pv th{background:var(--c-bg-2);font-weight:600;}',
      '  .h2x-pv th.new{color:var(--c-primary);}',
      '  .h2x-pv th.drop,.h2x-pv td.drop{text-decoration:line-through;color:var(--c-text-3);}',
      '  .h2x-pv-empty{color:var(--c-text-3);}',
      '  .h2x-pv-note{font-size:12px;color:var(--c-text-3);margin-top:6px;}',
      '  .h2x-panel-foot{display:flex;align-items:center;gap:10px;}',
      '  .h2x-err{color:var(--c-danger);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '  @keyframes h2x-fade{from{opacity:0;}}',
      '  @keyframes h2x-pop{from{opacity:0;transform:scale(.98);}}',
      '</style>',
      '<div class="h2x-panel">',
      '  <div class="h2x-panel-top">',
      '    <h3>列设置</h3>',
      '    <button type="button" class="h2x-px" aria-label="关闭" title="关闭面板">×</button>',
      '  </div>',
      '  <div class="h2x-tabs" role="tablist"></div>',
      '  <div class="h2x-note" hidden></div>',
      '  <div class="h2x-cols"></div>',
      '  <div class="h2x-pv"><div class="h2x-pv-title">导出预览（绿色为拆分新列，划线列为不导出）</div><div class="h2x-pv-body"></div><div class="h2x-pv-note"></div></div>',
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
    panelMask.querySelector('.h2x-px').addEventListener('click', closeSplitPanel);
    // 页签切表（v2.0：下拉改页签，含已配置状态点）
    const tabs = panelMask.querySelector('.h2x-tabs');
    tabs.addEventListener('click', (e) => {
      const tab = e.target.closest('.h2x-tab');
      if (!tab) return;
      const idx = parseInt(tab.dataset.i, 10);
      const tables = [...deps.selected.keys()];
      if (idx >= 0 && idx < tables.length && tables[idx] !== panelTable) switchPanelTable(tables[idx]);
    });
    const colsBox = panelMask.querySelector('.h2x-cols');
    colsBox.addEventListener('change', onColChange);
    colsBox.addEventListener('input', onColInput);
    colsBox.addEventListener('click', onColClick); // 拆分按钮（展开/收起）+ 全选/全不选
    panelMask.addEventListener('keydown', onPanelKeyDown); // focus trap（Tab 圈定面板内）
  }

  /** focus trap：Tab/Shift+Tab 圈定面板内（mask 已挂 role="dialog" aria-modal） */
  function onPanelKeyDown(e) {
    if (e.key !== 'Tab' || !panelOpen) return;
    const focusables = Array.from(panelMask.querySelectorAll(FOCUSABLE_SEL));
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const root = panelMask.getRootNode();
    const active = root && root.activeElement;
    if (e.shiftKey) {
      if (active === first || !panelMask.contains(active)) { e.preventDefault(); last.focus(); }
    } else {
      if (active === last || !panelMask.contains(active)) { e.preventDefault(); first.focus(); }
    }
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
        draft: draftFromSaved(deps.splitRules.get(table), panelCols, keys, deps.colFilters.get(table), deps.colFormats.get(table)),
        cols: panelCols, keys: keys, sample: panelSample
      };
      panelDrafts.set(table, entry);
    }
    // v2.0：切表清除上一表的就地错误态（标红与汇总不再适用于新表，保存时重新校验）
    clearInvalidMarks();
    const errEl = panelMask && panelMask.querySelector('.h2x-err');
    if (errEl) errEl.textContent = '';
    renderPanel();
  }

  function renderPanel() {
    renderTabs();
    const hasMerges = panelHasMerges();
    const note = panelMask.querySelector('.h2x-note');
    note.hidden = !hasMerges;
    if (hasMerges) note.textContent = '该表格含合并单元格，拆分与列筛选不可用（列格式仍可设置）';
    renderColList();
    renderPreview();
  }

  /** 页签渲染：序号 + 表名截断（title 全名）+ 已配置状态点（与主工具栏
   *  「列设置」徽标同数据源：会话内存 Map，面板保存后关闭、重开时刷新） */
  function renderTabs() {
    const tabsEl = panelMask.querySelector('.h2x-tabs');
    const used = new Set();
    let html = '';
    let i = 0;
    for (const t of deps.selected.keys()) {
      const name = makeSheetName(t, i, used);
      const cfg = deps.splitRules.has(t) || deps.colFilters.has(t) || deps.colFormats.has(t);
      html += '<button type="button" class="h2x-tab' + (t === panelTable ? ' h2x-tab-on' : '') +
        '" data-i="' + i + '" role="tab" aria-selected="' + (t === panelTable) + '" title="' + escapeHtml(name) + '">' +
        '<i class="h2x-tab-dot' + (cfg ? '' : ' h2x-off') + '" aria-hidden="true"></i><span>' +
        (i + 1) + '. ' + escapeHtml(name) + '</span></button>';
      i++;
    }
    tabsEl.innerHTML = html;
    tabsEl.hidden = deps.selected.size < 2; // 单表不占位（聚焦逻辑回落到列勾选框）
  }

  /** 拆分新列勾选区 HTML（段名与导出列名一致） */
  function subColsHtmlOf(entry, c, d) {
    let html = '<span class="h2x-sub-label">新列：</span>';
    segNames(entry, c, d).forEach((name, k) => {
      const on = !d.skipSegs.has(k + 1);
      html += '<label' + (on ? '' : ' class="noexp"') + '><input type="checkbox" class="h2x-ck-s" data-k="' +
        (k + 1) + '"' + (on ? ' checked' : '') + '>' + escapeHtml(name) + '</label>';
    });
    return html;
  }

  /** 拆分配置子行 HTML：配置区（模式/分隔符/上限，DOM 稳定不重建）+ 新列勾选区
   *  （随段数变化局部刷新，见 syncSubCols——键入时焦点在配置区输入框上不丢） */
  function subHtmlOf(entry, c, d) {
    return '<div class="h2x-sub" data-c="' + c + '"><div class="h2x-sub-cfg">' +
      '<label>模式 <select class="h2x-mode">' +
      '<option value="control"' + (d.mode === 'control' ? ' selected' : '') + '>控件值拆分</option>' +
      '<option value="block"' + (d.mode === 'block' ? ' selected' : '') + '>按换行拆分</option>' +
      '<option value="delimiter"' + (d.mode === 'delimiter' ? ' selected' : '') + '>分隔符拆分</option>' +
      '</select></label>' +
      '<label>分隔符 <input type="text" class="h2x-pattern" placeholder="如 、 ' + SPACE_MARK + '=空格" value="' +
      escapeHtml(d.pattern === ' ' ? SPACE_MARK : d.pattern) + '"' + (lockPattern(d) ? ' disabled' : '') + '></label>' +
      '<label>段数上限 <input type="text" class="h2x-limit" placeholder="不限" inputmode="numeric" value="' +
      escapeHtml(d.limit) + '"' + (lockLimit(d) ? ' disabled' : '') + '></label>' +
      '</div><div class="h2x-sub-cols">' + subColsHtmlOf(entry, c, d) + '</div></div>';
  }

  /** 新列勾选区局部刷新：模式/分隔符/上限变化后段数变化，只重建勾选区不动
   *  配置区输入框（焦点保持）；展开/收起的整行增删走 syncSubRow */
  function syncSubCols(entry, c, d) {
    const colsEl = panelMask.querySelector('.h2x-sub[data-c="' + c + '"] .h2x-sub-cols');
    if (colsEl) colsEl.innerHTML = subColsHtmlOf(entry, c, d);
  }

  /** 拆分子行增删：展开（d.checked = true）插入/替换子行；收起移除 */
  function syncSubRow(entry, c, d, row) {
    const old = panelMask.querySelector('.h2x-sub[data-c="' + c + '"]');
    if (d.checked && !panelHasMerges()) {
      const tmp = document.createElement('div');
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

  /** 主行渲染（v2.0 收敛为 4 元素）：[导出✓][列名+徽标][格式][＋拆分按钮]；
   *  拆分配置（模式/分隔符/上限/新列勾选）收进展开子行 subHtmlOf */
  function renderColList() {
    const entry = panelDrafts.get(panelTable);
    const draft = entry.draft;
    const hasMerges = panelHasMerges();
    let html = '<div class="h2x-tools"><span>导出列 <b class="h2x-exp-n"></b></span>' +
      '<button type="button" class="h2x-mini h2x-all"' + (hasMerges ? ' disabled' : '') + '>全选</button>' +
      '<button type="button" class="h2x-mini h2x-none"' + (hasMerges ? ' disabled' : '') + '>全不选</button></div>';
    html += '<div class="h2x-col-head"><span class="h2x-h1">导出</span><span class="h2x-h2">列</span>' +
      '<span class="h2x-h3">格式</span><span class="h2x-h4">拆分</span></div>';
    panelCols.forEach((col, c) => {
      const d = draft[c];
      if (!d) return;
      const name = col.name || ('列' + (c + 1));
      const sbtnTitle = hasMerges ? '含合并单元格的表格不可拆分'
        : (d.checked ? '收起并取消该列拆分' : splitHint(col));
      html += '<div class="h2x-col' + (d.export ? '' : ' noexp') + '" data-c="' + c + '">' +
        '<label class="h2x-ckw"><input type="checkbox" class="h2x-ck-x"' + (d.export ? ' checked' : '') + (hasMerges ? ' disabled' : '') + '></label>' +
        '<span class="h2x-cname">' + escapeHtml(name) + (col.hasCtrl ? '<i class="h2x-tag">控件</i>' : '') + (col.multiBlock ? '<i class="h2x-tag">多行</i>' : '') + '</span>' +
        '<select class="h2x-fmt" title="数字格式：数值化后写入 Excel（含千分位逗号会先剥离，无法解析保持原文本）；作用于该列及其拆分新列">' +
        '<option value="text"' + (d.fmt !== 'number' ? ' selected' : '') + '>文本</option>' +
        '<option value="number"' + (d.fmt === 'number' ? ' selected' : '') + '>数字</option>' +
        '</select>' +
        '<button type="button" class="h2x-sbtn' + (d.checked ? ' h2x-on' : '') + '"' +
        (hasMerges ? ' disabled' : '') + ' title="' + escapeHtml(sbtnTitle) + '">' +
        (d.checked ? '收起拆分' : '＋ 拆分') + '</button>' +
        '</div>';
      if (d.checked && !hasMerges) html += subHtmlOf(entry, c, d);
    });
    panelMask.querySelector('.h2x-cols').innerHTML = html;
    updateTools();
  }

  // 从列行/子行事件解析草稿项：{ row, c, d } 或 null（面板未开 / 目标不在列区）
  function draftAt(e) {
    if (!panelOpen) return null;
    const row = e.target.closest('.h2x-col, .h2x-sub');
    if (!row) return null;
    const c = parseInt(row.dataset.c, 10);
    return { row: row, c: c, d: panelDrafts.get(panelTable).draft[c] };
  }

  function onColChange(e) {
    // 拆分子列的导出勾选（位于 .h2x-sub-cols 内，不在 .h2x-col 主行上）
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
    const { c, d } = hit;
    const entry = panelDrafts.get(panelTable);
    if (e.target.classList.contains('h2x-ck-x')) {
      d.export = e.target.checked;
      hit.row.classList.toggle('noexp', !d.export);
    } else if (e.target.classList.contains('h2x-mode')) {
      d.mode = e.target.value;
      syncSubCols(entry, c, d); // 段名/段数随模式变化（只刷新新列勾选区，输入框不动）
    } else if (e.target.classList.contains('h2x-fmt')) {
      d.fmt = e.target.value === 'number' ? 'number' : 'text'; // 子行不变（拆分新列继承列格式）
    }
    // 模式变化影响同列分隔符/上限可用性（control 无分隔符/上限，block 无分隔符）
    const sub = panelMask.querySelector('.h2x-sub[data-c="' + c + '"]');
    if (sub) {
      const pat = sub.querySelector('.h2x-pattern');
      const lim = sub.querySelector('.h2x-limit');
      if (pat) pat.disabled = lockPattern(d);
      if (lim) lim.disabled = lockLimit(d);
    }
    updateTools();
    renderPreview();
  }

  function onColInput(e) {
    if (!(e.target instanceof HTMLInputElement)) return;
    const hit = draftAt(e);
    if (!hit) return;
    const { c, d } = hit;
    if (e.target.classList.contains('h2x-pattern')) {
      d.pattern = e.target.value === SPACE_MARK ? ' ' : e.target.value;
    } else if (e.target.classList.contains('h2x-limit')) {
      d.limit = e.target.value.replace(/[^\d]/g, '');
    } else {
      return;
    }
    e.target.classList.remove('h2x-invalid'); // v2.0：重新输入即清除该处错误标红
    // 分隔符/上限影响段数 → 局部刷新新列勾选区（配置区输入框不动，焦点不丢）
    syncSubCols(panelDrafts.get(panelTable), c, d);
    updateTools();
    renderPreview();
  }

  // 点击：拆分按钮（展开/收起该列拆分配置）+ 全选/全不选快捷按钮
  function onColClick(e) {
    // 拆分按钮：收起 = 取消拆分（与旧版「拆分✓」勾选同语义）
    const sbtn = e.target.closest('.h2x-sbtn');
    if (sbtn) {
      if (panelHasMerges()) return;
      const hit = draftAt(e);
      if (!hit) return;
      const { row, c, d } = hit;
      d.checked = !d.checked;
      sbtn.textContent = d.checked ? '收起拆分' : '＋ 拆分';
      sbtn.classList.toggle('h2x-on', d.checked);
      sbtn.title = d.checked ? '收起并取消该列拆分' : splitHint(panelCols[c]);
      syncSubRow(panelDrafts.get(panelTable), c, d, row);
      updateTools();
      renderPreview();
      return;
    }
    // 全选/全不选快捷按钮（作用于当前表格的全部列与拆分子列）
    if (!panelOpen || panelHasMerges()) return;
    const btn = e.target.closest('.h2x-mini');
    if (!btn) return;
    const entry = panelDrafts.get(panelTable);
    const all = btn.classList.contains('h2x-all');
    entry.draft.forEach((d, c) => {
      if (!d) return;
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

  /** 最终输出全列预览（v2.0）：按导出时的真实列序与列名渲染——原列 +
   *  拆分新列（applyColumnSplits 语义：原列保留、新列追加其后），未拆列也
   *  显示；新列绿色、不导出划线；数据行取前 3 行 + 尾注总行数；
   *  数字格式预览即所得（导出同规则数值化） */
  function renderPreview() {
    const body = panelMask.querySelector('.h2x-pv-body');
    const note = panelMask.querySelector('.h2x-pv-note');
    const sample = panelSample;
    const aoa = sample.aoa || sample.rows;
    const headerRows = sample.headerRows || 0;
    note.textContent = '';
    if (panelHasMerges()) {
      body.innerHTML = '<span class="h2x-pv-empty">该表格含合并单元格，不可拆分与筛选（列格式仍生效）</span>';
      return;
    }
    const entry = panelDrafts.get(panelTable);
    const draft = entry.draft;
    const ctrl = sample.ctrl || [];
    const text = sample.text || [];
    const blocksCh = sample.blocks || [];
    // 段值与列名与导出共用 splitSegments / splitColName，保证预览即所得
    const partsOf = (r, c, d) => splitSegments(
      d.mode, (aoa[r] || [])[c], (blocksCh[r] || [])[c], d.pattern, parseLimit(d.limit));
    let html = '<table><thead><tr>';
    draft.forEach((d, c) => {
      if (!d) return;
      const raw = (panelCols[c] && panelCols[c].name) || '';
      const name = raw || ('列' + (c + 1));
      html += '<th' + (d.export ? '' : ' class="drop"') + '>' + escapeHtml(name) + '</th>';
      if (!d.checked) return;
      segNames(entry, c, d).forEach((segName, k) => {
        html += '<th class="new' + (d.skipSegs.has(k + 1) ? ' drop' : '') + '">' + escapeHtml(segName) + '</th>';
      });
    });
    html += '</tr></thead><tbody>';
    const dataRows = aoa.length - headerRows;
    const rowsShown = Math.min(dataRows, 3);
    for (let r = headerRows; r < headerRows + rowsShown; r++) {
      html += '<tr>';
      draft.forEach((d, c) => {
        if (!d) return;
        // 数字格式预览即所得：数据值经 toNumValue 展示（导出同规则数值化）
        const num = (v) => (d.fmt === 'number' && v != null && v !== '' ? toNumValue(v) : v);
        const before = (aoa[r] || [])[c];
        html += '<td' + (d.export ? '' : ' class="drop"') + '>' +
          escapeHtml(before == null ? '' : String(num(before))) + '</td>';
        if (!d.checked) return;
        if (d.mode === 'control') {
          // ctrl 通道为按位控件值数组：多控件各成一列（短行补空）+ 末尾文本列
          const n = segCountOf(entry, c, d) - 1;
          const cv = ctrl[r] ? ctrl[r][c] : null;
          const vals = Array.isArray(cv) ? cv.slice() : [];
          while (vals.length < n) vals.push('');
          for (let k = 0; k < n; k++) {
            html += '<td' + (d.skipSegs.has(k + 1) ? ' class="drop"' : '') + '>' +
              escapeHtml(vals[k] == null ? '' : String(num(vals[k]))) + '</td>';
          }
          const tv = text[r] ? text[r][c] : null;
          html += '<td' + (d.skipSegs.has(n + 1) ? ' class="drop"' : '') + '>' +
            escapeHtml(tv == null ? '' : String(num(tv))) + '</td>';
        } else {
          const n = segCountOf(entry, c, d);
          const parts = partsOf(r, c, d);
          while (parts.length < n) parts.push('');
          for (let k = 0; k < n; k++) {
            html += '<td' + (d.skipSegs.has(k + 1) ? ' class="drop"' : '') + '>' + escapeHtml(String(num(parts[k]))) + '</td>';
          }
        }
      });
      html += '</tr>';
    }
    html += '</tbody></table>';
    body.innerHTML = html;
    note.textContent = dataRows > 3 ? '共 ' + dataRows + ' 行数据，预览前 3 行'
      : (dataRows > 0 ? '共 ' + dataRows + ' 行数据' : '无数据行');
  }

  /** 清除全部就地错误标红 */
  function clearInvalidMarks() {
    if (!panelMask) return;
    panelMask.querySelectorAll('.h2x-invalid').forEach(el => el.classList.remove('h2x-invalid'));
  }

  function saveSplitPanel() {
    const errEl = panelMask.querySelector('.h2x-err');
    errEl.textContent = '';
    clearInvalidMarks();
    // 硬校验：分隔符非空；段数上限为空（不限）或 ≥2 的整数；至少保留一个导出列
    const errors = []; // { table, c, field: 'pattern'|'limit' }
    let keptErr = null;
    let ti = 0;
    for (const [table, entry] of panelDrafts) {
      ti++;
      const { draft, cols } = entry;
      for (let c = 0; c < draft.length; c++) {
        const d = draft[c];
        if (!d || !d.checked) continue;
        if (d.mode === 'delimiter' && !d.pattern) {
          errors.push({ table: table, c: c, field: 'pattern' });
        }
        if (d.limit !== '' && parseLimit(d.limit) == null) {
          errors.push({ table: table, c: c, field: 'limit' });
        }
      }
      let kept = 0;
      draft.forEach((d, c) => {
        if (!d) return;
        if (d.export) kept++;
        const n = d.checked ? segCountOf(entry, c, d) : 0;
        for (let k = 1; k <= n; k++) if (!d.skipSegs.has(k)) kept++;
      });
      if (kept === 0 && !keptErr) keptErr = '表格' + ti + '：至少保留一个导出列';
    }
    if (errors.length || keptErr) {
      // v2.0 就地错误：切到首个错误所在表（跨表错误也看得见），标红对应
      // 输入框并滚动到该列；底部只留汇总计数
      const first = errors[0];
      if (first && first.table !== panelTable) switchPanelTable(first.table);
      if (first && first.table === panelTable) {
        for (const err of errors) {
          if (err.table !== panelTable) continue;
          const fieldEl = panelMask.querySelector('.h2x-sub[data-c="' + err.c + '"] .h2x-' + err.field);
          if (fieldEl) fieldEl.classList.add('h2x-invalid');
        }
        const row = panelMask.querySelector('.h2x-col[data-c="' + first.c + '"]');
        if (row) row.scrollIntoView({ block: 'center' });
      }
      errEl.textContent = errors.length
        ? errors.length + ' 项配置有误（已标红，修正后重试）'
        : keptErr;
      return;
    }
    for (const [table, entry] of panelDrafts) {
      const { draft, keys } = entry;
      const rules = [];
      const excluded = new Set(); // 导出列排除集（原列 key / 拆分新列 key#k）
      const formats = new Map();  // 列格式（文本为默认不记录，仅存数字列）
      draft.forEach((d, c) => {
        if (!d) return;
        if (d.checked) {
          rules.push({ col: keys[c], mode: d.mode, pattern: d.pattern || '', limit: parseLimit(d.limit) });
        }
        if (!d.export) excluded.add(keys[c]);
        if (d.fmt === 'number') formats.set(keys[c], 'number');
        const n = d.checked ? segCountOf(entry, c, d) : 0;
        for (let k = 1; k <= n; k++) {
          if (d.skipSegs.has(k)) excluded.add(keys[c] + '#' + k);
        }
      });
      if (rules.length) deps.splitRules.set(table, rules);
      else deps.splitRules.delete(table);
      if (excluded.size) deps.colFilters.set(table, excluded);
      else deps.colFilters.delete(table);
      if (formats.size) deps.colFormats.set(table, formats);
      else deps.colFormats.delete(table);
      ns.persist.save(table, rules, excluded, formats); // 持久化：均空时删除记录（即重置路径）
    }
    closeSplitPanel();
    deps.toast('列设置已保存并记住，导出时生效', { type: 'success' });
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
    // 编辑非当前表时同步刷新页签（选中集合变化）
    if (panelOpen && panelTable) renderPanel();
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