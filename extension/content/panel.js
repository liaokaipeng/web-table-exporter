/**
 * 列设置面板（Shadow DOM 内）：导出列筛选（含拆分新列）+ 三种拆分模式
 * （control/block/delimiter）+ 列格式（文本/数字，作用于该列及其拆分新列）、
 * 智能预填、最终输出全列预览、校验错误就地标红；
 * v2.0 面板重构：列行 7 控件收敛为 4 元素折叠式（拆分配置收进展开子行，
 * 模式/分隔符/上限键入时只局部刷新新列勾选区，焦点不丢）、多表下拉改页签
 * （含已配置状态点）、校验错误就地标红 + 滚动定位、focus trap + role="dialog"。
 * v2.0.1 列设置 UI 细节优化：拆分子行左缘竖线（从属层级）、列名 title 全名、
 * 面板加宽至 1000px、预览区限高自滚 + 表头 sticky、展开子行滚入视野。
 * v2.7：面板底部「恢复默认」显式重置入口（此前重置要凑齐「全不拆 + 全列导出 +
 * 全文本」再保存，路径不可发现）——只重置当前表格草稿为默认，仍走保存落盘，
 * 空配置保存即删记忆且提示改口径（不再说「已保存并记住」）。
 * v2.8：列顺序调整——每行左侧手柄可拖放（落点上/下缘内阴影标示），手柄聚焦后
 * Alt+↑/↓ 键盘移动；列序存在 entry.order（显示序，列索引数组），列区与预览按它
 * 渲染（预览即所得），保存时映射为 colKeys 落盘（自然序不记录）；含合并单元格的
 * 表禁用（merges 按列号定位，重排会错位）。
 * v2.10.2 拆分控件合并为单控件：勾选框（拆分/取消拆分）+ 折线 chevron 图标按钮（收起/展开配置）——
 * 未拆分时只显示勾选框，勾选即拆分并展开配置；已拆分时勾选框旁出现 chevron 图标按钮，
 * 只控配置子行显隐（收起后拆分仍生效）。此前「取消拆分 | 收起/展开」两个同权重文案
 * 按钮易混淆（误把「收起」当「取消拆分」），且「取消拆分」是不可逆操作。
 * 保存时草稿回写主 UI 内存 Map，并经 persist 模块落盘（跨会话恢复）。
 * 依赖：主 UI 经 init() 注入 { host, selected, snapshots, splitRules,
 *   colFilters, colFormats, colOrders, isBusy, isAlive, updateBar, toast }（main.js 最后装配）；
 *   算法层经 __h2x 命名空间（util/table/split/persist）
 */
