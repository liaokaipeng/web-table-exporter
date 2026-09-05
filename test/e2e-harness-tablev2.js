/**
 * E2E 注入测试 harness（tablev2-fixture.html，无扩展环境）
 * 用法：在 /test/tablev2-fixture.html 页面控制台执行：
 *   const c = await (await fetch('/test/e2e-harness-tablev2.js')).text();
 *   window.__TEST_RESULT = await (0, eval)(c);
 * 覆盖：el-table-v2（div 网格表格）识别与整体高亮、自动滚动采集 500 行、
 * 合法重复行保留、控件实时值（input JS 属性设值 / select / el-switch）、
 * 采集后面板快照取样、固定列双网格拼接采集（列序 left→main）200 行、普通表回归。
 * 提速：事件驱动 waitFor + 模块代码缓存（同 e2e-harness-virtual.js，配 run-all.ps1
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

  /* ---- 全局桩（同 e2e-harness-virtual.js） ---- */
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

  const FILES = ['entry', 'util', 'controls', 'split', 'cell', 'table', 'virtual', 'pagination', 'persist', 'format', 'panel', 'main'];
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
      exportBtn: sr.querySelector('.h2x-actions > .h2x-primary'),
      splitBtn: sr.querySelector('.h2x-split'),
      cancelBtn: sr.querySelector('.h2x-actions > .h2x-ghost'),
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
        const g1 = document.querySelector('#grid1 .el-vl__wrapper > div');
        const g2 = document.querySelector('#grid2 .el-table-v2__main .el-vl__wrapper > div');
        log('waitSelected#' + polls + ' count=' + h.count.textContent + ' hint=' + h.hint.textContent +
          ' [g1 st=' + (g1 && g1.scrollTop) + ' rows=' + document.querySelectorAll('#grid1 .el-table-v2__row').length + ']' +
          ' [g2 st=' + (g2 && g2.scrollTop) + ' rows=' + document.querySelectorAll('#grid2 .el-table-v2__row').length + ']');
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

  /* ================= 轮次 A：el-table-v2 基本结构（500 行） ================= */
  await round('el-table-v2 采集', async (h) => {
    // 悬浮高亮：无 table 元素也应整体识别（宽约 720）
    document.querySelector('#grid1 .el-table-v2__row-cell')
      .dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    const bw = parseFloat(h.hoverBox.style.width);
    t('悬浮网格表格：整体高亮（无 table 元素可命中）', Math.abs(bw - 720) < 12, bw + ' vs 720');
    t('页面有表格：默认引导文案', h.hint.textContent.indexOf('点击选择表格') >= 0, h.hint.textContent);

    const ok = await (async () => {
      clickCell('#grid1 .el-table-v2__row-cell');
      return waitSelected(h, 90000);
    })();
    t('el-table-v2 点击后自动滚动采集选中', ok, 'count=' + h.count.textContent);
    t('采集完成提示（toast 501 行含表头）', toastText(h).indexOf('采集完成，共 501 行') >= 0, toastText(h));

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
    t('导出 501 行（500 数据 + 表头）', lines.length === 501, 'rows=' + lines.length);
    t('表头来自 dynamic-header-row', lines[0] === '序号,标题/产品ID,本地展示价,一口价,发货仓,上架开关', lines[0]);
    const dup = lines.filter(l => l.indexOf('EPV2-0001_Virtualized Row 1') >= 0 && l.indexOf('2886300011000000000') >= 0);
    t('合法重复行保留（第 1/101/201 行）', dup.length === 3, 'dup=' + dup.length);
    const l1 = lines[1].split(',');
    t('首行：多行块归一（标题+产品ID 同格）', l1[1] === 'EPV2-0001_Virtualized Row 1 2886300011000000000', l1[1]);
    t('首行：input 实时值（2249 PHP）', l1[3] === '2249 PHP', l1[3]);
    t('首行：select 控件值（华东仓(1)）', l1[4] === '华东仓(1)', l1[4]);
    t('首行：开关列（序号1：否）', l1[5] === '否', l1[5]);
    const l5 = lines[5].split(',');
    t('序号5：开关列（是）', l5[5] === '是', l5[5]);
    const last = lines[500].split(',');
    t('末行完整（序号500）', last[0] === '500' && last[1].indexOf('EPV2-0500_Virtualized Row 500') === 0 && last[3] === '1899 PHP',
      lines[500]);
    // 滚动位置还原：网格滚动 window 应回顶部
    const w1 = document.querySelector('#grid1 .el-vl__wrapper > div');
    t('采集后滚动位置还原（window scrollTop=0）', w1 && w1.scrollTop === 0, 'scrollTop=' + (w1 && w1.scrollTop));
  });

  /* ================= 轮次 B：固定列双网格拼接（left + main，200 行） ================= */
  await round('el-table-v2 固定列', async (h) => {
    document.querySelector('#grid2 .el-table-v2__left .el-table-v2__row-cell')
      .dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    const bw = parseFloat(h.hoverBox.style.width);
    t('悬浮固定列表格：整体高亮（含 left/main 双网格）', Math.abs(bw - 560) < 12, bw + ' vs 560');

    const ok = await (async () => {
      clickCell('#grid2 .el-table-v2__left .el-table-v2__row-cell');
      return waitSelected(h, 90000);
    })();
    t('固定列表格点击一次整体选中（自动采集）', ok, 'count=' + h.count.textContent);
    t('固定列采集完成提示（toast 201 行）', toastText(h).indexOf('采集完成，共 201 行') >= 0, toastText(h));

    h.fmtSel.value = 'csv'; fire(h.fmtSel, 'change');
    click(h.exportBtn);
    const files = await waitExports(1, 20000);
    const lines = await csvLines(files[0]);
    t('固定列表导出 201 行（200 数据 + 表头）', lines.length === 201, 'rows=' + lines.length);
    t('固定列表头按视觉列序拼接（left 列在前）', lines[0] === '序号,商品,本地展示价,一口价', lines[0]);
    t('固定列首行拼接（left 序号 + main 三列）', lines[1] === '1,FIX-001_Fixed Col Row,800 PHP,500 PHP', lines[1]);
    t('固定列末行（序号200 / 1893 PHP）',
      lines[200].indexOf('FIX-200_Fixed Col Row') >= 0 && lines[200].indexOf('3387 PHP') >= 0 && lines[200].indexOf('1893 PHP') >= 0,
      lines[200]);
    // 双滚动 window 均还原
    const mw = document.querySelector('#grid2 .el-table-v2__main .el-vl__wrapper > div');
    const lw = document.querySelector('#grid2 .el-table-v2__left .el-vl__wrapper > div');
    t('固定列采集后双滚动 window 还原', mw && lw && mw.scrollTop === 0 && lw.scrollTop === 0,
      'main=' + (mw && mw.scrollTop) + ' left=' + (lw && lw.scrollTop));
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
