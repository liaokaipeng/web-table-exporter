/**
 * HTML2XLSX 主 UI：选择模式工具栏、悬浮高亮、多选管理、多格式导出
 * （xlsx / csv / json / md / html，须最后注入）
 * 依赖 window.__h2x 命名空间（entry/util/controls/split/cell/table/virtual/
 * format/persist 先行注入）；UI 层与算法层只经命名空间单向调用，面板经
 * panel.init() 注入依赖。
 * v2.0：toast 反馈系统（结果性通知迁出 hint 行）、虚拟采集可中止、导出后
 * 保留选择、工具栏折行自适应、设计 token + 深色模式 + 动效（prefers 系列）
 * v2.1：支持 div 网格表格（Element Plus el-table-v2 虚拟化表格）的识别与滚动采集
 * v2.2：网格表格识别经 ns.table 适配器注册表分发，扩展支持 AG Grid / MUI X
 * DataGrid / Tabulator（hitRoot 与 hasTables 走通用入口，组件无关）
 * v2.4：选择模式点击放行——非表格点击不再拦截（翻页/筛选等页面交互可用），
 * 仅拦截表格点选与链接导航（防误触跳转丢失选择会话）；toast 视觉强化
 * （语义色图标徽标 + 底色 + 加粗）；反馈补全——被移除的已选表格 / 采集中
 * 点击拦截 / 无表格页面进入均给 toast；导出迭代前快照表格列表（防并发剔除）
 * v2.5：分页表格自动翻页采集——「采集全部页」入口（工具栏按钮，取最后选中
 * 的表）：组件分页器（el-pagination / ant-pagination）自动识别直接采集，
 * 识别不到进入「指定翻页按钮」子模式兜底；翻页按钮的编程式点击豁免采集期
 * 拦截（分页器常为 a[href]）；翻页中表格被重建时选中迁移到新根
 * v2.5.1：工具栏「采集全部页」按钮与页数输入框合并为单一复合组件「采集
 * N/全部 页」——整组点击即采集（页数槽留给输入，Enter 同效），留空 = 全部页；
 * 页数槽为可见输入框样式（描边 + 同色淡底）提示可编辑
 * v2.5.2：重构为下拉展开式——主按钮「采集全部页 ▾」点开分页采集设置面板
 * （页数上限输入槽留空 = 全部页，取消/开始采集按钮，点开聚焦输入槽，Esc /
 * 点面板外 / 再点按钮收拢）；「开始采集」才触发 onCollectAllPages，采集中
 * 禁用主按钮并收拢面板（updateBar 同步）
 */
