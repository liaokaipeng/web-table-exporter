// 算法回归测试：验证「相邻窗口重叠合并」采集算法与「列拆分」纯函数的各场景
// - 采集场景与 content.js 中 overlapLen + takeWindow 逻辑一致
// - 列拆分函数从 content/content.js 按标记提取（保证与实现同步）
const fs = require('fs');
const path = require('path');

function overlapLen(acc, win) {
  const max = Math.min(acc.length, win.length, 200);
  for (let k = max; k >= 1; k--) {
    let ok = true;
    for (let i = 0; i < k; i++) {
      if (acc[acc.length - k + i] !== win[i]) { ok = false; break; }
    }
    if (ok) return k;
  }
  return 0;
}

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

// 已知限制（不在断言内，记录用）：数据全同 + 虚拟滚动 + 整窗重建时，
// 内容匹配无法区分重叠与新行，理论上会少采。普通场景（行内容各异或部分重复）均正确。

/* ================= 列拆分（applyColumnSplits 等，从 content.js 提取） ================= */

const contentSrc = fs.readFileSync(path.join(__dirname, '..', 'content', 'content.js'), 'utf8');
const MARK_A = '// [h2x-split-begin]';
const MARK_B = '// [h2x-split-end]';
const posA = contentSrc.indexOf(MARK_A);
const posB = contentSrc.indexOf(MARK_B);
if (posA < 0 || posB < 0 || posB < posA) {
  console.log('FAIL 未在 content.js 中找到列拆分标记');
  process.exit(1);
}
const chunk = contentSrc.slice(posA + MARK_A.length, posB);
const { splitByDelimiter, splitBlocks, limitBlocks, resolveRuleCol, applyColumnSplits } =
  new Function(chunk + '\nreturn { splitByDelimiter, splitBlocks, limitBlocks, resolveRuleCol, applyColumnSplits };')();

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

// 10. control 模式：控件值列 + 文本列；纯文本格整值留文本列
const chControl = {
  aoa: [['售价', '备注'], ['2249 PHP', 'a'], ['100', 'b']],
  ctrl: [[null, null], ['2249', null], [null, null]],
  text: [[null, null], ['PHP', null], ['100', null]],
  headerRows: 1
};
check('control 拆分',
  applyColumnSplits(chControl, [{ col: '售价', mode: 'control' }]),
  [['售价', '售价_控件', '售价_文本', '备注'],
   ['2249 PHP', '2249', 'PHP', 'a'],
   ['100', '', '100', 'b']]);

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
  ctrl: [[null], ['New York']],
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

console.log(fail === 0 ? '\n全部通过' : '\n' + fail + ' 个失败');
process.exit(fail === 0 ? 0 : 1);
