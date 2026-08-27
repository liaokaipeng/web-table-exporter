/**
 * 单元格四通道取值（v1.3 列拆分的数据基础）
 * - merged：控件替换为实时值后的完整文本（默认导出通道，行为与 v1.2 一致）
 * - ctrl：控件实时值数组（按 DOM 顺序逐个保留，空值也占位以保证多控件列对齐；
 *   无命中控件为 null）——control 拆分模式据此一格多控件各成一列
 * - text：移除命中控件后的页面文本（未命中候选的文本留在其中）
 * - blocks：视觉文本块数组（块级元素边界即换行处切分，控件已替换为实时值），
 *   如「标题/产品ID」列（两个 div 堆叠）→ [标题, 产品ID]；块内空格不拆
 * 依赖：controls（控件判定）、split（splitBlocks）
 */
(() => {
  'use strict';
  const ns = window.__h2x;

  // 归一化：视觉上分离的文本块（换行/连续空格/nbsp）压缩为单个空格；相连文本保持相连
  const normText = (s) => (s || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();

  /** 单元格四通道取值。实现沿用克隆骨架：一次克隆、一次离屏挂载、两轮 innerText
   *  （替换控件得 merged、移除注入的值节点得 text）；值直读原元素（cloneNode 只复制
   *  特性，JS 属性设值会丢）；离屏容器不加 visibility:hidden（innerText 按规范会
   *  排除不可见文本） */
  function cellParts(cell) {
    const origs = cell.querySelectorAll(ns.controls.CONTROL_SEL);
    if (!origs.length) {
      const text = normText(cell.innerText);
      return { merged: text, ctrl: null, text: text, blocks: ns.split.splitBlocks(cell.innerText) };
    }
    const clone = cell.cloneNode(true);
    const clones = clone.querySelectorAll(ns.controls.CONTROL_SEL);
    // 命中控件：嵌套在已命中控件内的候选跳过（如 el-switch 内的 checkbox，避免重复计数）
    const hits = [];
    origs.forEach((orig, i) => {
      const v = ns.controls.controlValue(orig);
      if (v === null) return;
      if (hits.some(h => origs[h.i].contains(orig))) return;
      hits.push({ i: i, v: v });
    });
    // 第一轮：命中控件替换为其实时值（前后补空格作为与相邻文本的分隔，最终统一归一化）
    const marks = [];
    hits.forEach(h => {
      const node = document.createTextNode(' ' + h.v + ' ');
      clones[h.i].replaceWith(node);
      marks.push(node);
    });
    clone.querySelectorAll('img,video,svg,iframe').forEach(el => el.remove());
    const holder = document.createElement('div');
    holder.style.cssText = 'position:fixed;left:-99999px;top:0;';
    holder.appendChild(clone);
    document.body.appendChild(holder);
    const merged = normText(clone.innerText);
    const blocks = ns.split.splitBlocks(clone.innerText); // 控件值替换后按视觉块切（控件值块保留其中）
    // 第二轮：移除注入的值节点，得纯页面文本
    let text = merged;
    if (marks.length) {
      marks.forEach(n => n.remove());
      text = normText(clone.innerText);
    }
    holder.remove();
    // ctrl 通道保持数组（空值占位不串列）；merged 通道已含全部控件值，展示不受影响
    return { merged: merged, ctrl: hits.length ? hits.map(h => h.v) : null, text: text, blocks: blocks };
  }

  ns.cell = { cellParts: cellParts };
})();
