// 算法回归测试：验证「相邻窗口重叠合并」采集算法、「列拆分」与「分体表格配对」纯函数的各场景
// - overlapLen 直接加载 extension/content/virtual.js 的实现（保证与实现同步）；
//   takeWindow 逻辑在测试内模拟
// - 列拆分函数直接加载 extension/content/split.js 整个模块（零依赖纯函数文件）
// - 分体表格配对直接加载 extension/content/table.js 的 pairSplitGroup / makeSheetName
//   （模块级代码零 DOM 引用，可整文件加载；仅调用纯函数，表名生成以对象桩模拟 DOM，
//   其余 DOM 侧取证走浏览器回归）
// - 持久化纯函数直接加载 extension/content/persist.js（chrome/location 引用有守卫，
//   Node 下自动降级；tableKeyOf 以对象桩模拟 DOM）
// - 导出格式序列化直接加载 extension/content/format.js（依赖 util.escapeHtml，
//   加载时预注入 util 命名空间）
const fs = require('fs');
const path = require('path');

// 以伪 window 加载内容脚本模块（模块均为 IIFE，挂载到 window.__h2x.*）
// preNs：预置命名空间成员（供有命名空间内依赖的模块使用，如 format 依赖 util）
function loadModule(relPath, modName, preNs) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'extension', 'content', relPath), 'utf8');
  return new Function('window', src + '\n;return window.__h2x.' + modName + ';')({ __h2x: preNs || {} });
}

const { overlapLen } = loadModule('virtual.js', 'virtual');
const {
  splitByDelimiter, splitBlocks, limitBlocks, splitSegments, splitColName,
  resolveRuleCol, colKeys, columnLayout, filterColumns, applyColumnSplits,
  toNumValue, formatColumns, applyColFormats, cellWidth, autoColWidths
} = loadModule('split.js', 'split');
const { pairSplitGroup, makeSheetName } = loadModule('table.js', 'table');
const { pageKeyOf, tableKeyOf, sanitizeRecord, evictKeys } = loadModule('persist.js', 'persist');
const util = loadModule('util.js', 'util');
const { csvCell, toCsv, headerKeys, rowObjects, toJson, mdCell, toMarkdown, toHtmlDocument } =
  loadModule('format.js', 'format', { util });

// 模拟 takeWindow 完整逻辑（含 DOM 引用判定 + 重叠合并）
// 窗口输入：{ rows: string[], refs: object[] }（refs 模拟 DOM 行元素引用）
function run(windows) {
  const acc = [];
  let prevRefs = null;
  for (const { rows, refs } of windows) {
    const firstWin = prevRefs === null;
    if (!firstWin && refs.length === prevRefs.length && refs.every((el, i) => el === prevRefs[i])) {
      continue; // DOM 未变，无新行
    }
    prevRefs = refs;
    const k = overlapLen(acc, rows);
    for (let i = k; i < rows.length; i++) acc.push(rows[i]);
  }
  return acc;
}

let fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log((ok ? 'PASS' : 'FAIL') + ' ' + name +
    (ok ? '' : '\n  期望 ' + JSON.stringify(want) + '\n  实际 ' + JSON.stringify(got)));
};

// 1. 滑动窗口（虚拟滚动，DOM 每窗重建）：数据 [A,B,C,D,E]
check('滑动窗口无重复',
  run([
    { rows: ['A','B'], refs: [{}, {}] },
    { rows: ['B','C'], refs: [{}, {}] },
    { rows: ['C','D'], refs: [{}, {}] },
    { rows: ['D','E'], refs: [{}, {}] },
  ]),
  ['A','B','C','D','E']);

// 2. 合法重复行保留：数据 [A,B,A,C]
check('合法重复行保留',
  run([
    { rows: ['A','B'], refs: [{}, {}] },
    { rows: ['B','A'], refs: [{}, {}] },
    { rows: ['A','C'], refs: [{}, {}] },
  ]),
  ['A','B','A','C']);

// 3. 非虚拟表格误报：每窗口同一批 DOM 引用 + 全量行
const full = Array.from({length: 26}, (_, i) => String.fromCharCode(65 + i));
const fullRefs = Array.from({length: 26}, () => ({}));
check('非虚拟表格误报无损（同引用）',
  run([
    { rows: full, refs: fullRefs },
    { rows: full, refs: fullRefs },
    { rows: full, refs: fullRefs },
  ]),
  full);

// 4. 渲染延迟：窗口 2 DOM 未更新（同引用），窗口 3 更新
check('渲染延迟窗口',
  run([
    { rows: ['A','B'], refs: [1, 2] },
    { rows: ['A','B'], refs: [1, 2] },  // 未重渲
    { rows: ['B','C'], refs: [2, 3] },  // 重渲
  ]),
  ['A','B','C']);

// 5. 非虚拟误报但 DOM 重建（极端：同内容新引用，如隔帧重渲）→ 内容匹配兜底
check('同内容新引用（内容匹配兜底）',
  run([
    { rows: ['A','B'], refs: [{}, {}] },
    { rows: ['A','B'], refs: [{}, {}] },
  ]),
  ['A','B']);

// 6. 无重叠窗口（跳滚过远）：拼接不丢
check('无重叠窗口（拼接）',
  run([
    { rows: ['A','B'], refs: [{}, {}] },
    { rows: ['C','D'], refs: [{}, {}] },
  ]),
  ['A','B','C','D']);

// 7. 大表性能：5000 行非虚拟误报 ×3 窗口（同引用，快路径跳过比较）
const big = Array.from({length: 5000}, (_, i) => 'row' + i);
const bigRefs = Array.from({length: 5000}, () => ({}));
const t0 = Date.now();
const bigResult = run([
  { rows: big, refs: bigRefs },
  { rows: big, refs: bigRefs },
  { rows: big, refs: bigRefs },
]);
console.log('性能: 5000 行×3窗口 耗时 ' + (Date.now() - t0) + 'ms, 结果 ' + bigResult.length + ' 行');
if (bigResult.length !== 5000) { fail++; console.log('FAIL 大表行数'); }

// 7b. 超 200 行窗口（回归）：重叠数超过旧实现 200 硬上限时仍须正确匹配。
// 旧上限会截断 k 的搜索域导致匹配失败 → 整窗追加产生重复行
const bigWin1 = Array.from({length: 250}, (_, i) => 'r' + i);
const bigWin2 = Array.from({length: 250}, (_, i) => 'r' + (i + 20)); // 与上窗重叠 230 行
check('超 200 行窗口重叠合并（回归）',
  run([
    { rows: bigWin1, refs: Array.from({length: 250}, () => ({})) },
    { rows: bigWin2, refs: Array.from({length: 250}, () => ({})) },
  ]),
  Array.from({length: 270}, (_, i) => 'r' + i));

// 已知限制（不在断言内，记录用）：数据全同 + 虚拟滚动 + 整窗重建时，
// 内容匹配无法区分重叠与新行，理论上会少采。普通场景（行内容各异或部分重复）均正确。

