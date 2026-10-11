/**
 * E2E 注入测试 harness（tabulator-fixture.html，无扩展环境）
 * 用法：在 /test/tabulator-fixture.html 页面控制台执行：
 *   const c = await (await fetch('/test/e2e-harness-tabulator.js')).text();
 *   window.__TEST_RESULT = await (0, eval)(c);
 * 覆盖：Tabulator（div 网格表格，vdom 整窗重建、追加序即视觉序、冻结列同行 cell）
 * 识别与整体高亮、自动滚动采集 300 行、合法重复行保留、控件实时值（input JS 属性
 * 设值 / select）、采集后面板快照取样、无冻结列 150 行、普通表回归。
 * 基建：chrome 桩 / 导出捕获桩 / 注入器（scrollTop patch）/ UI 定位 / 轮次执行器 /
 * waitSelected 采集等待均经 e2e-common.js 的 create() 装配，普通表回归轮次用 common
 * 的 normalTableRound；本文件只保留业务轮次与 fixture 特有探针（waitSelected 诊断日志）。
 * 提速：事件驱动 waitFor + 模块代码缓存（同 e2e-harness-tablev2.js，配 run-all.ps1
 * headless 虚拟时间模式整页约 1 秒跑完）。
 */
(async () => {
  if (window.__HARNESS_STARTED) return { error: 'harness 已在运行（并发守卫）' };
  window.__HARNESS_STARTED = true;

  /* ---- 共享基建：e2e-common.js（chrome 桩 / 导出捕获桩 / 注入器 / UI 定位 / 轮次
         执行器 / waitSelected / normalTableRound；行为统一规格见该文件头）。
         已加载则跳过；scrollTop patch：隐藏标签页 scroll 不触发，网格滚动类页面需要 ---- */
  if (!window.__h2xT) (0, eval)(await (await fetch('/test/e2e-common.js?v=' + Date.now())).text());
  const T = window.__h2xT.create({ patchScrollTop: true });
  const FILES = T.FILES; // algo-check 模块清单一致性检查引用（清单唯一来源在 e2e-common.js）
  const { R, t, waitFor, waitExports, csvLines, fire, click, clickCell, toastText,
    round, waitSelected, normalTableRound, summarize } = T;

  /* ---- fixture 特有探针：waitSelected 诊断日志（两个网格的 tableHolder 滚动位置/行数） ---- */
  const probe = (h) => {
    const g1 = document.querySelector('#grid1 .tabulator-tableHolder');
    const g2 = document.querySelector('#grid2 .tabulator-tableHolder');
    return ' [g1 st=' + (g1 && g1.scrollTop) + ' rows=' + document.querySelectorAll('#grid1 .tabulator-row').length + ']' +
      ' [g2 st=' + (g2 && g2.scrollTop) + ' rows=' + document.querySelectorAll('#grid2 .tabulator-row').length + ']';
  };

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
      return waitSelected(h, 90000, probe);
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
      return waitSelected(h, 90000, probe);
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
  await normalTableRound('普通表回归');

  return summarize(R);
})();
