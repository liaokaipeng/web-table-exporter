/**
 * 虚拟滚动表格支持：识别与自动滚动采集
 * 依赖：table（getRows）、cell（openBatch 批量取值）——均在函数调用时解引用
 */
(() => {
  'use strict';
  const ns = window.__h2x;

  /** 虚拟表格识别：div 网格表格（el-table-v2，恒虚拟滚动）/ 类名含 virtual 的占位元素 /
   *  带高度的无单元格占位 tr。
   *  参数可为普通 table、分体包装容器或网格表格根。宁可误报——误报时采集流程无损
   *  （每窗口都返回全量行，重叠合并后不变） */
  function isVirtualTable(el) {
    if (ns.table.isGridTable(el)) return true; // el-table-v2：只渲染可见窗口行，恒走滚动采集
    if (el.querySelector('[class*="virtual"]')) return true;
    const group = ns.table.splitGroupOf(el);
    const tables = group ? [group.headerTable, group.bodyTable] : (el.tBodies ? [el] : []);
    for (const t of tables) {
      for (const tb of t.tBodies) {
        for (const tr of tb.rows) {
          if (!tr.cells.length && tr.getBoundingClientRect().height > 0) return true;
        }
      }
    }
    return false;
  }

  /** 向上找滚动容器；无则用窗口滚动 */
  function findScrollContainer(table) {
    let el = table.parentElement;
    while (el && el !== document.body) {
      const s = getComputedStyle(el);
      if ((s.overflowY === 'auto' || s.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 4) return el;
      el = el.parentElement;
    }
    return null;
  }

  const settle = (ms) => new Promise(res => { requestAnimationFrame(() => setTimeout(res, ms)); });

  /** 已累积行（签名数组）的后缀与当前窗口前缀的最长公共长度，即两窗口的重叠行数。
   *  k 上限为两数组长度较小值（重叠数不可能超过窗口行数）；失配通常在首字符
   *  即断，无需额外 cap（5000 行 ×3 窗口回归耗时 1ms） */
  function overlapLen(acc, win) {
    const max = Math.min(acc.length, win.length);
    for (let k = max; k >= 1; k--) {
      let ok = true;
      for (let i = 0; i < k; i++) {
        if (acc[acc.length - k + i] !== win[i]) { ok = false; break; }
      }
      if (ok) return k;
    }
    return 0;
  }

  /**
   * 自动滚动采集虚拟表格全部行：回顶 → 按视口 80% 步长逐步下滚 → 逐窗口提取。
   * 表头行剥离只保留一份；数据行用「相邻窗口重叠合并」（后缀/前缀匹配）衔接，
   * 既消除窗口重叠区的重复，也保留数据中合法的重复行。
   * 参数可为普通 table、分体包装容器（滚动容器挂在数据表上层，表头行经 getRows
   * 合并取）或 div 网格表格（el-table-v2：滚动 window 为组件内 overflow:hidden 容器，
   * 编程式 scrollTop 有效并触发组件重渲染窗口行；固定列时多分区联动设置）。
   * 返回与 extractTable 同构的四通道快照 { rows, ctrl, text, blocks, headerRows }。
   */
  async function collectVirtual(root, onProgress, isCancelled) {
    let group = ns.table.splitGroupOf(root); // 分体组解析一次逐窗复用（失效时重解析）
    const gridWins = ns.table.isGridTable(root) ? ns.table.gridScrollEls(root) : null;
    const scrollTable = group ? group.bodyTable : root; // 分体结构：从数据表向上找滚动容器
    const container = gridWins && gridWins.length ? gridWins[0] : findScrollContainer(scrollTable);
    const headers = []; // 表头行对象 { merged, ctrl, text, blocks }，首窗口确定，支持多行表头
    const data = [];    // 数据行对象（与 headers 同构，重叠合并同步维护）
    const dataSigs = []; // 数据行签名（与 data 同步增长，免每窗全量重算）
    // 行签名（merged 通道拼接，缓存于行对象），供重叠匹配
    const sigOf = (row) => row.sig || (row.sig = row.merged.join('\x01'));

    // 提取当前窗口：表头只记录一份；数据行与已累积部分做后缀/前缀重叠合并
    let prevRefs = null; // 上一窗口数据行的 DOM 元素引用（判定窗口是否真的变化）
    const takeWindow = () => {
      const firstWin = prevRefs === null; // 首窗口收集全部表头行，后续窗口跳过
      // 分体组失效（组件重建了表格结构）时重新解析；正常滚动仅替换行节点
      if (group && (!group.headerTable.isConnected || !group.bodyTable.isConnected)) {
        group = ns.table.splitGroupOf(root);
      }
      const rowsNow = ns.table.getRows(root, group); // 传入已解析组，免逐窗重复配对
      // 窗内批量两阶段取值（cell.js openBatch）：预备全部单元格再一次集中读取
      const batch = ns.cell.openBatch();
      const preparedRows = rowsNow.map(({ cells }) => Array.from(cells, (cell) => batch.prepare(cell)));
      batch.resolve();
      const win = [];      // 当前窗口数据行对象
      const winRefs = [];
      for (let r = 0; r < rowsNow.length; r++) {
        const { el, isHeader } = rowsNow[r];
        const row = { merged: [], ctrl: [], text: [], blocks: [] };
        for (const p of preparedRows[r]) {
          row.merged.push(p.merged);
          row.ctrl.push(p.ctrl);
          row.text.push(p.text);
          row.blocks.push(p.blocks);
        }
        if (isHeader) {
          if (firstWin) headers.push(row);
          continue;
        }
        win.push(row);
        winRefs.push(el);
      }
      // DOM 行元素与上一窗口完全相同（同一批节点）：
      // 非虚拟表格被误判时每窗口都是同一批行；虚拟表格渲染未完成时同理。均无新行。
      if (!firstWin && winRefs.length === prevRefs.length &&
          winRefs.every((el, i) => el === prevRefs[i])) {
        return 0;
      }
      prevRefs = winRefs;
      const k = overlapLen(dataSigs, win.map(sigOf));
      for (let i = k; i < win.length; i++) {
        data.push(win[i]);
        dataSigs.push(win[i].sig); // sig 已由 win.map 计算，直接取缓存
      }
      return win.length - k; // 新增行数
    };

    const progress = () => onProgress(data.length + headers.length);
    const getTop = () => (container ? container.scrollTop : window.scrollY);
    const setTop = (v) => {
      if (gridWins) { for (const w of gridWins) w.scrollTop = v; return; } // 网格多分区联动（固定列）
      if (container) container.scrollTop = v; else window.scrollTo(0, v);
    };
    const getMax = () => container
      ? container.scrollHeight - container.clientHeight
      : document.documentElement.scrollHeight - window.innerHeight;

    const originTop = getTop();
    try {
      setTop(0); // 回顶，保证采集从第一行开始
      await settle(180);
      takeWindow();
      progress();

      const step = Math.max(240, (container ? container.clientHeight : window.innerHeight) * 0.8);
      let lastTop = -1;
      for (let i = 0; i < 10000; i++) {
        if (isCancelled()) return null;
        if (getTop() >= getMax() - 1) break; // 已到底
        setTop(Math.min(getTop() + step, getMax()));
        await settle(180); // 等组件重渲染窗口
        let added = takeWindow();
        if (added === 0) {
          // 渲染慢的组件：补等一次再采，仍无新行才视为稳定
          await settle(250);
          added = takeWindow();
        }
        progress();
        const nowTop = getTop();
        if (nowTop === lastTop && added === 0) break; // 滚动卡住且无新行，防死循环
        lastTop = nowTop;
      }
      takeWindow(); // 收尾补一次
      progress();
      // 快照转置为四通道 + 表头行数（列拆分数据流同普通表格，与 extractTable 结果同构）
      const all = [...headers, ...data];
      const channel = (k) => all.map(row => row[k]);
      return {
        rows: channel('merged'),
        ctrl: channel('ctrl'),
        text: channel('text'),
        blocks: channel('blocks'),
        headerRows: headers.length
      };
    } finally {
      setTop(originTop); // 还原用户滚动位置
    }
  }

  ns.virtual = { isVirtualTable: isVirtualTable, collectVirtual: collectVirtual, overlapLen: overlapLen };
})();
