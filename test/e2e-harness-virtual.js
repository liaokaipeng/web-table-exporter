/**
 * E2E 注入测试 harness（virtual-fixture.html，无扩展环境）
 * 用法：在 /test/virtual-fixture.html 页面控制台执行：
 *   const c = await (await fetch('/test/e2e-harness-virtual.js')).text();
 *   window.__TEST_RESULT = await (0, eval)(c);
 * 覆盖：虚拟滚动采集 61 行、合法重复行保留、控件实时值、分体表+虚拟滚动
 * 组合采集 41 行、采集后面板快照取样与智能预填、普通表回归、
 * v2.0 停止采集（中止不退出、可重新采集）。
 * 基建：chrome 桩 / 导出捕获桩 / 注入器（scrollTop patch）/ UI 定位 / 轮次执行器 /
 * waitSelected 采集等待均经 e2e-common.js 的 create() 装配，普通表回归轮次用 common
 * 的 normalTableRound；本文件只保留业务轮次与 fixture 特有探针（waitSelected 诊断日志）。
 * 提速（v2.2）：事件驱动 waitFor 替代固定 sleep、模块代码缓存、导出轮询 25ms；
 * 配 run-all.ps1 headless 虚拟时间模式整页约 1 秒跑完（真实定时器被快进）。
 */