/* ================= 列拆分（split.js 模块函数，文件头部已加载） ================= */

// 8. splitByDelimiter：基础拆分 / 无命中 / 空值 / 段首尾空白 / 段数上限
check('split 空格', splitByDelimiter('4722 PHP', ' ', null), ['4722', 'PHP']);
check('split 顿号', splitByDelimiter('电器、数码', '、', null), ['电器', '数码']);
check('split 无命中原值留首段', splitByDelimiter('abc', '、', null), ['abc']);
check('split 空单元格', splitByDelimiter(null, '、', null), ['']);
check('split 段首尾去空白', splitByDelimiter('a, b , c', ',', null), ['a', 'b', 'c']);
check('split 段数上限并入末段', splitByDelimiter('a:b:c:d', ':', 2), ['a', 'b:c:d']);
check('split 段数上限3', splitByDelimiter('a:b:c:d:e', ':', 3), ['a', 'b', 'c:d:e']);
check('split 上限不触发', splitByDelimiter('a:b', ':', 3), ['a', 'b']);
check('split limit 空=不限', splitByDelimiter('a:b:c', ':', null), ['a', 'b', 'c']);
check('split limit 无效忽略', splitByDelimiter('a:b:c', ':', 1), ['a', 'b', 'c']);
check('split 空分隔符原样', splitByDelimiter('a b', '', null), ['a b']);

// 9. resolveRuleCol：表头文本 / 列序号 / 未命中 / 越界
const aoaHdr = [['售价', '标签'], ['4722 PHP', '电器、数码']];
check('resolve 文本命中', resolveRuleCol(aoaHdr, '标签', 2), 1);
check('resolve 序号', resolveRuleCol(aoaHdr, 0, 2), 0);
check('resolve 序号越界', resolveRuleCol(aoaHdr, 5, 2), -1);
check('resolve 未命中', resolveRuleCol(aoaHdr, '不存在', 2), -1);
check('resolve 空串', resolveRuleCol(aoaHdr, '', 2), -1);

// 10. control 模式：每控件一列 + 文本列；纯文本格整值留文本列
const chControl = {
  aoa: [['售价', '备注'], ['2249 PHP', 'a'], ['100', 'b']],
  ctrl: [[null, null], [['2249'], null], [null, null]],
  text: [[null, null], ['PHP', null], ['100', null]],
  headerRows: 1
};
check('control 拆分',
  applyColumnSplits(chControl, [{ col: '售价', mode: 'control' }]),
  [['售价', '售价_控件', '售价_文本', '备注'],
   ['2249 PHP', '2249', 'PHP', 'a'],
   ['100', '', '100', 'b']]);

// 10b. control 多控件：同格多个控件各自成列（店小秘秒杀价格/库存双输入格场景），不再顿号合并
const chMultiCtrl = {
  aoa: [['秒杀价', '备注'], ['秒杀价 10.00 秒杀库存 5', 'a'], ['秒杀价 20.00 秒杀库存 8', 'b']],
  ctrl: [[null, null], [['10.00', '5'], null], [['20.00', '8'], null]],
  text: [[null, null], ['秒杀价 秒杀库存', null], ['秒杀价 秒杀库存', null]],
  headerRows: 1
};
check('control 多控件各自成列',
  applyColumnSplits(chMultiCtrl, [{ col: '秒杀价', mode: 'control' }]),
  [['秒杀价', '秒杀价_控件1', '秒杀价_控件2', '秒杀价_文本', '备注'],
   ['秒杀价 10.00 秒杀库存 5', '10.00', '5', '秒杀价 秒杀库存', 'a'],
   ['秒杀价 20.00 秒杀库存 8', '20.00', '8', '秒杀价 秒杀库存', 'b']]);

// 10c. control 控件数参差：按最大控件数对齐，短行补空
check('control 控件数参差补齐',
  applyColumnSplits(
    {
      aoa: [['x'], ['a'], ['b']],
      ctrl: [[null], [['v1', 'v2']], [['w']]],
      text: [[null], ['t1'], ['t2']],
      headerRows: 1
    },
    [{ col: 0, mode: 'control' }]
  ),
  [['x', 'x_控件1', 'x_控件2', 'x_文本'], ['a', 'v1', 'v2', 't1'], ['b', 'w', '', 't2']]);

// 10d. control 空控件值占位：不因空值前移串列（位置忠实）
check('control 空值占位不串列',
  applyColumnSplits(
    {
      aoa: [['x'], ['a']],
      ctrl: [[null], [['', 'v2']]],
      text: [[null], ['t']],
      headerRows: 1
    },
    [{ col: 0, mode: 'control' }]
  ),
  [['x', 'x_控件1', 'x_控件2', 'x_文本'], ['a', '', 'v2', 't']]);

// 11. delimiter 模式：最大段数对齐，短行补空
const chDelim = {
  aoa: [['标签'], ['电器、数码'], ['家居'], ['服饰、美妆、母婴']],
  ctrl: [[null], [null], [null], [null]],
  text: [[null], [null], [null], [null]],
  headerRows: 1
};
check('delimiter 拆分（段数对齐）',
  applyColumnSplits(chDelim, [{ col: '标签', mode: 'delimiter', pattern: '、' }]),
  [['标签', '标签1', '标签2', '标签3'],
   ['电器、数码', '电器', '数码', ''],
   ['家居', '家居', '', ''],
   ['服饰、美妆、母婴', '服饰', '美妆', '母婴']]);

// 12. 从右到左多规则：右侧先拆不影响左侧索引
check('从右到左多规则',
  applyColumnSplits(
    {
      aoa: [['A', 'B', 'C'], ['a1 a2', 'b1、b2', 'c1 c2']],
      ctrl: [[null, null, null], [null, null, null]],
      text: [[null, null, null], [null, null, null]],
      headerRows: 1
    },
    [{ col: 'A', mode: 'delimiter', pattern: ' ' }, { col: 'C', mode: 'delimiter', pattern: ' ' }]
  ),
  [['A', 'A1', 'A2', 'B', 'C', 'C1', 'C2'],
   ['a1 a2', 'a1', 'a2', 'b1、b2', 'c1 c2', 'c1', 'c2']]);

// 13. delimiter 段数上限（规则级 limit）
check('delimiter 段数上限',
  applyColumnSplits(
    { aoa: [['x'], ['a:b:c']], ctrl: [[null], [null]], text: [[null], [null]], headerRows: 1 },
    [{ col: 0, mode: 'delimiter', pattern: ':', limit: 2 }]
  ),
  [['x', 'x1', 'x2'], ['a:b:c', 'a', 'b:c']]);

// 14. 防御路径：无规则 / 含 merges / 规则解析不到 → 原样返回（零回归）
const plain = [['a', 'b'], ['c', 'd']];
check('无规则原样返回',
  applyColumnSplits({ aoa: plain, merges: [] }, []), plain);
