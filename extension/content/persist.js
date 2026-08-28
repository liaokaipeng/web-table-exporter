/**
 * 拆分规则/列筛选/列格式持久化（v1.7 起，v1.9 增列格式）：chrome.storage.local
 * 按「页面 + 表指纹」存储
 * - 页面键 = origin + pathname（忽略 query/hash：分页/筛选参数不拆散同一份配置）
 * - 表指纹 = 表头单元格文本归一化后以 \u0001 拼接（thead 无 tr 的组件库写法兼容；
 *   指纹绝不取数据行——虚拟滚动数据行动态渲染会不稳定）；保存与恢复同用本函数
 *   取 DOM 表头（同源保证一致），表头变更 → 指纹不匹配 → 不恢复（规则解析另有防御）
 * - 会话内存 records 是唯一恢复源：注入时预载当前页面记录；面板保存时同步更新
 *   内存并异步落盘（fire-and-forget，失败仅告警，降级为当次会话有效）
 * - 页面条目上限 50，超出按 LRU 淘汰（页面最新时间 = 其各表记录 updatedAt 最大值）
 * - 纯函数（pageKeyOf/tableKeyOf/sanitizeRecord/evictKeys）挂 ns.persist 供
 *   algo-check.cjs 离线回归；chrome/location 引用均有守卫（Node 可整文件加载）
 * 依赖：entry（__h2x 命名空间）；无其他模块依赖（virtual 之后、panel 之前注入）
 */
(() => {
  'use strict';
  const ns = window.__h2x;

  const KEY_PREFIX = 'h2x.v1:p:'; // 页面存储键前缀（含存储结构版本号）
  const PAGE_LIMIT = 50;          // 页面条目上限（LRU 淘汰）
  const RULE_MODES = ['control', 'block', 'delimiter'];
  const FMT_VALUES = ['number'];  // 可持久化的列格式（文本为默认行为，无需存储）

  // 归一化（与 cell.js normText 同规则）：nbsp → 空格、连续空白 → 单空格、去首尾
  const normText = (s) => (s || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();

  const hasStorage = () =>
    typeof chrome !== 'undefined' && !!(chrome.storage && chrome.storage.local);

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
   *  不参与持久化）。分体结构（Element Plus / vxe-table）取容器内首个 table 即
   *  表头表，表头不随滚动变化故指纹稳定；同页两表指纹相同（表头完全一致）共享
   *  一份配置，属可接受降级 */
  function tableKeyOf(root) {
    if (!root) return null;
    const t = root.tagName === 'TABLE'
      ? root
      : (root.querySelector ? root.querySelector('table') : null);
    if (!t || !t.rows) return null;
    const cells = headerCellsOf(t);
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
    if (!rules.length && !excluded.length && !formats.length) return null;
    return { rules: rules, excluded: excluded, formats: formats, updatedAt: Number(rec.updatedAt) || 0 };
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

  /** 注入时预载当前页面记录进会话内存 */
  function loadRecords() {
    if (!pageKey || !hasStorage()) return;
    readyPromise = (async () => {
      try {
        const sk = storageKey();
        const stored = await chrome.storage.local.get(sk);
        const page = stored && stored[sk];
        if (page && typeof page === 'object') {
          for (const key of Object.keys(page)) {
            const rec = sanitizeRecord(page[key]);
            if (rec) records.set(key, rec);
          }
        }
      } catch (e) {
        console.warn('[HTML2XLSX] 持久化配置读取失败（降级为当次会话有效）：', e);
      }
    })();
  }

  /** 存储加载就绪（兜底注入初期的毫秒级竞态；失败已内部吞掉，必定 resolve） */
  function ready() {
    return readyPromise || Promise.resolve();
  }

  /** 读取某表已保存配置：{ rules, excluded: Set, formats: Map } 或 null（无记录/指纹无效） */
  function getSaved(table) {
    const key = tableKeyOf(table);
    if (!key) return null;
    const rec = records.get(key);
    if (!rec) return null;
    return { rules: rec.rules, excluded: new Set(rec.excluded), formats: new Map(rec.formats) };
  }

  /** 保存某表配置（面板「保存」后调用）：同步更新会话内存（本会话恢复源），异步
   *  落盘 fire-and-forget。rules / excluded / formats 均空 = 重置：删除该表记录 */
  function save(table, rules, excluded, formats) {
    const key = tableKeyOf(table);
    if (!key || !pageKey) return;
    const fmtPairs = [];
    for (const [k, v] of (formats || new Map())) {
      if (FMT_VALUES.indexOf(v) >= 0) fmtPairs.push([k, v]);
    }
    if ((rules && rules.length) || (excluded && excluded.size) || fmtPairs.length) {
      records.set(key, {
        rules: (rules || []).map(r => ({
          col: r.col,
          mode: r.mode,
          pattern: r.pattern == null ? '' : String(r.pattern),
          limit: (typeof r.limit === 'number' && r.limit >= 2) ? r.limit : null
        })),
        excluded: Array.from(excluded || []),
        formats: fmtPairs,
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

  /** 落盘当前页记录 + LRU 淘汰超限旧页（执行时序列化最新内存，天然合并连写） */
  async function writePage() {
    try {
      const sk = storageKey();
      const all = await chrome.storage.local.get(null);
      const evict = evictKeys(all, sk, PAGE_LIMIT);
      const update = {};
      update[sk] = serializeRecords();
      await chrome.storage.local.set(update);
      if (evict.length) await chrome.storage.local.remove(evict);
    } catch (e) {
      console.warn('[HTML2XLSX] 持久化配置写入失败（降级为当次会话有效）：', e);
    }
  }

  function serializeRecords() {
    const out = {};
    for (const [key, rec] of records) {
      out[key] = { rules: rec.rules, excluded: rec.excluded, formats: rec.formats, updatedAt: rec.updatedAt };
    }
    return out;
  }

  loadRecords();

  ns.persist = {
    pageKeyOf: pageKeyOf,
    tableKeyOf: tableKeyOf,
    sanitizeRecord: sanitizeRecord,
    evictKeys: evictKeys,
    getSaved: getSaved,
    save: save,
    ready: ready
  };
})();
