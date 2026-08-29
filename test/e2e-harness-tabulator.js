/**
 * E2E 注入测试 harness（tabulator-fixture.html，无扩展环境）
 * 用法：在 /test/tabulator-fixture.html 页面控制台执行：
 *   const c = await (await fetch('/test/e2e-harness-tabulator.js')).text();
 *   window.__TEST_RESULT = await (0, eval)(c);
 * 覆盖：Tabulator（div 网格表格，vdom 整窗重建、追加序即视觉序、冻结列同行 cell）
 * 识别与整体高亮、自动滚动采集 300 行、合法重复行保留、控件实时值（input JS 属性
 * 设值 / select）、采集后面板快照取样、无冻结列 150 行、普通表回归。
 * 提速：事件驱动 waitFor + 模块代码缓存（同 e2e-harness-tablev2.js，配 run-all.ps1
 * headless 虚拟时间模式整页约 1 秒跑完）。
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

  /* ---- 全局桩（同 e2e-harness-tablev2.js） ---- */
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
  window.__exports = [];
  const blobMap = new Map();
  URL.createObjectURL = (b) => { const u = origCreate(b); blobMap.set(u, b); return u; };
  HTMLAnchorElement.prototype.click = function () {
    const b = blobMap.get(this.href);
    if (b) window.__exports.push({ name: this.download, blob: b });
  };

  const FILES = ['entry', 'util', 'controls', 'split', 'cell', 'table', 'virtual', 'persist', 'format', 'panel', 'main'];
  const modCache = Object.create(null);
  async function inject() {
    if (window.__html2xlsx) { try { window.__html2xlsx.toggle(); } catch (e) { /* 忽略 */ } }
    [...document.documentElement.children].filter(el => el.tagName === 'DIV' && el.style.zIndex === '2147483647').forEach(el => el.remove());
    window.__html2xlsx = null;
    try { delete window.__h2x; } catch (e) { window.__h2x = undefined; }
    window.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 16);
    if (!window.__H2X_ST_PATCHED) {
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
      exportBtn: sr.querySelector('.h2x-primary'),
      splitBtn: sr.querySelector('.h2x-split'),
      cancelBtn: sr.querySelector('.h2x-ghost'),
      fmtSel: sr.querySelector('.h2x-ext'),
      count: sr.querySelector('.h2x-count b'),
      hint: sr.querySelector('.h2x-hint'),
      hoverBox: sr.querySelector('.h2x-hover')
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
  async function waitSelected(h, timeout) { // 等虚拟采集完成（计数变 1）
    const t0 = Date.now();
    let polls = 0;
    while (h.count.textContent !== '1' && Date.now() - t0 < (timeout || 90000)) {
      await sleep(100);
      if (++polls % 5 === 1) {
        const g1 = document.querySelector('#grid1 .tabulator-tableHolder');
        const g2 = document.querySelector('#grid2 .tabulator-tableHolder');
        log('waitSelected#' + polls + ' count=' + h.count.textContent + ' hint=' + h.hint.textContent +
          ' [g1 st=' + (g1 && g1.scrollTop) + ' rows=' + document.querySelectorAll('#grid1 .tabulator-row').length + ']' +
          ' [g2 st=' + (g2 && g2.scrollTop) + ' rows=' + document.querySelectorAll('#grid2 .tabulator-row').length + ']');
      }
    }
    return h.count.textContent === '1';
  }

  async function round(name, fn) {
    log('=== 轮次开始: ' + name);
    window.__exports.length = 0;
    blobMap.clear();
    try {
      if (!(await inject())) throw new Error('注入失败（window.__html2xxx 为空）');
      const h = ui();
      try { await fn(h); }
      finally { try { click(h.cancelBtn); } catch (e) { /* 已退出 */ } await waitFor(() => !document.documentElement.contains(h.host), 1500); }
      log('=== 轮次结束: ' + name);
    } catch (e) {
      t('【' + name + '】轮次执行异常', false, String((e && e.stack) || e));
      log('[' + name + '] 异常: ' + e);
    }
  }

  /* ================= 轮次 A：Tabulator 基本结构（首列冻结，300 行） ================= */
  await round('Tabulator 采集', async (h) => {
    // 悬浮高亮：无 table 元素也应整体识别（宽约 720）
    document.querySelector('#grid1 .tabulator-cell')
      .dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    const bw = parseFloat(h.hoverBox.style.width);
    t('悬浮网格表格：整体高亮（无 table 元素可命中）', Math.abs(bw - 720) < 12, bw + ' vs 720');
    t('页面有表格：默认引导文案', h.hint.textContent.indexOf('点击选择表格') >= 0, h.hint.textContent);

    const ok = await (async () => {
      clickCell('#grid1 .tabulator-cell');
      return waitSelected(h, 90000);
    })();
    t('Tabulator 点击后自动滚动采集选中', ok, 'count=' + h.count.textContent);
    t('采集完成提示（toast 301 行含表头）', toastText(h).indexOf('采集完成，共 301 行') >= 0, toastText(h));

    // 采集后列设置面板（快照取样）
    click(h.splitBtn);
    await waitFor(() => h.sr.querySelector('.h2x-mask'));
    t('采集后面板可用（网格表用快照取样）', !!h.sr.querySelector('.h2x-mask'));
    const mask = h.sr.querySelector('.h2x-mask');
    if (mask) click(mask.querySelector('.h2x-pcancel')); // 关面板不保存（零回归导出）

    h.fmtSel.value = 'csv'; fire(h.fmtSel, 'change');
    click(h.exportBtn);
    const files = await waitExports(1, 20000);
    const lines = await csvLines(files[0]);
    t('导出 301 行（300 数据 + 表头）', lines.length === 301, 'rows=' + lines.length);
    t('表头来自 tabulator-headers', lines[0] === '序号,商品,本地展示价,一口价,发货仓', lines[0]);
    const dup = lines.filter(l => l.indexOf('TAB-0001_Interactive Table Row 1') >= 0 && l.indexOf('2680 PHP') >= 0);
    t('合法重复行保留（第 1/101/201 行）', dup.length === 3, 'dup=' + dup.length);
    // 追加序即视觉序：首行应为首条数据
    t('首行序号 1（追加序即视觉序）', lines[1].split(',')[0] === '1', lines[1]);
    const l1 = lines[1].split(',');
    t('首行内容完整（冻结序号 + 商品/价格/控件值）',
      l1[1] === 'TAB-0001_Interactive Table Row 1' && l1[2] === '2680 PHP' && l1[3] === '2249 PHP' && l1[4] === '华东仓(1)',
      lines[1]);
    t('首行：input 实时值（2249 PHP）', l1[3] === '2249 PHP', l1[3]);
    t('首行：select 控件值（华东仓(1)）', l1[4] === '华东仓(1)', l1[4]);
    const last = lines[300].split(',');
    t('末行完整（序号300 / TAB-0300 / 2979 PHP / 1899 PHP / 华南仓(2)）',
      last[0] === '300' && last[1] === 'TAB-0300_Interactive Table Row 300' && last[2] === '2979 PHP' && last[3] === '1899 PHP' && last[4] === '华南仓(2)',
      lines[300]);
    // 滚动位置还原：tableHolder 应回顶部
    const th1 = document.querySelector('#grid1 .tabulator-tableHolder');
    t('采集后滚动位置还原（holder scrollTop=0）', th1 && th1.scrollTop === 0, 'scrollTop=' + (th1 && th1.scrollTop));
  });

  /* ================= 轮次 B：无冻结列（150 行） ================= */
  await round('Tabulator 无冻结列', async (h) => {
    document.querySelector('#grid2 .tabulator-cell')
      .dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    const bw = parseFloat(h.hoverBox.style.width);
    t('悬浮无冻结列表格：整体高亮', Math.abs(bw - 560) < 12, bw + ' vs 560');

    const ok = await (async () => {
      clickCell('#grid2 .tabulator-cell');
      return waitSelected(h, 90000);
    })();
    t('无冻结列表格点击一次整体选中（自动采集）', ok, 'count=' + h.count.textContent);
    t('无冻结列采集完成提示（toast 151 行）', toastText(h).indexOf('采集完成，共 151 行') >= 0, toastText(h));

    h.fmtSel.value = 'csv'; fire(h.fmtSel, 'change');
    click(h.exportBtn);
    const files = await waitExports(1, 20000);
    const lines = await csvLines(files[0]);
    t('无冻结列表导出 151 行（150 数据 + 表头）', lines.length === 151, 'rows=' + lines.length);
    t('无冻结列表头（列序即渲染序）', lines[0] === '序号,商品,本地展示价,一口价', lines[0]);
    t('无冻结列首行', lines[1] === '1,TABX-001_No Frozen Row,700 PHP,450 PHP', lines[1]);
    t('无冻结列末行（序号150 / 2041 PHP / 1344 PHP）',
      lines[150] === '150,TABX-150_No Frozen Row,2041 PHP,1344 PHP', lines[150]);
    // 滚动还原
    const th2 = document.querySelector('#grid2 .tabulator-tableHolder');
    t('无冻结列采集后滚动还原（holder scrollTop=0）', th2 && th2.scrollTop === 0, 'scrollTop=' + (th2 && th2.scrollTop));
  });

  /* ================= 轮次 C：普通表格回归 ================= */
  await round('普通表回归', async (h) => {
    clickCell('#normal td');
    h.fmtSel.value = 'csv'; fire(h.fmtSel, 'change');
    click(h.exportBtn);
    const files = await waitExports(1);
    const lines = await csvLines(files[0]);
    const exp = ['姓名,部门', '张三,研发部', '李四,市场部'];
    t('普通表格导出回归（3 行）', JSON.stringify(lines) === JSON.stringify(exp), JSON.stringify(lines));
  });

  return { total: R.length, passed: R.filter(x => x.pass).length, results: R };
})();