check('含 merges 禁用拆分',
  applyColumnSplits(
    { aoa: plain, merges: [{ s: { r: 0, c: 0 }, e: { r: 0, c: 0 } }] },
    [{ col: 0, mode: 'delimiter', pattern: ' ' }]
  ), plain);
check('规则解析不到原样返回',
  applyColumnSplits({ aoa: plain }, [{ col: '不存在', mode: 'delimiter', pattern: ' ' }]), plain);

// 15. 控件值含空格的对照：control 是唯一正确解，delimiter 按空格会拆错
const chSpace = {
  aoa: [['地址'], ['New York USA']],
  ctrl: [[null], [['New York']]],
  text: [[null], ['USA']],
  headerRows: 1
};
check('控件值含空格（control 正确解）',
  applyColumnSplits(chSpace, [{ col: 0, mode: 'control' }]),
  [['地址', '地址_控件', '地址_文本'], ['New York USA', 'New York', 'USA']]);
check('控件值含空格（delimiter 拆碎，作对照）',
  applyColumnSplits(chSpace, [{ col: 0, mode: 'delimiter', pattern: ' ' }]),
  [['地址', '地址1', '地址2', '地址3'], ['New York USA', 'New', 'York', 'USA']]);

// 16. 参差行：按最大列数补齐后再拆
check('参差行补齐',
  applyColumnSplits(
    {
      aoa: [['A', 'B'], ['x y'], ['p', 'q r']],
      ctrl: [[null, null], [null], [null, null]],
      text: [[null, null], [null], [null, null]],
      headerRows: 1
    },
    [{ col: 1, mode: 'delimiter', pattern: ' ' }]
  ),
  [['A', 'B', 'B1', 'B2'], ['x y', null, '', ''], ['p', 'q r', 'q', 'r']]);

// 17. 多行表头：新列只在首行写名，其余表头行留空
check('多行表头只在首行写名',
  applyColumnSplits(
    {
      aoa: [['商品', '价格'], ['主', '副'], ['a b', '1']],
      ctrl: [[null, null], [null, null], [null, null]],
      text: [[null, null], [null, null], [null, null]],
      headerRows: 2
    },
    [{ col: 0, mode: 'delimiter', pattern: ' ' }]
  ),
  [['商品', '商品1', '商品2', '价格'], ['主', '', '', '副'], ['a b', 'a', 'b', '1']]);

// 18. 无表头：全部行按数据拆，不生成命名行
check('无表头拆分',
  applyColumnSplits(
    {
      aoa: [['a b', 'c'], ['d', 'e']],
      ctrl: [[null, null], [null, null]],
      text: [[null, null], [null, null]],
      headerRows: 0
    },
    [{ col: 0, mode: 'delimiter', pattern: ' ' }]
  ),
  [['a b', 'a', 'b', 'c'], ['d', 'd', '', 'e']]);

// 19. 虚拟快照通道（rows 别名）+ 表头为空时新列名为裸序号
check('rows 通道别名 + 空表头名兜底',
  applyColumnSplits(
    { rows: [['', '备注'], ['x y', 'z']], ctrl: [[null, null], [null, null]], text: [[null, null], [null, null]], headerRows: 1 },
    [{ col: 0, mode: 'delimiter', pattern: ' ' }]
  ),
  [['', '1', '2', '备注'], ['x y', 'x', 'y', 'z']]);

// 20. splitBlocks：按换行切视觉块，块内空格不拆；空值/全空白 → []
check('blocks 换行切分（块内空格保留）',
  splitBlocks('AHNX00076_Oh Baby Warm White\n1731340859035715546'),
  ['AHNX00076_Oh Baby Warm White', '1731340859035715546']);
check('blocks 多行含空段', splitBlocks('a b\n\n  c  \nd'), ['a b', 'c', 'd']);
check('blocks 无换行单块', splitBlocks('4722 PHP'), ['4722 PHP']);
check('blocks 空值', splitBlocks(''), []);
check('blocks null', splitBlocks(null), []);

// 21. limitBlocks：块数上限（超限块以空格并入末块）；空值留一个空段
check('limitBlocks 基本透传', limitBlocks(['a', 'b'], null), ['a', 'b']);
check('limitBlocks 上限并入末块', limitBlocks(['a', 'b', 'c'], 2), ['a', 'b c']);
check('limitBlocks 上限不触发', limitBlocks(['a', 'b'], 3), ['a', 'b']);
check('limitBlocks 空值留空段', limitBlocks(null, null), ['']);
check('limitBlocks 过滤空块', limitBlocks(['a', '', 'b'], null), ['a', 'b']);

// 22. block 模式：店小咪「标题/产品ID」列（两个 div 堆叠 → 换行边界）拆成标题列 + ID 列
check('block 拆分（标题/产品ID 场景）',
  applyColumnSplits(
    {
      aoa: [['标题/产品ID', '本地展示价'], ['AHNX00076_Oh Baby Warm White 1731340859035715546', '4722 PHP'], ['AHNX00077_Red Dress 1731340859035715547', '1899 PHP']],
      ctrl: [[null, null], [null, null], [null, null]],
      text: [[null, null], [null, null], [null, null]],
      blocks: [[['标题/产品ID'], ['本地展示价']],
               [['AHNX00076_Oh Baby Warm White', '1731340859035715546'], ['4722 PHP']],
               [['AHNX00077_Red Dress', '1731340859035715547'], ['1899 PHP']]],
      headerRows: 1
    },
    [{ col: '标题/产品ID', mode: 'block' }]
  ),
  [['标题/产品ID', '标题/产品ID1', '标题/产品ID2', '本地展示价'],
   ['AHNX00076_Oh Baby Warm White 1731340859035715546', 'AHNX00076_Oh Baby Warm White', '1731340859035715546', '4722 PHP'],
   ['AHNX00077_Red Dress 1731340859035715547', 'AHNX00077_Red Dress', '1731340859035715547', '1899 PHP']]);

// 23. block 对照：块内空格不会被拆碎（delimiter 按空格会拆错，作对照）
check('block 块内空格不拆碎（对照 delimiter）',
  applyColumnSplits(
    {
      aoa: [['x'], ['Oh Baby Warm White']],
      ctrl: [[null], [null]],
      text: [[null], [null]],
      blocks: [[null], [['Oh Baby Warm White']]],
      headerRows: 1
    },
    [{ col: 0, mode: 'block' }]
  ),
  [['x', 'x1'], ['Oh Baby Warm White', 'Oh Baby Warm White']]);

// 24. block 段数对齐 + 上限：行块数不同时按最大对齐补空；上限超限并入末块
check('block 段数对齐（短行补空）',
  applyColumnSplits(
    {
      aoa: [['x'], ['a b c 归并'], ['d']],
      ctrl: [[null], [null], [null]],
      text: [[null], [null], [null]],
      blocks: [[null], [['a', 'b', 'c 归并']], [['d']]],
      headerRows: 1
    },
    [{ col: 0, mode: 'block' }]
  ),
  [['x', 'x1', 'x2', 'x3'], ['a b c 归并', 'a', 'b', 'c 归并'], ['d', 'd', '', '']]);
