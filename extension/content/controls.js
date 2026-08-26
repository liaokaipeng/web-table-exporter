/**
 * 控件值提取（A 原生表单 → B ARIA 角色 → C 组件库类名，详见 docs/controls.md）
 * 零依赖；只从页面原元素读取实时状态（cloneNode 丢 JS 属性设值）
 */
(() => {
  'use strict';
  const ns = window.__h2x;

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
      if (el.type === 'checkbox' || el.type === 'radio') return el.checked ? '是' : '否';
      return el.value || '';
    }
    if (tag === 'SELECT') {
      const opts = [...el.selectedOptions];
      return opts.length ? opts.map(optionText).join('、') : ''; // 多选用顿号分隔
    }
    // B ARIA 控件角色
    const role = el.getAttribute('role');
    if (role === 'switch' || role === 'checkbox' || role === 'radio') {
      return el.getAttribute('aria-checked') === 'true' ? '是' : '否';
    }
    if (role === 'slider' || role === 'spinbutton') {
      return el.getAttribute('aria-valuenow') || '';
    }
    if (role === 'combobox' || role === 'listbox') {
      // 选项列表渲染在单元格内时取选中项；触发器场景无选中项则交由 innerText 兜底
      const sel = el.querySelectorAll('[aria-selected="true"]');
      if (!sel.length) return null;
      return [...sel].map(o => (o.textContent || '').trim()).filter(Boolean).join('、') || null;
    }
    // C 组件库类名兜底：el-switch / ant-switch / van-switch / n-switch 等开关
    if (typeof el.className === 'string') {
      const tokens = el.className.trim().split(/\s+/).filter(Boolean);
      if (tokens.some(t => t === 'switch' || t.endsWith('-switch'))) {
        const on = tokens.some(t =>
          (/checked/i.test(t) && !/unchecked/i.test(t)) || /--on$/i.test(t) || /--active$/i.test(t));
        return on ? '是' : '否';
      }
    }
    return null;
  }

  ns.controls = { CONTROL_SEL: CONTROL_SEL, controlValue: controlValue };
})();
