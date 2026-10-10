/**
 * 持久化模块：拆分规则/列筛选/列格式/列顺序（v1.7 起，v1.9 增列格式，v2.8 增列顺序与
 * 跨设备同步）+ 界面偏好（v2.9）与手动翻页按钮记忆（v2.9）——后两者原在 main.js，
 * 因其纯存储面（无 DOM 应用逻辑）迁入本模块集中管理，main.js 只留渲染与会话守卫
 * - 列设置：chrome.storage.local（真相源）+ chrome.storage.sync（镜像）
 * - 页面键 = origin + pathname（忽略 query/hash：分页/筛选参数不拆散同一份配置）
 * - 表指纹 = 表头单元格文本归一化后以 \u0001 拼接（thead 无 tr 的组件库写法兼容；
 *   指纹绝不取数据行——虚拟滚动数据行动态渲染会不稳定）；保存与恢复同用本函数
 *   取 DOM 表头（同源保证一致），表头变更 → 指纹不匹配 → 不恢复（规则解析另有防御）
 * - 会话内存 records 是唯一恢复源：注入时预载当前页面记录（local 与 sync 各读一次，
 *   按表逐条取 updatedAt 更新者，实现跨设备同步）；面板保存时同步更新内存并异步落盘
 *   （fire-and-forget，失败仅告警，降级为当次会话有效）
 * - 页面条目上限：local 50（LRU 淘汰，页面最新时间 = 其各表记录 updatedAt 最大值）；
 *   sync 20 且单项 ≤ 7KB（超出该页不镜像——sync 单项硬上限 8KB，宁可不同步也不报错）
 * - 纯函数（pageKeyOf/tableKeyOf/sanitizeRecord/evictKeys）挂 ns.persist 供
 *   algo-check.cjs 离线回归；chrome/location 引用均有守卫（Node 可整文件加载）
 * 依赖：entry（__h2x 命名空间）；无其他模块依赖（virtual 之后、panel 之前注入）
 */