check('block 段数上限（超限并入末块）',
  applyColumnSplits(
    {
      aoa: [['x'], ['a b c']],
      ctrl: [[null], [null]],
      text: [[null], [null]],
      blocks: [[null], [['a', 'b', 'c']]],
      headerRows: 1
    },
    [{ col: 0, mode: 'block', limit: 2 }]
  ),
  [['x', 'x1', 'x2'], ['a b c', 'a', 'b c']]);

// 25. block 空值/单块：原值留首段；blocks 通道缺失时 limitBlocks(null) 兜底不崩
check('block 空单元格原值留首段',
  applyColumnSplits(
    {
      aoa: [['x'], [''], ['e f']],
      ctrl: [[null], [null], [null]],
      text: [[null], [null], [null]],
      blocks: [[null], [null], [['e', 'f']]],
      headerRows: 1
    },
    [{ col: 0, mode: 'block' }]
  ),
  [['x', 'x1', 'x2'], ['', '', ''], ['e f', 'e', 'f']]);

/* ================= 列筛选（colKeys / columnLayout / filterColumns） ================= */

// 36. colKeys：唯一非空表头 → 文本；重名/空表头 → 序号；无表头 → 全序号
check('colKeys 唯一表头取文本',
  colKeys({ aoa: [['售价', '标签'], ['a', 'b']], headerRows: 1 }), ['售价', '标签']);
check('colKeys 重名回落序号',
  colKeys({ aoa: [['A', 'A', 'B'], ['x', 'y', 'z']], headerRows: 1 }), [0, 1, 'B']);
check('colKeys 空表头回落序号',
  colKeys({ aoa: [['', '备注'], ['x', 'z']], headerRows: 1 }), [0, '备注']);
check('colKeys 无表头全序号',
  colKeys({ aoa: [['a', 'b'], ['c', 'd']], headerRows: 0 }), [0, 1]);

// 37. columnLayout：无规则 = 每列一条原列条目（key/seg 对齐）
check('layout 无规则原列映射',
  columnLayout({ aoa: [['A', 'B'], ['1', '2']], headerRows: 1 }, []),
  [{ key: 'A', srcCol: 0, seg: null }, { key: 'B', srcCol: 1, seg: null }]);

// 38. columnLayout：delimiter 拆分列 = 原列 + 段列（段数取数据行最大值）
const chLayout = {
  aoa: [['标签', '备注'], ['电器、数码、母婴', 'a'], ['家居', 'b']],
  ctrl: [[null, null], [null, null], [null, null]],
  text: [[null, null], [null, null], [null, null]],
  headerRows: 1
};
check('layout delimiter 段列映射',
  columnLayout(chLayout, [{ col: '标签', mode: 'delimiter', pattern: '、' }]),
  [{ key: '标签', srcCol: 0, seg: null },
   { key: '标签#1', srcCol: 0, seg: 1 },
   { key: '标签#2', srcCol: 0, seg: 2 },
   { key: '标签#3', srcCol: 0, seg: 3 },
   { key: '备注', srcCol: 1, seg: null }]);

// 39. columnLayout：control 拆分列 = 原列 + 固定 2 段；序号 key 拼接为 "0#1"
check('layout control 段列映射（序号 key）',
  columnLayout(
    { aoa: [['x', '备注'], ['a', 'b']], ctrl: [[null, null], [['c1'], null]], text: [[null, null], ['t1', null]], headerRows: 1 },
    [{ col: 0, mode: 'control' }]
  ),
  [{ key: 'x', srcCol: 0, seg: null },
   { key: 'x#1', srcCol: 0, seg: 1 },
   { key: 'x#2', srcCol: 0, seg: 2 },
   { key: '备注', srcCol: 1, seg: null }]);

// 39b. columnLayout：control 多控件段数 = 最大控件数 + 1（与 applyColumnSplits 对齐）
check('layout control 多控件段列映射',
  columnLayout(chMultiCtrl, [{ col: '秒杀价', mode: 'control' }]),
  [{ key: '秒杀价', srcCol: 0, seg: null },
   { key: '秒杀价#1', srcCol: 0, seg: 1 },
   { key: '秒杀价#2', srcCol: 0, seg: 2 },
   { key: '秒杀价#3', srcCol: 0, seg: 3 },
   { key: '备注', srcCol: 1, seg: null }]);

// 40. columnLayout 短路：含 merges / 规则解析不到 → 与 applyColumnSplits 同判，仅原列
check('layout 含 merges 禁用',
  columnLayout({ aoa: [['A', 'B'], ['1', '2']], headerRows: 1, merges: [{ s: { r: 0, c: 0 }, e: { r: 0, c: 0 } }] },
    [{ col: 'A', mode: 'delimiter', pattern: ' ' }]),
  [{ key: 'A', srcCol: 0, seg: null }, { key: 'B', srcCol: 1, seg: null }]);
check('layout 规则解析不到',
  columnLayout({ aoa: [['A', 'B'], ['1', '2']], headerRows: 1 }, [{ col: '不存在', mode: 'delimiter', pattern: ' ' }]),
  [{ key: 'A', srcCol: 0, seg: null }, { key: 'B', srcCol: 1, seg: null }]);

// 41. columnLayout：block 模式段数按视觉块最大值（与 applyColumnSplits 一致）
check('layout block 段列映射',
  columnLayout(
    {
      aoa: [['标题/产品ID', '价'], ['t1 id1', '1'], ['t2\nid2', '2']],
      ctrl: [[null, null], [null, null], [null, null]],
      text: [[null, null], [null, null], [null, null]],
      blocks: [[null, null], [['t1', 'id1'], null], [['t2', 'id2'], null]],
      headerRows: 1
    },
    [{ col: '标题/产品ID', mode: 'block' }]
  ),
  [{ key: '标题/产品ID', srcCol: 0, seg: null },
   { key: '标题/产品ID#1', srcCol: 0, seg: 1 },
   { key: '标题/产品ID#2', srcCol: 0, seg: 2 },
   { key: '价', srcCol: 1, seg: null }]);

// 42. filterColumns：排除原列 / 排除段列 / 不存在的 key 原样返回
const aoaF = [['A', 'A1', 'A2', 'B'], ['a', 'a1', 'a2', 'b']];
const layoutF = [
  { key: 'A', srcCol: 0, seg: null }, { key: 'A#1', srcCol: 0, seg: 1 },
  { key: 'A#2', srcCol: 0, seg: 2 }, { key: 'B', srcCol: 1, seg: null }
];
check('filter 排除原列',
  filterColumns(aoaF, layoutF, new Set(['A'])),
  [['A1', 'A2', 'B'], ['a1', 'a2', 'b']]);
