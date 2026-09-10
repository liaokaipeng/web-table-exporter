/**
 * E2E 注入测试 harness（pagination-manual-fixture.html，无扩展环境）
 * 用法：在 /test/pagination-manual-fixture.html 页面控制台执行：
 *   const c = await (await fetch('/test/e2e-harness-paged-manual.js')).text();
 *   window.__TEST_RESULT = await (0, eval)(c);
 * 覆盖（v2.9 手动翻页按钮记忆）：①分页器识别不到时进入「指定翻页按钮」子模式，
 * 点击「下一页」后采集并记住该按钮（'h2x.pager.v1'）；②再次采集直接复用记忆的
 * 按钮（不再要求指定、不再进子模式）；③记忆的按钮从页面消失时回落子模式兜底，
 * 且不清除记忆（页面重渲染后仍可命中）。另覆盖：自建分页器无总页数时进度只显示
 * 当前页（不显示 i/N）、子模式 Esc 取消不丢选区。
 */
(async () => {
  if (window.__HARNESS_STARTED) return { error: 'harness 已在运行（并发守卫）' };
  window.__HARNESS_STARTED = true;
  window.__TEST_LOG = [];
  const log = (m) => window.__TEST_LOG.push(Date.now() % 1000000 + ' ' + m);
  const R = [];
  const t = (name, pass, detail) => R.push({ name, pass: !!pass, detail: detail == null ? '' : String(detail) });
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const waitFor = async (cond, timeout) => {
    const t0 = Date.now();
    while (!cond() && Date.now() - t0 < (timeout || 3000)) await sleep(20);
    return !!cond();
  };

  /* ---- 全局桩：chrome.storage（local）+ runtime（无扩展上下文） ---- */
  const memStore = {};
  window.chrome = {
    storage: { local: {
      get: async (k) => {
        const out = {};
        if (k == null) { for (const key in memStore) out[key] = memStore[key]; return out; }
        for (const key of (Array.isArray(k) ? k : [k])) if (memStore[key] != null) out[key] = memStore[key];
        return out;
      },
      set: async (obj) => { for (const key in obj) memStore[key] = obj[key]; },
      remove: async (keys) => { for (const k of (Array.isArray(keys) ? keys : [keys])) delete memStore[k]; }
    } },
    runtime: { sendMessage: () => { throw new Error('E2E: 无扩展上下文（预期走 blob 回退）'); } }
  };

  /* ---- 捕获导出 ---- */
  const origCreate = URL.createObjectURL.bind(URL);
  const origAnchorClick = HTMLAnchorElement.prototype.click;
  window.__exports = [];
  const blobMap = new Map();
  URL.createObjectURL = (b) => { const u = origCreate(b); blobMap.set(u, b); return u; };
  HTMLAnchorElement.prototype.click = function () {
    const b = blobMap.get(this.href);
    if (b) { window.__exports.push({ name: this.download, blob: b }); return; }
    // 非导出链接（如本页「下一页」为 a 链接）走原生 click 派发事件——
    // 扩展的编程式翻页正是靠它触发页面自身的监听器，桩不得吞掉
    return origAnchorClick.call(this);
  };

  const FILES = ['entry', 'i18n', 'util', 'controls', 'split', 'cell', 'table', 'virtual', 'pagination', 'persist', 'format', 'panel', 'main'];
  const modCache = Object.create(null);
  async function inject() {
    if (window.__html2xlsx) { try { window.__html2xlsx.toggle(); } catch (e) { /* 忽略 */ } }
    [...document.documentElement.children].filter(el => el.tagName === 'DIV' && el.style.zIndex === '2147483647').forEach(el => el.remove());
    window.__html2xlsx = null;
    try { delete window.__h2x; } catch (e) { window.__h2x = undefined; }
    window.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 16);
    for (const f of FILES) {
      if (!modCache[f]) {
        const r = await fetch('/extension/content/' + f + '.js');
        if (!r.ok) throw new Error(f + '.js HTTP ' + r.status);
        modCache[f] = await r.text();
      }
      (0, eval)(modCache[f]);
    }
    return !!window.__html2xlsx;
  }
  function ui() {
    const hosts = [...document.documentElement.children].filter(el => el.tagName === 'DIV' && el.style.zIndex === '2147483647');
    const host = hosts[hosts.length - 1];
    if (!host) throw new Error('未找到工具栏 host');
    const sr = host.shadowRoot;
    return {
      host: host, sr: sr,
      exportBtn: sr.querySelector('.h2x-actions > .h2x-primary'),
      cancelBtn: sr.querySelector('.h2x-actions > .h2x-ghost'),
      fmtSel: sr.querySelector('.h2x-ext'),
      count: sr.querySelector('.h2x-count b'),
      hint: sr.querySelector('.h2x-hint'),
      pageBtn: sr.querySelector('.h2x-pagebtn'),
      pageMenu: sr.querySelector('.h2x-pagemenu'),
      pagesInput: sr.querySelector('.h2x-pages'),
      pageGo: sr.querySelector('.h2x-pagego')
    };
  }
  const fire = (el, type) => el.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));
  const click = (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  const clickCell = (sel) => click(document.querySelector(sel));
  const toastText = (h) => [...h.sr.querySelectorAll('.h2x-toast')].map(x => x.textContent).join('|');
  const esc = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  async function waitExports(n, timeout) {
    const t0 = Date.now();
    while (window.__exports.length < n && Date.now() - t0 < (timeout || 20000)) await sleep(25);
    return window.__exports.slice();
  }
  const csvLines = async (f) => (await f.blob.text()).replace(/^\uFEFF/, '').split('\r\n').filter(x => x !== '');
  const pagerMem = () => memStore['h2x.pager.v1'] || {};
  const pagerMemCount = () => Object.keys(pagerMem()).length;

  /** 点开「采集全部页」下拉 →（可选）填页数上限 → 点「开始采集」 */
  async function startCollect(h, limit) {
    click(h.pageBtn);
    await waitFor(() => !h.pageMenu.hidden, 1000);
    if (limit) { h.pagesInput.value = String(limit); fire(h.pagesInput, 'input'); }
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

  async function round(name, fn) {
    log('=== 轮次开始: ' + name);
    window.__exports.length = 0;
    blobMap.clear();
    try {
      if (!(await inject())) throw new Error('注入失败（window.__html2xlsx 为空）');
      const h = ui();
      try { await fn(h); }
      finally { try { click(h.cancelBtn); } catch (e) { /* 已退出 */ } await waitFor(() => !document.documentElement.contains(h.host), 1500); }
      log('=== 轮次结束: ' + name);
    } catch (e) {
      t('【' + name + '】轮次执行异常', false, String((e && e.stack) || e));
      log('[' + name + '] 异常: ' + e);
    }
  }

  /* ================= 轮次 A：指定翻页按钮并记住（v2.9） ================= */
  await round('指定翻页按钮并记住', async (h) => {
    t('初始无翻页按钮记忆', pagerMemCount() === 0, JSON.stringify(pagerMem()));
    clickCell('#ptbody tr td');
    t('点击选中自建分页表格（count=1）', h.count.textContent === '1', 'count=' + h.count.textContent);
    await startCollect(h, 2);
    t('识别不到分页器 → 进入「指定翻页按钮」子模式（hint 提示）',
      h.hint.textContent.indexOf('请点击「下一页」按钮') >= 0, h.hint.textContent);
    click(document.querySelector('#nextBtn')); // 子模式拦截本次点击并记为翻页按钮
    t('指定后立即采集：进度只显示当前页（自建分页器无总页数，不显示 i/N）',
      h.hint.textContent.indexOf('第 1 页') >= 0 && h.hint.textContent.indexOf('/') < 0, h.hint.textContent);
    const hints = await waitCollect(h);
    t('采集过程逐页推进（出现「第 2 页」）', hints.some(x => x.indexOf('第 2 页') >= 0), hints.join(' / '));
    t('完成后 toast 报 11 行（表头 + 第 1~2 页 × 5 行）',
      toastText(h).indexOf('采集完成，共 11 行') >= 0, toastText(h));
    await waitFor(() => pagerMemCount() === 1, 2000);
    const loc = Object.values(pagerMem())[0] && Object.values(pagerMem())[0].loc;
    t('已记住指定的翻页按钮（定位器取非状态类 + 文本兜底）',
      pagerMemCount() === 1 && loc && loc.sel === 'a.pg-next' && loc.tag === 'a',
      JSON.stringify(pagerMem()));

    h.fmtSel.value = 'csv'; fire(h.fmtSel, 'change');
    click(h.exportBtn);
    const files = await waitExports(1);
    const lines = await csvLines(files[0]);
    t('导出 11 行（表头 + 第 1~2 页）', lines.length === 11 && lines[1] === '1,SKU-1,自建分页商品 1,3',
      'rows=' + lines.length + ' first=' + lines[1]);
  });

  /* ================= 轮次 B：复用记忆的翻页按钮（不再要求指定） ================= */
  await round('复用记忆的翻页按钮', async (h) => {
    clickCell('#ptbody tr td');
    await startCollect(h, 2);
    t('不再进入「指定翻页按钮」子模式（直接开始采集）',
      h.hint.textContent.indexOf('请点击「下一页」按钮') < 0 && h.hint.textContent.indexOf('翻页中') >= 0,
      h.hint.textContent);
    t('toast 告知已复用上次指定的翻页按钮',
      toastText(h).indexOf('已复用上次指定的翻页按钮') >= 0, toastText(h));
    await waitCollect(h);
    t('复用后采集照常完成（11 行：表头 + 当前页起 2 页）',
      toastText(h).indexOf('采集完成，共 11 行') >= 0, toastText(h));
    t('生效的翻页按钮记忆保留（未清除）', pagerMemCount() === 1, JSON.stringify(pagerMem()));
  });

  /* ================= 轮次 C：按钮消失 → 回落子模式且不清记忆 ================= */
  await round('记忆按钮失联回落', async (h) => {
    document.querySelector('#nextBtn').remove(); // 页面重渲染后按钮暂时不在（记忆无法解析）
    clickCell('#ptbody tr td');
    await startCollect(h);
    t('记忆的按钮无法解析 → 回落「指定翻页按钮」子模式',
      h.hint.textContent.indexOf('请点击「下一页」按钮') >= 0, h.hint.textContent);
    t('未复用 toast（未误用失效按钮）', toastText(h).indexOf('已复用') < 0, toastText(h));
    esc();
    t('Esc 取消子模式：不丢选区（count 仍为 1）', h.count.textContent === '1', 'count=' + h.count.textContent);
    t('记忆保留（按钮重新渲染后仍可命中）', pagerMemCount() === 1, JSON.stringify(pagerMem()));
  });

  return { total: R.length, passed: R.filter(x => x.pass).length, results: R };
})();
