/**
 * 点击扩展图标 → 按需注入内容脚本（避免在所有页面常驻加载 SheetJS）
 * 注入顺序即依赖顺序：xlsx.full.min.js（全局 XLSX）→ entry（守卫+命名空间）
 * → i18n（界面语言：手动中英文开关，各模块 t() 的统一取词入口，须先于
 * util/controls/split 等所有取词模块注入）→ util → controls → split → cell
 * → table → virtual → pagination → persist → format → panel → main（主 UI）
 */
chrome.action.onClicked.addListener(async (tab) => {
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: [
        'lib/xlsx.full.min.js',
        'content/entry.js',
        'content/i18n.js',
        'content/util.js',
        'content/controls.js',
        'content/split.js',
        'content/cell.js',
        'content/table.js',
        'content/virtual.js',
        'content/pagination.js',
        'content/persist.js',
        'content/format.js',
        'content/panel.js',
        'content/main.js'
      ]
    });
  } catch (e) {
    // chrome:// 等受限页面无法注入，静默失败
  }
});

/**
 * 接收内容脚本生成的导出数据（base64），经 chrome.downloads API 下载。
 * 不在内容脚本里用 blob: 链接下载的原因：页面 CSP 可能拦截，
 * 而 downloads API 属于扩展权限，不受页面策略限制。
 */
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * 语言词表读取（v2.6.1）：内容脚本无法直接 fetch chrome-extension:// 资源，
 * 手动英文界面所需的 _locales/en/messages.json 由本端代理读取返回。
 * 读取的是扩展自身打包文件（同源），无需 web_accessible_resources 权限。
 */
async function readLocaleCatalog(lang) {
  const safe = /^[a-z]{2,8}$/.test(lang || '') ? lang : 'en';
  const res = await fetch(chrome.runtime.getURL('_locales/' + safe + '/messages.json'));
  if (!res.ok) throw new Error('catalog HTTP ' + res.status);
  return res.json();
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.type !== 'string') return;
  if (msg.type === 'h2x-i18n-catalog') {
    readLocaleCatalog(msg.lang)
      .then((messages) => sendResponse({ ok: true, messages: messages }))
      .catch((e) => {
        console.warn('[HTML2XLSX] 语言词表读取失败：', e);
        sendResponse({ ok: false, error: String(e && e.message || e) });
      });
    return true; // 异步调用 sendResponse，需保持消息通道
  }
  if (msg.type !== 'html2xlsx-download') return;
  chrome.downloads.download(
    {
      url: 'data:' + (msg.mime || XLSX_MIME) + ';base64,' + msg.data,
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