check('filter 排除段列',
  filterColumns(aoaF, layoutF, new Set(['A#2'])),
  [['A', 'A1', 'B'], ['a', 'a1', 'b']]);
check('filter 混合排除原列+段列',
  filterColumns(aoaF, layoutF, new Set(['A', 'A#1'])),
  [['A2', 'B'], ['a2', 'b']]);
check('filter 不存在的 key 原样',
  filterColumns(aoaF, layoutF, new Set(['不存在', 'A#9'])), aoaF);
check('filter 空排除集原样',
  filterColumns(aoaF, layoutF, new Set()), aoaF);
check('filter null 排除集原样',
  filterColumns(aoaF, layoutF, null), aoaF);
check('filter 全排除防御原样',
  filterColumns(aoaF, layoutF, new Set(['A', 'A#1', 'A#2', 'B'])), aoaF);

// 43. filterColumns：参差短行缺值补 ''
check('filter 短行补空',
  filterColumns([['A', 'A1', 'A2', 'B'], ['x']], layoutF, new Set(['A#2'])),
  [['A', 'A1', 'B'], ['x', '', '']]);

// 44. 端到端：拆分 + 筛选组合（导出主链路）：拆分结果与 layout 列号严格对齐
const chE2E = {
  aoa: [['标题/产品ID', '本地展示价', '操作'], ['T1\nI1', '4722 PHP', '删'], ['T2\nI2', '1899 PHP', '删']],
  ctrl: [[null, null, null], [null, null, null], [null, null, null]],
  text: [[null, null, null], [null, null, null], [null, null, null]],
  blocks: [[null, null, null], [['T1', 'I1'], null, null], [['T2', 'I2'], null, null]],
  headerRows: 1
};
const rulesE2E = [{ col: '标题/产品ID', mode: 'block' }];
// 排除：原列「标题/产品ID」+「操作」列 + 第 2 段（ID）→ 只导出 标题1 + 本地展示价
const excludedE2E = new Set(['标题/产品ID', '标题/产品ID#2', '操作']);
check('端到端 拆分+列筛选',
  filterColumns(applyColumnSplits(chE2E, rulesE2E), columnLayout(chE2E, rulesE2E), excludedE2E),
  [['标题/产品ID1', '本地展示价'], ['T1', '4722 PHP'], ['T2', '1899 PHP']]);

// 45. 端到端：control 拆分 + 筛选（排除原列与文本段，只留控件值列）
const chCtl = {
  aoa: [['售价', '备注'], ['2249 PHP', 'a'], ['100', 'b']],
  ctrl: [[null, null], [['2249'], null], [null, null]],
  text: [[null, null], ['PHP', null], ['100', null]],
  headerRows: 1
};
const rulesCtl = [{ col: '售价', mode: 'control' }];
check('端到端 control+列筛选',
  filterColumns(applyColumnSplits(chCtl, rulesCtl), columnLayout(chCtl, rulesCtl), new Set(['售价', '售价#2'])),
  [['售价_控件', '备注'], ['2249', 'a'], ['', 'b']]);

// 45b. 端到端：control 多控件 + 筛选（排除原列与两个文本/第二控件段，只留首个控件值列）
const rulesMC = [{ col: '秒杀价', mode: 'control' }];
check('端到端 control 多控件+列筛选',
  filterColumns(applyColumnSplits(chMultiCtrl, rulesMC), columnLayout(chMultiCtrl, rulesMC),
    new Set(['秒杀价', '秒杀价#2', '秒杀价#3'])),
  [['秒杀价_控件1', '备注'], ['10.00', 'a'], ['20.00', 'b']]);

// 46. 端到端：无规则 + 纯列筛选（不拆分也能筛）
check('端到端 无规则纯筛选',
  filterColumns(applyColumnSplits(chE2E, []), columnLayout(chE2E, []), new Set(['操作'])),
  [['标题/产品ID', '本地展示价'], ['T1\nI1', '4722 PHP'], ['T2\nI2', '1899 PHP']]);

/* ================= 列格式（toNumValue / formatColumns / applyColFormats） ================= */

// 47. toNumValue：千分位/空白剥离数值化；空值与解析失败保持原值
check('toNumValue 基本数值化',
  [toNumValue('123'), toNumValue('12.5'), toNumValue('-5'), toNumValue('007'), toNumValue(42)],
  [123, 12.5, -5, 7, 42]);
check('toNumValue 千分位与空白剥离',
  [toNumValue('1,234'), toNumValue(' 1 234 '), toNumValue('1,234.56')],
  [1234, 1234, 1234.56]);
check('toNumValue 解析失败/空值/非有限数保持原值',
  [toNumValue('abc'), toNumValue('12a'), toNumValue(''), toNumValue(null), toNumValue('1e3'), toNumValue('Infinity')],
  ['abc', '12a', '', null, 1000, 'Infinity']);

// 48. formatColumns：列格式 → 输出列号计划（keys 按源列；拆分新列继承原列格式）
check('formatColumns 无格式返回空',
  formatColumns(layoutF, ['A', 'B'], null, new Map()), []);
check('formatColumns 原列格式映射输出列号',
  formatColumns(layoutF, ['A', 'B'], null, new Map([['B', 'number']])),
  [{ col: 3, fmt: 'number' }]);
check('formatColumns 拆分新列继承原列格式',
  formatColumns(layoutF, ['A', 'B'], null, new Map([['A', 'number']])),
  [{ col: 0, fmt: 'number' }, { col: 1, fmt: 'number' }, { col: 2, fmt: 'number' }]);
check('formatColumns 列筛选后输出列号对齐',
  formatColumns(layoutF, ['A', 'B'], new Set(['A', 'A#2']), new Map([['A', 'number'], ['B', 'number']])),
  [{ col: 0, fmt: 'number' }, { col: 1, fmt: 'number' }]);
check('formatColumns 数字序号列键生效（无表头/重名兜底）',
  formatColumns([{ key: 0, srcCol: 0, seg: null }, { key: 'B', srcCol: 1, seg: null }], [0, 'B'], null, new Map([[0, 'number']])),
  [{ col: 0, fmt: 'number' }]);

// 49. applyColFormats：数字列数据行数值化；表头行不动；解析失败保持原文本
const aoaFmt = [['数量', '编号'], ['1,234', '007'], ['abc', ''], ['56', 'x']];
check('applyColFormats 数字列数值化（表头不动）',
  applyColFormats(aoaFmt, [{ col: 0, fmt: 'number' }], 1),
  [['数量', '编号'], [1234, '007'], ['abc', ''], [56, 'x']]);
check('applyColFormats 多列与解析失败保持原文本',
  applyColFormats(aoaFmt, [{ col: 0, fmt: 'number' }, { col: 1, fmt: 'number' }], 1),
  [['数量', '编号'], [1234, 7], ['abc', ''], [56, 'x']]);
check('applyColFormats 无数字列原样返回（同引用）',
  applyColFormats(aoaFmt, [], 1) === aoaFmt, true);
