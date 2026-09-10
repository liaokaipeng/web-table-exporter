# 测试与回归

测试材料在 `test/`（开发材料，不随插件分发），预期值均已在各页行内标注。

## 覆盖矩阵

| 材料 | 覆盖 | 预期 |
|---|---|---|
| `fixture.html` | 普通表格、rowspan/colspan 合并（带 caption）、空单元格/长文本、控件取值（第 4 节：select 单/多选、空值/value=文本、checkbox/radio、hidden、date/textarea/output、一格多控件、ARIA switch/slider/listbox/combobox、el/ant/van 组件开关、嵌套开关、类名形似非开关回退）、列拆分（第 5 节：控件值拆分（含同格多控件各自成列，复刻店小秘秒杀价/库存双输入）、按换行拆分、分隔符拆分、智能预填、段数不足补空、合并表格禁用）、分体表格合并（第 6 节：表头/表体两个 table 复刻 Element Plus el-table，垂直+水平双向滚动裁剪（表宽 860 > 容器 620，表头 scrollLeft 同步）、gutter 占位列）、图片链接导出（第 8 节：纯图片/图片+文字/无链接图片/控件+图片/双行格含图按换行拆分）、列格式（第 9 节：文本=默认零回归、数字列数值化（千分位剥离、解析失败保原文本）、拆分新列继承、合并单元格表格仍可设置）、选择模式下链接不跳转 | 行内「预期导出」列 |
| `virtual-fixture.html` | 60 行虚拟滚动（thead 无 tr、input/select 由 JS 属性设值模拟 Vue、el-switch 开关列）；分体表格 + 虚拟滚动组合（表头/表体两个 table 复刻 vxe-table，滚动容器在数据表上层）；采集后拆分列面板回归（预期值见页内说明） | 61 行全采集（60 数据 + 表头）；序号 1/26/41 三行内容完全相同应全部保留（重复行不误删）；发货仓「华东仓(1)/华南仓(2)」、开关「是/否」；分体表悬浮整体高亮、一次点选、采集 41 行（40 数据 + 表头）、一口价取 JS 实时值 |
| `auto-check.html` | DOM 层自动化回归（无扩展环境，页内自判 PASS/FAIL）：控件取值（controls.controlValue：input/checkbox/radio/hidden/date/textarea/output、select 单/多选、ARIA switch/slider、el-switch 类名开关、类名形似回退 null）；单元格四通道（cell.openBatch：空白归一化、nbsp/换行/连续空格压缩、控件 merged/text/ctrl 三通道、多控件对齐、嵌套开关不重复计数、图片绝对链接、无 src 图片为空）；表格提取（table.extractTable：常规 thead、rowspan/colspan 展开+merges、多行表头、无 thead 全 th 行计表头、display:none 行过滤）；导出管线端到端（提取→block+control 拆分→列筛选→数字格式→csv/json 精确对比，JS 属性设值复刻 Vue 实时状态） | 页内 summary「37 项全部 PASS」 |
| `e2e-harness.js` | E2E 全链路注入回归（fixture.html，无扩展环境）：桩 chrome.storage（local + sync 两个独立内存区，v2.8 跨设备同步回归）与 runtime.sendMessage（走 blob 回退），捕获导出内容逐项断言。覆盖：选择交互（v2.4 非表格点击放行、被移除已选表格自动剔除 + toast 告知）、链接拦截（preventDefault + 警示 toast + 被拦链接就地红框高亮及还原）、Esc 退出、CSV/JSON/MD/HTML/XLSX 内容（BOM/CRLF、RFC4180 转义、列N兜底、thead 归位）、merges、Sheet 名、自适应列宽（解包 zip 读 cols XML）、XLSX 全量单元格比对（值+类型逐格，含合并延续空位与数字格式 t:n）、列拆分三模式、列筛选、列格式、分体表格合并、持久化保存/恢复/重置、面板折叠与默认收起、复制到剪贴板（TSV/Markdown，桩 Clipboard API 捕获文本）、清空已选与面板「恢复默认」、导出中止（导出中点「停止导出」不产生文件且选择保留、再次导出正常）、列顺序调整（Alt+↑ 换位 + 导出列序 + 重开面板保持）、跨设备同步（保存镜像到 sync、注入时按 updatedAt 合并取更新者）、输出方式与文件名记忆（v2.9：选择即存偏好、文件名编辑后记住为模板并渲染 `{date}`、重进选择模式恢复、清空回落默认命名） | 控制台输出 `__TEST_RESULT` 数组 149/149 pass |
| `e2e-harness-virtual.js` | E2E 注入回归（virtual-fixture.html，无扩展环境）：虚拟滚动采集 61 行、合法重复行保留、控件实时值（input/select JS 属性设值）、分体表+虚拟滚动组合 41 行、采集后面板快照与默认收起/展开预设 | 控制台输出 `__TEST_RESULT` 数组 33/33 pass |
| `tablev2-fixture.html` | Element Plus el-table-v2 虚拟化表格（div 网格结构，无 table 元素）：500 行两例——纯主分区网格 + 固定列（left/main 双分区，滚动联动）、JS 渲染窗口模拟虚拟滚动（仅渲染可见行 ± 缓存）、表头 dynamic-header-row、控件列（input/select JS 属性设值）、行内操作按钮 | 悬浮整体高亮、一次点选自动滚动采集 501 行（500 数据 + 表头）、固定列按视觉列序拼接（固定列在前）、控件取实时值、重复行保留 |
| `e2e-harness-tablev2.js` | E2E 注入回归（tablev2-fixture.html，无扩展环境）：网格表格识别与悬浮整体高亮、点击后自动滚动采集（500 行全量）、固定列双分区拼接列序、控件实时值、导出内容断言 | 控制台输出 `__TEST_RESULT` 数组 24/24 pass |
| `antdv-fixture.html` | Ant Design Vue 4.x Table（原生 table + ant-table 包装类，零组件特判）：普通表格（4 行含控件列）、`scroll.y` 分体结构（表头表 + 数据表，复刻 a-table 固定列 sticky cell + spacer 占位列）、JS 属性设值控件、普通 table 回归 | 悬浮整体高亮、一次点选，预期值见页内标注 |
| `e2e-harness-antdv.js` | E2E 注入回归（antdv-fixture.html，无扩展环境）：分体配对命中（走既有 el-table 同构逻辑）、行数/列序（spacer 占位列不导出）、控件实时值、导出内容断言 | 控制台输出 `__TEST_RESULT` 数组 19/19 pass |
| `aggrid-fixture.html` | AG Grid（v28+，ag-theme-balham）虚拟化表格：div + ARIA role 结构、单垂直滚动容器（固定列分区为其子级）、pinned 左固定列、行节点复用（aria-rowindex 重分配，DOM 序刻意倒置注入）、300 行含 3 条分散重复行、JS 属性设值控件、普通 table 回归 | 悬浮整体高亮、一次点选自动采集 301 行（含表头）、行序按 aria-rowindex 还原、固定列在前拼接、重复行保留 |
| `e2e-harness-aggrid.js` | E2E 注入回归（aggrid-fixture.html，无扩展环境）：网格识别（表头/表体/固定列命中同一根）、自动滚动采集全量、行序排序（DOM 倒置修正）、固定列拼接列序、控件实时值、导出内容断言 | 控制台输出 `__TEST_RESULT` 数组 25/25 pass |
| `mui-fixture.html` | MUI X DataGrid（v6/v7）虚拟化表格：div + ARIA role 结构、单滚动容器 virtualScroller、pinned 为同行 sticky cell（无独立分区）、行节点复用（aria-rowindex，DOM 序刻意倒置注入）、300 行含 3 条分散重复行、JS 属性设值控件、普通 table 回归 | 悬浮整体高亮、一次点选自动采集 301 行（含表头）、行序按 aria-rowindex 还原、重复行保留 |
| `e2e-harness-mui.js` | E2E 注入回归（mui-fixture.html，无扩展环境）：网格识别、自动滚动采集全量、行序排序、控件实时值、导出内容断言 | 控制台输出 `__TEST_RESULT` 数组 24/24 pass |
| `tabulator-fixture.html` | Tabulator（v6，vdom 渲染）虚拟化表格：div 结构、滚动容器 tableHolder、冻结列为同行 frozen cell、行追加序即视觉序（无节点复用）、300 行含 3 条分散重复行 + 无冻结列 150 行例、JS 属性设值控件、普通 table 回归 | 悬浮整体高亮、一次点选自动采集 301 行（含表头）、重复行保留 |
| `e2e-harness-tabulator.js` | E2E 注入回归（tabulator-fixture.html，无扩展环境）：网格识别、自动滚动采集全量、控件实时值、导出内容断言 | 控制台输出 `__TEST_RESULT` 数组 23/23 pass |
| `pagination-el-fixture.html` | 分页表格（复刻 el-pagination 类名结构：button.btn-prev / ul.el-pager / button.btn-next，disabled 态类 + 属性双写）：5 页 × 8 行、翻页仅重建 tbody、input 控件列（JS 设值）、普通无分页表回归 | 选中表 → 点「采集全部页」展开设置 → 点「开始采集」（页数上限留空 = 全部页）自动识别直接采集：toast 41 行（含表头）、首行「商品 P1-1」末行「商品 P5-8」、一口价列取 input 实时值；先翻到第 3 页再采集应先回第一页采全量、完成回到第 1 页；面板页数上限填 2 → 只采前 2 页（toast 17 行 +「已采集指定 2 页」，输入框 Enter 同效）；采集中「停止采集」→ 保留已采集的页（toast「已停止采集，保留已采集的 N 页」）且导出即已采部分；采集后「列设置」可取样；单表限定（v2.5.3）：再选中普通无分页表 → 「采集全部页」按钮变禁用、悬浮提示「多表选择时不支持分页采集」，取消普通表后按钮恢复可用；v2.9 采集进度带总页数（「第 1/5 页，已采集 9 行」，页数上限不改变所显示的总页数） |
| `e2e-harness-paged-el.js` | E2E 注入回归（pagination-el-fixture.html，无扩展环境）：全页采集 41 行、进度逐页推进（MutationObserver 记录每次提示文案）、页数上限 2 → 17 行、起点归一（先翻第 3 页再采集从第 1 页起采、完成回到第 1 页）、input 实时值导出断言 | 控制台输出 `__TEST_RESULT` 数组 18/18 pass |
| `pagination-ant-fixture.html` | 分页表格（复刻 ant-pagination 类名结构：li.ant-pagination-prev/item/next，页码为 a 链接，禁用态 aria-disabled + .ant-pagination-disabled）：4 页 × 6 行 | 选中表 → 点「采集全部页」展开设置 → 点「开始采集」（留空 = 全部页）自动采集 25 行（含表头）、首行「订单 A-1」末行「订单 D-6」、完成回到第 1 页；验证翻页按钮为链接结构时编程式点击豁免采集期拦截；选择模式下手动点页码可翻页（v2.4 点击放行） |
| `pagination-manual-fixture.html` | 分页表格（自建分页器，类名与组件库无交集，「下一页」为 a 链接且末页无 disabled 态）：3 页 × 5 行 | 选中表 → 点「采集全部页」展开设置 → 点「开始采集」进入「指定翻页按钮」子模式（hint 提示 + 悬浮高亮任意元素）→ 点击「下一页 »」后采集：toast 16 行（含表头）+「自当前页开始采集，连续翻页无新数据，已停止」；验证子模式拦截所有点击（含链接）、Esc 取消不丢选区、行为停止条件（连续 2 页无新行）；v2.9 指定一次即按页面记住（`h2x.pager.v1`），再次采集直接复用（toast「已复用上次指定的翻页按钮」），按钮从页面消失时回落子模式且保留记忆 |
| `e2e-harness-paged-manual.js` | E2E 注入回归（pagination-manual-fixture.html，无扩展环境）：指定翻页按钮并记住（定位器 sel/tag 断言）、复用记忆按钮（不再进子模式 + 复用 toast）、生效的记忆保留、按钮失联回落子模式且不清记忆、自建分页器无总页数时进度只显示当前页、Esc 取消子模式不丢选区 | 控制台输出 `__TEST_RESULT` 数组 16/16 pass |
| `algo-check.cjs` | 纯函数离线回归（Node 直接运行，不碰 DOM）：采集算法、列拆分/列筛选/列顺序/列格式/列宽、分体配对、网格适配器、分页适配器、持久化、格式序列化、通用工具、模块清单一致性、国际化词条一致性——覆盖明细见下节 | 全部 PASS（212 项） |

