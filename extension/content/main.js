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
 * v2.5.3：分页采集限定单表——多选（≥2）时「采集全部页」按钮禁用，title
 * 动态提示「多表选择时不支持分页采集」；目标表唯一，无歧义
 * v2.6.1：工具栏「中文 | EN」语言开关——手动指定界面语言（偏好持久化，默认
 * 跟随浏览器）；切换后静态文案就地重取词（提示/按钮/下拉/分页面板），进行时与
 * 导出内容文案均经 t() 动态取词同源生效
 * v2.7：剪贴板输出与选择管理——「输出方式」下拉新增「复制为表格 (TSV)」/
 * 「复制为 Markdown」（复用导出链路，只把落盘换成写剪贴板，列设置同样生效）；
 * 已选计数旁「✕」一键清空已选（不退出选择模式）
 * v2.8：导出可中止与列顺序——「取消」按钮在导出期变「停止导出」（exportToken
 * 作废当前任务，已落盘文件保留，不退出选择模式）；列顺序经 colOrders 传入
 * buildAoa 最后一环（reorderColumns）；剪贴板/下载成功 toast 反馈对称（均带退出动作）
 * v2.9：界面偏好与翻页按钮记忆——① 输出方式与文件名模板跨会话记住（'h2x.prefs'，
 * 文件名支持 {title}/{date}/{time} 占位符，留空回落默认模板；存储面已迁
 * persist.prefs，此处只留模板渲染与「已动过控件」会话守卫）；②分页采集进度带
 * 总页数（「第 i/N 页」，见 pagination.js 适配器 totalOf）；③手动指定的翻页按钮
 * 按「页面键 + 表指纹」记住（'h2x.pager.v1'，命中直接复用，未生效自动清除；
 * 存储面已迁 persist.pager）
 * v2.10：输出方式下拉与导出按钮合并为分体按钮——主按钮导出当前格式（默认 Excel），
 * 右侧箭头下拉选择其他输出方式（透明原生 select 覆盖，保留原生下拉与键盘交互）；
 * 两者启用/禁用同源（未选表或忙态整体灰置），下拉位置即原导出按钮处
 * v2.13：分页采集面板增「翻页间隔」——每采完一页、翻下一页前停顿用户指定的
 * 秒数（默认 0.5s，留空 = 默认；慢站点/限流后台连续翻页易被吞点击），经
 * collectPaged 第六参 pageSleep（毫秒）生效，分块等待保证「停止采集」及时
 * v2.14：分页采集起点归一可视化——① 右侧提醒框（toast 同款 shadow 样式体系，
 * 右侧垂直居中）：归一进行中驻屏显示「正在回到第一页… 第 N 页」（经
 * collectPaged 第七参 onNorm 回调驱动，含归一后等表体落地的全程，结束/取消收框；
 * 读数已是第 1 页时不弹——随即直断，避免瞬间闪）；② 引擎优先直跳「1」
 * 页项回第一页（pagination.js first 钩子），失败才逐页回点；③ 距第一页超过
 * 10 页不自动归一——collectPaged 返回 aborted:'tooFar'，右侧提醒框（警示色）
 * 请用户手动回第一页后再点「开始采集」，不写快照不采集；提醒框可手动关闭，
 * 语言切换经 renderSide 按状态就地重取词
 */
