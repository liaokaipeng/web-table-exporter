/**
 * E2E 注入测试 harness（mui-fixture.html，无扩展环境）
 * 用法：在 /test/mui-fixture.html 页面控制台执行：
 *   const c = await (await fetch('/test/e2e-harness-mui.js')).text();
 *   window.__TEST_RESULT = await (0, eval)(c);
 * 覆盖：MUI X DataGrid（div 网格表格，行节点复用 + aria-rowindex 重排、pinned 列为
 * 同行 sticky cell 无独立分区）识别与整体高亮、自动滚动采集 300 行（DOM 序倒置注入，
 * 导出正确性依赖按 aria-rowindex 排序）、合法重复行保留、控件实时值（input JS 属性
 * 设值 / select）、采集后面板快照取样、无固定列 150 行、普通表回归。
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

  /* ---- fixture 特有探针：waitSelected 诊断日志（两个网格的 virtualScroller 滚动位置/行数） ---- */
  const probe = (h) => {
    const g1 = document.querySelector('#grid1 .MuiDataGrid-virtualScroller');
    const g2 = document.querySelector('#grid2 .MuiDataGrid-virtualScroller');
    return ' [g1 st=' + (g1 && g1.scrollTop) + ' rows=' + document.querySelectorAll('#grid1 .MuiDataGrid-row').length + ']' +
      ' [g2 st=' + (g2 && g2.scrollTop) + ' rows=' + document.querySelectorAll('#grid2 .MuiDataGrid-virtualScroller .MuiDataGrid-row').length + ']';
  };

  /* ================= 轮次 A：DataGrid 基本结构（pinned 首列，300 行，节点复用乱序） ================= */
  await round('MUI DataGrid 采集', async (h) => {
    // 悬浮高亮：无 table 元素也应整体识别（宽约 720）
    document.querySelector('#grid1 .MuiDataGrid-cell')
      .dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    const bw = parseFloat(h.hoverBox.style.width);
    t('悬浮网格表格：整体高亮（无 table 元素可命中）', Math.abs(bw - 720) < 12, bw + ' vs 720');
    t('页面有表格：默认引导文案', h.hint.textContent.indexOf('点击选择表格') >= 0, h.hint.textContent);

    const ok = await (async () => {
      clickCell('#grid1 .MuiDataGrid-cell');
      return waitSelected(h, 90000, probe);
    })();
    t('DataGrid 点击后自动滚动采集选中', ok, 'count=' + h.count.textContent);
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
    t('表头来自 columnHeaders', lines[0] === '序号,商品,本地展示价,一口价,发货仓', lines[0]);
    const dup = lines.filter(l => l.indexOf('MUI-0001_React Data Grid Row 1') >= 0 && l.indexOf('3150 PHP') >= 0);
    t('合法重复行保留（第 1/101/201 行）', dup.length === 3, 'dup=' + dup.length);
    // DOM 序倒置注入下，行序正确性完全依赖 aria-rowindex 排序
    t('首行序号 1（按 aria-rowindex 排序，非 DOM 序）', lines[1].split(',')[0] === '1', lines[1]);
    const l1 = lines[1].split(',');
    t('首行内容完整（pinned 序号 + 商品/价格/控件值）',
      l1[1] === 'MUI-0001_React Data Grid Row 1' && l1[2] === '3150 PHP' && l1[3] === '2249 PHP' && l1[4] === '华东仓(1)',
      lines[1]);
    t('首行：input 实时值（2249 PHP）', l1[3] === '2249 PHP', l1[3]);
    t('首行：select 控件值（华东仓(1)）', l1[4] === '华东仓(1)', l1[4]);
    const last = lines[300].split(',');
    t('末行完整（序号300 / MUI-0300 / 3449 PHP / 1899 PHP / 华南仓(2)）',
      last[0] === '300' && last[1] === 'MUI-0300_React Data Grid Row 300' && last[2] === '3449 PHP' && last[3] === '1899 PHP' && last[4] === '华南仓(2)',
      lines[300]);
    // fixture 乱序注入自检：采集还原回顶后重渲染，renderZone 首节点 aria-rowindex 应为窗口最大
    const rows1 = document.querySelectorAll('#grid1 .MuiDataGrid-virtualScrollerRenderZone > .MuiDataGrid-row');
    const a0 = rows1.length ? Number(rows1[0].getAttribute('aria-rowindex')) : -1;
    const aN = rows1.length ? Number(rows1[rows1.length - 1].getAttribute('aria-rowindex')) : -1;
    t('fixture 节点复用乱序生效（DOM 序与视觉序相反）', rows1.length > 3 && a0 > aN, '首=' + a0 + ' 末=' + aN + ' n=' + rows1.length);
    // 滚动位置还原：virtualScroller 应回顶部
    const sc1 = document.querySelector('#grid1 .MuiDataGrid-virtualScroller');
    t('采集后滚动位置还原（scroller scrollTop=0）', sc1 && sc1.scrollTop === 0, 'scrollTop=' + (sc1 && sc1.scrollTop));
  });

  /* ================= 轮次 B：无固定列（150 行） ================= */
  await round('MUI DataGrid 无固定列', async (h) => {
    document.querySelector('#grid2 .MuiDataGrid-cell')
      .dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    const bw = parseFloat(h.hoverBox.style.width);
    t('悬浮无固定列表格：整体高亮', Math.abs(bw - 560) < 12, bw + ' vs 560');

    const ok = await (async () => {
      clickCell('#grid2 .MuiDataGrid-cell');
      return waitSelected(h, 90000, probe);
    })();
    t('无固定列表格点击一次整体选中（自动采集）', ok, 'count=' + h.count.textContent);
    t('无固定列采集完成提示（toast 151 行）', toastText(h).indexOf('采集完成，共 151 行') >= 0, toastText(h));

    h.fmtSel.value = 'csv'; fire(h.fmtSel, 'change');
    click(h.exportBtn);
    const files = await waitExports(1, 20000);
    const lines = await csvLines(files[0]);
    t('无固定列表导出 151 行（150 数据 + 表头）', lines.length === 151, 'rows=' + lines.length);
    t('无固定列表头（列序即渲染序）', lines[0] === '序号,商品,本地展示价,一口价', lines[0]);
    t('无固定列首行', lines[1] === '1,MUIX-001_No Pin Row,600 PHP,400 PHP', lines[1]);
    t('无固定列末行（序号150 / 2239 PHP / 1145 PHP）',
      lines[150] === '150,MUIX-150_No Pin Row,2239 PHP,1145 PHP', lines[150]);
    // 滚动还原
    const sc2 = document.querySelector('#grid2 .MuiDataGrid-virtualScroller');
    t('无固定列采集后滚动还原（scroller scrollTop=0）', sc2 && sc2.scrollTop === 0, 'scrollTop=' + (sc2 && sc2.scrollTop));
  });

  /* ================= 轮次 C：普通表格回归 ================= */
  await normalTableRound('普通表回归');

  return summarize(R);
})();