## algo-check 覆盖明细

| 类别 | 覆盖 |
|---|---|
| 采集算法（virtual.js） | 滑动窗口去重、合法重复行保留、非虚拟误报无损、渲染延迟、5000 行性能 |
| 列拆分（split.js） | 三模式（control/block/delimiter，control 含多控件各自成列/参差补齐/空值占位）、段数上限、从右到左多规则、块内空格不拆（对照 delimiter）、多行表头、含 merges 禁用、规则解析不到原样返回 |
| 列筛选（split.js） | colKeys 唯一表头/重名/空表头兜底、columnLayout 段列映射与短路、filterColumns 排除/全排除防御/短行补空、拆分+筛选端到端 |
| 列顺序（split.js v2.8） | reorderColumns 原列整体重排、自然序/空/缺省 order 原引用零回归、未命中键忽略+自然序补齐、拆分新列跟随原列、与列筛选组合（按过滤后位置重排，防列号错位）、数字列键（无表头兜底）重排 |
| 列格式（split.js） | toNumValue 千分位剥离/解析失败保原值、formatColumns 输出列号映射（拆分新列继承、筛选后对齐）、applyColFormats 表头不动/同引用短路、拆分+筛选+数字格式端到端 |
| 自适应列宽（split.js） | cellWidth 半角/全角/谚文宽度与内嵌换行、autoColWidths 逐列最大宽度与 6~50 钳制、空表/空行边界 |
| 分体配对（table.js `pairSplitGroup`） | 基础配对、gutter 列容忍（列数差 1）、间隙/对齐/宽度/列数阈值、轻微重叠容忍、完整表格零回归、颠倒不配对、多候选首个命中 |
| 网格适配器（table.js v2.2） | 注册表完整性（四适配器齐备命名稳定、五钩子齐备、rootSel 互不相同且为单类名、GRID_ROOT_SELECTOR 组合）、rowsSortedByRowIndex 行序排序（全带 aria-rowindex 数值升序、无/部分缺失保持 DOM 序、纯函数不原地重排、数值比较非字典序）、tableKeyOf 网格分支（适配器表头格拼接、无表头格返回 null、非网格 div 回落内部 table） |
| 分页适配器（pagination.js v2.5） | 注册表完整性（三适配器齐备命名稳定、四要素齐备、rootSel 互不相同、next/prev 均为单类名选择器、v2.9 总页数选择器 pageSel 可选且非空）；采集引擎的页级重叠合并复用 virtual.js overlapLen 既有用例 |
| 持久化（persist.js） | pageKeyOf 忽略 query/hash、tableKeyOf 指纹（含 thead 无 tr 的 vxe-table 写法取 th 子元素而非数据行；v2.1 网格表格取 dynamic-header-row 表头格、优先于内部 table 回退）与空值、sanitizeRecord 损坏剔除自愈（含 formats 键值对、v2.8 order 列顺序数组）与「仅 order 也保留」、evictKeys LRU 淘汰 |
| 格式序列化（format.js） | csvCell RFC4180 转义、toCsv BOM/CRLF、tsvCell 制表符/换行转空格（v2.7 剪贴板）、toTsv 分隔与空表边界、headerKeys 列名兜底、toJson 行对象/表名嵌套、mdCell 转义与 toMarkdown 结构（含无表头生成列N）、toHtmlDocument 结构 |
| 通用工具 | util.js sanitizeFilename/escapeHtml；table.js makeSheetName 四级兜底、非法字符、31 字符截断、重名后缀 |
| 模块清单一致性 | service-worker 注入列表 / 九个 e2e-harness 各自的 FILES / extension/content 实际文件对齐 + 依赖序（防新增模块漏同步；v2.5.2 曾因六个分页面 harness 漏注入 pagination.js 致 E2E 全线失败，检查随之扩全；v2.9 新增两个分页 harness 一并纳入） |
| 国际化词条一致性（v2.6） | 内容脚本与 manifest 引用的全部 `t()`/`__MSG_` 词条 ⊆ `_locales/en`（新增硬编码中文 UI 文案即失败）；manifest `__MSG_` 词条 ⊆ `_locales/zh_CN`（default_locale 静态引用，缺则商店/界面显示 key 名）；占位符词条消息含声明的全部 `$XXX$`；以 en 语言包桩 `chrome.i18n` 驱动 headerKeys/makeSheetName 验证 `$1` 注入（回归：`t()` 曾以箭头函数 `arguments` 取参致 subs 恒空、占位符不替换） |

