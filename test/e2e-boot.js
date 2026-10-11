/*
 * e2e-boot.js — fixture 页「#e2e=1 自动回归」引导脚本（9 个 fixture 页共享，取代原页内 bootstrap）。
 *
 * 用法（页面尾部两行，其余内容不动）：
 *   <script>window.__E2E_HARNESS = 'e2e-harness.js';</script>
 *   <script src="/test/e2e-boot.js"></script>
 * 各页 harness 文件名：fixture=e2e-harness.js、virtual=e2e-harness-virtual.js、
 * tablev2=e2e-harness-tablev2.js、antdv=e2e-harness-antdv.js、aggrid=e2e-harness-aggrid.js、
 * mui=e2e-harness-mui.js、tabulator=e2e-harness-tabulator.js、paged-el=e2e-harness-paged-el.js、
 * paged-manual=e2e-harness-paged-manual.js（pagination-ant-fixture.html 无 bootstrap，不引入）。
 * 虚拟滚动类采集耗时 10-30 秒的页面（virtual/tablev2/aggrid/mui/tabulator）在第一行再声明：
 *   window.__E2E_WAIT_TEXT = '（虚拟滚动采集，约需 10-30 秒）';
 * 该文本追加到「E2E 运行中…」之后；不声明则为空，行为同普通页。
 *
 * 行为（与重构前页内 bootstrap 完全一致；run-all.ps1 依赖标题徽标与 id="e2e-summary" 解析结果，勿改输出）：
 *   search/hash 双路 e2e=1 探测 → load 事件 + 50ms 等待 →
 *   fetch('/test/' + harness + '?v=' + Date.now()) → (0, eval) 执行 →
 *   页底浮层渲染 PASS/FAIL 列表 → 标题打 [全部 PASS] / [FAIL n] / [ERROR] 徽标。
 */
(function () {
  // #e2e=1（或 ?e2e=1）自动回归：自动执行 E2E harness 并页内渲染结果（用法见 test/README.md）。
  // 用 hash 而非 query：静态服务器 cleanUrls 重定向会丢查询串，hash 不发服务器、重定向后保留
  if (new URLSearchParams(location.search).get('e2e') === '1' ||
      new URLSearchParams(location.hash.slice(1)).get('e2e') === '1') {
    (async () => {
      const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
      const box = document.createElement('div');
      box.style.cssText = 'position:fixed;left:0;right:0;bottom:0;max-height:45vh;overflow:auto;z-index:999999;background:#fff;border-top:2px solid #999;padding:10px 14px;font:13px/1.6 Consolas,"Microsoft YaHei",monospace;box-shadow:0 -2px 8px rgba(0,0,0,.15)';
      box.innerHTML = '<b id="e2e-summary" style="color:#666">E2E 运行中…' + (window.__E2E_WAIT_TEXT || '') + '</b><ol id="e2e-list" style="margin:6px 0 0;padding-left:22px"></ol>';
      document.body.appendChild(box);
      const summary = box.querySelector('#e2e-summary');
      const list = box.querySelector('#e2e-list');
      try {
        if (!window.__E2E_HARNESS) throw new Error('window.__E2E_HARNESS 未声明');
        await new Promise(r => window.addEventListener('load', r, { once: true }));
        await new Promise(r => setTimeout(r, 50)); // 等页面脚本（JS 属性设值）就绪
        const code = await (await fetch('/test/' + window.__E2E_HARNESS + '?v=' + Date.now())).text();
        const res = await (0, eval)(code);
        const R = res && res.results;
        if (!Array.isArray(R)) throw new Error((res && res.error) || 'harness 未返回结果');
        list.innerHTML = R.map(r =>
          '<li style="color:' + (r.pass ? '#0a7d32' : '#c62828') + ';white-space:pre-wrap;margin:2px 0">' +
          (r.pass ? 'PASS ' : 'FAIL ') + esc(r.name) + (r.pass || !r.detail ? '' : '  【' + esc(r.detail) + '】') + '</li>').join('');
        const fail = R.length - R.filter(r => r.pass).length;
        summary.textContent = fail ? R.length + ' 项中 ' + fail + ' 项 FAIL' : R.length + ' 项全部 PASS';
        summary.style.color = fail ? '#c62828' : '#0a7d32';
        document.title = (fail ? '[FAIL ' + fail + '] ' : '[全部 PASS] ') + document.title;
      } catch (e) {
        summary.textContent = 'E2E 执行异常：' + e.message;
        summary.style.color = '#c62828';
        document.title = '[ERROR] ' + document.title;
      }
    })();
  }
})();
