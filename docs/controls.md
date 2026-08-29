# 控件值导出规则

目标：**所见即所得**——导出用户看到的展示值，其次取控件实时状态。
实现见 `extension/content/controls.js` 的 `controlValue()`，测试见 `test/fixture.html` 第 4 节。

## 判定流程

单元格按优先级逐层下探，命中的层决定取值来源；均未命中走纯文本兜底：

```
单元格
  ├─ 含原生表单控件？    → A 原生取值
  ├─ 含 ARIA 控件角色？  → B ARIA 取值
  ├─ 含组件库类名？      → C 类名兜底取值
  └─ 均无控件            → D 纯文本（innerText 归一化）
```

统一选择器 `CONTROL_SEL` 取「控件候选」（原生表单 + ARIA 角色 + 类名含 switch），逐个送 `controlValue()` 精确判定：返回替换文本则克隆替换，返回 `null` 则保留原样由 innerText 兜底（误匹配无损）。单元格内多个控件按 DOM 顺序各取各值；嵌套命中（如 el-switch 外层 div + 内部原生 checkbox）按文档序先替换外层，内层克隆已脱离、替换自动失效，不产生重复输出。

## 取值规则

### A 原生表单元素

| 控件 | 取值 |
|---|---|
| `input` 文本类 / `date` / `number` / `color` / `range`、`textarea`、`output` | `el.value`（实时值，从原元素读取） |
| `select` 单选 | 选中项「显示文本(value)」 |
| `select` 多选 | 各选中项「文本(value)」顿号分隔 |
| `checkbox` / `radio` | 勾选 → 是 / 否 |
| `input[type=hidden]` | 忽略（导出为空） |

option 格式细节：value 为空或与显示文本相同则只留文本（避免 `已发货(已发货)`）。

### B ARIA 控件角色

| 角色 | 取值 |
|---|---|
| `switch` / `checkbox` / `radio` | `aria-checked` → 是 / 否 |
| `combobox` / `listbox` | 单元格内选中项（`aria-selected=true`）文本，顿号分隔；无选中项（触发器场景）→ innerText 兜底 |
| `slider` / `spinbutton` | `aria-valuenow` |

### C 组件库类名兜底

| 形态 | 取值 |
|---|---|
| `el-switch` / `ant-switch` / `van-switch` 等（类名 token 为 `switch` 或以 `-switch` 结尾） | 类名含 `checked` / `--on` / `--active` → 是，否则否（`unchecked` 排除） |
| `el-date-editor` / `ant-picker` 等日期组件 | 内部展示 input 的 `value`（天然经 A 层覆盖） |

### D 纯文本兜底

无任何控件 → `innerText` 归一化（换行/连续空格/nbsp 压缩为单个空格）。

## 边界与风险

- 类名匹配最脆弱（组件库改版可能失效）：未命中时静默回退 `innerText`，不报错不阻塞导出；极少数类名形似开关的非开关元素（如 `tab-switch--active`）理论上会误判
- ARIA/类名判定以常见库（Element / Ant Design / Vant / Naive UI）为主，无法穷尽所有组件库
- 下拉类组件（el-select / ant-select）的当前值以触发器展示文本经 innerText 导出，不依赖弹层
- 选择器变宽的性能开销可忽略（逐单元格子树扫描）

覆盖与预期见 [test/README.md](../test/README.md)。