check('applyColFormats 短行越界列忽略',
  applyColFormats([['H'], ['1'], []], [{ col: 1, fmt: 'number' }], 1),
  [['H'], ['1'], []]);

// 50. 端到端：control 拆分 + 筛选 + 数字格式（拆分新列继承原列格式数值化）
check('端到端 control拆分+筛选+数字格式',
  applyColFormats(
    filterColumns(applyColumnSplits(chCtl, rulesCtl), columnLayout(chCtl, rulesCtl), new Set(['售价', '售价#2'])),
    formatColumns(columnLayout(chCtl, rulesCtl), colKeys(chCtl), new Set(['售价', '售价#2']), new Map([['售价', 'number']])),
    1),
  [['售价_控件', '备注'], [2249, 'a'], ['', 'b']]);

/* ================= 自适应列宽（cellWidth / autoColWidths，v1.10） ================= */

// 51. cellWidth：视觉宽度估算（半角 1、全角 2），内嵌换行取最长行，计满 cap 截断
check('cellWidth 半角/全角/谚文宽度',
  [cellWidth('abc', 50), cellWidth('中文', 50), cellWidth('，！', 50), cellWidth('한글', 50), cellWidth('a中', 50)],
  [3, 4, 4, 4, 3]);
check('cellWidth 内嵌换行取最长行',
  [cellWidth('aaa\nbbbbbbb\ncc', 50), cellWidth('\n\nxx', 50)],
  [7, 2]);
check('cellWidth 计满上限截断（超长内容无需精确计数）',
  [cellWidth('x'.repeat(999), 50), cellWidth('中'.repeat(999), 50), cellWidth('abc', 5)],
  [50, 50, 3]);

// 52. autoColWidths：逐列取最大视觉宽度，钳制 [6, 50]，输出 SheetJS !cols 结构
check('autoColWidths 逐列最大宽度与下限钳制',
  autoColWidths([['列', '标题列'], ['a', 'abcdef'], ['中文内容', 'x']]),
  [{ wch: 8 }, { wch: 6 }]);
check('autoColWidths 超长内容钳制到上限 50',
  autoColWidths([['商品标题'], ['x'.repeat(200)]]),
  [{ wch: 50 }]);
check('autoColWidths 数值按文本长度计、空值/短行/空行安全',
  autoColWidths([['数量', '备注'], [123456789012, null], ['长内容xxx', undefined], []]),
  [{ wch: 12 }, { wch: 6 }]);
check('autoColWidths 空表/空行返回空或下限',
  [autoColWidths([]), autoColWidths([null, ['a']])],
  [[], [{ wch: 6 }]]);

/* ================= 分体表格配对（table.js pairSplitGroup 纯函数，文件头部已加载） ================= */

// 描述符工厂：结构（headerRows/bodyRows/cols）+ 视觉矩形（top/height/left/width），
// 与 matchSplitGroup 从 DOM table 提取的描述符同构
function tdesc(o) {
  o = o || {};
  const top = o.top || 0;
  return {
    headerRows: o.headerRows || 0,
    bodyRows: o.bodyRows || 0,
    cols: o.cols == null ? 5 : o.cols,
    top: top,
    bottom: top + (o.height || 40),
    left: o.left || 0,
    width: o.width == null ? 800 : o.width
  };
}

// 26. 基础配对：纯表头表 + 纵向拼接的纯数据表（Element Plus el-table 结构）
check('分体配对基础',
  pairSplitGroup([tdesc({ headerRows: 1, top: 100 }), tdesc({ bodyRows: 10, top: 140 })]),
  { h: 0, b: 1 });

// 27. gutter 容忍：表头比数据表多 1 列滚动条占位（el-table 表头的 gutter th）
check('gutter 占位列容忍（列数差 1）',
  pairSplitGroup([tdesc({ headerRows: 1, cols: 6, top: 100 }), tdesc({ bodyRows: 10, cols: 5, top: 140 })]),
  { h: 0, b: 1 });

// 28. 列数差 >1：不是同一张表
check('列数差 2 不配对',
  pairSplitGroup([tdesc({ headerRows: 1, cols: 7, top: 100 }), tdesc({ bodyRows: 10, cols: 5, top: 140 })]),
  null);

// 29. 间隙超限：同容器里视觉上分离的两个独立表格（如说明表格 + 数据表格）
check('间隙超限不配对',
  pairSplitGroup([tdesc({ headerRows: 1, top: 100 }), tdesc({ bodyRows: 10, top: 180 })]),
  null);

// 30. 轻微重叠容忍：负 margin 修正等造成的 -5px 重叠仍视为拼接
check('轻微重叠容忍（负间隙）',
  pairSplitGroup([tdesc({ headerRows: 1, top: 100 }), tdesc({ bodyRows: 10, top: 135 })]),
  { h: 0, b: 1 });

// 31. 左右错位 / 宽度差异：不是同一张表
check('左右错位不配对',
  pairSplitGroup([tdesc({ headerRows: 1, left: 0, top: 100 }), tdesc({ bodyRows: 10, left: 60, top: 140 })]),
  null);
check('宽度差异超限不配对',
  pairSplitGroup([tdesc({ headerRows: 1, width: 800, top: 100 }), tdesc({ bodyRows: 10, width: 720, top: 140 })]),
  null);

// 32. 完整表格不参与配对（普通页零回归：自带表头+数据的表格既不作表头侧也不作数据侧）
check('完整表格不作表头侧',
  pairSplitGroup([tdesc({ headerRows: 1, bodyRows: 5, top: 100 }), tdesc({ bodyRows: 10, top: 140 })]),
  null);
check('完整表格不作数据侧',
  pairSplitGroup([tdesc({ headerRows: 1, top: 100 }), tdesc({ headerRows: 1, bodyRows: 10, top: 140 })]),
  null);

// 33. 颠倒：数据表在上、表头在下（如合计行表格贴在数据表格上方）不配对
check('表头数据颠倒不配对',
  pairSplitGroup([tdesc({ bodyRows: 10, top: 100 }), tdesc({ headerRows: 1, top: 140 })]),
  null);

// 34. 多候选：取首个满足纵向拼接的配对（表头侧/数据侧均按 DOM 顺序）
check('多表头表取首个拼接',
  pairSplitGroup([
    tdesc({ headerRows: 1, top: 100 }), // 与数据表间隙过大
    tdesc({ headerRows: 1, top: 500 }),
    tdesc({ bodyRows: 10, top: 540 })
  ]),
  { h: 1, b: 2 });
check('多数据表取首个拼接',
  pairSplitGroup([
    tdesc({ headerRows: 1, top: 100 }),
    tdesc({ bodyRows: 10, top: 300 }), // 间隙过大
    tdesc({ bodyRows: 5, top: 140 })
  ]),
  { h: 0, b: 2 });

// 35. 无候选：单个表头表 / 空列表
check('单个表头表无配对', pairSplitGroup([tdesc({ headerRows: 1, top: 100 })]), null);
check('空列表返回 null', pairSplitGroup([]), null);

