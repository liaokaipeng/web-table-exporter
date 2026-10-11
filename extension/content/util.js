/** 通用工具函数（零依赖） */
(() => {
  'use strict';
  const ns = window.__h2x;

  const pad = (n) => String(n).padStart(2, '0');

  /** 时间戳 yyyymmdd-hhmmss（导出文件名默认后缀） */
  function timestamp() {
    const d = new Date();
    return (
      d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' +
      pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds())
    );
  }

  /** 文件名清洗：过滤 Windows 非法字符，去首尾空白 */
  function sanitizeFilename(s) {
    return (s || '').replace(/[\\/:*?"<>|]/g, '_').trim();
  }

  /** HTML 转义（面板 innerHTML 插值防注入） */
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, ch => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
    ));
  }

  /** 视口钳制（纯函数）：left/top 限制在 [0, vw-w]×[0, vh-h]；
   *  元素不小于对应维度时贴 0（窄屏大窗口不跑出可视区） */
  function clampPos(left, top, w, h, vw, vh) {
    return {
      left: w >= vw ? 0 : Math.min(Math.max(left, 0), vw - w),
      top: h >= vh ? 0 : Math.min(Math.max(top, 0), vh - h)
    };
  }

  /** 窗口拖拽移动（v2.15，指针事件，鼠标/触摸通用）：handle 指定把手元素或
   *  选择器（缺省整个 el），把手内匹配 ignore 选择器的后代不启动拖拽（按钮/
   *  输入等交互控件照常点击）。位移超过 3px 才认定为拖拽——单纯单击不改写
   *  布局（基准定位保留，窗口 resize 仍能自适应居中）；认定即「实化」定位：
   *  按当前 rect 改写 left/top 并清掉 transform/动画，之后只走 clampPos 视口
   *  钳制。拖拽中给 el 加 h2x-dragging 类（调用方样式：user-select:none），
   *  把手需自行声明 touch-action:none（防触摸拖拽被浏览器滚动手势抢走）。
   *  返回 dispose()：摘除 resize 钳制与指针监听（调用方在元素移除时调用，
   *  如主工具栏退出、列设置面板关闭） */
  function draggable(el, opts) {
    opts = opts || {};
    const handle = typeof opts.handle === 'string' ? el.querySelector(opts.handle) : (opts.handle || el);
    if (!handle) return () => {};
    const ignore = opts.ignore;
    const THRESH = 3; // 单击与拖拽的判定阈值（px）
    let startX = 0, startY = 0, baseLeft = 0, baseTop = 0, baseW = 0, baseH = 0, started = false;
    const onMove = (e) => {
      const dx = e.clientX - startX, dy = e.clientY - startY;
      if (!started) {
        if (Math.abs(dx) < THRESH && Math.abs(dy) < THRESH) return;
        started = true;
        // 实化定位：rect → 显式 left/top（清 transform/动画/外边距，
        // 之后的移动与钳制只依赖这两个值）
        const cs = el.style;
        if (getComputedStyle(el).position !== 'fixed') cs.position = 'fixed';
        cs.left = baseLeft + 'px';
        cs.top = baseTop + 'px';
        cs.right = 'auto';
        cs.bottom = 'auto';
        cs.margin = '0';
        cs.transform = 'none';
        cs.animation = 'none'; // 压掉入场动画的 transform（如面板弹出动画）
        el.classList.add('h2x-dragging');
        if (e.cancelable) e.preventDefault(); // 止住兼容 mousemove → 文本不被拖选
      }
      const p = clampPos(baseLeft + dx, baseTop + dy, baseW, baseH, window.innerWidth, window.innerHeight);
      el.style.left = p.left + 'px';
      el.style.top = p.top + 'px';
    };
    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
      el.classList.remove('h2x-dragging');
    };
    const onDown = (e) => {
      if (e.button !== 0) return; // 仅主键（触摸 pointerdown 亦为 0）
      if (ignore && e.target instanceof Element && e.target.closest(ignore)) return;
      e.preventDefault(); // 非交互区：不抢焦点、不启文本选择
      const r = el.getBoundingClientRect();
      startX = e.clientX; startY = e.clientY;
      baseLeft = r.left; baseTop = r.top; baseW = r.width; baseH = r.height;
      started = false;
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
      document.addEventListener('pointercancel', onUp);
    };
    handle.addEventListener('pointerdown', onDown);
    // 窗口 resize 后重新钳制（防缩小窗口后界面被移出屏外）；元素已移除则自清监听
    const onResize = () => {
      if (!el.isConnected) { window.removeEventListener('resize', onResize); return; }
      if (!started && el.style.left === '') return; // 从未拖动：保持基准布局
      const r = el.getBoundingClientRect();
      const p = clampPos(r.left, r.top, r.width, r.height, window.innerWidth, window.innerHeight);
      el.style.left = p.left + 'px';
      el.style.top = p.top + 'px';
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      handle.removeEventListener('pointerdown', onDown);
      onUp();
    };
  }

  ns.util = {
    timestamp: timestamp, sanitizeFilename: sanitizeFilename, escapeHtml: escapeHtml,
    clampPos: clampPos, draggable: draggable
  };
})();
