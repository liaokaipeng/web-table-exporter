/**
 * 界面语言管理（v2.6.1）：手动中英文切换 + 默认跟随浏览器
 * 动机：v2.6 国际化只跟随浏览器 UI 语言，用户无法手动指定中英文；
 * 本模块承载语言偏好（chrome.storage.local 'h2x.uiLang'：'zh'/'en'，
 * 缺省或删除 = auto 跟随浏览器）与同步取词解析，配合 main.js 工具栏
 * 「中文 | EN」分段切换按钮使用。算法层文案（控件「是/否」、Sheet 名
 * 兜底「表格N」、HTML 默认标题等）经同一入口解析，导出内容语言随开关。
 * 语言解析三层：
 *   1. 手动 zh → 直接回落代码内中文（zh 无独立词表，与 v2.6 语义一致）
 *   2. 手动 en → 按 en 词表取词——词表经后台消息拉取扩展包
 *      _locales/en/messages.json（内容脚本无法直接 fetch chrome-extension://
 *      资源，由 service-worker 代理读取，见 service-worker.js）；词表就绪前
 *      生效语言保持原值，避免切换首帧闪中文
 *   3. auto（默认）→ chrome.i18n 按浏览器语言取词（v2.6 现状语义零回归）
 * 依赖：entry（__h2x 命名空间）；chrome.storage / chrome.runtime / chrome.i18n
 *       均有守卫，Node 回归（algo-check.cjs 伪 window）与 E2E 桩环境自动
 *       降级为 auto→中文，行为零改动。
 */
(() => {
  'use strict';
  const ns = window.__h2x;

  const PREF_KEY = 'h2x.uiLang'; // 语言偏好键（独立于 persist 的列设置页键）
  let manual = null;             // 手动语言：'zh' | 'en'；null = auto（跟随浏览器）
  let dict = null;               // en 词表缓存（_locales/en/messages.json 解析结果）
  let dictPromise = null;        // 词表加载 Promise（幂等：只拉一次）

  const hasStorage = () =>
    typeof chrome !== 'undefined' && !!(chrome.storage && chrome.storage.local);
  const hasI18n = () =>
    typeof chrome !== 'undefined' && !!(chrome.i18n && chrome.i18n.getMessage);
  const hasRuntime = () =>
    typeof chrome !== 'undefined' && !!(chrome.runtime && chrome.runtime.sendMessage);

  /** 自动模式下的当前语言近似（切换控件高亮用）：浏览器 UI 语言前缀 en → 英文；
   *  无 chrome.i18n 环境（Node 回归 / E2E 桩）→ 中文（与回落语义一致） */
  function autoLang() {
    if (hasI18n()) {
      const ui = chrome.i18n.getUILanguage ? chrome.i18n.getUILanguage() : '';
      if (/^en\b/i.test(ui)) return 'en';
    }
    return 'zh';
  }

  /** 当前生效语言（'zh' | 'en'）：手动选择优先，否则按浏览器 */
  function langOf() {
    return manual || autoLang();
  }

  /** 手动语言（null = 自动）：供切换按钮判断「再点当前语言 = 回到自动」 */
  function lang() {
    return manual;
  }

  /** 词条占位符填充：placeholders.content 的格式为「$序号」（如 `$1`，无尾 $），
   *  标记该占位符对应第几个 substitutions——subs[i] 替换 content 为 $i 的
   *  占位符（与 chrome.i18n 语义一致），消息体本身以「$名字$」引用 */
  function fill(msg, placeholders, subs) {
    if (!subs || !subs.length || !placeholders) return msg;
    const byNum = {};
    for (const name of Object.keys(placeholders)) {
      const m = /^\$(\d+)$/.exec(placeholders[name].content || '');
      if (m) byNum[m[1]] = name;
    }
    subs.forEach((s, i) => {
      const name = byNum[String(i + 1)];
      if (name) msg = msg.split('$' + name + '$').join(String(s));
    });
    return msg;
  }

  /** 拉取指定语言词表（后台消息 → service-worker 读扩展包资源；失败降级返回 null） */
  function loadDict(langCode) {
    if (dictPromise) return dictPromise;
    dictPromise = new Promise((resolve) => {
      const fail = () => { dict = null; resolve(null); };
      if (!hasRuntime()) { fail(); return; } // 无扩展上下文（Node 回归 / E2E 桩）
      try {
        chrome.runtime.sendMessage({ type: 'h2x-i18n-catalog', lang: langCode }, (resp) => {
          if (chrome.runtime.lastError || !resp || !resp.ok) { fail(); return; }
          dict = resp.messages || null;
          resolve(dict);
        });
      } catch (e) { fail(); }
    });
    return dictPromise;
  }

  /** 词表内取词（含占位符替换）；缺词条返回 null */
  function dictMsg(key, subs) {
    const e = dict && dict[key];
    if (!e || typeof e.message !== 'string') return null;
    return fill(e.message, e.placeholders, subs);
  }

  /** 同步取词（内容脚本各就地 t() 的统一入口；词条缺失/环境缺失回落代码内中文） */
  function t(key, fb, subs) {
    if (manual === 'zh') return fb;              // 手动中文：zh 无独立词表，回落代码内中文
    if (manual === 'en' && dict) {               // 手动英文：词表优先（就绪后）
      const m = dictMsg(key, subs);
      if (m != null) return m;
    }
    if (hasI18n()) {                             // 自动 / 词表缺失兜底：浏览器 UI 语言
      const m = chrome.i18n.getMessage(key, subs && subs.length ? subs.map(String) : undefined);
      if (m) return m;
    }
    return fb;
  }

  /** 写入偏好并生效；code: 'zh' | 'en' | 'auto'（auto = 删偏好，跟随浏览器）。
   *  手动 en 先拉词表（异步），完成前生效语言保持原值，避免首帧闪中文 */
  async function setLang(code) {
    if (code === 'en') await loadDict('en');
    manual = (code === 'zh' || code === 'en') ? code : null;
    if (hasStorage()) {
      try {
        if (manual) await chrome.storage.local.set({ [PREF_KEY]: manual });
        else await chrome.storage.local.remove(PREF_KEY);
      } catch (e) {
        console.warn('[HTML2XLSX] 语言偏好写入失败（本次会话生效）：', e);
      }
    }
    return manual;
  }

  /** 注入时读取偏好并生效（main.js 装配后调用；生效语言变化时由主 UI 刷新文案） */
  async function init() {
    if (!hasStorage()) return; // 无法读偏好（Node / E2E 桩无 storage 时）→ 保持自动
    try {
      const data = await chrome.storage.local.get(PREF_KEY);
      const pref = data && data[PREF_KEY];
      if (pref === 'en') { await loadDict('en'); manual = 'en'; }
      else if (pref === 'zh') manual = 'zh';
    } catch (e) {
      console.warn('[HTML2XLSX] 语言偏好读取失败（按浏览器语言）：', e);
    }
  }

  ns.i18n = { t: t, lang: lang, langOf: langOf, setLang: setLang, init: init };
})();