## 命令

```powershell
# 一键回归（推荐，全链路自动判定）：语法检查 → algo-check → 起静态服务 →
# headless Chromium 跑九个 E2E 页面（虚拟时间快进定时器，约 5 秒），控制台出结论、退出码即结果。
# 注意 run-all.ps1 须保持 UTF-8 带 BOM（PowerShell 5 中文兼容）
.\test\run-all.ps1

# 交互模式（旧行为）：浏览器打开九个 E2E 页面人工核对，回车停止服务
.\test\run-all.ps1 -Interactive

# 分步执行：
Get-ChildItem extension/content/*.js | ForEach-Object { node --check $_.FullName }
node --check extension/background/service-worker.js
node test/algo-check.cjs

# DOM 自动回归（auto-check.html，无扩展环境）：
npx serve .   # 仓库根目录起静态服务 → 访问 /test/auto-check.html，页内自判 PASS/FAIL

# 重新生成扩展图标（extension/icons/ 四尺寸；本脚本同样须保持 UTF-8 带 BOM）：
powershell -ExecutionPolicy Bypass -File test/gen-icon.ps1
```

## E2E 注入回归（无扩展环境）

前置：仓库根目录 `npx serve .`，浏览器直接访问（页面自跑自判，结果渲染在页底浮层，标题栏同步结论）。
用 `#e2e=1`（hash）而非 `?e2e=1`：serve 等静态服务器的 cleanUrls 重定向会丢查询串，hash 不受影响（两种写法均支持）：

