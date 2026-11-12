/**
 * E2E 注入测试 harness（header-anchored-fixture.html，无扩展环境）
 * 用法：在 /test/header-anchored-fixture.html 页面控制台执行：
 *   const c = await (await fetch('/test/e2e-harness-header-anchored.js')).text();
 *   window.__TEST_RESULT = await (0, eval)(c);
 * 覆盖：v2.18 表头锚定识别（纯表头 table + 异构 class 的 div 行组）——悬浮/点选命中同一根、
 * 表头表映射到网格根、virtual:false 点选即取数、隐藏 0 宽列不导出、CSV 逐行断言；
 * v2.18 TUX 分页适配器（.core-pagination + aria-label）——自动翻页采全量、进度带总页数、
 * 采完回第一页；负例（纯表头表 + 不对齐卡片列表）不识别；普通表回归。基建经
 * e2e-common.js create() 装配。
 */
(async () => {
  if (window.__HARNESS_STARTED) return { error: 'harness 已在运行（并发守卫）' };
  window.__HARNESS_STARTED = true;

  if (!window.__h2xT) (0, eval)(await (await fetch('/test/e2e-common.js?v=' + Date.now())).text());
  const T = window.__h2xT.create({
    uiExtra: {
      pageBtn: '.h2x-pagebtn', pageMenu: '.h2x-pagemenu',
      pagesInput: '.h2x-pages', sleepInput: '.h2x-sleep', pageGo: '.h2x-pagego'
    }
  });
  const FILES = T.FILES; // algo-check 模块清单一致性检查引用（清单唯一来源在 e2e-common.js）
  const { R, t, waitFor, waitExports, csvLines, fire, click, clickCell, hover, toastText,
    round, normalTableRound, startCollect, waitCollect, summarize } = T;

  const EXP_A = [
    '评分和评价,你的回复,商品和订单 ID,用户名,操作',
    '★★★★ 2026-11-12,0条回复,订单 ID:A-1 商品:甲,@alice,回复 评价详情',
    '★★★ 2026-11-12,0条回复,订单 ID:A-2 商品:乙,@bob,回复 评价详情',
    '★★★★★ 2026-11-12,0条回复,订单 ID:A-3 商品:丙,@dave,回复 评价详情'
  ];

  /* ================= 轮次 A：表头锚定识别与导出（第 1 页） ================= */
  await round('表头锚定网格', async (h) => {
    const root = document.querySelector('#rows'); // 根 = 行组父级（分页器留在根之外）
    const cell = document.querySelector('#rating .rating-review');
    const headTable = document.querySelector('#rating table');

    hover('#rating .rating-review');
    const bw = parseFloat(h.hoverBox.style.width);
    t('悬浮数据格：高亮覆盖锚定根（行组宽度与表头一致）', Math.abs(bw - 1020) < 12, bw + ' vs 1020');
    t('gridRootOf(数据格) 命中锚定根（每行 class 各异也识别）',
      window.__h2x.table.gridRootOf(cell) === root,
      (window.__h2x.table.gridRootOf(cell) || {}).className);
    t('gridRootOfHeaderTable(表头表) 命中同一根（hitRoot 表头映射）',
      window.__h2x.table.gridRootOfHeaderTable(headTable) === root, 'header table → grid root');

    hover('#rating th');
    t('悬浮表头命中同一张表（不会被当成「只有表头的表」）',
      Math.abs(parseFloat(h.hoverBox.style.width) - 1020) < 12, h.hoverBox.style.width);

    click(cell);
    const selected = await waitFor(() => h.count.textContent === '1', 2000);
    t('点选即选中（virtual:false 不触发滚动采集）', selected, 'count=' + h.count.textContent);
    t('未出现「采集完成」toast（非虚拟路径）', toastText(h).indexOf('采集完成') < 0, toastText(h));

    h.fmtSel.value = 'csv';
    fire(h.fmtSel, 'change');
    click(h.exportBtn);
    const files = await waitExports(1);
    const lines = await csvLines(files[0]);
    t('导出 4 行（1 表头 + 3 数据行），第 6 个 0 宽隐藏列不导出',
      lines.length === 4 && lines.every(x => x.split(',').length === 5), JSON.stringify(lines));
    t('表头/数据逐行一致（异构 class 列按视觉列序取值）',
      JSON.stringify(lines) === JSON.stringify(EXP_A), JSON.stringify(lines));
  });

  /* ================= 轮次 B：TUX 分页器自动翻页采集 ================= */
  await round('TUX 分页采集', async (h) => {
    const root = document.querySelector('#rows');
    const pager = window.__h2x.pagination.detectPager(root);
    t('detectPager 识别 core-pagination 适配器',
      !!pager && pager.name === 'core-pagination', pager ? pager.name : 'null');
    t('适配器定位到「下一个」按钮（类名 -next，非「前进 5 页」-jumper）',
      !!pager && !!pager.next(root), 'next=' + (pager && pager.next(root) ? 'ok' : 'null'));
    t('总页数读自页码项最大值（2）', !!pager && pager.total(root) === 2,
      'total=' + (pager ? pager.total(root) : 'null'));

    hover('#rating .core-pagination-item-next');
    t('分页器本身不被识别为表格（手动翻页仍可点）', h.hoverBox.hidden === true,
      'hidden=' + h.hoverBox.hidden);

    click(document.querySelector('#rating .user-name'));
    await waitFor(() => h.count.textContent === '1', 2000);
    await startCollect(h, null, 0); // 留空页数上限 = 全部页；翻页间隔 0 提速
    const hints = await waitCollect(h);
    t('采集中进度带总页数（第 i/2 页）', hints.some(x => x.indexOf('/2') >= 0), hints.join(' | '));

    h.fmtSel.value = 'csv';
    fire(h.fmtSel, 'change');
    click(h.exportBtn);
    const files = await waitExports(1);
    const lines = await csvLines(files[0]);
    t('导出 7 行（1 表头 + 2 页 × 3 行）', lines.length === 7, 'rows=' + lines.length);
    t('跨页顺序正确（第 2 页末行在末尾）',
      lines[6] === '★★★ 2026-11-12,0条回复,订单 ID:B-3 商品:己,@carol,回复 评价详情',
      lines[6]);
    const act = document.querySelector('#rating .core-pagination .core-pagination-item-active');
    t('采完自动回第一页（激活项文本=1）', !!act && act.textContent.trim() === '1',
      act ? act.textContent : 'null');
  });

  /* ================= 轮次 C：负例（表头 + 不对齐卡片列表） ================= */
  await round('负例卡片列表', async (h) => {
    const card = document.querySelector('#mis .m-title');
    hover('#mis .m-title');
    t('列数/几何不对齐时表头锚定不识别（悬浮框隐藏）', h.hoverBox.hidden === true,
      'hidden=' + h.hoverBox.hidden);
    t('gridRootOf 返回 null（不误判为表格）', window.__h2x.table.gridRootOf(card) === null,
      String(window.__h2x.table.gridRootOf(card)));
  });

  /* ================= 轮次 D：普通表格回归 ================= */
  await normalTableRound('普通表回归');

  return summarize(R);
})();
