# 测试与回归

测试材料在 `test/`（开发材料，不随插件分发），预期值均已在各页行内标注。

## 覆盖矩阵

| 材料 | 覆盖 | 预期 |
|---|---|---|
| `fixture.html` | 普通表格、rowspan/colspan 合并（带 caption）、空单元格/长文本、控件取值（第 4 节：select 单/多选、空值/value=文本、checkbox/radio、hidden、date/textarea/output、一格多控件、ARIA switch/slider/listbox/combobox、el/ant/van 组件开关、嵌套开关、类名形似非开关回退）、列拆分（第 5 节：控件值拆分（含同格多控件各自成列，复刻店小秘秒杀价/库存双输入）、按换行拆分、分隔符拆分、智能预填、段数不足补空、合并表格禁用）、分体表格合并（第 6 节：表头/表体两个 table 复刻 Element Plus el-table，垂直+水平双向滚动裁剪（表宽 860 > 容器 620，表头 scrollLeft 同步）、gutter 占位列）、图片链接导出（第 8 节：纯图片/图片+文字/无链接图片/控件+图片/双行格含图按换行拆分）、列格式（第 9 节：文本=默认零回归、数字列数值化（千分位剥离、解析失败保原文本）、拆分新列继承、合并单元格表格仍可设置）、选择模式下链接不跳转 | 行内「预期导出」列 |
| `virtual-fixture.html` | 60 行虚拟滚动（thead 无 tr、input/select 由 JS 属性设值模拟 Vue、el-switch 开关列）；分体表格 + 虚拟滚动组合（表头/表体两个 table 复刻 vxe-table，滚动容器在数据表上层）；采集后拆分列面板回归（预期值见页内说明） | 61 行全采集（60 数据 + 表头）；序号 1/26/41 三行内容完全相同应全部保留（重复行不误删）；发货仓「华东仓(1)/华南仓(2)」、开关「是/否」；分体表悬浮整体高亮、一次点选、采集 41 行（40 数据 + 表头）、一口价取 JS 实时值 |
| `auto-check.html` | DOM 层自动化回归（无扩展环境，页内自判 PASS/FAIL）：控件取值（controls.controlValue：input/checkbox/radio/hidden/date/textarea/output、select 单/多选、ARIA switch/slider、el-switch 类名开关、类名形似回退 null）；单元格四通道（cell.openBatch：空白归一化、nbsp/换行/连续空格压缩、控件 merged/text/ctrl 三通道、多控件对齐、嵌套开关不重复计数、图片绝对链接、无 src 图片为空）；表格提取（table.extractTable：常规 thead、rowspan/colspan 展开+merges、多行表头、无 thead 全 th 行计表头、display:none 行过滤）；导出管线端到端（提取→block+control 拆分→列筛选→数字格式→csv/json 精确对比，JS 属性设值复刻 Vue 实时状态） | 页内 summary「37 项全部 PASS」 |
| `e2e-harness.js` | E2E 全链路注入回归（fixture.html，无扩展环境）：桩 chrome.storage（内存）与 runtime.sendMessage（走 blob 回退），捕获导出内容逐项断言。覆盖：选择交互、链接拦截、Esc 退出、CSV/JSON/MD/HTML/XLSX 内容（BOM/CRLF、RFC4180 转义、列N兜底、thead 归位）、merges、Sheet 名、自适应列宽（解包 zip 读 cols XML）、XLSX 全量单元格比对（值+类型逐格，含合并延续空位与数字格式 t:n）、列拆分三模式、列筛选、列格式、分体表格合并、持久化保存/恢复/重置、面板折叠与默认收起 | 控制台输出 `__TEST_RESULT` 数组 105/105 pass |
| `e2e-harness-virtual.js` | E2E 注入回归（virtual-fixture.html，无扩展环境）：虚拟滚动采集 61 行、合法重复行保留、控件实时值（input/select JS 属性设值）、分体表+虚拟滚动组合 41 行、采集后面板快照与默认收起/展开预设 | 控制台输出 `__TEST_RESULT` 数组 33/33 pass |
| `algo-check.cjs` | 纯函数离线回归（Node 直接运行，不碰 DOM）：采集算法、列拆分/列筛选/列格式/列宽、分体配对、持久化、格式序列化、通用工具、模块清单一致性——覆盖明细见下节 | 全部 PASS（154 项） |

## algo-check 覆盖明细

