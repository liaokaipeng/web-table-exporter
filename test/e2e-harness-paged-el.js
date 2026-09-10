/**
 * E2E 注入测试 harness（pagination-el-fixture.html，无扩展环境）
 * 用法：在 /test/pagination-el-fixture.html 页面控制台执行：
 *   const c = await (await fetch('/test/e2e-harness-paged-el.js')).text();
 *   window.__TEST_RESULT = await (0, eval)(c);
 * 覆盖：el-pagination 结构分页表自动识别采集（5 页 × 8 行全量 41 行）、
 * 采集进度带总页数（v2.9「第 i/N 页」，N 取末页号）、页数上限只采前 N 页、
 * 起点归一（先翻到第 3 页再采集应回第 1 页采全量、完成后回到第 1 页）、
 * 控件列实时值与导出内容。提速：事件驱动 waitFor + 模块代码缓存。
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
    return origAnchorClick.call(this); // 非导出链接走原生派发（防桩吞掉页面自身的点击行为）
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
      splitBtn: sr.querySelector('.h2x-split'),
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
  async function waitExports(n, timeout) {
    const t0 = Date.now();
    while (window.__exports.length < n && Date.now() - t0 < (timeout || 20000)) await sleep(25);
    return window.__exports.slice();
  }
  const csvLines = async (f) => (await f.blob.text()).replace(/^\uFEFF/, '').split('\r\n').filter(x => x !== '');
  const activePage = () => (document.querySelector('#pagerList li.active') || {}).textContent;

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

  /* ================= 轮次 A：全页采集 + 总页数进度（v2.9） ================= */
  await round('el 全页采集与总页数', async (h) => {
    clickCell('#pt tbody tr td');
    t('点击选中分页表格（count=1）', h.count.textContent === '1', 'count=' + h.count.textContent);
    click(h.pageBtn);
    await waitFor(() => !h.pageMenu.hidden, 1000);
    t('「采集全部页」点开设置面板（页数槽默认留空 = 全部页）',
      !h.pageMenu.hidden && h.pagesInput.value === '', 'open=' + !h.pageMenu.hidden + ' value=' + h.pagesInput.value);
    click(h.pageGo);
    // 首帧进度：起点归一不需要（已在第 1 页），进度同步写入
    t('进度显示总页数「第 1/5 页」（末页号即总数，v2.9）',
      h.hint.textContent.indexOf('第 1/5 页') >= 0, h.hint.textContent);
    t('进度附带已采行数', h.hint.textContent.indexOf('已采集 9 行') >= 0, h.hint.textContent);
    const hints = await waitCollect(h);
    t('采集过程中逐页推进（出现「第 2/5 页」）', hints.some(x => x.indexOf('第 2/5 页') >= 0), hints.join(' / '));
    t('完成后 toast 报 41 行（含表头）', toastText(h).indexOf('采集完成，共 41 行') >= 0, toastText(h));
    t('采集完成后回到第 1 页（起点归一后回到起点）', activePage() === '1', 'active=' + activePage());

    h.fmtSel.value = 'csv'; fire(h.fmtSel, 'change');
    click(h.exportBtn);
    const files = await waitExports(1);
    const lines = await csvLines(files[0]);
    t('导出 41 行（表头 + 5 页 × 8 行全量）', lines.length === 41, 'rows=' + lines.length);
    t('表头取自 thead', lines[0] === '序号,商品标题,一口价,库存,状态', lines[0]);
    t('首行含 input 实时值（1,商品 P1-1,2007,99,下架）', lines[1] === '1,商品 P1-1,2007,99,下架', lines[1]);
    t('末行跨页衔接（40,商品 P5-8,2280,92,草稿）', lines[40] === '40,商品 P5-8,2280,92,草稿', lines[40]);
  });

  /* ================= 轮次 B：起点归一 + 页数上限 ================= */
  await round('el 起点归一与页数上限', async (h) => {
    click(document.querySelectorAll('#pagerList li')[2]); // 手动翻到第 3 页（选择模式下点击放行）
    t('选择模式下页码点击放行（翻到第 3 页）', activePage() === '3', 'active=' + activePage());
    clickCell('#pt tbody tr td');
    await startCollect(h, 2);
    // 起点归一（回退到第 1 页）期间进度尚未写入，等首帧进度出现再断言
    await waitFor(() => h.hint.textContent.indexOf('第 1/5 页') >= 0, 3000);
    t('总页数始终取分页器末页号（第 1/5 页，不随页数上限变）',
      h.hint.textContent.indexOf('第 1/5 页') >= 0, h.hint.textContent);
    const hints = await waitCollect(h);
    t('起点归一：从第 1 页起采（第 2 页时已 17 行 = 第 1 页 9 + 第 2 页 8）',
      hints.some(x => x.indexOf('第 2/5 页') >= 0 && x.indexOf('已采集 17 行') >= 0), hints.join(' / '));
    t('页数上限 2 → 只采前 2 页（17 行含表头）', toastText(h).indexOf('采集完成，共 17 行') >= 0, toastText(h));
    t('提前停止原因附「已采集指定 2 页」', toastText(h).indexOf('已采集指定 2 页') >= 0, toastText(h));
    t('完成后回到第 1 页', activePage() === '1', 'active=' + activePage());

    h.fmtSel.value = 'csv'; fire(h.fmtSel, 'change');
    click(h.exportBtn);
    const files = await waitExports(1);
    const lines = await csvLines(files[0]);
    t('导出 17 行（表头 + 第 1~2 页）', lines.length === 17 && lines[16] === '16,商品 P2-8,2112,92,草稿',
      'rows=' + lines.length + ' last=' + lines[16]);
  });

  return { total: R.length, passed: R.filter(x => x.pass).length, results: R };
})();