/* ================= 持久化（persist.js 模块纯函数） ================= */

// 36. pageKeyOf：origin+pathname，忽略 query/hash（分页/筛选参数不拆散同一份配置）
check('pageKeyOf 忽略 query/hash',
  [pageKeyOf('https://a.com/list?page=2#top'), pageKeyOf('https://a.com/list')],
  ['https://a.com/list', 'https://a.com/list']);
check('pageKeyOf 非法 URL 返回 null', pageKeyOf('not-a-url'), null);

// 37. tableKeyOf：表头单元格文本归一化后以 \u0001 拼接（保存/恢复同源；指纹绝不取数据行）
check('tableKeyOf 容器取首个 table 表头归一化拼接',
  tableKeyOf({
    tagName: 'DIV',
    querySelector: () => ({ rows: [{ cells: [{ textContent: ' 标题 ' }, { textContent: '产品\nID' }] }] })
  }),
  '标题\u0001产品 ID');
check('tableKeyOf 直接传 table',
  tableKeyOf({ tagName: 'TABLE', rows: [{ cells: [{ textContent: 'A' }, { textContent: '\u00a0' }] }] }),
  'A\u0001');
check('tableKeyOf 无 table / 无行 / 无单元格返回 null',
  [
    tableKeyOf({ tagName: 'DIV', querySelector: () => null }),
    tableKeyOf({ tagName: 'TABLE', rows: [] }),
    tableKeyOf({ tagName: 'TABLE', rows: [{ cells: [] }] })
  ],
  [null, null, null]);

// 37b. thead 直接嵌 th 无 tr（vxe-table 等组件库）：取 thead 子元素而非 tbody
// 首条数据行（数据行在虚拟滚动下动态渲染，指纹必须稳定在表头上）
check('tableKeyOf thead 无 tr 取 th 子元素（不落数据行）',
  tableKeyOf({
    tagName: 'TABLE',
    tHead: { querySelectorAll: () => [], children: [{ tagName: 'TH', textContent: '标题' }, { tagName: 'TD', textContent: 'ID' }] },
    rows: [{ cells: [{ textContent: '数据行1' }] }]
  }),
  '标题\u0001ID');
check('tableKeyOf thead 有 tr 跳过空占位行取首个非空行',
  tableKeyOf({
    tagName: 'TABLE',
    tHead: { querySelectorAll: () => [{ cells: [] }, { cells: [{ textContent: 'A' }] }], children: [] },
    rows: [{ cells: [{ textContent: '数据' }] }]
  }),
  'A');
check('tableKeyOf 无 thead 时 rows 首个非空行兜底（跳过占位空行）',
  tableKeyOf({
    tagName: 'TABLE',
    tHead: null,
    rows: [{ cells: [] }, { cells: [{ textContent: 'X' }, { textContent: 'Y' }] }]
  }),
  'X\u0001Y');
check('tableKeyOf thead 全空且 rows 全空返回 null',
  tableKeyOf({ tagName: 'TABLE', tHead: { querySelectorAll: () => [{ cells: [] }], children: [] }, rows: [] }),
  null);

// 38. sanitizeRecord：损坏字段剔除、类型归位（数字列键=列序号兜底）
check('sanitizeRecord 合法规整原样通过',
  sanitizeRecord({ rules: [{ col: '标题', mode: 'block', pattern: 'x', limit: 3 }], excluded: ['标题#1'], formats: [['标题', 'number']], updatedAt: 123 }),
  { rules: [{ col: '标题', mode: 'block', pattern: 'x', limit: 3 }], excluded: ['标题#1'], formats: [['标题', 'number']], updatedAt: 123 });
check('sanitizeRecord 剔除非法 mode、pattern/limit 类型归位',
  sanitizeRecord({ rules: [{ col: 'A', mode: 'wrong' }, { col: 0, mode: 'delimiter', pattern: 5, limit: '3' }], excluded: ['B', 2, null, ''], updatedAt: 'x' }),
  { rules: [{ col: 0, mode: 'delimiter', pattern: '5', limit: null }], excluded: ['B', 2], formats: [], updatedAt: 0 });
check('sanitizeRecord 规则字段补全',
  sanitizeRecord({ rules: [{ col: 'A', mode: 'control' }], excluded: [] }),
  { rules: [{ col: 'A', mode: 'control', pattern: '', limit: null }], excluded: [], formats: [], updatedAt: 0 });
check('sanitizeRecord formats 键值对规整（非法键值/非文本格式剔除）',
  sanitizeRecord({ rules: [], excluded: [], formats: [['售价', 'number'], [0, 'number'], ['x', 'text'], ['y', null], 'bad', [null, 'number']], updatedAt: 5 }),
  { rules: [], excluded: [], formats: [['售价', 'number'], [0, 'number']], updatedAt: 5 });
check('sanitizeRecord 仅 formats 也保留（全空仍返回 null）',
  [!!sanitizeRecord({ formats: [['售价', 'number']] }), sanitizeRecord({ rules: [], excluded: [], formats: [] })],
  [true, null]);
check('sanitizeRecord 全空 / 非对象返回 null',
  [sanitizeRecord({ rules: [], excluded: [] }), sanitizeRecord(null), sanitizeRecord('x')],
  [null, null, null]);

// 39. evictKeys：LRU 淘汰（页最新 = 各表记录 updatedAt 最大值；当前页豁免；非本扩展键忽略）
const evictAll = {
  'h2x.v1:p:https://a/1': { t1: { updatedAt: 100 } },
  'h2x.v1:p:https://a/2': { t1: { updatedAt: 300 }, t2: { updatedAt: 500 } }, // 页最新取最大值 500
  'h2x.v1:p:https://a/3': { t1: { updatedAt: 200 } },
  'other-key': { x: 1 } // 非本扩展键不参与
};
check('evictKeys 未超限不淘汰', evictKeys(evictAll, 'h2x.v1:p:https://a/2', 10), []);
check('evictKeys 超限淘汰最旧（当前页豁免）',
  evictKeys(evictAll, 'h2x.v1:p:https://a/2', 2),
  ['h2x.v1:p:https://a/1']);
check('evictKeys 损坏页视为最旧优先淘汰',
  evictKeys({ 'h2x.v1:p:bad': 'corrupt', 'h2x.v1:p:a': { t: { updatedAt: 1 } } }, 'h2x.v1:p:cur', 2),
  ['h2x.v1:p:bad']);

// 40. 导出格式序列化（format.js：csv/json/md/html 纯函数）
check('csvCell 普通值直出（null 归空串、数值字符串化）',
  [csvCell('abc'), csvCell(123), csvCell(null)],
  ['abc', '123', '']);
check('csvCell RFC4180 转义（逗号/引号/换行双引号包裹、内部引号翻倍）',
  [csvCell('a,b'), csvCell('a"b'), csvCell('a\nb'), csvCell('a\r\nb')],
  ['"a,b"', '"a""b"', '"a\nb"', '"a\r\nb"']);