```
http://localhost:3000/test/fixture.html#e2e=1          → 页底「149 项全部 PASS」
http://localhost:3000/test/virtual-fixture.html#e2e=1  → 页底「33 项全部 PASS」
http://localhost:3000/test/tablev2-fixture.html#e2e=1  → 页底「24 项全部 PASS」
http://localhost:3000/test/antdv-fixture.html#e2e=1    → 页底「19 项全部 PASS」
http://localhost:3000/test/aggrid-fixture.html#e2e=1   → 页底「25 项全部 PASS」
http://localhost:3000/test/mui-fixture.html#e2e=1      → 页底「24 项全部 PASS」
http://localhost:3000/test/tabulator-fixture.html#e2e=1 → 页底「23 项全部 PASS」
http://localhost:3000/test/pagination-el-fixture.html#e2e=1     → 页底「18 项全部 PASS」
http://localhost:3000/test/pagination-manual-fixture.html#e2e=1 → 页底「16 项全部 PASS」
```

提速说明：

- `run-all.ps1` 默认 headless Chromium + `--virtual-time-budget`（虚拟时间快进全部定时器：
  toast 自动消失、虚拟采集 settle 等不再等真实时钟，后台标签页节流免疫），九页并行约 5 秒出结论，
  退出码 0/1 可直接作流水线门禁；找不到 Chrome/Edge 时自动降级交互模式
