/**
 * 虚拟滚动表格支持：识别与自动滚动采集
 * 依赖：table（getRows）、cell（openBatch 批量取值）——均在函数调用时解引用
 * v2.9：窗口衔接改为「元素身份优先、内容匹配兜底」——行节点复用的虚拟列表（组件库
 * 常态：滚动时复用同一批行元素只换绑定数据）按 DOM 元素身份求重叠，相邻多行内容
 * 完全相同时不再被内容匹配过度合并（修复已知限制：相邻重复行少采）；无复用（节点
 * 整窗重建）或引用重叠内容不符时回落内容匹配，行为与 v2.8 一致
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

  /** 元素引用重叠：上一窗口尾部与本窗口头部 DOM 行元素相同的行数。行节点复用的
   *  虚拟列表（滚动时复用同一批行元素、只换绑定数据）据此可精确判定重叠——内容
   *  全同也不歧义；无复用（节点整窗重建）/ 首窗口返回 0（回落内容匹配）*/
  function refOverlapLen(prevRefs, winRefs) {
    if (!prevRefs || !winRefs || !prevRefs.length || !winRefs.length) return 0;
    const max = Math.min(prevRefs.length, winRefs.length);
    for (let k = max; k >= 1; k--) {
      let ok = true;
      for (let i = 0; i < k; i++) {
        if (winRefs[i] !== prevRefs[prevRefs.length - k + i]) { ok = false; break; }
      }
      if (ok) return k;
    }
    return 0;
  }

  /** 引用重叠的 k 行「内容是否与已累积数据尾部一致」的二次校验：节点被跨数据复用
   *  （同元素换了别行内容）时不采信元素身份，回落内容匹配（防误丢行） */
  function refTopsMatch(dataSigs, winSigs, k) {
    if (k <= 0 || k > dataSigs.length || k > winSigs.length) return false;
    const base = dataSigs.length - k;
    for (let i = 0; i < k; i++) {
      if (dataSigs[base + i] !== winSigs[i]) return false;
    }
    return true;
  }

  /**
   * 自动滚动采集虚拟表格全部行：回顶 → 按视口 80% 步长逐步下滚 → 逐窗口提取。
   * 表头行剥离只保留一份；数据行用「相邻窗口重叠合并」衔接，既消除窗口重叠区的
   * 重复，也保留数据中合法的重复行（重叠数优先按行元素身份判定，见 refOverlapLen）。
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
      // DOM 行元素与上一窗口完全相同（同一批节点）：非虚拟表格被误判时每窗口都是
      // 同一批行；虚拟表格渲染未完成时同理。二者都交给内容匹配兜底判定——内容也
      // 相同 → 重叠整窗、零新增；内容变了（同批节点原样换绑数据）→ 按内容求重叠，
      // 不因「节点没变」而整窗吞掉新行
      const winSigs = win.map(sigOf);
      const sameRefs = !firstWin && winRefs.length === prevRefs.length &&
        winRefs.every((el, i) => el === prevRefs[i]);
      const kRef = sameRefs ? 0 : refOverlapLen(prevRefs, winRefs);
      prevRefs = winRefs;
      const k = (kRef > 0 && refTopsMatch(dataSigs, winSigs, kRef)) ? kRef : overlapLen(dataSigs, winSigs);
      for (let i = k; i < win.length; i++) {
        data.push(win[i]);
        dataSigs.push(winSigs[i]); // 签名已由 win.map 计算，直接取缓存
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

  ns.virtual = {
    isVirtualTable: isVirtualTable,
    collectVirtual: collectVirtual,
    overlapLen: overlapLen,
    refOverlapLen: refOverlapLen, // v2.9 元素身份重叠（纯函数，algo-check 整文件加载回归）
    refTopsMatch: refTopsMatch
  };
})();
