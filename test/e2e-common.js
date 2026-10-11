/**
 * E2E 共享测试基建（9 个 harness 装配用；原生 JS 零依赖，随插件 test/ 目录分发）
 *
 * 加载协议（harness 并发守卫之后、业务轮次之前；已加载则跳过）：
 *   if (!window.__h2xT) (0, eval)(await (await fetch('/test/e2e-common.js?v=' + Date.now())).text());
 *   const T = window.__h2xT.create({ sync, patchScrollTop, logRound, lock, uiExtra });
 *
 * 粒度导出（window.__h2xT）：
 *   boot()                        log / R / t / sleep / waitFor / waitExports / csvLines /
 *                                 fire / click / clickCell / toastText / hover
 *   stubChrome({ sync })          chrome.storage 内存桩（local 必选；sync:true 追加 sync 双区，
 *                                 供主 harness「镜像 / 加载合并」断言）+ runtime.sendMessage 抛错
 *   stubExport()                  URL.createObjectURL 记录 + anchor click 捕获（带回落版）
 *   makeInjector({ patchScrollTop, logRound })
 *                                 FILES / modCache / rAF patch / 强制全新注入；scrollTop patch 开关化
 *   uiHost(extra)                 基座 9 项控件定位 + 调用方以选择器映射追加控件（分页页用）
 *   makeRound(deps, { lock })     轮次执行器；lock:true 编入轮次串行锁（主 harness 专用）
 *   waitSelected(h, timeout, probe)  虚拟/网格采集等待框架，probe 参数化各 fixture 诊断日志
 *   normalTableRound(name)        普通表回归轮次（6 个 harness 逐字重复的同一断言，含期望数组）
 *   pagedCollect()                startCollect / waitCollect（2 个分页 harness 共享）
 *   summarize(results, extra)     { total, passed, results }（主 harness 经 extra 追加 logTail）
 *   FILES                         13 个内容脚本注入清单（与 service-worker 注入序逐项一致）
 *   create(config)                把上述常用件装配成工具箱返回（harness 只用 create 即可）：
 *                                   config.sync            chrome 桩是否加 sync 双区
 *                                   config.patchScrollTop 注入器是否打 scrollTop patch
 *                                   config.logRound        inject 是否打轮次日志
 *                                   config.lock            round 是否编入轮次串行锁
 *                                   config.uiExtra         uiHost 追加的控件选择器映射
 *
 * 行为统一规格（去重整合时落定，勿再分叉）：
 *   - waitExports 默认超时 20000（原主 harness 8000，统一后失败场景等待更稳）
 *   - log 统一带时间戳前缀（原主 harness 无前缀）
 *   - 导出捕获桩统一带回落版（未命中 blob 映射的链接回落原生派发）
 *   - 注入失败文案 __html2xlsx（原 5 个网格 harness 误写 __html2xxx）
 *   - FILES 为全库唯一注入清单来源（algo-check 模块清单一致性检查以本文件为准）
 */