- 九个 harness 内部：固定 sleep 改事件驱动 `waitFor`（面板打开等 mask、退出等 host 移除），
  模块代码缓存（13 个内容脚本仅首轮拉取），导出轮询 25ms——交互模式/控制台手动跑同样受益，
  虚拟滚动页人工核对约 10-30 秒（真实时钟采集）
- 分页两页（paged-el / paged-manual）另用 `MutationObserver` 记录 hint 的每次写入：翻页进度的
  「写入后立刻被重置」中间帧（如最后一页的进度）靠轮询抓不到，观察器不丢帧

也可手动执行（同效果，结果在控制台 `__TEST_RESULT`，结构 `{total, passed, results}`）：

```js
const c = await (await fetch('/test/e2e-harness.js?v=' + Date.now())).text();   // 其余页换对应 harness：virtual / tablev2 / antdv / aggrid / mui / tabulator / paged-el / paged-manual
window.__TEST_RESULT = await (0, eval)(c);
```

注意：

- harness 自带并发守卫与轮次串行锁，重复执行须等上轮结束（或刷新页面后重来）
- 九个 harness 均内置后台标签页适配（rAF 定时器替代、scrollTop 补发 scroll 事件），后台跑也可
- `window.__TEST_LOG` 为调试日志，失败排查用
- 国际化（v2.6）：页面桩 chrome 不含 `chrome.i18n`，内容脚本 `t()` 回落代码内中文，断言预期值不变；需验证英文界面时按 `_locales/en/messages.json` 给桩实现 `getMessage` 即可（词条 key 一致性已由 algo-check 保证）
- 语言开关（v2.6.1）：E2E 桩无 chrome.runtime，手动英文词表不可达——点「EN」会回落中文、行为不崩溃（预期；真机英文界面验证走下方浏览器回归步骤 6）；切换偏好写入桩 storage 的 `h2x.uiLang`，同页多轮注入间生效
- 跨设备同步（v2.8）：fixture 的 `e2e-harness.js` 桩了独立 local / sync 两区（供「镜像落盘」与「按 updatedAt 合并」断言）；其余 harness 只桩 local，sync 路径不参与（等价于未登录 Chrome，行为与 v1.7 一致）
- 导出捕获桩（v2.9 起）：`HTMLAnchorElement.prototype.click` 只对 blob 映射命中的导出链接记账，其余链接回落原生派发——分页页的「下一页」是 `a[href]`，扩展的编程式翻页靠原生 click 触发页面自身监听器，桩若吞掉则翻页永不发生（曾致 paged-manual 只采到 1 页）