(() => {
  'use strict';
  const ns = window.__h2x;
  const { escapeHtml } = ns.util;
  const { extractTable, makeSheetName } = ns.table;
  const { splitSegments, splitColName, colKeys, ctrlCountOf, ctrlColNames, toNumValue } = ns.split;

  // i18n 取词（各内容脚本同构，见 architecture.md「国际化」节）：优先经 ns.i18n
  // （i18n.js 手动中英文统一入口）；词条缺失或无 chrome.i18n 环境（Node 回归 /
  // E2E 桩未注入）→ 回落代码内中文，测试断言零改动。
  // 就地定义：renderTabs 既有循环变量 t 不调用取词，遮蔽无害
  const t = (key, fb, ...subs) => {
    if (ns.i18n) return ns.i18n.t(key, fb, subs); // v2.6.1 手动语言开关优先
    if (typeof chrome !== 'undefined' && chrome.i18n && chrome.i18n.getMessage) {
      const m = chrome.i18n.getMessage(key, subs.length ? subs.map(String) : undefined);
      if (m) return m;
    }
    return fb;
  };

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

  /** 分隔符探测：该列全部非空数据值都含候选符号才命中（保守，避免误拆）。
   *  结果仅用于拆分按钮 title 建议，不再预填到输入框（v2.10 起分隔符默认留空） */
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

  /** 智能预填（v2.1 起所有列默认不拆分）：多块文本列展开后预设 block（按换行拆）；
   *  含控件列展开后预设 control（由用户确认）；其余纯文本列预设 delimiter，但分隔符
   *  默认留空（探测结果仅作勾选框 title 建议，需用户显式填写）；段数上限默认 10。
   *  open = 配置子行展开态（v2.10.2 与「是否拆分」解耦：收起只隐藏配置，规则仍生效）。
   *  导出勾选默认全选（export: true），子列排除集默认为空，列格式默认文本 */
  function prefillDrafts(cols) {
    return cols.map(col => {
      const base = { export: true, skipSegs: new Set(), fmt: 'text', open: false };
      if (col.multiBlock) return Object.assign(base, { checked: false, mode: 'block', pattern: '', limit: '10' });
      if (col.hasCtrl) return Object.assign(base, { checked: false, mode: 'control', pattern: '', limit: '10' });
      return Object.assign(base, { checked: false, mode: 'delimiter', pattern: '', limit: '10' });
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
        checked: true, open: true, // 已保存规则恢复为展开显示（与旧版一致；收起只是当次会话内的视图操作）
        mode: rule.mode,
        pattern: rule.pattern || '', limit: rule.limit == null ? '' : String(rule.limit)
      });
    }
    return draft;
  }

  /** 已保存列顺序 → 面板显示序（列索引数组，v2.8）：按 keys 解析，未命中（表头变了 /
   *  列已不存在）的键忽略，其余列按自然序追加补齐——保证任何情况下都是全排列 */
  function orderFromSaved(savedOrder, keys) {
    const out = [];
    const used = new Set();
    for (const k of (savedOrder || [])) {
      const i = keys.findIndex(key => String(key) === String(k));
      if (i >= 0 && !used.has(i)) { used.add(i); out.push(i); }
    }
    for (let i = 0; i < keys.length; i++) if (!used.has(i)) out.push(i);
    return out;
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
      const base = raw || t('colN', '列' + (c + 1), c + 1);
      return entry.sample.headerRows ? ctrlColNames(base, n - 1)
        : Array.from({ length: n }, (_, k) => t('segN', '段' + (k + 1), k + 1));
    }
    return Array.from({ length: n }, (_, k) =>
      (entry.sample.headerRows ? splitColName(raw, k) : t('segN', '段' + (k + 1), k + 1)));
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
    if (col.multiBlock) return t('hintSplitBlock', '建议：按换行拆分（该列多为多行文本）');
    if (col.hasCtrl) return t('hintSplitCtrl', '建议：控件值拆分（该列含表单控件）');
    if (col.delim) {
      const disp = col.delim === ' ' ? t('spaceWord', '空格') : col.delim;
      return t('hintSplitDelim', '建议：按「' + disp + '」分隔符拆分', disp);
    }
    return t('hintSplitDefault', '拆分为多列（控件值 / 换行 / 分隔符）');
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
    panelMask.setAttribute('aria-label', t('panelTitle', '列设置'));
    panelMask.innerHTML = [
      // 面板专属样式随面板自持；颜色/圆角复用主 UI :host 设计 token（同一
      // shadowRoot 共享，深色模式经 main.js 的 prefers 覆写自动生效）；
      // 按钮样式（h2x-btn/primary/ghost）由主 UI的 <style> 提供
      '<style>',
      '  .h2x-mask{position:fixed;inset:0;pointer-events:auto;background:rgba(0,0,0,.28);display:flex;align-items:center;justify-content:center;z-index:1;animation:h2x-fade .15s ease-out;}',
      '  .h2x-panel{background:var(--c-bg);color:var(--c-text);border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.3);width:min(1000px,95vw);max-height:86vh;overflow:auto;padding:18px 20px 16px;box-sizing:border-box;font:13px/1.5 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif;animation:h2x-pop .15s ease-out;}',
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
      '  .h2x-h4{width:136px;flex:none;text-align:center;}',
      '  .h2x-col{display:flex;gap:8px;align-items:center;padding:6px 10px;border-bottom:1px solid var(--c-border-2);background:var(--c-bg);}',
      '  .h2x-col.noexp .h2x-cname{color:var(--c-text-3);}',
      '  .h2x-ckw{width:34px;flex:none;display:flex;justify-content:center;}',
      // v2.8 列顺序拖拽：手柄 16px（表头以 .h2x-hgrip 同宽占位保持列对齐）；
      // 拖到行上/下缘时以顶部/底部内阴影标示落点
      '  .h2x-grip{width:16px;flex:none;padding:0;border:none;background:transparent;color:var(--c-text-3);cursor:grab;font:12px/1 -apple-system,"Segoe UI",sans-serif;letter-spacing:-1px;}',
      '  .h2x-grip:hover{color:var(--c-primary);}',
      '  .h2x-grip:active{cursor:grabbing;}',
      '  .h2x-grip-off{display:inline-block;cursor:default;}',
      '  .h2x-hgrip{width:16px;flex:none;}',
      '  .h2x-col.h2x-drop-before{box-shadow:inset 0 2px 0 var(--c-primary);}',
      '  .h2x-col.h2x-drop-after{box-shadow:inset 0 -2px 0 var(--c-primary);}',
      '  .h2x-cname{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;}',
      '  .h2x-tag{display:inline-block;background:rgba(25,118,210,.12);color:var(--c-info);border-radius:8px;padding:0 6px;font-size:11px;font-weight:400;font-style:normal;margin-left:4px;}',
      '  @media (prefers-color-scheme: dark){.h2x-tag{background:rgba(100,181,246,.18);}}',
      '  .h2x-fmt{width:86px;flex:none;}',
      // v2.10.2 拆分控件：勾选框（拆分/取消拆分）+ 折线 chevron 图标按钮（收起/展开配置）
      // 单控件同宽对齐；未拆分时图标按钮 hidden（占位 width 由勾选框居中）
      '  .h2x-sctl{width:136px;flex:none;display:flex;align-items:center;justify-content:center;gap:6px;box-sizing:border-box;}',
      '  .h2x-ck-sp{flex:none;margin:0;cursor:pointer;}',
      '  .h2x-ck-sp:disabled{cursor:not-allowed;}',
      '  .h2x-sfold{display:inline-flex;align-items:center;justify-content:center;width:26px;height:22px;flex:none;padding:0;border:1px solid var(--c-border);border-radius:var(--r-s);background:var(--c-bg);color:var(--c-text-2);cursor:pointer;box-sizing:border-box;}',
      '  .h2x-sfold[hidden]{display:none;}',  /* 显式声明：display:inline-flex 会盖掉 UA 的 [hidden]{display:none} */
      '  .h2x-sfold:hover:not(:disabled){border-color:var(--c-primary);color:var(--c-primary);}',
      '  .h2x-sfold:disabled{color:var(--c-disable-fg);cursor:not-allowed;}',
      // 折线 chevron（两条边，非实心三角）：默认朝下（收起态 = 可展开），展开态旋转 180° 朝上
      '  .h2x-chev{width:12px;height:12px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;transition:transform .15s ease;}',
      '  .h2x-sfold[aria-expanded="true"] .h2x-chev{transform:rotate(180deg);}',
      '  @media (prefers-reduced-motion: reduce){.h2x-chev{transition:none;}}',
      '  .h2x-sub{padding:8px 10px 8px 52px;background:var(--c-bg-2);border-bottom:1px solid var(--c-border-2);border-left:3px solid rgba(46,125,50,.4);}',  /* 左缘竖线：标示拆分配置从属于上方列 */
      '  @media (prefers-color-scheme: dark){.h2x-sub{border-left-color:rgba(76,175,80,.5);}}',
      '  .h2x-sub-cfg{display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center;}',
      '  .h2x-sub-cfg label{display:flex;align-items:center;gap:5px;color:var(--c-text-2);font-size:12px;}',
      // 模式下拉 / 分隔符 / 段数上限统一宽度，三控件对齐（140px 兼容英文选项与占位文案）
      '  .h2x-sub-cfg select,.h2x-sub-cfg input{width:140px;flex:none;}',
      '  .h2x-sub-cols{display:flex;flex-wrap:wrap;gap:4px 14px;margin-top:6px;font-size:12px;color:var(--c-text-2);}',
      '  .h2x-sub-cols label{display:flex;align-items:center;gap:4px;cursor:pointer;}',
      '  .h2x-sub-cols label.noexp{color:var(--c-text-3);text-decoration:line-through;}',
      // 子行行首「原列的导出勾选 + 列名」复制件（与主行同一状态）；原列不导出时整组置灰
      '  .h2x-sub-src{font-weight:600;color:var(--c-text);}',
      '  .h2x-sub-src.noexp{color:var(--c-text-3);text-decoration:line-through;}',
      '  .h2x-sub-cols label.h2x-off{color:var(--c-text-3);cursor:not-allowed;}',
      '  .h2x-invalid{border-color:var(--c-danger)!important;box-shadow:0 0 0 1px var(--c-danger);}',  /* 校验错误就地标红 */
      '  .h2x-pv{border:1px solid var(--c-border-2);border-radius:var(--r);padding:10px;margin-bottom:12px;}',  /* 高度限制移至 body：标题/尾注不随滚动 */
      '  .h2x-pv-body{max-height:24vh;overflow:auto;}',  /* 限高自滚：列设置与预览始终同屏可见 */
      '  .h2x-pv thead th{position:sticky;top:0;z-index:1;}',  /* 预览滚动时表头保持可见（th 已有 --c-bg-2 背景遮底） */
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
      '    <h3>' + t('panelTitle', '列设置') + '</h3>',
      '    <button type="button" class="h2x-px" aria-label="' + t('closeAria', '关闭') + '" title="' + t('closePanelTitle', '关闭面板') + '">×</button>',
      '  </div>',
      '  <div class="h2x-tabs" role="tablist"></div>',
      '  <div class="h2x-note" hidden></div>',
      '  <div class="h2x-cols"></div>',
      '  <div class="h2x-pv"><div class="h2x-pv-title">' + t('previewTitle', '导出预览（绿色为拆分新列，划线列为不导出）') + '</div><div class="h2x-pv-body"></div><div class="h2x-pv-note"></div></div>',
      '  <div class="h2x-panel-foot">',
      // v2.7：显式重置入口——此前「重置」需凑齐「全不拆 + 全列导出 + 全文本」再保存，
      // 用户推不出来；按钮只重置当前表格草稿为默认，仍走「保存」落盘（空配置 = 删记忆）
      '    <button class="h2x-btn h2x-ghost h2x-reset" title="' + t('btnResetTitle', '将当前表格恢复为默认列设置（不拆分、全列导出、文本格式）；点「保存」后生效并清除本页记忆') + '">' + t('btnReset', '恢复默认') + '</button>',
      '    <span class="h2x-err"></span>',
      '    <button class="h2x-btn h2x-primary h2x-save">' + t('btnSave', '保存') + '</button>',
      '    <button class="h2x-btn h2x-ghost h2x-pcancel">' + t('btnCancel', '取消 (Esc)') + '</button>',
      '  </div>',
      '</div>'
    ].join('');
    deps.host.shadowRoot.appendChild(panelMask);
    panelMask.querySelector('.h2x-save').addEventListener('click', saveSplitPanel);
    panelMask.querySelector('.h2x-pcancel').addEventListener('click', closeSplitPanel);
    panelMask.querySelector('.h2x-px').addEventListener('click', closeSplitPanel);
    panelMask.querySelector('.h2x-reset').addEventListener('click', resetDraft);
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
    // v2.8：列顺序调整——手柄拖放（含落点指示）+ 手柄聚焦后 Alt+↑/↓ 键盘移动
    colsBox.addEventListener('dragstart', onColDragStart);
    colsBox.addEventListener('dragover', onColDragOver);
    colsBox.addEventListener('drop', onColDrop);
    colsBox.addEventListener('dragend', onColDragEnd);
    colsBox.addEventListener('keydown', onColGripKey);
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
        cols: panelCols, keys: keys, sample: panelSample,
        // v2.8：列顺序（显示序，列索引数组；自然序 = [0..n-1]）
        order: orderFromSaved(deps.colOrders && deps.colOrders.get(table), keys)
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
    if (hasMerges) note.textContent = t('noteMerges', '该表格含合并单元格，拆分与列筛选不可用（列格式仍可设置）');
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
      const cfg = deps.splitRules.has(t) || deps.colFilters.has(t) || deps.colFormats.has(t) ||
        (deps.colOrders && deps.colOrders.has(t));
      html += '<button type="button" class="h2x-tab' + (t === panelTable ? ' h2x-tab-on' : '') +
        '" data-i="' + i + '" role="tab" aria-selected="' + (t === panelTable) + '" title="' + escapeHtml(name) + '">' +
        '<i class="h2x-tab-dot' + (cfg ? '' : ' h2x-off') + '" aria-hidden="true"></i><span>' +
        (i + 1) + '. ' + escapeHtml(name) + '</span></button>';
      i++;
    }
    tabsEl.innerHTML = html;
    tabsEl.hidden = deps.selected.size < 2; // 单表不占位（聚焦逻辑回落到列勾选框）
  }

  /** 拆分新列勾选区 HTML（段名与导出列名一致）：行首给出「原列的导出勾选 + 列名」
   *  复制件（h2x-ck-x2，与主行同一导出状态、双向同步），其后才是「新列：」与各新列
   *  勾选；原列不导出时新列勾选置灰禁用（状态保留，见 syncExportUI） */
  function subColsHtmlOf(entry, c, d) {
    const raw = (entry.cols[c] && entry.cols[c].name) || '';
    const srcName = raw || t('colN', '列' + (c + 1), c + 1);
    let html = '<label class="h2x-sub-src' + (d.export ? '' : ' noexp') + '">' +
      '<input type="checkbox" class="h2x-ck-x2"' + (d.export ? ' checked' : '') + '>' +
      escapeHtml(srcName) + '</label>' +
      '<span class="h2x-sub-label">' + t('newColsLabel', '新列：') + '</span>';
    segNames(entry, c, d).forEach((segName, k) => {
      const on = !d.skipSegs.has(k + 1);
      let cls = on ? '' : 'noexp';
      if (!d.export) cls += ' h2x-off';
      html += '<label' + (cls ? ' class="' + cls.trim() + '"' : '') + '><input type="checkbox" class="h2x-ck-s" data-k="' +
        (k + 1) + '"' + (on ? ' checked' : '') + (d.export ? '' : ' disabled') + '>' + escapeHtml(segName) + '</label>';
    });
    return html;
  }

  /** 拆分配置子行 HTML：配置区（模式/分隔符/上限，DOM 稳定不重建）+ 新列勾选区
   *  （随段数变化局部刷新，见 syncSubCols——键入时焦点在配置区输入框上不丢） */
  function subHtmlOf(entry, c, d) {
    return '<div class="h2x-sub" data-c="' + c + '"><div class="h2x-sub-cfg">' +
      '<label>' + t('modeLabel', '模式') + ' <select class="h2x-mode">' +
      '<option value="control"' + (d.mode === 'control' ? ' selected' : '') + '>' + t('modeControl', '控件值拆分') + '</option>' +
      '<option value="block"' + (d.mode === 'block' ? ' selected' : '') + '>' + t('modeBlock', '按换行拆分') + '</option>' +
      '<option value="delimiter"' + (d.mode === 'delimiter' ? ' selected' : '') + '>' + t('modeDelimiter', '分隔符拆分') + '</option>' +
      '</select></label>' +
      '<label>' + t('delimLabel', '分隔符') + ' <input type="text" class="h2x-pattern" placeholder="' + t('delimPh', '如 、 ' + SPACE_MARK + '=空格') + '" value="' +
      escapeHtml(d.pattern === ' ' ? SPACE_MARK : d.pattern) + '"' + (lockPattern(d) ? ' disabled' : '') + '></label>' +
      '<label>' + t('limitLabel', '段数上限') + ' <input type="text" class="h2x-limit" placeholder="' + t('limitPh', '不限') + '" inputmode="numeric" value="' +
      escapeHtml(d.limit) + '"' + (lockLimit(d) ? ' disabled' : '') + '></label>' +
      '</div><div class="h2x-sub-cols">' + subColsHtmlOf(entry, c, d) + '</div></div>';
  }

  /** 新列勾选区局部刷新：模式/分隔符/上限变化后段数变化，只重建勾选区不动
   *  配置区输入框（焦点保持）；展开/收起的整行增删走 syncSubRow */
  function syncSubCols(entry, c, d) {
    const colsEl = panelMask.querySelector('.h2x-sub[data-c="' + c + '"] .h2x-sub-cols');
    if (colsEl) colsEl.innerHTML = subColsHtmlOf(entry, c, d);
  }

  /** 拆分子行增删：展开（d.checked && d.open）插入/替换子行；收起/取消则移除 */
  function syncSubRow(entry, c, d, row) {
    const old = panelMask.querySelector('.h2x-sub[data-c="' + c + '"]');
    if (d.checked && d.open && !panelHasMerges()) {
      const tmp = document.createElement('div');
      tmp.innerHTML = subHtmlOf(entry, c, d);
      if (old) old.replaceWith(tmp.firstChild);
      else row.after(tmp.firstChild);
    } else if (old) {
      old.remove();
    }
  }

  /** 导出列计数：已选/全部（原列 + 拆分新列都计入；原列不导出时其新列也不计入） */
  function updateTools() {
    const entry = panelDrafts.get(panelTable);
    if (!entry) return;
    let kept = 0, total = 0;
    entry.draft.forEach((d, c) => {
      const n = d.checked ? segNames(entry, c, d).length : 0;
      total += 1 + n;
      if (d.export) {
        kept++;
        for (let k = 1; k <= n; k++) if (!d.skipSegs.has(k)) kept++;
      }
    });
    const el = panelMask.querySelector('.h2x-exp-n');
    if (el) el.textContent = kept + '/' + total;
  }

  /** 主行拆分控件 HTML（v2.10.2，单控件）：
   *  勾选框 = 拆分开关（勾选=拆分并展开配置；取消=删规则、恢复原样导出）；
   *  chevron 图标按钮 = 只控配置子行显隐（收起后拆分仍生效），未拆分时隐藏。
   *  两者同处 .h2x-sctl：勾选/取消用系统勾选框语义，展开/收起用图标，互补歧义
   *  图标为两条边组成的折线 chevron（非实心三角），展开态旋转 180°（见 .h2x-chev） */
  function splitCtlHtml(col, d, hasMerges) {
    const dis = hasMerges ? ' disabled' : '';
    const hint = hasMerges ? t('noSplitMerges', '含合并单元格的表格不可拆分') : splitHint(col);
    const foldTitle = d.open ? t('collapseCfgTitle', '收起配置（拆分仍生效）') : t('expandCfgTitle', '展开拆分配置');
    return '<span class="h2x-sctl">' +
      '<input type="checkbox" class="h2x-ck-sp"' + (d.checked ? ' checked' : '') + dis +
      ' title="' + escapeHtml(d.checked ? t('cancelSplitTitle', '取消勾选即取消该列拆分，恢复原样导出') : hint) + '"' +
      ' aria-label="' + escapeHtml(t('headSplit', '拆分')) + '">' +
      '<button type="button" class="h2x-sfold"' + (!d.checked || hasMerges ? ' hidden' : '') + dis +
      ' title="' + escapeHtml(foldTitle) + '" aria-label="' + escapeHtml(foldTitle) + '"' +
      ' aria-expanded="' + (d.open ? 'true' : 'false') + '">' +
      '<svg class="h2x-chev" viewBox="0 0 16 16" aria-hidden="true"><polyline points="4 6.5 8 10.5 12 6.5"></polyline></svg>' +
      '</button></span>';
  }

  /** 拆分控件局部同步（不重建 DOM，保住勾选框/图标按钮焦点）；
   *  图标朝向由 `aria-expanded` 经 CSS 旋转，无需改 DOM 内容 */
  function syncSplitCtl(col, row, d) {
    const fold = row.querySelector('.h2x-sfold');
    if (!fold) return;
    const title = d.open ? t('collapseCfgTitle', '收起配置（拆分仍生效）') : t('expandCfgTitle', '展开拆分配置');
    fold.hidden = !d.checked;
    fold.title = title;
    fold.setAttribute('aria-label', title);
    fold.setAttribute('aria-expanded', d.open ? 'true' : 'false');
    const ck = row.querySelector('.h2x-ck-sp');
    if (ck) ck.title = d.checked ? t('cancelSplitTitle', '取消勾选即取消该列拆分，恢复原样导出') : splitHint(col);
  }

  /** 主行渲染（v2.0 收敛为 4 元素）：[导出✓][列名+徽标][格式][拆分控件]；
   *  拆分配置（模式/分隔符/上限/新列勾选）收进展开子行 subHtmlOf */
  function renderColList() {
    const entry = panelDrafts.get(panelTable);
    const draft = entry.draft;
    const hasMerges = panelHasMerges();
    let html = '<div class="h2x-tools"><span>' + t('colsExportLabel', '导出列') + ' <b class="h2x-exp-n"></b></span>' +
      '<button type="button" class="h2x-mini h2x-all"' + (hasMerges ? ' disabled' : '') + '>' + t('selectAll', '全选') + '</button>' +
      '<button type="button" class="h2x-mini h2x-none"' + (hasMerges ? ' disabled' : '') + '>' + t('selectNone', '全不选') + '</button></div>';
    html += '<div class="h2x-col-head"><span class="h2x-hgrip" aria-hidden="true"></span><span class="h2x-h1">' + t('headExport', '导出') + '</span><span class="h2x-h2">' + t('headColumn', '列') + '</span>' +
      '<span class="h2x-h3">' + t('headFormat', '格式') + '</span><span class="h2x-h4">' + t('headSplit', '拆分') + '</span></div>';
    // v2.8：按 entry.order（显示序）逐行渲染，data-c 仍是原列号（草稿/规则/筛选的定位基准）
    // 拖拽手柄：含合并单元格的表不可重排（merges 按列号定位，重排会让合并区错位）→ 占位不拖
    const gripTitle = t('gripTitle', '拖动调整列顺序（也可聚焦后按 Alt+↑/↓）');
    entry.order.forEach(c => {
      const col = panelCols[c];
      const d = draft[c];
      if (!col || !d) return;
      const name = col.name || t('colN', '列' + (c + 1), c + 1);
      html += '<div class="h2x-col' + (d.export ? '' : ' noexp') + '" data-c="' + c + '">' +
        (hasMerges
          ? '<span class="h2x-grip h2x-grip-off" aria-hidden="true"></span>'
          : '<button type="button" class="h2x-grip" draggable="true" title="' + escapeHtml(gripTitle) + '" aria-label="' + escapeHtml(gripTitle) + '">⋮⋮</button>') +
        '<label class="h2x-ckw"><input type="checkbox" class="h2x-ck-x"' + (d.export ? ' checked' : '') + (hasMerges ? ' disabled' : '') + '></label>' +
        '<span class="h2x-cname" title="' + escapeHtml(name) + '">' + escapeHtml(name) + (col.hasCtrl ? '<i class="h2x-tag">' + t('tagCtrl', '控件') + '</i>' : '') + (col.multiBlock ? '<i class="h2x-tag">' + t('tagMultiLine', '多行') + '</i>' : '') + '</span>' +
        '<select class="h2x-fmt" title="' + escapeHtml(t('fmtNumberTitle', '数字格式：数值化后写入 Excel（含千分位逗号会先剥离，无法解析保持原文本）；作用于该列及其拆分新列')) + '">' +
        '<option value="text"' + (d.fmt !== 'number' ? ' selected' : '') + '>' + t('fmtText', '文本') + '</option>' +
        '<option value="number"' + (d.fmt === 'number' ? ' selected' : '') + '>' + t('fmtNumber', '数字') + '</option>' +
        '</select>' +
        splitCtlHtml(col, d, hasMerges) +
        '</div>';
      if (d.checked && d.open && !hasMerges) html += subHtmlOf(entry, c, d);
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

  /** 导出勾选联动：主行勾选框与子行原列勾选框（复制件 h2x-ck-x2）两处同步；原列不导出
   *  时该列整体不导出 → 新列勾选框置灰禁用（保留原有勾选状态），预览同步划线 */
  function syncExportUI(c, d) {
    const mainRow = panelMask.querySelector('.h2x-col[data-c="' + c + '"]');
    if (mainRow) {
      mainRow.classList.toggle('noexp', !d.export);
      const ck = mainRow.querySelector('.h2x-ck-x');
      if (ck) ck.checked = d.export;
    }
    const sub = panelMask.querySelector('.h2x-sub[data-c="' + c + '"]');
    if (!sub) return;
    const src = sub.querySelector('.h2x-ck-x2');
    if (src) {
      src.checked = d.export;
      src.closest('label').classList.toggle('noexp', !d.export);
    }
    sub.querySelectorAll('.h2x-ck-s').forEach(el => {
      el.disabled = !d.export;
      el.closest('label').classList.toggle('h2x-off', !d.export);
    });
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
    const { row, c, d } = hit;
    const entry = panelDrafts.get(panelTable);
    if (e.target.classList.contains('h2x-ck-sp')) {
      // 主行拆分勾选（v2.10.2）：勾选 = 拆分并展开配置；取消 = 删规则、恢复原样导出
      d.checked = e.target.checked;
      d.open = e.target.checked;
      syncSplitCtl(panelCols[c], row, d);
      syncSubRow(entry, c, d, row);
      if (d.checked && d.open) {
        const sub0 = panelMask.querySelector('.h2x-sub[data-c="' + c + '"]');
        if (sub0) sub0.scrollIntoView({ block: 'nearest' }); // 展开后子行可能超出列区视口
      }
      updateTools();
      renderPreview();
      return;
    }
    if (e.target.classList.contains('h2x-ck-x') || e.target.classList.contains('h2x-ck-x2')) {
      // 主行 / 子行原列两处勾选同语义：原列不导出 = 该列及其拆分新列整体不导出
      d.export = e.target.checked;
      syncExportUI(c, d);
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

  // 点击：拆分控件（▾/▴ 收起展开配置）+ 全选/全不选快捷按钮
  function onColClick(e) {
    const fold = e.target.closest('.h2x-sfold');
    if (fold) {
      if (panelHasMerges()) return;
      const hit = draftAt(e);
      if (!hit) return;
      const { row, c, d } = hit;
      if (!d.checked) return; // 未拆分无配置可收起（图标已隐藏，防御性兜底）
      d.open = !d.open;       // 只控配置子行显隐，拆分仍生效
      syncSplitCtl(panelCols[c], row, d);
      syncSubRow(panelDrafts.get(panelTable), c, d, row);
      if (d.open) {
        // 展开后子行可能超出列区视口（38vh 滚动容器），滚入可见
        const sub = panelMask.querySelector('.h2x-sub[data-c="' + c + '"]');
        if (sub) sub.scrollIntoView({ block: 'nearest' });
      }
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

  /* ---------------- 列顺序调整（v2.8，拖拽 + 键盘） ---------------- */

  let dragCol = null; // 正在拖拽的原列号（null = 未拖拽）
  let dropAt = null;  // 当前落点 { c, before }

  /** 拖拽起点：只有手柄可拖（行内还有勾选/下拉，整行 draggable 会抢交互）；
   *  含合并单元格的表不参与（merges 按列号定位，重排会让合并区错位） */
  function onColDragStart(e) {
    const grip = e.target.closest && e.target.closest('.h2x-grip');
    if (!grip || grip.classList.contains('h2x-grip-off') || panelHasMerges()) return;
    const row = grip.closest('.h2x-col');
    if (!row) return;
    dragCol = parseInt(row.dataset.c, 10);
    dropAt = null;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(dragCol)); // Firefox 须 setData 才启动拖拽
    }
  }

  /** 落点：指针在目标行上半 → 插到其前，下半 → 插到其后（内阴影标示） */
  function onColDragOver(e) {
    if (dragCol == null) return;
    const row = e.target.closest && e.target.closest('.h2x-col');
    if (!row) return;
    e.preventDefault(); // 必须 preventDefault 才允许 drop
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    const c = parseInt(row.dataset.c, 10);
    const r = row.getBoundingClientRect();
    const before = (e.clientY - r.top) < r.height / 2;
    if (dropAt && dropAt.c === c && dropAt.before === before) return; // 落点未变不重绘
    dropAt = { c: c, before: before };
    paintDropHint();
  }

  function paintDropHint() {
    if (!panelMask) return;
    panelMask.querySelectorAll('.h2x-col').forEach(el => {
      const hit = dropAt && parseInt(el.dataset.c, 10) === dropAt.c;
      el.classList.toggle('h2x-drop-before', !!(hit && dropAt.before));
      el.classList.toggle('h2x-drop-after', !!(hit && !dropAt.before));
    });
  }

  function onColDrop(e) {
    if (dragCol == null) return;
    e.preventDefault();
    const from = dragCol;
    const at = dropAt;
    dragCol = null;
    dropAt = null;
    paintDropHint(); // 清落点标示
    if (!at || at.c === from) return;
    const entry = panelDrafts.get(panelTable);
    if (entry) applyMove(entry, from, at.c, !at.before); // 落点下半 = 插到其后
  }

  function onColDragEnd() {
    dragCol = null;
    dropAt = null;
    paintDropHint();
  }

  /** 键盘移动（手柄聚焦时 Alt+↑/↓）：与拖一位等价，便于纯键盘操作 */
  function onColGripKey(e) {
    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    const grip = e.target.closest && e.target.closest('.h2x-grip');
    if (!grip) return;
    const row = grip.closest('.h2x-col');
    const entry = panelDrafts.get(panelTable);
    if (!row || !entry) return;
    const c = parseInt(row.dataset.c, 10);
    const pos = entry.order.indexOf(c);
    const to = e.key === 'ArrowUp' ? pos - 1 : pos + 1;
    if (pos < 0 || to < 0 || to >= entry.order.length) return;
    e.preventDefault();
    e.stopPropagation();
    applyMove(entry, c, entry.order[to], e.key === 'ArrowDown');
    refocusGrip(c); // 重渲染后手柄是全新节点，焦点需回填
  }

  /** 移动入口：把 from 列插到 target 列之前/之后，重渲染列区与预览 */
  function applyMove(entry, from, target, after) {
    const arr = entry.order.filter(c => c !== from);
    let idx = arr.indexOf(target);
    if (idx < 0) return;
    if (after) idx += 1;
    arr.splice(idx, 0, from);
    entry.order = arr;
    renderColList();
    renderPreview();
  }

  function refocusGrip(c) {
    const grip = panelMask.querySelector('.h2x-col[data-c="' + c + '"] .h2x-grip');
    if (grip) grip.focus();
  }

  /** 最终输出全列预览（v2.0；v2.8 起列序改为面板显示序 entry.order，预览与导出列序一致）：按导出时的真实列序与列名渲染——原列 +
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
      body.innerHTML = '<span class="h2x-pv-empty">' + t('previewMerges', '该表格含合并单元格，不可拆分与筛选（列格式仍生效）') + '</span>';
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
    // v2.8：预览按显示序（entry.order）渲染，与导出列序一致（预览即所得）
    entry.order.forEach(c => {
      const d = draft[c];
      if (!d) return;
      const raw = (panelCols[c] && panelCols[c].name) || '';
      const name = raw || t('colN', '列' + (c + 1), c + 1);
      html += '<th' + (d.export ? '' : ' class="drop"') + '>' + escapeHtml(name) + '</th>';
      if (!d.checked) return;
      segNames(entry, c, d).forEach((segName, k) => {
        html += '<th class="new' + ((!d.export || d.skipSegs.has(k + 1)) ? ' drop' : '') + '">' + escapeHtml(segName) + '</th>';
      });
    });
    html += '</tr></thead><tbody>';
    const dataRows = aoa.length - headerRows;
    const rowsShown = Math.min(dataRows, 3);
    for (let r = headerRows; r < headerRows + rowsShown; r++) {
      html += '<tr>';
      entry.order.forEach(c => {
        const d = draft[c];
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
            html += '<td' + ((!d.export || d.skipSegs.has(k + 1)) ? ' class="drop"' : '') + '>' +
              escapeHtml(vals[k] == null ? '' : String(num(vals[k]))) + '</td>';
          }
          const tv = text[r] ? text[r][c] : null;
          html += '<td' + ((!d.export || d.skipSegs.has(n + 1)) ? ' class="drop"' : '') + '>' +
            escapeHtml(tv == null ? '' : String(num(tv))) + '</td>';
        } else {
          const n = segCountOf(entry, c, d);
          const parts = partsOf(r, c, d);
          while (parts.length < n) parts.push('');
          for (let k = 0; k < n; k++) {
            html += '<td' + ((!d.export || d.skipSegs.has(k + 1)) ? ' class="drop"' : '') + '>' + escapeHtml(String(num(parts[k]))) + '</td>';
          }
        }
      });
      html += '</tr>';
    }
    html += '</tbody></table>';
    body.innerHTML = html;
    note.textContent = dataRows > 3 ? t('previewRows3', '共 ' + dataRows + ' 行数据，预览前 3 行', dataRows)
      : (dataRows > 0 ? t('previewRows', '共 ' + dataRows + ' 行数据', dataRows) : t('previewNoRows', '无数据行'));
  }

  /** 清除全部就地错误标红 */
  function clearInvalidMarks() {
    if (!panelMask) return;
    panelMask.querySelectorAll('.h2x-invalid').forEach(el => el.classList.remove('h2x-invalid'));
  }

  /** v2.8 保存用列顺序键数组：面板显示序（列索引）→ colKeys；与自然序相同则返回 []
   *  （不落记录，未拖动过的表零回归；表头变更时未命中的键由 reorderColumns 静默忽略） */
  function orderKeysOf(entry) {
    for (let i = 0; i < entry.order.length; i++) {
      if (entry.order[i] !== i) return entry.order.map(c => entry.keys[c]);
    }
    return [];
  }

  /** v2.7 恢复默认（当前表格）：草稿回智能预填默认（全不拆、全列导出、全文本），
   *  并清空段数缓存与错误态。不改存储——点「保存」才落盘，空配置即删除本页记忆；
   *  点「取消」则原配置原样保留（与面板既有的一进一出语义一致） */
  function resetDraft() {
    if (!panelOpen || !panelTable) return;
    const entry = panelDrafts.get(panelTable);
    if (!entry) return;
    entry.draft = prefillDrafts(entry.cols);
    entry.segCache = null;
    entry.order = entry.keys.map((_, i) => i); // v2.8：列顺序一并回自然序
    clearInvalidMarks();
    const errEl = panelMask.querySelector('.h2x-err');
    if (errEl) errEl.textContent = '';
    renderColList();
    renderPreview();
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
        if (!d.export) return; // 原列不导出 → 该列及其拆分新列整体不导出，不计入
        kept++;
        const n = d.checked ? segCountOf(entry, c, d) : 0;
        for (let k = 1; k <= n; k++) if (!d.skipSegs.has(k)) kept++;
      });
      if (kept === 0 && !keptErr) keptErr = t('errKeepOne', '表格' + ti + '：至少保留一个导出列', ti);
    }
    if (errors.length || keptErr) {
      // v2.0 就地错误：切到首个错误所在表（跨表错误也看得见），标红对应
      // 输入框并滚动到该列；底部只留汇总计数
      const first = errors[0];
      if (first && first.table !== panelTable) switchPanelTable(first.table);
      if (first && first.table === panelTable) {
        const entry = panelDrafts.get(panelTable);
        // 出错列若处于收起态，先自动展开（否则子行输入框不可见，红框标不出来）
        let reopened = false;
        for (const err of errors) {
          if (err.table !== panelTable) continue;
          const d = entry.draft[err.c];
          if (d && !d.open) { d.open = true; reopened = true; }
        }
        if (reopened) renderColList();
        for (const err of errors) {
          if (err.table !== panelTable) continue;
          const fieldEl = panelMask.querySelector('.h2x-sub[data-c="' + err.c + '"] .h2x-' + err.field);
          if (fieldEl) fieldEl.classList.add('h2x-invalid');
        }
        const row = panelMask.querySelector('.h2x-col[data-c="' + first.c + '"]');
        if (row) row.scrollIntoView({ block: 'center' });
      }
      errEl.textContent = errors.length
        ? t('errCount', errors.length + ' 项配置有误（已标红，修正后重试）', errors.length)
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
        if (d.fmt === 'number') formats.set(keys[c], 'number');
        const n = d.checked ? segCountOf(entry, c, d) : 0;
        if (!d.export) {
          // 原列不导出：连同其全部拆分新列一并排除（拆分配置仍保留，仅本次导出不生效；
          // 重新勾选导出即恢复原勾选状态）
          excluded.add(keys[c]);
          for (let k = 1; k <= n; k++) excluded.add(keys[c] + '#' + k);
        } else {
          for (let k = 1; k <= n; k++) {
            if (d.skipSegs.has(k)) excluded.add(keys[c] + '#' + k);
          }
        }
      });
      if (rules.length) deps.splitRules.set(table, rules);
      else deps.splitRules.delete(table);
      if (excluded.size) deps.colFilters.set(table, excluded);
      else deps.colFilters.delete(table);
      if (formats.size) deps.colFormats.set(table, formats);
      else deps.colFormats.delete(table);
      const order = orderKeysOf(entry); // v2.8：与自然序相同 → []（不记录，零回归）
      if (order.length) deps.colOrders.set(table, order);
      else deps.colOrders.delete(table);
      ns.persist.save(table, rules, excluded, formats, order); // 持久化：均空时删除记录（即重置路径）
    }
    // v2.7：保存后本面板各表均无配置 = 走了「恢复默认」/重置，提示改口径
    // （否则「已保存并记住」会让人以为旧配置还在）
    let anyCfg = false;
    for (const table of panelDrafts.keys()) {
      if (deps.splitRules.has(table) || deps.colFilters.has(table) || deps.colFormats.has(table) ||
        (deps.colOrders && deps.colOrders.has(table))) { anyCfg = true; break; }
    }
    closeSplitPanel();
    deps.toast(anyCfg ? t('toastSaved', '列设置已保存并记住，导出时生效')
      : t('toastResetDone', '已清除本页列设置记忆，恢复默认导出'),
      { type: anyCfg ? 'success' : 'info' });
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