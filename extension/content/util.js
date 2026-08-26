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

  ns.util = { timestamp: timestamp, sanitizeFilename: sanitizeFilename, escapeHtml: escapeHtml };
})();