## 浏览器回归步骤

1. `chrome://extensions` 刷新扩展（目录变更后需重新加载 `extension/` 目录）
2. 刷新目标测试页
3. 初始按钮态：进入选择模式未选表时，「列设置」「采集全部页」「导出」一致禁用（仅「取消」可点）；选中任一表后三者解禁
4. 选择表格导出，对照页内预期值
5. 持久化回归（v1.7）：
   - 保存恢复：列设置保存（含拆分规则、列筛选与列格式）→ 刷新页面 → 重进选择模式选同表 → 工具栏提示「已恢复上次的列设置」，面板显示已保存配置，导出生效
   - 取消选择不清存储：选中已保存配置的表 → 点击取消选中 → 再选中 → 配置自动恢复
   - 重置路径：面板全不拆 + 全列导出 + 全列文本格式 → 保存 → 刷新重选 → 回落智能预填默认（无恢复提示）
   - 表头变更不恢复：保存配置后用 DevTools 改该表任一 th 文本（勿刷新，改动只在本轮 DOM）→ 取消选中再选中 → 不恢复（指纹不匹配，无恢复提示）
   - 虚拟表同流程：virtual-fixture.html 采集完成后保存配置，验证重进后采集完成即恢复
6. 语言开关回归（v2.6.1，需 Chrome 界面语言与想验证语言不同才能看出差别）：
   - 进入选择模式 → 工具栏最右点「EN」：按钮/提示/分页面板等界面文案立即变英文，`aria-pressed` 移到 EN；导出一次对照英文兜底名（无 caption 表格 Sheet 名 = Table N）
   - 退出选择模式重进（刷新页面亦可）：仍是英文（偏好已记住）；再点「EN」（当前语言）恢复跟随浏览器语言
   - 面板/采集中开关禁用：选中表格打开列设置面板时语言开关灰置，关面板后恢复可点
   - 中文环境验证：浏览器语言为中文时默认即中文界面，开关高亮落在「中文」，点「EN」切英文后点「EN」回跟随浏览器（回中文）