check('toCsv 带 BOM 与 CRLF 行尾（转义单元格生效）',
  toCsv([['h1', 'h2'], ['a,b', 'c']]),
  '\ufeffh1,h2\r\n"a,b",c\r\n');
check('toCsv 空表输出仅 BOM',
  toCsv([]),
  '\ufeff');

check('headerKeys 末行表头 / 重名加序号 / 空名补列N / 无表头',
  [headerKeys([['x', 'y'], ['a', 'b']], 2), headerKeys([['a', 'a']], 1),
   headerKeys([['a', null], [1, 2]], 1), headerKeys([[1, 2]], 0)],
  [['a', 'b'], ['a', 'a(2)'], ['a', '列2'], ['列1', '列2']]);
check('rowObjects 表头行不入数据 / 值原样（数值保持数值、缺失归空串）',
  rowObjects([['a', 'b'], ['1', 2], [null, 'x']], 1),
  [{ a: '1', b: 2 }, { a: '', b: 'x' }]);
check('toJson 单表 = 行对象数组',
  JSON.parse(toJson([{ name: 't', aoa: [['a', 'b'], ['1', '2']], headerRows: 1 }])),
  [{ a: '1', b: '2' }]);
check('toJson 多表 = 表名键嵌套',
  JSON.parse(toJson([
    { name: 'S1', aoa: [['a'], ['1']], headerRows: 1 },
    { name: 'S2', aoa: [['b'], ['2']], headerRows: 1 }
  ])),
  { S1: [{ a: '1' }], S2: [{ b: '2' }] });

check('mdCell 竖线转义 / 换行转 <br> / 回车删除 / null 归空串',
  [mdCell('a|b'), mdCell('a\nb'), mdCell('a\r\nb'), mdCell(null)],
  ['a\\|b', 'a<br>b', 'a<br>b', '']);
check('toMarkdown 结构（标题/表头/分隔行/数据行/多表空行分隔）',
  toMarkdown([
    { name: 'T1', aoa: [['a', 'b'], ['1', '2']], headerRows: 1 },
    { name: 'T2', aoa: [['x'], ['y']], headerRows: 1 }
  ]),
  '## T1\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n## T2\n\n| x |\n| --- |\n| y |\n');
check('toMarkdown 无表头生成列N表头（GFM 表格必须有表头）',
  toMarkdown([{ name: 'T', aoa: [['1', '2']], headerRows: 0 }]),
  '## T\n\n| 列1 | 列2 |\n| --- | --- |\n| 1 | 2 |\n');

const htmlOut = toHtmlDocument([{ name: 'T<i>', aoa: [['a&b', 'c'], ['1', '2']], headerRows: 1 }], 'P&1');
check('toHtmlDocument 结构与转义（文档骨架/标题/th/td）',
  [htmlOut.indexOf('<!DOCTYPE html>') === 0,
   htmlOut.includes('<meta charset="utf-8">'),
   htmlOut.includes('<title>P&amp;1</title>'),
   htmlOut.includes('<h2>T&lt;i&gt;</h2>'),
   htmlOut.includes('<thead>\n<tr><th>a&amp;b</th><th>c</th></tr>\n</thead>'),
   htmlOut.includes('<tbody>\n<tr><td>1</td><td>2</td></tr>\n</tbody>')],
  [true, true, true, true, true, true]);
const htmlOut2 = toHtmlDocument([
  { name: 'A', aoa: [['1']], headerRows: 0 },
  { name: 'B', aoa: [['x']], headerRows: 1 }
], '');
check('toHtmlDocument 多表串接 / 无表头全 td / 默认标题',
  [htmlOut2.includes('<h2>A</h2>\n<table>\n<tbody>\n<tr><td>1</td></tr>'),
   htmlOut2.includes('<h2>B</h2>\n<table>\n<thead>\n<tr><th>x</th></tr>\n</thead>'),
   htmlOut2.includes('<title>导出表格</title>')],
  [true, true, true]);

// 41. 通用工具（util.js）
check('sanitizeFilename Windows 非法字符替换 / 去首尾空白 / 空值兜底',
  [util.sanitizeFilename('a\\b/c:d*e?f"g<h>i|j'), util.sanitizeFilename('  订单  '),
   util.sanitizeFilename(null), util.sanitizeFilename('')],
  ['a_b_c_d_e_f_g_h_i_j', '订单', '', '']);
check('escapeHtml 五字符转义 / 普通文本原样',
  [util.escapeHtml('&<>"\''), util.escapeHtml('<script>alert("x")</script>'),
   util.escapeHtml('普通文本 123')],
  ['&amp;&lt;&gt;&quot;&#39;', '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;', '普通文本 123']);

// 42. 工作表名生成（table.js makeSheetName；table 参数以对象桩模拟 caption/aria-label/id）
const stubTable = (captionText, ariaLabel, id) => ({
  querySelector: (sel) => (sel === 'caption' && captionText != null ? { innerText: captionText } : null),
  getAttribute: (name) => (name === 'aria-label' && ariaLabel != null ? ariaLabel : null),
  id: id || ''
});
check('makeSheetName caption 优先 / aria-label / id / 序号兜底',
  [makeSheetName(stubTable('销售明细'), 0, new Set()),
   makeSheetName(stubTable(null, '支付宝订单'), 1, new Set()),
   makeSheetName(stubTable(null, null, 'tbl1'), 2, new Set()),
   makeSheetName(stubTable(null), 3, new Set())],
  ['销售明细', '支付宝订单', 'tbl1', '表格4']);
check('makeSheetName 非法字符转空格 + 连续空白折叠 + 首尾去空',
  makeSheetName(stubTable('  a:b\\c/d?e*f[g]h  '), 0, new Set()),
  'a b c d e f g h');
check('makeSheetName 超 31 字符截断 / 恰好 31 不动',
  [makeSheetName(stubTable('x'.repeat(40)), 0, new Set()).length,
   makeSheetName(stubTable('y'.repeat(31)), 0, new Set()).length],
  [31, 31]);
check('makeSheetName 重名加 (n) 后缀 / 长名截断留后缀空间',
  [makeSheetName(stubTable('订单'), 0, new Set(['订单'])),
   makeSheetName(stubTable('订单'), 0, new Set(['订单', '订单(2)'])),
   makeSheetName(stubTable('z'.repeat(40)), 0, new Set(['z'.repeat(31)]))],
  ['订单(2)', '订单(3)', 'z'.repeat(28) + '(2)']);
check('makeSheetName 空 caption 文本回落 aria-label / 纯空白回落序号兜底',
  [makeSheetName(stubTable('', '支付宝订单'), 0, new Set()),
   makeSheetName(stubTable('   '), 0, new Set())],
  ['支付宝订单', '表格1']);

console.log(fail === 0 ? '\n全部通过' : '\n' + fail + ' 个失败');
process.exit(fail === 0 ? 0 : 1);
