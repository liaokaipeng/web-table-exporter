/**
 * E2E 注入测试 harness（todo-fixture.html，无扩展环境）
 * 用法：在 /test/todo-fixture.html 页面控制台执行：
 *   const c = await (await fetch('/test/e2e-harness-todo.js')).text();
 *   window.__TEST_RESULT = await (0, eval)(c);
 * 覆盖：多客 todo 网格（.todo_grid，精确适配器 + virtual:false）识别/高亮/点选即取数/
 * 通栏摘要行导出；通用 div 网格（.gen-grid，结构重复 + 表头列对齐）兜底识别与导出；
 * 无表头列表负例不误识别；普通表回归。基建经 e2e-common.js create() 装配。
 */
(async () => {
  if (window.__HARNESS_STARTED) return { error: 'harness 已在运行（并发守卫）' };
  window.__HARNESS_STARTED = true;

  if (!window.__h2xT) (0, eval)(await (await fetch('/test/e2e-common.js?v=' + Date.now())).text());
  const T = window.__h2xT.create({});
  const FILES = T.FILES; // algo-check 模块清单一致性检查引用（清单唯一来源在 e2e-common.js）
  const { R, t, waitFor, waitExports, csvLines, fire, click, clickCell, hover, toastText,
    round, normalTableRound, summarize } = T;

  /* ================= 轮次 A：多客 todo 网格 ================= */
  await round('todo 网格', async (h) => {
    const grid = document.querySelector('#todo');
    const cell = document.querySelector('#todo .todo_grid_td');

    hover('#todo .todo_grid_td');
    const bw = parseFloat(h.hoverBox.style.width);
    t('悬浮 todo 网格：整体高亮（无 table 元素可命中）', Math.abs(bw - 760) < 12, bw + ' vs 760');
    t('hitRoot 命中 .todo_grid 组件根', window.__h2x.table.gridRootOf(cell) === grid,
      (window.__h2x.table.gridRootOf(cell) || {}).className);

    click(cell);
    const selected = await waitFor(() => h.count.textContent === '1', 2000);
    t('点选即选中（virtual:false 不触发滚动采集）', selected, 'count=' + h.count.textContent);
    t('未出现「采集完成」toast（非虚拟路径）', toastText(h).indexOf('采集完成') < 0, toastText(h));
    t('点选未滚动表格容器', grid.scrollTop === 0, 'scrollTop=' + grid.scrollTop);

    h.fmtSel.value = 'csv';
    fire(h.fmtSel, 'change');
    click(h.exportBtn);
    const files = await waitExports(1);
    const lines = await csvLines(files[0]);
    const exp = [
      '商品信息,付款/退款金额,退款原因,状态,时间',
      '退货退款 退款单号:R-001 订单号:O-001 买家:alice 菲律宾 店铺A,,,,',
      '商品 A1 x1,100 PHP,产品有缺陷,待买家退货,2026-10-01 10:00',
      '仅退款 退款单号:R-002 订单号:O-002 买家:bob 泰国 店铺B,,,,',
      '商品 B2 x2,200 PHP,产品与描述不符,退款中,2026-10-02 11:30',
      '退货退款 退款单号:R-003 订单号:O-003 买家:carol 越南 店铺C,,,,',
      '商品 C3 x1,300 PHP,包裹或产品损坏,已交付,2026-10-03 12:45'
    ];
    t('导出 7 行（1 表头 + 3 条记录 × 2 行）', lines.length === 7, 'rows=' + lines.length);
    t('表头与数据逐行一致（摘要行落首列、其余列补空）',
      JSON.stringify(lines) === JSON.stringify(exp), JSON.stringify(lines));
  });

  /* ================= 轮次 B：通用 div 网格兜底 ================= */
  await round('通用网格', async (h) => {
    const root = document.querySelector('#gen .gen-body');
    const cell = document.querySelector('#gen .gen-cell');

    hover('#gen .gen-cell');
    const bw = parseFloat(h.hoverBox.style.width);
    // 3 列 × 120px
    t('悬浮通用网格：整体高亮（结构重复 + 表头列对齐）', Math.abs(bw - 360) < 12, bw + ' vs 360');
    t('hitRoot 命中通用网格根（.gen-body）', window.__h2x.table.gridRootOf(cell) === root,
      (window.__h2x.table.gridRootOf(cell) || {}).className);

    click(cell);
    const selected = await waitFor(() => h.count.textContent === '1', 2000);
    t('通用网格点击选中', selected, 'count=' + h.count.textContent);

    h.fmtSel.value = 'csv';
    fire(h.fmtSel, 'change');
    click(h.exportBtn);
    const files = await waitExports(1);
    const lines = await csvLines(files[0]);
    t('通用网格导出 4 行（表头 + 3 行）', lines.length === 4, 'rows=' + lines.length);
    t('通用网格表头/数据列对齐', lines[0] === '姓名,部门,城市' && lines[1] === '张三,研发部,杭州' && lines[3] === '王五,财务部,北京',
      JSON.stringify(lines));
  });

  /* ================= 轮次 C：无表头列表负例 ================= */
  await round('负例列表', async (h) => {
    const name = document.querySelector('#fake .fake-name');
    hover('#fake .fake-name');
    t('无表头列表不识别为表格（悬浮框隐藏）', h.hoverBox.hidden === true, 'hidden=' + h.hoverBox.hidden);
    t('gridRootOf 返回 null（兜底探测不误报）', window.__h2x.table.gridRootOf(name) === null,
      String(window.__h2x.table.gridRootOf(name)));
  });

  /* ================= 轮次 D：普通表格回归 ================= */
  await normalTableRound('普通表回归');

  return summarize(R);
})();