7. 剪贴板输出与选择/配置管理回归（v2.7）：
   - 复制到剪贴板：选中表格 → 输出方式下拉选「复制为表格 (TSV)」（主按钮文案变「复制为表格 (TSV)」）→ 点击 → toast「已复制 N 行到剪贴板」；粘贴到 Excel / 飞书应还原成表格（列对齐、表头在首行）；再选「复制为 Markdown」→ 点击 → 粘贴到 Markdown 编辑器应为 GFM 表格
   - 列设置对复制同样生效：先配好拆分/筛选/数字格式再复制，粘贴结果应与「导出 CSV」的内容一致
   - 清空已选：多选 2-3 个表 → 点计数旁「✕」→ 计数归 0、绿色覆盖层全部消失、仍处于选择模式（可继续点选）、toast「已清空已选表格（N 个）」；未选表时该按钮不显示
   - 恢复默认：列设置面板配好拆分并保存 → 重开面板点「恢复默认」→ 拆分全部收起（列勾选与格式回默认）；点「保存」→ toast 变「已清除本页列设置记忆，恢复默认导出」；刷新页面重选该表 → 不再恢复（回落默认）；点「恢复默认」后改点「取消」→ 原配置不受影响
   - 语言切换同步：切到 EN 后输出方式下拉末尾两项为「Copy as table (TSV) / Copy as Markdown」，面板底部按钮为「Reset」且 title 为英文
8. 列顺序 / 导出中止 / 跨设备同步回归（v2.8）：
   - 列顺序：选中表格 → 列设置 → 拖住某列左侧「⋮⋮」手柄上下拖（落点有内阴影线标示插入位置）→ 松手后列区与「导出预览」顺序同步变化；保存 → 导出内容按新列序（拆分出的新列跟随原列整体移动）；刷新页面重选该表 → 恢复调整后的列序
   - 键盘替代：手柄聚焦后按 Alt+↑/↓ 逐位移动，焦点仍留在手柄上可连续操作
   - 含合并单元格的表格：手柄为灰色占位不可拖（面板顶部说明仍在，导出保持原样）
   - 导出中止：多选 2–3 张表 → 点导出 → 导出期间「取消」变「停止导出」→ 点击 → toast「已停止导出（已下载 N 个文件）」，选择保留、按钮恢复「取消」与「导出 X」；再次导出应正常完成（作废的是上一个任务）
   - 跨设备同步：登录 Chrome 账号 → 保存一份列设置 → 在另一台设备（或另一 profile，同一账号）打开同一页面 → 重选该表应恢复该配置；未登录时应只在本机生效（行为与旧版一致）
   - 隐私口径：商店「隐私与数据安全」与 review-notes 的 `storage` 理由须已同步提及「登录时随账号同步到用户自己的设备」（避免描述与实际行为不符）

9. 输出方式与文件名记忆 / 分页进度与翻页按钮记忆回归（v2.9）：
   - 输出方式记忆：选中表格 → 输出方式下拉选「CSV」→ Esc 退出选择模式 → 重进选择模式 → 下拉仍是 CSV、导出按钮文案为「导出 CSV」（清掉 chrome.storage.local 的 `h2x.prefs` 即回默认 xlsx）
   - 文件名模板：把文件名改成「订单_{date}」→ 点导出（或点页面空白处失焦）→ 退出重进 → 文件名自动变成「订单_<当天日期>」；把输入框清空再失焦 → 恢复默认「页面标题_日期-时间」；导出文件名扩展名随输出方式变化
   - 分页进度总页数：打开 pagination-el-fixture.html → 选中表 → 「采集全部页 ▾」→「开始采集」→ 工具栏显示「第 1/5 页，已采集 9 行」并逐页推进；填页数上限 2 时显示的仍是「第 i/5 页」、完成 toast 附「已采集指定 2 页」
   - 翻页按钮记忆：打开 pagination-manual-fixture.html → 选中表 → 开始采集 → 按提示点「下一页 »」→ 采集完成后退出重进（或刷新后重选该表）→ 再点「采集全部页」→ 不再要求指定，直接采集并提示「已复用上次指定的翻页按钮」
   - 记忆失效自清：DevTools 删掉该「下一页」元素后再采集 → 回落「指定翻页按钮」子模式且记忆保留（刷新后按钮回来了仍可直接复用）；把记住的按钮换成点不动的死链再复用采集 → 采集结束提示「上次记住的翻页按钮未生效，已清除记忆」，再点「采集全部页」重新进入指定子模式
   - 中英双语：切到 EN 后分页进度文案与「复用/失效」两条 toast 为英文（文件名输入框的模板说明亦为英文）

控件取值规则见 [docs/controls.md](../docs/controls.md)；真实页面回归：点三咪折扣活动编辑页（长列表 + 一口价 input 列）。
