/**
 * 分页表格自动翻页采集（v2.5）
 * 依赖：table（extractTable）、persist（tableKeyOf 表头指纹）、virtual（overlapLen
 * 重叠合并）——均在函数调用时解引用，注入序置于 virtual 之后即可。
 * 分层识别：组件特征类适配器（el-pagination / ant-pagination）自动识别；
 * 识别不到由 main.js 进入「指定翻页按钮」子模式，经 manualPager 定位器跨页重解析。
 * 采集引擎 collectPaged：逐页 extractTable + overlapLen 页级重叠合并，起点归一 /
 * 指纹校验 / 三重停止。
 * v2.9：适配器增 pageSel（页码项选择器，末页号即总页数）与 total(root)
 * （0 = 未知）；collectPaged() 结果增 reason（noNew / tableLost / headerChanged /
 * stopped / maxPages / 空）与 pages；manualPager() 返回定位器 loc，新增
 * pagerByLocator()（解析不到返回 null 由主 UI 回落子模式）。
 * v2.12：翻页等待改「页码变化 + 数据落地」双判定。组件分页器（受控模式）点击后
 * 页码先更新、数据后到（异步拉取几百 ms~数秒），旧版点击后固定 sleep 350+500ms
 * 就取数，慢站点连续两页取到的还是旧页 → 误判「连续翻页无新数据」停止（已知
 * 问题：51 页站点采到第 3 页只剩 40 行）。适配器增 current(root) 读当前页码
 * （0 = 读不到）；点击后轮询：页码不变超 TURN_WAIT = 点击被页面丢弃（加载中
 * 守卫/限流）→ 重点（单页至多 RECLICK_MAX 次），单页总预算 PAGE_WAIT 内新行
 * 未落地才记一次无新行；起点归一/回退每击都等「页码真的动了 + 表体真的换了」
 * 再点下一击——只等页码会被守卫吞点击、归一后还会取到旧页数据污染整份采集。
 * v2.13：页间停顿（pageSleep，采集面板「翻页间隔」自定义，单位秒、默认 0.5s）。
 * 慢站点/带限流的后台连续翻页易被吞点击或封禁，每确定要翻下一页前停顿一次
 * （末页与达页数上限不浪费间隔）；分块等待，「停止采集」可及时中断。
 * v2.14：起点归一升级——① 直跳首页：组件分页器渲染了「1」页项时一次点击回
 * 第一页（pageSel 内找文本=1 的项，经 waitTurn 等「页码+表体」双判定确认），
 * 免去逐页回点；直跳失败（守卫吞点击/无首页项）落回逐页回点兜底。② 距第一页
 * 超过 NORM_MAX=10 页不自动归一——逐页回点既慢又易被守卫吞，collectPaged 直接
 * 返回 { aborted:'tooFar', page }（不采集、不写快照），由 main 侧右侧提醒框请
 * 用户手动回第一页后再点「开始采集」。③ 第七参 onNorm(page) 回调驱动 main 侧
 * 右侧提醒框：归一开始与每次翻页后回传当前页（0 = 读不到页码；读数已是第 1
 * 页时不回调——随即直断，避免提醒框瞬间闪），归一结束/放弃传 null 收框。
 * ④ 归一后等表体真正落地再取数（waitLanded，与主循环 waitPageData 同款 6s
 * 预算）：waitTurn 3s 预算内没落地的超慢站点（页码已回 1 但表体还是旧页），
 * 直接取数会把旧页行当成第一页写进快照（页间重叠合并只去重相邻页，跨页旧数据
 * 会成重复行）；没翻过页不等、预算内没换不阻塞（按当前内容继续，重叠合并兜底）。
 */
