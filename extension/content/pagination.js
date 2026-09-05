/**
 * 分页表格自动翻页采集（v2.5，方案见 docs/pagination-plan.md）
 * 依赖：table（extractTable）、persist（tableKeyOf 表头指纹）、virtual（overlapLen
 * 重叠合并）——均在函数调用时解引用，注入序置于 virtual 之后即可。
 * 分层识别：组件特征类适配器（el-pagination / ant-pagination）自动识别；
 * 识别不到由 main.js 进入「指定翻页按钮」子模式，经 manualPager 定位器跨页重解析。
 * 采集引擎 collectPaged：逐页 extractTable + 相邻重叠合并（页间通常无重叠，
 * k=0 直接拼接），停止条件三重兜底（按钮 disabled / 连续 2 页无新行 / 500 页硬上限）。
 */
(() => {
  'use strict';
  const ns = window.__h2x;

  /* ---------- 分页适配器（第一层：组件特征类，识别即精确到「下一页」按钮） ---------- */

  const PAGER_ADAPTERS = [
    { // Element Plus：button.btn-next，末页加 .disabled 类 + disabled 属性
      name: 'el-pagination',
      rootSel: '.el-pagination',
      nextSel: '.btn-next',
      prevSel: '.btn-prev',
      isDisabled: (b) => b.classList.contains('disabled') || b.disabled === true ||
        b.getAttribute('aria-disabled') === 'true'
    },
    { // Ant Design（React/Vue 通用）：li.ant-pagination-next，末页 aria-disabled + .ant-pagination-disabled
      name: 'ant-pagination',
      rootSel: '.ant-pagination',
      nextSel: '.ant-pagination-next',
      prevSel: '.ant-pagination-prev',
      isDisabled: (b) => b.classList.contains('ant-pagination-disabled') || b.disabled === true ||
        b.getAttribute('aria-disabled') === 'true'
    },
    { // vxe-table：button.vxe-pager--prev-btn / --next-btn，末页 is--disabled 状态类
      //（vxe 状态类约定 is-- 前缀；按钮无 disabled 属性时兜底走「连续 2 页无新行」停止）
      name: 'vxe-pager',
      rootSel: '.vxe-pager',
      nextSel: '.vxe-pager--next-btn',
      prevSel: '.vxe-pager--prev-btn',
      isDisabled: (b) => b.classList.contains('is--disabled') || b.disabled === true ||
        b.getAttribute('aria-disabled') === 'true'
    }
  ];

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
   *  被页面重建也能重新定位）；isDisabled(btn) → 末页判定 */
  function detectPager(root) {
    for (const a of PAGER_ADAPTERS) {
      if (!findPagerRoot(root, a)) continue;
      return {
        name: a.name,
        next: (r) => { const pr = findPagerRoot(r, a); return pr ? pr.querySelector(a.nextSel) : null; },
        prev: (r) => { const pr = findPagerRoot(r, a); return pr ? pr.querySelector(a.prevSel) : null; },
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
   *  常无规范回退按钮）：采集结束停留在末页、起点在当前页，均经 note 告知 */
  function manualPager(btn) {
    const loc = locatorOf(btn);
    return {
      name: 'manual',
      next: () => resolveLocator(loc),
      prev: () => null,
      isDisabled: (b) => b.disabled === true || b.getAttribute('aria-disabled') === 'true' ||
        b.classList.contains('disabled')
    };
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
   * 返回 { snap, root, note }：snap 与 collectVirtual 快照同构（不含 merges——
   * 跨页拼接的合并单元格行号无法稳定对齐，v2.5 不还原，见 product.md 已知限制）；
   * root 为采集结束时的表格根（翻页中被页面重建则与入参不同，main 据此迁移选中）；
   * note 为提前停止/降级说明（完整采集为空串）。
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
      note = '自当前页开始采集'; // 自定义分页器无规范回退按钮
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

    const result = (extra) => {
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
        note: extra ? (note ? note + '，' + extra : extra) : note
      };
    };

    takePage(first);
    let page = 1;
    onProgress(page, headers.length + data.length);
    let noNew = 0;
    let limitHit = false; // 达到 maxPages 页数上限（区别于自然到末页）
    for (let i = 0; i < 500; i++) { // 页数硬上限防死循环（循环加载/异常页面）
      if (isCancelled()) return result('已停止采集，保留已采集的 ' + page + ' 页');
      if (maxPages > 0 && page >= maxPages) { limitHit = true; break; } // 达到页数上限
      if (!root.isConnected) { // 翻页触发整表重建：按指纹重解析
        const nr = resolveRoot(key0);
        if (!nr) return result('翻页后表格失联，已保留已采集的 ' + page + ' 页');
        root = nr;
      }
      const next = pager.next(root);
      if (!next || pager.isDisabled(next)) break; // 末页（按钮禁用/消失）
      clickPaging(next);
      await settle(350); // 等页面渲染新页
      if (isCancelled()) return result('已停止采集，保留已采集的 ' + page + ' 页');
      if (!root.isConnected) {
        const nr = resolveRoot(key0);
        if (!nr) return result('翻页后表格失联，已保留已采集的 ' + page + ' 页');
        root = nr;
      }
      if (ns.persist.tableKeyOf(root) !== key0) {
        return result('翻页后表头变化，已保留已采集的 ' + page + ' 页');
      }
      let added = takePage(ns.table.extractTable(root));
      if (added === 0) { // 渲染慢：补等一次再采（同 collectVirtual）
        await settle(500);
        if (isCancelled()) return result('已停止采集，保留已采集的 ' + page + ' 页');
        added = takePage(ns.table.extractTable(root));
      }
      page++;
      if (added === 0) {
        // 用户指定的按钮常无规范 disabled 态：连续 2 页无新行 = 到底
        if (++noNew >= 2) return result('连续翻页无新数据，已停止');
      } else {
        noNew = 0;
      }
      onProgress(page, headers.length + data.length);
    }

    // 回到起始页（起点归一后即第一页；prev 可用时逐页回退，按钮禁用即到顶）
    const prev = pager.prev(root);
    if (prev) {
      for (let p = page - 1; p > 0; p--) {
        const pv = pager.prev(root);
        if (!pv || pager.isDisabled(pv)) break;
        clickPaging(pv);
        await settle(200);
        if (isCancelled()) return result('已停止采集，保留已采集的 ' + page + ' 页');
        if (!root.isConnected) {
          const nr = resolveRoot(key0);
          if (nr) root = nr; else break;
        }
      }
    } else if (page > 1) {
      note = note ? note + '，页面停留在末页' : '页面停留在末页';
    }
    return result(limitHit ? '已采集指定 ' + maxPages + ' 页' : '');
  }

  ns.pagination = {
    adapters: PAGER_ADAPTERS,
    detectPager: detectPager,
    manualPager: manualPager,
    collectPaged: collectPaged,
    isPagingClick: isPagingClick
  };
})();
