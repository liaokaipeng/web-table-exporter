/**
 * 分页表格自动翻页采集（v2.5）
 * 依赖：table（extractTable）、persist（tableKeyOf 表头指纹）、virtual（overlapLen
 * 重叠合并）——均在函数调用时解引用，注入序置于 virtual 之后即可。
 * 分层识别：组件特征类适配器（el-pagination / ant-pagination）自动识别；
 * 识别不到由 main.js 进入「指定翻页按钮」子模式，经 manualPager 定位器跨页重解析。
 * 采集引擎 collectPaged：逐页 extractTable + 相邻重叠合并（页间通常无重叠，
 * k=0 直接拼接），停止条件三重兜底（按钮 disabled / 连续 2 页无新行 / 500 页硬上限）。
 * v2.9：适配器增 pageSel（页码项选择器）与 total（总页数，0 = 未知）——进度显示
 * 「第 i/N 页」；collectPaged 结果增 reason（机器可读停止原因）与 pages；
 * manualPager 带回 loc、新增 pagerByLocator，支撑「手动指定按钮按页面记忆」。
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
        b.getAttribute('aria-disabled') === 'true'
    },
    { // Ant Design（React/Vue 通用）：li.ant-pagination-next，末页 aria-disabled + .ant-pagination-disabled
      name: 'ant-pagination',
      rootSel: '.ant-pagination',
      nextSel: '.ant-pagination-next',
      prevSel: '.ant-pagination-prev',
      pageSel: '.ant-pagination-item', // v2.9 总页数：页码项 title="N"
      isDisabled: (b) => b.classList.contains('ant-pagination-disabled') || b.disabled === true ||
        b.getAttribute('aria-disabled') === 'true'
    },
    { // vxe-table：button.vxe-pager--prev-btn / --next-btn，末页 is--disabled 状态类
      //（vxe 状态类约定 is-- 前缀；按钮无 disabled 属性时兜底走「连续 2 页无新行」停止）
      //（v2.9 不提供 pageSel：页码项无稳定特征类，总页数未知则不显示，宁缺勿猜）
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
   *  total(root) → 总页数（0 = 未知，v2.9 供采集进度显示「第 i/N 页」） */
  function detectPager(root) {
    for (const a of PAGER_ADAPTERS) {
      if (!findPagerRoot(root, a)) continue;
      return {
        name: a.name,
        next: (r) => { const pr = findPagerRoot(r, a); return pr ? pr.querySelector(a.nextSel) : null; },
        prev: (r) => { const pr = findPagerRoot(r, a); return pr ? pr.querySelector(a.prevSel) : null; },
        total: (r) => { const pr = findPagerRoot(r, a); return (pr && a.pageSel) ? maxPageNum(pr, a.pageSel) : 0; },
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
   *  常无规范回退按钮）：采集结束停留在末页、起点在当前页，均经 note 告知。
   *  v2.9：额外带回 loc（定位器）供 main.js 按页面记住，下次直接复用；
   *  total 恒为 0（自建分页器无总页数字段） */
  function manualPager(btn) {
    const loc = locatorOf(btn);
    return {
      name: 'manual',
      loc: loc,
      next: () => resolveLocator(loc),
      prev: () => null,
      total: () => 0,
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
   * 分页控件常为 a[href]（ant-pagination / jQuery 分页插件），扩展自己的翻页
   * 点击若被 main.js 采集期全拦截吞掉，翻页永远不发生。clickPaging 在派发期间
   * 持有按钮引用（click() 同步派发，监听器执行时可见），main 经 isPagingClick 放行 */

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
   * 流程：起点归一（prev 可用且未禁用则先回第一页）→ 逐页 extractTable →
   * 数据行相邻重叠合并（表头只保留第一页的，逐页校验指纹防翻到结构不同的视图）
   * → 停止（下一页 disabled / 连续 2 页无新行 / 500 页硬上限 / 达到 maxPages
   * 页数上限）→ prev 可用时逐页回退到起始页。
   * maxPages：页数上限（≥1 生效，0/undefined 采集全部页）。
   * onProgress(page, rows, totalPages)：totalPages 为分页器给出的总页数，
   * 0 = 未知（自建分页器等无总数字段，v2.9 起进度文案据此决定是否显示 i/N）。
   * 返回 { snap, root, note, reason, pages }：snap 与 collectVirtual 快照同构
   * （不含 merges——跨页拼接的合并单元格行号无法稳定对齐，v2.5 不还原，见
   * product.md 已知限制）；root 为采集结束时的表格根（翻页中被页面重建则与入参
   * 不同，main 据此迁移选中）；note 为提前停止/降级说明（完整采集为空串）；
   * reason 为机器可读的停止原因（v2.9，main 据以判断「记忆的翻页按钮是否生效」：
   * 'noNew' 连续两页无新行 / 'tableLost' 表格失联 / 'headerChanged' 表头变化 /
   * 'stopped' 用户中止 / 'maxPages' 达页数上限 / '' 正常结束）；
   * pages 为实际翻到的页数。
   * 取消：起点归一阶段（尚无采集数据）返回 null；开始采集后返回已采集页的
   * 部分结果（note 注明「已停止」——main 据此保留快照，用户手动中止不丢已采页）。
   */
  async function collectPaged(root, pager, onProgress, isCancelled, maxPages) {
    const key0 = ns.persist.tableKeyOf(root);
    let note = '';

    // 起点归一：不在第一页（prev 可用且未禁用）先回第一页，保证采全量
    const pv0 = pager.prev(root);
    if (pv0 && !pager.isDisabled(pv0)) {
      for (let i = 0; i < 500; i++) {
        const pv = pager.prev(root);
        if (!pv || pager.isDisabled(pv)) break;
        clickPaging(pv);
        await settle(200);
        if (isCancelled()) return null;
        if (!root.isConnected) { // 回退中表格被重建：按指纹找回
          const nr = resolveRoot(key0);
          if (nr) root = nr; else break;
        }
      }
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

    /** 当前页快照并入：剥离表头行，数据行做后缀/前缀重叠合并（页间通常无重叠
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
      clickPaging(next);
      await settle(350); // 等页面渲染新页
      if (isCancelled()) return result(t('noteStopped', '已停止采集，保留已采集的 ' + page + ' 页', page), 'stopped');
      if (!root.isConnected) {
        const nr = resolveRoot(key0);
        if (!nr) return result(t('noteTableLost', '翻页后表格失联，已保留已采集的 ' + page + ' 页', page), 'tableLost');
        root = nr;
      }
      if (ns.persist.tableKeyOf(root) !== key0) {
        return result(t('noteHeaderChanged', '翻页后表头变化，已保留已采集的 ' + page + ' 页', page), 'headerChanged');
      }
      let added = takePage(ns.table.extractTable(root));
      if (added === 0) { // 渲染慢：补等一次再采（同 collectVirtual）
        await settle(500);
        if (isCancelled()) return result(t('noteStopped', '已停止采集，保留已采集的 ' + page + ' 页', page), 'stopped');
        added = takePage(ns.table.extractTable(root));
      }
      page++;
      if (added === 0) {
        // 用户指定的按钮常无规范 disabled 态：连续 2 页无新行 = 到底
        if (++noNew >= 2) return result(t('noteNoNew', '连续翻页无新数据，已停止'), 'noNew');
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
        clickPaging(pv);
        await settle(200);
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
