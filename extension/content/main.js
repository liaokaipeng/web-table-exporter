/**
 * HTML2XLSX 主 UI：选择模式工具栏、悬浮高亮、多选管理、xlsx 导出（须最后注入）
 * 依赖 window.__h2x 命名空间（entry/util/controls/split/cell/table/virtual/panel
 * 先行注入）；UI 层与算法层只经命名空间单向调用，面板经 panel.init() 注入依赖
 */
(() => {
  'use strict';
  const ns = window.__h2x;
  if (!ns || ns.aborted) return; // 守卫已退出（再次点击图标 = 退出选择模式），不初始化
  const { timestamp, sanitizeFilename } = ns.util;
  const { extractTable, makeSheetName, splitGroupOf } = ns.table;
  const { isVirtualTable, collectVirtual } = ns.virtual;
  const { applyColumnSplits, columnLayout, filterColumns } = ns.split;
  const panel = ns.panel;
  const persist = ns.persist;

  let active = true;
  let host = null;
  let hoverBox = null, countEl = null, nameInput = null, exportBtn = null, cancelBtn = null, hintEl = null, splitBtn = null;
  let hoverTable = null;
  let rafId = 0;
  let collecting = false; // 虚拟表格滚动采集中
  let exporting = false;  // xlsx 生成/编码进行中（await 让出主线程期间的重入保护）
  let genToken = 0;       // 代际令牌：退出/重新采集时使旧采集任务失效

  const selected = new Map();   // table -> 覆盖层元素（Map 保持选择顺序 = Sheet 顺序）
  const snapshots = new Map();   // table -> 虚拟滚动表格采集快照 { rows, ctrl, text, headerRows }
  const splitRules = new Map();  // table -> 列拆分规则（会话内存：面板保存时经 persist 落盘，选中时按表指纹恢复）
  const colFilters = new Map();  // table -> 导出列排除集 Set<colKey|colKey#k>（会话内存，持久化同上；无记录 = 全列导出）

  /* ---------------- UI 构建（Shadow DOM 隔离页面样式） ---------------- */

  function buildUI() {
    host = document.createElement('div');
    host.style.cssText =
      'all:initial;display:block;position:absolute;top:0;left:0;width:0;height:0;' +
      'z-index:2147483647;pointer-events:none;';
    document.documentElement.appendChild(host);

    const root = host.attachShadow({ mode: 'open' });
    // 工具栏样式 + 面板共用的按钮样式（面板专属样式由 panel.js 自持）
    root.innerHTML = [
      '<style>',
      '  .h2x-hover{position:absolute;pointer-events:none;box-sizing:border-box;border:2px solid #1976d2;background:rgba(25,118,210,.14);border-radius:2px;}',
      '  .h2x-sel{position:absolute;pointer-events:none;box-sizing:border-box;border:2px solid #2e7d32;background:rgba(46,125,50,.10);border-radius:2px;}',
      '  .h2x-badge{position:absolute;top:-12px;left:-12px;min-width:22px;height:22px;padding:0 6px;box-sizing:border-box;border-radius:11px;background:#2e7d32;color:#fff;font:700 12px/22px -apple-system,"Segoe UI",sans-serif;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.35);}',
      '  .h2x-bar{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);pointer-events:auto;display:flex;align-items:center;gap:10px;padding:10px 14px;background:#fff;border-radius:10px;box-shadow:0 4px 20px rgba(0,0,0,.25);font:13px/1.4 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif;color:#333;white-space:nowrap;}',
      '  .h2x-hint{color:#666;}',
      '  .h2x-count b{color:#2e7d32;}',
      '  .h2x-name{width:240px;max-width:40vw;padding:6px 10px;border:1px solid #ccc;border-radius:6px;font:13px/1.2 -apple-system,"Segoe UI",sans-serif;color:#333;outline:none;}',
      '  .h2x-name:focus{border-color:#2e7d32;}',
      '  .h2x-btn{padding:6px 16px;border:none;border-radius:6px;cursor:pointer;font:13px/1.2 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif;}',
      '  .h2x-primary{background:#2e7d32;color:#fff;}',
      '  .h2x-primary:disabled{background:#b0bec5;cursor:not-allowed;}',
      '  .h2x-ghost{background:#f5f5f5;color:#666;}',
      '  .h2x-ghost:disabled{color:#bbb;cursor:not-allowed;}',
      '  .h2x-split{background:#fff;color:#2e7d32;border:1px solid #2e7d32;}',
      '  .h2x-split:disabled{background:#f5f5f5;color:#bbb;border-color:#ccc;cursor:not-allowed;}',
      '</style>',
      '<div class="h2x-hover" hidden></div>',
      '<div class="h2x-bar">',
      '  <span class="h2x-hint">点击选择表格（可多选）</span>',
      '  <span class="h2x-count">已选 <b>0</b> 个</span>',
      '  <input class="h2x-name" type="text" spellcheck="false" />',
      '  <button class="h2x-btn h2x-split" disabled>列设置</button>',
      '  <button class="h2x-btn h2x-primary" disabled>导出 Excel</button>',
      '  <button class="h2x-btn h2x-ghost">取消 (Esc)</button>',
      '</div>'
    ].join('');

    hoverBox = root.querySelector('.h2x-hover');
    countEl = root.querySelector('.h2x-count b');
    nameInput = root.querySelector('.h2x-name');
    exportBtn = root.querySelector('.h2x-primary');
    cancelBtn = root.querySelector('.h2x-ghost');
    hintEl = root.querySelector('.h2x-hint');
    splitBtn = root.querySelector('.h2x-split');
    exportBtn.addEventListener('click', doExport);
    cancelBtn.addEventListener('click', exit);
    splitBtn.addEventListener('click', openPanel);

    nameInput.value = sanitizeFilename(document.title) + '_' + timestamp();
  }

  // 工具栏提示统一入口：文案 + 语义色（默认灰）；所有状态提示经此写入
  function setHint(msg, color) {
    hintEl.textContent = msg;
    hintEl.style.color = color || '#666';
  }

  function resetHint() {
    setHint('点击选择表格（可多选）');
  }

  /* ---------------- 事件处理 ---------------- */

  /** 命中解析：目标最近的 table → 逻辑表格根。组件库分体结构（表头/表体两个
   *  table，如 Element Plus el-table）返回其包装容器，使悬浮高亮、点选、导出
   *  三者始终识别为同一个表格 */
  function hitRoot(target) {
    const t = target.closest('table');
    if (!t) return null;
    const g = splitGroupOf(t);
    return g ? g.root : t;
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
    } else if (e.key === 'Enter' && !e.isComposing && !collecting) {
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

  /** 持久化恢复：把已保存的拆分规则/列筛选回填内存 Map（幂等：已有会话配置不
   *  覆盖，面板保存后重选也拿到最新值——removeSelected 只清内存不清存储）。
   *  选中表格时调用；导出/面板入口再兜底一次注入初期的存储加载竞态 */
  function restoreFromPersist(table) {
    if (splitRules.has(table) || colFilters.has(table)) return;
    const saved = persist.getSaved(table);
    if (!saved || (!saved.rules.length && !saved.excluded.size)) return;
    if (saved.rules.length) splitRules.set(table, saved.rules);
    if (saved.excluded.size) colFilters.set(table, saved.excluded);
    setHint('已恢复上次的列设置', '#2e7d32');
    setTimeout(() => {
      if (active && !collecting && !panel.isOpen()) resetHint();
    }, 2500);
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
    cancelBtn.disabled = true;
    setHint('虚拟表格采集滚动中…', '#1976d2');
    try {
      const snap = await collectVirtual(
        table,
        (n) => setHint('虚拟表格采集滚动中… 已采集 ' + n + ' 行', '#1976d2'),
        () => !active || gen !== genToken
      );
      if (!active || gen !== genToken) return; // 已退出/已作废
      snapshots.set(table, snap);
      addSelected(table);
      setHint('采集完成，共 ' + snap.rows.length + ' 行（含表头）', '#2e7d32');
      setTimeout(() => { if (active && !collecting) resetHint(); }, 2500);
    } catch (err) {
      console.error('[HTML2XLSX] 虚拟表格采集失败：', err);
      setHint('采集失败：' + (err && err.message ? err.message : err), '#c62828');
    } finally {
      collecting = false;
      cancelBtn.disabled = false;
      updateBar();
    }
  }

  function updateBar() {
    // 徽标重新编号（与 Sheet 顺序一致）
    let i = 0;
    for (const box of selected.values()) {
      box.firstChild.textContent = String(++i);
    }
    countEl.textContent = String(selected.size);
    const busy = collecting || panel.isOpen(); // 面板打开时主工具栏同步禁用
    exportBtn.disabled = busy || selected.size === 0;
    splitBtn.disabled = busy || selected.size === 0;
  }

  function positionBox(box, table) {
    const r = table.getBoundingClientRect();
    box.style.left = (r.left + window.scrollX) + 'px';
    box.style.top = (r.top + window.scrollY) + 'px';
    box.style.width = r.width + 'px';
    box.style.height = r.height + 'px';
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

  function downloadViaBlob(buf, name) {
    const blob = new Blob([buf], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
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
    setHint(msg, '#c62828');
  }

  function finish() {
    setHint('已开始下载…', '#2e7d32');
    setTimeout(exit, 600);
  }

  /** 导出 aoa 组装：先应用列拆分，再按排除集过滤列（列筛选）。
   *  含合并单元格的表格跳过筛选（!merges 列号基于原始 aoa，过滤会错位；面板已禁用） */
  function buildAoa(ch, table) {
    const rules = splitRules.get(table);
    const aoa = applyColumnSplits(ch, rules);
    if (ch.merges && ch.merges.length) return aoa;
    return filterColumns(aoa, columnLayout(ch, rules), colFilters.get(table));
  }

  async function doExport() {
    if (exporting || collecting || !selected.size) return;
    exporting = true; // await 让出主线程期间按钮未禁用，防重入（原同步链路天然互斥）
    try {
      await persist.ready(); // 兜底注入初期的存储加载竞态（正常情况早已就绪）
      if (collecting || !selected.size) return; // await 期间状态可能变化
      for (const table of selected.keys()) restoreFromPersist(table);
      let buf, name, b64;
      try {
        if (typeof XLSX === 'undefined') throw new Error('XLSX 库未加载');
        const used = new Set();
        const wb = XLSX.utils.book_new();
        let i = 0;
        for (const table of selected.keys()) {
          if (!active) return; // yield 间隙用户可能已退出，放弃导出
          let ws;
          if (snapshots.has(table)) {
            // 虚拟滚动表格：使用采集到的全量快照（列拆分与列筛选一并应用）
            ws = XLSX.utils.aoa_to_sheet(buildAoa(snapshots.get(table), table));
          } else {
            const ex = extractTable(table);
            ws = XLSX.utils.aoa_to_sheet(buildAoa(ex, table));
            if (ex.merges.length) ws['!merges'] = ex.merges;
          }
          XLSX.utils.book_append_sheet(wb, ws, makeSheetName(table, i++, used));
          await yieldToMain(); // 每表之间让出主线程：多表/大表导出期间页面不冻结
        }
        buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });

        name = sanitizeFilename(nameInput.value) || ('export_' + timestamp());
        if (!/\.xlsx$/i.test(name)) name += '.xlsx';
        name = name.replace(/^\.+/, ''); // chrome.downloads 不允许以点开头
        b64 = await arrayBufferToBase64(buf);
      } catch (err) {
        console.error('[HTML2XLSX] 生成 xlsx 失败：', err);
        showError('导出失败：' + (err && err.message ? err.message : err));
        return;
      }
      if (!active) return; // 编码间隙用户已退出，放弃下载

      // 首选经后台 chrome.downloads 下载（不受页面 CSP 限制）；失败回退页面内 blob 下载
      try {
        chrome.runtime.sendMessage(
          { type: 'html2xlsx-download', data: b64, filename: name },
          (resp) => {
            const err = chrome.runtime.lastError;
            if (!err && resp && resp.ok) { finish(); return; }
            console.error('[HTML2XLSX] 后台下载失败，回退 blob 下载：', err, resp);
            downloadViaBlob(buf, name);
            finish();
          }
        );
      } catch (err) {
        // 扩展上下文失效（如开发中重新加载了扩展）时 sendMessage 会同步抛错
        console.error('[HTML2XLSX] sendMessage 失败，回退 blob 下载：', err);
        downloadViaBlob(buf, name);
        finish();
      }
    } finally {
      exporting = false;
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
    panel.reset();
    window.__html2xlsx = null;
  }

  window.__html2xlsx = { toggle: exit };

  /* ---------------- 启动 ---------------- */

  buildUI();
  // 装配列设置面板依赖（host/Maps 为稳定引用；可变状态经 getter 读取）
  panel.init({
    host: host,
    selected: selected,
    snapshots: snapshots,
    splitRules: splitRules,
    colFilters: colFilters,
    isBusy: () => collecting,
    isAlive: () => active,
    updateBar: updateBar,
    setHint: setHint,
    resetHint: resetHint
  });
  document.addEventListener('mouseover', onMouseOver, true);
  document.addEventListener('click', onClickCapture, true);
  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('scroll', onReposition, true);
  window.addEventListener('resize', onReposition);
})();
