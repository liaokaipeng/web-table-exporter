# 列拆分功能规划（v1.3，已实现）

导出前对表格列按规则拆分为多列。v1 三种模式，均无损、均保留原列（新列追加其后，错了可删）。

## 已确认决策

| 决策点 | 结论 |
|---|---|
| 拆分方式 | 三种：控件来源拆分 / 按换行拆分 / 分隔符拆分 |
| 交互入口 | 工具栏「拆分列」按钮 → 配置面板（智能预填 + 实时预览） |
| 合并单元格 | 含 merges 的普通表格禁用拆分（面板标注，导出二次防御） |
| 原列保留 | 一律保留（不做开关） |

## 三种模式

| 模式 | 面板文案 | 行为 |
|---|---|---|
| control | 拆出输入框的值 | 控件值列 + 页面文本列；控件值含分隔符时唯一正确解（如 input 值 `New York` + 文本 `USA`，按空格拆会错） |
| block | 按换行拆分 | 格内多行文本（块级元素边界）按行拆成多列，行内空格不拆；如「标题/产品ID」双行格 → 标题列 + ID 列（店小秘场景，按空格拆会把标题拆碎） |
| delimiter | 按符号拆开 | 按分隔符拆纯文本为多段；超段数上限并入末段 |

- 含控件列上 delimiter / block 仍可用（前者作用于归一化文本，后者作用于替换控件值后的视觉块），差异由预览自证
- 一列一规则；同一表可对不同列各配一条

## 规则模型与执行

```
rule = { col, mode: 'control' | 'block' | 'delimiter', pattern, limit }
```

- col 按表头文本匹配（多行表头取首行）；无表头或重名兜底列序号；导出时解析不到则静默跳过该规则
- pattern 仅 delimiter：分隔符字符串，默认预填探测结果（空格 / `、` / `,` / `:`）
- limit 段数上限：空 = 不限，超限并入末段（delimiter 并入末段、block 并入末块）；硬校验为分隔符非空、limit 为空或 ≥ 2
- 新列名自动生成：`原名_控件 / 原名_文本`（control）、`原名1 / 原名2…`（block / delimiter）；多行表头只在首行写名，其余表头行留空
- 多规则按目标列原始索引**从右到左**逐条应用（右侧先拆不影响左侧索引），逐条重排
- 拆分前按最大列数补齐行

## 数据流与通道

```
extractTable() ──→ {aoa, merges, ctrl, text, blocks} ─┐
                                                      ├→ applyColumnSplits(通道, rules) → aoa_to_sheet
虚拟表格快照 ──→ {rows, ctrl, text, blocks} ─────────┘
```

`cellText()` 重构为 `cellParts() → { merged, ctrl, text, blocks }`：

- merged：控件替换为实时值后的完整文本（默认导出不变，向后兼容）
- ctrl：控件实时值（多控件格过滤空值后按出现顺序顿号连接；未命中候选的留在 text）
- text：移除命中控件后的页面文本
- blocks：视觉文本块数组（innerText 按换行切分；块级元素边界，行内空格不拆）

实现沿用克隆骨架：一次克隆、一次离屏挂载、两轮 innerText（替换控件得 merged、
移除控件得 text；blocks 取第一轮结果按换行 split）；值直读原元素（cloneNode 丢
属性设值）；离屏容器不加 `visibility:hidden`。

通道须采集时就存：`extractTable` 增产 ctrl / text / blocks 同形状数组（无控件格
ctrl 为 null）；`collectVirtual` 与行数组**同索引**累积（表头行同样对齐，重叠
合并同步裁剪），快照升级为 `{ rows, ctrl, text, blocks }`。

## 交互

- 「拆分列」按钮：仅已选 ≥ 1 个表格时可用（与导出按钮同一启用条件）
- 智能预填：多块文本列（非空数据行 ≥2 且全部 ≥2 块，如「标题/产品ID」双行格）
  默认勾选并预设 block；含非空 ctrl 通道的列预设 control 但不勾选（由用户确认）；
  纯文本列探测分隔符预填 pattern（默认不勾选）；预填均可改
- 面板流程：选表格（Sheet 序号）→ 列清单（表头名，控件列/多行列标徽标）
  → 改参数 → 前 3 行拆分前后预览实时刷新 → 保存。普通表现跑
  extractTable 取样；虚拟表须先采集完成
- 按键：面板打开时 Esc 只关面板、Enter 提交；主工具栏导出/取消同步禁用
  （onKeyDown 需区分面板状态）
- 空格分隔符不可见：输入框以占位符或特殊标记呈现预填的空格
- 规则存内存 Map（key 为 table）；取消选择该表时同步删除其规则；exit() 全部
  清空，不碰 chrome.storage（权限最小化）

## 边界情况

| 场景 | 结果 |
|---|---|
| 纯 input 格（无相邻文本） | control 文本列为空 |
| 纯文本格 | control 控件列为空，整值留文本列 |
| 多控件格 | 过滤空值后按出现顺序顿号连接 |
| 开关/勾选格 | 「是/否」进控件列 |
| input[type=hidden] | 不贡献任何通道（同现状） |
| 分隔符无命中 / 空单元格 | 原值留首段，其余为空，不报错 |
| 单行文本格用 block 拆 | 单块原值留首段（同分隔符无命中语义） |
| 块内含空格的标题（block） | 行内空格不拆（对照：delimiter 按空格会拆碎） |

## 实施切分

1. `cellParts` 重构（`cellText` 变薄封装保回归）+ 通道接入 `extractTable` / `collectVirtual`
2. `applyColumnSplits` 纯函数 + `test/algo-check.cjs` 用例（三模式、段数上限、
   从右到左多规则、control 通道、控件值含空格/块内空格的对照用例）
3. 面板 UI：智能预填、分隔符/多块探测、实时预览、按键调整、`doExport` 接线、规则 Map
4. `test/fixture.html` 增混排列（`PHP <input>` → 预期 `2249 | PHP`）与双行格
   （`PHP <div>标题</div><div>ID</div>` → 预期 `标题 | ID`）、
   `test/virtual-fixture.html` 回归 control / block 模式；文档同步 v1.3：
   product.md 版本历史、architecture.md 模块职责表、README.md 功能列表、
   manifest.json 版本号

## 验证

- `node test/algo-check.cjs`：applyColumnSplits 用例（三模式、段数上限、
  从右到左、control 通道、分隔符无命中、块内空格不拆）
- `node --check content/content.js`
- 浏览器回归：fixture / virtual-fixture 两页，含合并表格禁用拆分路径；
  真实页面回归店小秘列表页（标题/产品ID 双行格）
- 现有导出行为零回归：不配任何规则时导出结果与 v1.2 完全一致（cellText
  薄封装 + 通道 null 兜底保证）
