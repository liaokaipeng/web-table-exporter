/**
 * E2E 注入测试 harness（tablev2-fixture.html，无扩展环境）
 * 用法：在 /test/tablev2-fixture.html 页面控制台执行：
 *   const c = await (await fetch('/test/e2e-harness-tablev2.js')).text();
 *   window.__TEST_RESULT = await (0, eval)(c);
 * 覆盖：el-table-v2（div 网格表格）识别与整体高亮、自动滚动采集 500 行、
 * 合法重复行保留、控件实时值（input JS 属性设值 / select / el-switch）、
 * 采集后面板快照取样、固定列双网格拼接采集（列序 left→main）200 行、普通表回归。
 * 基建：chrome 桩 / 导出捕获桩 / 注入器（scrollTop patch）/ UI 定位 / 轮次执行器 /
 * waitSelected 采集等待均经 e2e-common.js 的 create() 装配，普通表回归轮次用 common
 * 的 normalTableRound；本文件只保留业务轮次与 fixture 特有探针（waitSelected 诊断日志）。
 * 提速：事件驱动 waitFor + 模块代码缓存（同 e2e-harness-virtual.js，配 run-all.ps1
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

  /* ---- fixture 特有探针：waitSelected 诊断日志（两个网格的滚动 window 位置/行数） ---- */
  const probe = (h) => {
    const g1 = document.querySelector('#grid1 .el-vl__wrapper > div');
    const g2 = document.querySelector('#grid2 .el-table-v2__main .el-vl__wrapper > div');
    return ' [g1 st=' + (g1 && g1.scrollTop) + ' rows=' + document.querySelectorAll('#grid1 .el-table-v2__row').length + ']' +
      ' [g2 st=' + (g2 && g2.scrollTop) + ' rows=' + document.querySelectorAll('#grid2 .el-table-v2__row').length + ']';
  };

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
      return waitSelected(h, 90000, probe);
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
      return waitSelected(h, 90000, probe);
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
  await normalTableRound('普通表回归');

  return summarize(R);
})();