(() => {
  'use strict';
  const ns = window.__h2x;
  if (!ns || ns.aborted) return; // 守卫已退出（再次点击图标 = 退出选择模式），不初始化
  const { timestamp, sanitizeFilename } = ns.util;
  const { extractTable, makeSheetName, splitGroupOf, gridRootOf, GRID_ROOT_SELECTOR } = ns.table;
  const { isVirtualTable, collectVirtual } = ns.virtual;
  const { detectPager, manualPager, collectPaged, isPagingClick, pagerByLocator } = ns.pagination;
  const { applyColumnSplits, columnLayout, filterColumns, reorderColumns, colKeys, formatColumns, applyColFormats, autoColWidths } = ns.split;
  const { toCsv, toTsv, toJson, toMarkdown, toHtmlDocument } = ns.format;
  const panel = ns.panel;
  const persist = ns.persist;

  // i18n 取词（各内容脚本同构，见 architecture.md「国际化」节）：优先经 ns.i18n
  // （i18n.js 手动中英文统一入口）；词条缺失或无 chrome.i18n 环境（Node 回归 /
  // E2E 桩未注入）→ 回落代码内中文，测试断言零改动。就地定义：hitRoot/onMouseOver
  // 等既有局部变量 t 均不调用取词，遮蔽无害
  const t = (key, fb, ...subs) => {
    if (ns.i18n) return ns.i18n.t(key, fb, subs); // v2.6.1 手动语言开关优先
    if (typeof chrome !== 'undefined' && chrome.i18n && chrome.i18n.getMessage) {
      const m = chrome.i18n.getMessage(key, subs.length ? subs.map(String) : undefined);
      if (m) return m;
    }
    return fb;
  };

  // 导出格式注册表：label 为按钮文案、ext 为文件扩展名、mime 为下载 MIME
  const FORMATS = {
    xlsx: { label: 'Excel', ext: 'xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
    csv: { label: 'CSV', ext: 'csv', mime: 'text/csv' },
    json: { label: 'JSON', ext: 'json', mime: 'application/json' },
    md: { label: 'Markdown', ext: 'md', mime: 'text/markdown' },
    html: { label: 'HTML', ext: 'html', mime: 'text/html' }
  };

  // 剪贴板输出（v2.7）：与 FORMATS 同列于「输出方式」下拉——选中即不落盘，
  // 内容按模式序列化后写入系统剪贴板（列拆分/筛选/列格式同样生效）。
  // 同为文本输出故复用文本序列化器：TSV 供 Excel/表格软件粘贴（xlsx 无法直接
  // 粘贴，改为制表符文本是最贴合的剪贴板表示），Markdown 供文档/笔记
  const CLIPBOARD = {
    'copy-tsv': { key: 'copyTsvLabel', fb: '复制为表格 (TSV)' },
    'copy-md': { key: 'copyMdLabel', fb: '复制为 Markdown' }
  };

  /* ---------------- 界面偏好（v2.9：输出方式 + 文件名模板；存储面在 persist.prefs） ----------------
   * fmt/name 的读写与校验已迁至 persist.js（纯存储关注点，含 fire-and-forget 落盘
   * 与增量合并基准），此处只留 UI 侧：模板渲染（document.title）、「用户已动过
   * 控件」的会话守卫（防异步回填覆盖用户操作）、加载后的 DOM 应用。
   * fmt 仅认已知值（FORMATS/CLIPBOARD），name 为用户编辑过的模板原文 */
  const NAME_TPL_DEFAULT = '{title}_{date}-{time}'; // {title} 已清洗，整体与旧默认名等价
  let fmtTouched = false; // 本次会话用户改过输出方式：异步加载偏好不覆盖用户操作
  let nameDirty = false;  // 本次会话用户改过文件名：blur 时记住为模板

  /** 文件名模板渲染：{title} 页面标题（先清洗非法字符）/ {date} yyyymmdd /
   *  {time} hhmmss。单遍替换——标题里带「{date}」这类字样不会被二次替换 */
  function renderNameTpl(tpl) {
    const ts = timestamp(); // yyyymmdd-hhmmss
    return String(tpl).replace(/\{(title|date|time)\}/g, (m, k) => (
      k === 'title' ? sanitizeFilename(document.title) : (k === 'date' ? ts.slice(0, 8) : ts.slice(9))
    ));
  }

  /** 当前生效的文件名模板：输入框留空 = 回落默认模板（清空即恢复默认命名） */
  const nameTpl = () => (nameInput.value.trim() ? nameInput.value : NAME_TPL_DEFAULT);

  /** 读取界面偏好（注入时一次，存储面经 persist.prefs.load）：输出方式仅认已知值，
   *  文件名回填模板渲染结果；用户已动过对应控件则不覆盖（异步间隙保护），
   *  await 期间用户可能已退出选择模式（active 兜底） */
  async function loadPrefs() {
    const p = await persist.prefs.load();
    if (!p || !active) return;
    if (!fmtTouched && (FORMATS[p.fmt] || CLIPBOARD[p.fmt])) {
      fmtSel.value = p.fmt;
      syncExportBtn();
    }
    if (!nameDirty && p.name) nameInput.value = renderNameTpl(p.name);
  }

  let active = true;
  let host = null;
  let hoverBox = null, countEl = null, countWrap = null, nameInput = null, exportBtn = null, cancelBtn = null, hintEl = null, splitBtn = null, fmtSel = null, pageWrap = null, pageBtn = null, pageMenu = null, pagesInput = null, pageGoBtn = null, pageCancelBtn = null;
  let clearBtn = null; // v2.7 已选计数旁的「清空」小按钮（无选中时隐藏）
  let expDrop = null;   // v2.10 导出按钮右侧的输出方式下拉区（v2.11 起为箭头按钮，开合自绘菜单）
  let expWrap = null, expMenu = null; // v2.11 下拉包装（定位锚点）与自绘菜单
  let langZhBtn = null, langEnBtn = null; // v2.6.1 工具栏语言开关（中文 | EN）
  let menuTitleEl = null, menuSubEl = null, pageLimitLabelEl = null, pageUnitEl = null; // 分页面板静态文案节点（语言切换就地重取词）
  let sleepInput = null, pageSleepLabelEl = null, sleepUnitEl = null; // v2.13 翻页间隔行节点（同上，语言切换就地重取词）
  let toastRoot = null;
  // v2.14 右侧提醒框（起点归一进行中 / 距第一页过远需手动归一）
  let sideBox = null, sideIcoEl = null, sideTitleEl = null, sideMsgEl = null, sideXBtn = null;
  let sideKind = '';   // '' = 隐藏 | 'norm' 归一进行中 | 'toofar' 距第一页过远待手动归一
  let sidePage = 0;    // 提醒框关联的当前页（0 = 读不到页码）
  let hoverTable = null;
  let rafId = 0;
  let collecting = false; // 虚拟表格滚动采集中 / 分页表格翻页采集中
  let exporting = false;  // 导出文件生成/编码进行中（await 让出主线程期间的重入保护）
  let specifying = false; // v2.5：「指定翻页按钮」子模式（分页器识别不到的兜底）
  let genToken = 0;       // 代际令牌：退出/重新采集时使旧采集任务失效
  let exportToken = 0;    // v2.8 导出代际令牌：「停止导出」使进行中的导出任务失效（不退出选择模式）
  let hasTables = true;   // 进入选择模式时页面是否存在表格（无表时默认提示切换）
  let lastBlockHint = 0;  // 采集中点击提示的上次 toast 时间（2s 节流防刷屏）

  const selected = new Map();   // table -> 覆盖层元素（Map 保持选择顺序 = Sheet 顺序）
  const snapshots = new Map();   // table -> 虚拟滚动表格采集快照 { rows, ctrl, text, headerRows }
  const splitRules = new Map();  // table -> 列拆分规则（会话内存：面板保存时经 persist 落盘，选中时按表指纹恢复）
  const colFilters = new Map();  // table -> 导出列排除集 Set<colKey|colKey#k>（会话内存，持久化同上；无记录 = 全列导出）
  const colFormats = new Map();  // table -> 列格式 Map<colKey,'number'>（会话内存，持久化同上；文本为默认不记录）
  const colOrders = new Map();   // table -> 列顺序 colKey 数组（v2.8；与自然序相同则不记录，持久化同上）

  /* ---------------- UI 构建（Shadow DOM 隔离页面样式） ---------------- */

  function buildUI() {
    host = document.createElement('div');
    host.style.cssText =
      'all:initial;display:block;position:absolute;top:0;left:0;width:0;height:0;' +
      'z-index:2147483647;pointer-events:none;';
    document.documentElement.appendChild(host);

    const root = host.attachShadow({ mode: 'open' });
    // 工具栏样式 + 面板共用的按钮样式（面板专属样式由 panel.js 自持）。
    // 设计 token：颜色/字体/间距/圆角/阴影/控件尺寸集中定义于 :host，工具栏与
    // 面板两处 <style> 同一 shadowRoot 共享；深色模式经 prefers-color-scheme
    // 覆写 token，color-scheme 同步原生控件配色（下拉/滚动条/勾选框）
    root.innerHTML = [
      '<style>',
      '  :host{--ff:-apple-system,"Segoe UI","Microsoft YaHei","PingFang SC",sans-serif;',
      '    --c-primary:#2e7d32;--c-info:#1976d2;--c-danger:#c62828;--c-warn:#8d6e00;',
      '    --c-text:#1f2328;--c-text-2:#57606a;--c-text-3:#8c959f;--c-border:#c9ced6;--c-border-2:#e6e9ed;',
      '    --c-bg:#fff;--c-bg-2:#f6f8fa;--c-bg-3:#f0f2f5;--c-input:#fff;',
      '    --c-disable-bg:#9aa0a6;--c-disable-fg:#8b949e;',
      '    --r-lg:10px;--r:8px;--r-s:6px;--r-xs:4px;--r-pill:999px;',
      '    --sh-1:0 1px 3px rgba(0,0,0,.22);--sh-2:0 6px 22px rgba(0,0,0,.16);--sh-3:0 12px 34px rgba(0,0,0,.2);',
      '    --h-ctl:30px;--h-ctl-s:26px;--sp-1:4px;--sp-2:8px;--sp-3:12px;--sp-4:16px;color-scheme:light;}',
      '  @media (prefers-color-scheme: dark){:host{--c-primary:#4caf50;--c-info:#64b5f6;--c-danger:#ef5350;--c-warn:#ffd54f;',
      '    --c-text:#e6edf3;--c-text-2:#b1bac4;--c-text-3:#8b949e;--c-border:#4b5259;--c-border-2:#333a42;',
      '    --c-bg:#1e1e1e;--c-bg-2:#2a2a2a;--c-bg-3:#252525;--c-input:#30363d;',
      '    --c-disable-bg:#555;--c-disable-fg:#8b949e;',
      '    --sh-1:0 1px 3px rgba(0,0,0,.5);--sh-2:0 6px 22px rgba(0,0,0,.45);--sh-3:0 12px 34px rgba(0,0,0,.5);',
      '    color-scheme:dark;}}',
      '  .h2x-hover{position:absolute;pointer-events:none;box-sizing:border-box;border:2px solid #1976d2;background:rgba(25,118,210,.14);border-radius:2px;transition:left .08s,top .08s,width .08s,height .08s;}',
      '  .h2x-sel{position:absolute;pointer-events:none;box-sizing:border-box;border:2px solid #2e7d32;background:rgba(46,125,50,.10);border-radius:2px;}',
      '  .h2x-badge{position:absolute;top:-12px;left:-12px;min-width:22px;height:22px;padding:0 6px;box-sizing:border-box;border-radius:11px;background:#2e7d32;color:#fff;font:700 12px/22px var(--ff);text-align:center;box-shadow:var(--sh-1);}',
      '  .h2x-sel.h2x-flip-x .h2x-badge{left:auto;right:-12px;}',   /* 表格贴左边缘：徽标翻内侧 */
      '  .h2x-sel.h2x-flip-y .h2x-badge{top:auto;bottom:-12px;}',   /* 表格贴上边缘：徽标翻内侧 */
      '  .h2x-bar{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);pointer-events:auto;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;width:max-content;max-width:96vw;box-sizing:border-box;padding:10px 14px;background:var(--c-bg);border-radius:var(--r-lg);box-shadow:var(--sh-2);gap:var(--sp-2) var(--sp-3);font:13px/1.4 var(--ff);color:var(--c-text);}',  /* v2.6.1 消除英文折行两侧空白：width:max-content 让单行内容恰可放下（中文一行外观零变化），只有超出 max-width 才折行；折行后各行剩余空间经 space-between 分布到行内间隙、两端贴边，替代默认 auto 宽度收缩成多条窄行 + center 空洞 */
      '  .h2x-hint{color:var(--c-text-2);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',  /* 空间不足先截断提示文案，按钮不被迫换行 */
      '  .h2x-count{flex:none;white-space:nowrap;}',
      '  .h2x-count b{color:var(--c-primary);}',
      '  .h2x-clear{flex:none;width:20px;height:20px;padding:0;border:none;border-radius:50%;background:var(--c-bg-3);color:var(--c-text-3);cursor:pointer;font:12px/1 var(--ff);}',  /* v2.7 清空已选：贴计数右侧的小圆钮，无选中时隐藏（空间零占用） */
      '  .h2x-clear:hover:not(:disabled){background:var(--c-danger);color:#fff;}',
      '  .h2x-clear:disabled{opacity:.5;cursor:not-allowed;}',
      '  .h2x-clear[hidden]{display:none;}',
      '  .h2x-name{flex:1 1 150px;min-width:110px;max-width:260px;height:var(--h-ctl);padding:0 10px;border:1px solid var(--c-border);border-radius:var(--r-s);font:13px/1.2 var(--ff);color:var(--c-text);outline:none;background:var(--c-input);box-sizing:border-box;}',
      '  .h2x-name:focus{border-color:var(--c-primary);}',
      // v2.11 输出方式下拉改自绘菜单：原生 select 弹层在部分浏览器中内容贴边且无法定制内边距。
      // 主按钮（导出当前格式）+ 右侧箭头按钮开合菜单；隐藏的原生 select 保留为格式状态与词条来源
      '  .h2x-btn.h2x-exp{border-top-right-radius:0;border-bottom-right-radius:0;}',
      '  .h2x-expwrap{position:relative;display:inline-flex;align-items:stretch;flex:none;margin-left:-8px;}',
      '  .h2x-expdrop{display:inline-flex;align-items:center;justify-content:center;width:28px;padding:0;box-sizing:border-box;background:var(--c-primary);color:#fff;border:none;border-left:1px solid rgba(255,255,255,.38);border-radius:0 var(--r-s) var(--r-s) 0;cursor:pointer;}',
      '  .h2x-expdrop:hover:not(:disabled){filter:brightness(1.06);}',
      '  .h2x-expdrop:active:not(:disabled){filter:brightness(.94);}',
      '  .h2x-expdrop:disabled{background:var(--c-disable-bg);border-left-color:rgba(255,255,255,.25);cursor:not-allowed;filter:none;}',
      '  .h2x-expdrop:focus-visible{outline:2px solid var(--c-info);outline-offset:1px;}',
      '  .h2x-expcare{font-style:normal;font-size:10px;line-height:1;opacity:.9;pointer-events:none;transition:transform .15s;}',
      '  .h2x-expwrap.h2x-open .h2x-expcare{transform:rotate(180deg);}',
      '  .h2x-expmenu{position:absolute;right:0;bottom:calc(100% + 8px);width:max-content;min-width:184px;max-width:calc(100vw - 24px);box-sizing:border-box;padding:6px;background:var(--c-bg);border:1px solid var(--c-border-2);border-radius:var(--r-lg);box-shadow:var(--sh-3);z-index:2;display:flex;flex-direction:column;gap:var(--sp-1);}',  /* 上移弹层：与「采集全部页」面板同款圆角/描边/阴影 */
      '  .h2x-expmenu[hidden]{display:none;}',
      '  .h2x-expopt{display:flex;align-items:center;gap:8px;width:100%;height:var(--h-ctl-s);box-sizing:border-box;padding:0 10px;border:none;border-radius:var(--r-s);background:transparent;color:var(--c-text);font:13px/1.3 var(--ff);text-align:left;white-space:nowrap;cursor:pointer;}',
      '  .h2x-expopt:hover{background:var(--c-bg-2);}',
      '  .h2x-expopt:focus-visible{outline:2px solid var(--c-info);outline-offset:-2px;}',
      '  .h2x-expopt[aria-selected="true"]{color:var(--c-primary);font-weight:600;background:var(--c-bg-2);}',
      '  .h2x-expopt[aria-selected="true"]::after{content:"✓";margin-left:auto;font-size:12px;font-weight:400;}',
      '  .h2x-expsep{height:1px;margin:4px 2px;background:var(--c-border-2);}',
      '  .h2x-ext{display:none;}',  /* 仅作格式状态与词条来源：不参与交互与显示 */
      '  .h2x-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:var(--h-ctl);padding:0 16px;border:none;border-radius:var(--r-s);cursor:pointer;font:13px/1.2 var(--ff);}',
      '  .h2x-btn:hover:not(:disabled){filter:brightness(1.06);}',
      '  .h2x-btn:active:not(:disabled){filter:brightness(.94);}',
      '  .h2x-primary{background:var(--c-primary);color:#fff;}',
      '  .h2x-primary:disabled{background:var(--c-disable-bg);color:#fff;cursor:not-allowed;filter:none;}',
      '  .h2x-ghost{background:var(--c-bg-3);color:var(--c-text-2);border:1px solid var(--c-border);}',
      '  .h2x-ghost:disabled{color:var(--c-disable-fg);cursor:not-allowed;}',
      '  .h2x-split{background:var(--c-bg);color:var(--c-primary);border:1px solid var(--c-primary);position:relative;}',
      '  .h2x-split:disabled{background:var(--c-bg-3);color:var(--c-disable-fg);border-color:var(--c-border);cursor:not-allowed;filter:none;}',
      '  .h2x-split.h2x-has-cfg::after{content:"";position:absolute;top:-4px;right:-4px;width:8px;height:8px;border-radius:50%;background:var(--c-info);box-shadow:0 0 0 2px var(--c-bg);}',  /* 已配置徽标点 */
      '  .h2x-actions{display:flex;gap:var(--sp-2);flex:none;}',  /* 按钮组：极窄屏整组换行，不出现孤立按钮 */
      '  .h2x-pagewrap{position:relative;flex:none;}',
      '  .h2x-pagebtn{display:inline-flex;align-items:center;gap:6px;height:var(--h-ctl);padding:0 12px;background:var(--c-bg);color:var(--c-info);border:1px solid var(--c-info);border-radius:var(--r-s);cursor:pointer;font:13px/1.2 var(--ff);white-space:nowrap;}',  /* v2.5.2 采集全部页按钮：分页采集下拉入口（信息蓝描边，与列设置的绿区分） */
      '  .h2x-pagebtn:hover:not(:disabled){filter:brightness(1.06);}',
      '  .h2x-pagebtn:active:not(:disabled){filter:brightness(.94);}',
      '  .h2x-pagebtn:disabled{background:var(--c-bg-3);color:var(--c-disable-fg);border-color:var(--c-border);cursor:not-allowed;filter:none;}',
      '  .h2x-pagebtn .h2x-care{flex:none;font-style:normal;font-size:10px;line-height:1;opacity:.85;transition:transform .15s;}',  /* 下拉箭头随展开旋转 */
      '  .h2x-pagewrap.h2x-open .h2x-care{transform:rotate(180deg);}',
      '  .h2x-pagemenu{position:absolute;bottom:calc(100% + 8px);left:50%;transform:translateX(-50%);width:346px;max-width:calc(100vw - 24px);box-sizing:border-box;padding:var(--sp-3);background:var(--c-bg);border:1px solid var(--c-border-2);border-radius:var(--r-lg);box-shadow:var(--sh-3);z-index:2;text-align:left;}',  /* 下拉面板：上移弹层，深色/浅色随 token；v2.6 加宽至 346px（英文文案更长防文字溢出）+ 窄屏上限 */
      '  .h2x-pagemenu[hidden]{display:none;}',
      '  .h2x-pagemenu-title{font-size:13px;font-weight:700;color:var(--c-text);}',
      '  .h2x-pagemenu-sub{font-size:12px;color:var(--c-text-3);margin:4px 0 12px;line-height:1.5;}',
      '  .h2x-pagemenu-row{display:flex;align-items:center;gap:8px;margin-bottom:12px;}',
      '  .h2x-pagemenu-row label{font-size:12px;color:var(--c-text-2);flex:none;}',
      '  .h2x-pages,.h2x-sleep{flex:1;min-width:0;height:var(--h-ctl);padding:0 8px;border:1px solid var(--c-border);border-radius:var(--r-s);font:13px/1.2 var(--ff);color:var(--c-text);background:var(--c-input);outline:none;box-sizing:border-box;}',
      '  .h2x-pages:focus,.h2x-sleep:focus{border-color:var(--c-info);}',
      '  .h2x-pages::-webkit-outer-spin-button,.h2x-pages::-webkit-inner-spin-button,.h2x-sleep::-webkit-outer-spin-button,.h2x-sleep::-webkit-inner-spin-button{-webkit-appearance:none;margin:0;}',
      '  .h2x-pages::placeholder,.h2x-sleep::placeholder{color:var(--c-text-3);}',
      '  .h2x-pageunit{font-size:12px;color:var(--c-text-2);flex:none;white-space:nowrap;}',  /* 页数单位按内容自适应宽（中文「页」短、英文 pages 长，固定宽会溢出） */
      '  .h2x-pagemenu-actions{display:flex;gap:var(--sp-2);justify-content:flex-end;}',
      '  .h2x-pagemenu-actions .h2x-btn{font-size:12px;height:var(--h-ctl-s);padding:0 12px;}',
      '  .h2x-lang{flex:none;display:inline-flex;align-items:center;gap:1px;height:var(--h-ctl);padding:2px;border:1px solid var(--c-border);border-radius:var(--r-s);background:var(--c-bg-3);box-sizing:border-box;}',  /* v2.6.1 语言分段开关：紧凑胶囊，中文/EN 各自独立按钮 */
      '  .h2x-langbtn{border:none;background:transparent;color:var(--c-text-2);font:12px/1 var(--ff);padding:4px 9px;border-radius:var(--r-xs);cursor:pointer;}',
      '  .h2x-langbtn:hover:not(:disabled){color:var(--c-text);}',
      '  .h2x-langbtn[aria-pressed="true"]{background:var(--c-primary);color:#fff;}',
      '  .h2x-langbtn:disabled{opacity:.5;cursor:not-allowed;}',
      '  .h2x-toasts{position:fixed;top:16px;right:16px;display:flex;flex-direction:column;gap:var(--sp-2);z-index:1;pointer-events:none;font:13px/1.4 var(--ff);}',
      '  .h2x-toast{pointer-events:auto;display:flex;align-items:center;gap:11px;max-width:min(460px,86vw);padding:11px 14px 11px 12px;border-radius:var(--r);background:var(--c-bg);color:var(--c-text);box-shadow:var(--sh-3);animation:h2x-in .18s ease-out;border-left:4px solid var(--c-info);font-weight:600;}',
      '  .h2x-toast-ico{flex:none;width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;background:var(--c-info);font:700 13px/22px var(--ff);text-align:center;}',
      '  .h2x-toast-info{background:linear-gradient(0deg,rgba(25,118,210,.10),rgba(25,118,210,.10)),var(--c-bg);}',
      '  .h2x-toast-success{border-left-color:var(--c-primary);background:linear-gradient(0deg,rgba(46,125,50,.10),rgba(46,125,50,.10)),var(--c-bg);}',
      '  .h2x-toast-success .h2x-toast-ico{background:var(--c-primary);}',
      '  .h2x-toast-warn{border-left-color:var(--c-warn);background:linear-gradient(0deg,rgba(141,110,0,.12),rgba(141,110,0,.12)),var(--c-bg);}',
      '  .h2x-toast-warn .h2x-toast-ico{background:var(--c-warn);}',
      '  .h2x-toast-error{border-left-color:var(--c-danger);background:linear-gradient(0deg,rgba(198,40,40,.10),rgba(198,40,40,.10)),var(--c-bg);}',
      '  .h2x-toast-error .h2x-toast-ico{background:var(--c-danger);}',
      '  .h2x-toast-msg{flex:1;min-width:0;color:var(--c-text);}',
      '  .h2x-toast-btn{height:var(--h-ctl-s);padding:0 10px;border:1px solid var(--c-border);border-radius:var(--r-s);background:var(--c-bg);color:var(--c-text-2);cursor:pointer;font:12px/1.4 var(--ff);}',
      '  .h2x-toast-btn:hover{border-color:var(--c-primary);color:var(--c-primary);}',
      '  .h2x-toast-x{border:none;background:none;color:var(--c-text-3);cursor:pointer;font:16px/1 var(--ff);padding:0 2px;}',
      '  .h2x-toast-x:hover{color:var(--c-text);}',
      // v2.14 右侧提醒框：起点归一进行中 / 距第一页过远需手动归一时驻屏提示。
      // 右侧垂直居中（与右上角 toast 错开、不挡底部工具栏），警示态用琥珀色系
      '  .h2x-side{position:fixed;right:16px;top:50%;transform:translateY(-50%);width:min(300px,calc(100vw - 32px));box-sizing:border-box;padding:13px 14px;background:var(--c-bg);border:1px solid var(--c-border-2);border-left:4px solid var(--c-info);border-radius:var(--r-lg);box-shadow:var(--sh-3);z-index:2;pointer-events:auto;font:13px/1.5 var(--ff);color:var(--c-text);animation:h2x-slide .2s ease-out;}',
      '  .h2x-side[hidden]{display:none;}',
      '  .h2x-side-warn{border-left-color:var(--c-warn);}',
      '  .h2x-side-warn .h2x-side-ico{background:var(--c-warn);}',
      '  .h2x-side-row{display:flex;align-items:center;gap:9px;}',
      '  .h2x-side-ico{flex:none;width:20px;height:20px;border-radius:50%;background:var(--c-info);color:#fff;display:flex;align-items:center;justify-content:center;font:700 12px/20px var(--ff);text-align:center;}',
      '  .h2x-side-title{flex:1;min-width:0;font-weight:700;}',
      '  .h2x-side-x{flex:none;border:none;background:none;color:var(--c-text-3);cursor:pointer;font:16px/1 var(--ff);padding:0 2px;}',
      '  .h2x-side-x:hover{color:var(--c-text);}',
      '  .h2x-side-msg{margin-top:6px;font-size:12px;line-height:1.6;color:var(--c-text-2);}',
      '  @keyframes h2x-slide{from{opacity:0;transform:translate(24px,-50%);}}',
      '  input[type=checkbox],input[type=radio]{width:15px;height:15px;margin:0;accent-color:var(--c-primary);}',
      '  button:focus-visible,select:focus-visible,input:focus-visible,textarea:focus-visible{outline:2px solid var(--c-info);outline-offset:1px;}',
      '  @keyframes h2x-in{from{opacity:0;transform:translateY(-8px);}}',
      '  @media (prefers-reduced-motion: reduce){:host *{animation:none!important;transition:none!important;}}',
      '</style>',
      // 骨架只放结构与数据驱动内容（格式选项列表）；全部静态文案经
      // fillStaticTexts() 统一填充——与语言切换的 refreshTexts 同一入口，
      // 杜绝同一批 t() 在 buildUI / refreshTexts 双写（改一处漏一处）
      '<div class="h2x-hover" hidden></div>',
      '<div class="h2x-bar">',
      '  <span class="h2x-hint"></span>',
      '  <span class="h2x-count"></span>',
      '  <button type="button" class="h2x-clear" hidden>✕</button>',
      '  <input class="h2x-name" type="text" spellcheck="false" />',
      '  <div class="h2x-actions">',
      '    <button class="h2x-btn h2x-split" disabled></button>',
      '    <div class="h2x-pagewrap">',
      '      <button type="button" class="h2x-btn h2x-pagebtn" aria-haspopup="dialog" aria-expanded="false" disabled></button>',
      '      <div class="h2x-pagemenu" role="dialog" hidden>',
      '        <div class="h2x-pagemenu-title"></div>',
      '        <div class="h2x-pagemenu-sub"></div>',
      '        <div class="h2x-pagemenu-row">',
      '          <label for="h2x-pages"></label>',
      '          <input class="h2x-pages" id="h2x-pages" type="number" min="1" step="1" />',
      '          <span class="h2x-pageunit"></span>',
      '        </div>',
      '        <div class="h2x-pagemenu-row h2x-sleeprow">',
      '          <label for="h2x-sleep"></label>',
      '          <input class="h2x-sleep" id="h2x-sleep" type="number" min="0" step="0.1" value="0.5" />',
      '          <span class="h2x-pageunit"></span>',
      '        </div>',
      '        <div class="h2x-pagemenu-actions">',
      '          <button type="button" class="h2x-btn h2x-ghost h2x-pagecancel"></button>',
      '          <button type="button" class="h2x-btn h2x-primary h2x-pagego"></button>',
      '        </div>',
      '      </div>',
      '    </div>',
      '    <button class="h2x-btn h2x-primary h2x-exp" disabled></button>',
      // v2.11 右侧箭头按钮开合自绘菜单；隐藏 select 仅作格式状态与词条来源（不参与交互）
      '    <span class="h2x-expwrap">',
      '      <button type="button" class="h2x-expdrop" disabled aria-haspopup="listbox" aria-expanded="false"></button>',
      '        <i class="h2x-expcare" aria-hidden="true">▾</i>',
      '      </button>',
      '      <select class="h2x-ext" hidden tabindex="-1" aria-hidden="true">' +
      Object.keys(FORMATS).map(k => '<option value="' + k + '">' + FORMATS[k].label + ' (.' + FORMATS[k].ext + ')</option>').join('') +
      Object.keys(CLIPBOARD).map(k => '<option value="' + k + '">' + t(CLIPBOARD[k].key, CLIPBOARD[k].fb) + '</option>').join('') +
      '</select>',
      '      <div class="h2x-expmenu" role="listbox" hidden>' +
      Object.keys(FORMATS).map(k => '<button type="button" class="h2x-expopt" role="option" data-k="' + k + '" aria-selected="false">' + FORMATS[k].label + ' (.' + FORMATS[k].ext + ')</button>').join('') +
      '<div class="h2x-expsep" aria-hidden="true"></div>' +
      Object.keys(CLIPBOARD).map(k => '<button type="button" class="h2x-expopt" role="option" data-k="' + k + '" aria-selected="false">' + t(CLIPBOARD[k].key, CLIPBOARD[k].fb) + '</button>').join('') +
      '</div>',
      '    </span>',
      '    <button class="h2x-btn h2x-ghost"></button>',
      '  </div>',
      // v2.6.1 语言分段开关：按钮文案即语言自称（中文/EN），刻意双语恒定、不随
      // 界面语言取词——任何语言下都能自指其名；aria-pressed 标注当前生效语言
      '  <div class="h2x-lang" role="group" aria-label="界面语言 / Language">' +
      '    <button type="button" class="h2x-langbtn h2x-langzh" aria-pressed="false">中文</button>' +
      '    <button type="button" class="h2x-langbtn h2x-langen" aria-pressed="false">EN</button>' +
      '  </div>',
      '</div>',
      '<div class="h2x-toasts"></div>',
      // v2.14 右侧提醒框（起点归一进行中 / 距第一页过远需手动归一；role 按
      // info/warn 动态切换，文案由 renderSide 统一渲染）
      '<div class="h2x-side" role="status" hidden>',
      '  <div class="h2x-side-row">',
      '    <span class="h2x-side-ico" aria-hidden="true">i</span>',
      '    <span class="h2x-side-title"></span>',
      '    <button type="button" class="h2x-side-x">×</button>',
      '  </div>',
      '  <div class="h2x-side-msg"></div>',
      '</div>'
    ].join('');

    hoverBox = root.querySelector('.h2x-hover');
    countWrap = root.querySelector('.h2x-count'); // countEl 由 syncCount 渲染后取得（<b> 才存在）
    clearBtn = root.querySelector('.h2x-clear');
    nameInput = root.querySelector('.h2x-name');
    fmtSel = root.querySelector('.h2x-ext');        // v2.11 隐藏的原生 select：格式状态 + 词条来源
    expWrap = root.querySelector('.h2x-expwrap');   // v2.11 自绘下拉：箭头按钮 + 菜单（禁用态同步）
    expDrop = root.querySelector('.h2x-expdrop');
    expMenu = root.querySelector('.h2x-expmenu');
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
    menuTitleEl = root.querySelector('.h2x-pagemenu-title');
    menuSubEl = root.querySelector('.h2x-pagemenu-sub');
    pageLimitLabelEl = root.querySelector('.h2x-pagemenu-row label');
    pageUnitEl = root.querySelector('.h2x-pageunit');
    sleepInput = root.querySelector('.h2x-sleep');
    pageSleepLabelEl = root.querySelector('.h2x-sleeprow label');
    sleepUnitEl = root.querySelector('.h2x-sleeprow .h2x-pageunit');
    langZhBtn = root.querySelector('.h2x-langzh');
    langEnBtn = root.querySelector('.h2x-langen');
    toastRoot = root.querySelector('.h2x-toasts');
    // v2.14 右侧提醒框节点
    sideBox = root.querySelector('.h2x-side');
    sideIcoEl = root.querySelector('.h2x-side-ico');
    sideTitleEl = root.querySelector('.h2x-side-title');
    sideMsgEl = root.querySelector('.h2x-side-msg');
    sideXBtn = root.querySelector('.h2x-side-x');
    sideXBtn.addEventListener('click', () => {
      sideKind = ''; // 手动关闭：清状态（下次触发按新状态重显）
      sideBox.hidden = true;
    });
    exportBtn.addEventListener('click', doExport);
    clearBtn.addEventListener('click', clearSelection); // v2.7 一键清空已选（逐个取消的快捷方式）
    // v2.0：采集中「取消」变「停止采集」（只作废当前任务，不退出选择模式）
    // v2.8：导出中同样变「停止导出」（三态：采集/导出/退出）
    cancelBtn.addEventListener('click', () => {
      if (collecting) stopCollect();
      else if (exporting) abortExport();
      else exit();
    });
    splitBtn.addEventListener('click', openPanel);
    // v2.6.1：语言开关——点未激活语言切换过去；再点当前语言 = 回到跟随浏览器
    langZhBtn.addEventListener('click', () => pickLang('zh'));
    langEnBtn.addEventListener('click', () => pickLang('en'));
    // v2.5.2：下拉展开——点按钮开合设置面板；「开始采集」/槽内 Enter 触发采集
    pageBtn.addEventListener('click', togglePageMenu);
    pageGoBtn.addEventListener('click', () => { closePageMenu(); onCollectAllPages(); });
    pageCancelBtn.addEventListener('click', closePageMenu);
    pagesInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); closePageMenu(); onCollectAllPages(); } });
    // v2.13：翻页间隔槽 Enter 同效（与页数槽一致）
    sleepInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); closePageMenu(); onCollectAllPages(); } });
    // 格式切换：导出按钮文案同步（文件名扩展名在导出时按格式追加）；
    // v2.9：选择即记住（下次进入选择模式恢复同一输出方式）
    fmtSel.addEventListener('change', applyFmt);
    // v2.11 输出方式自绘下拉：箭头开合菜单、点项生效、点工具栏其他处/keyboard 收拢
    expDrop.addEventListener('click', toggleExpMenu);
    expMenu.addEventListener('click', e => {
      const opt = e.target instanceof Element ? e.target.closest('.h2x-expopt') : null;
      if (opt) pickFmt(opt.dataset.k);
    });
    expMenu.addEventListener('keydown', onExpMenuKey);
    expWrap.addEventListener('focusout', e => { if (!expWrap.contains(e.relatedTarget)) closeExpMenu(); });
    root.addEventListener('click', e => { if (!expWrap.contains(e.target)) closeExpMenu(); });
    // v2.9 文件名：编辑过即记住为模板（blur 时落盘，点导出按钮会先触发 blur）；
    // 清空输入框 = 回落默认命名
    nameInput.addEventListener('input', () => { nameDirty = true; });
    nameInput.addEventListener('blur', () => { if (nameDirty) persist.prefs.save({ name: nameInput.value.trim() }); });

    fillStaticTexts(); // 静态文案统一入口（语言切换经 refreshTexts 重走，杜绝双写）
    syncCount(); // 计数含 <b> 骨架：updateBar 热路径只改 textContent，不重建 DOM
    nameInput.value = renderNameTpl(NAME_TPL_DEFAULT);
  }

  /** 静态文案统一填充（buildUI 结尾与语言切换 refreshTexts 共用同一入口）：
   *  工具栏 / 分页面板 / 输出方式菜单 / 提醒框的全部 t() 文案只此一处定义。
   *  状态相关文案不在此列——计数（selected.size）、导出按钮（当前格式）、
   *  分页按钮 title（单表/多表）、hint（引导/进行时）由 updateBar /
   *  syncExportBtn / resetHint / renderSide 按各自状态渲染 */
  function fillStaticTexts() {
    clearBtn.title = t('btnClearTitle', '清空已选表格');
    clearBtn.setAttribute('aria-label', clearBtn.title);
    nameInput.title = t('nameTplTitle', '文件名：{title} 页面标题、{date} 日期、{time} 时间；留空 = 默认命名');
    nameInput.setAttribute('aria-label', nameInput.title);
    splitBtn.textContent = t('btnColSettings', '列设置');
    cancelBtn.textContent = t('btnCancel', '取消 (Esc)');
    // v2.11：自绘下拉——箭头按钮与菜单的 aria/title；剪贴板项文案随语言变
    // （文件格式项文案不含语言）；隐藏 select 的 option 文本不再展示
    expDrop.title = t('exportFormatTitle', '导出格式 / 复制到剪贴板');
    expDrop.setAttribute('aria-label', expDrop.title);
    expMenu.setAttribute('aria-label', expDrop.title);
    for (const k of Object.keys(CLIPBOARD)) {
      const opt = expMenu.querySelector('.h2x-expopt[data-k="' + k + '"]');
      if (opt) opt.textContent = t(CLIPBOARD[k].key, CLIPBOARD[k].fb);
    }
    pageBtn.innerHTML = t('btnCollectAll', '采集全部页') + '<i class="h2x-care" aria-hidden="true">▾</i>';
    // 分页面板静态行文案（当前若展开会被先收拢，此处刷新的是下次展开内容）
    pageMenu.setAttribute('aria-label', t('pageMenuAria', '分页采集设置'));
    menuTitleEl.textContent = t('pageMenuTitle', '分页采集');
    menuSubEl.textContent = t('pageMenuSub', '留空则采集全部页；识别不到分页器时会提示手动指定「下一页」按钮');
    pageLimitLabelEl.textContent = t('pageLimitLabel', '页数上限');
    pagesInput.placeholder = t('pageLimitPh', '全部');
    pagesInput.title = t('pageLimitTitle', '只采集前 N 页，留空 = 全部页');
    pagesInput.setAttribute('aria-label', t('pageLimitAria', '采集页数上限（留空为全部页）'));
    pageUnitEl.textContent = t('pageUnit', '页');
    // v2.13 翻页间隔行静态文案
    pageSleepLabelEl.textContent = t('pageSleepLabel', '翻页间隔');
    sleepInput.placeholder = t('pageSleepPh', '0.5');
    sleepInput.title = t('pageSleepTitle', '每采完一页、翻下一页前停顿 N 秒（防限流/减压），留空 = 0.5 秒');
    sleepInput.setAttribute('aria-label', t('pageSleepAria', '每页翻页间隔秒数（留空为 0.5 秒）'));
    sleepUnitEl.textContent = t('pageSleepUnit', '秒');
    pageCancelBtn.textContent = t('btnCancelShort', '取消');
    pageGoBtn.textContent = t('btnStart', '开始采集');
    sideXBtn.setAttribute('aria-label', t('closeAria', '关闭'));
  }

  /** 已选计数渲染：innerHTML 重建 <b> 后必须重取 countEl 引用——updateBar 的
   *  热路径只改 textContent 不重建，引用依赖本次渲染的结果 */
  function syncCount() {
    countWrap.innerHTML = t('selectedCount', '已选 <b>' + selected.size + '</b> 个', String(selected.size));
    countEl = countWrap.querySelector('b');
  }

  // 导出按钮文案与格式下拉同步（含「导出中…」结束后的恢复）
  function syncExportBtn() {
    if (exporting) return; // 导出中保持「导出中…」，结束时统一恢复
    const cp = CLIPBOARD[fmtSel.value];
    if (cp) { exportBtn.textContent = t(cp.key, cp.fb); return; } // v2.7 剪贴板模式：按钮即动作名
    const fmt = FORMATS[fmtSel.value] || FORMATS.xlsx;
    exportBtn.textContent = t('exportBtnLabel', '导出 ' + fmt.label, fmt.label);
  }

  /** v2.10 进行时（采集/导出）下拉区与主按钮一同灰置：这些路径不经 updateBar，
   *  需就地同步；结束后统一由 updateBar 按状态恢复 */
  function lockExpDrop() {
    closeExpMenu();
    fmtSel.disabled = true;
    expDrop.disabled = true;
  }

  /* ---------------- 输出方式自绘下拉（v2.11） ---------------- */

  /** 格式生效：文案同步 + 记住偏好（隐藏 select 的 change 与菜单点选共用） */
  function applyFmt() {
    fmtTouched = true;
    syncExportBtn();
    persist.prefs.save({ fmt: fmtSel.value });
  }

  /** 选中态同步：按隐藏 select 的当前值标记菜单项（程序化改值后仍一致） */
  function syncExpMenu() {
    for (const opt of expMenu.querySelectorAll('.h2x-expopt')) {
      opt.setAttribute('aria-selected', opt.dataset.k === fmtSel.value ? 'true' : 'false');
    }
  }

  function openExpMenu() {
    if (expDrop.disabled) return;
    syncExpMenu();
    expMenu.hidden = false;
    expWrap.classList.add('h2x-open');
    expDrop.setAttribute('aria-expanded', 'true');
    const cur = expMenu.querySelector('.h2x-expopt[aria-selected="true"]');
    (cur || expMenu.querySelector('.h2x-expopt')).focus();
  }

  function closeExpMenu() {
    if (expMenu.hidden) return;
    expMenu.hidden = true;
    expWrap.classList.remove('h2x-open');
    expDrop.setAttribute('aria-expanded', 'false');
  }

  function toggleExpMenu() {
    expMenu.hidden ? openExpMenu() : closeExpMenu();
  }

  /** 点选菜单项：写入 select 后走同一生效路径；重复点当前项只收起 */
  function pickFmt(k) {
    closeExpMenu();
    if (!k || k === fmtSel.value || !(FORMATS[k] || CLIPBOARD[k])) return;
    fmtSel.value = k;
    applyFmt();
  }

  /** 菜单内 ↑/↓ 首尾循环移动焦点（Esc/Enter/Tab 由全局键盘处理与按钮默认行为接管） */
  function onExpMenuKey(e) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const opts = [...expMenu.querySelectorAll('.h2x-expopt')];
    const i = opts.indexOf(e.target instanceof Element ? e.target.closest('.h2x-expopt') : null);
    const next = opts[(i + (e.key === 'ArrowDown' ? 1 : -1) + opts.length) % opts.length];
    if (next) next.focus();
  }

  /* ---------------- 界面语言开关（v2.6.1） ---------------- */

  /** 语言开关高亮同步：aria-pressed 标注当前生效语言（手动选择优先，否则浏览器） */
  function syncLangUI() {
    if (!ns.i18n) return;
    const cur = ns.i18n.langOf();
    langZhBtn.setAttribute('aria-pressed', cur === 'zh' ? 'true' : 'false');
    langEnBtn.setAttribute('aria-pressed', cur === 'en' ? 'true' : 'false');
  }

  /** 工具栏静态文案就地重取词（语言切换/偏好恢复后调用；进行时文案由各流程
   *  t() 动态取词天然生效，无需在此处理）。静态文案统一走 fillStaticTexts
   *  （与 buildUI 同一入口，不双写）；此处只补状态相关文案：计数、导出按钮
   *  文案、提醒框、hint。只在空闲态被调用——切换期间 collecting/exporting/
   *  panel/specifying 任一进行都会禁用语言开关 */
  function refreshTexts() {
    fillStaticTexts();
    syncCount();
    syncExportBtn();
    // v2.14：右侧提醒框按当前状态就地重取词（sticky 的「请先返回第一页」可跨
    // 语言切换留存；隐藏态无状态不渲染）
    if (sideKind) renderSide();
    resetHint(); // 空闲态提示回默认引导文案（语言切换不改变状态）
  }

  /** 语言切换入口：点未激活语言 = 切换过去并持久化；已是手动语言时再点 =
   *  回到自动（跟随浏览器）；自动模式下点当前生效语言无操作。
   *  手动英文需先经后台拉词表（异步），完成前生效语言不变，避免首帧闪中文 */
  async function pickLang(code) {
    if (!ns.i18n) return;
    if (collecting || exporting || panel.isOpen() || specifying) return; // 防御：开关已禁用
    const manual = ns.i18n.lang();
    if (manual === null && ns.i18n.langOf() === code) return; // 自动且正是当前语言：无操作
    const target = manual === code ? 'auto' : code; // 点当前手动语言 → 跟随浏览器
    const before = ns.i18n.langOf();
    await ns.i18n.setLang(target);
    if (!active) return; // await 间隙用户已退出
    if (ns.i18n.langOf() !== before) {
      closePageMenu();
      closeExpMenu();
      refreshTexts();
      updateBar(); // 同步计数/主按钮 title/开关禁用态（语言变化后文案重取词）
    }
    syncLangUI();
  }

  /* ---------------- Toast 反馈系统（v2.0） ---------------- */

  /** 结果性通知：成功/信息/警示 8s 自动消失（可经 duration 覆盖），
   *  警示（warn）琥珀色，错误常驻 + 关闭钮；同屏最多 6 条。
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
      x.setAttribute('aria-label', t('closeAria', '关闭'));
      x.textContent = '×';
      x.addEventListener('click', close);
      box.appendChild(x);
    }
    toastRoot.appendChild(box);
    while (toastRoot.children.length > 6) toastRoot.firstElementChild.remove();
    if (type !== 'error' && !opts.sticky) {
      timer = setTimeout(close, opts.duration || 8000);
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
    setHint(hasTables ? t('hintSelect', '点击选择表格（可多选）') : t('hintNoTables', '页面未找到表格'));
  }

  /* ---------------- 右侧提醒框（v2.14：起点归一进行中 / 需手动归一） ----------------
   * 与 toast 同属 shadow 样式体系但职责不同：toast 是一次性结果通知（8s 自消），
   * 提醒框是进行中/待用户操作的驻屏提示（右侧垂直居中，不挡底部工具栏）。渲染
   * 统一走 renderSide()——只存状态（sideKind + sidePage），语言切换时按状态
   * 就地重取词，不留旧语言文案 */

  /** 按 sideKind/sidePage 渲染提醒框（sideKind 为空 = 收起） */
  function renderSide() {
    if (!sideKind) { sideBox.hidden = true; return; }
    const warn = sideKind === 'toofar';
    sideIcoEl.textContent = warn ? '!' : 'i';
    sideBox.classList.toggle('h2x-side-warn', warn);
    sideBox.setAttribute('role', warn ? 'alert' : 'status');
    sideTitleEl.textContent = warn
      ? t('sideTooFarTitle', '请先返回第一页')
      : t('sideNormTitle', '正在回到第一页');
    sideMsgEl.textContent = warn
      ? t('sideTooFarMsg', '当前在第 ' + sidePage + ' 页，距离第一页较远。请先翻到第一页，再点「开始采集」。', sidePage)
      : (sidePage > 0
        ? t('sideNormMsgN', '当前第 ' + sidePage + ' 页，正在自动回到第一页…', sidePage)
        : t('sideNormMsg', '正在自动回到第一页…'));
    sideBox.hidden = false;
  }

  /** 归一进行中（collectPaged 第七参 onNorm 回调）：page > 0 = 当前页，
   *  0 = 读不到页码（手动分页器/vxe）；page 为 null = 归一结束/放弃，收框 */
  function showSideNorm(page) {
    if (page == null) { sideKind = ''; sideBox.hidden = true; return; }
    sideKind = 'norm';
    sidePage = page;
    renderSide();
  }

  /** 距第一页超过 10 页：不自动归一，提醒用户手动回第一页后再点「开始采集」 */
  function showSideTooFar(page) {
    sideKind = 'toofar';
    sidePage = page;
    renderSide();
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
    if (!expMenu.hidden) closeExpMenu();   // v2.11 输出方式菜单同理
    if (collecting) {
      if (isPagingClick(e)) return; // v2.5：翻页按钮的编程式点击放行（分页器常为 a[href]，拦截则翻页永不发生）
      // 采集滚动/翻页中仍全拦截（防误操作打断采集），但给点击反馈（2s 节流）
      e.preventDefault();
      e.stopPropagation();
      const now = Date.now();
      if (now - lastBlockHint > 2000) {
        lastBlockHint = now;
        toast(t('toastCollectingClick', '正在采集滚动数据，可点「停止采集」中止'), { type: 'info' });
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
      if (btn && table && table.isConnected) startPagedCollect(table, manualPager(btn), false);
      else if (btn) toast(t('toastTableGone', '已选表格已不在页面上，请重新选择后再采集'), { type: 'warn' });
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
      toast(t('toastLinkBlocked', '选择模式下链接已停用，Esc 退出后可跳转'), { type: 'warn' });
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
      toast(removed > 1
        ? t('toastTablesRemovedN', '已选表格已被页面刷新移除（' + removed + ' 个）', removed)
        : t('toastTablesRemoved', '已选表格已被页面刷新移除'), { type: 'warn' });
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
      if (!expMenu.hidden) { // v2.11 输出方式菜单优先收拢（避免误退出选择模式），焦点回箭头
        e.preventDefault();
        e.stopPropagation();
        closeExpMenu();
        expDrop.focus();
        return;
      }
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

  /** 该表是否配置了拆分/列筛选/列格式/列顺序（持久化恢复判重与「列设置」徽标点共用） */
  const hasColCfg = (table) =>
    splitRules.has(table) || colFilters.has(table) || colFormats.has(table) || colOrders.has(table);

  /** 持久化恢复：把已保存的拆分规则/列筛选/列格式回填内存 Map（幂等：已有会话
   *  配置不覆盖，面板保存后重选也拿到最新值——removeSelected 只清内存不清存储）。
   *  选中表格时调用；导出/面板入口再兜底一次注入初期的存储加载竞态 */
  function restoreFromPersist(table) {
    if (hasColCfg(table)) return;
    const saved = persist.getSaved(table);
    if (!saved || (!saved.rules.length && !saved.excluded.size && !saved.formats.size && !(saved.order && saved.order.length))) return;
    if (saved.rules.length) splitRules.set(table, saved.rules);
    if (saved.excluded.size) colFilters.set(table, saved.excluded);
    if (saved.formats.size) colFormats.set(table, saved.formats);
    if (saved.order && saved.order.length) colOrders.set(table, saved.order);
    toast(t('toastRestored', '已恢复上次的列设置'), { type: 'info' });
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
    colOrders.delete(table);
    panel.onTableRemoved(table); // 面板草稿同步删除；面板正在编辑该表则直接关闭
    updateBar();
  }

  /** v2.7 一键清空已选：多选后想重来不必逐个点掉。只清选择（不退出选择模式，
   *  区别于 Esc/取消的「退出」），逐个走 removeSelected 以复用快照/配置清理与
   *  面板同步逻辑 */
  function clearSelection() {
    const n = selected.size;
    if (!n) return;
    for (const table of [...selected.keys()]) removeSelected(table);
    toast(t('toastCleared', '已清空已选表格（' + n + ' 个）', n), { type: 'info' });
    resetHint();
  }

  /** 采集任务公共骨架（虚拟滚动 startCollect / 分页翻页 startPagedCollect 共用）：
   *  进入置忙态（collecting 互斥 + 按钮组禁用 + 「停止采集」），退出在 finally
   *  无条件还原。fn 接收本次代际 gen（检查点比对用）；label 用于错误日志区分
   *  两条路径。进行中提示由 fn 自行 setHint（虚拟/分页文案不同），采集中需要
   *  的额外 UI 收敛（收拢分页面板等）也写在 fn 开头——同步段先于首个 await 执行 */
  async function withCollecting(fn, label) {
    if (collecting) return; // 互斥（按钮已禁用，防御性兜底）
    collecting = true;
    const gen = ++genToken;
    hoverBox.hidden = true;
    exportBtn.disabled = true;
    lockExpDrop();
    splitBtn.disabled = true;
    cancelBtn.textContent = t('btnStop', '停止采集'); // v2.0：采集中可中止（不退出选择模式）
    try {
      await fn(gen);
    } catch (err) {
      console.error('[HTML2XLSX] ' + label + '采集失败：', err);
      toast(t('toastCollectFail', '采集失败：' + (err && err.message ? err.message : err), err && err.message ? err.message : err), { type: 'error' });
      resetHint();
    } finally {
      collecting = false;
      cancelBtn.textContent = t('btnCancel', '取消 (Esc)');
      updateBar();
    }
  }

  function startCollect(table) {
    return withCollecting(async (gen) => {
      setHint(t('hintVirtual', '虚拟表格采集滚动中…'), '#1976d2');
      const snap = await collectVirtual(
        table,
        (n) => { if (gen === genToken) setHint(t('hintVirtualN', '虚拟表格采集滚动中… 已采集 ' + n + ' 行', n), '#1976d2'); },
        () => !active || gen !== genToken
      );
      if (!active || gen !== genToken) return; // 已退出/已作废（含「停止采集」）
      snapshots.set(table, snap);
      addSelected(table);
      toast(t('toastCollectDone', '采集完成，共 ' + snap.rows.length + ' 行（含表头）', snap.rows.length), { type: 'success' });
      resetHint();
    }, '虚拟表格');
  }

  /** v2.0：停止当前虚拟采集——genToken 作废进行中任务（collectVirtual 回 null、
   *  快照不写入、表格不选中）；不退出选择模式，按钮与提示随后由 finally 恢复。
   *  v2.5 起同样作用于分页翻页采集（collectPaged 同款令牌检查点） */
  function stopCollect() {
    genToken++;
    toast(t('toastStopped', '已停止采集'), { type: 'info' });
    resetHint();
  }

  /** v2.8：停止当前导出——exportToken 作废进行中任务（doExport 在检查点静默返回，
   *  已落盘的文件保留）；不退出选择模式，按钮与提示由 doExport 的 finally 恢复，
   *  「已停止导出」toast 同处发出（带已完成文件数）。交互对齐「停止采集」；
   *  Esc 仍为整体退出（与采集期语义一致） */
  function abortExport() {
    exportToken++;
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

  /** 「采集全部页」入口：取唯一选中的表（v2.5.3 起多选时按钮禁用，此处恒为
   *  单表）。组件分页器（el-pagination / ant-pagination，pagination.js 适配器）
   *  识别到直接采集；v2.9 起先试上次记住的手动翻页按钮（同页面 + 同表指纹），
   *  命中即直接采集、不再要求指定；都不可用才进入「指定翻页按钮」子模式兜底
   *  （用户点击下一页控件，跨页经定位器重解析）。虚拟滚动表格不经此入口 */
  function onCollectAllPages() {
    if (collecting || exporting || panel.isOpen() || specifying || !selected.size) return;
    const table = [...selected.keys()].pop(); // 唯一选中的表
    if (isVirtualTable(table)) {
      toast(t('toastVirtualAuto', '虚拟滚动表格点选时已自动采集全部行'), { type: 'info' });
      return;
    }
    const pager = detectPager(table);
    if (pager) { startPagedCollect(table, pager, false); return; }
    const remembered = persist.pager.get(table);
    const reused = remembered && pagerByLocator(remembered);
    if (reused) { // v2.9：复用记忆的翻页按钮（元素已不在页面/解析失败时回落指定子模式）
      toast(t('toastPagerReused', '已复用上次指定的翻页按钮'), { type: 'info' });
      startPagedCollect(table, reused, true);
      return;
    }
    enterSpecify();
  }

  /** 「指定翻页按钮」子模式：悬浮高亮任意元素（不限表格），点击记录为目标
   *  按钮后开始全页采集；Esc 取消，不破坏已有选区。交互骨架与选择模式同构 */
  function enterSpecify() {
    specifying = true;
    hoverTable = null;
    hoverBox.hidden = true;
    setHint(t('hintSpecify', '未识别到分页器，请点击「下一页」按钮（Esc 取消）'), '#1976d2');
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
   *  addSelected，persist 记录按指纹自动恢复）。
   *  v2.9：fromMemory = 复用记忆的翻页按钮；手动指定（含复用）时把定位器写入
   *  记忆，复用后未生效（连续两页无新行 / 表格失联）即清除，避免一直踩失效按钮 */
  async function startPagedCollect(table, pager, fromMemory) {
    await withCollecting(async (gen) => {
      closePageMenu(); // v2.5.2 采集中收拢下拉并禁用主按钮（updateBar 同步）
      pageBtn.disabled = true;
      setHint(t('hintPaged', '分页采集翻页中…'), '#1976d2');
      const manual = pager.name === 'manual' && pager.loc; // 手动指定/记忆复用的翻页按钮
      if (manual) persist.pager.save(table, pager.loc); // 记住用户指定的按钮（复用路径写入最新定位器，索引漂移自愈）
      // 页数上限：输入框留空/非法值 = 0 = 采集全部页
      const n = parseInt(pagesInput.value, 10);
      const maxPages = (Number.isFinite(n) && n >= 1) ? n : 0;
      // v2.13 翻页间隔：秒 → 毫秒。留空/非法 = 默认 0.5s；上限 600s 防误填天量值
      const sv = parseFloat(sleepInput.value);
      const pageSleep = (Number.isFinite(sv) && sv >= 0) ? Math.min(Math.round(sv * 1000), 600000) : 500;
      const res = await collectPaged(
        table, pager,
        // v2.9：分页器给出总页数时显示「第 i/N 页」，否则只显示当前页（0 = 未知）
        (page, rows, total) => {
          if (gen !== genToken) return;
          setHint(total > 0
            ? t('hintPagedTotal', '分页采集翻页中… 第 ' + page + '/' + total + ' 页，已采集 ' + rows + ' 行', page, total, rows)
            : t('hintPagedN', '分页采集翻页中… 第 ' + page + ' 页，已采集 ' + rows + ' 行', page, rows), '#1976d2');
        },
        () => !active || gen !== genToken,
        maxPages,
        pageSleep,
        // v2.14：起点归一进度 → 右侧提醒框（回到第一页的过程中驻屏显示当前页）
        (pg) => { if (gen === genToken) showSideNorm(pg); }
      );
      if (!active) return; // 已退出选择模式：丢弃
      if (res && res.aborted === 'tooFar') {
        // v2.14：距第一页超过 10 页——不自动归一，右侧提醒框请用户手动回第一页
        // 再点「开始采集」（不写快照、不采集；按钮态由 finally 还原）
        showSideTooFar(res.page);
        resetHint();
        return;
      }
      showSideNorm(null); // 其余路径（含停止/失败）收框
      // gen !== genToken = 「停止采集」：collectPaged 返回已采集页的部分结果，照常写入快照
      if (res) {
        const key = (res.root && res.root.isConnected) ? res.root : table;
        if (key !== table && selected.has(table)) removeSelected(table); // 表格被重建：迁移选中
        snapshots.set(key, res.snap); // 重采覆盖旧快照
        if (!selected.has(key)) addSelected(key);
        // v2.9：手动翻页按钮没翻动（连续两页无新行 / 表格失联）→ 清除记忆，别让下次继续踩
        if (manual && (res.reason === 'noNew' || res.reason === 'tableLost')) {
          persist.pager.save(key, null);
          if (fromMemory) {
            toast(t('toastPagerForgotten', '上次记住的翻页按钮未生效，已清除记忆；再点「采集全部页」可重新指定'), { type: 'warn' });
          }
        }
        toast(t('toastCollectDone', '采集完成，共 ' + res.snap.rows.length + ' 行（含表头）', res.snap.rows.length) +
          (res.note ? t('noteSep', '，') + res.note : ''), { type: res.note ? 'info' : 'success' });
      }
      resetHint();
    }, '分页');
  }

  function updateBar() {
    // 徽标重新编号（与 Sheet 顺序一致）
    let i = 0;
    for (const box of selected.values()) {
      box.firstChild.textContent = String(++i);
    }
    countEl.textContent = String(selected.size);
    const busy = collecting || exporting || panel.isOpen() || specifying; // 面板/导出/子模式期间主工具栏同步禁用
    clearBtn.hidden = selected.size === 0; // v2.7 无选中不占位（隐藏而非禁用，工具栏更干净）
    clearBtn.disabled = busy;
    // v2.10：导出按钮与输出方式下拉合并为一个控件，启用/禁用同源——未选表或忙态整体灰置
    const expOff = busy || selected.size === 0;
    exportBtn.disabled = expOff;
    fmtSel.disabled = expOff;
    expDrop.disabled = expOff;
    if (expOff) closeExpMenu(); // 失效后菜单不可留在屏上（v2.11）
    splitBtn.disabled = busy || selected.size === 0;
    const pageOff = busy || selected.size !== 1; // v2.5.3 下拉主按钮禁用（采集中/面板/导出/子模式、未选中或多选——分页采集只支持单表）
    pageBtn.disabled = pageOff;
    pageBtn.setAttribute('aria-disabled', pageOff ? 'true' : 'false');
    // 禁用原因随状态给出：多选时明确指向「只支持单表」，其余恢复功能说明
    pageBtn.title = (selected.size > 1)
      ? t('pageBtnTitleMulti', '多表选择时不支持分页采集：请先取消其他表格，仅保留要采集的一个')
      : t('pageBtnTitleDefault', '自动翻页采集已选中表格：点开可设置页数上限，识别不到分页器时可指定翻页按钮');
    pagesInput.disabled = pageOff;
    sleepInput.disabled = pageOff; // v2.13 翻页间隔槽与页数槽同源禁用
    if (pageOff) closePageMenu();
    // v2.6.1：语言开关随忙碌态禁用（采集中/导出/面板/子模式期间不可切换，
    // 防「切一半」——refreshTexts 只按空闲态就地重取词）
    langZhBtn.disabled = busy;
    langEnBtn.disabled = busy;
    // v2.0：已选表中存在拆分/筛选/格式配置 → 「列设置」按钮带徽标点
    const cfg = [...selected.keys()].some(hasColCfg);
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
      fr.onerror = () => reject(fr.error || new Error(t('errBase64', 'base64 编码失败')));
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

  /** v2.7 写入系统剪贴板：优先异步 Clipboard API（内容脚本继承页面剪贴板权限，
   *  点击手势内调用即可写）；页面未授权/未聚焦时回退 execCommand（老式复制路径），
   *  两者都失败才抛错（由调用方转成错误 toast，不静默） */
  async function writeClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return;
      } catch (e) { /* 权限/焦点问题：走 execCommand 回退 */ }
    }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('aria-hidden', 'true');
    ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none;';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } finally { ta.remove(); }
    if (!ok) throw new Error(t('errClipboard', '浏览器未授予剪贴板写入权限'));
  }

  function showError(msg) {
    toast(msg, { type: 'error' }); // v2.0：错误常驻可关（迁出 hint 行）
  }

  /** v2.0：导出成功保留选择（不再 0.6s 自动退出）——toast 给「退出」动作，
   *  用户可换格式连续导出；Esc / 取消 / toast 退出三条路径均可退出 */
  function finish(n) {
    toast(n > 1 ? t('toastDownloaded', '已下载 ' + n + ' 个文件', n) : t('toastDownloadStart', '已开始下载…'), {
      type: 'success',
      actions: [{ label: t('btnExit', '退出'), onClick: exit }]
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
    // v2.8：列顺序最后应用（格式已作用于值，重排只换位置；含 merges 的表在面板侧
    // 禁用拖拽——merges 按列号定位，重排会让合并区错位）
    if (!(ch.merges && ch.merges.length)) {
      aoa = reorderColumns(aoa, layout, excluded, colOrders.get(table));
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
    if (typeof XLSX === 'undefined') throw new Error(t('errXlsxMissing', 'XLSX 库未加载'));
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
    const gen = ++exportToken; // v2.8：本次导出代际（「停止导出」自增使本任务失效）
    // v2.0：导出中按钮反馈（防点击被静默吞掉）+ 进行时提示
    // v2.7：剪贴板模式（下拉选「复制为…」）复用同一条链路，只有落盘那步换成写剪贴板
    const copyKey = CLIPBOARD[fmtSel.value] ? fmtSel.value : null;
    let done = 0; // 已落盘文件数（停止导出时用于告知「已下载 N 个」）
    let copied = false; // 剪贴板已写入成功（此时即使令牌被作废也不再报「已停止导出」，避免双 toast）
    exportBtn.disabled = true;
    lockExpDrop();
    exportBtn.textContent = copyKey ? t('copyBtnBusy', '复制中…') : t('exportBtnBusy', '导出中…');
    cancelBtn.textContent = t('btnStopExport', '停止导出'); // v2.8：导出可中止（对齐「停止采集」交互）
    setHint(copyKey ? t('hintCopying', '正在复制到剪贴板…') : t('hintGenerating', '正在生成导出文件…'), '#1976d2');
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
        if (!active || gen !== exportToken) return; // yield 间隙用户已退出/已停止导出
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

      // 2. v2.7 剪贴板模式：不落盘（列拆分/筛选/格式已在上一步应用于 aoa）。
      //    多表时 TSV 表间空行分隔（粘贴进表格软件即为上下两段），Markdown 复用
      //    文档序列化（表名二级标题分区）
      if (copyKey) {
        const text = copyKey === 'copy-md'
          ? toMarkdown(tables)
          : tables.map(tb => toTsv(tb.aoa)).join('\n\n');
        try {
          await writeClipboard(text);
        } catch (err) {
          const m = err && err.message ? err.message : String(err);
          console.error('[HTML2XLSX] 复制到剪贴板失败：', err);
          showError(t('toastCopyFail', '复制失败：' + m, m));
          return;
        }
        const n = tables.reduce((sum, tb) => sum + Math.max(0, tb.aoa.length - (tb.headerRows || 0)), 0);
        copied = true;
        // v2.8：与下载成功对称——同样提供「退出」动作（保留选择、可继续换格式复制）
        toast(t('toastCopied', '已复制 ' + n + ' 行到剪贴板（可直接粘贴到表格软件）', n), {
          type: 'success',
          actions: [{ label: t('btnExit', '退出'), onClick: exit }]
        });
        return;
      }

      // 3. 按所选格式生成下载文件列表（CSV 多表为多文件，其余单文件）
      const fmtKey = FORMATS[fmtSel.value] ? fmtSel.value : 'xlsx';
      // v2.9：文件名按模板渲染（{title}/{date}/{time} 取当前页面标题与时间）；
      // 输入框留空 = 回落默认模板，仍为空则用 export_<时间戳> 兜底
      const base = sanitizeFilename(renderNameTpl(nameTpl())) || ('export_' + timestamp());
      let files;
      try {
        files = fmtKey === 'xlsx' ? [buildXlsxFile(tables, base)] : buildTextFiles(fmtKey, base, tables);
      } catch (err) {
        console.error('[HTML2XLSX] 生成导出文件失败：', err);
        showError(t('toastExportFail', '导出失败：' + (err && err.message ? err.message : err), err && err.message ? err.message : err));
        return;
      }

      // 4. 逐文件编码下载（后台 downloads 优先，失败回退 blob）；
      //    v2.0：多文件时 toast 实时进度「正在下载 i/n」
      let pt = null;
      if (files.length > 1) pt = toast(t('toastDownloading', '正在下载 1/' + files.length + '…', 1, files.length), { type: 'info', sticky: true });
      for (const [fi, file] of files.entries()) {
        if (!active || gen !== exportToken) { // 编码间隙用户已退出 / 已停止导出，放弃剩余下载
          if (pt) pt.close();
          return;
        }
        if (pt) pt.update(t('toastDownloading', '正在下载 ' + (fi + 1) + '/' + files.length + '…', fi + 1, files.length));
        await downloadFile(await arrayBufferToBase64(file.buf), file);
        done++;
        await yieldToMain();
      }
      if (pt) pt.close();
      finish(files.length);
    } finally {
      const aborted = !copied && gen !== exportToken; // v2.8：本任务被「停止导出」作废（退出场景由 active 兜底区分）
      exporting = false;
      cancelBtn.textContent = t('btnCancel', '取消 (Esc)');
      syncExportBtn(); // 恢复按钮文案（导出中… → 导出 <格式>）
      updateBar();
      if (active) {
        resetHint();
        if (aborted) {
          toast(done ? t('toastExportStoppedN', '已停止导出（已下载 ' + done + ' 个文件）', done)
            : t('toastExportStopped', '已停止导出'), { type: 'info' });
        }
      }
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
    colOrders.clear();
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
    toast(t('toastNoTables', '页面未找到表格，无法选择导出'), { type: 'warn' });
  }
  // 装配列设置面板依赖（host/Maps 为稳定引用；可变状态经 getter 读取）
  panel.init({
    host: host,
    selected: selected,
    snapshots: snapshots,
    splitRules: splitRules,
    colFilters: colFilters,
    colFormats: colFormats,
    colOrders: colOrders,
    hasColCfg: hasColCfg, // 配置判定单一实现（面板页签点/保存提示与主工具栏徽标共用）
    isBusy: () => collecting,
    isAlive: () => active,
    updateBar: updateBar,
    toast: toast
  });
  syncLangUI(); // 工具栏语言开关初始高亮（默认按浏览器语言，见 i18n.js）
  // v2.9：异步读界面偏好（输出方式 + 文件名模板）与手动翻页按钮记忆（存储面在 persist）
  loadPrefs();
  persist.pager.load();
  // v2.6.1：异步读取存储里的手动语言偏好；与初始（浏览器语言）不一致才就地重取词
  if (ns.i18n) {
    const langBefore = ns.i18n.langOf();
    ns.i18n.init().then(() => {
      if (!active) return;
      if (ns.i18n.langOf() !== langBefore) {
        closePageMenu();
        closeExpMenu();
        refreshTexts();
        updateBar();
      }
      syncLangUI();
    });
  }
  document.addEventListener('mouseover', onMouseOver, true);
  document.addEventListener('click', onClickCapture, true);
  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('scroll', onReposition, true);
  window.addEventListener('resize', onReposition);
})();