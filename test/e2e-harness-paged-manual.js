/**
 * E2E 注入测试 harness（pagination-manual-fixture.html，无扩展环境）
 * 用法：在 /test/pagination-manual-fixture.html 页面控制台执行：
 *   const c = await (await fetch('/test/e2e-harness-paged-manual.js')).text();
 *   window.__TEST_RESULT = await (0, eval)(c);
 * 覆盖（v2.9 手动翻页按钮记忆）：①分页器识别不到时进入「指定翻页按钮」子模式，
 * 点击「下一页」后采集并记住该按钮（'h2x.pager.v1'）；②再次采集直接复用记忆的
 * 按钮（不再要求指定、不再进子模式）；③记忆的按钮从页面消失时回落子模式兜底，
 * 且不清除记忆（页面重渲染后仍可命中）。另覆盖：自建分页器无总页数时进度只显示
 * 当前页（不显示 i/N）、子模式 Esc 取消不丢选区。
 * 基建：chrome 桩 / 导出捕获桩（带回落版：编程式翻页靠 a 链接原生 click 派发）/
 * 注入器 / UI 定位（基座 + 分页采集控件）/ 轮次执行器 / 采集等待助手均经
 * e2e-common.js 的 create() 装配，本文件只保留业务轮次与 fixture 特有助手
 * （esc / pagerMem）。
 */
(async () => {
  if (window.__HARNESS_STARTED) return { error: 'harness 已在运行（并发守卫）' };
  window.__HARNESS_STARTED = true;

  /* ---- 共享基建：e2e-common.js（chrome 桩 / 导出捕获桩 / 注入器 / UI 定位 / 轮次
         执行器 / startCollect+waitCollect；行为统一规格见该文件头）。已加载则跳过 ---- */
  if (!window.__h2xT) (0, eval)(await (await fetch('/test/e2e-common.js?v=' + Date.now())).text());
  const T = window.__h2xT.create({
    uiExtra: { // 分页采集控件追加定位（自建分页器，无总页数/无右侧提醒框）
      pageBtn: '.h2x-pagebtn',
      pageMenu: '.h2x-pagemenu',
      pagesInput: '.h2x-pages',
      sleepInput: '.h2x-sleep',
      pageGo: '.h2x-pagego'
    }
  });
  const FILES = T.FILES; // algo-check 模块清单一致性检查引用（清单唯一来源在 e2e-common.js）
  const { R, t, sleep, waitFor, waitExports, csvLines, fire, click, clickCell, toastText,
    round, startCollect, waitCollect, summarize } = T;
  const { memStore } = T; // chrome.storage local 内存桩（翻页按钮记忆 h2x.pager.v1 断言）

  /* ---- fixture 特有助手 ---- */
  const esc = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  const pagerMem = () => memStore['h2x.pager.v1'] || {};
  const pagerMemCount = () => Object.keys(pagerMem()).length;

  /* ================= 轮次 A：指定翻页按钮并记住（v2.9） ================= */
  await round('指定翻页按钮并记住', async (h) => {
    t('初始无翻页按钮记忆', pagerMemCount() === 0, JSON.stringify(pagerMem()));
    clickCell('#ptbody tr td');
    t('点击选中自建分页表格（count=1）', h.count.textContent === '1', 'count=' + h.count.textContent);
    await startCollect(h, 2, 0); // 间隔置 0：本轮测按钮记忆，不为停顿增加耗时
    t('识别不到分页器 → 进入「指定翻页按钮」子模式（hint 提示）',
      h.hint.textContent.indexOf('请点击「下一页」按钮') >= 0, h.hint.textContent);
    click(document.querySelector('#nextBtn')); // 子模式拦截本次点击并记为翻页按钮
    t('指定后立即采集：进度只显示当前页（自建分页器无总页数，不显示 i/N）',
      h.hint.textContent.indexOf('第 1 页') >= 0 && h.hint.textContent.indexOf('/') < 0, h.hint.textContent);
    const hints = await waitCollect(h);
    t('采集过程逐页推进（出现「第 2 页」）', hints.some(x => x.indexOf('第 2 页') >= 0), hints.join(' / '));
    t('完成后 toast 报 11 行（表头 + 第 1~2 页 × 5 行）',
      toastText(h).indexOf('采集完成，共 11 行') >= 0, toastText(h));
    await waitFor(() => pagerMemCount() === 1, 2000);
    const loc = Object.values(pagerMem())[0] && Object.values(pagerMem())[0].loc;
    t('已记住指定的翻页按钮（定位器取非状态类 + 文本兜底）',
      pagerMemCount() === 1 && loc && loc.sel === 'a.pg-next' && loc.tag === 'a',
      JSON.stringify(pagerMem()));

    h.fmtSel.value = 'csv'; fire(h.fmtSel, 'change');
    click(h.exportBtn);
    const files = await waitExports(1);
    const lines = await csvLines(files[0]);
    t('导出 11 行（表头 + 第 1~2 页）', lines.length === 11 && lines[1] === '1,SKU-1,自建分页商品 1,3',
      'rows=' + lines.length + ' first=' + lines[1]);
  });

  /* ================= 轮次 B：复用记忆的翻页按钮（不再要求指定） ================= */
  await round('复用记忆的翻页按钮', async (h) => {
    clickCell('#ptbody tr td');
    await startCollect(h, 2, 0); // 间隔置 0：本轮测记忆复用，不为停顿增加耗时
    t('不再进入「指定翻页按钮」子模式（直接开始采集）',
      h.hint.textContent.indexOf('请点击「下一页」按钮') < 0 && h.hint.textContent.indexOf('翻页中') >= 0,
      h.hint.textContent);
    t('toast 告知已复用上次指定的翻页按钮',
      toastText(h).indexOf('已复用上次指定的翻页按钮') >= 0, toastText(h));
    await waitCollect(h);
    t('复用后采集照常完成（11 行：表头 + 当前页起 2 页）',
      toastText(h).indexOf('采集完成，共 11 行') >= 0, toastText(h));
    t('生效的翻页按钮记忆保留（未清除）', pagerMemCount() === 1, JSON.stringify(pagerMem()));
  });

  /* ================= 轮次 C：按钮消失 → 回落子模式且不清记忆 ================= */
  await round('记忆按钮失联回落', async (h) => {
    document.querySelector('#nextBtn').remove(); // 页面重渲染后按钮暂时不在（记忆无法解析）
    clickCell('#ptbody tr td');
    await startCollect(h);
    t('记忆的按钮无法解析 → 回落「指定翻页按钮」子模式',
      h.hint.textContent.indexOf('请点击「下一页」按钮') >= 0, h.hint.textContent);
    t('未复用 toast（未误用失效按钮）', toastText(h).indexOf('已复用') < 0, toastText(h));
    esc();
    t('Esc 取消子模式：不丢选区（count 仍为 1）', h.count.textContent === '1', 'count=' + h.count.textContent);
    t('记忆保留（按钮重新渲染后仍可命中）', pagerMemCount() === 1, JSON.stringify(pagerMem()));
  });

  return summarize(R);
})();
