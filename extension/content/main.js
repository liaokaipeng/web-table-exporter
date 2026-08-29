/**
 * HTML2XLSX 主 UI：选择模式工具栏、悬浮高亮、多选管理、多格式导出
 * （xlsx / csv / json / md / html，须最后注入）
 * 依赖 window.__h2x 命名空间（entry/util/controls/split/cell/table/virtual/
 * format/persist 先行注入）；UI 层与算法层只经命名空间单向调用，面板经
 * panel.init() 注入依赖。
 * v2.0：toast 反馈系统（结果性通知迁出 hint 行）、虚拟采集可中止、导出后
 * 保留选择、工具栏折行自适应、设计 token + 深色模式 + 动效（prefers 系列）
 * v2.1：支持 div 网格表格（Element Plus el-table-v2 虚拟化表格）的识别与滚动采集
 */
(() => {
  'use strict';
  const ns = window.__h2x;
  if (!ns || ns.aborted) return; // 守卫已退出（再次点击图标 = 退出选择模式），不初始化
  const { timestamp, sanitizeFilename } = ns.util;
  const { extractTable, makeSheetName, splitGroupOf } = ns.table;
  const { isVirtualTable, collectVirtual } = ns.virtual;
  const { applyColumnSplits, columnLayout, filterColumns, colKeys, formatColumns, applyColFormats, autoColWidths } = ns.split;
  const { toCsv, toJson, toMarkdown, toHtmlDocument } = ns.format;
  const panel = ns.panel;
  const persist = ns.persist;

  // 导出格式注册表：label 为按钮文案、ext 为文件扩展名、mime 为下载 MIME
  const FORMATS = {
    xlsx: { label: 'Excel', ext: 'xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
    csv: { label: 'CSV', ext: 'csv', mime: 'text/csv' },
    json: { label: 'JSON', ext: 'json', mime: 'application/json' },
    md: { label: 'Markdown', ext: 'md', mime: 'text/markdown' },
    html: { label: 'HTML', ext: 'html', mime: 'text/html' }
  };

  let active = true;
  let host = null;
  let hoverBox = null, countEl = null, nameInput = null, exportBtn = null, cancelBtn = null, hintEl = null, splitBtn = null, fmtSel = null;
  let toastRoot = null;
  let hoverTable = null;
  let rafId = 0;
  let collecting = false; // 虚拟表格滚动采集中
  let exporting = false;  // 导出文件生成/编码进行中（await 让出主线程期间的重入保护）
  let genToken = 0;       // 代际令牌：退出/重新采集时使旧采集任务失效
  let hasTables = true;   // 进入选择模式时页面是否存在表格（无表时默认提示切换）

  const selected = new Map();   // table -> 覆盖层元素（Map 保持选择顺序 = Sheet 顺序）
  const snapshots = new Map();   // table -> 虚拟滚动表格采集快照 { rows, ctrl, text, headerRows }
  const splitRules = new Map();  // table -> 列拆分规则（会话内存：面板保存时经 persist 落盘，选中时按表指纹恢复）
  const colFilters = new Map();  // table -> 导出列排除集 Set<colKey|colKey#k>（会话内存，持久化同上；无记录 = 全列导出）
  const colFormats = new Map();  // table -> 列格式 Map<colKey,'number'>（会话内存，持久化同上；文本为默认不记录）

  /* ---------------- UI 构建（Shadow DOM 隔离页面样式） ---------------- */

  function buildUI() {
    host = document.createElement('div');
    host.style.cssText =
      'all:initial;display:block;position:absolute;top:0;left:0;width:0;height:0;' +
      'z-index:2147483647;pointer-events:none;';
    document.documentElement.appendChild(host);

    const root = host.attachShadow({ mode: 'open' });
    // 工具栏样式 + 面板共用的按钮样式（面板专属样式由 panel.js 自持）。
    // v2.0 设计 token：颜色/圆角集中定义于 :host，工具栏与面板两处 <style>
    // 同一 shadowRoot 共享；深色模式经 prefers-color-scheme 覆写 token
    root.innerHTML = [
      '<style>',
      '  :host{--c-primary:#2e7d32;--c-info:#1976d2;--c-danger:#c62828;--c-warn:#8d6e00;',
      '    --c-text:#333;--c-text-2:#666;--c-text-3:#999;--c-border:#ccc;--c-border-2:#e0e0e0;',
      '    --c-bg:#fff;--c-bg-2:#f5f7fa;--c-bg-3:#fafbfc;--c-input:#fff;',
      '    --c-disable-bg:#757575;--c-disable-fg:#767676;--r:8px;--r-s:6px;}',
      '  @media (prefers-color-scheme: dark){:host{--c-primary:#4caf50;--c-info:#64b5f6;--c-danger:#ef5350;--c-warn:#ffd54f;',
      '    --c-text:#e0e0e0;--c-text-2:#aaa;--c-text-3:#777;--c-border:#555;--c-border-2:#3a3a3a;',
      '    --c-bg:#1e1e1e;--c-bg-2:#2a2a2a;--c-bg-3:#252525;--c-input:#333;',
      '    --c-disable-bg:#555;--c-disable-fg:#888;}}',
      '  .h2x-hover{position:absolute;pointer-events:none;box-sizing:border-box;border:2px solid #1976d2;background:rgba(25,118,210,.14);border-radius:2px;transition:left .08s,top .08s,width .08s,height .08s;}',
      '  .h2x-sel{position:absolute;pointer-events:none;box-sizing:border-box;border:2px solid #2e7d32;background:rgba(46,125,50,.10);border-radius:2px;}',
      '  .h2x-badge{position:absolute;top:-12px;left:-12px;min-width:22px;height:22px;padding:0 6px;box-sizing:border-box;border-radius:11px;background:#2e7d32;color:#fff;font:700 12px/22px -apple-system,"Segoe UI",sans-serif;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.35);}',
      '  .h2x-sel.h2x-flip-x .h2x-badge{left:auto;right:-12px;}',   /* 表格贴左边缘：徽标翻内侧 */
      '  .h2x-sel.h2x-flip-y .h2x-badge{top:auto;bottom:-12px;}',   /* 表格贴上边缘：徽标翻内侧 */
      '  .h2x-bar{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);pointer-events:auto;display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:8px 10px;max-width:96vw;box-sizing:border-box;padding:10px 14px;background:var(--c-bg);border-radius:10px;box-shadow:0 4px 20px rgba(0,0,0,.25);font:13px/1.4 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif;color:var(--c-text);}',
      '  .h2x-hint{color:var(--c-text-2);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',  /* 空间不足先截断提示文案，按钮不被迫换行 */
      '  .h2x-count{flex:none;white-space:nowrap;}',
      '  .h2x-count b{color:var(--c-primary);}',
      '  .h2x-name{flex:1 1 150px;min-width:110px;max-width:260px;padding:6px 10px;border:1px solid var(--c-border);border-radius:var(--r-s);font:13px/1.2 -apple-system,"Segoe UI",sans-serif;color:var(--c-text);outline:none;background:var(--c-input);box-sizing:border-box;}',
      '  .h2x-name:focus{border-color:var(--c-primary);}',
      '  .h2x-ext{padding:6px 8px;border:1px solid var(--c-border);border-radius:var(--r-s);font:13px/1.2 -apple-system,"Segoe UI",sans-serif;color:var(--c-text);background:var(--c-input);outline:none;cursor:pointer;flex:none;}',
      '  .h2x-ext:focus{border-color:var(--c-primary);}',
      '  .h2x-btn{padding:6px 16px;border:none;border-radius:var(--r-s);cursor:pointer;font:13px/1.2 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif;}',
      '  .h2x-btn:hover:not(:disabled){filter:brightness(1.06);}',
      '  .h2x-btn:active:not(:disabled){filter:brightness(.94);}',
      '  .h2x-primary{background:var(--c-primary);color:#fff;}',
      '  .h2x-primary:disabled{background:var(--c-disable-bg);color:#fff;cursor:not-allowed;filter:none;}',
      '  .h2x-ghost{background:var(--c-bg-3);color:var(--c-text-2);border:1px solid var(--c-border);}',
      '  .h2x-ghost:disabled{color:var(--c-disable-fg);cursor:not-allowed;}',
      '  .h2x-split{background:var(--c-bg);color:var(--c-primary);border:1px solid var(--c-primary);position:relative;}',
      '  .h2x-split:disabled{background:var(--c-bg-3);color:var(--c-disable-fg);border-color:var(--c-border);cursor:not-allowed;filter:none;}',
      '  .h2x-split.h2x-has-cfg::after{content:"";position:absolute;top:-4px;right:-4px;width:8px;height:8px;border-radius:50%;background:var(--c-info);box-shadow:0 0 0 2px var(--c-bg);}',  /* 已配置徽标点 */
      '  .h2x-actions{display:flex;gap:8px;flex:none;}',  /* 三按钮成组：极窄屏整组换行，不出现孤立按钮 */
      '  .h2x-toasts{position:fixed;top:16px;right:16px;display:flex;flex-direction:column;gap:8px;z-index:1;pointer-events:none;font:13px/1.4 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif;}',
      '  .h2x-toast{pointer-events:auto;display:flex;align-items:center;gap:10px;max-width:min(420px,86vw);padding:10px 12px 10px 14px;border-radius:var(--r);background:var(--c-bg);color:var(--c-text);box-shadow:0 4px 16px rgba(0,0,0,.25);animation:h2x-in .15s ease-out;border-left:3px solid var(--c-info);}',
      '  .h2x-toast-success{border-left-color:var(--c-primary);}',
      '  .h2x-toast-error{border-left-color:var(--c-danger);}',
      '  .h2x-toast-msg{flex:1;min-width:0;color:var(--c-text);}',
      '  .h2x-toast-btn{padding:3px 10px;border:1px solid var(--c-border);border-radius:var(--r-s);background:var(--c-bg);color:var(--c-text-2);cursor:pointer;font:12px/1.4 -apple-system,"Segoe UI",sans-serif;}',
      '  .h2x-toast-btn:hover{border-color:var(--c-primary);color:var(--c-primary);}',
      '  .h2x-toast-x{border:none;background:none;color:var(--c-text-3);cursor:pointer;font:16px/1 -apple-system,"Segoe UI",sans-serif;padding:0 2px;}',
      '  .h2x-toast-x:hover{color:var(--c-text);}',
      '  button:focus-visible,select:focus-visible,input:focus-visible{outline:2px solid var(--c-info);outline-offset:1px;}',
      '  @keyframes h2x-in{from{opacity:0;transform:translateY(-6px);}}',
      '  @media (prefers-reduced-motion: reduce){:host *{animation:none!important;transition:none!important;}}',
      '</style>',
      '<div class="h2x-hover" hidden></div>',
      '<div class="h2x-bar">',
      '  <span class="h2x-hint"></span>',
      '  <span class="h2x-count">已选 <b>0</b> 个</span>',
      '  <input class="h2x-name" type="text" spellcheck="false" />',
      '  <select class="h2x-ext" title="导出格式">' +
      Object.keys(FORMATS).map(k => '<option value="' + k + '">' + FORMATS[k].label + ' (.' + FORMATS[k].ext + ')</option>').join('') +
      '</select>',
      '  <div class="h2x-actions">',
      '    <button class="h2x-btn h2x-split" disabled>列设置</button>',
      '    <button class="h2x-btn h2x-primary" disabled></button>',
      '    <button class="h2x-btn h2x-ghost">取消 (Esc)</button>',
      '  </div>',
      '</div>',
      '<div class="h2x-toasts"></div>'
    ].join('');

    hoverBox = root.querySelector('.h2x-hover');
    countEl = root.querySelector('.h2x-count b');
    nameInput = root.querySelector('.h2x-name');
    fmtSel = root.querySelector('.h2x-ext');
    exportBtn = root.querySelector('.h2x-primary');
    cancelBtn = root.querySelector('.h2x-ghost');
    hintEl = root.querySelector('.h2x-hint');
    splitBtn = root.querySelector('.h2x-split');
    toastRoot = root.querySelector('.h2x-toasts');
    exportBtn.addEventListener('click', doExport);
    // v2.0：采集中「取消」变「停止采集」（只作废当前任务，不退出选择模式）
    cancelBtn.addEventListener('click', () => { collecting ? stopCollect() : exit(); });
    splitBtn.addEventListener('click', openPanel);
    // 格式切换：导出按钮文案同步（文件名扩展名在导出时按格式追加）
    fmtSel.addEventListener('change', syncExportBtn);

    nameInput.value = sanitizeFilename(document.title) + '_' + timestamp();
  }

  // 导出按钮文案与格式下拉同步（含「导出中…」结束后的恢复）
  function syncExportBtn() {
    if (exporting) return; // 导出中保持「导出中…」，结束时统一恢复
    exportBtn.textContent = '导出 ' + (FORMATS[fmtSel.value] || FORMATS.xlsx).label;
  }

  /* ---------------- Toast 反馈系统（v2.0） ---------------- */

  /** 结果性通知：成功/信息 2.5s 自动消失，错误常驻 + 关闭钮；同屏最多 3 条。
   *  返回句柄 { update(msg), close() } 供进度型 toast 复用同一条。
   *  hint 只保留引导与进行时文案（默认提示、采集进度、导出中），结果全部走 toast */
  function toast(msg, opts) {
    opts = opts || {};
    const type = opts.type || 'info';
    const box = document.createElement('div');
    box.className = 'h2x-toast h2x-toast-' + type;
    box.setAttribute('role', type === 'error' ? 'alert' : 'status');
    const msgEl = document.createElement('span');
    msgEl.className = 'h2x-toast-msg';
    msgEl.textContent = msg;
    box.appendChild(msgEl);
    let timer = 0;
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      if (timer) clearTimeout(timer);
      box.remove();
    };
    (opts.actions || []).forEach((a) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'h2x-toast-btn';
      btn.textContent = a.label;
      btn.addEventListener('click', () => { close(); if (a.onClick) a.onClick(); });
      box.appendChild(btn);
    });
    if (type === 'error') {
      const x = document.createElement('button');
      x.type = 'button';
      x.className = 'h2x-toast-x';
      x.setAttribute('aria-label', '关闭');
      x.textContent = '×';
      x.addEventListener('click', close);
      box.appendChild(x);
    }
    toastRoot.appendChild(box);
    while (toastRoot.children.length > 3) toastRoot.firstElementChild.remove();
    if (type !== 'error' && !opts.sticky) {
      timer = setTimeout(close, opts.duration || 2500);
    }
    return {
      update: (m) => { if (!closed) msgEl.textContent = m; },
      close: close
    };
  }

  // 工具栏提示统一入口：文案 + 语义色（默认灰）；引导/进行时文案经此写入
  function setHint(msg, color) {
    hintEl.textContent = msg;
    hintEl.style.color = color || '#666';
  }

  function resetHint() {
    setHint(hasTables ? '点击选择表格（可多选）' : '页面未找到表格');
  }

  /* ---------------- 事件处理 ---------------- */

  /** 命中解析：目标最近的 table → 逻辑表格根。组件库分体结构（表头/表体两个
   *  table，如 Element Plus el-table）返回其包装容器，使悬浮高亮、点选、导出
   *  三者始终识别为同一个表格；div 网格表格（el-table-v2，无 table 元素）返回
   *  组件根（单元格内嵌传统 table 时优先命中内层 table，可独立选中） */
  function hitRoot(target) {
    const t = target.closest('table');
    if (t) {
      const g = splitGroupOf(t);
      return g ? g.root : t;
    }
    return target.closest('.el-table-v2__root');
  }

  function onMouseOver(e) {
    if (!active || collecting || !(e.target instanceof Element)) return;
    const table = hitRoot(e.target);
    if (table) { hoverTable = table; positionBox(hoverBox, table); }
    else { hoverTable = null; hoverBox.hidden = true; }
  }

  function onClickCapture(e) {
    if (!active) return;
    // 工具栏自身的点击不拦截（按钮/输入框正常工作）
    if (e.composedPath().includes(host)) return;
    e.preventDefault();
    e.stopPropagation();
    if (collecting) return; // 采集滚动中不响应表格点击
    if (e.target instanceof Element) {
      const table = hitRoot(e.target);
      if (table) toggleSelect(table);
    }
  }

  function onKeyDown(e) {
    if (!active) return;
    if (panel.isOpen()) {
      // 面板打开时：Esc 只关面板；Enter 保存（焦点在按钮/下拉上时走默认行为）
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        panel.close();
      } else if (e.key === 'Enter' && !e.isComposing) {
        const focused = host.shadowRoot && host.shadowRoot.activeElement;
        if (focused && (focused.tagName === 'BUTTON' || focused.tagName === 'SELECT')) return;
        e.preventDefault();
        e.stopPropagation();
        panel.save();
      }
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      exit();
    } else if (e.key === 'Enter' && !e.isComposing && !collecting && !exporting) {
      // 焦点在工具栏按钮上时，Enter 走按钮默认行为（触发 click）
      const focused = host.shadowRoot && host.shadowRoot.activeElement;
      if (focused && focused.tagName === 'BUTTON') return;
      e.preventDefault();
      e.stopPropagation();
      doExport();
    }
  }

  function onReposition() {
    if (rafId || !active) return;
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      if (hoverTable && hoverTable.isConnected) positionBox(hoverBox, hoverTable);
      else { hoverTable = null; hoverBox.hidden = true; }
      for (const [table, box] of selected) {
        if (table.isConnected) positionBox(box, table);
        else removeSelected(table);
      }
    });
  }

  /* ---------------- 选中状态管理 ---------------- */

  function toggleSelect(table) {
    if (selected.has(table)) { removeSelected(table); return; }
    if (snapshots.has(table)) { addSelected(table); return; } // 已采集过：直接复用快照
    if (isVirtualTable(table)) { startCollect(table); return; } // 虚拟表格：滚动采集
    addSelected(table);
  }

  function addSelected(table) {
    const box = document.createElement('div');
    box.className = 'h2x-sel';
    const badge = document.createElement('span');
    badge.className = 'h2x-badge';
    box.appendChild(badge);
    host.shadowRoot.appendChild(box);
    selected.set(table, box);
    positionBox(box, table);
    restoreFromPersist(table); // 持久化恢复：按表指纹回填该表的拆分规则/列筛选
    updateBar();
  }

  /** 持久化恢复：把已保存的拆分规则/列筛选/列格式回填内存 Map（幂等：已有会话
   *  配置不覆盖，面板保存后重选也拿到最新值——removeSelected 只清内存不清存储）。
   *  选中表格时调用；导出/面板入口再兜底一次注入初期的存储加载竞态 */
  function restoreFromPersist(table) {
    if (splitRules.has(table) || colFilters.has(table) || colFormats.has(table)) return;
    const saved = persist.getSaved(table);
    if (!saved || (!saved.rules.length && !saved.excluded.size && !saved.formats.size)) return;
    if (saved.rules.length) splitRules.set(table, saved.rules);
    if (saved.excluded.size) colFilters.set(table, saved.excluded);
    if (saved.formats.size) colFormats.set(table, saved.formats);
    toast('已恢复上次的列设置', { type: 'info' });
    updateBar(); // 「列设置」徽标点状态同步
  }

  /** 打开列设置面板：先兜底持久化加载与恢复（面板读取 splitRules 显示已保存状态） */
  async function openPanel() {
    await persist.ready();
    for (const table of selected.keys()) restoreFromPersist(table);
    panel.open(); // 自身守卫（面板已开/采集中/未选中）
  }

  function removeSelected(table) {
    const box = selected.get(table);
    if (box) box.remove();
    selected.delete(table);
    snapshots.delete(table); // 虚拟表快照随取消失效，重选时重新采集最新数据
    splitRules.delete(table); // 会话内配置随取消失效（持久化记录保留，重选时自动恢复）
    colFilters.delete(table);
    colFormats.delete(table);
    panel.onTableRemoved(table); // 面板草稿同步删除；面板正在编辑该表则直接关闭
    updateBar();
  }

  async function startCollect(table) {
    if (collecting) return;
    collecting = true;
    const gen = ++genToken;
    hoverBox.hidden = true;
    exportBtn.disabled = true;
    splitBtn.disabled = true;
    cancelBtn.textContent = '停止采集'; // v2.0：采集中可中止（不退出选择模式）
    setHint('虚拟表格采集滚动中…', '#1976d2');
    try {
      const snap = await collectVirtual(
        table,
        (n) => { if (gen === genToken) setHint('虚拟表格采集滚动中… 已采集 ' + n + ' 行', '#1976d2'); },
        () => !active || gen !== genToken
      );
      if (!active || gen !== genToken) return; // 已退出/已作废（含「停止采集」）
      snapshots.set(table, snap);
      addSelected(table);
      toast('采集完成，共 ' + snap.rows.length + ' 行（含表头）', { type: 'success' });
      resetHint();
    } catch (err) {
      console.error('[HTML2XLSX] 虚拟表格采集失败：', err);
      toast('采集失败：' + (err && err.message ? err.message : err), { type: 'error' });
      resetHint();
    } finally {
      collecting = false;
      cancelBtn.textContent = '取消 (Esc)';
      updateBar();
    }
  }

  /** v2.0：停止当前虚拟采集——genToken 作废进行中任务（collectVirtual 回 null、
   *  快照不写入、表格不选中）；不退出选择模式，按钮与提示随后由 finally 恢复 */
  function stopCollect() {
    genToken++;
    toast('已停止采集', { type: 'info' });
    resetHint();
  }

  function updateBar() {
    // 徽标重新编号（与 Sheet 顺序一致）
    let i = 0;
    for (const box of selected.values()) {
      box.firstChild.textContent = String(++i);
    }
    countEl.textContent = String(selected.size);
    const busy = collecting || exporting || panel.isOpen(); // 面板/导出中主工具栏同步禁用
    exportBtn.disabled = busy || selected.size === 0;
    splitBtn.disabled = busy || selected.size === 0;
    // v2.0：已选表中存在拆分/筛选/格式配置 → 「列设置」按钮带徽标点
    let cfg = false;
    for (const tb of selected.keys()) {
      if (splitRules.has(tb) || colFilters.has(tb) || colFormats.has(tb)) { cfg = true; break; }
    }
    splitBtn.classList.toggle('h2x-has-cfg', cfg);
  }

  function positionBox(box, table) {
    const r = table.getBoundingClientRect();
    box.style.left = (r.left + window.scrollX) + 'px';
    box.style.top = (r.top + window.scrollY) + 'px';
    box.style.width = r.width + 'px';
    box.style.height = r.height + 'px';
    // v2.0：选中框徽标在表格贴视口左/上边缘时翻到内侧，避免出屏
    if (box.classList.contains('h2x-sel')) {
      box.classList.toggle('h2x-flip-x', r.left < 12);
      box.classList.toggle('h2x-flip-y', r.top < 12);
    }
    box.hidden = false;
  }

  /* ---------------- 导出 ---------------- */

  /** ArrayBuffer → base64：FileReader 原生编码（data URL 截到首个逗号），
   *  大文件显著快于分块 String.fromCharCode 拼接 */
  function arrayBufferToBase64(buf) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => {
        const s = String(fr.result);
        resolve(s.slice(s.indexOf(',') + 1));
      };
      fr.onerror = () => reject(fr.error || new Error('base64 编码失败'));
      fr.readAsDataURL(new Blob([buf]));
    });
  }

  /** 让出主线程一拍：多表导出的逐表间隙调用，生成期间页面可交互不冻结。
   *  MessageChannel 而非 setTimeout：后台标签页的定时器被节流（1s+）会拖慢导出 */
  const yieldToMain = () => new Promise((resolve) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => resolve();
    ch.port2.postMessage(0);
  });

  function downloadViaBlob(buf, name, mime) {
    const blob = new Blob([buf], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  function showError(msg) {
    toast(msg, { type: 'error' }); // v2.0：错误常驻可关（迁出 hint 行）
  }

  /** v2.0：导出成功保留选择（不再 0.6s 自动退出）——toast 给「退出」动作，
   *  用户可换格式连续导出；Esc / 取消 / toast 退出三条路径均可退出 */
  function finish(n) {
    toast(n > 1 ? '已下载 ' + n + ' 个文件' : '已开始下载…', {
      type: 'success',
      actions: [{ label: '退出', onClick: exit }]
    });
  }

  /** 导出 aoa 组装：先应用列拆分，再按排除集过滤列（列筛选），最后按列格式数值化
   *  （数字列数据行转数值；文本为默认行为不处理）。含合并单元格的表格跳过筛选
   *  （!merges 列号基于原始 aoa，过滤会错位；面板已禁用），列格式仍生效（不涉
   *  及列重排，layout 对 merges 表同样给出原列映射） */
  function buildAoa(ch, table) {
    const rules = splitRules.get(table);
    const layout = columnLayout(ch, rules);
    const excluded = colFilters.get(table);
    let aoa = applyColumnSplits(ch, rules);
    if (!(ch.merges && ch.merges.length)) {
      aoa = filterColumns(aoa, layout, excluded);
    }
    const formats = colFormats.get(table);
    if (formats && formats.size) {
      aoa = applyColFormats(aoa, formatColumns(layout, colKeys(ch), excluded, formats), ch.headerRows || 0);
    }
    return aoa;
  }

  /** 导出文件名：base + 可选表名后缀 + 按格式补扩展名（chrome.downloads 不允许以点开头） */
  function fileNamed(base, fmt, suffix) {
    let name = suffix ? base + '_' + sanitizeFilename(suffix) : base;
    if (!new RegExp('\\.' + fmt.ext + '$', 'i').test(name)) name += '.' + fmt.ext;
    return name.replace(/^\.+/, '');
  }

  /** 表单元 → xlsx 单文件（merges 与列宽随原逻辑） */
  function buildXlsxFile(tables, base) {
    if (typeof XLSX === 'undefined') throw new Error('XLSX 库未加载');
    const fmt = FORMATS.xlsx;
    const wb = XLSX.utils.book_new();
    for (const t of tables) {
      const ws = XLSX.utils.aoa_to_sheet(t.aoa);
      if (t.merges) ws['!merges'] = t.merges;
      ws['!cols'] = autoColWidths(t.aoa); // 列宽随内容自适应（上下限钳制，见 split.js）
      XLSX.utils.book_append_sheet(wb, ws, t.name);
    }
    return {
      name: fileNamed(base, fmt, ''),
      mime: fmt.mime,
      buf: XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
    };
  }

  /** 表单元 → 文本格式文件列表：CSV 多表拆多文件（单文件无法承载多表）；
   *  json/md/html 汇总为单文件（多表经表名分区/嵌套） */
  function buildTextFiles(fmtKey, base, tables) {
    const fmt = FORMATS[fmtKey];
    const enc = new TextEncoder();
    if (fmtKey === 'csv') {
      return tables.map(t => ({
        name: fileNamed(base, fmt, tables.length > 1 ? t.name : ''),
        mime: fmt.mime,
        buf: enc.encode(toCsv(t.aoa))
      }));
    }
    let text;
    if (fmtKey === 'json') text = toJson(tables);
    else if (fmtKey === 'md') text = toMarkdown(tables);
    else text = toHtmlDocument(tables, base);
    return [{ name: fileNamed(base, fmt, ''), mime: fmt.mime, buf: enc.encode(text) }];
  }

  /** 单文件下载：base64 经后台 chrome.downloads（不受页面 CSP 限制），失败回退 blob */
  function downloadFile(b64, file) {
    return new Promise((resolve) => {
      const fallback = (e) => {
        console.error('[HTML2XLSX] 后台下载失败，回退 blob 下载：', e);
        downloadViaBlob(file.buf, file.name, file.mime);
        resolve();
      };
      try {
        chrome.runtime.sendMessage(
          { type: 'html2xlsx-download', data: b64, filename: file.name, mime: file.mime },
          (resp) => {
            const err = chrome.runtime.lastError;
            if (!err && resp && resp.ok) { resolve(); return; }
            fallback(err || resp);
          }
        );
      } catch (err) {
        // 扩展上下文失效（如开发中重新加载了扩展）时 sendMessage 会同步抛错
        fallback(err);
      }
    });
  }

  async function doExport() {
    if (exporting || collecting || !selected.size) return;
    exporting = true; // await 让出主线程期间按钮未禁用，防重入（原同步链路天然互斥）
    // v2.0：导出中按钮反馈（防点击被静默吞掉）+ 进行时提示
    exportBtn.disabled = true;
    exportBtn.textContent = '导出中…';
    setHint('正在生成导出文件…', '#1976d2');
    try {
      await persist.ready(); // 兜底注入初期的存储加载竞态（正常情况早已就绪）
      if (collecting || !selected.size) return; // await 期间状态可能变化
      for (const table of selected.keys()) restoreFromPersist(table);

      // 1. 逐表取数（列拆分/列筛选/列格式已在 buildAoa 应用），组装与 Sheet 名同源的表单元
      const tables = [];
      const used = new Set();
      let i = 0;
      for (const table of selected.keys()) {
        if (!active) return; // yield 间隙用户可能已退出，放弃导出
        let aoa, headerRows, merges = null;
        if (snapshots.has(table)) {
          // 虚拟滚动表格：使用采集到的全量快照
          const snap = snapshots.get(table);
          aoa = buildAoa(snap, table);
          headerRows = snap.headerRows || 0;
        } else {
          const ex = extractTable(table);
          aoa = buildAoa(ex, table);
          headerRows = ex.headerRows || 0;
          if (ex.merges.length) merges = ex.merges; // 仅 xlsx 使用（文本格式为平面数据）
        }
        tables.push({ name: makeSheetName(table, i++, used), aoa: aoa, headerRows: headerRows, merges: merges });
        await yieldToMain(); // 每表之间让出主线程：多表/大表导出期间页面不冻结
      }

      // 2. 按所选格式生成下载文件列表（CSV 多表为多文件，其余单文件）
      const fmtKey = FORMATS[fmtSel.value] ? fmtSel.value : 'xlsx';
      const base = sanitizeFilename(nameInput.value) || ('export_' + timestamp());
      let files;
      try {
        files = fmtKey === 'xlsx' ? [buildXlsxFile(tables, base)] : buildTextFiles(fmtKey, base, tables);
      } catch (err) {
        console.error('[HTML2XLSX] 生成导出文件失败：', err);
        showError('导出失败：' + (err && err.message ? err.message : err));
        return;
      }

      // 3. 逐文件编码下载（后台 downloads 优先，失败回退 blob）；
      //    v2.0：多文件时 toast 实时进度「正在下载 i/n」
      let pt = null;
      if (files.length > 1) pt = toast('正在下载 1/' + files.length + '…', { type: 'info', sticky: true });
      for (let fi = 0; fi < files.length; fi++) {
        if (!active) return; // 编码间隙用户已退出，放弃下载
        if (pt) pt.update('正在下载 ' + (fi + 1) + '/' + files.length + '…');
        await downloadFile(await arrayBufferToBase64(files[fi].buf), files[fi]);
        await yieldToMain();
      }
      if (pt) pt.close();
      finish(files.length);
    } finally {
      exporting = false;
      syncExportBtn(); // 恢复按钮文案（导出中… → 导出 <格式>）
      updateBar();
      if (active) resetHint();
    }
  }

  /* ---------------- 退出与清理 ---------------- */

  function exit() {
    if (!active) return;
    active = false;
    genToken++; // 使进行中的采集任务失效
    document.removeEventListener('mouseover', onMouseOver, true);
    document.removeEventListener('click', onClickCapture, true);
    document.removeEventListener('keydown', onKeyDown, true);
    document.removeEventListener('scroll', onReposition, true);
    window.removeEventListener('resize', onReposition);
    if (rafId) cancelAnimationFrame(rafId);
    if (host) host.remove();
    selected.clear();
    snapshots.clear();
    splitRules.clear(); // 只清会话内存（持久化记录在 chrome.storage，重进选择模式自动恢复）
    colFilters.clear();
    colFormats.clear();
    panel.reset();
    window.__html2xlsx = null;
  }

  window.__html2xlsx = { toggle: exit };

  /* ---------------- 启动 ---------------- */

  buildUI();
  // v2.0：页面无表格时默认提示切换为「页面未找到表格」（动态加载不主动监测）；
  // v2.1：div 网格表格（el-table-v2）一并计入
  hasTables = document.querySelectorAll('table, .el-table-v2__root').length > 0;
  syncExportBtn();
  resetHint();
  // 装配列设置面板依赖（host/Maps 为稳定引用；可变状态经 getter 读取）
  panel.init({
    host: host,
    selected: selected,
    snapshots: snapshots,
    splitRules: splitRules,
    colFilters: colFilters,
    colFormats: colFormats,
    isBusy: () => collecting,
    isAlive: () => active,
    updateBar: updateBar,
    toast: toast
  });
  document.addEventListener('mouseover', onMouseOver, true);
  document.addEventListener('click', onClickCapture, true);
  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('scroll', onReposition, true);
  window.addEventListener('resize', onReposition);
})();