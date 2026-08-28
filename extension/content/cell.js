/**
 * 单元格四通道取值（v1.3 列拆分的数据基础）
 * - merged：控件替换为实时值后的完整文本（默认导出通道，行为与 v1.2 一致）
 * - ctrl：控件实时值数组（按 DOM 顺序逐个保留，空值也占位以保证多控件列对齐；
 *   无命中控件为 null）——control 拆分模式据此一格多控件各成一列
 * - text：移除命中控件后的页面文本（未命中候选的文本留在其中）
 * - blocks：视觉文本块数组（块级元素边界即换行处切分，控件已替换为实时值），
 *   如「标题/产品ID」列（两个 div 堆叠）→ [标题, 产品ID]；块内空格不拆
 * 图片导出为链接（v1.6）：img 以其 src 绝对地址（srcset 场景取 currentSrc）作为
 * 文本参与各通道；无链接图片、video/svg/iframe 导出为空
 * 依赖：controls（控件判定）、split（splitBlocks）
 *
 * 批量两阶段读取（v1.8 性能优化）：逐格离屏挂载会让每格产生 2-3 次强制回流，
 * 万格表格 = 上万次 reflow。openBatch() 把整表克隆统一挂到单个离屏容器、写读
 * 分组集中执行，整表强制回流次数从 O(格数) 降为常数 3 次。实现沿用克隆骨架：
 * 一次克隆、一次挂载、两轮 innerText（替换控件得 merged、移除注入的值节点得
 * text）；值直读原元素（cloneNode 只复制特性，JS 属性设值会丢）；离屏容器不加
 * visibility:hidden（innerText 按规范会排除不可见文本）
 */
(() => {
  'use strict';
  const ns = window.__h2x;

  // 归一化：视觉上分离的文本块（换行/连续空格/nbsp）压缩为单个空格；相连文本保持相连
  const normText = (s) => (s || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();

  /** 预备一格（纯 DOM 写，无布局读取）。返回四通道容器：
   *  快速路径（无控件无图片）当场读原格 innerText 取齐；克隆路径的
   *  merged/text/blocks 留待批量 resolve() 填充（clone/marks 为内部字段） */
  function prepareCell(cell) {
    const origs = cell.querySelectorAll(ns.controls.CONTROL_SEL);
    if (!origs.length && !cell.querySelector('img')) {
      const raw = cell.innerText; // 预备阶段不写活动文档，多次读取共享同一次回流
      return { merged: normText(raw), ctrl: null, text: normText(raw), blocks: ns.split.splitBlocks(raw) };
    }
    const clone = cell.cloneNode(true);
    const clones = clone.querySelectorAll(ns.controls.CONTROL_SEL);
    // 图片链接先于控件替换：img 若嵌在命中控件内，控件整体替换后会随克隆消失，
    // 先按原元素索引对齐替换可保证不串位（与控件同套路：值从原元素读）
    const imgClones = clone.querySelectorAll('img');
    cell.querySelectorAll('img').forEach((im, i) => {
      // src 属性优先取解析后的绝对地址；无 src（srcset）时兜底 currentSrc；均无则导出为空
      const url = (im.getAttribute('src') ? im.src : '') || im.currentSrc || '';
      imgClones[i].replaceWith(url ? document.createTextNode(' ' + url + ' ') : document.createTextNode(''));
    });
    clone.querySelectorAll('video,svg,iframe').forEach(el => el.remove());
    // 命中控件：嵌套在已命中控件内的候选跳过（如 el-switch 内的 checkbox，避免
    // 重复计数）；替换为其实时值文本节点（前后补空格作分隔，最终统一归一化）
    const marks = [];
    origs.forEach((orig, i) => {
      const v = ns.controls.controlValue(orig);
      if (v === null) return;
      if (marks.some(m => origs[m.i].contains(orig))) return;
      const node = document.createTextNode(' ' + v + ' ');
      clones[i].replaceWith(node);
      marks.push({ i: i, v: v, node: node });
    });
    // ctrl 通道保持数组（空值占位不串列）；merged 通道已含全部控件值，展示不受影响
    return { ctrl: marks.length ? marks.map(m => m.v) : null, clone: clone, marks: marks };
  }

  /** 批量读取器（两阶段）：openBatch() → { prepare(cell), resolve() }。
   *  - prepare：逐格预备。克隆先挂到（仍游离的）holder 上，此时不产生任何布局；
   *    快速路径格当场取齐
   *  - resolve：统一挂载 holder → 集中读全部克隆的 merged/blocks → 集中移除全部
   *    注入值节点 → 集中重读 text → 拆除 holder。写与读完全分组：
   *    挂载 1 次回流、首轮首读 1 次、移除后首读 1 次，整表共 ~3 次（幂等） */
  function openBatch() {
    const holder = document.createElement('div');
    holder.style.cssText = 'position:fixed;left:-99999px;top:0;';
    const items = []; // 克隆路径的预备格（resolve 待读）
    let resolved = false;
    return {
      prepare: (cell) => {
        const p = prepareCell(cell);
        if (p.clone) { holder.appendChild(p.clone); items.push(p); }
        return p;
      },
      resolve: () => {
        if (resolved) return;
        resolved = true;
        if (!items.length) return;
        document.body.appendChild(holder);
        // 第一轮：替换控件后的完整文本（首轮首读触发一次回流，后续共享干净布局）
        for (const p of items) {
          const raw = p.clone.innerText;
          p.merged = normText(raw);
          p.blocks = ns.split.splitBlocks(raw);
        }
        // 第二轮：先集中移除全部注入值节点（一次布局失效），再集中重读得纯页面文本
        for (const p of items) for (const m of p.marks) m.node.remove();
        for (const p of items) {
          p.text = p.marks.length ? normText(p.clone.innerText) : p.merged;
        }
        holder.remove();
      }
    };
  }

  ns.cell = { openBatch: openBatch };
})();
