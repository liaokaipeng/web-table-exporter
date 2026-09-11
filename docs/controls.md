# 控件值导出规则

目标 **所见即所得**：优先展示值，其次控件实时状态。实现见 `extension/content/controls.js` 的 `controlValue()`，测试见 `test/fixture.html` 第 4 节。

## 判定流程

逐层下探，命中层即取值来源，未命中走纯文本兜底：

```
单元格
  ├─ 含原生表单控件？    → A 原生取值
  ├─ 含 ARIA 控件角色？  → B ARIA 取值
  ├─ 含组件库类名？      → C 类名兜底取值
  └─ 均无控件            → D 纯文本（innerText 归一化）
```

`CONTROL_SEL` 取候选（原生表单 + ARIA 角色 + 类名含 switch）逐个送 `controlValue()`：返回替换文本则克隆替换，返回 `null` 则保留原样由 innerText 兜底（误匹配无损）。多控件按 DOM 序各取各值；嵌套命中（el-switch 外层 div + 内部原生 checkbox）先替外层，内层克隆已脱离、替换失效，不重复输出。

## 取值规则

### A 原生表单元素

|控件|取值|
|---|---|
|`input` 文本类/`date`/`number`/`color`/`range`、`textarea`、`output`|`el.value`（实时值，读原元素）|
|`select` 单选|选中项「显示文本(value)」|
|`select` 多选|各选中项「文本(value)」顿号分隔|
|`checkbox`/`radio`|勾选 → 是/否|
|`input[type=hidden]`|忽略（导出为空）|

option 细节：value 为空或等于文本则只留文本（避免 `已发货(已发货)`）。

### B ARIA 控件角色

|角色|取值|
|---|---|
|`switch`/`checkbox`/`radio`|`aria-checked` → 是/否|
|`combobox`/`listbox`|选中项（`aria-selected=true`）文本顿号分隔；无选中项（触发器）→ innerText 兜底|
|`slider`/`spinbutton`|`aria-valuenow`|

### C 组件库类名兜底

|形态|取值|
|---|---|
|`el-switch`/`ant-switch`/`van-switch` 等（token 为 `switch` 或 `-switch` 结尾）|含 `checked`/`--on`/`--active` → 是，否则否（`unchecked` 排除）|
|`el-date-editor`/`ant-picker` 等日期组件|内部展示 input 的 `value`（经 A 层覆盖）|

### D 纯文本兜底

无控件 → `innerText` 归一化（换行/连续空格/nbsp 压为单空格）。

## 边界与风险

- 类名匹配最脆弱（库改版可能失效）：未命中静默回退 `innerText`，不报错不阻塞；形似开关元素（如 `tab-switch--active`）可能误判
- ARIA/类名仅覆盖常见库（Element / Ant Design / Vant / Naive UI）；下拉组件（el-select / ant-select）取触发器文本经 innerText；选择器变宽开销可忽略（逐单元格子树扫描）

覆盖与预期见 [test/README.md](../test/README.md)。
