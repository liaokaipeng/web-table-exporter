// 临时算法验证（运行后删除）：验证「相邻窗口重叠合并」采集算法的各场景
// 场景与 content.js 中 overlapLen + takeWindow 逻辑一致

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

console.log(fail === 0 ? '\n全部通过' : '\n' + fail + ' 个失败');
process.exit(fail === 0 ? 0 : 1);
