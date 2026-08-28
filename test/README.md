# 测试与回归

测试材料在 `test/`（开发材料，不随插件分发），预期值均已在各页行内标注。

## 覆盖矩阵

| 材料 | 覆盖 | 预期 |
|---|---|---|
| `fixture.html` | 普通表格、rowspan/colspan 合并（带 caption）、空单元格/长文本、控件取值（第 4 节：select 单/多选、空值/value=文本、checkbox/radio、hidden、date/textarea/output、一格多控件、ARIA switch/slider/listbox/combobox、el/ant/van 组件开关、嵌套开关、类名形似非开关回退）、列拆分（第 5 节：控件值拆分（含同格多控件各自成列，复刻店小秘秒杀价/库存双输入）、按换行拆分、分隔符拆分、智能预填、段数不足补空、合并表格禁用）、分体表格合并（第 6 节：表头/表体两个 table 复刻 Element Plus el-table，垂直+水平双向滚动裁剪（表宽 860 > 容器 620，表头 scrollLeft 同步）、gutter 占位列）、图片链接导出（第 8 节：纯图片/图片+文字/无链接图片/控件+图片/双行格含图按换行拆分）、列格式（第 9 节：文本=默认零回归、数字列数值化（千分位剥离、解析失败保原文本）、拆分新列继承、合并单元格表格仍可设置）、选择模式下链接不跳转 | 行内「预期导出」列 |
| `virtual-fixture.html` | 60 行虚拟滚动（thead 无 tr、input/select 由 JS 属性设值模拟 Vue、el-switch 开关列）；分体表格 + 虚拟滚动组合（表头/表体两个 table 复刻 vxe-table，滚动容器在数据表上层）；采集后拆分列面板回归（预期值见页内说明） | 61 行全采集（60 数据 + 表头）；序号 1/26/41 三行内容完全相同应全部保留（重复行不误删）；发货仓「华东仓(1)/华南仓(2)」、开关「是/否」；分体表悬浮整体高亮、一次点选、采集 41 行（40 数据 + 表头）、一口价取 JS 实时值 |
| `auto-check.html` | DOM 层自动化回归（无扩展环境，页内自判 PASS/FAIL）：控件取值（controls.controlValue：input/checkbox/radio/hidden/date/textarea/output、select 单/多选、ARIA switch/slider、el-switch 类名开关、类名形似回退 null）；单元格四通道（cell.openBatch：空白归一化、nbsp/换行/连续空格压缩、控件 merged/text/ctrl 三通道、多控件对齐、嵌套开关不重复计数、图片绝对链接、无 src 图片为空）；表格提取（table.extractTable：常规 thead、rowspan/colspan 展开+merges、多行表头、无 thead 全 th 行计表头、display:none 行过滤）；导出管线端到端（提取→block+control 拆分→列筛选→数字格式→csv/json 精确对比，JS 属性设值复刻 Vue 实时状态） | 页内 summary「37 项全部 PASS」 |
| `algo-check.cjs` | 采集算法回归：滑动窗口去重、合法重复行保留、非虚拟误报无损、渲染延迟、5000 行性能。列拆分纯函数回归：三模式（control/block/delimiter，control 含多控件各自成列/参差补齐/空值占位）、段数上限、从右到左多规则、块内空格不拆（对照 delimiter）、参差行补齐、多行表头、含 merges 禁用。列筛选纯函数回归：colKeys 唯一表头/重名/空表头兜底、columnLayout 段列映射与短路、filterColumns 排除/全排除防御/短行补空、拆分+筛选端到端。列格式纯函数回归：toNumValue 千分位剥离/解析失败保原值、formatColumns 输出列号映射（拆分新列继承、筛选后对齐）、applyColFormats 表头不动/同引用短路、control/block 拆分+筛选+数字格式端到端。分体配对纯函数回归（table.js `pairSplitGroup`）：基础配对、gutter 列容忍（列数差 1）、间隙/对齐/宽度/列数阈值、轻微重叠容忍、完整表格零回归（两侧均不参与）、颠倒不配对、多候选首个命中。持久化纯函数回归（persist.js）：pageKeyOf 忽略 query/hash、tableKeyOf 指纹拼接（含 thead 无 tr 的 vxe-table 写法取 th 子元素而非数据行）与空值、sanitizeRecord 损坏数据剔除与类型归位（含 formats 键值对）、evictKeys LRU 淘汰。通用工具回归（util.js）：sanitizeFilename Windows 非法字符替换、escapeHtml 五字符转义。工作表名生成回归（table.js makeSheetName，对象桩模拟 DOM）：caption/aria-label/id/序号四级兜底、非法字符转空格与空白折叠、31 字符截断、重名 (n) 后缀 | 全部 PASS |

## 命令

```powershell
Get-ChildItem extension/content/*.js | ForEach-Object { node --check $_.FullName }
node --check extension/background/service-worker.js
node test/algo-check.cjs

# DOM 自动回归（auto-check.html，无扩展环境）：
npx serve .   # 仓库根目录起静态服务 → 访问 /test/auto-check.html，页内自判 PASS/FAIL
```

## 浏览器回归步骤

1. `chrome://extensions` 刷新扩展（目录变更后需重新加载 `extension/` 目录）
2. 刷新目标测试页
3. 选择表格导出，对照页内预期值
4. 持久化回归（v1.7）：
   - 保存恢复：列设置保存（含拆分规则、列筛选与列格式）→ 刷新页面 → 重进选择模式选同表 → 工具栏提示「已恢复上次的列设置」，面板显示已保存配置，导出生效
   - 取消选择不清存储：选中已保存配置的表 → 点击取消选中 → 再选中 → 配置自动恢复
   - 重置路径：面板全不拆 + 全列导出 + 全列文本格式 → 保存 → 刷新重选 → 回落智能预填默认（无恢复提示）
   - 表头变更不恢复：保存配置后用 DevTools 改该表任一 th 文本（勿刷新，改动只在本轮 DOM）→ 取消选中再选中 → 不恢复（指纹不匹配，无恢复提示）
   - 虚拟表同流程：virtual-fixture.html 采集完成后保存配置，验证重进后采集完成即恢复

控件取值规则见 [docs/controls.md](../docs/controls.md)；真实页面回归：点三咪折扣活动编辑页（长列表 + 一口价 input 列）。
