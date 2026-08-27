/**
 * 列拆分纯函数（零依赖，不碰 DOM）
 * test/algo-check.cjs 整文件加载本模块回归（new Function 注入伪 window），
 * 故本文件不得引用其他模块——splitBlocks 内联与 normText 同规则的归一化正则
 */
(() => {
  'use strict';
  const ns = window.__h2x;

  /** 分隔符拆值：各段去首尾空白；limit（≥2）生效时超限段连同分隔符并入末段 */
  function splitByDelimiter(value, pattern, limit) {
    const s = value == null ? '' : String(value);
    if (!pattern) return [s];
    let parts = s.split(pattern).map(p => p.trim());
    if (limit && limit >= 2 && parts.length > limit) {
      const head = parts.slice(0, limit - 1);
      head.push(parts.slice(limit - 1).join(pattern));
      parts = head;
    }
    return parts;
  }

  /** 视觉块切分（block 模式数据基础）：按换行（块级元素边界）切成文本块，
   *  各块内空白归一化、去首尾，过滤空块。如「标题\n产品ID」→ [标题, 产品ID]；
   *  空值 → []（拆分时与空单元格同语义，留一个空段） */
  function splitBlocks(s) {
    return String(s == null ? '' : s).split('\n')
      .map(p => p.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim())
      .filter(Boolean);
  }

  /** 块拆分段值：blocks 通道取值 + 段数上限（超限块以空格并入末块）；
   *  空值与 splitByDelimiter(null) 同语义返回 ['']（原值留首段） */
  function limitBlocks(blocks, limit) {
    const bl = (Array.isArray(blocks) ? blocks : []).filter(Boolean);
    if (!bl.length) return [''];
    if (limit && limit >= 2 && bl.length > limit) {
      const head = bl.slice(0, limit - 1);
      head.push(bl.slice(limit - 1).join(' '));
      return head;
    }
    return bl.slice();
  }

  /** 拆分段值统一入口（导出与预览共用，保证两侧行为一致）：
   *  block → 视觉块（块内空格不拆）；delimiter → 分隔符 */
  function splitSegments(mode, merged, blocks, pattern, limit) {
    return mode === 'block'
      ? limitBlocks(blocks, limit)
      : splitByDelimiter(merged, pattern, limit);
  }

  /** block/delimiter 新列名：原名+序号（空原名 → 裸序号） */
  function splitColName(base, k) {
    return base ? base + (k + 1) : String(k + 1);
  }

  /** 规则列定位：col 为表头文本（取首行表头首个命中）或列序号；未命中/越界返回 -1 */
  function resolveRuleCol(aoa, col, maxCols) {
    let idx = -1;
    if (typeof col === 'number') {
      idx = col;
    } else if (col !== null && col !== undefined && col !== '') {
      const header = aoa[0] || [];
      for (let i = 0; i < header.length; i++) {
        if ((header[i] == null ? '' : String(header[i])) === col) { idx = i; break; }
      }
    }
    return (idx >= 0 && idx < maxCols) ? idx : -1;
  }

  /** 列标识（拆分规则与列筛选共用的列定位基准）：表头文本唯一且非空 → 文本；
   *  否则列序号（无表头/重名兜底）。与 resolveRuleCol 的解析规则互逆 */
  function colKeys(ch) {
    const src = ch.aoa || ch.rows;
    const header = (ch.headerRows || 0) > 0 ? (src[0] || []) : [];
    let maxCols = 0;
    for (const row of src) if (row) maxCols = Math.max(maxCols, row.length);
    const keys = [];
    for (let c = 0; c < maxCols; c++) {
      const name = String(header[c] || '');
      let key = c;
      if (name) {
        let dup = false;
        for (let i = 0; i < maxCols; i++) {
          if (i !== c && String(header[i] || '') === name) { dup = true; break; }
        }
        if (!dup) key = name;
      }
      keys.push(key);
    }
    return keys;
  }

  /** 输出列布局：applyColumnSplits 应用后每个输出列的标识映射（列筛选的基准）。
   *  返回 [{ key, srcCol, seg }]，数组下标即拆分结果中的输出列号：
   *  - 原列：key = colKeys 的列标识，seg = null
   *  - 拆分新列：key = 列标识 + '#' + 段号（1 起），seg = 段号
   *  与 applyColumnSplits 的短路条件（无规则 / 含 merges / 规则解析不到）及
   *  段数计算（数据行最大段数；control 固定 2）保持一致，保证过滤列号不错位。
   *  同列多条规则仅取首条（面板交互不会产生，手工构造的 rules 属未定义行为） */
  function columnLayout(ch, rules) {
    const src = ch.aoa || ch.rows;
    const headerRows = ch.headerRows || 0;
    const keys = colKeys(ch);
    const maxCols = keys.length;
    const blocksCh = ch.blocks || [];
    const ruleMap = new Map(); // 列号 -> 规则
    if (rules && rules.length && !(ch.merges && ch.merges.length)) {
      for (const rule of rules) {
        const idx = resolveRuleCol(src, rule.col, maxCols);
        if (idx >= 0 && !ruleMap.has(idx)) ruleMap.set(idx, rule);
      }
    }
    const layout = [];
    for (let c = 0; c < maxCols; c++) {
      layout.push({ key: keys[c], srcCol: c, seg: null });
      const rule = ruleMap.get(c);
      if (!rule) continue;
      let segCount = 2;
      if (rule.mode !== 'control') {
        segCount = 1;
        for (let r = headerRows; r < src.length; r++) {
          const row = src[r] || [];
          const n = splitSegments(rule.mode, row[c], (blocksCh[r] || [])[c], rule.pattern, rule.limit).length;
          if (n > segCount) segCount = n;
        }
      }
      for (let k = 1; k <= segCount; k++) {
        layout.push({ key: keys[c] + '#' + k, srcCol: c, seg: k });
      }
    }
    return layout;
  }

  /** 按排除集过滤输出列（导出列筛选）：excluded 为 Set<列标识>（原列 key 或 key#k）。
   *  未排除任何实际存在的列时原样返回；全部被排除时也原样返回（防御，UI 已阻止全排除）。
   *  返回新数组（不改入参行）；参差短行缺值补 '' */
  function filterColumns(aoa, layout, excluded) {
    if (!excluded || !excluded.size) return aoa;
    const keep = [];
    layout.forEach((col, i) => { if (!excluded.has(col.key)) keep.push(i); });
    if (!keep.length || keep.length === layout.length) return aoa;
    return aoa.map(row => {
      const r = row || [];
      return keep.map(i => (r[i] == null ? '' : r[i]));
    });
  }

  /** 列拆分主函数：把通道中命中的列拆为多列（原列保留，新列追加其后，错了可删）。
   *  ch：extractTable 结果 { aoa, merges, ctrl, text, blocks, headerRows }
   *      或虚拟快照 { rows, ctrl, text, blocks, headerRows }；rules：[{ col, mode, pattern, limit }]
   *  mode：control（控件值列+文本列）/ block（按换行视觉块拆）/ delimiter（按分隔符拆）
   *  返回新 aoa；未配规则 / 含合并单元格 / 规则全部解析不到时原样返回（零回归 + 二次防御） */
  function applyColumnSplits(ch, rules) {
    const src = ch.aoa || ch.rows;
    if (!rules || !rules.length) return src;
    if (ch.merges && ch.merges.length) return src; // 含合并单元格的表格禁用拆分
    const headerRows = ch.headerRows || 0;
    const ctrlCh = ch.ctrl || [];
    const textCh = ch.text || [];
    const blocksCh = ch.blocks || [];

    // 按最大列数补齐行（各通道同形状），便于按索引读写
    let maxCols = 0;
    for (const row of src) if (row) maxCols = Math.max(maxCols, row.length);
    const pad = (row) => {
      const r = Array.from(row || [], v => (v === undefined ? null : v));
      while (r.length < maxCols) r.push(null);
      return r;
    };
    const aoa = src.map(pad);
    const ctrl = ctrlCh.map(pad);
    const text = textCh.map(pad);
    const blocks = blocksCh.map(pad);

    // 规则解析到列索引（解析不到则静默跳过）；按原始索引从右到左应用，
    // 右侧先拆不影响左侧索引，逐条重排
    const resolved = [];
    for (const rule of rules) {
      const idx = resolveRuleCol(aoa, rule.col, maxCols);
      if (idx < 0) continue;
      resolved.push({ idx: idx, rule: rule });
    }
    if (!resolved.length) return src;
    resolved.sort((a, b) => b.idx - a.idx);

    // 新列名基准：首行表头文本（可为空）
    const baseName = (idx) => String((aoa[0] && aoa[0][idx]) || '').trim();

    for (const { idx, rule } of resolved) {
      if (rule.mode === 'control') {
        // control：控件值列 + 页面文本列；ctrl/text 通道按原始索引读取（不随插入重排）
        const base = baseName(idx) || ('列' + (idx + 1)); // 空表头名按列序号兜底
        for (let r = 0; r < aoa.length; r++) {
          let cells;
          if (r < headerRows) {
            // 多行表头只在首行写名，其余表头行留空
            cells = r === 0 ? [base + '_控件', base + '_文本'] : ['', ''];
          } else {
            const cv = ctrl[r] ? ctrl[r][idx] : null;
            const tv = text[r] ? text[r][idx] : null;
            cells = [cv == null ? '' : cv, tv == null ? '' : tv];
          }
          aoa[r].splice(idx + 1, 0, cells[0], cells[1]);
        }
      } else {
        // block / delimiter 共用一套骨架，段值由 splitSegments 按模式取：
        // block 取视觉块（如「标题/产品ID」双行格，块内空格不拆），delimiter 按分隔符。
        // 新列数 = 数据行最大段数（各行对齐补空）；新列名 = 原名+序号（空原名 → 裸序号）；
        // 多行表头只在首行写名，其余表头行留空
        const base = baseName(idx);
        const partsOf = (r) => splitSegments(
          rule.mode, aoa[r][idx], blocks[r] ? blocks[r][idx] : null, rule.pattern, rule.limit);
        let segCount = 1;
        for (let r = headerRows; r < aoa.length; r++) {
          const n = partsOf(r).length;
          if (n > segCount) segCount = n;
        }
        for (let r = 0; r < aoa.length; r++) {
          let cells;
          if (r < headerRows) {
            cells = r === 0
              ? Array.from({ length: segCount }, (_, k) => splitColName(base, k))
              : Array.from({ length: segCount }, () => '');
          } else {
            const parts = partsOf(r);
            while (parts.length < segCount) parts.push('');
            cells = parts;
          }
          aoa[r].splice(idx + 1, 0, ...cells);
        }
      }
    }
    return aoa;
  }

  ns.split = {
    splitByDelimiter: splitByDelimiter, splitBlocks: splitBlocks, limitBlocks: limitBlocks,
    splitSegments: splitSegments, splitColName: splitColName,
    resolveRuleCol: resolveRuleCol, colKeys: colKeys, columnLayout: columnLayout,
    filterColumns: filterColumns, applyColumnSplits: applyColumnSplits
  };
})();
