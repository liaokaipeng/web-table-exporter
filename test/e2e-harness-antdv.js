/**
 * E2E 注入测试 harness（antdv-fixture.html，无扩展环境）
 * 用法：在 /test/antdv-fixture.html 页面控制台执行：
 *   const c = await (await fetch('/test/e2e-harness-antdv.js')).text();
 *   window.__TEST_RESULT = await (0, eval)(c);
 * 覆盖：Ant Design Vue Table 三种形态——普通表格（原生 table + ant 包装类）、
 * scroll.y 分体结构（表头表 + 数据表，走既有分体配对，验证零组件特判）、
 * 固定列 + scroll.x（sticky cell 单表）、控件实时值（input/select JS 属性设值）、
 * 普通表回归。
 * 基建：chrome 桩 / 导出捕获桩 / 注入器（scrollTop patch）/ UI 定位 / 轮次执行器
 * 均经 e2e-common.js 的 create() 装配（hover 助手由 boot 提供），普通表回归轮次用
 * common 的 normalTableRound；本文件只保留业务轮次。
 * 提速：事件驱动 waitFor + 模块代码缓存（同 e2e-harness-tablev2.js）。
 */
(async () => {
  if (window.__HARNESS_STARTED) return { error: 'harness 已在运行（并发守卫）' };
  window.__HARNESS_STARTED = true;

  /* ---- 共享基建：e2e-common.js（chrome 桩 / 导出捕获桩 / 注入器 / UI 定位 / 轮次
         执行器 / normalTableRound；行为统一规格见该文件头）。已加载则跳过；
         scrollTop patch：隐藏标签页 scroll 不触发，antdv 滚动类页面需要 ---- */
  if (!window.__h2xT) (0, eval)(await (await fetch('/test/e2e-common.js?v=' + Date.now())).text());
  const T = window.__h2xT.create({ patchScrollTop: true });
  const FILES = T.FILES; // algo-check 模块清单一致性检查引用（清单唯一来源在 e2e-common.js）
  const { R, t, waitFor, waitExports, csvLines, fire, click, clickCell, hover,
    round, normalTableRound, summarize } = T;

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
  await normalTableRound('普通表回归');

  return summarize(R);
})();