(async () => {
  if (window.__HARNESS_STARTED) return { error: 'harness 已在运行（并发守卫）' };
  window.__HARNESS_STARTED = true;

  /* ---- 共享基建：e2e-common.js（chrome 桩 / 导出捕获桩 / 注入器 / UI 定位 / 轮次
         执行器 / waitSelected / normalTableRound；行为统一规格见该文件头）。
         已加载则跳过；scrollTop patch：隐藏标签页 scroll 不触发，虚拟滚动类页面需要 ---- */
  if (!window.__h2xT) (0, eval)(await (await fetch('/test/e2e-common.js?v=' + Date.now())).text());
  const T = window.__h2xT.create({ patchScrollTop: true });
  const FILES = T.FILES; // algo-check 模块清单一致性检查引用（清单唯一来源在 e2e-common.js）
  const { R, t, sleep, waitFor, waitExports, csvLines, fire, click, clickCell, toastText,
    round, waitSelected, normalTableRound, summarize } = T;

  /* ---- fixture 特有探针：waitSelected 诊断日志（两个虚拟容器的滚动位置/行数） ---- */
  const probe = (h) => {
    const vc = document.getElementById('vcontainer');
    const sBodyEl = document.getElementById('sgbody');
    const vt = vc ? ' [vt st=' + vc.scrollTop + '/' + vc.scrollHeight + '/' + vc.clientHeight + ' rows=' + document.querySelectorAll('#vtbody tr:not(.virtual-spacer)').length + ']' : '';
    const sg = sBodyEl ? ' [sg st=' + sBodyEl.scrollTop + '/' + sBodyEl.scrollHeight + '/' + sBodyEl.clientHeight + ' rows=' + document.querySelectorAll('#sgtbody tr:not(.virtual-spacer)').length + ']' : '';
    return vt + sg;
  };

  /* ================= 轮次 A：虚拟滚动采集（60 行） ================= */
  await round('虚拟滚动采集', async (h) => {
    const ok = await (async () => {
      clickCell('#vt tbody td');
      return waitSelected(h, 90000, probe);
    })();
    t('虚拟表格自动滚动采集完成（点选后选中）', ok, 'count=' + h.count.textContent);
    t('采集完成提示（toast 61 行含表头）', toastText(h).indexOf('采集完成，共 61 行') >= 0, toastText(h));
    // 采集后列设置面板（快照取样 + 智能预填）
    click(h.splitBtn);
    await waitFor(() => h.sr.querySelector('.h2x-mask')); // openPanel 为 async（persist.ready 后才建面板）
    const mask = h.sr.querySelector('.h2x-mask');
    t('采集后面板可用（虚拟表用快照取样）', !!mask);
    if (mask) {
      const rowOf = (p) => [...h.sr.querySelectorAll('.h2x-col')].find(r => {
        const c = r.querySelector('.h2x-cname');
        return c && c.textContent.indexOf(p) === 0;
      });
      const rTitle = rowOf('标题/产品ID'), rPrice = rowOf('一口价');
      const spOf = (r) => r.querySelector('.h2x-ck-sp');   // v2.10.2：拆分勾选框（勾选=拆分）
      const setSp = (r, on) => { const ck = spOf(r); if (ck.checked !== on) { ck.checked = on; fire(ck, 'change'); } };
      const modeOf = (r) => h.sr.querySelector('.h2x-sub[data-c="' + r.dataset.c + '"] .h2x-mode'); // 模式在展开子行内
      t('虚拟表面板预填：多行列默认不拆分（v2.1 默认不拆分）', !!rTitle && !spOf(rTitle).checked);
      t('虚拟表面板预填：控件列默认不拆分', !!rPrice && !spOf(rPrice).checked);
      setSp(rTitle, true); // v2.1 默认不拆分：手动勾选验证预设
      t('虚拟表面板预填：多行列展开后预设「按换行拆分」', modeOf(rTitle).value === 'block', modeOf(rTitle) && modeOf(rTitle).value);
      setSp(rPrice, true); // 勾选验证预设（面板稍后整体取消，不保存）
      t('虚拟表面板预填：控件列展开后预设「控件值拆分」', modeOf(rPrice).value === 'control', modeOf(rPrice) && modeOf(rPrice).value);
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
    const ok = await waitSelected(h, 90000, probe);
    t('分体虚拟表点击一次整体选中（自动采集）', ok, 'count=' + h.count.textContent);
    t('分体虚拟采集完成提示（toast 41 行）', toastText(h).indexOf('采集完成，共 41 行') >= 0, toastText(h));
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
  await normalTableRound('普通表回归');

  /* ================= 轮次 D：停止采集（v2.0：采集可中止，不退出选择模式） ================= */
  await round('停止采集', async (h) => {
    const vc = document.getElementById('vcontainer');
    clickCell('#vt tbody td'); // 发起采集
    await sleep(300);          // 进入采集中（首屏 settle 已过）
    t('采集中：取消按钮文案变「停止采集」', h.cancelBtn.textContent === '停止采集', h.cancelBtn.textContent);
    t('采集中：hint 显示采集进行时文案', h.hint.textContent.indexOf('虚拟表格采集滚动中') >= 0, h.hint.textContent);
    t('采集中：导出/列设置按钮禁用', h.exportBtn.disabled === true && h.splitBtn.disabled === true,
      'export=' + h.exportBtn.disabled + ' split=' + h.splitBtn.disabled);
    click(h.cancelBtn); // 停止采集（只作废当前任务，不退出）
    await sleep(600);   // 等 collectVirtual 取消检查点返回 + finally 恢复
    t('停止后：toast 提示「已停止采集」', toastText(h).indexOf('已停止采集') >= 0, toastText(h));
    t('停止后：表格未选中（计数 0）', h.count.textContent === '0', 'count=' + h.count.textContent);
    t('停止后：UI 保留（不退出选择模式）', document.documentElement.contains(h.host));
    t('停止后：按钮文案恢复「取消 (Esc)」', h.cancelBtn.textContent === '取消 (Esc)', h.cancelBtn.textContent);
    t('停止后：hint 恢复默认引导', h.hint.textContent.indexOf('点击选择表格') >= 0, h.hint.textContent);
    t('停止后：滚动位置还原（scrollTop=0）', vc.scrollTop === 0, 'scrollTop=' + vc.scrollTop);
    const ok = await (async () => { // 同一表可重新发起采集
      clickCell('#vt tbody td');
      return waitSelected(h, 90000, probe);
    })();
    t('停止后重新采集成功（61 行 toast）', ok && toastText(h).indexOf('采集完成，共 61 行') >= 0,
      'count=' + h.count.textContent + ' toast=' + toastText(h));
  });

  return summarize(R);
})();