| 类别 | 覆盖 |
|---|---|
| 采集算法（virtual.js） | 滑动窗口去重、合法重复行保留、非虚拟误报无损、渲染延迟、5000 行性能 |
| 列拆分（split.js） | 三模式（control/block/delimiter，control 含多控件各自成列/参差补齐/空值占位）、段数上限、从右到左多规则、块内空格不拆（对照 delimiter）、多行表头、含 merges 禁用、规则解析不到原样返回 |
| 列筛选（split.js） | colKeys 唯一表头/重名/空表头兜底、columnLayout 段列映射与短路、filterColumns 排除/全排除防御/短行补空、拆分+筛选端到端 |
| 列格式（split.js） | toNumValue 千分位剥离/解析失败保原值、formatColumns 输出列号映射（拆分新列继承、筛选后对齐）、applyColFormats 表头不动/同引用短路、拆分+筛选+数字格式端到端 |
| 自适应列宽（split.js） | cellWidth 半角/全角/谚文宽度与内嵌换行、autoColWidths 逐列最大宽度与 6~50 钳制、空表/空行边界 |
| 分体配对（table.js `pairSplitGroup`） | 基础配对、gutter 列容忍（列数差 1）、间隙/对齐/宽度/列数阈值、轻微重叠容忍、完整表格零回归、颠倒不配对、多候选首个命中 |
| 持久化（persist.js） | pageKeyOf 忽略 query/hash、tableKeyOf 指纹（含 thead 无 tr 的 vxe-table 写法取 th 子元素而非数据行）与空值、sanitizeRecord 损坏剔除自愈（含 formats 键值对）、evictKeys LRU 淘汰 |
| 格式序列化（format.js） | csvCell RFC4180 转义、toCsv BOM/CRLF、headerKeys 列名兜底、toJson 行对象/表名嵌套、mdCell 转义与 toMarkdown 结构（含无表头生成列N）、toHtmlDocument 结构 |
| 通用工具 | util.js sanitizeFilename/escapeHtml；table.js makeSheetName 四级兜底、非法字符、31 字符截断、重名后缀 |
| 模块清单一致性 | service-worker 注入列表 / e2e-harness FILES / extension/content 实际文件三方对齐 + 依赖序（防新增模块漏同步） |

## 命令

```powershell
# 一键回归（推荐，全链路自动判定）：语法检查 → algo-check → 起静态服务 →
# headless Chromium 跑两个 E2E 页面（虚拟时间快进定时器，约 2 秒），控制台出结论、退出码即结果。
# 注意 run-all.ps1 须保持 UTF-8 带 BOM（PowerShell 5 中文兼容）
.\test\run-all.ps1

# 交互模式（旧行为）：浏览器打开两个 E2E 页面人工核对，回车停止服务
.\test\run-all.ps1 -Interactive

# 分步执行：
Get-ChildItem extension/content/*.js | ForEach-Object { node --check $_.FullName }
node --check extension/background/service-worker.js
node test/algo-check.cjs

# DOM 自动回归（auto-check.html，无扩展环境）：
npx serve .   # 仓库根目录起静态服务 → 访问 /test/auto-check.html，页内自判 PASS/FAIL
```

## E2E 注入回归（无扩展环境）

前置：仓库根目录 `npx serve .`，浏览器直接访问（页面自跑自判，结果渲染在页底浮层，标题栏同步结论）。
用 `#e2e=1`（hash）而非 `?e2e=1`：serve 等静态服务器的 cleanUrls 重定向会丢查询串，hash 不受影响（两种写法均支持）：

```
http://localhost:3000/test/fixture.html#e2e=1          → 页底「105 项全部 PASS」
http://localhost:3000/test/virtual-fixture.html#e2e=1  → 页底「33 项全部 PASS」
```

提速说明：

- `run-all.ps1` 默认 headless Chromium + `--virtual-time-budget`（虚拟时间快进全部定时器：
  toast 自动消失、虚拟采集 settle 等不再等真实时钟，后台标签页节流免疫），两页并行约 2 秒出结论，
  退出码 0/1 可直接作流水线门禁；找不到 Chrome/Edge 时自动降级交互模式
- 两个 harness 内部：固定 sleep 改事件驱动 `waitFor`（面板打开等 mask、退出等 host 移除），
  模块代码缓存（11 个内容脚本仅首轮拉取），导出轮询 25ms——交互模式/控制台手动跑同样受益，
  虚拟滚动页人工核对约 10-30 秒（真实时钟采集）

也可手动执行（同效果，结果在控制台 `__TEST_RESULT`，结构 `{total, passed, results}`）：

```js
const c = await (await fetch('/test/e2e-harness.js?v=' + Date.now())).text();   // 虚拟表页换 e2e-harness-virtual.js
window.__TEST_RESULT = await (0, eval)(c);
```

注意：

- harness 自带并发守卫与轮次串行锁，重复执行须等上轮结束（或刷新页面后重来）
- 两个 harness 均内置后台标签页适配（rAF 定时器替代、scrollTop 补发 scroll 事件），后台跑也可
- `window.__TEST_LOG` 为调试日志，失败排查用

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
