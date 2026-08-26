# 测试与回归

测试材料在 `test/`（开发材料，不随插件分发），预期值均已在各页行内标注。

## 覆盖矩阵

| 材料 | 覆盖 | 预期 |
|---|---|---|
| `fixture.html` | 普通表格、rowspan/colspan 合并（带 caption）、空单元格/长文本、控件取值（第 4 节：select 单/多选、空值/value=文本、checkbox/radio、hidden、date/textarea/output、一格多控件、ARIA switch/slider/listbox/combobox、el/ant/van 组件开关、嵌套开关、类名形似非开关回退）、列拆分（第 5 节：控件值拆分、按换行拆分、分隔符拆分、智能预填、段数不足补空、合并表格禁用）、选择模式下链接不跳转 | 行内「预期导出」列 |
| `virtual-fixture.html` | 60 行虚拟滚动（thead 无 tr、input/select 由 JS 属性设值模拟 Vue、el-switch 开关列）；采集后拆分列面板回归（预期值见页内说明） | 61 行全采集（60 数据 + 表头）；序号 1/26/41 三行内容完全相同应全部保留（重复行不误删）；发货仓「华东仓(1)/华南仓(2)」、开关「是/否」 |
| `algo-check.cjs` | 采集算法回归：滑动窗口去重、合法重复行保留、非虚拟误报无损、渲染延迟、5000 行性能。列拆分纯函数回归：三模式（control/block/delimiter）、段数上限、从右到左多规则、块内空格不拆（对照 delimiter）、参差行补齐、多行表头、含 merges 禁用 | 全部 PASS |

## 命令

```powershell
Get-ChildItem extension/content/*.js | ForEach-Object { node --check $_.FullName }
node --check extension/background/service-worker.js
node test/algo-check.cjs
```

## 浏览器回归步骤

1. `chrome://extensions` 刷新扩展（目录变更后需重新加载 `extension/` 目录）
2. 刷新目标测试页
3. 选择表格导出，对照页内预期值

控件取值规则见 [docs/controls.md](../docs/controls.md)；真实页面回归：点三咪折扣活动编辑页（长列表 + 一口价 input 列）。