(() => {
  'use strict';
  const ns = window.__h2x;

  const KEY_PREFIX = 'h2x.v1:p:'; // 页面存储键前缀（含存储结构版本号）
  const PAGE_LIMIT = 50;          // local 页面条目上限（LRU 淘汰）
  const SYNC_PAGE_LIMIT = 20;     // sync 页面条目上限（sync 总配额 100KB，另受单项 8KB 限制）
  const SYNC_ITEM_MAX = 7000;     // sync 单项镜像体积上限（字节，留 8KB 上限余量）
  const RULE_MODES = ['control', 'block', 'delimiter'];
  const FMT_VALUES = ['number'];  // 可持久化的列格式（文本为默认行为，无需存储）

  // 归一化（与 cell.js normText 同规则）：nbsp → 空格、连续空白 → 单空格、去首尾
  const normText = (s) => (s || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();

  const hasStorage = () =>
    typeof chrome !== 'undefined' && !!(chrome.storage && chrome.storage.local);

  /** 跨设备同步区（v2.8）：未登录/未启用 sync 时静默降级（只走 local） */
  const hasSync = () =>
    typeof chrome !== 'undefined' && !!(chrome.storage && chrome.storage.sync);

  /** 页面键（纯函数）：origin + pathname，忽略 query/hash；解析失败返回 null */
  function pageKeyOf(url) {
    try {
      const u = new URL(url);
      return u.origin + u.pathname;
    } catch (e) {
      return null;
    }
  }

  // 当前页面键：注入时求值一次（Node 测试环境无 location，捕获后为 null → 持久化整体降级）
  let pageKey = null;
  try { pageKey = pageKeyOf(location.href); } catch (e) { /* 无 location 环境 */ }

  /** 表头单元格列表：thead 存在 → 其 tr 的 cells（跳过空占位 tr；兼容 thead
   *  直接嵌 th 无 tr 的组件库写法，如 vxe-table）；无 thead → table.rows 首个
   *  非空行兜底。与 table.js rowsOfTable 的表头语义一致（指纹绝不能落在数据行：
   *  虚拟滚动表格数据行动态渲染，保存与恢复时首行不同会导致指纹不稳定），
   *  但本模块保持零依赖不引 table.js，故内联等价实现 */
  function headerCellsOf(t) {
    if (t.tHead) {
      const trs = t.tHead.querySelectorAll('tr');
      if (trs.length) {
        for (const tr of trs) if (tr.cells.length) return tr.cells;
      } else {
        const cells = [];
        for (const el of t.tHead.children) {
          if (el.tagName === 'TH' || el.tagName === 'TD') cells.push(el);
        }
        if (cells.length) return cells;
      }
    }
    for (let i = 0; i < t.rows.length; i++) {
      if (t.rows[i].cells.length) return t.rows[i].cells;
    }
    return null;
  }

  /** 表指纹：逻辑表格根（table 或分体包装容器）内部首个 table 的表头单元格
   *  文本归一化后以 \u0001 拼接；无 table / 无表头行返回 null（表头异步未渲染等，
   *  不参与持久化）。分体结构（Element Plus / vxe-table / Ant Design Vue）取容器
   *  内首个 table 即表头表，表头不随滚动变化故指纹稳定；同页两表指纹相同（表头
   *  完全一致）共享一份配置，属可接受降级。div 网格表格（el-table-v2 / AG Grid /
   *  MUI X DataGrid / Tabulator）无 table 结构，经 ns.table.gridHeaderCellsOf
   *  适配器分发取表头格（table.js 先注入；algo-check Node 环境以 preNs 注入，
   *  缺失时回落内部 table 查找） */
  function tableKeyOf(root) {
    if (!root) return null;
    let cells = null;
    if (root.tagName === 'TABLE') {
      cells = headerCellsOf(root);
    } else {
      if (ns.table && typeof ns.table.gridHeaderCellsOf === 'function') {
        const gridCells = ns.table.gridHeaderCellsOf(root);
        if (gridCells && gridCells.length) cells = gridCells;
      }
      if (!cells && typeof root.querySelector === 'function') {
        const t = root.querySelector('table');
        if (t && t.rows) cells = headerCellsOf(t);
      }
    }
    if (!cells) return null;
    const parts = [];
    for (let i = 0; i < cells.length; i++) {
      parts.push(normText(cells[i].textContent));
    }
    return parts.join('\u0001');
  }

  /** 存储记录校验/规整（纯函数）：损坏字段剔除、类型归位；全空返回 null。
   *  rules 各项归一为 { col, mode, pattern, limit }；excluded 保留字符串或数字
   *  （列序号兜底的列键是数字）；formats 为 [列键, 格式] 键值对数组（键值对而非
   *  对象——对象键只能是字符串，数字列键 0 会被串化成 '0' 而错位）；
   *  order（v2.8 列顺序）为列键有序数组，同样保留字符串/数字；
   *  updatedAt 缺损记 0 */
  function sanitizeRecord(rec) {
    if (!rec || typeof rec !== 'object') return null;
    const rules = (Array.isArray(rec.rules) ? rec.rules : [])
      .filter(r => r && RULE_MODES.indexOf(r.mode) >= 0 && r.col != null)
      .map(r => ({
        col: r.col,
        mode: r.mode,
        pattern: r.pattern == null ? '' : String(r.pattern),
        limit: (typeof r.limit === 'number' && r.limit >= 2) ? r.limit : null
      }));
    const excluded = (Array.isArray(rec.excluded) ? rec.excluded : [])
      .filter(k => (typeof k === 'string' && k !== '') || typeof k === 'number');
    const formats = (Array.isArray(rec.formats) ? rec.formats : [])
      .filter(p => Array.isArray(p) && p.length === 2 &&
        ((typeof p[0] === 'string' && p[0] !== '') || typeof p[0] === 'number') &&
        FMT_VALUES.indexOf(p[1]) >= 0)
      .map(p => [p[0], p[1]]);
    const order = (Array.isArray(rec.order) ? rec.order : [])
      .filter(k => (typeof k === 'string' && k !== '') || typeof k === 'number');
    if (!rules.length && !excluded.length && !formats.length && !order.length) return null;
    return {
      rules: rules, excluded: excluded, formats: formats, order: order,
      updatedAt: Number(rec.updatedAt) || 0
    };
  }

  /** LRU 淘汰（纯函数）：输入全量存储快照与当前页键，返回应删除的页面键列表。
   *  页面最新时间 = 其各表记录 updatedAt 最大值（损坏页记 0 最先淘汰）；
   *  当前页豁免；写入后总数（其余页 + 当前页 1）超 limit 时从最旧开始删 */
  function evictKeys(all, currentKey, limit) {
    const pages = [];
    for (const k of Object.keys(all || {})) {
      if (typeof k !== 'string' || k.indexOf(KEY_PREFIX) !== 0 || k === currentKey) continue;
      const page = all[k];
      let latest = 0;
      if (page && typeof page === 'object') {
        for (const key in page) {
          const t = (page[key] && Number(page[key].updatedAt)) || 0;
          if (t > latest) latest = t;
        }
      }
      pages.push({ k: k, latest: latest });
    }
    const need = pages.length + 1 - limit;
    if (need <= 0) return [];
    pages.sort((a, b) => a.latest - b.latest);
    return pages.slice(0, need).map(p => p.k);
  }

  /* ---------------- 会话内存（唯一恢复源）与存储读写 ---------------- */

  const records = new Map(); // 表指纹 -> { rules, excluded: [], formats: [], updatedAt }
  let readyPromise = null;   // 预载 Promise（无存储/无页面键时为 null，ready() 直接通过）
  let writeChain = Promise.resolve(); // 落盘串行链（后写覆盖前写，避免乱序回退）
  let writePending = false;  // 待写标志：突发连写（如多表保存）合并为一次落盘

  const storageKey = () => KEY_PREFIX + pageKey;

  /** 注入时预载当前页面记录进会话内存：local 与 sync 各读一次，按表逐条取
   *  updatedAt 更新者（跨设备同步：另一台机器改过的配置胜出）；sync 不可用
   *  （未登录/未授权）时只有 local，行为与旧版完全一致 */
  function loadRecords() {
    if (!pageKey) return;
    const areas = [];
    if (hasStorage()) areas.push(chrome.storage.local);
    if (hasSync()) areas.push(chrome.storage.sync);
    if (!areas.length) return;
    readyPromise = (async () => {
      const sk = storageKey();
      for (const area of areas) {
        try {
          const stored = await area.get(sk);
          const page = stored && stored[sk];
          if (!page || typeof page !== 'object') continue;
          for (const key of Object.keys(page)) {
            const rec = sanitizeRecord(page[key]);
            if (!rec) continue;
            const cur = records.get(key);
            if (!cur || rec.updatedAt > cur.updatedAt) records.set(key, rec);
          }
        } catch (e) {
          console.warn('[HTML2XLSX] 持久化配置读取失败（降级为当次会话有效）：', e);
        }
      }
    })();
  }

  /** 存储加载就绪（兜底注入初期的毫秒级竞态；失败已内部吞掉，必定 resolve） */
  function ready() {
    return readyPromise || Promise.resolve();
  }

  /** 读取某表已保存配置：{ rules, excluded: Set, formats: Map, order: [] } 或 null（无记录/指纹无效） */
  function getSaved(table) {
    const key = tableKeyOf(table);
    if (!key) return null;
    const rec = records.get(key);
    if (!rec) return null;
    return {
      rules: rec.rules, excluded: new Set(rec.excluded),
      formats: new Map(rec.formats), order: (rec.order || []).slice()
    };
  }

  /** 保存某表配置（面板「保存」后调用）：同步更新会话内存（本会话恢复源），异步
   *  落盘 fire-and-forget。rules / excluded / formats / order 均空 = 重置：删除该表记录 */
  function save(table, rules, excluded, formats, order) {
    const key = tableKeyOf(table);
    if (!key || !pageKey) return;
    const fmtPairs = [];
    for (const [k, v] of (formats || new Map())) {
      if (FMT_VALUES.indexOf(v) >= 0) fmtPairs.push([k, v]);
    }
    const ord = (Array.isArray(order) ? order : [])
      .filter(k => (typeof k === 'string' && k !== '') || typeof k === 'number');
    if ((rules && rules.length) || (excluded && excluded.size) || fmtPairs.length || ord.length) {
      records.set(key, {
        rules: (rules || []).map(r => ({
          col: r.col,
          mode: r.mode,
          pattern: r.pattern == null ? '' : String(r.pattern),
          limit: (typeof r.limit === 'number' && r.limit >= 2) ? r.limit : null
        })),
        excluded: Array.from(excluded || []),
        formats: fmtPairs,
        order: ord,
        updatedAt: Date.now()
      });
    } else {
      records.delete(key);
    }
    scheduleWrite();
  }

  /** 排队落盘（突发合并）：已有待写任务时跳过——writePage 执行时才序列化最新
   *  内存，一次写入即覆盖此前全部变更；执行期间到来的新变更会另排新任务 */
  function scheduleWrite() {
    if (!hasStorage() || !pageKey) return;
    if (writePending) return;
    writePending = true;
    writeChain = writeChain.then(() => {
      writePending = false; // 先清标志：writePage 异步执行期间的新变更可再排队
      return writePage();
    });
  }

  /** 落盘当前页记录 + LRU 淘汰超限旧页（执行时序列化最新内存，天然合并连写）。
   *  v2.8：先写 local（真相源，失败降级当次会话有效），再镜像到 sync（跨设备，
   *  尽力而为——体积超限/配额失败只告警，绝不影响 local 结果） */
  async function writePage() {
    const sk = storageKey();
    const item = serializeRecords(); // 该页的「表键 → 记录」映射（即存储项的值）
    await writeArea(chrome.storage.local, sk, item, PAGE_LIMIT, false);
    if (hasSync()) await writeArea(chrome.storage.sync, sk, item, SYNC_PAGE_LIMIT, true);
  }

  /** 写单个存储区：读全量 → LRU 淘汰超限旧页 → 写入该页记录。sync 模式额外做单项
   *  体积检查（超 7KB 的页不镜像：sync 单项硬上限 8KB，宁可不同步也不能让写入抛错） */
  async function writeArea(area, sk, item, limit, isSync) {
    try {
      if (isSync && item && byteLen(JSON.stringify(item)) + sk.length > SYNC_ITEM_MAX) {
        console.warn('[HTML2XLSX] 本页列设置超过同步体积上限，仅保存在本机：', byteLen(JSON.stringify(item)), 'bytes');
        return;
      }
      const all = await area.get(null);
      const evict = evictKeys(all, sk, limit);
      const update = {};
      update[sk] = item;
      await area.set(update);
      if (evict.length) await area.remove(evict);
    } catch (e) {
      console.warn('[HTML2XLSX] 持久化配置写入失败（降级为当次会话有效）：', e);
    }
  }

  /** UTF-8 字节长度（sync 单项配额按字节计；中文页键/表名占多字节，按字符数估会低估） */
  function byteLen(s) {
    try {
      return new TextEncoder().encode(s).length;
    } catch (e) {
      return s.length * 2; // 无 TextEncoder 环境（极老浏览器）保守估算
    }
  }

  function serializeRecords() {
    const out = {};
    for (const [key, rec] of records) {
      out[key] = {
        rules: rec.rules, excluded: rec.excluded, formats: rec.formats,
        order: rec.order || [], updatedAt: rec.updatedAt
      };
    }
    return out;
  }

  /* ---------------- 界面偏好（v2.9 起，自 main.js 迁入） ----------------
   * chrome.storage.local 'h2x.prefs'：{ fmt, name }——fmt 为输出方式下拉值
   * （五种导出格式 + 两种剪贴板模式），name 为文件名模板（用户编辑过的原文，
   * 空串 = 用默认模板）。文件名支持 {title}/{date}/{time} 三个占位符。
   * 本模块只存不渲染：模板渲染（document.title）与「用户已动过控件」的会话
   * 守卫（fmtTouched/nameDirty）属 UI 关注点，留在 main.js */
  const PREF_KEY = 'h2x.prefs';
  let prefs = { fmt: '', name: '' };

  /** 读取界面偏好（注入时一次）：返回归一化补丁 { fmt, name } 或 null（无记录/
   *  无存储/读取失败）。同时合并进模块内 prefs——后续 save 的增量补丁以此为
   *  基准，避免只存一个字段时丢掉另一个（如改了 fmt 不丢 name 模板） */
  async function prefsLoad() {
    if (!hasStorage()) return null;
    try {
      const data = await chrome.storage.local.get(PREF_KEY);
      const p = data && data[PREF_KEY];
      if (!p || typeof p !== 'object') return null;
      prefs = {
        fmt: typeof p.fmt === 'string' ? p.fmt : '',
        name: typeof p.name === 'string' ? p.name : ''
      };
      return { fmt: prefs.fmt, name: prefs.name };
    } catch (e) {
      console.warn('[HTML2XLSX] 界面偏好读取失败（按默认值）：', e);
      return null;
    }
  }

  /** 写入界面偏好（fire-and-forget：失败降级为本次会话内有效） */
  function prefsSave(patch) {
    prefs = Object.assign({}, prefs, patch);
    if (!hasStorage()) return;
    try {
      const p = chrome.storage.local.set({ [PREF_KEY]: prefs });
      if (p && p.catch) p.catch(() => {});
    } catch (e) { /* 扩展上下文失效：不影响本次会话已生效的值 */ }
  }

  /* ---------------- 手动指定的翻页按钮记忆（v2.9 起，自 main.js 迁入） ----------------
   * 自建分页器每次采集都要手动指定一次「下一页」按钮，重复且易忘。此处把用户
   * 指定的按钮定位器按「页面键 + 表指纹」记住（chrome.storage.local
   * 'h2x.pager.v1'，单条记录容纳全部页面，LRU 上限 30 条），下次对同一表格点
   * 「采集全部页」直接复用、不再进「指定翻页按钮」子模式；复用后未生效
   * （连续两页无新行 / 表格失联）即清除记忆，避免一直踩失效按钮 */
  const PAGER_KEY = 'h2x.pager.v1';
  const PAGER_LIMIT = 30;      // 记忆条数上限（LRU：超出淘汰最旧）
  const PAGER_SEP = '\u0001';  // 页面键与表指纹分隔（同表键约定）
  let pagerMem = {};           // '<页面键>\u0001<表指纹>' -> { loc, updatedAt }

  /** 记忆条目的键：页面键（origin+pathname）+ 表指纹；任一缺失返回 null（不记忆）。
   *  表头变更 → 指纹变化 → 自动不命中（旧记忆自然失效，无需清理）。
   *  页面键每次现算（与迁移前 main.js 语义一致：SPA 改址后按新页面键记忆） */
  function pagerEntryKey(table) {
    let pk = null;
    try { pk = pageKeyOf(location.href); } catch (e) { /* 无 location 环境 */ }
    const tk = tableKeyOf(table);
    return (pk && tk) ? pk + PAGER_SEP + tk : null;
  }

  /** 取本表记住的翻页按钮定位器；无记录/结构损坏返回 null */
  function pagerGet(table) {
    const key = pagerEntryKey(table);
    const loc = key && pagerMem[key] && pagerMem[key].loc;
    if (!loc || typeof loc.sel !== 'string' || typeof loc.tag !== 'string' ||
        !Number.isFinite(loc.idx)) return null;
    return {
      sel: loc.sel, idx: loc.idx, tag: loc.tag,
      text: typeof loc.text === 'string' ? loc.text : ''
    };
  }

  /** 记住/清除某表的翻页按钮（loc 为 null = 清除）；写入 fire-and-forget */
  function pagerSave(table, loc) {
    const key = pagerEntryKey(table);
    if (!key) return;
    if (loc) pagerMem[key] = { loc: loc, updatedAt: Date.now() };
    else delete pagerMem[key];
    const keys = Object.keys(pagerMem);
    if (keys.length > PAGER_LIMIT) {
      keys.sort((a, b) => ((pagerMem[a] && pagerMem[a].updatedAt) || 0) - ((pagerMem[b] && pagerMem[b].updatedAt) || 0));
      for (const k of keys.slice(0, keys.length - PAGER_LIMIT)) delete pagerMem[k];
    }
    if (!hasStorage()) return;
    try {
      const p = chrome.storage.local.set({ [PAGER_KEY]: pagerMem });
      if (p && p.catch) p.catch(() => {});
    } catch (e) { /* 扩展上下文失效：不影响本次会话 */ }
  }

  /** 注入时预载翻页按钮记忆（fire-and-forget；失败按未记忆处理） */
  async function pagerLoad() {
    if (!hasStorage()) return;
    try {
      const data = await chrome.storage.local.get(PAGER_KEY);
      const v = data && data[PAGER_KEY];
      if (v && typeof v === 'object') pagerMem = v;
    } catch (e) {
      console.warn('[HTML2XLSX] 翻页按钮记忆读取失败（按未记忆处理）：', e);
    }
  }

  loadRecords();

  ns.persist = {
    pageKeyOf: pageKeyOf,
    tableKeyOf: tableKeyOf,
    sanitizeRecord: sanitizeRecord,
    evictKeys: evictKeys,
    getSaved: getSaved,
    save: save,
    ready: ready,
    prefs: { load: prefsLoad, save: prefsSave },
    pager: { get: pagerGet, save: pagerSave, load: pagerLoad }
  };
})();
