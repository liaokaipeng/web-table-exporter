/**
 * E2E 注入测试 harness（antdv-fixture.html，无扩展环境）
 * 用法：在 /test/antdv-fixture.html 页面控制台执行：
 *   const c = await (await fetch('/test/e2e-harness-antdv.js')).text();
 *   window.__TEST_RESULT = await (0, eval)(c);
 * 覆盖：Ant Design Vue Table 三种形态——普通表格（原生 table + ant 包装类）、
 * scroll.y 分体结构（表头表 + 数据表，走既有分体配对，验证零组件特判）、
 * 固定列 + scroll.x（sticky cell 单表）、控件实时值（input/select JS 属性设值）、
 * 普通表回归。提速：事件驱动 waitFor + 模块代码缓存（同 e2e-harness-tablev2.js）。
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
  const hover = (sel) => document.querySelector(sel)
    .dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  async function waitExports(n, timeout) {
    const t0 = Date.now();
    while (window.__exports.length < n && Date.now() - t0 < (timeout || 20000)) await sleep(25);
    return window.__exports.slice();
  }
  const csvLines = async (f) => (await f.blob.text()).replace(/^\uFEFF/, '').split('\r\n').filter(x => x !== '');

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

  /* ================= 轮次 A：普通表格（原生 table + ant 包装类） ================= */
  await round('antdv 普通表', async (h) => {
    hover('#adv1 tbody tr td');
    const bw = parseFloat(h.hoverBox.style.width);
    t('悬浮普通 antdv 表（原生 table 直接命中）', Math.abs(bw - 620) < 12, bw + ' vs 620');
    t('页面有表格：默认引导文案', h.hint.textContent.indexOf('点击选择表格') >= 0, h.hint.textContent);

    clickCell('#adv1 tbody tr td');
    t('点击选中（非虚拟，直接选中）', h.count.textContent === '1', 'count=' + h.count.textContent);

    h.fmtSel.value = 'csv'; fire(h.fmtSel, 'change');
    click(h.exportBtn);
    const files = await waitExports(1);
    const lines = await csvLines(files[0]);
    t('导出 4 行（表头 + 3 数据）', lines.length === 4, 'rows=' + lines.length);
    t('表头取自 thead', lines[0] === '商品,本地展示价,一口价,发货仓', lines[0]);
    t('首行 input 实时值（2249 PHP）', lines[1] === '儿童速干T恤,4722 PHP,2249 PHP,华东仓(1)', lines[1]);
    t('次行 select 控件值（华南仓(2)）', lines[2] === '珊瑚绒睡袋,1639 PHP,1299 PHP,华南仓(2)', lines[2]);
  });

  /* ================= 轮次 B：scroll.y 分体结构（核心：既有分体配对零特判） ================= */
  await round('antdv scroll.y 分体', async (h) => {
    // 悬浮数据表：应整体高亮——命中分体包装容器（块级全宽 1000，非单表 620）
    hover('#adv2 .ant-table-body tbody tr td');
    const bw = parseFloat(h.hoverBox.style.width);
    t('悬浮数据表：整体高亮（分体配对命中）', bw > 900, bw + ' vs 1000（容器全宽）');

    // 悬浮表头表：同样整体高亮（同一包装容器）
    hover('#adv2 .ant-table-header th');
    const bw2 = parseFloat(h.hoverBox.style.width);
    t('悬浮表头表：同样整体高亮（同容器）', Math.abs(bw2 - bw) < 2, bw2 + ' vs ' + bw);

    clickCell('#adv2 .ant-table-body tbody tr td');
    t('点击数据表一次选中整表（count=1）', h.count.textContent === '1', 'count=' + h.count.textContent);

    h.fmtSel.value = 'csv'; fire(h.fmtSel, 'change');
    click(h.exportBtn);
    const files = await waitExports(1);
    const lines = await csvLines(files[0]);
    t('导出 31 行（表头 + 30 数据）', lines.length === 31, 'rows=' + lines.length);
    t('表头来自表头表 thead', lines[0] === '序号,商品,库存,状态', lines[0]);
    t('首行（1,ADV-001 Scroll Row,100,下架）', lines[1] === '1,ADV-001 Scroll Row,100,下架', lines[1]);
    t('末行（30,ADV-030 Scroll Row,129,在售）', lines[30] === '30,ADV-030 Scroll Row,129,在售', lines[30]);
  });

  /* ================= 轮次 C：固定列 + scroll.x（sticky cell 单表） ================= */
  await round('antdv 固定列', async (h) => {
    clickCell('#adv3 tbody tr td');
    t('固定列表格点击选中（单表，无需配对）', h.count.textContent === '1', 'count=' + h.count.textContent);

    h.fmtSel.value = 'csv'; fire(h.fmtSel, 'change');
    click(h.exportBtn);
    const files = await waitExports(1);
    const lines = await csvLines(files[0]);
    t('导出 4 行 × 5 列（水平滚动不影响取列）', lines.length === 4 && lines[0].split(',').length === 5,
      'rows=' + lines.length + ' cols=' + (lines[0] ? lines[0].split(',').length : 0));
    t('表头含 sticky 固定列', lines[0] === '商品,本地展示价,一口价,发货仓,操作', lines[0]);
    t('首行控件实时值', lines[1] === '儿童速干T恤,4722 PHP,2249 PHP,华东仓(1),编辑', lines[1]);
  });

  /* ================= 轮次 D：普通表格回归 ================= */
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
