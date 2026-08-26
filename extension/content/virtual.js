/**
 * 虚拟滚动表格支持：识别与自动滚动采集
 * 依赖：table（getRows）、cell（cellParts）——均在函数调用时解引用
 */
(() => {
  'use strict';
  const ns = window.__h2x;

  /** 虚拟表格识别：类名含 virtual 的占位元素 / 带高度的无单元格占位 tr。
   *  宁可误报——误报时采集流程无损（每窗口都返回全量行，重叠合并后不变） */
  function isVirtualTable(table) {
    if (table.querySelector('[class*="virtual"]')) return true;
    for (const tb of table.tBodies) {
      for (const tr of tb.rows) {
        if (!tr.cells.length && tr.getBoundingClientRect().height > 0) return true;
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
   *  k 上限 cap 到一个视口的行数：滑动窗口的重叠不可能超过一屏，同时避免大表格 O(n²) 比较 */
  function overlapLen(acc, win) {
    const max = Math.min(acc.length, win.length, 200);
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
   * 返回与 extractTable 同构的四通道快照 { rows, ctrl, text, blocks, headerRows }。
   */
  async function collectVirtual(table, onProgress, isCancelled) {
    const container = findScrollContainer(table);
    const headers = []; // 表头行对象 { merged, ctrl, text, blocks }，首窗口确定，支持多行表头
    const data = [];    // 数据行对象（与 headers 同构，重叠合并同步维护）
    // 行签名（merged 通道拼接，缓存于行对象），供重叠匹配
    const sigOf = (row) => row.sig || (row.sig = row.merged.join('\x01'));

    // 提取当前窗口：表头只记录一份；数据行与已累积部分做后缀/前缀重叠合并
    let prevRefs = null; // 上一窗口数据行的 DOM 元素引用（判定窗口是否真的变化）
    const takeWindow = () => {
      const firstWin = prevRefs === null; // 首窗口收集全部表头行，后续窗口跳过
      const win = [];      // 当前窗口数据行对象
      const winRefs = [];
      for (const { cells, el, isHeader } of ns.table.getRows(table)) {
        const row = { merged: [], ctrl: [], text: [], blocks: [] };
        for (const cell of cells) {
          const parts = ns.cell.cellParts(cell);
          row.merged.push(parts.merged);
          row.ctrl.push(parts.ctrl);
          row.text.push(parts.text);
          row.blocks.push(parts.blocks);
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
      const k = overlapLen(data.map(sigOf), win.map(sigOf));
      for (let i = k; i < win.length; i++) data.push(win[i]);
      return win.length - k; // 新增行数
    };

    const progress = () => onProgress(data.length + headers.length);
    const getTop = () => (container ? container.scrollTop : window.scrollY);
    const setTop = (v) => { if (container) container.scrollTop = v; else window.scrollTo(0, v); };
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