(function () {
  if (window.__h2xT) return; // 已加载则跳过（harness 加载守卫同款判断）

  /* ---- FILES：13 个内容脚本注入清单。与 extension/background/service-worker.js
         注入序逐项一致（entry 先行守卫 / main 殿后建 UI）；增删 content 模块须同步
         本清单与 service-worker，algo-check 模块清单一致性检查把关 ---- */
  const FILES = ['entry', 'i18n', 'util', 'controls', 'split', 'cell', 'table', 'virtual', 'pagination', 'persist', 'format', 'panel', 'main'];

  /* ---- 模块级单件：一个页面只跑一个 harness（并发守卫保证），log/R/t 等全程一份 ---- */
  window.__TEST_LOG = [];
  const log = (m) => window.__TEST_LOG.push(Date.now() % 1000000 + ' ' + m);
  const R = [];
  const t = (name, pass, detail) => R.push({ name, pass: !!pass, detail: detail == null ? '' : String(detail) });
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  // 事件驱动等待：条件满足立即返回（替代固定 sleep，提速且比盲等更强：等不到会显式超时暴露）
  const waitFor = async (cond, timeout) => {
    const t0 = Date.now();
    while (!cond() && Date.now() - t0 < (timeout || 3000)) await sleep(20);
    return !!cond();
  };
  const waitExports = async (n, timeout) => {
    const t0 = Date.now();
    while (window.__exports.length < n && Date.now() - t0 < (timeout || 20000)) await sleep(25);
    return window.__exports.slice();
  };
  const csvLines = async (f) => (await f.blob.text()).replace(/^\uFEFF/, '').split('\r\n').filter(x => x !== '');
  const fire = (el, type) => el.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));
  const click = (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  const clickCell = (sel) => click(document.querySelector(sel));
  const toastText = (h) => [...h.sr.querySelectorAll('.h2x-toast')].map(x => x.textContent).join('|');
  const hover = (sel) => document.querySelector(sel).dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));

  function boot() {
    return { log, R, t, sleep, waitFor, waitExports, csvLines, fire, click, clickCell, toastText, hover };
  }

  /* ---- stubChrome：chrome.storage 内存桩（local 必选；sync:true 时追加 sync 双区，
         local/sync 各自独立 store，供「镜像 / 加载合并」断言）与 runtime.sendMessage
         抛错（无扩展上下文，预期扩展代码走 blob 回退） ---- */
  function stubChrome(opts) {
    const memStore = {}; // local 区
    const memSync = {};  // sync 区（独立，供「镜像 / 加载合并」断言）
    const mkArea = (store) => ({
      get: async (k) => {
        const out = {};
        if (k == null) { for (const key in store) out[key] = store[key]; return out; }
        for (const key of (Array.isArray(k) ? k : [k])) if (store[key] != null) out[key] = store[key];
        return out;
      },
      set: async (obj) => { for (const key in obj) store[key] = obj[key]; },
      remove: async (keys) => { for (const k of (Array.isArray(keys) ? keys : [keys])) delete store[k]; }
    });
    const storage = { local: mkArea(memStore) };
    if (opts && opts.sync) storage.sync = mkArea(memSync);
    window.chrome = {
      storage: storage,
      runtime: { sendMessage: () => { throw new Error('E2E: 无扩展上下文（预期走 blob 回退）'); } }
    };
    return { memStore: memStore, memSync: memSync };
  }

  /* ---- stubExport：桩 URL.createObjectURL + HTMLAnchorElement.prototype.click。
         统一带回落版：未命中 blob 映射的链接回落原生派发——扩展的编程式翻页正是靠
         anchor.click() 触发页面自身的监听器（如自建分页器的 a 链接），桩不得吞掉 ---- */
  function stubExport() {
    const origCreate = URL.createObjectURL.bind(URL);
    const origAnchorClick = HTMLAnchorElement.prototype.click;
    window.__exports = [];
    const blobMap = new Map();
    URL.createObjectURL = (b) => { const u = origCreate(b); blobMap.set(u, b); return u; };
    HTMLAnchorElement.prototype.click = function () {
      const b = blobMap.get(this.href);
      if (b) { window.__exports.push({ name: this.download, blob: b }); return; }
      return origAnchorClick.call(this);
    };
    return {
      exports: window.__exports, blobMap: blobMap,
      clear: () => { window.__exports.length = 0; blobMap.clear(); }
    };
  }

  /* ---- 残留 host 定位：工具栏 host 为 documentElement 下 zIndex=2147483647 的 DIV
         （注入器强删与 ui() host 定位共用；内联表达式只此一处） ---- */
  function staleHosts() {
    return [...document.documentElement.children].filter(el => el.tagName === 'DIV' && el.style.zIndex === '2147483647');
  }

  /* ---- makeInjector：模块代码缓存 + 强制全新注入 + rAF 定时器化。
         patchScrollTop：隐藏标签页 scroll 随渲染步骤派发也不触发 → fixture 滚动渲染失效，
                         scrollTop 赋值后同步补发 scroll 事件（虚拟/网格类页面需要；仅测试环境）
         logRound：注入后打轮次日志（主 harness 调试用） ---- */
  function makeInjector(opts) {
    const modCache = Object.create(null); // 模块代码缓存：13 文件只首轮拉取，多轮免重复网络往返
    return async function inject(roundName) {
      // 强制全新注入：先尝试退出旧会话、移除残留 host、清空守卫状态
      // （exit 为同步清理，无需等待；残留兜底由 staleHosts 强删完成）
      if (window.__html2xlsx) { try { window.__html2xlsx.toggle(); } catch (e) { /* 已失效 */ } }
      staleHosts().forEach(el => el.remove());
      window.__html2xlsx = null;   // entry 守卫永不触发退出语义
      try { delete window.__h2x; } catch (e) { window.__h2x = undefined; }
      // 后台/不可见标签页 rAF 不触发 → virtual.js settle 永久挂起；
      // 测试环境用定时器替代（fixture 渲染走 scroll 事件，不依赖真实绘制）
      window.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 16);
      // 隐藏标签页 scroll 事件不触发 → fixture 的滚动渲染失效；scrollTop 赋值后同步补发
      // scroll 事件，模拟可见标签页行为（仅测试环境）
      if (opts && opts.patchScrollTop && !window.__H2X_ST_PATCHED) {
        window.__H2X_ST_PATCHED = true;
        const desc = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop');
        if (desc && desc.set && desc.configurable) {
          Object.defineProperty(Element.prototype, 'scrollTop', {
            configurable: true, enumerable: desc.enumerable,
            get: desc.get,
            set: function (v) { desc.set.call(this, v); this.dispatchEvent(new Event('scroll')); }
          });
        }
      }
      for (const f of FILES) {
        if (!modCache[f]) {
          const r = await fetch('/extension/content/' + f + '.js');
          if (!r.ok) throw new Error(f + '.js HTTP ' + r.status);
          modCache[f] = await r.text();
        }
        try { (0, eval)(modCache[f]); }
        catch (e) { if (opts && opts.logRound) log('[' + roundName + '] ' + f + '.js 求值异常: ' + e); throw e; }
      }
      const ok = !!window.__html2xlsx;
      if (opts && opts.logRound) log('[' + roundName + '] 注入结果=' + ok + ' nsKeys=' + (window.__h2x ? Object.keys(window.__h2x).join(',') : '无'));
      window.__html2xlsx = null; // 隐藏：防外部残留脚本误退出本会话（本会话经元素引用操作）
      return ok;
    };
  }

  /* ---- uiHost：工具栏 host 定位 + 基座 9 项控件；extra 为调用方追加的控件选择器
         映射（属性名 → 选择器，如 { pageBtn: '.h2x-pagebtn' }，分页页的采集菜单/
         间隔/提醒框等；经 shadowRoot 查询后合并进返回对象） ---- */
  function uiHost(extra) {
    return function ui() {
      const hosts = staleHosts();
      const host = hosts[hosts.length - 1];
      if (!host) throw new Error('未找到工具栏 host');
      const sr = host.shadowRoot;
      const h = {
        host: host, sr: sr,
        exportBtn: sr.querySelector('.h2x-actions > .h2x-primary'),
        splitBtn: sr.querySelector('.h2x-split'),
        cancelBtn: sr.querySelector('.h2x-actions > .h2x-ghost'),
        fmtSel: sr.querySelector('.h2x-ext'),
        count: sr.querySelector('.h2x-count b'),
        hint: sr.querySelector('.h2x-hint'),
        hoverBox: sr.querySelector('.h2x-hover')
      };
      if (extra) for (const key in extra) h[key] = sr.querySelector(extra[key]);
      return h;
    };
  }

  /* ---- makeRound：轮次执行器（清导出记录 → 注入 → 业务 fn → finally 退出并等 host
         移除 → 异常记 FAIL）。lock:true 时编入轮次串行锁（防并发 harness 实例互相
         干扰；30 秒陈旧锁自动抢占）并给 fn 传锁续期回调（均为主 harness 专用，
         注入失败文案亦沿用主 harness 原文） ---- */
  let currentRound = null; // makeRound 落定最新轮次执行器；normalTableRound 经它执行
  function makeRound(deps, opts) {
    const { log, t, sleep, waitFor, inject, ui, click, clearExports } = deps;
    const lock = !!(opts && opts.lock);
    const MY = 'h' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    async function acquireLock() {
      const t0 = Date.now();
      while (Date.now() - t0 < 30000) {
        const cur = window.__ROUND_LOCK;
        if (!cur || (Date.now() - cur.at) > 30000 || cur.owner === MY) {
          window.__ROUND_LOCK = { owner: MY, at: Date.now() };
          return true;
        }
        await sleep(150);
      }
      return false;
    }
    function touchLock() { const cur = window.__ROUND_LOCK; if (cur && cur.owner === MY) cur.at = Date.now(); }
    async function round(name, fn) {
      log('=== 轮次开始: ' + name);
      if (lock && !(await acquireLock())) { t('【' + name + '】轮次锁超时', false, ''); return; }
      try {
        clearExports();
        if (lock) touchLock();
        if (!(await inject(name))) throw new Error(lock ? '注入失败（main.js 未初始化）' : '注入失败（window.__html2xlsx 为空）');
        const h = ui();
        if (lock) log('[' + name + '] 工具栏已定位');
        try { await (lock ? fn(h, () => touchLock()) : fn(h)); }
        finally { try { click(h.cancelBtn); } catch (e) { /* 已退出 */ } await waitFor(() => !document.documentElement.contains(h.host), 1500); }
        log('=== 轮次结束: ' + name);
      } catch (e) {
        t('【' + name + '】轮次执行异常', false, String((e && e.stack) || e));
        log('[' + name + '] 异常: ' + e);
      } finally {
        if (lock && window.__ROUND_LOCK && window.__ROUND_LOCK.owner === MY) window.__ROUND_LOCK = null;
      }
    }
    currentRound = round;
    return round;
  }

  /* ---- waitSelected：虚拟/网格采集等待框架（等计数变 1 = 点击后自动采集选中）。
         probe(h) 由调用方提供诊断日志内容（各 fixture 的滚动容器/行数探针字符串，
         拼在 hint 之后；框架部分与重构前逐字一致） ---- */
  async function waitSelected(h, timeout, probe) {
    const t0 = Date.now();
    let polls = 0;
    while (h.count.textContent !== '1' && Date.now() - t0 < (timeout || 90000)) {
      await sleep(100);
      if (++polls % 5 === 1) {
        log('waitSelected#' + polls + ' count=' + h.count.textContent + ' hint=' + h.hint.textContent + (probe ? probe(h) : ''));
      }
    }
    return h.count.textContent === '1';
  }

  /* ---- normalTableRound：普通表回归轮次（virtual/aggrid/mui/tablev2/tabulator/antdv
         六页逐字重复的同一断言，含期望数组与 #normal 选择器；name 保留各页轮次名） ---- */
  async function normalTableRound(name) {
    await currentRound(name, async (h) => {
      clickCell('#normal td');
      h.fmtSel.value = 'csv'; fire(h.fmtSel, 'change');
      click(h.exportBtn);
      const files = await waitExports(1);
      const lines = await csvLines(files[0]);
      const exp = ['姓名,部门', '张三,研发部', '李四,市场部'];
      t('普通表格导出回归（3 行）', JSON.stringify(lines) === JSON.stringify(exp), JSON.stringify(lines));
    });
  }

  /* ---- pagedCollect：分页采集助手（两个分页 harness 逐字相同的实现） ---- */
  function pagedCollect() {
    /** 点开「采集全部页」下拉 →（可选）填页数上限 →（可选）填翻页间隔（秒）→ 点「开始采集」 */
    async function startCollect(h, limit, sleep) {
      click(h.pageBtn);
      await waitFor(() => !h.pageMenu.hidden, 1000);
      if (limit) { h.pagesInput.value = String(limit); fire(h.pagesInput, 'input'); }
      if (sleep != null) { h.sleepInput.value = String(sleep); fire(h.sleepInput, 'input'); }
      click(h.pageGo);
    }
    /** 等采集结束（完成 toast 出现），期间用 MutationObserver 记录每一次进度文案
     *  （轮询会漏掉「写入后立刻被重置」的中间帧，观察器记录每个文本节点写入） */
    async function waitCollect(h, timeout) {
      const hints = [];
      const mo = new MutationObserver((recs) => {
        for (const r of recs) {
          const v = r.type === 'childList'
            ? [...r.addedNodes].map(n => n.textContent).join('')
            : r.target.textContent;
          if (v && hints[hints.length - 1] !== v) hints.push(v);
        }
      });
      mo.observe(h.hint, { childList: true, characterData: true, subtree: true });
      const t0 = Date.now();
      while (Date.now() - t0 < (timeout || 15000)) {
        if (toastText(h).indexOf('采集完成') >= 0 || toastText(h).indexOf('采集失败') >= 0) break;
        await sleep(10);
      }
      mo.disconnect();
      return hints;
    }
    return { startCollect: startCollect, waitCollect: waitCollect };
  }

  /* ---- summarize：结果汇总；extra 供主 harness 追加 logTail ---- */
  function summarize(results, extra) {
    const out = { total: results.length, passed: results.filter(x => x.pass).length, results: results };
    return extra ? Object.assign(out, extra) : out;
  }

  /* ---- create：装配工具箱（harness 只用 create 即可，无需自行接线各粒度件） ---- */
  function create(config) {
    const cfg = config || {};
    const b = boot();
    const stubs = stubChrome({ sync: !!cfg.sync });
    const exp = stubExport();
    const inject = makeInjector({ patchScrollTop: !!cfg.patchScrollTop, logRound: !!cfg.logRound });
    const ui = uiHost(cfg.uiExtra);
    const round = makeRound({
      log: b.log, t: b.t, sleep: b.sleep, waitFor: b.waitFor,
      inject: inject, ui: ui, click: b.click, clearExports: exp.clear
    }, { lock: !!cfg.lock });
    const pc = pagedCollect();
    return {
      log: b.log, R: b.R, t: b.t, sleep: b.sleep, waitFor: b.waitFor,
      waitExports: b.waitExports, csvLines: b.csvLines,
      fire: b.fire, click: b.click, clickCell: b.clickCell, toastText: b.toastText, hover: b.hover,
      inject: inject, ui: ui, round: round,
      waitSelected: waitSelected, normalTableRound: normalTableRound,
      startCollect: pc.startCollect, waitCollect: pc.waitCollect,
      summarize: summarize, FILES: FILES,
      exports: exp.exports, memStore: stubs.memStore, memSync: stubs.memSync
    };
  }

  window.__h2xT = {
    boot: boot,
    stubChrome: stubChrome,
    stubExport: stubExport,
    makeInjector: makeInjector,
    uiHost: uiHost,
    makeRound: makeRound,
    waitSelected: waitSelected,
    normalTableRound: normalTableRound,
    pagedCollect: pagedCollect,
    summarize: summarize,
    FILES: FILES,
    create: create
  };
})();