(() => {
  'use strict';
  const ns = window.__h2x;
  if (!ns || ns.aborted) return; // 守卫已退出（再次点击图标 = 退出选择模式），不初始化
  const { timestamp, sanitizeFilename } = ns.util;
  const { extractTable, makeSheetName, splitGroupOf, gridRootOf, GRID_ROOT_SELECTOR } = ns.table;
  const { isVirtualTable, collectVirtual } = ns.virtual;
  const { detectPager, manualPager, collectPaged, isPagingClick } = ns.pagination;
  const { applyColumnSplits, columnLayout, filterColumns, colKeys, formatColumns, applyColFormats, autoColWidths } = ns.split;
  const { toCsv, toJson, toMarkdown, toHtmlDocument } = ns.format;
  const panel = ns.panel;
  const persist = ns.persist;

  // 导出格式注册表：label 为按钮文案、ext 为文件扩展名、mime 为下载 MIME
  const FORMATS = {
    xlsx: { label: 'Excel', ext: 'xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
    csv: { label: 'CSV', ext: 'csv', mime: 'text/csv' },
    json: { label: 'JSON', ext: 'json', mime: 'application/json' },
    md: { label: 'Markdown', ext: 'md', mime: 'text/markdown' },
    html: { label: 'HTML', ext: 'html', mime: 'text/html' }
  };

  let active = true;
  let host = null;
  let hoverBox = null, countEl = null, nameInput = null, exportBtn = null, cancelBtn = null, hintEl = null, splitBtn = null, fmtSel = null, pageWrap = null, pageBtn = null, pageMenu = null, pagesInput = null, pageGoBtn = null, pageCancelBtn = null;
  let toastRoot = null;
  let hoverTable = null;
  let rafId = 0;
  let collecting = false; // 虚拟表格滚动采集中 / 分页表格翻页采集中
  let exporting = false;  // 导出文件生成/编码进行中（await 让出主线程期间的重入保护）
  let specifying = false; // v2.5：「指定翻页按钮」子模式（分页器识别不到的兜底）
  let genToken = 0;       // 代际令牌：退出/重新采集时使旧采集任务失效
  let hasTables = true;   // 进入选择模式时页面是否存在表格（无表时默认提示切换）
  let lastBlockHint = 0;  // 采集中点击提示的上次 toast 时间（2s 节流防刷屏）

  const selected = new Map();   // table -> 覆盖层元素（Map 保持选择顺序 = Sheet 顺序）
  const snapshots = new Map();   // table -> 虚拟滚动表格采集快照 { rows, ctrl, text, headerRows }
  const splitRules = new Map();  // table -> 列拆分规则（会话内存：面板保存时经 persist 落盘，选中时按表指纹恢复）
  const colFilters = new Map();  // table -> 导出列排除集 Set<colKey|colKey#k>（会话内存，持久化同上；无记录 = 全列导出）
  const colFormats = new Map();  // table -> 列格式 Map<colKey,'number'>（会话内存，持久化同上；文本为默认不记录）

  /* ---------------- UI 构建（Shadow DOM 隔离页面样式） ---------------- */

  function buildUI() {
    host = document.createElement('div');
    host.style.cssText =
      'all:initial;display:block;position:absolute;top:0;left:0;width:0;height:0;' +
      'z-index:2147483647;pointer-events:none;';
    document.documentElement.appendChild(host);

    const root = host.attachShadow({ mode: 'open' });
    // 工具栏样式 + 面板共用的按钮样式（面板专属样式由 panel.js 自持）。
    // v2.0 设计 token：颜色/圆角集中定义于 :host，工具栏与面板两处 <style>
    // 同一 shadowRoot 共享；深色模式经 prefers-color-scheme 覆写 token
    root.innerHTML = [
      '<style>',
      '  :host{--c-primary:#2e7d32;--c-info:#1976d2;--c-danger:#c62828;--c-warn:#8d6e00;',
      '    --c-text:#333;--c-text-2:#666;--c-text-3:#999;--c-border:#ccc;--c-border-2:#e0e0e0;',
      '    --c-bg:#fff;--c-bg-2:#f5f7fa;--c-bg-3:#fafbfc;--c-input:#fff;',
      '    --c-disable-bg:#757575;--c-disable-fg:#767676;--r:8px;--r-s:6px;}',
      '  @media (prefers-color-scheme: dark){:host{--c-primary:#4caf50;--c-info:#64b5f6;--c-danger:#ef5350;--c-warn:#ffd54f;',
      '    --c-text:#e0e0e0;--c-text-2:#aaa;--c-text-3:#777;--c-border:#555;--c-border-2:#3a3a3a;',
      '    --c-bg:#1e1e1e;--c-bg-2:#2a2a2a;--c-bg-3:#252525;--c-input:#333;',
      '    --c-disable-bg:#555;--c-disable-fg:#888;}}',
      '  .h2x-hover{position:absolute;pointer-events:none;box-sizing:border-box;border:2px solid #1976d2;background:rgba(25,118,210,.14);border-radius:2px;transition:left .08s,top .08s,width .08s,height .08s;}',
      '  .h2x-sel{position:absolute;pointer-events:none;box-sizing:border-box;border:2px solid #2e7d32;background:rgba(46,125,50,.10);border-radius:2px;}',
      '  .h2x-badge{position:absolute;top:-12px;left:-12px;min-width:22px;height:22px;padding:0 6px;box-sizing:border-box;border-radius:11px;background:#2e7d32;color:#fff;font:700 12px/22px -apple-system,"Segoe UI",sans-serif;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.35);}',
      '  .h2x-sel.h2x-flip-x .h2x-badge{left:auto;right:-12px;}',   /* 表格贴左边缘：徽标翻内侧 */
      '  .h2x-sel.h2x-flip-y .h2x-badge{top:auto;bottom:-12px;}',   /* 表格贴上边缘：徽标翻内侧 */
      '  .h2x-bar{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);pointer-events:auto;display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:8px 10px;max-width:96vw;box-sizing:border-box;padding:10px 14px;background:var(--c-bg);border-radius:10px;box-shadow:0 4px 20px rgba(0,0,0,.25);font:13px/1.4 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif;color:var(--c-text);}',
      '  .h2x-hint{color:var(--c-text-2);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',  /* 空间不足先截断提示文案，按钮不被迫换行 */
      '  .h2x-count{flex:none;white-space:nowrap;}',
      '  .h2x-count b{color:var(--c-primary);}',
      '  .h2x-name{flex:1 1 150px;min-width:110px;max-width:260px;padding:6px 10px;border:1px solid var(--c-border);border-radius:var(--r-s);font:13px/1.2 -apple-system,"Segoe UI",sans-serif;color:var(--c-text);outline:none;background:var(--c-input);box-sizing:border-box;}',
      '  .h2x-name:focus{border-color:var(--c-primary);}',
      '  .h2x-ext{padding:6px 8px;border:1px solid var(--c-border);border-radius:var(--r-s);font:13px/1.2 -apple-system,"Segoe UI",sans-serif;color:var(--c-text);background:var(--c-input);outline:none;cursor:pointer;flex:none;}',
      '  .h2x-ext:focus{border-color:var(--c-primary);}',
      '  .h2x-btn{padding:6px 16px;border:none;border-radius:var(--r-s);cursor:pointer;font:13px/1.2 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif;}',
      '  .h2x-btn:hover:not(:disabled){filter:brightness(1.06);}',
      '  .h2x-btn:active:not(:disabled){filter:brightness(.94);}',
      '  .h2x-primary{background:var(--c-primary);color:#fff;}',
      '  .h2x-primary:disabled{background:var(--c-disable-bg);color:#fff;cursor:not-allowed;filter:none;}',
      '  .h2x-ghost{background:var(--c-bg-3);color:var(--c-text-2);border:1px solid var(--c-border);}',
      '  .h2x-ghost:disabled{color:var(--c-disable-fg);cursor:not-allowed;}',
      '  .h2x-split{background:var(--c-bg);color:var(--c-primary);border:1px solid var(--c-primary);position:relative;}',
      '  .h2x-split:disabled{background:var(--c-bg-3);color:var(--c-disable-fg);border-color:var(--c-border);cursor:not-allowed;filter:none;}',
      '  .h2x-split.h2x-has-cfg::after{content:"";position:absolute;top:-4px;right:-4px;width:8px;height:8px;border-radius:50%;background:var(--c-info);box-shadow:0 0 0 2px var(--c-bg);}',  /* 已配置徽标点 */
      '  .h2x-actions{display:flex;gap:8px;flex:none;}',  /* 按钮组：极窄屏整组换行，不出现孤立按钮 */
      '  .h2x-pagewrap{position:relative;flex:none;}',
      '  .h2x-pagebtn{display:inline-flex;align-items:center;gap:6px;padding:6px 12px;background:var(--c-bg);color:var(--c-info);border:1px solid var(--c-info);border-radius:var(--r-s);cursor:pointer;font:13px/1.2 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif;white-space:nowrap;}',  /* v2.5.2 采集全部页按钮：分页采集下拉入口（信息蓝描边，与列设置的绿区分） */
      '  .h2x-pagebtn:hover:not(:disabled){filter:brightness(1.06);}',
      '  .h2x-pagebtn:active:not(:disabled){filter:brightness(.94);}',
      '  .h2x-pagebtn:disabled{background:var(--c-bg-3);color:var(--c-disable-fg);border-color:var(--c-border);cursor:not-allowed;filter:none;}',
      '  .h2x-pagebtn .h2x-care{flex:none;font-style:normal;font-size:10px;line-height:1;opacity:.85;transition:transform .15s;}',  /* 下拉箭头随展开旋转 */
      '  .h2x-pagewrap.h2x-open .h2x-care{transform:rotate(180deg);}',
      '  .h2x-pagemenu{position:absolute;bottom:calc(100% + 8px);left:50%;transform:translateX(-50%);width:288px;box-sizing:border-box;padding:12px;background:var(--c-bg);border:1px solid var(--c-border-2);border-radius:10px;box-shadow:0 10px 32px rgba(0,0,0,.22);z-index:2;text-align:left;}',  /* 下拉面板：上移弹层，深色/浅色随 token */
      '  .h2x-pagemenu[hidden]{display:none;}',
      '  .h2x-pagemenu-title{font-size:13px;font-weight:700;color:var(--c-text);}',
      '  .h2x-pagemenu-sub{font-size:12px;color:var(--c-text-3);margin:4px 0 12px;line-height:1.5;}',
      '  .h2x-pagemenu-row{display:flex;align-items:center;gap:8px;margin-bottom:12px;}',
      '  .h2x-pagemenu-row label{font-size:12px;color:var(--c-text-2);flex:none;}',
      '  .h2x-pages{flex:1;min-width:0;padding:6px 8px;border:1px solid var(--c-border);border-radius:var(--r-s);font:13px/1.2 -apple-system,"Segoe UI",sans-serif;color:var(--c-text);background:var(--c-input);outline:none;box-sizing:border-box;}',
      '  .h2x-pages:focus{border-color:var(--c-info);}',
      '  .h2x-pages::-webkit-outer-spin-button,.h2x-pages::-webkit-inner-spin-button{-webkit-appearance:none;margin:0;}',
      '  .h2x-pages::placeholder{color:var(--c-text-3);}',
      '  .h2x-pageunit{font-size:12px;color:var(--c-text-2);flex:none;width:14px;text-align:center;}',
      '  .h2x-pagemenu-actions{display:flex;gap:8px;justify-content:flex-end;}',
      '  .h2x-pagemenu-actions .h2x-btn{font-size:12px;padding:5px 12px;}',
      '  .h2x-toasts{position:fixed;top:16px;right:16px;display:flex;flex-direction:column;gap:8px;z-index:1;pointer-events:none;font:13px/1.4 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif;}',
      '  .h2x-toast{pointer-events:auto;display:flex;align-items:center;gap:11px;max-width:min(460px,86vw);padding:11px 14px 11px 12px;border-radius:var(--r);background:var(--c-bg);color:var(--c-text);box-shadow:0 6px 24px rgba(0,0,0,.32);animation:h2x-in .18s ease-out;border-left:4px solid var(--c-info);font-weight:600;}',
      '  .h2x-toast-ico{flex:none;width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;background:var(--c-info);font:700 13px/22px -apple-system,"Segoe UI",sans-serif;text-align:center;}',
      '  .h2x-toast-info{background:linear-gradient(0deg,rgba(25,118,210,.10),rgba(25,118,210,.10)),var(--c-bg);}',
      '  .h2x-toast-success{border-left-color:var(--c-primary);background:linear-gradient(0deg,rgba(46,125,50,.10),rgba(46,125,50,.10)),var(--c-bg);}',
      '  .h2x-toast-success .h2x-toast-ico{background:var(--c-primary);}',
      '  .h2x-toast-warn{border-left-color:var(--c-warn);background:linear-gradient(0deg,rgba(141,110,0,.12),rgba(141,110,0,.12)),var(--c-bg);}',
      '  .h2x-toast-warn .h2x-toast-ico{background:var(--c-warn);}',
      '  .h2x-toast-error{border-left-color:var(--c-danger);background:linear-gradient(0deg,rgba(198,40,40,.10),rgba(198,40,40,.10)),var(--c-bg);}',
      '  .h2x-toast-error .h2x-toast-ico{background:var(--c-danger);}',
      '  .h2x-toast-msg{flex:1;min-width:0;color:var(--c-text);}',
      '  .h2x-toast-btn{padding:3px 10px;border:1px solid var(--c-border);border-radius:var(--r-s);background:var(--c-bg);color:var(--c-text-2);cursor:pointer;font:12px/1.4 -apple-system,"Segoe UI",sans-serif;}',
      '  .h2x-toast-btn:hover{border-color:var(--c-primary);color:var(--c-primary);}',
      '  .h2x-toast-x{border:none;background:none;color:var(--c-text-3);cursor:pointer;font:16px/1 -apple-system,"Segoe UI",sans-serif;padding:0 2px;}',
      '  .h2x-toast-x:hover{color:var(--c-text);}',
      '  button:focus-visible,select:focus-visible,input:focus-visible{outline:2px solid var(--c-info);outline-offset:1px;}',
      '  @keyframes h2x-in{from{opacity:0;transform:translateY(-8px);}}',
      '  @media (prefers-reduced-motion: reduce){:host *{animation:none!important;transition:none!important;}}',
      '</style>',
      '<div class="h2x-hover" hidden></div>',
      '<div class="h2x-bar">',
      '  <span class="h2x-hint"></span>',
      '  <span class="h2x-count">已选 <b>0</b> 个</span>',
      '  <input class="h2x-name" type="text" spellcheck="false" />',
      '  <select class="h2x-ext" title="导出格式">' +
      Object.keys(FORMATS).map(k => '<option value="' + k + '">' + FORMATS[k].label + ' (.' + FORMATS[k].ext + ')</option>').join('') +
      '</select>',
      '  <div class="h2x-actions">',
      '    <button class="h2x-btn h2x-split" disabled>列设置</button>',
      '    <div class="h2x-pagewrap">',
      '      <button type="button" class="h2x-btn h2x-pagebtn" aria-haspopup="dialog" aria-expanded="false" disabled title="自动翻页采集已选中表格：点开可设置页数上限，识别不到分页器时可指定翻页按钮">采集全部页<i class="h2x-care" aria-hidden="true">▾</i></button>',
      '      <div class="h2x-pagemenu" role="dialog" aria-label="分页采集设置" hidden>',
      '        <div class="h2x-pagemenu-title">分页采集</div>',
      '        <div class="h2x-pagemenu-sub">留空则采集全部页；识别不到分页器时会提示手动指定「下一页」按钮</div>',
      '        <div class="h2x-pagemenu-row">',
      '          <label for="h2x-pages">页数上限</label>',
      '          <input class="h2x-pages" id="h2x-pages" type="number" min="1" step="1" placeholder="全部" title="只采集前 N 页，留空 = 全部页" aria-label="采集页数上限（留空为全部页）" />',
      '          <span class="h2x-pageunit">页</span>',
      '        </div>',
      '        <div class="h2x-pagemenu-actions">',
      '          <button type="button" class="h2x-btn h2x-ghost h2x-pagecancel">取消</button>',
      '          <button type="button" class="h2x-btn h2x-primary h2x-pagego">开始采集</button>',
      '        </div>',
      '      </div>',
      '    </div>',
      '    <button class="h2x-btn h2x-primary" disabled></button>',
      '    <button class="h2x-btn h2x-ghost">取消 (Esc)</button>',
      '  </div>',
      '</div>',
      '<div class="h2x-toasts"></div>'
    ].join('');

    hoverBox = root.querySelector('.h2x-hover');
    countEl = root.querySelector('.h2x-count b');
    nameInput = root.querySelector('.h2x-name');
    fmtSel = root.querySelector('.h2x-ext');
    // v2.5.2 修复：下拉面板内「开始采集/取消」也带 h2x-primary/h2x-ghost 类且 DOM 在前，
    // 裸类名查询会错绑到面板按钮（导出文案与点击监听跑到对话框里、真按钮空白死掉）——限定工具栏直系子级
    exportBtn = root.querySelector('.h2x-actions > .h2x-primary');
    cancelBtn = root.querySelector('.h2x-actions > .h2x-ghost');
    hintEl = root.querySelector('.h2x-hint');
    splitBtn = root.querySelector('.h2x-split');
    pageWrap = root.querySelector('.h2x-pagewrap');
    pageBtn = root.querySelector('.h2x-pagebtn');
    pageMenu = root.querySelector('.h2x-pagemenu');
    pagesInput = root.querySelector('.h2x-pages');
    pageGoBtn = root.querySelector('.h2x-pagego');
    pageCancelBtn = root.querySelector('.h2x-pagecancel');
    toastRoot = root.querySelector('.h2x-toasts');
    exportBtn.addEventListener('click', doExport);
    // v2.0：采集中「取消」变「停止采集」（只作废当前任务，不退出选择模式）
    cancelBtn.addEventListener('click', () => { collecting ? stopCollect() : exit(); });
    splitBtn.addEventListener('click', openPanel);
    // v2.5.2：下拉展开——点按钮开合设置面板；「开始采集」/槽内 Enter 触发采集
    pageBtn.addEventListener('click', togglePageMenu);
    pageGoBtn.addEventListener('click', () => { closePageMenu(); onCollectAllPages(); });
    pageCancelBtn.addEventListener('click', closePageMenu);
    pagesInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); closePageMenu(); onCollectAllPages(); } });
    // 格式切换：导出按钮文案同步（文件名扩展名在导出时按格式追加）
    fmtSel.addEventListener('change', syncExportBtn);

    nameInput.value = sanitizeFilename(document.title) + '_' + timestamp();
  }

  // 导出按钮文案与格式下拉同步（含「导出中…」结束后的恢复）
  function syncExportBtn() {
    if (exporting) return; // 导出中保持「导出中…」，结束时统一恢复
    exportBtn.textContent = '导出 ' + (FORMATS[fmtSel.value] || FORMATS.xlsx).label;
  }

  /* ---------------- Toast 反馈系统（v2.0） ---------------- */

  /** 结果性通知：成功/信息 2.5s 自动消失（可经 duration 覆盖，如链接拦截提示 4s），
   *  警示（warn）琥珀色，错误常驻 + 关闭钮；同屏最多 3 条。
   *  v2.4 视觉强化：语义色圆形图标徽标 + 底色浅色渲染 + 文案加粗（远比纯白底
   *  小字醒目）；返回句柄 { update(msg), close() } 供进度型 toast 复用同一条。
   *  hint 只保留引导与进行时文案（默认提示、采集进度、导出中），结果全部走 toast */
  const TOAST_ICONS = { success: '✓', error: '✕', warn: '!', info: 'i' };
  function toast(msg, opts) {
    opts = opts || {};
    const type = opts.type || 'info';
    const box = document.createElement('div');
    box.className = 'h2x-toast h2x-toast-' + type;
    box.setAttribute('role', type === 'error' ? 'alert' : 'status');
    const ico = document.createElement('span');
    ico.className = 'h2x-toast-ico';
    ico.setAttribute('aria-hidden', 'true');
    ico.textContent = TOAST_ICONS[type] || TOAST_ICONS.info;
    box.appendChild(ico);
    const msgEl = document.createElement('span');
    msgEl.className = 'h2x-toast-msg';
    msgEl.textContent = msg;
    box.appendChild(msgEl);
    let timer = 0;
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      if (timer) clearTimeout(timer);
      box.remove();
    };
    (opts.actions || []).forEach((a) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'h2x-toast-btn';
      btn.textContent = a.label;
      btn.addEventListener('click', () => { close(); if (a.onClick) a.onClick(); });
      box.appendChild(btn);
    });
    if (type === 'error') {
      const x = document.createElement('button');
      x.type = 'button';
      x.className = 'h2x-toast-x';
      x.setAttribute('aria-label', '关闭');
      x.textContent = '×';
      x.addEventListener('click', close);
      box.appendChild(x);
    }
    toastRoot.appendChild(box);
    while (toastRoot.children.length > 3) toastRoot.firstElementChild.remove();
    if (type !== 'error' && !opts.sticky) {
      timer = setTimeout(close, opts.duration || 2500);
    }
    return {
      update: (m) => { if (!closed) msgEl.textContent = m; },
      close: close
    };
  }

  // 工具栏提示统一入口：文案 + 语义色（默认灰）；引导/进行时文案经此写入
  function setHint(msg, color) {
    hintEl.textContent = msg;
    hintEl.style.color = color || '#666';
  }

  function resetHint() {
    setHint(hasTables ? '点击选择表格（可多选）' : '页面未找到表格');
  }

  /* ---------------- 事件处理 ---------------- */

  /** 命中解析：目标最近的 table → 逻辑表格根。组件库分体结构（表头/表体两个
   *  table，如 Element Plus el-table / Ant Design Vue Table）返回其包装容器，
   *  使悬浮高亮、点选、导出三者始终识别为同一个表格；div 网格表格（el-table-v2 /
   *  AG Grid / MUI DataGrid / Tabulator，无 table 元素）经 ns.table.gridRootOf
   *  返回组件根（单元格内嵌传统 table 时优先命中内层 table，可独立选中） */
  function hitRoot(target) {
    const t = target.closest('table');
    if (t) {
      const g = splitGroupOf(t);
      return g ? g.root : t;
    }
    return gridRootOf(target);
  }

  function onMouseOver(e) {
    if (!active || collecting || !(e.target instanceof Element)) return;
    if (specifying) { // v2.5 子模式：高亮任意元素（翻页按钮不一定是表格，也不在表格内）
      if (e.composedPath().includes(host)) { hoverBox.hidden = true; return; } // 工具栏自身不高亮
      positionBox(hoverBox, e.target);
      return;
    }
    const table = hitRoot(e.target);
    if (table) { hoverTable = table; positionBox(hoverBox, table); }
    else { hoverTable = null; hoverBox.hidden = true; }
  }

  /** v2.4：点击放行选择模式（原为全拦截）。三类点击区别对待：
   *  1. 命中表格 → 选中/取消（拦截默认行为，防触发表格自身交互）
   *  2. 命中链接 a[href] → 拦截导航（选表期间误触跳转会丢失整个选择会话），
   *     toast 提示而非静默吞掉
   *  3. 其余点击 → 放行给页面（翻页/筛选/切 Tab 等交互正常可用），
   *     随后清理已被页面交互移除的选中表格 */
  function onClickCapture(e) {
    if (!active) return;
    // 工具栏自身的点击不拦截（按钮/输入框正常工作）
    if (e.composedPath().includes(host)) return;
    if (!pageMenu.hidden) closePageMenu(); // v2.5.2 点击页面处收拢下拉面板
    if (collecting) {
      if (isPagingClick(e)) return; // v2.5：翻页按钮的编程式点击放行（分页器常为 a[href]，拦截则翻页永不发生）
      // 采集滚动/翻页中仍全拦截（防误操作打断采集），但给点击反馈（2s 节流）
      e.preventDefault();
      e.stopPropagation();
      const now = Date.now();
      if (now - lastBlockHint > 2000) {
        lastBlockHint = now;
        toast('正在采集滚动数据，可点「停止采集」中止', { type: 'info' });
      }
      return;
    }
    if (specifying) { // v2.5 子模式：拦截所有点击（含链接，防误跳转），记录目标后开始翻页采集
      e.preventDefault();
      e.stopPropagation();
      const el = e.target instanceof Element ? e.target : null;
      // 就近取可点击元素（按钮/链接/角色按钮），取不到用目标本身
      const btn = el && (el.closest('button, a, [role="button"]') || el);
      exitSpecify();
      const table = [...selected.keys()].pop();
      if (btn && table && table.isConnected) startPagedCollect(table, manualPager(btn));
      else if (btn) toast('已选表格已不在页面上，请重新选择后再采集', { type: 'warn' });
      return;
    }
    const el = e.target instanceof Element ? e.target : null;
    const table = el && hitRoot(el);
    if (table) {
      e.preventDefault();
      e.stopPropagation();
      toggleSelect(table);
      return;
    }
    const link = el && el.closest('a[href]');
    if (link) {
      e.preventDefault();
      e.stopPropagation();
      // 就地红框高亮被拦的链接（用户视线在点击处，右上角 toast 单独出现易被忽略）
      flashLink(link);
      toast('选择模式下链接已停用，Esc 退出后可跳转', { type: 'warn', duration: 4000 });
      return;
    }
    pruneDetached(); // 放行的点击可能触发翻页/筛选替换 DOM，同步剔除断开的选中项
  }

  /** v2.4：剔除已断开 DOM 的选中表格（页面交互翻页/刷新后表格节点被替换）。
   *  scroll/resize 的 onReposition 只在滚动时触发，点击放行后需主动兜底。
   *  导出中跳过（doExport 迭代间隙的剔除会清掉未迭代表的拆分/筛选配置，
   *  且导出表格列表已快照——见 doExport）；移除时 toast 告知（不然只有底部
   *  计数变化，用户视线在页面中央根本看不到） */
  function pruneDetached() {
    if (exporting) return;
    let removed = 0;
    for (const table of [...selected.keys()]) {
      if (!table.isConnected) { removeSelected(table); removed++; }
    }
    if (removed) {
      toast('已选表格已被页面刷新移除' + (removed > 1 ? '（' + removed + ' 个）' : ''), { type: 'warn' });
    }
  }

  /** v2.4：被拦截的链接就地红框闪烁 ~1s。内联样式经 !important 覆盖页面样式，
   *  完事后还原元素原有内联 outline（页面元素未被污染；扩展退出不留痕） */
  function flashLink(link) {
    const prevOutline = link.style.getPropertyValue('outline');
    const prevOffset = link.style.getPropertyValue('outline-offset');
    link.style.setProperty('outline', '3px solid #c62828', 'important');
    link.style.setProperty('outline-offset', '2px', 'important');
    setTimeout(() => {
      link.style.removeProperty('outline');
      link.style.removeProperty('outline-offset');
      if (prevOutline) link.style.setProperty('outline', prevOutline);
      if (prevOffset) link.style.setProperty('outline-offset', prevOffset);
    }, 1000);
  }

  function onKeyDown(e) {
    if (!active) return;
    if (panel.isOpen()) {
      // 面板打开时：Esc 只关面板；Enter 保存（焦点在按钮/下拉上时走默认行为）
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        panel.close();
      } else if (e.key === 'Enter' && !e.isComposing) {
        const focused = host.shadowRoot && host.shadowRoot.activeElement;
        if (focused && (focused.tagName === 'BUTTON' || focused.tagName === 'SELECT')) return;
        e.preventDefault();
        e.stopPropagation();
        panel.save();
      }
      return;
    }
    if (specifying) { // v2.5 子模式：Esc 只退出子模式（不退出选择模式），其余按键不触发快捷键
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        exitSpecify();
      }
      return;
    }
    if (e.key === 'Escape') {
      if (!pageMenu.hidden) { // v2.5.2 下拉优先：点开未采时 Esc 只收拢面板
        e.preventDefault();
        e.stopPropagation();
        closePageMenu();
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      exit();
    } else if (e.key === 'Enter' && !e.isComposing && !collecting && !exporting) {
      // 焦点在工具栏按钮/输入框/下拉上时，Enter 走默认行为（按钮 click / 输入框采集），不触发导出
      const focused = host.shadowRoot && host.shadowRoot.activeElement;
      if (focused && (focused.tagName === 'BUTTON' || focused.tagName === 'INPUT' || focused.tagName === 'SELECT')) return;
      // v2.4：点击放行后页面元素可持有焦点（输入框/链接等）——此时 Enter
      // 属于页面交互，不触发导出快捷键；焦点在 body/本扩展 UI 时保留
      const ae = document.activeElement;
      if (ae && ae !== document.body && ae !== document.documentElement && ae !== host) return;
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
        // v2.5：翻页采集期间表格可能被页面整段重建（暂时失联），采集结束后
        // 由 startPagedCollect 迁移选中到新根，此处不提前剔除
        else if (!collecting) removeSelected(table);
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
    restoreFromPersist(table); // 持久化恢复：按表指纹回填该表的拆分规则/列筛选
    updateBar();
  }

  /** 持久化恢复：把已保存的拆分规则/列筛选/列格式回填内存 Map（幂等：已有会话
   *  配置不覆盖，面板保存后重选也拿到最新值——removeSelected 只清内存不清存储）。
   *  选中表格时调用；导出/面板入口再兜底一次注入初期的存储加载竞态 */
  function restoreFromPersist(table) {
    if (splitRules.has(table) || colFilters.has(table) || colFormats.has(table)) return;
    const saved = persist.getSaved(table);
    if (!saved || (!saved.rules.length && !saved.excluded.size && !saved.formats.size)) return;
    if (saved.rules.length) splitRules.set(table, saved.rules);
    if (saved.excluded.size) colFilters.set(table, saved.excluded);
    if (saved.formats.size) colFormats.set(table, saved.formats);
    toast('已恢复上次的列设置', { type: 'info' });
    updateBar(); // 「列设置」徽标点状态同步
  }

  /** 打开列设置面板：先兜底持久化加载与恢复（面板读取 splitRules 显示已保存状态） */
  async function openPanel() {
    await persist.ready();
    for (const table of selected.keys()) restoreFromPersist(table);
    panel.open(); // 自身守卫（面板已开/采集中/未选中）
  }

  function removeSelected(table) {
    const box = selected.get(table);
    if (box) box.remove();
    selected.delete(table);
    snapshots.delete(table); // 虚拟表快照随取消失效，重选时重新采集最新数据
    splitRules.delete(table); // 会话内配置随取消失效（持久化记录保留，重选时自动恢复）
    colFilters.delete(table);
    colFormats.delete(table);
    panel.onTableRemoved(table); // 面板草稿同步删除；面板正在编辑该表则直接关闭
    updateBar();
  }

  async function startCollect(table) {
    if (collecting) return;
    collecting = true;
    const gen = ++genToken;
    hoverBox.hidden = true;
    exportBtn.disabled = true;
    splitBtn.disabled = true;
    cancelBtn.textContent = '停止采集'; // v2.0：采集中可中止（不退出选择模式）
    setHint('虚拟表格采集滚动中…', '#1976d2');
    try {
      const snap = await collectVirtual(
        table,
        (n) => { if (gen === genToken) setHint('虚拟表格采集滚动中… 已采集 ' + n + ' 行', '#1976d2'); },
        () => !active || gen !== genToken
      );
      if (!active || gen !== genToken) return; // 已退出/已作废（含「停止采集」）
      snapshots.set(table, snap);
      addSelected(table);
      toast('采集完成，共 ' + snap.rows.length + ' 行（含表头）', { type: 'success' });
      resetHint();
    } catch (err) {
      console.error('[HTML2XLSX] 虚拟表格采集失败：', err);
      toast('采集失败：' + (err && err.message ? err.message : err), { type: 'error' });
      resetHint();
    } finally {
      collecting = false;
      cancelBtn.textContent = '取消 (Esc)';
      updateBar();
    }
  }

  /** v2.0：停止当前虚拟采集——genToken 作废进行中任务（collectVirtual 回 null、
   *  快照不写入、表格不选中）；不退出选择模式，按钮与提示随后由 finally 恢复。
   *  v2.5 起同样作用于分页翻页采集（collectPaged 同款令牌检查点） */
  function stopCollect() {
    genToken++;
    toast('已停止采集', { type: 'info' });
    resetHint();
  }

  /* ---------------- 分页表格全页采集（v2.5） ---------------- */

  /** v2.5.2 下拉面板开合：主按钮「采集全部页」展开设置层（页数上限 + 确认），
   *  点开即聚焦页数槽（选中已有值），再点按钮/外部/ Esc 收起。面板打开只改
   *  UI 状态，不进入选择模式；「开始采集」才触发 onCollectAllPages */
  function openPageMenu() {
    if (pageBtn.disabled) return;
    pageMenu.hidden = false;
    pageWrap.classList.add('h2x-open');
    pageBtn.setAttribute('aria-expanded', 'true');
    pagesInput.focus();
    pagesInput.select();
  }
  function closePageMenu() {
    pageMenu.hidden = true;
    pageWrap.classList.remove('h2x-open');
    pageBtn.setAttribute('aria-expanded', 'false');
  }
  function togglePageMenu() {
    pageMenu.hidden ? openPageMenu() : closePageMenu();
  }

  /** 「采集全部页」入口：取最后选中的表。组件分页器（el-pagination /
   *  ant-pagination，pagination.js 适配器）识别到直接采集；识别不到进入
   *  「指定翻页按钮」子模式兜底（用户点击下一页控件，跨页经定位器重解析）。
   *  虚拟滚动表格不经此入口（点选时已自动滚动采集） */
  function onCollectAllPages() {
    if (collecting || exporting || panel.isOpen() || specifying || !selected.size) return;
    const table = [...selected.keys()].pop(); // 最后选中的表（与用户直觉一致）
    if (isVirtualTable(table)) {
      toast('虚拟滚动表格点选时已自动采集全部行', { type: 'info' });
      return;
    }
    const pager = detectPager(table);
    if (pager) { startPagedCollect(table, pager); return; }
    enterSpecify();
  }

  /** 「指定翻页按钮」子模式：悬浮高亮任意元素（不限表格），点击记录为目标
   *  按钮后开始全页采集；Esc 取消，不破坏已有选区。交互骨架与选择模式同构 */
  function enterSpecify() {
    specifying = true;
    hoverTable = null;
    hoverBox.hidden = true;
    setHint('未识别到分页器，请点击「下一页」按钮（Esc 取消）', '#1976d2');
    updateBar();
  }

  function exitSpecify() {
    if (!specifying) return;
    specifying = false;
    hoverBox.hidden = true;
    resetHint();
    updateBar();
  }

  /** 分页全页采集（对齐虚拟采集交互：进度 hint、「停止采集」可中止、完成快照
   *  入 snapshots 供导出与列设置取样）。页数输入框非空时只采集指定页数（留空
   *  全部页）；「停止采集」保留已采集的页写入快照（退出选择模式才整体丢弃）。
   *  翻页中表格根被页面重建时，选中与配置迁移到新根（removeSelected +
   *  addSelected，persist 记录按指纹自动恢复） */
  async function startPagedCollect(table, pager) {
    if (collecting) return;
    collecting = true;
    const gen = ++genToken;
    hoverBox.hidden = true;
    exportBtn.disabled = true;
    splitBtn.disabled = true;
    closePageMenu(); // v2.5.2 采集中收拢下拉并禁用主按钮（updateBar 同步）
    pageBtn.disabled = true;
    cancelBtn.textContent = '停止采集'; // 复用虚拟采集的中止交互
    setHint('分页采集翻页中…', '#1976d2');
    // 页数上限：输入框留空/非法值 = 0 = 采集全部页
    const n = parseInt(pagesInput.value, 10);
    const maxPages = (Number.isFinite(n) && n >= 1) ? n : 0;
    try {
      const res = await collectPaged(
        table, pager,
        (page, n) => { if (gen === genToken) setHint('分页采集翻页中… 第 ' + page + ' 页，已采集 ' + n + ' 行', '#1976d2'); },
        () => !active || gen !== genToken,
        maxPages
      );
      if (!active) return; // 已退出选择模式：丢弃
      // gen !== genToken = 「停止采集」：collectPaged 返回已采集页的部分结果，照常写入快照
      if (res) {
        const key = (res.root && res.root.isConnected) ? res.root : table;
        if (key !== table && selected.has(table)) removeSelected(table); // 表格被重建：迁移选中
        snapshots.set(key, res.snap); // 重采覆盖旧快照
        if (!selected.has(key)) addSelected(key);
        toast('采集完成，共 ' + res.snap.rows.length + ' 行（含表头）' +
          (res.note ? '，' + res.note : ''), { type: res.note ? 'info' : 'success' });
      }
      resetHint();
    } catch (err) {
      console.error('[HTML2XLSX] 分页采集失败：', err);
      toast('采集失败：' + (err && err.message ? err.message : err), { type: 'error' });
      resetHint();
    } finally {
      collecting = false;
      cancelBtn.textContent = '取消 (Esc)';
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
    const busy = collecting || exporting || panel.isOpen() || specifying; // 面板/导出/子模式期间主工具栏同步禁用
    exportBtn.disabled = busy || selected.size === 0;
    splitBtn.disabled = busy || selected.size === 0;
    const pageOff = busy || selected.size === 0; // 下拉主按钮禁用（采集中/面板/导出/子模式或未选中）
    pageBtn.disabled = pageOff;
    pageBtn.setAttribute('aria-disabled', pageOff ? 'true' : 'false');
    pagesInput.disabled = pageOff;
    if (pageOff) closePageMenu();
    // v2.0：已选表中存在拆分/筛选/格式配置 → 「列设置」按钮带徽标点
    let cfg = false;
    for (const tb of selected.keys()) {
      if (splitRules.has(tb) || colFilters.has(tb) || colFormats.has(tb)) { cfg = true; break; }
    }
    splitBtn.classList.toggle('h2x-has-cfg', cfg);
  }

  function positionBox(box, table) {
    const r = table.getBoundingClientRect();
    box.style.left = (r.left + window.scrollX) + 'px';
    box.style.top = (r.top + window.scrollY) + 'px';
    box.style.width = r.width + 'px';
    box.style.height = r.height + 'px';
    // v2.0：选中框徽标在表格贴视口左/上边缘时翻到内侧，避免出屏
    if (box.classList.contains('h2x-sel')) {
      box.classList.toggle('h2x-flip-x', r.left < 12);
      box.classList.toggle('h2x-flip-y', r.top < 12);
    }
    box.hidden = false;
  }

  /* ---------------- 导出 ---------------- */

  /** ArrayBuffer → base64：FileReader 原生编码（data URL 截到首个逗号），
   *  大文件显著快于分块 String.fromCharCode 拼接 */
  function arrayBufferToBase64(buf) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => {
        const s = String(fr.result);
        resolve(s.slice(s.indexOf(',') + 1));
      };
      fr.onerror = () => reject(fr.error || new Error('base64 编码失败'));
      fr.readAsDataURL(new Blob([buf]));
    });
  }

  /** 让出主线程一拍：多表导出的逐表间隙调用，生成期间页面可交互不冻结。
   *  MessageChannel 而非 setTimeout：后台标签页的定时器被节流（1s+）会拖慢导出 */
  const yieldToMain = () => new Promise((resolve) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => resolve();
    ch.port2.postMessage(0);
  });

  function downloadViaBlob(buf, name, mime) {
    const blob = new Blob([buf], { type: mime });
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
    toast(msg, { type: 'error' }); // v2.0：错误常驻可关（迁出 hint 行）
  }

  /** v2.0：导出成功保留选择（不再 0.6s 自动退出）——toast 给「退出」动作，
   *  用户可换格式连续导出；Esc / 取消 / toast 退出三条路径均可退出 */
  function finish(n) {
    toast(n > 1 ? '已下载 ' + n + ' 个文件' : '已开始下载…', {
      type: 'success',
      actions: [{ label: '退出', onClick: exit }]
    });
  }

  /** 导出 aoa 组装：先应用列拆分，再按排除集过滤列（列筛选），最后按列格式数值化
   *  （数字列数据行转数值；文本为默认行为不处理）。含合并单元格的表格跳过筛选
   *  （!merges 列号基于原始 aoa，过滤会错位；面板已禁用），列格式仍生效（不涉
   *  及列重排，layout 对 merges 表同样给出原列映射） */
  function buildAoa(ch, table) {
    const rules = splitRules.get(table);
    const layout = columnLayout(ch, rules);
    const excluded = colFilters.get(table);
    let aoa = applyColumnSplits(ch, rules);
    if (!(ch.merges && ch.merges.length)) {
      aoa = filterColumns(aoa, layout, excluded);
    }
    const formats = colFormats.get(table);
    if (formats && formats.size) {
      aoa = applyColFormats(aoa, formatColumns(layout, colKeys(ch), excluded, formats), ch.headerRows || 0);
    }
    return aoa;
  }

  /** 导出文件名：base + 可选表名后缀 + 按格式补扩展名（chrome.downloads 不允许以点开头） */
  function fileNamed(base, fmt, suffix) {
    let name = suffix ? base + '_' + sanitizeFilename(suffix) : base;
    if (!new RegExp('\\.' + fmt.ext + '$', 'i').test(name)) name += '.' + fmt.ext;
    return name.replace(/^\.+/, '');
  }

  /** 表单元 → xlsx 单文件（merges 与列宽随原逻辑） */
  function buildXlsxFile(tables, base) {
    if (typeof XLSX === 'undefined') throw new Error('XLSX 库未加载');
    const fmt = FORMATS.xlsx;
    const wb = XLSX.utils.book_new();
    for (const t of tables) {
      const ws = XLSX.utils.aoa_to_sheet(t.aoa);
      if (t.merges) ws['!merges'] = t.merges;
      ws['!cols'] = autoColWidths(t.aoa); // 列宽随内容自适应（上下限钳制，见 split.js）
      XLSX.utils.book_append_sheet(wb, ws, t.name);
    }
    return {
      name: fileNamed(base, fmt, ''),
      mime: fmt.mime,
      buf: XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
    };
  }

  /** 表单元 → 文本格式文件列表：CSV 多表拆多文件（单文件无法承载多表）；
   *  json/md/html 汇总为单文件（多表经表名分区/嵌套） */
  function buildTextFiles(fmtKey, base, tables) {
    const fmt = FORMATS[fmtKey];
    const enc = new TextEncoder();
    if (fmtKey === 'csv') {
      return tables.map(t => ({
        name: fileNamed(base, fmt, tables.length > 1 ? t.name : ''),
        mime: fmt.mime,
        buf: enc.encode(toCsv(t.aoa))
      }));
    }
    let text;
    if (fmtKey === 'json') text = toJson(tables);
    else if (fmtKey === 'md') text = toMarkdown(tables);
    else text = toHtmlDocument(tables, base);
    return [{ name: fileNamed(base, fmt, ''), mime: fmt.mime, buf: enc.encode(text) }];
  }

  /** 单文件下载：base64 经后台 chrome.downloads（不受页面 CSP 限制），失败回退 blob */
  function downloadFile(b64, file) {
    return new Promise((resolve) => {
      const fallback = (e) => {
        console.error('[HTML2XLSX] 后台下载失败，回退 blob 下载：', e);
        downloadViaBlob(file.buf, file.name, file.mime);
        resolve();
      };
      try {
        chrome.runtime.sendMessage(
          { type: 'html2xlsx-download', data: b64, filename: file.name, mime: file.mime },
          (resp) => {
            const err = chrome.runtime.lastError;
            if (!err && resp && resp.ok) { resolve(); return; }
            fallback(err || resp);
          }
        );
      } catch (err) {
        // 扩展上下文失效（如开发中重新加载了扩展）时 sendMessage 会同步抛错
        fallback(err);
      }
    });
  }

  async function doExport() {
    if (exporting || collecting || !selected.size) return;
    exporting = true; // await 让出主线程期间按钮未禁用，防重入（原同步链路天然互斥）
    // v2.0：导出中按钮反馈（防点击被静默吞掉）+ 进行时提示
    exportBtn.disabled = true;
    exportBtn.textContent = '导出中…';
    setHint('正在生成导出文件…', '#1976d2');
    try {
      await persist.ready(); // 兜底注入初期的存储加载竞态（正常情况早已就绪）
      if (collecting || !selected.size) return; // await 期间状态可能变化
      for (const table of selected.keys()) restoreFromPersist(table);

      // 1. 逐表取数（列拆分/列筛选/列格式已在 buildAoa 应用），组装与 Sheet 名同源的表单元。
      //    v2.4：迭代前快照表格列表——逐表 yieldToMain 让出主线程期间，点击放行
      //    触发的 pruneDetached 会改写 selected Map（迭代中途变更 + 配置被清），
      //    快照后导出范围在开始一刻锁定（prune 在 exporting 期间被跳过）
      const list = [...selected.keys()];
      const tables = [];
      const used = new Set();
      let i = 0;
      for (const table of list) {
        if (!active) return; // yield 间隙用户可能已退出，放弃导出
        let aoa, headerRows, merges = null;
        if (snapshots.has(table)) {
          // 虚拟滚动表格：使用采集到的全量快照
          const snap = snapshots.get(table);
          aoa = buildAoa(snap, table);
          headerRows = snap.headerRows || 0;
        } else {
          const ex = extractTable(table);
          aoa = buildAoa(ex, table);
          headerRows = ex.headerRows || 0;
          if (ex.merges.length) merges = ex.merges; // 仅 xlsx 使用（文本格式为平面数据）
        }
        tables.push({ name: makeSheetName(table, i++, used), aoa: aoa, headerRows: headerRows, merges: merges });
        await yieldToMain(); // 每表之间让出主线程：多表/大表导出期间页面不冻结
      }

      // 2. 按所选格式生成下载文件列表（CSV 多表为多文件，其余单文件）
      const fmtKey = FORMATS[fmtSel.value] ? fmtSel.value : 'xlsx';
      const base = sanitizeFilename(nameInput.value) || ('export_' + timestamp());
      let files;
      try {
        files = fmtKey === 'xlsx' ? [buildXlsxFile(tables, base)] : buildTextFiles(fmtKey, base, tables);
      } catch (err) {
        console.error('[HTML2XLSX] 生成导出文件失败：', err);
        showError('导出失败：' + (err && err.message ? err.message : err));
        return;
      }

      // 3. 逐文件编码下载（后台 downloads 优先，失败回退 blob）；
      //    v2.0：多文件时 toast 实时进度「正在下载 i/n」
      let pt = null;
      if (files.length > 1) pt = toast('正在下载 1/' + files.length + '…', { type: 'info', sticky: true });
      for (let fi = 0; fi < files.length; fi++) {
        if (!active) return; // 编码间隙用户已退出，放弃下载
        if (pt) pt.update('正在下载 ' + (fi + 1) + '/' + files.length + '…');
        await downloadFile(await arrayBufferToBase64(files[fi].buf), files[fi]);
        await yieldToMain();
      }
      if (pt) pt.close();
      finish(files.length);
    } finally {
      exporting = false;
      syncExportBtn(); // 恢复按钮文案（导出中… → 导出 <格式>）
      updateBar();
      if (active) resetHint();
    }
  }

  /* ---------------- 退出与清理 ---------------- */

  function exit() {
    if (!active) return;
    active = false;
    genToken++; // 使进行中的采集任务失效
    specifying = false;
    document.removeEventListener('mouseover', onMouseOver, true);
    document.removeEventListener('click', onClickCapture, true);
    document.removeEventListener('keydown', onKeyDown, true);
    document.removeEventListener('scroll', onReposition, true);
    window.removeEventListener('resize', onReposition);
    if (rafId) cancelAnimationFrame(rafId);
    if (host) host.remove();
    selected.clear();
    snapshots.clear();
    splitRules.clear(); // 只清会话内存（持久化记录在 chrome.storage，重进选择模式自动恢复）
    colFilters.clear();
    colFormats.clear();
    panel.reset();
    window.__html2xlsx = null;
  }

  window.__html2xlsx = { toggle: exit };

  /* ---------------- 启动 ---------------- */

  buildUI();
  // v2.0：页面无表格时默认提示切换为「页面未找到表格」（动态加载不主动监测）；
  // v2.1 起 div 网格表格一并计入（v2.2 经 ns.table.GRID_ROOT_SELECTOR 覆盖全部适配组件）
  hasTables = document.querySelectorAll('table, ' + GRID_ROOT_SELECTOR).length > 0;
  syncExportBtn();
  updateBar(); // 初始按钮态走同一状态机（未选表时列设置/采集全部页/导出一并禁用）
  resetHint();
  if (!hasTables) {
    // v2.4：无表格页面只在底部 hint 留小字不够醒目，补一条警示 toast
    toast('页面未找到表格，无法选择导出', { type: 'warn', duration: 4000 });
  }
  // 装配列设置面板依赖（host/Maps 为稳定引用；可变状态经 getter 读取）
  panel.init({
    host: host,
    selected: selected,
    snapshots: snapshots,
    splitRules: splitRules,
    colFilters: colFilters,
    colFormats: colFormats,
    isBusy: () => collecting,
    isAlive: () => active,
    updateBar: updateBar,
    toast: toast
  });
  document.addEventListener('mouseover', onMouseOver, true);
  document.addEventListener('click', onClickCapture, true);
  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('scroll', onReposition, true);
  window.addEventListener('resize', onReposition);
})();