/**
 * 点击扩展图标 → 按需注入内容脚本（避免在所有页面常驻加载 SheetJS）
 * 注入顺序：xlsx.full.min.js（提供全局 XLSX）→ content.js（选择模式）
 */
chrome.action.onClicked.addListener(async (tab) => {
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['lib/xlsx.full.min.js', 'content/content.js']
    });
  } catch (e) {
    // chrome:// 等受限页面无法注入，静默失败
  }
});

/**
 * 接收内容脚本生成的 xlsx 数据（base64），经 chrome.downloads API 下载。
 * 不在内容脚本里用 blob: 链接下载的原因：页面 CSP 可能拦截，
 * 而 downloads API 属于扩展权限，不受页面策略限制。
 */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'html2xlsx-download') return;
  chrome.downloads.download(
    {
      url: 'data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,' + msg.data,
      filename: msg.filename,
      saveAs: false
    },
    (downloadId) => {
      const err = chrome.runtime.lastError;
      sendResponse({ ok: !err && downloadId !== undefined, error: err ? err.message : null });
    }
  );
  return true; // 异步调用 sendResponse，需保持消息通道
});
