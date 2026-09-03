/**
 * E2E 注入测试 harness（fixture.html，无扩展环境）v2
 * 用法（非阻塞启动，见 bootstrap 协议）：
 *   const c = await (await fetch('/test/e2e-harness.js?v=' + Date.now())).text();
 *   window.__TEST_RESULT = await (0, eval)(c);
 * 覆盖：选择交互、链接拦截、Esc 退出、CSV/JSON/MD/HTML/XLSX 导出内容、
 * 合并单元格 merges、Sheet 名、自适应列宽、列拆分三模式、列筛选、列格式、
 * 分体表格合并、持久化保存/恢复/重置。
 * v2 加固：强制全新注入（预清 __html2xlsx/__h2x 与残留 host，entry 守卫永不误触发）、
 * 注入后隐藏 __html2xlsx（防外部脚本误退出本会话）、轮次串行锁、调试日志。
 * 提速（v2.2）：固定 sleep 改事件驱动 waitFor（exit/openPanel 均同步或微任务级），
 * 模块代码缓存（11 文件仅首轮拉取），导出轮询 25ms；配 run-all.ps1 headless
 * 虚拟时间模式整页约 1 秒跑完。
 */
(async () => {
  if (window.__HARNESS_STARTED) return { error: 'harness 已在运行（并发守卫）' };
  window.__HARNESS_STARTED = true;
  window.__TEST_LOG = [];
  const log = (m) => window.__TEST_LOG.push(String(m));
  const R = [];
  const t = (name, pass, detail) => R.push({ name, pass: !!pass, detail: detail == null ? '' : String(detail) });
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  // 事件驱动等待：条件满足立即返回（替代固定 sleep，提速且比盲等更强：等不到会显式超时暴露）
  const waitFor = async (cond, timeout) => {
    const t0 = Date.now();
    while (!cond() && Date.now() - t0 < (timeout || 3000)) await sleep(20);
    return !!cond();
  };

  /* ---- 全局桩：chrome.storage（内存实现）、chrome.runtime.sendMessage（抛错走 blob 回退） ---- */
  const memStore = {};
  window.chrome = {
    storage: { local: {
      get: async (k) => {
        const out = {};
        if (k == null) { for (const key in memStore) out[key] = memStore[key]; return out; }
        for (const key of (Array.isArray(k) ? k : [k])) if (memStore[key] != null) out[key] = memStore[key];
        return out;
      },
      set: async (obj) => { for (const key in obj) memStore[key] = obj[key]; },
      remove: async (keys) => { for (const k of (Array.isArray(keys) ? keys : [keys])) delete memStore[k]; }
    } },
    runtime: { sendMessage: () => { throw new Error('E2E: 无扩展上下文（预期走 blob 回退）'); } }
  };

  /* ---- 捕获导出：桩 URL.createObjectURL + HTMLAnchorElement.prototype.click ---- */
  const origCreate = URL.createObjectURL.bind(URL);
  window.__exports = [];
  const blobMap = new Map();
  URL.createObjectURL = (b) => { const u = origCreate(b); blobMap.set(u, b); return u; };
  HTMLAnchorElement.prototype.click = function () {
    const b = blobMap.get(this.href);
    if (b) window.__exports.push({ name: this.download, blob: b });
  };

  /* ---- 加载 SheetJS（xlsx 验证用） ---- */
  await new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = '/extension/lib/xlsx.full.min.js';
    s.onload = res; s.onerror = () => rej(new Error('XLSX 库加载失败'));
    document.head.appendChild(s);
  });
  log('XLSX 库已加载');

  /* ---- 注入与 UI 定位 ---- */
  const FILES = ['entry', 'util', 'controls', 'split', 'cell', 'table', 'virtual', 'persist', 'format', 'panel', 'main'];
  const modCache = Object.create(null); // 模块代码缓存：11 文件只拉取一次，17 轮免重复网络往返
  function staleHosts() {
    return [...document.documentElement.children].filter(el => el.tagName === 'DIV' && el.style.zIndex === '2147483647');
  }
  async function inject(roundName) {
    // 强制全新注入：先尝试退出旧会话、移除残留 host、清空守卫状态
    // （exit 为同步清理，无需等待；残留兜底由 staleHosts 强删完成）
    if (window.__html2xlsx) { try { window.__html2xlsx.toggle(); } catch (e) { /* 已失效 */ } }
    staleHosts().forEach(el => el.remove());
    window.__html2xlsx = null;   // entry 守卫永不触发退出语义
    try { delete window.__h2x; } catch (e) { window.__h2x = undefined; }
    // 后台/不可见标签页 rAF 不触发 → virtual.js settle 永久挂起；
    // 测试环境用定时器替代（fixture 渲染走 scroll 事件，不依赖真实绘制）
    window.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 16);
    for (const f of FILES) {
      if (!modCache[f]) {
        const r = await fetch('/extension/content/' + f + '.js');
        if (!r.ok) throw new Error(f + '.js HTTP ' + r.status);
        modCache[f] = await r.text();
      }
      try { (0, eval)(modCache[f]); }
      catch (e) { log('[' + roundName + '] ' + f + '.js 求值异常: ' + e); throw e; }
    }
    const ok = !!window.__html2xlsx;
    log('[' + roundName + '] 注入结果=' + ok + ' nsKeys=' + (window.__h2x ? Object.keys(window.__h2x).join(',') : '无'));
    window.__html2xlsx = null; // 隐藏：防外部残留脚本误退出本会话（本会话经元素引用操作）
    return ok;
  }
  function ui() {
    const hosts = staleHosts();
    const host = hosts[hosts.length - 1];
    if (!host) throw new Error('未找到工具栏 host');
    const sr = host.shadowRoot;
    return {
      host: host, sr: sr,
      exportBtn: sr.querySelector('.h2x-primary'),
      splitBtn: sr.querySelector('.h2x-split'),
      cancelBtn: sr.querySelector('.h2x-ghost'),
      fmtSel: sr.querySelector('.h2x-ext'),
      count: sr.querySelector('.h2x-count b'),
      hint: sr.querySelector('.h2x-hint'),
      hoverBox: sr.querySelector('.h2x-hover')
    };
  }
  const fire = (el, type) => el.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));
  const click = (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  const clickCell = (sel) => click(document.querySelector(sel));
  async function waitExports(n, timeout) {
    const t0 = Date.now();
    while (window.__exports.length < n && Date.now() - t0 < (timeout || 8000)) await sleep(25);
    return window.__exports.slice();
  }
  const csvLines = async (f) => (await f.blob.text()).replace(/^\uFEFF/, '').split('\r\n').filter(x => x !== '');

  /** 解析 xlsx zip 内首个 worksheet XML 的 <cols>（XLSX.read 不回填 !cols，
   *  需手工走本地文件头 + DecompressionStream('deflate-raw')） */
  async function sheetColsXml(buf) {
    const u8 = new Uint8Array(buf);
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let off = 0;
    while (off < u8.length - 30) {
      if (dv.getUint32(off, true) !== 0x04034b50) { off++; continue; } // PK\x03\x04
      const method = dv.getUint16(off + 8, true);
      const csize = dv.getUint32(off + 18, true);
      const nlen = dv.getUint16(off + 26, true);
      const elen = dv.getUint16(off + 28, true);
      const name = new TextDecoder().decode(u8.slice(off + 30, off + 30 + nlen));
      const dataStart = off + 30 + nlen + elen;
      if (/^xl\/worksheets\/sheet\d+\.xml$/.test(name)) {
        let xml;
        if (method === 0) xml = new TextDecoder().decode(u8.subarray(dataStart, dataStart + csize));
        else if (method === 8) {
          const ds = new DecompressionStream('deflate-raw');
          xml = await new Response(new Blob([u8.subarray(dataStart, dataStart + csize)]).stream().pipeThrough(ds)).text();
        } else return null;
        const m = xml.match(/<cols>[\s\S]*?<\/cols>/);
        return m ? m[0] : '';
      }
      off = dataStart + csize;
    }
    return null;
  }

  /** XLSX 全量单元格比对：按 !ref 边界逐格取 {t,v} 展开为网格，与期望二维数组比对。
   *  期望元素：字符串 → t:'s' 文本格；数值 → t:'n' 数值格；null → 该格未写入
   *  （合并延续占位，aoa 为 null 时 aoa_to_sheet 不生成单元格） */
  function sheetGrid(ws) {
    if (!ws['!ref']) return [];
    const rg = XLSX.utils.decode_range(ws['!ref']);
    const grid = [];
    for (let r = rg.s.r; r <= rg.e.r; r++) {
      const row = [];
      for (let c = rg.s.c; c <= rg.e.c; c++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })];
        row.push(cell ? [cell.t, String(cell.v)] : null);
      }
      grid.push(row);
    }
    return grid;
  }
  function gridDiff(got, want) {
    const exp = want.map(row => row.map(w => w == null ? null :
      [typeof w === 'number' ? 'n' : 's', String(w)]));
    if (got.length !== exp.length) return '行数 期望' + exp.length + ' 实际' + got.length;
    for (let r = 0; r < exp.length; r++) {
      if (got[r].length !== exp[r].length) return '第' + (r + 1) + '行列数 期望' + exp[r].length + ' 实际' + got[r].length;
      for (let c = 0; c < exp[r].length; c++) {
        const g = JSON.stringify(got[r][c]), w = JSON.stringify(exp[r][c]);
        if (g !== w) return 'R' + (r + 1) + 'C' + (c + 1) + ' 期望' + w + ' 实际' + g;
      }
    }
    return '';
  }
  const gridEq = (ws, want) => gridDiff(sheetGrid(ws), want);

  /* ---- 轮次串行锁（防并发 harness 实例互相干扰；30 秒陈旧锁自动抢占） ---- */
  const MY = 'h' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  async function acquireLock() {
    const t0 = Date.now();
    while (Date.now() - t0 < 30000) {
      const cur = window.__ROUND_LOCK;
      if (!cur || (Date.now() - cur.at) > 30000 || cur.owner === MY) {
        window.__ROUND_LOCK = { owner: MY, at: Date.now() };
        return true;
      }
      await sleep(150);
    }
    return false;
  }
  function touchLock() { const cur = window.__ROUND_LOCK; if (cur && cur.owner === MY) cur.at = Date.now(); }

  async function round(name, fn) {
    log('=== 轮次开始: ' + name);
    if (!(await acquireLock())) { t('【' + name + '】轮次锁超时', false, ''); return; }
    try {
      window.__exports.length = 0;
      blobMap.clear();
      touchLock();
      if (!(await inject(name))) throw new Error('注入失败（main.js 未初始化）');
      const h = ui();
      log('[' + name + '] 工具栏已定位');
      try { await fn(h, () => touchLock()); }
      finally { try { click(h.cancelBtn); } catch (e) { /* 已退出 */ } await waitFor(() => !document.documentElement.contains(h.host), 1500); }
      log('=== 轮次结束: ' + name);
    } catch (e) {
      t('【' + name + '】轮次执行异常', false, String((e && e.stack) || e));
      log('[' + name + '] 异常: ' + e);
    } finally {
      if (window.__ROUND_LOCK && window.__ROUND_LOCK.owner === MY) window.__ROUND_LOCK = null;
    }
  }

  /* ---- 面板工具（v2.0：拆分勾选改「＋ 拆分」按钮，模式/分隔符收进 .h2x-sub 子行） ---- */
  const rowOf = (h, prefix) => [...h.sr.querySelectorAll('.h2x-col')].find(r => {
    const c = r.querySelector('.h2x-cname');
    return c && c.textContent.indexOf(prefix) === 0;
  });
  const sbtnOf = (r) => r.querySelector('.h2x-sbtn');            // 主行拆分按钮（h2x-on = 已展开）
  const subOf = (r) => r.getRootNode().querySelector('.h2x-sub[data-c="' + r.dataset.c + '"]'); // 对应配置子行
  const ckxOf = (r) => r.querySelector('.h2x-ck-x');
  const modeOf = (r) => { const s = subOf(r); return s && s.querySelector('.h2x-mode'); };
  const patOf = (r) => { const s = subOf(r); return s && s.querySelector('.h2x-pattern'); };
  const fmtOf = (r) => r.querySelector('.h2x-fmt');
  const toastText = (h) => [...h.sr.querySelectorAll('.h2x-toast')].map(x => x.textContent).join('|');

  /* ================= 轮次 A：基础交互 ================= */
  await round('基础交互', async (h) => {
    document.querySelector('#staff td').dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    t('悬浮表格出现蓝色高亮框', h.hoverBox.hidden === false);
    clickCell('#staff td');
    t('点击选中表格（计数=1）', h.count.textContent === '1', h.count.textContent);
    clickCell('#staff td');
    t('再次点击取消选中（计数=0）', h.count.textContent === '0', h.count.textContent);
    clickCell('#staff td');
    clickCell('#controls td');
    t('多表选择（计数=2）', h.count.textContent === '2', h.count.textContent);
    const actParent = h.exportBtn.parentElement;
    t('工具栏三按钮成组同父（换行整组下移，不孤立）', actParent === h.splitBtn.parentElement &&
      actParent === h.cancelBtn.parentElement && actParent.className === 'h2x-actions', actParent.className);
    // v2.4：非表格点击放行 + 断开表格自动剔除 + 链接拦截带 toast
    const staff = document.querySelector('#staff');
    const par = staff.parentElement, nxt = staff.nextSibling;
    staff.remove(); // 模拟页面交互（翻页等）替换/移除已选表格
    const passed = document.querySelector('p').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    t('选择模式下非表格点击放行（不 preventDefault）', passed === true);
    t('被移除的已选表格经放行点击自动剔除（计数 2→1）', h.count.textContent === '1', h.count.textContent);
    t('表格被移除时 toast 提醒（不再静默）', toastText(h).indexOf('已被页面刷新移除') >= 0, toastText(h));
    par.insertBefore(staff, nxt); // 还原 fixture
    const link = document.querySelector('a');
    const notPrevented = link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    t('选择模式下链接点击被拦截（preventDefault + toast 提示）', notPrevented === false && toastText(h).indexOf('链接已停用') >= 0, toastText(h));
    t('被拦链接就地红框高亮（flashLink）', /#c62828|rgb\(198, ?40, ?40\)/.test(link.style.outline), link.style.outline);
    await sleep(1100); // 等 1s 闪烁结束
    t('红框高亮 1s 后还原（页面不留痕）', link.style.outline === '', link.style.outline);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    t('Esc 退出选择模式（UI 移除）', !document.documentElement.contains(h.host));
  });

  /* ================= 轮次 B：CSV 多表导出 + 控件值 ================= */
  await round('CSV 导出与控件值', async (h) => {
    clickCell('#staff td');
    clickCell('#controls td');
    h.fmtSel.value = 'csv'; fire(h.fmtSel, 'change');
    t('格式切换后按钮文案同步（CSV）', h.exportBtn.textContent.indexOf('CSV') >= 0, h.exportBtn.textContent);
    click(h.exportBtn);
    const files = await waitExports(2);
    t('CSV 多表导出 2 个文件（带表名后缀）', files.length === 2 &&
      files[0].name.endsWith('_staff.csv') && files[1].name.endsWith('_controls.csv'),
      files.map(f => f.name).join(' | '));
    const lines = await csvLines(files[0]);
    const exp = ['姓名,部门,入职日期', '张三,研发部,2021-03-15', '李四,市场部,2022-07-01', '王五,财务部,2019-11-20'];
    t('staff 表 CSV 内容（含表头 4 行）', JSON.stringify(lines) === JSON.stringify(exp), JSON.stringify(lines));
    const raw1 = new Uint8Array(await files[0].blob.arrayBuffer());
    t('CSV UTF-8 BOM + CRLF 行尾', raw1[0] === 0xEF && raw1[1] === 0xBB && raw1[2] === 0xBF &&
      (await files[0].blob.text()).indexOf('\r\n') >= 0, 'BOM=' + raw1[0] + ',' + raw1[1] + ',' + raw1[2]);
    const l2 = await csvLines(files[1]);
    const find = (kw) => l2.find(x => x.indexOf(kw) >= 0) || '(未找到)';
    t('控件：文本输入 JS 属性设值实时读', find('文本输入') === '文本输入（JS 设值）,JS设的值,JS设的值', find('文本输入'));
    t('控件：select 单选「显示文本(value)」', find('select 单选') === 'select 单选,已发货(3),已发货(3)', find('select 单选'));
    t('控件：select 多选顿号分隔', find('select 多选,') === 'select 多选,甲(a)、乙(b),甲(a)、乙(b)', find('select 多选,'));
    t('控件：select 多选全未选为空', find('select 多选全未选') === 'select 多选全未选,,(空)', find('select 多选全未选'));
    t('控件：checkbox 勾选/未选→是/否', find('checkbox 勾选') === 'checkbox 勾选,是,是' && find('checkbox 未选') === 'checkbox 未选,否,否', find('checkbox 勾选'));
    t('控件：hidden 输入忽略（空）', find('hidden 输入') === 'hidden 输入（忽略）,,(空)', find('hidden 输入'));
    t('控件：ARIA switch/slider', find('ARIA switch 开') === 'ARIA switch 开,是,是' && find('ARIA slider') === 'ARIA slider,60,60', find('ARIA switch 开'));
    t('控件：el/ant/van 组件开关', find('组件开关 el-switch') === '组件开关 el-switch,是,是' && find('组件开关 ant-switch') === '组件开关 ant-switch,否,否' && find('组件开关 van-switch') === '组件开关 van-switch,是,是', find('组件开关 el-switch'));
    t('控件：listbox/combobox', find('ARIA listbox') === 'ARIA listbox 选中项,乙,乙' && find('combobox') === 'combobox 触发器（innerText 兜底）,已发货,已发货', find('ARIA listbox'));
    t('控件：date/textarea/output', find('date 输入') === 'date 输入,2026-08-25,2026-08-25' && find('textarea') === 'textarea,初始备注,初始备注' && find('output 元素') === 'output 元素,42,42', find('date 输入'));
    t('控件：一格多控件空格连接', find('一格多控件') === '一格多控件（range + color）,70 #ff0000,70 #ff0000', find('一格多控件'));
    t('控件：类名形似非开关回退文本', find('类名含 switch') === '类名含 switch 但非开关（兜底）,排序切换器,排序切换器', find('类名含 switch'));
    t('控件：嵌套开关不重复计数', find('嵌套开关') === '嵌套开关（el-switch 内含 checkbox）,是,是（只输出一次）', find('嵌套开关'));
  });

  /* ================= 轮次 C：XLSX（合并单元格/Sheet名/列宽/文本写入） ================= */
  await round('XLSX 导出', async (h) => {
    clickCell('#staff td');
    click(document.querySelector('table[aria-label="销售数据"] td'));
    click(h.exportBtn);
    const files = await waitExports(1);
    t('xlsx 导出文件生成（.xlsx）', files.length === 1 && /\.xlsx$/i.test(files[0].name), files[0] && files[0].name);
    const ab = await files[0].blob.arrayBuffer();
    const wb = XLSX.read(ab, { type: 'array' });
    t('xlsx 多表多 Sheet（id 与 caption 命名）', JSON.stringify(wb.SheetNames) === JSON.stringify(['staff', '季度销售报表']), JSON.stringify(wb.SheetNames));
    const ws = wb.Sheets['季度销售报表'];
    const merges = (ws['!merges'] || []).length;
    t('xlsx 合并单元格保留（5 处 merge）', merges === 5, 'merges=' + merges);
    const dMerge = gridEq(ws, [
      ['地区', '上半年', null, '下半年', null, '全年合计'],
      [null, 'Q1', 'Q2', 'Q3', 'Q4', null],
      ['华东', '120', '150', '180', '210', '660'],
      ['华南', '100', '110', '125', '140', '475'],
      ['全国总计（跨列合并）', null, null, null, null, '1135']]);
    t('xlsx 合并表全量单元格（30 格：值+类型全文本+合并延续空位）', dMerge === '', dMerge);
    const colsXml = await sheetColsXml(ab);
    const widths = (colsXml && colsXml.match(/width="([\d.]+)"/g) || []).map(s => parseFloat(s.slice(7, -1)));
    // SheetJS 写入 width = wch + 0.832，钳制 [6,50] → width 落在 [6.8, 50.9]
    t('xlsx 自适应列宽写入（<cols> customWidth，钳制 6~50）', !!colsXml && colsXml.indexOf('customWidth') >= 0 &&
      widths.length > 0 && widths.every(w => w >= 6.5 && w <= 51), (colsXml || '(无)').slice(0, 120));
    const dStaff = gridEq(wb.Sheets['staff'], [
      ['姓名', '部门', '入职日期'],
      ['张三', '研发部', '2021-03-15'],
      ['李四', '市场部', '2022-07-01'],
      ['王五', '财务部', '2019-11-20']]);
    t('xlsx staff 表全量单元格（12 格：值+类型全文本 t:s）', dStaff === '', dStaff);
  });

  /* ================= 轮次 D：列拆分配置 + 保存 ================= */
  await round('列拆分配置与保存', async (h) => {
    clickCell('#split td');
    click(h.splitBtn);
    await waitFor(() => h.sr.querySelector('.h2x-mask')); // openPanel 为 async（persist.ready 后才建面板）
    const mask = h.sr.querySelector('.h2x-mask');
    t('列设置面板打开（role=dialog aria-modal）', !!mask && mask.getAttribute('role') === 'dialog' && mask.getAttribute('aria-modal') === 'true');
    const rTitle = rowOf(h, '标题/产品ID'), rPrice = rowOf(h, '一口价'), rSku = rowOf(h, '秒杀价/库存'), rWh = rowOf(h, '发货仓'), rSite = rowOf(h, '适用站点');
    t('智能预填：多行文本列默认不展开（v2.1 默认不拆分）', !!rTitle && !sbtnOf(rTitle).classList.contains('h2x-on'));
    t('智能预填：控件列默认不展开拆分', !!rPrice && !sbtnOf(rPrice).classList.contains('h2x-on'));
    click(sbtnOf(rTitle)); // v2.1 默认不拆分：手动展开验证预设（保持后续轮次最终态不变）
    t('智能预填：多行文本列展开后预设「按换行拆分」', modeOf(rTitle).value === 'block', modeOf(rTitle) && modeOf(rTitle).value);
    // 全列预览（默认态：6 原列全部显示 + 标题/产品ID 的 2 个新列 = 8 列）
    const pvHead = () => [...mask.querySelectorAll('.h2x-pv-body thead th')].map(x => x.textContent);
    t('全列预览：未拆列也显示（8 列最终序）', JSON.stringify(pvHead()) === JSON.stringify(
      ['商品', '标题/产品ID', '标题/产品ID1', '标题/产品ID2', '一口价', '秒杀价/库存', '发货仓', '适用站点']), JSON.stringify(pvHead()));
    t('全列预览：新列绿色标记（标题/产品ID1/2）', [...mask.querySelectorAll('.h2x-pv-body thead th')].filter(x => x.classList.contains('new')).length === 2);
    t('全列预览：数据行取前 3 行 + 尾注行数', mask.querySelectorAll('.h2x-pv-body tbody tr').length === 3 &&
      mask.querySelector('.h2x-pv-note').textContent.indexOf('行数据') >= 0, mask.querySelector('.h2x-pv-note').textContent);
    // 折叠循环：展开 → 预设控件值拆分 → 收起 → 子行移除 → 再展开
    click(sbtnOf(rPrice));
    t('智能预填：控件列展开后预设「控件值拆分」', modeOf(rPrice).value === 'control', modeOf(rPrice) && modeOf(rPrice).value);
    click(sbtnOf(rPrice));
    t('折叠循环：收起后子行移除', !subOf(rPrice));
    click(sbtnOf(rPrice)); // 再展开（保持与旧轮次一致的最终态：5 列全拆分）
    // 其余列展开拆分
    [rSku, rWh, rSite].forEach(r => click(sbtnOf(r)));
    t('智能预填：纯文本列分隔符探测（、）', patOf(rSite).value === '、', patOf(rSite) && patOf(rSite).value);
    t('面板预览实时刷新（新列子行出现）', h.sr.querySelectorAll('.h2x-sub').length >= 5, 'subs=' + h.sr.querySelectorAll('.h2x-sub').length);
    click(mask.querySelector('.h2x-save'));
    t('面板保存后关闭且 toast「已保存并记住」', !h.sr.querySelector('.h2x-mask') && toastText(h).indexOf('已保存') >= 0, toastText(h));
    await sleep(2700);
    t('成功 toast 2.5s 后自动消失', h.sr.querySelectorAll('.h2x-toast').length === 0, toastText(h));
  });

  /* ================= 轮次 E：持久化恢复 + 拆分导出校验 ================= */
  await round('持久化恢复与拆分导出', async (h) => {
    clickCell('#split td');
    t('重选同表自动恢复（toast 提示）', toastText(h).indexOf('已恢复上次的列设置') >= 0, toastText(h));
    h.fmtSel.value = 'csv'; fire(h.fmtSel, 'change');
    click(h.exportBtn);
    const files = await waitExports(1);
    const lines = await csvLines(files[0]);
    const expHead = '商品,标题/产品ID,标题/产品ID1,标题/产品ID2,一口价,一口价_控件,一口价_文本,秒杀价/库存,秒杀价/库存_控件1,秒杀价/库存_控件2,秒杀价/库存_文本,发货仓,发货仓_控件,发货仓_文本,适用站点,适用站点1,适用站点2,适用站点3'.split(',');
    t('拆分后表头（原列保留 + 新列追加，18 列）', JSON.stringify(lines[0].split(',')) === JSON.stringify(expHead), lines[0]);
    const r1 = lines[1].split(',');
    t('拆分行1：换行拆分（标题/产品ID 各一列，块内空格不拆）', r1[1] === 'Dress Blue Style 1731340859035700001' && r1[2] === 'Dress Blue Style' && r1[3] === '1731340859035700001', r1.slice(1, 4).join('|'));
    t('拆分行1：控件值拆分（一口价 2249 / PHP）', r1[4] === '2249 PHP' && r1[5] === '2249' && r1[6] === 'PHP', r1.slice(4, 7).join('|'));
    t('拆分行1：同格双控件各自成列（99/10）', r1[7] === '99 / 10' && r1[8] === '99' && r1[9] === '10' && r1[10] === '/', r1.slice(7, 11).join('|'));
    t('拆分行1：发货仓控件列', r1[11] === '华东仓(1)' && r1[12] === '华东仓(1)' && r1[13] === '', r1.slice(11, 14).join('|'));
    t('拆分行1：分隔符拆分 + 段数不足补空', r1[14] === '美国、英国' && r1[15] === '美国' && r1[16] === '英国' && r1[17] === '', r1.slice(14).join('|'));
    const r2 = lines[2].split(',');
    t('拆分行2：参差行对齐（适用站点3=德国）', r2[16] === '英国' && r2[17] === '德国', r2.slice(14).join('|'));
  });

  /* ================= 轮次 F：重置路径（清空规则回落默认，零回归） ================= */
  await round('重置路径', async (h) => {
    clickCell('#split td'); // 恢复
    click(h.splitBtn);
    await waitFor(() => h.sr.querySelector('.h2x-mask')); // openPanel 为 async
    const mask = h.sr.querySelector('.h2x-mask');
    [rowOf(h, '标题/产品ID'), rowOf(h, '一口价'), rowOf(h, '秒杀价/库存'), rowOf(h, '发货仓'), rowOf(h, '适用站点')].forEach(r => {
      if (sbtnOf(r).classList.contains('h2x-on')) click(sbtnOf(r)); // 收起 = 取消拆分
    });
    t('全部拆分收起后无子行', h.sr.querySelectorAll('.h2x-sub').length === 0, 'subs=' + h.sr.querySelectorAll('.h2x-sub').length);
    click(mask.querySelector('.h2x-save'));
    await waitFor(() => !h.sr.querySelector('.h2x-mask')); // 面板关闭
    click(h.cancelBtn); // 主动退出（round finally 会再兜底）
    await waitFor(() => !document.documentElement.contains(h.host)); // 退出完成
  });
  await round('重置后回落默认（v1.2 零回归）', async (h) => {
    clickCell('#split td');
    t('重置后不再恢复提示', toastText(h).indexOf('已恢复') < 0, toastText(h));
    h.fmtSel.value = 'csv'; fire(h.fmtSel, 'change');
    click(h.exportBtn);
    const files = await waitExports(1);
    const lines = await csvLines(files[0]);
    t('重置后导出 6 原列（零回归）', lines[0] === '商品,标题/产品ID,一口价,秒杀价/库存,发货仓,适用站点', lines[0]);
    const r1 = lines[1].split(',');
    t('重置后单元格归一化文本（v1.2 行为）', r1[1] === 'Dress Blue Style 1731340859035700001' && r1[2] === '2249 PHP' && r1[4] === '华东仓(1)', lines[1]);
  });

  /* ================= 轮次 G：列筛选 ================= */
  await round('列筛选', async (h) => {
    clickCell('#colfilter td');
    click(h.splitBtn);
    await waitFor(() => h.sr.querySelector('.h2x-mask')); // openPanel 为 async
    const mask = h.sr.querySelector('.h2x-mask');
    const tools = () => mask.querySelector('.h2x-exp-n').textContent;
    t('列筛选默认全选（v2.1 默认不拆分：5 原列）', tools() === '5/5', tools());
    click(sbtnOf(rowOf(h, '标题/产品ID'))); // v2.1 默认不拆分：展开（预设按换行）后进入拆分新列语境
    t('列筛选默认全选（5 原列 + 拆分 2 新列 = 7/7）', tools() === '7/7', tools());
    click(mask.querySelector('.h2x-none'));
    click(mask.querySelector('.h2x-save'));
    t('「全不选」保存被拦截（至少保留一个导出列）', mask.querySelector('.h2x-err').textContent.indexOf('至少保留一个') >= 0, mask.querySelector('.h2x-err').textContent);
    click(mask.querySelector('.h2x-all'));
    t('「全选」恢复 7/7', tools() === '7/7', tools());
    [rowOf(h, '状态'), rowOf(h, '操作日志')].forEach(r => { ckxOf(r).checked = false; fire(ckxOf(r), 'change'); });
    t('取消勾选后导出列计数 5/7', tools() === '5/7', tools());
    click(mask.querySelector('.h2x-save'));
    h.fmtSel.value = 'csv'; fire(h.fmtSel, 'change');
    click(h.exportBtn);
    const files = await waitExports(1);
    const lines = await csvLines(files[0]);
    t('列筛选导出（排除状态/操作日志，5 列）', lines[0] === '订单号,标题/产品ID,标题/产品ID1,标题/产品ID2,金额', lines[0]);
    t('列筛选行数不变（3 数据行）', lines.length === 4, 'rows=' + lines.length);
  });

  /* ================= 轮次 H：拆分子列独立筛选 ================= */
  await round('拆分子列筛选', async (h) => {
    clickCell('#colfilter td'); // 恢复上轮保存的筛选
    click(h.splitBtn);
    await waitFor(() => h.sr.querySelector('.h2x-mask')); // openPanel 为 async
    const mask = h.sr.querySelector('.h2x-mask');
    const rTitle = rowOf(h, '标题/产品ID');
    ckxOf(rTitle).checked = false; fire(ckxOf(rTitle), 'change'); // 原列不导出
    const sub2 = mask.querySelector('.h2x-sub .h2x-ck-s[data-k="2"]');
    sub2.checked = false; fire(sub2, 'change'); // 产品ID 新列不导出
    click(mask.querySelector('.h2x-save'));
    h.fmtSel.value = 'csv'; fire(h.fmtSel, 'change');
    click(h.exportBtn);
    const files = await waitExports(1);
    const lines = await csvLines(files[0]);
    t('原列+子列独立筛选（3 列）', lines[0] === '订单号,标题/产品ID1,金额', lines[0]);
    const r1 = lines[1].split(',');
    t('子列筛选后数据对齐', r1[0] === 'SO-1001' && r1[1] === 'Dress Blue Style' && r1[2] === '4722', lines[1]);
  });

  /* ================= 轮次 I：列格式（数字）CSV ================= */
  await round('列格式 CSV', async (h) => {
    clickCell('#colfmt td');
    click(h.splitBtn);
    await waitFor(() => h.sr.querySelector('.h2x-mask')); // openPanel 为 async
    const mask = h.sr.querySelector('.h2x-mask');
    [rowOf(h, '数量'), rowOf(h, '金额')].forEach(r => { fmtOf(r).value = 'number'; fire(fmtOf(r), 'change'); });
    click(mask.querySelector('.h2x-save'));
    h.fmtSel.value = 'csv'; fire(h.fmtSel, 'change');
    click(h.exportBtn);
    const files = await waitExports(1);
    const lines = await csvLines(files[0]);
    const exp = ['订单号,数量,金额,备注', 'SO-2001,1234,4722.5,含千分位逗号', 'SO-2002,56,1899,普通数字', 'SO-2003,12 件,待定,解析失败应保持原文本'];
    t('数字格式 CSV（千分位剥离/解析失败保原文本/表头不动）', JSON.stringify(lines) === JSON.stringify(exp), JSON.stringify(lines));
  });

  /* ================= 轮次 J：列格式 XLSX（持久化恢复 + 数值写入） ================= */
  await round('列格式 XLSX', async (h) => {
    clickCell('#colfmt td');
    t('列格式持久化恢复提示（toast）', toastText(h).indexOf('已恢复') >= 0, toastText(h));
    click(h.exportBtn);
    const files = await waitExports(1);
    const wb = XLSX.read(await files[0].blob.arrayBuffer(), { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const d = gridEq(ws, [
      ['订单号', '数量', '金额', '备注'],
      ['SO-2001', 1234, 4722.5, '含千分位逗号'],
      ['SO-2002', 56, 1899, '普通数字'],
      ['SO-2003', '12 件', '待定', '解析失败应保持原文本']]);
    t('xlsx 数字格式全量单元格（16 格：数值格 t:n/失败保文本/表头不动）', d === '', d);
  });

  /* ================= 轮次 K：图片链接导出 ================= */
  await round('图片链接导出', async (h) => {
    clickCell('#imgs td');
    h.fmtSel.value = 'csv'; fire(h.fmtSel, 'change');
    click(h.exportBtn);
    const files = await waitExports(1);
    const lines = await csvLines(files[0]);
    const find = (kw) => lines.find(x => x.indexOf(kw) >= 0) || '(未找到)';
    t('图片导出绝对链接', find('纯图片') === '纯图片,https://cdn.example.com/p1.png,https://cdn.example.com/p1.png', find('纯图片'));
    t('图片+文字空格连接', find('图片+文字') === '图片+文字,https://cdn.example.com/p2.png 2249 PHP,https://cdn.example.com/p2.png 2249 PHP', find('图片+文字'));
    t('无链接图片导出为空', find('无链接图片') === '无链接图片,,（空）', find('无链接图片'));
    t('控件实时值与图片链接共存', find('控件+图片') === '控件+图片,99 https://cdn.example.com/p3.png,99 https://cdn.example.com/p3.png', find('控件+图片'));
    t('双行格含图归一化', find('双行格含图') === '双行格含图,https://cdn.example.com/p4.png 标题A,按换行拆分：p4 链接 / 标题A 各成一列', find('双行格含图'));
  });

  /* ================= 轮次 L：分体表格（el-table 复刻） ================= */
  await round('分体表格', async (h) => {
    const wrap = document.querySelector('#eltable');
    document.querySelector('#eltable .el-table__header th').dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    const bw = parseFloat(h.hoverBox.style.width), bh = parseFloat(h.hoverBox.style.height);
    t('悬浮表头：高亮框覆盖整个 el-table（宽）', Math.abs(bw - wrap.offsetWidth) < 10, bw + ' vs ' + wrap.offsetWidth);
    t('悬浮表头：高亮框覆盖整个 el-table（高）', bh >= wrap.offsetHeight - 12 && bh <= wrap.offsetHeight + 12, bh + ' vs ' + wrap.offsetHeight);
    const elBw = document.querySelector('#eltable .el-table__body-wrapper');
    elBw.scrollLeft = 120;
    elBw.dispatchEvent(new Event('scroll', { bubbles: true }));
    document.querySelector('#eltable .el-table__body td').dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    const bw2 = parseFloat(h.hoverBox.style.width);
    t('水平滚动后表体仍与表头配为同一张表', Math.abs(bw2 - wrap.offsetWidth) < 10, bw2 + ' vs ' + wrap.offsetWidth);
    clickCell('#eltable .el-table__body td');
    t('分体表一次点选整体选中（计数=1）', h.count.textContent === '1', h.count.textContent);
    h.fmtSel.value = 'csv'; fire(h.fmtSel, 'change');
    click(h.exportBtn);
    const files = await waitExports(1);
    const lines = await csvLines(files[0]);
    t('分体表导出 5 列（gutter 占位列不导出）', lines[0] === '商品,标题/产品ID,本地展示价,一口价,发货仓', lines[0]);
    t('分体表 6 数据行 + 表头', lines.length === 7, 'rows=' + lines.length);
    const r1 = lines[1].split(',');
    t('分体表一口价 JS 实时值（2249 PHP）', r1[3] === '2249 PHP', r1[3]);
    t('分体表发货仓控件值（华东仓(1)）', r1[4] === '华东仓(1)', r1[4]);
    const r6 = lines[6].split(',');
    t('分体表末行实时值（1269 PHP）', r6[3] === '1269 PHP', r6[3]);
  });

  /* ================= 轮次 P：页签 + 就地错误 + focus trap（v2.0 面板） ================= */
  await round('页签与就地错误', async (h) => {
    clickCell('#staff td');
    clickCell('#controls td');
    click(h.splitBtn);
    await waitFor(() => h.sr.querySelector('.h2x-mask')); // openPanel 为 async
    const mask = h.sr.querySelector('.h2x-mask');
    t('面板打开（多表页签 2 个，role=tab）', mask.querySelectorAll('.h2x-tab').length === 2 &&
      mask.querySelector('.h2x-tab').getAttribute('role') === 'tab', mask.querySelectorAll('.h2x-tab').length);
    t('面板打开自动聚焦首个页签', mask.querySelector('.h2x-tab') === h.sr.activeElement,
      h.sr.activeElement && h.sr.activeElement.className);
    let tabs = [...mask.querySelectorAll('.h2x-tab')];
    t('未配置表页签无状态点', tabs.every(x => x.querySelector('.h2x-tab-dot').classList.contains('h2x-off')));
    // focus trap：Tab 在首/末元素间圈定（面板内不出走）
    const focusables = () => [...mask.querySelectorAll('button:not(:disabled),select:not(:disabled),input:not(:disabled)')];
    focusables()[focusables().length - 1].focus();
    mask.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    await sleep(20);
    t('focus trap：Tab 从末元素圈回首元素', h.sr.activeElement === focusables()[0], h.sr.activeElement && h.sr.activeElement.className);
    focusables()[0].focus();
    mask.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
    await sleep(20);
    t('focus trap：Shift+Tab 从首元素圈回末元素', h.sr.activeElement === focusables()[focusables().length - 1], h.sr.activeElement && h.sr.activeElement.className);
    // 页签切换（renderPanel 重建后重查 tabs）
    click(tabs[1]);
    t('页签点击切换到第 2 表（staff 列消失）', !rowOf(h, '姓名') && mask.querySelectorAll('.h2x-col').length > 0);
    tabs = [...mask.querySelectorAll('.h2x-tab')];
    t('切换后目标页签高亮', tabs[1].classList.contains('h2x-tab-on') && !tabs[0].classList.contains('h2x-tab-on'));
    click(mask.querySelector('.h2x-tab'));
    t('页签切回第 1 表（姓名列回来）', !!rowOf(h, '姓名'));
    // 就地错误：姓名列展开（delimiter 预设空分隔符）保存 → 输入框标红 + 底部汇总
    const rName = rowOf(h, '姓名');
    click(sbtnOf(rName));
    click(mask.querySelector('.h2x-save'));
    const errEl = mask.querySelector('.h2x-err');
    t('空分隔符保存被拦截（就地标红 + 汇总计数）', patOf(rName).classList.contains('h2x-invalid') &&
      errEl.textContent.indexOf('1 项配置有误') >= 0, errEl.textContent);
    patOf(rName).value = '、';
    fire(patOf(rName), 'input');
    t('重新输入清除错误标红', !patOf(rName).classList.contains('h2x-invalid'));
    // 保存有效配置 → 页签状态点亮；再收起保存（空配置）→ 状态点灭（零污染收尾）
    click(mask.querySelector('.h2x-save'));
    t('保存有效配置后面板关闭', !h.sr.querySelector('.h2x-mask'));
    click(h.splitBtn);
    await waitFor(() => h.sr.querySelector('.h2x-mask'));
    const mask2 = h.sr.querySelector('.h2x-mask');
    t('保存后重开面板：staff 页签状态点亮', mask2.querySelectorAll('.h2x-tab')[0].querySelector('.h2x-tab-dot').classList.contains('h2x-off') === false);
    click(sbtnOf(rowOf(h, '姓名'))); // 收起拆分
    click(mask2.querySelector('.h2x-save'));
    click(h.splitBtn);
    await waitFor(() => h.sr.querySelector('.h2x-mask'));
    const mask3 = h.sr.querySelector('.h2x-mask');
    t('空配置保存后页签状态点灭（重置路径）', mask3.querySelectorAll('.h2x-tab')[0].querySelector('.h2x-tab-dot').classList.contains('h2x-off'));
    click(mask3.querySelector('.h2x-pcancel'));
  });

  /* ================= 轮次 Q：导出保留选择 + toast 退出（v2.0） ================= */
  await round('导出保留选择与 toast 退出', async (h) => {
    clickCell('#staff td');
    h.fmtSel.value = 'csv'; fire(h.fmtSel, 'change');
    click(h.exportBtn);
    const files = await waitExports(1);
    t('导出成功（首个文件，单表 CSV 无表名后缀）', files.length === 1 && /\.csv$/i.test(files[0].name), files.map(f => f.name).join('|'));
    t('导出后选择保留（计数仍 1，UI 仍在）', h.count.textContent === '1' && document.documentElement.contains(h.host), 'count=' + h.count.textContent);
    t('导出成功 toast（含下载与退出动作）', toastText(h).indexOf('下载') >= 0 && toastText(h).indexOf('退出') >= 0, toastText(h));
    click(h.exportBtn); // 连续第二次导出（重入保护 + 选择仍在）
    const files2 = await waitExports(2);
    t('保留选择后可连续导出（累计 2 个文件）', files2.length === 2, 'files=' + files2.length);
    const exitBtn = [...h.sr.querySelectorAll('.h2x-toast-btn')].find(b => b.textContent === '退出');
    t('toast 提供「退出」动作按钮', !!exitBtn);
    click(exitBtn);
    await waitFor(() => !document.documentElement.contains(h.host), 1500); // exit 同步清理
    t('点击 toast「退出」后 UI 移除', !document.documentElement.contains(h.host));
  });

  /* ================= 轮次 M/N/O：JSON / MD / HTML ================= */
  await round('JSON 导出', async (h) => {
    clickCell('#staff td');
    h.fmtSel.value = 'json'; fire(h.fmtSel, 'change');
    click(h.exportBtn);
    const files = await waitExports(1);
    const j = JSON.parse(await files[0].blob.text());
    t('JSON 单表 = 行对象数组（3 行）', Array.isArray(j) && j.length === 3);
    t('JSON 列名取表头、值正确', j[0]['姓名'] === '张三' && j[2]['入职日期'] === '2019-11-20', JSON.stringify(j[0]));
  });
  await round('Markdown 导出', async (h) => {
    clickCell('#staff td');
    h.fmtSel.value = 'md'; fire(h.fmtSel, 'change');
    click(h.exportBtn);
    const files = await waitExports(1);
    const s = await files[0].blob.text();
    const ls = s.split('\n').filter(x => x !== '');
    // 结构：'## staff' 表名标题 + 空行(滤除) + 表头 + 分隔行 + 3 数据行
    t('MD GFM 表格结构（表名标题+表头+分隔行+3 数据行）', ls.length === 6 && ls[0].indexOf('staff') >= 0 &&
      ls[1].indexOf('姓名') >= 0 && ls[2].indexOf('-') >= 0 && ls[5].indexOf('王五') >= 0, ls.slice(0, 2).join(' // '));
  });
  await round('HTML 导出', async (h) => {
    clickCell('#staff td');
    h.fmtSel.value = 'html'; fire(h.fmtSel, 'change');
    click(h.exportBtn);
    const files = await waitExports(1);
    const s = await files[0].blob.text();
    t('HTML 完整文档（DOCTYPE + thead + 数据）', s.indexOf('<!DOCTYPE') >= 0 && s.toLowerCase().indexOf('<thead') >= 0 && s.indexOf('王五') >= 0, s.slice(0, 80));
    t('HTML 文件名 .html 扩展名', /\.html$/i.test(files[0].name), files[0].name);
  });

  log('=== harness 完成: ' + R.length + ' 项');
  return { total: R.length, passed: R.filter(x => x.pass).length, results: R, logTail: window.__TEST_LOG.slice(-20) };
})();