(() => {
  'use strict';
  const ns = window.__h2x;

  // i18n 取词（各内容脚本同构，见 architecture.md「国际化」节）：优先经 ns.i18n
  // （i18n.js 手动中英文统一入口）；词条缺失或无 chrome.i18n 环境（Node 回归 /
  // E2E 桩未注入）→ 回落代码内中文
  const t = (key, fb, ...subs) => {
    if (ns.i18n) return ns.i18n.t(key, fb, subs); // v2.6.1 手动语言开关优先
    if (typeof chrome !== 'undefined' && chrome.i18n && chrome.i18n.getMessage) {
      const m = chrome.i18n.getMessage(key, subs.length ? subs.map(String) : undefined);
      if (m) return m;
    }
    return fb;
  };

  /* ---------- 分页适配器（第一层：组件特征类，识别即精确到「下一页」按钮） ---------- */

  const PAGER_ADAPTERS = [
    { // Element Plus：button.btn-next，末页加 .disabled 类 + disabled 属性
      name: 'el-pagination',
      rootSel: '.el-pagination',
      nextSel: '.btn-next',
      prevSel: '.btn-prev',
      pageSel: '.el-pager li', // v2.9 总页数：页码项（省略号项文本非数字，解析失败自然跳过）
      isDisabled: (b) => b.classList.contains('disabled') || b.disabled === true ||
        b.getAttribute('aria-disabled') === 'true',
      // v2.12 当前页码：active 项（各家命名空间 active / is-active 均见）或 aria-current；
      // 取不到返回 0（采集引擎退化为固定预算轮询，不重点——无页码信号，重点会跳页）
      current: (pr) => {
        const li = pr.querySelector('.el-pager li.active, .el-pager li.is-active, ' +
          '.el-pager li[aria-current="true"], .el-pager li[aria-current="page"]');
        const n = li ? parseInt(String(li.textContent || '').trim(), 10) : NaN;
        return Number.isFinite(n) ? n : 0;
      }
    },
    { // Ant Design（React/Vue 通用）：li.ant-pagination-next，末页 aria-disabled + .ant-pagination-disabled
      name: 'ant-pagination',
      rootSel: '.ant-pagination',
      nextSel: '.ant-pagination-next',
      prevSel: '.ant-pagination-prev',
      pageSel: '.ant-pagination-item', // v2.9 总页数：页码项 title="N"
      isDisabled: (b) => b.classList.contains('ant-pagination-disabled') || b.disabled === true ||
        b.getAttribute('aria-disabled') === 'true',
      // v2.12 当前页码：active 项 title="N"（ant 页码项恒带 title）
      current: (pr) => {
        const li = pr.querySelector('.ant-pagination-item-active');
        const n = li ? parseInt(String(li.getAttribute('title') || li.textContent || '').trim(), 10) : NaN;
        return Number.isFinite(n) ? n : 0;
      }
    },
    { // vxe-table：button.vxe-pager--prev-btn / --next-btn，末页 is--disabled 状态类
      //（vxe 状态类约定 is-- 前缀；按钮无 disabled 属性时兜底走「连续 2 页无新行」停止）
      //（v2.9 不提供 pageSel、v2.12 不提供 current：页码项无稳定特征类，宁缺勿猜）
      name: 'vxe-pager',
      rootSel: '.vxe-pager',
      nextSel: '.vxe-pager--next-btn',
      prevSel: '.vxe-pager--prev-btn',
      isDisabled: (b) => b.classList.contains('is--disabled') || b.disabled === true ||
        b.getAttribute('aria-disabled') === 'true'
    }
  ];

  /** 分页器内页码项的最大值 = 总页数（组件分页器都会渲染出末页项）；无页码项/
   *  均无法解析返回 0——0 表示总页数未知，采集进度只显示当前页，绝不猜数 */
  function maxPageNum(pagerRoot, sel) {
    let max = 0;
    for (const el of pagerRoot.querySelectorAll(sel)) {
      const n = parseInt(String(el.getAttribute('title') || el.textContent || '').trim(), 10);
      if (Number.isFinite(n) && n > max) max = n;
    }
    return max;
  }

  /** 从表格根向上找最近祖先中的分页控件根（自最紧祖先向上、深度 ≤8，与
   *  splitGroupOf 同款防误并策略；嵌在表格内部的分页器不算——多为单元格内容） */
  function findPagerRoot(root, adapter) {
    let el = root.parentElement;
    let depth = 0;
    while (el && depth < 8) {
      for (const pr of el.querySelectorAll(adapter.rootSel)) {
        if (root.contains(pr)) continue;
        return pr;
      }
      el = el.parentElement;
      depth++;
    }
    return null;
  }

  /** 识别表格根附近的组件分页器。命中返回统一 pager 接口：
   *  next(root)/prev(root) → 按钮元素或 null（每次调用重新查找，翻页中分页器
   *  被页面重建也能重新定位）；isDisabled(btn) → 末页判定；
   *  total(root) → 总页数（0 = 未知，v2.9 供采集进度显示「第 i/N 页」）；
   *  current(root) → 当前页码（0 = 读不到，v2.12 供采集引擎判定「翻页是否真的
   *  发生」：页码先变数据后到的站点据此把等待拉长到数据落地，点击被页面丢弃时
   *  据此重点）；
   *  first(root) → 「1」页项元素或 null（v2.14 直跳首页：pageSel 内文本/title=1
   *  的项；无 pageSel（vxe/自建）或分页器未渲染「1」项时返回 null，由引擎落回
   *  逐页回点） */
  function detectPager(root) {
    for (const a of PAGER_ADAPTERS) {
      if (!findPagerRoot(root, a)) continue;
      return {
        name: a.name,
        next: (r) => { const pr = findPagerRoot(r, a); return pr ? pr.querySelector(a.nextSel) : null; },
        prev: (r) => { const pr = findPagerRoot(r, a); return pr ? pr.querySelector(a.prevSel) : null; },
        total: (r) => { const pr = findPagerRoot(r, a); return (pr && a.pageSel) ? maxPageNum(pr, a.pageSel) : 0; },
        current: (r) => { // v2.12：当前页码（0 = 适配器无钩子或读不到）
          if (!a.current) return 0;
          const pr = findPagerRoot(r, a);
          return pr ? (a.current(pr) || 0) : 0;
        },
        first: (r) => { // v2.14：首页页码项（直跳回第一页用；无 pageSel/未渲染「1」返回 null）
          if (!a.pageSel) return null;
          const pr = findPagerRoot(r, a);
          if (!pr) return null;
          for (const el of pr.querySelectorAll(a.pageSel)) {
            const n = parseInt(String(el.getAttribute('title') || el.textContent || '').trim(), 10);
            if (n === 1) return el;
          }
          return null;
        },
        isDisabled: a.isDisabled
      };
    }
    return null;
  }

  /* ---------- 手动指定按钮（第三层兜底：定位器跨页重解析） ---------- */

  /** 元素 → 定位器 { sel, idx, tag, text }：tag + 首个非状态类（active/disabled
   *  等状态类翻页后会变，不能作特征）+ 全文档同选择器序号 + 规范化文本兜底 */
  function locatorOf(el) {
    const tag = el.tagName.toLowerCase();
    const cls = Array.from(el.classList || []).find(c => !/^(active|disabled|current|is-)/.test(c));
    const sel = cls ? tag + '.' + cls : tag;
    const idx = Array.from(document.querySelectorAll(sel)).indexOf(el);
    return { sel: sel, idx: idx, tag: tag, text: (el.textContent || '').trim().slice(0, 20) };
  }

  /** 定位器 → 元素：序号命中且 tag 一致直接用；索引漂移（分页器重建致元素序
   *  变化）时按文本在候选中重找；均失败返回 null（调用方中止采集并保留已采页） */
  function resolveLocator(loc) {
    if (!loc) return null;
    const list = document.querySelectorAll(loc.sel);
    const el = list[loc.idx];
    if (el && el.tagName.toLowerCase() === loc.tag) return el;
    for (const c of list) {
      if (c.tagName.toLowerCase() === loc.tag && (c.textContent || '').trim() === loc.text) return c;
    }
    return null;
  }

  /** 用户指定的翻页按钮 → pager 接口（与适配器同构）。无 prev（自定义分页器
   * 常无规范回退按钮）：采集结束停留在末页、起点在当前页，均经 note 告知。
   *  v2.9：额外带回 loc（定位器）供 main.js 按页面记住，下次直接复用；
   *  total 恒为 0（自建分页器无总页数字段）；v2.12：current 恒为 0（自建分页器
   *  无规范页码态，读不到就不猜——退化为固定预算轮询且不重点）；v2.14：first
   *  恒为 null（无规范页码项，直跳首页不可用，归一走逐页回点） */
  function manualPager(btn) {
    const loc = locatorOf(btn);
    return {
      name: 'manual',
      loc: loc,
      next: () => resolveLocator(loc),
      prev: () => null,
      first: () => null,
      total: () => 0,
      current: () => 0,
      isDisabled: (b) => b.disabled === true || b.getAttribute('aria-disabled') === 'true' ||
        b.classList.contains('disabled')
    };
  }

  /** 记忆的定位器 → pager 接口（v2.9）：元素已不在页面/无法解析返回 null
   *  （调用方回落「指定翻页按钮」子模式）；命中后按当前元素重算定位器（索引
   *  漂移自愈，下次记忆仍是最新形态） */
  function pagerByLocator(loc) {
    const el = resolveLocator(loc);
    return el ? manualPager(el) : null;
  }

  /* ---------- 编程式点击豁免（v2.4 链接拦截的例外通道） ----------
   *分页控件常为 a[href]（ant-pagination / jQuery 分页插件），扩展自己的翻页
   *点击若被 main.js 采集期全拦截吞掉，翻页永远不发生。clickPaging 在派发期间
   *持有按钮引用（click() 同步派发，监听器执行时可见），main 经 isPagingClick 放行 */

  let pagingBtn = null;

  function clickPaging(btn) {
    pagingBtn = btn;
    try { btn.click(); } finally { pagingBtn = null; }
  }

  /** 判定事件是否为翻页按钮的编程式点击（main.js 采集期拦截分支调用） */
  function isPagingClick(e) {
    return !!pagingBtn && e.composedPath().indexOf(pagingBtn) >= 0;
  }

  /* ---------- 采集引擎 ---------- */

  const settle = (ms) => new Promise(res => { requestAnimationFrame(() => setTimeout(res, ms)); });

  /* v2.12 单页等待参数：组件分页器点击后页码先更新、数据后到（异步拉取），
   * 固定 sleep 猜渲染时机必漏采（已知问题：拉取 ~2s 的站点采到第 3 页就误判
   * 「连续翻页无新数据」停止）。改为轮询「页码真的变了 + 新行落地」：
   *  - 页码不变超 TURN_WAIT = 点击被页面丢弃（加载中守卫/限流）→ 重点；
   *  - 单页总预算 PAGE_WAIT 内新行始终未落地，才记一次「无新行」；
   *  - 读不到页码（手动分页器/vxe）时退化为固定预算轮询，不重点（无页码
   *    信号，重点会跳过页）。 */
  const PAGE_WAIT = 6000;  // 单页数据落地总预算（ms）
  const TURN_WAIT = 1200;  // 点击后等页码变化的最长间隔，超过则重点（ms）
  const RECLICK_MAX = 3;   // 单页内最大重点次数
  const POLL = 250;        // 轮询间隔（ms）
  const FIRST_TAKE = 300;  // 点击后首次取数前的等待（同步翻页站点与旧版 350ms 同速）
  // v2.14：起点归一页数阈值——当前页距第一页超过它就不自动归一（逐页回点既慢又
  // 易被加载中守卫吞），交还用户手动回第一页后再点「开始采集」
  const NORM_MAX = 10;

  /** 表格根失联重解析：翻页触发整表重建时，全文档候选（table / 网格根）按
   *  表头指纹匹配找回新根；找不到返回 null（调用方中止并保留已采页） */
  function resolveRoot(key) {
    if (!key) return null;
    let sel = 'table';
    if (ns.table.GRID_ROOT_SELECTOR) sel += ', ' + ns.table.GRID_ROOT_SELECTOR;
    for (const c of document.querySelectorAll(sel)) {
      if (ns.persist.tableKeyOf(c) === key) return c;
    }
    return null;
  }

  /**
   * 自动翻页采集分页表格全部行。
   * 流程：距第一页超过 NORM_MAX 页 → 不归一（返回 aborted，交还用户手动回第一页）；
   * 否则起点归一（v2.14 优先直跳「1」页项，失败落回逐页回点）→ 逐页 extractTable →
   * 数据行相邻重叠合并（表头只保留第一页的，逐页校验指纹防翻到结构不同的视图）
   * → 停止（下一页 disabled / 连续 2 页无新行 / 500 页硬上限 / 达到 maxPages
   * 页数上限）→ prev 可用时逐页回退到起始页。
   * maxPages：页数上限（≥1 生效，0/undefined 采集全部页）。
   * pageSleep：页间停顿毫秒数（v2.13，采集面板「翻页间隔」自定义，单位秒、
   * 默认 0.5s；undefined/负数/NaN 按默认 500ms）。每确定要翻下一页前停顿
   * 一次（末页/达上限不停），分块等待保证「停止采集」及时中断。
   * onProgress(page, rows, totalPages)：totalPages 为分页器给出的总页数，
   * 0 = 未知（自建分页器等无总数字段，v2.9 起进度文案据此决定是否显示 i/N）。
   * onNorm(page)：v2.14 起点归一进度回调——归一开始与每次翻页后回传当前页
   * （0 = 读不到页码，如手动分页器/vxe；读数已是第 1 页时不回调），归一结束/放弃
   * 传 null（main 侧据此显示/收起右侧提醒框）；可选参数。归一后若翻过页，会先等
   * 表体内容落地（waitLanded，6s 预算）再取第一页——防止超慢站点把旧页数据当第一页。
   * 返回 { snap, root, note, reason, pages }：snap 与 collectVirtual 快照同构
   * （不含 merges——跨页拼接的合并单元格行号无法稳定对齐，v2.5 不还原，见
   * product.md 已知限制）；root 为采集结束时的表格根（翻页中被页面重建则与入参
   * 不同，main 据此迁移选中）；note 为提前停止/降级说明（完整采集为空串）；
   * reason 为机器可读的停止原因（v2.9，main 据以判断「记忆的翻页按钮是否生效」：
   * 'noNew' 连续两页无新行 / 页码始终不动（v2.12）/ 'tableLost' 表格失联 /
   * 'headerChanged' 表头变化 / 'stopped' 用户中止 / 'maxPages' 达页数上限 /
   * '' 正常结束）；pages 为实际翻到的页数。
   * v2.14：距第一页超过 NORM_MAX 页时不归一、不采集，返回
   * { aborted:'tooFar', page }（main 弹右侧提醒框请用户手动回第一页后再开始）。
   * 取消：起点归一阶段（尚无采集数据）返回 null；开始采集后返回已采集页的
   * 部分结果（note 注明「已停止」——main 据此保留快照，用户手动中止不丢已采页）。
   */
  async function collectPaged(root, pager, onProgress, isCancelled, maxPages, pageSleep, onNorm) {
    const key0 = ns.persist.tableKeyOf(root);
    let note = '';

    // v2.13：页间停顿毫秒数（采集面板自定义，单位秒；undefined/负数/NaN 按默认 0.5s）
    const sleepMs = (typeof pageSleep === 'number' && Number.isFinite(pageSleep) && pageSleep >= 0)
      ? pageSleep : 500;

    /** v2.13：页间停顿。分块等待——长间隔下「停止采集」仍能及时中断（不分块
     *  要等整个间隔结束才检查取消）；返回 false = 已取消（调用方按停止收尾） */
    const pagePause = async (ms) => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) {
        if (isCancelled()) return false;
        await settle(Math.min(100, ms - (Date.now() - t0)));
      }
      return true;
    };

    // v2.12：当前页码读取（适配器无钩子/读不到返回 0；异常按读不到处理）
    const curPage = () => {
      try { return (pager.current && pager.current(root)) || 0; } catch (e) { return 0; }
    };

    /** v2.12：表体内容签名（长度 + 尾部采样）——数据延迟落地的站点页码先变、
     *  表体后到，翻页是否「真的完成」以内容变化为准（尾部采样防同长度碰撞，
     *  实在等不到由调用方预算兜底：按当前内容继续） */
    const contentSig = () => {
      const s = root.textContent || '';
      return s.length + '|' + s.slice(-64);
    };

    /** v2.12：等一次翻页真正完成（页码变化 + 表体内容变化）。before = 点击前
     *  页码、sigBefore = 点击前内容签名；读不到页码（0）时退化为固定 200ms
     *  等待并按「已翻页」返回（旧行为——无信号不猜）。budget 内没翻动返回
     *  false（调用方重点或中止） */
    const waitTurn = async (before, sigBefore, budget) => {
      if (!before) { await settle(200); return true; }
      const t0 = Date.now();
      while (Date.now() - t0 < budget) {
        if (isCancelled()) return false;
        const p = curPage();
        if (p > 0 && p !== before && contentSig() !== sigBefore) return true;
        await settle(150);
      }
      return false;
    };

    /** v2.14：等表体内容换成新页（数据延迟落地的站点受控分页器点击后页码先到、
     * 表体后到，waitTurn 的 3s 预算内没落地就落回逐页回点/直断）。与 waitTurn 的
     * 差别：不要求页码变化——调用方已确认翻页发生，剩下的只是等数据；与主循环
     * waitPageData 同款预算（PAGE_WAIT）。预算内没换也不算失败（返回 false，调用方
     * 按当前内容继续，页间重叠合并不受重复取数影响）；翻页触发整表重建时按指纹
     * 重解析（与主循环同款容错——否则只会盯着失联的旧根白等） */
    const waitLanded = async (sigBefore, budget) => {
      const t0 = Date.now();
      while (Date.now() - t0 < budget) {
        if (isCancelled()) return false;
        if (!root.isConnected) {
          const nr = resolveRoot(key0);
          if (nr) root = nr;
        }
        if (contentSig() !== sigBefore) return true;
        await settle(POLL);
      }
      return false;
    };

    // v2.14：距第一页超过 NORM_MAX 页——无论 prev 是否可用都不自动归一（逐页
    // 回点既慢又易被加载中守卫吞），直接交还用户手动回第一页后再点「开始采集」
    const cur0 = curPage();
    if (cur0 > NORM_MAX) return { aborted: 'tooFar', page: cur0 };

    // 起点归一：不在第一页先回第一页，保证采全量
    const pv0 = pager.prev(root);
    if (pv0 && !pager.isDisabled(pv0)) {
      // v2.14：读数已是第 1 页时不弹归一提醒框——随即就会走「页码已是 1 直断」，
      // 弹了也是同一任务内瞬间闪（不规范分页器：第一页 prev 仍可用）
      if (onNorm && cur0 !== 1) onNorm(cur0); // v2.14：右侧提醒框显示「正在回到第一页」（0 = 读不到页码）
      const sigNorm0 = contentSig(); // v2.14：归一前表体签名（等落地对照用）
      let normNav = false;           // v2.14：归一是否真的翻过页（没翻就不用等落地）
      // v2.14：优先直跳首页——组件分页器渲染了「1」页项时一次点击到位，免去
      // 逐页回点（≤10 页也要点至多 9 次，慢站点每击都要等翻页落地）。cur0===1
      // （已在第一页但 prev 未禁用的不规范分页器）不跳——点了也不会翻，空等
      // 一个 waitTurn 预算，直接走逐页回点的「页码已是 1 直断」
      const fb = (cur0 !== 1 && pager.first) ? pager.first(root) : null;
      let jumped = false;
      if (fb) {
        const before = curPage();
        const sigBefore = contentSig();
        clickPaging(fb);
        normNav = true;
        // 等「页码回到 1 + 表体换成第一页」再收工；没翻动（守卫吞点击/首页项
        // 点击无效）落回逐页回点兜底
        jumped = await waitTurn(before, sigBefore, 3000);
        if (!jumped && isCancelled()) return null;
        if (!root.isConnected) { // 直跳触发整表重建：按指纹找回
          const nr = resolveRoot(key0);
          if (nr) root = nr;
        }
      }
      if (!jumped) {
        const t0 = Date.now();
        for (let i = 0; i < 500; i++) {
          const pv = pager.prev(root);
          if (!pv || pager.isDisabled(pv)) break;
          if (curPage() === 1) break; // 页码已回第一页（disabled 态滞后于页码时直断）
          const before = curPage();
          const sigBefore = contentSig();
          clickPaging(pv);
          normNav = true;
          // v2.12：等「页码往回走 + 表体换成新页」再点下一击——慢站点 prev 点击
          // 会被加载中守卫丢弃，且页码先变数据后到，只等页码会在归一后取到旧页
          // 数据（污染整份采集）；旧版固定 200ms 连点两个坑都踩
          await waitTurn(before, sigBefore, 3000);
          if (onNorm) onNorm(curPage()); // v2.14：右侧提醒框同步当前页
          if (isCancelled()) return null;
          if (!root.isConnected) { // 回退中表格被重建：按指纹找回
            const nr = resolveRoot(key0);
            if (nr) root = nr; else break;
          }
          if (Date.now() - t0 > 120000) { // 2 分钟仍回不到第一页：放弃归一，从当前页采起
            note = t('noteStartFromCurrent', '自当前页开始采集');
            break;
          }
        }
      }
      // v2.14：归一后等表体真正落地再取数——waitTurn 3s 预算内没落地的超慢站点
      // （页码已回 1 但表体还是旧页），直接 extractTable 会把旧页行当成第一页写进
      // 快照（页间重叠合并只去重相邻页，跨页旧数据会成重复行）。与主循环 waitPageData
      // 同款 6s 预算；没翻过页（cur0 读数已是 1 的不规范分页器/prev 直断）不等；
      // 预算内没换也不阻塞（按当前内容继续，重叠合并兜底）；取消即返回 null
      if (normNav) {
        const landed = await waitLanded(sigNorm0, PAGE_WAIT);
        if (!landed && isCancelled()) return null;
      }
      if (onNorm) onNorm(null); // v2.14：归一结束（成功/放弃均收框）
    } else if (!pv0) {
      note = t('noteStartFromCurrent', '自当前页开始采集'); // 自定义分页器无规范回退按钮
    }

    const first = ns.table.extractTable(root);
    const headerRows = first.headerRows || 0;
    const headers = []; // 表头行对象（与虚拟采集同构，只保留第一页的）
    for (let i = 0; i < headerRows; i++) {
      // extractTable 行通道为 aoa（rows 是 collectVirtual 快照的字段名，勿混）
      headers.push({ merged: first.aoa[i], ctrl: first.ctrl[i], text: first.text[i], blocks: first.blocks[i] });
    }
    const data = [];     // 数据行对象
    const dataSigs = []; // 行签名（与 data 同步增长，供重叠匹配）
    const sigOf = (row) => row.sig || (row.sig = row.merged.join('\x01'));

    /** 当前页快照并入：剥离表头行，数据行做后缀/前缀重叠合并（页间通常无重叠，
     *  k=0 直接拼接；重复点击/渲染未完成时窗口仍为上一页内容，重叠消除重复）。
     *  返回新增行数 */
    const takePage = (ex) => {
      const win = [];
      for (let i = (ex.headerRows || 0); i < ex.aoa.length; i++) {
        win.push({ merged: ex.aoa[i], ctrl: ex.ctrl[i], text: ex.text[i], blocks: ex.blocks[i] });
      }
      const k = ns.virtual.overlapLen(dataSigs, win.map(sigOf));
      for (let i = k; i < win.length; i++) {
        data.push(win[i]);
        dataSigs.push(win[i].sig);
      }
      return win.length - k;
    };

    const result = (extra, reason) => {
      const all = headers.concat(data);
      return {
        snap: {
          rows: all.map(r => r.merged),
          ctrl: all.map(r => r.ctrl),
          text: all.map(r => r.text),
          blocks: all.map(r => r.blocks),
          headerRows: headers.length
        },
        root: root,
        pages: page,             // v2.9：实际采集的页数
        reason: reason || '',    // v2.9：机器可读停止原因（note 供展示，reason 供判定）
        note: extra ? (note ? note + t('noteSep', '，') + extra : extra) : note
      };
    };

    /** v2.12：等当前页数据落地。轮询 extractTable 直到有新行 / 预算尽；
     *  页码可读时以「页码变化」判定翻页是否真的发生：不变且超 TURN_WAIT →
     *  重点（页面加载中守卫/限流会丢弃点击），至多 RECLICK_MAX 次；
     *  返回 { added, turned, tableLost, headerChanged }：
     *  turned = 页码是否变化过（读不到页码恒 true——无法判定就不冤枉点击）；
     *  tableLost/headerChanged = 等待期间表格失联/表头变化（调用方中止）。
     *  取数在每次轮询都做（不等页码）：数据先于页码落地的站点也能采到，
     *  且重叠合并不受重复取数影响 */
    const waitPageData = async (cur0) => {
      const t0 = Date.now();
      let turned = cur0 === 0;
      let reclicks = 0;
      let nextReclickAt = t0 + TURN_WAIT; // 下次重点时机（每次重点后顺延一个间隔）
      let lostSince = 0;
      await settle(FIRST_TAKE);
      while (Date.now() - t0 < PAGE_WAIT) {
        if (isCancelled()) return { added: 0, turned };
        if (!turned) {
          const p = curPage();
          if (p > 0 && p !== cur0) turned = true;
          else if (p > 0 && reclicks < RECLICK_MAX && Date.now() >= nextReclickAt) {
            // 页码不动：点击被页面丢弃（守卫/限流）→ 重点（重新查找按钮，
            // 翻页中分页器被重建也能定位；按钮消失/禁用即末页，交还主循环）
            const again = pager.next(root);
            if (!again || pager.isDisabled(again)) return { added: 0, turned };
            clickPaging(again);
            reclicks++;
            nextReclickAt = Date.now() + TURN_WAIT;
          }
        }
        if (!root.isConnected) { // 翻页触发整表重建：按指纹重解析（瞬时失联容错）
          const nr = resolveRoot(key0);
          if (nr) root = nr;
          else { if (!lostSince) lostSince = Date.now(); }
        } else {
          lostSince = 0;
        }
        if (lostSince && Date.now() - lostSince > 1000) {
          return { added: 0, turned, tableLost: true };
        }
        // 表头指纹校验：仅当双方都读得到且不同才中止（重建瞬时表头未渲染 =
        // 读不到，不能误判为「表头变化」）
        const k = ns.persist.tableKeyOf(root);
        if (k && key0 && k !== key0) return { added: 0, turned, headerChanged: true };
        const added = takePage(ns.table.extractTable(root));
        if (added > 0) return { added, turned };
        onProgress(page + 1, headers.length + data.length, totalPages); // 等待期间进度显示目标页
        await settle(POLL);
      }
      return { added: 0, turned };
    };

    takePage(first);
    const totalPages = pager.total ? (pager.total(root) || 0) : 0; // v2.9：总页数（0 = 未知）
    let page = 1;
    onProgress(page, headers.length + data.length, totalPages);
    let noNew = 0;
    let limitHit = false; // 达到 maxPages 页数上限（区别于自然到末页）
    for (let i = 0; i < 500; i++) { // 页数硬上限防死循环（循环加载/异常页面）
      if (isCancelled()) return result(t('noteStopped', '已停止采集，保留已采集的 ' + page + ' 页', page), 'stopped');
      if (maxPages > 0 && page >= maxPages) { limitHit = true; break; } // 达到页数上限
      if (!root.isConnected) { // 翻页触发整表重建：按指纹重解析
        const nr = resolveRoot(key0);
        if (!nr) return result(t('noteTableLost', '翻页后表格失联，已保留已采集的 ' + page + ' 页', page), 'tableLost');
        root = nr;
      }
      const next = pager.next(root);
      if (!next || pager.isDisabled(next)) break; // 末页（按钮禁用/消失）
      // v2.13：页间停顿（确定要翻页才等——末页/达上限不浪费间隔；分块可中断）
      if (sleepMs > 0 && !(await pagePause(sleepMs))) {
        return result(t('noteStopped', '已停止采集，保留已采集的 ' + page + ' 页', page), 'stopped');
      }
      const cur0 = curPage();
      clickPaging(next);
      const r = await waitPageData(cur0);
      if (isCancelled()) return result(t('noteStopped', '已停止采集，保留已采集的 ' + page + ' 页', page), 'stopped');
      if (r.tableLost) return result(t('noteTableLost', '翻页后表格失联，已保留已采集的 ' + page + ' 页', page), 'tableLost');
      if (r.headerChanged) return result(t('noteHeaderChanged', '翻页后表头变化，已保留已采集的 ' + page + ' 页', page), 'headerChanged');
      page++;
      if (r.added === 0) {
        // 页码变了但行没变 = 真的没有新数据；页码始终不动 = 点击被页面丢弃
        // （加载中守卫/限流，已重点 RECLICK_MAX 次）——二者都记一次，连续两次即停
        if (++noNew >= 2) return result(r.turned
          ? t('noteNoNew', '连续翻页无新数据，已停止')
          : t('noteNoTurn', '翻页按钮点击后页面未变化，已保留已采集的 ' + (page - 1) + ' 页', page - 1), 'noNew');
      } else {
        noNew = 0;
      }
      onProgress(page, headers.length + data.length, totalPages);
    }

    // 回到起始页（起点归一后即第一页；prev 可用时逐页回退，按钮禁用即到顶）
    const prev = pager.prev(root);
    if (prev) {
      for (let p = page - 1; p > 0; p--) {
        const pv = pager.prev(root);
        if (!pv || pager.isDisabled(pv)) break;
        const before = curPage();
        const sigBefore = contentSig();
        clickPaging(pv);
        // v2.12：等「页码减一 + 表体换成新页」再点下一击——慢站点 prev 点击会被
        // 加载中守卫丢弃（旧版固定 200ms 连点大多落空、停在半途）；没翻动就再点
        // 一次，仍不动才停（停在半途好过快点击落空后停在半途且更快）
        if (before) {
          if (!(await waitTurn(before, sigBefore, 3000))) {
            const pv2 = pager.prev(root);
            if (!pv2 || pager.isDisabled(pv2)) break;
            clickPaging(pv2);
            if (!(await waitTurn(before, sigBefore, 3000))) break;
          }
        } else {
          await settle(200);
        }
        if (isCancelled()) return result(t('noteStopped', '已停止采集，保留已采集的 ' + page + ' 页', page), 'stopped');
        if (!root.isConnected) {
          const nr = resolveRoot(key0);
          if (nr) root = nr; else break;
        }
      }
    } else if (page > 1) {
      note = note ? note + t('noteSep', '，') + t('noteStayLast', '页面停留在末页')
        : t('noteStayLast', '页面停留在末页');
    }
    return result(limitHit ? t('noteMaxPages', '已采集指定 ' + maxPages + ' 页', maxPages) : '', limitHit ? 'maxPages' : '');
  }

  ns.pagination = {
    adapters: PAGER_ADAPTERS,
    detectPager: detectPager,
    manualPager: manualPager,
    pagerByLocator: pagerByLocator,
    collectPaged: collectPaged,
    isPagingClick: isPagingClick
  };
})();
