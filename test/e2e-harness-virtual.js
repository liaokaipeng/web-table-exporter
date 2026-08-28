/**
 * E2E 注入测试 harness（virtual-fixture.html，无扩展环境）
 * 用法：在 /test/virtual-fixture.html 页面控制台执行：
 *   const c = await (await fetch('/test/e2e-harness-virtual.js')).text();
 *   window.__TEST_RESULT = await (0, eval)(c);
 * 覆盖：虚拟滚动采集 61 行、合法重复行保留、控件实时值、分体表+虚拟滚动
 * 组合采集 41 行、采集后面板快照取样与智能预填、普通表回归。
 */
(async () => {
  if (window.__HARNESS_STARTED) return { error: 'harness 已在运行（并发守卫）' };
  window.__HARNESS_STARTED = true;
  window.__TEST_LOG = [];
  const log = (m) => window.__TEST_LOG.push(Date.now() % 1000000 + ' ' + m);
  const R = [];
  const t = (name, pass, detail) => R.push({ name, pass: !!pass, detail: detail == null ? '' : String(detail) });
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  /* ---- 全局桩 ---- */
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
  async function inject() {
    // 防御性清理：若上一轮 UI/命名空间残留，先退出再注入（避免 entry 守卫误触发退出语义）
    if (window.__html2xlsx) { try { window.__html2xlsx.toggle(); } catch (e) { /* 忽略 */ } }
    try { delete window.__h2x; } catch (e) { window.__h2x = undefined; }
    await sleep(60);
    // 后台/不可见标签页 rAF 不触发 → virtual.js settle 永久挂起；
    // 测试环境用定时器替代（fixture 渲染走 scroll 事件，不依赖真实绘制）
    window.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 16);
    // 隐藏标签页 scroll 事件随渲染步骤派发也不触发 → fixture 的滚动渲染失效；
    // scrollTop 赋值后同步补发 scroll 事件，模拟可见标签页行为（仅测试环境）
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
      const code = await (await fetch('/extension/content/' + f + '.js')).text();
      (0, eval)(code);
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
  async function waitExports(n, timeout) {
    const t0 = Date.now();
    while (window.__exports.length < n && Date.now() - t0 < (timeout || 20000)) await sleep(100);
    return window.__exports.slice();
  }
  const csvLines = async (f) => (await f.blob.text()).replace(/^\uFEFF/, '').split('\r\n').filter(x => x !== '');
  async function waitSelected(h, timeout) { // 等虚拟采集完成（计数变 1）
    const t0 = Date.now();
    let polls = 0;
    const vc = document.getElementById('vcontainer');
    const sBodyEl = document.getElementById('sgbody');
    while (h.count.textContent !== '1' && Date.now() - t0 < (timeout || 90000)) {
      await sleep(200);
      if (++polls % 5 === 1) {
        const vt = vc ? ' [vt st=' + vc.scrollTop + '/' + vc.scrollHeight + '/' + vc.clientHeight + ' rows=' + document.querySelectorAll('#vtbody tr:not(.virtual-spacer)').length + ']' : '';
        const sg = sBodyEl ? ' [sg st=' + sBodyEl.scrollTop + '/' + sBodyEl.scrollHeight + '/' + sBodyEl.clientHeight + ' rows=' + document.querySelectorAll('#sgtbody tr:not(.virtual-spacer)').length + ']' : '';
        log('waitSelected#' + polls + ' count=' + h.count.textContent + ' hint=' + h.hint.textContent + vt + sg);
      }
    }
    return h.count.textContent === '1';
  }

  async function round(name, fn) {
    log('=== 轮次开始: ' + name);
    window.__exports.length = 0;
    blobMap.clear();
    try {
      if (!(await inject())) throw new Error('注入失败（window.__html2xlsx 为空）');
      const h = ui();
      try { await fn(h); }
      finally { try { click(h.cancelBtn); } catch (e) { /* 已退出 */ } await sleep(250); }
      log('=== 轮次结束: ' + name);
    } catch (e) {
      t('【' + name + '】轮次执行异常', false, String((e && e.stack) || e));
      log('[' + name + '] 异常: ' + e);
    }
  }

  /* ================= 轮次 A：虚拟滚动采集（60 行） ================= */
  await round('虚拟滚动采集', async (h) => {
    const ok = await (async () => {
      clickCell('#vt tbody td');
      return waitSelected(h, 90000);
    })();
    t('虚拟表格自动滚动采集完成（点选后选中）', ok, 'count=' + h.count.textContent + ' hint=' + h.hint.textContent);
    t('采集完成提示（61 行含表头）', h.hint.textContent.indexOf('61') >= 0, h.hint.textContent);
    // 采集后列设置面板（快照取样 + 智能预填）
    click(h.splitBtn);
    await sleep(200); // openPanel 为 async（persist.ready 后才建面板）
    const mask = h.sr.querySelector('.h2x-mask');
    t('采集后面板可用（虚拟表用快照取样）', !!mask);
    if (mask) {
      const rowOf = (p) => [...h.sr.querySelectorAll('.h2x-col')].find(r => {
        const c = r.querySelector('.h2x-cname');
        return c && c.textContent.indexOf(p) === 0;
      });
      const rTitle = rowOf('标题/产品ID'), rPrice = rowOf('一口价');
      t('虚拟表面板预填：多行列默认按换行拆分', !!rTitle && rTitle.querySelector('.h2x-ck').checked === true && rTitle.querySelector('.h2x-mode').value === 'block');
      t('虚拟表面板预填：控件列预设控件值拆分', !!rPrice && rPrice.querySelector('.h2x-ck').checked === false && rPrice.querySelector('.h2x-mode').value === 'control');
      click(mask.querySelector('.h2x-pcancel')); // 关面板不保存（导出走无规则零回归）
    }
    h.fmtSel.value = 'csv'; fire(h.fmtSel, 'change');
    click(h.exportBtn);
    const files = await waitExports(1, 20000);
    const lines = await csvLines(files[0]);
    t('虚拟表导出 61 行（60 数据 + 表头，无规则零回归）', lines.length === 61, 'rows=' + lines.length);
    t('虚拟表表头（thead 无 tr 写法）', lines[0] === '序号,标题/产品ID,本地展示价,一口价,限购总量,发货仓,上架开关,状态', lines[0]);
    const dup = lines.filter(l => l.indexOf('AHNX00100_Test Product 1') >= 0 && l.indexOf('1731340859035700000') >= 0);
    t('合法重复行保留（序号 1/26/41 三行）', dup.length === 3, 'dup=' + dup.length);
    const l1 = lines[1].split(',');
    t('虚拟表控件实时值：一口价 2249 PHP', l1[3] === '2249 PHP', l1[3]);
    t('虚拟表发货仓控件值（华东仓(1)）', l1[5] === '华东仓(1)', l1[5]);
    t('虚拟表开关列（序号1：否）与状态列（关闭）', l1[6] === '否' && l1[7] === '关闭', l1[6] + '/' + l1[7]);
    const l5 = lines[5].split(',');
    t('虚拟表开关列（序号5：是）与状态列（开启）', l5[6] === '是' && l5[7] === '开启', l5[6] + '/' + l5[7]);
    // 滚动位置还原：容器应回到顶部
    t('采集后滚动位置还原（scrollTop=0）', document.getElementById('vcontainer').scrollTop === 0, 'scrollTop=' + document.getElementById('vcontainer').scrollTop);
  });

  /* ================= 轮次 B：分体表格 + 虚拟滚动（vxe 复刻，40 行） ================= */
  await round('分体表+虚拟滚动', async (h) => {
    const wrap = document.querySelector('#sgwrap');
    document.querySelector('#sgheader th').dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    const bw = parseFloat(h.hoverBox.style.width);
    t('悬浮表头：分体组整体高亮', Math.abs(bw - wrap.offsetWidth) < 12, bw + ' vs ' + wrap.offsetWidth);
    clickCell('#sgtable td');
    const ok = await waitSelected(h, 90000);
    t('分体虚拟表点击一次整体选中（自动采集）', ok, 'count=' + h.count.textContent + ' hint=' + h.hint.textContent);
    t('分体虚拟采集完成提示（41 行）', h.hint.textContent.indexOf('41') >= 0, h.hint.textContent);
    h.fmtSel.value = 'csv'; fire(h.fmtSel, 'change');
    click(h.exportBtn);
    const files = await waitExports(1, 20000);
    const lines = await csvLines(files[0]);
    t('分体虚拟表导出 41 行（40 数据 + 表头）', lines.length === 41, 'rows=' + lines.length);
    t('分体虚拟表表头来自表头表', lines[0] === '序号,商品,本地展示价,一口价', lines[0]);
    t('分体虚拟表首行实时值（500 PHP）', lines[1] === '1,SP-101_Virtual Split,800 PHP,500 PHP', lines[1]);
    t('分体虚拟表末行实时值（773 PHP）', lines[40].indexOf('SP-140_Virtual Split') >= 0 && lines[40].indexOf('773 PHP') >= 0, lines[40]);
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
