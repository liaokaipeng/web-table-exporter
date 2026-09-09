/**
 * 控件值提取（A 原生表单 → B ARIA 角色 → C 组件库类名，详见 docs/controls.md）
 * 零依赖；只从页面原元素读取实时状态（cloneNode 丢 JS 属性设值）
 */
(() => {
  'use strict';
  const ns = window.__h2x;

  // i18n 取词（各内容脚本同构，见 architecture.md「国际化」节）：优先经 ns.i18n
  // （i18n.js 手动中英文统一入口）；词条缺失或无 chrome.i18n 环境（Node 回归 /
  // E2E 桩未注入）→ 回落代码内中文，测试断言零改动
  const t = (key, fb, ...subs) => {
    if (ns.i18n) return ns.i18n.t(key, fb, subs); // v2.6.1 手动语言开关优先
    if (typeof chrome !== 'undefined' && chrome.i18n && chrome.i18n.getMessage) {
      const m = chrome.i18n.getMessage(key, subs.length ? subs.map(String) : undefined);
      if (m) return m;
    }
    return fb;
  };

  // 控件候选选择器：原生表单 + ARIA 控件角色 + 类名含 switch 的元素。
  // 候选统一送 controlValue() 精确判定，误匹配返回 null 保留原样（由 innerText 兜底）
  const CONTROL_SEL = 'input,textarea,select,output,[role=switch],[role=checkbox],[role=radio],' +
    '[role=slider],[role=spinbutton],[role=combobox],[role=listbox],[class*="switch"]';

  /** 原生 option 的统一格式：文本(value)；value 为空或与文本相同则只留文本 */
  function optionText(opt) {
    const text = (opt.textContent || '').trim();
    const value = (opt.value || '').trim();
    return (!value || text === value) ? text : (text + '(' + value + ')');
  }

  /** 控件取值（从页面原元素读取实时状态）。返回替换文本；
   *  返回 null 表示该元素不按控件处理，保留原样由 innerText 兜底 */
  function controlValue(el) {
    const tag = el.tagName;
    // A 原生表单
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'OUTPUT') {
      if (el.type === 'hidden') return ''; // 用户不可见，忽略
      if (el.type === 'checkbox' || el.type === 'radio') return el.checked ? t('valYes', '是') : t('valNo', '否');
      return el.value || '';
    }
    if (tag === 'SELECT') {
      const opts = [...el.selectedOptions];
      return opts.length ? opts.map(optionText).join(t('multiSelSep', '、')) : ''; // 多选按语言分隔
    }
    // B ARIA 控件角色
    const role = el.getAttribute('role');
    if (role === 'switch' || role === 'checkbox' || role === 'radio') {
      return el.getAttribute('aria-checked') === 'true' ? t('valYes', '是') : t('valNo', '否');
    }
    if (role === 'slider' || role === 'spinbutton') {
      return el.getAttribute('aria-valuenow') || '';
    }
    if (role === 'combobox' || role === 'listbox') {
      // 选项列表渲染在单元格内时取选中项；触发器场景无选中项则交由 innerText 兜底
      const sel = el.querySelectorAll('[aria-selected="true"]');
      if (!sel.length) return null;
      return [...sel].map(o => (o.textContent || '').trim()).filter(Boolean).join(t('multiSelSep', '、')) || null;
    }
    // C 组件库类名兜底：el-switch / ant-switch / van-switch / n-switch 等开关
    if (typeof el.className === 'string') {
      const tokens = el.className.trim().split(/\s+/).filter(Boolean);
      if (tokens.some(cls => cls === 'switch' || cls.endsWith('-switch'))) {
        const on = tokens.some(cls =>
          (/checked/i.test(cls) && !/unchecked/i.test(cls)) || /--on$/i.test(cls) || /--active$/i.test(cls));
        return on ? t('valYes', '是') : t('valNo', '否');
      }
    }
    return null;
  }

  ns.controls = { CONTROL_SEL: CONTROL_SEL, controlValue: controlValue };
})();
