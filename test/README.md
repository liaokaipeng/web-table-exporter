# 测试与回归

测试材料在 `test/`（开发材料，不随插件分发），预期值均已在各页行内标注。

## 覆盖矩阵

- **`fixture.html`**
  - 覆盖：普通表格；`rowspan`/`colspan` 合并（caption）；空单元格/长文本；控件取值（第 4 节）：`select` 单/多选、空值/value=文本、`checkbox`/`radio`、`hidden`、`date`/`textarea`/`output`、一格多控件、ARIA `switch`/`slider`/`listbox`/`combobox`、el/ant/van 开关、嵌套开关、类名形似非开关回退；列拆分（第 5 节）：控件值（同格多控件各自成列）、换行拆分、分隔符拆分、智能预填、段数不足补空、合并表格禁用；分体合并（第 6 节）：表头/表体两 `table` 仿 Element Plus `el-table`、垂直+水平滚动裁剪（860>620，表头 `scrollLeft` 同步）、gutter 占位列；图片链接导出（第 8 节）：纯图片/图片+文字/无链接图片/控件+图片/双行格含图按换行拆分；列格式（第 9 节）：文本=默认零回归、数字列数值化（千分位剥离、解析失败保原文）、拆分新列继承、合并单元格表仍可设置；选择模式链接不跳转
  - 预期：行内「预期导出」列

- **`virtual-fixture.html`**
  - 覆盖：60 行虚拟滚动（`thead` 无 `tr`、`input`/`select` JS 属性设值模拟 Vue、`el-switch` 开关列）；分体表+虚拟滚动（表头/表体两 `table` 仿 vxe-table，滚动容器在数据表上层）；采集后拆分列面板
  - 预期：61 行全采集（60 数据+表头）；序号 1/26/41 三行相同须保留（重复行不误删）；发货仓「华东仓(1)/华南仓(2)」、开关「是/否」；分体表悬浮高亮一次点选、采集 41 行（40 数据+表头）、一口价取 JS 实时值

- **`auto-check.html`**
  - 覆盖：DOM 层自动化回归（页内自判 PASS/FAIL）；控件取值（`controls.controlValue`）：`input`/`checkbox`/`radio`/`hidden`/`date`/`textarea`/`output`、`select` 单/多选、ARIA `switch`/`slider`、`el-switch` 类名开关、类名形似回退 `null`；单元格四通道（`cell.openBatch`）：空白归一化、nbsp/换行/连续空格压缩、控件 `merged`/`text`/`ctrl` 三通道、多控件对齐、嵌套开关不重复计数、图片绝对链接、无 `src` 图片为空；表格提取（`table.extractTable`）：常规 `thead`、`rowspan`/`colspan` 展开+merges、多行表头、无 `thead` 全 `th` 行计表头、`display:none` 行过滤；导出管线端到端：提取→拆分→列筛选→数字格式→csv/json 精确对比（JS 属性设值复刻 Vue 状态）
  - 预期：页内 summary「37 项全部 PASS」

- **`e2e-harness.js`**
  - 覆盖：全链路注入回归（`fixture.html`），桩 `chrome.storage`（local+sync 两区，v2.8 跨设备同步）与 `runtime.sendMessage`（走 blob 回退），逐项断言导出内容：选择交互（v2.4 非表格点击放行、被移除已选表格自动剔除+toast）、链接拦截（`preventDefault`+警示 toast+就地红框高亮及还原）、Esc 退出；CSV/JSON/MD/HTML/XLSX 内容（BOM/CRLF、RFC4180 转义、列N兜底、`thead` 归位）、merges、Sheet 名；自适应列宽、XLSX 全量单元格比对（值+类型逐格，含合并延续空位与数字格式 `t:n`）；列拆分三模式（智能预填：分隔符默认留空、段数上限默认 10；单控件：勾选框控拆分+图标按钮控配置显隐）；列筛选（含拆分子列独立筛选、v2.10 原列不导出联动新列整体排除与子列勾选置灰）、列格式、分体表格合并；持久化保存/恢复/重置、面板折叠与默认收起、复制到剪贴板（TSV/Markdown）；清空已选与「恢复默认」、导出中止（点「停止导出」不产生文件且选择保留、再次导出正常）；列顺序调整（Alt+↑ 换位+导出列序+重开面板保持）、跨设备同步（镜像存 sync、按 updatedAt 合并取更新者）；输出方式与文件名记忆（v2.9：选择即存偏好、文件名改后记模板并渲染 `{date}`、重进恢复、清空回落默认命名）
  - 预期：`__TEST_RESULT` 数组 156/156 pass

- **`e2e-harness-virtual.js`**
  - 覆盖：注入回归（`virtual-fixture.html`）：采集 61 行、重复行保留、控件实时值（`input`/`select` JS 属性设值）、分体表+虚拟滚动 41 行、面板快照与默认不拆分预设
  - 预期：`__TEST_RESULT` 数组 33/33 pass

- **`tablev2-fixture.html`**
  - 覆盖：Element Plus `el-table-v2` 网格（div 结构无 `table`）：500 行两例——纯主分区网格+固定列（left/main 双分区、滚动联动）、JS 渲染窗口模拟虚拟滚动（仅渲染可见行±缓存）、表头 `dynamic-header-row`、控件列（`input`/`select` JS 属性设值）、行内操作按钮
  - 预期：悬浮高亮、一次点选自动滚动采集 501 行（500 数据+表头）、固定列按视觉列序拼接在前、控件取实时值、重复行保留

- **`e2e-harness-tablev2.js`**
  - 覆盖：注入回归（`tablev2-fixture.html`）：识别与悬浮高亮、滚动采集 500 行、固定列双分区拼接列序、控件实时值、导出断言
  - 预期：`__TEST_RESULT` 数组 24/24 pass

- **`antdv-fixture.html`**
  - 覆盖：Ant Design Vue 4.x Table（原生 `table`+`ant-table` 包装类，零组件特判）：普通表格（4 行含控件列）、`scroll.y` 分体结构（表头表+数据表，仿 a-table 固定列+spacer 占位列）、JS 属性设值控件、普通 `table` 回归
  - 预期：悬浮高亮、一次点选，值见页内

- **`e2e-harness-antdv.js`**
  - 覆盖：注入回归（`antdv-fixture.html`）：分体配对命中（走既有 `el-table` 同构逻辑）、行数/列序（spacer 占位列不导出）、控件实时值、导出断言
  - 预期：`__TEST_RESULT` 数组 19/19 pass

- **`aggrid-fixture.html`**
  - 覆盖：AG Grid（v28+，`ag-theme-balham`）网格：div+ARIA role、单垂直滚动容器（固定列分区为其子级）、pinned 左固定列、行节点复用（`aria-rowindex` 重分配、DOM 序倒置注入；v2.9「元素身份重叠」于此页覆盖——误并/误丢则 301 行断言失败）、300 行含 3 条分散重复行、JS 属性设值控件、普通 `table` 回归
  - 预期：悬浮高亮、一次点选采集 301 行（含表头）、行序按 `aria-rowindex` 还原、固定列在前拼接、重复行保留

- **`e2e-harness-aggrid.js`**
  - 覆盖：注入回归（`aggrid-fixture.html`）：网格识别（表头/表体/固定列命中同一根）、滚动采集全量、行序排序（DOM 倒置修正）、固定列拼接列序、控件实时值、导出断言
  - 预期：`__TEST_RESULT` 数组 25/25 pass

- **`mui-fixture.html`**
  - 覆盖：MUI X DataGrid（v6/v7）网格：div+ARIA role、单滚动容器 `virtualScroller`、pinned 为同行 sticky cell、行节点复用（`aria-rowindex`，DOM 序倒置注入）、300 行含 3 条分散重复行、JS 属性设值控件、普通 `table` 回归
  - 预期：悬浮高亮、一次点选采集 301 行（含表头）、行序按 `aria-rowindex` 还原、重复行保留

- **`e2e-harness-mui.js`**
  - 覆盖：注入回归（`mui-fixture.html`）：网格识别、滚动采集全量、行序排序、控件实时值、导出断言
  - 预期：`__TEST_RESULT` 数组 24/24 pass

- **`tabulator-fixture.html`**
  - 覆盖：Tabulator（v6，vdom）网格：div 结构、滚动容器 `tableHolder`、冻结列为同行 frozen cell、行追加序即视觉序（无节点复用）、300 行含 3 条分散重复行+无冻结列 150 行例、JS 属性设值控件、普通 `table` 回归
  - 预期：悬浮高亮、一次点选采集 301 行（含表头）、重复行保留

- **`e2e-harness-tabulator.js`**
  - 覆盖：注入回归（`tabulator-fixture.html`）：网格识别、滚动采集全量、控件实时值、导出断言
  - 预期：`__TEST_RESULT` 数组 23/23 pass

- **`pagination-el-fixture.html`**
  - 覆盖：分页表格（仿 `el-pagination` 类名结构：`button.btn-prev`/`ul.el-pager`/`button.btn-next`，disabled 态类+属性双写）：5 页×8 行、翻页仅重建 `tbody`、`input` 控件列（JS 设值）、普通无分页表回归
  - 预期：选中表→「采集全部页」展开设置→「开始采集」（页数上限留空=全部页）直接采集：toast 41 行（含表头）、首行「商品 P1-1」末行「商品 P5-8」、一口价列取 `input` 实时值；先翻第 3 页再采集应先回第 1 页采全量、完成回第 1 页；页数上限填 2→只采前 2 页（toast 17 行+「已采集指定 2 页」，输入框 Enter 同效）；采集中「停止采集」→保留已采页（toast「已停止采集，保留已采集的 N 页」）且导出即已采部分、采集后「列设置」可取样；单表限定（v2.5.3）：再选中普通无分页表→「采集全部页」禁用、悬浮提示「多表选择时不支持分页采集」，取消后恢复；v2.9 进度带总页数（「第 1/5 页，已采集 9 行」，页数上限不改显示总页数）

- **`e2e-harness-paged-el.js`**
  - 覆盖：注入回归（`pagination-el-fixture.html`）：全页采集 41 行、进度逐页推进（`MutationObserver` 记录每次提示文案）、页数上限 2→17 行、起点归一（先翻第 3 页仍从第 1 页起采、完成回第 1 页）、`input` 实时值导出断言
  - 预期：`__TEST_RESULT` 数组 18/18 pass

- **`pagination-ant-fixture.html`**
  - 覆盖：分页表格（仿 `ant-pagination` 类名结构：`li.ant-pagination-prev/item/next`，页码为 `a` 链接，禁用态 `aria-disabled`+`.ant-pagination-disabled`）：4 页×6 行
  - 预期：选中表→「采集全部页」展开设置→「开始采集」（留空=全部页）采集 25 行（含表头）、首行「订单 A-1」末行「订单 D-6」、完成回第 1 页；翻页按钮为链接结构时编程式点击豁免采集期拦截；选择模式下手动点页码可翻页（v2.4 点击放行）

- **`pagination-manual-fixture.html`**
  - 覆盖：分页表格（自建分页器，类名与组件库无交集，「下一页」为 `a` 链接且末页无 disabled 态）：3 页×5 行
  - 预期：选中表→「采集全部页」展开设置→「开始采集」进入「指定翻页按钮」子模式（hint 提示+悬浮高亮任意元素）→点「下一页 »」后采集：toast 16 行（含表头）+「自当前页开始采集，连续翻页无新数据，已停止」；子模式拦截所有点击（含链接）、Esc 取消不丢选区、停止条件（连续 2 页无新行）；v2.9 指定一次即按页面记住（`h2x.pager.v1`）、再次采集直接复用（toast「已复用上次指定的翻页按钮」），按钮消失时回落子模式且保留记忆

- **`e2e-harness-paged-manual.js`**
  - 覆盖：注入回归（`pagination-manual-fixture.html`）：指定翻页按钮并记住（定位器 sel/tag 断言）、复用记忆按钮（不进子模式+复用 toast）、生效记忆保留、按钮失联回落子模式且不清记忆、无总页数时进度只显示当前页、Esc 取消子模式不丢选区
  - 预期：`__TEST_RESULT` 数组 16/16 pass

- **`algo-check.cjs`**
  - 覆盖：纯函数离线回归（Node 直接运行，不碰 DOM）：采集算法、列拆分/列筛选/列顺序/列格式/列宽、分体配对、网格适配器、分页适配器、持久化、格式序列化、通用工具、模块清单一致性、国际化词条一致性——明细见下节
  - 预期：全部 PASS（219 项）

## algo-check 覆盖明细

| 类别 | 覆盖 |
|---|---|
| 采集算法（virtual.js） | 滑动窗口去重、合法重复行保留、非虚拟误报无损、渲染延迟、5000 行性能、超 200 行窗口（回归）；v2.9 元素身份重叠（refOverlapLen 对齐/整窗/无复用边界、refTopsMatch 内容二次校验）、行节点复用+相邻重复不误并、同批节点换绑不整窗吞、无复用+相邻全同既有限制（用例固化） |
| 列拆分（split.js） | 三模式（control/block/delimiter，control 含多控件各自成列/参差补齐/空值占位）、段数上限、从右到左多规则、块内空格不拆（对照 delimiter）、多行表头、含 merges 禁用、规则解析不到原样返回 |
| 列筛选（split.js） | colKeys 唯一表头/重名/空表头兜底、columnLayout 段列映射与短路、filterColumns 排除/全排除防御/短行补空、拆分+筛选端到端 |
| 列顺序（split.js v2.8） | reorderColumns 原列整体重排、自然序/空/缺省 order 原引用零回归、未命中键忽略+自然序补齐、拆分新列跟随原列、与列筛选组合（按过滤后位置重排防列号错位）、数字列键（无表头兜底）重排 |
| 列格式（split.js） | toNumValue 千分位剥离/解析失败保原值、formatColumns 输出列号映射（拆分新列继承、筛选后对齐）、applyColFormats 表头不动/同引用短路、拆分+筛选+数字格式端到端 |
| 自适应列宽（split.js） | cellWidth 半角/全角/谚文宽度与内嵌换行、autoColWidths 逐列最大宽度与 6~50 钳制、空表/空行边界 |
| 分体配对（table.js `pairSplitGroup`） | 基础配对、gutter 列容忍（列数差 1）、间隙/对齐/宽度/列数阈值、轻微重叠容忍、完整表格零回归、颠倒不配对、多候选首个命中 |
| 网格适配器（table.js v2.2） | 注册表完整性（四适配器、五钩子齐备，rootSel 互异且单类名，GRID_ROOT_SELECTOR 组合）、rowsSortedByRowIndex 行序排序（全带 aria-rowindex 数值升序、无/部分缺失保持 DOM 序、纯函数不原地重排、数值比较非字典序）、tableKeyOf 网格分支（适配器表头格拼接、无表头格返回 null、非网格 div 回落内部 table） |
| 分页适配器（pagination.js v2.5） | 注册表完整性（三适配器、四要素齐备，rootSel 互异，next/prev 均为单类名选择器，v2.9 总页数选择器 pageSel 可选且非空）；采集引擎页级重叠合并复用 virtual.js overlapLen 既有用例 |
| 持久化（persist.js） | pageKeyOf 忽略 query/hash、tableKeyOf 指纹（thead 无 tr 的 vxe-table 取 th 子元素而非数据行；v2.1 网格取 dynamic-header-row 表头格、优先内部 table 回退）与空值、sanitizeRecord 损坏剔除自愈（含 formats 键值对、v2.8 order 列顺序数组）与「仅 order 也保留」、evictKeys LRU 淘汰 |
| 格式序列化（format.js） | csvCell RFC4180 转义、toCsv BOM/CRLF、tsvCell 制表符/换行转空格（v2.7 剪贴板）、toTsv 分隔与空表边界、headerKeys 列名兜底、toJson 行对象/表名嵌套、mdCell 转义与 toMarkdown 结构（含无表头生成列N）、toHtmlDocument 结构 |
| 通用工具 | util.js sanitizeFilename/escapeHtml；table.js makeSheetName 四级兜底、非法字符、31 字符截断、重名后缀 |
| 模块清单一致性 | service-worker 注入列表 / 九个 e2e-harness 各自 `FILES` / `extension/content` 实际文件对齐+依赖序（防漏同步；v2.5.2 六个分页 harness 漏注入 `pagination.js` 致 E2E 全线失败后扩全；v2.9 新增两个分页 harness） |
| 国际化词条一致性（v2.6） | 内容脚本与 manifest 引用的全部 `t()`/`__MSG_` 词条 ⊆ `_locales/en`（新增硬编码中文即失败）；manifest `__MSG_` 词条 ⊆ `_locales/zh_CN`（default_locale，缺则显示 key 名）；占位符词条消息须含声明的全部 `$XXX$`；以 en 语言包桩 `chrome.i18n` 驱动 headerKeys/makeSheetName 验证 `$1` 注入（回归：`t()` 曾误用箭头函数 `arguments` 致 subs 恒空） |

## 命令

```powershell
# 一键回归（全链路自动判定）：语法检查 → algo-check → 起静态服务 →
# headless Chromium 跑九个 E2E 页面（虚拟时间快进定时器，约 5 秒），退出码即结果
# run-all.ps1 须保持 UTF-8 带 BOM（PowerShell 5 中文兼容）
.\test\run-all.ps1

# 交互模式（旧行为）：九个 E2E 页面人工核对
.\test\run-all.ps1 -Interactive

# 分步执行：
Get-ChildItem extension/content/*.js | ForEach-Object { node --check $_.FullName }
node --check extension/background/service-worker.js
node test/algo-check.cjs

# DOM 自动回归（auto-check.html，无扩展环境）：
npx serve .   # 仓库根静态服务 → 访问 /test/auto-check.html，页内自判 PASS/FAIL

# 重新生成图标（extension/icons/ 四尺寸；脚本须 UTF-8 带 BOM）：
powershell -ExecutionPolicy Bypass -File test/gen-icon.ps1
```

## E2E 注入回归（无扩展环境）

仓库根 `npx serve .` 后浏览器访问（页面自跑自判，结果在页底浮层、标题栏同步结论）。用 `#e2e=1` 而非 `?e2e=1`：静态服务器 cleanUrls 会丢查询串，hash 不受影响（两种写法均支持）：

```
http://localhost:3000/test/fixture.html#e2e=1 →「156 项全部 PASS」
http://localhost:3000/test/virtual-fixture.html#e2e=1 →「33 项全部 PASS」
http://localhost:3000/test/tablev2-fixture.html#e2e=1 →「24 项全部 PASS」
http://localhost:3000/test/antdv-fixture.html#e2e=1 →「19 项全部 PASS」
http://localhost:3000/test/aggrid-fixture.html#e2e=1 →「25 项全部 PASS」
http://localhost:3000/test/mui-fixture.html#e2e=1 →「24 项全部 PASS」
http://localhost:3000/test/tabulator-fixture.html#e2e=1 →「23 项全部 PASS」
http://localhost:3000/test/pagination-el-fixture.html#e2e=1 →「18 项全部 PASS」
http://localhost:3000/test/pagination-manual-fixture.html#e2e=1 →「16 项全部 PASS」
```

`run-all.ps1` 默认 headless Chromium+`--virtual-time-budget`（快进定时器），九页并行约 5 秒、退出码 0/1 作门禁，无 Chrome/Edge 时降级交互模式；harness 用 `waitFor`+模块缓存（13 内容脚本）+25ms 轮询，分页页用 `MutationObserver` 记录 hint，未跑完的页串行补跑。

手动执行（`__TEST_RESULT` 结构 `{total, passed, results}`）：

```js
const c = await (await fetch('/test/e2e-harness.js?v=' + Date.now())).text();   // 其余页换对应 harness：virtual / tablev2 / antdv / aggrid / mui / tabulator / paged-el / paged-manual
window.__TEST_RESULT = await (0, eval)(c);
```

注意：harness 带并发守卫+轮次串行锁，`window.__TEST_LOG` 为调试日志；`run-all.ps1` 辅助函数（`Start-PageRun`/`Read-PageResult`）须写 `$null = Remove-Item …` 以免污染返回值；国际化（v2.6）桩 chrome 无 `chrome.i18n`（`t()` 回落中文），语言开关偏好写桩 storage 的 `h2x.uiLang`；跨设备同步仅 `e2e-harness.js` 桩 local/sync 两区；导出捕获桩只对 blob 映射命中的链接记账、其余回落原生派发。

## 浏览器回归步骤

1. 刷新扩展（`chrome://extensions`，目录变更后重载 `extension/`）与测试页；未选表时「列设置」「采集全部页」「导出」禁用（仅「取消」可点，v2.10 起导出按钮与右侧下拉拼为一体灰置），选中后解禁。
2. 持久化（v1.7）：保存列设置→刷新重选同表→提示「已恢复上次的列设置」并导出生效；取消选中不清存储；全默认保存后刷新重选回落智能预填默认；改 th 再重选不恢复。
3. 语言开关（v2.6.1）：点「EN」→文案与兜底名（无 caption 表格 Sheet 名=Table N）变英文、`aria-pressed` 移到 EN；退出重进仍英文，再点「EN」回跟随浏览器语言。
4. 剪贴板与配置管理（v2.7）：「▾」选「复制为表格 (TSV)」→toast「已复制 N 行到剪贴板」、粘贴 Excel/飞书还原为表格；「复制为 Markdown」→GFM 表格；「✕」清空已选（toast「已清空已选表格（N 个）」）；「恢复默认」→保存→toast「已清除本页列设置记忆，恢复默认导出」。
5. 列顺序/导出中止/跨设备同步（v2.8）：拖「⋮⋮」手柄变序（导出预览同步）并可持久化；Alt+↑/↓ 逐位移动；合并单元格表手柄灰置；导出中点「停止导出」→toast「已停止导出（已下载 N 个文件）」、选择保留；登录账号保存列设置→另一设备重选恢复，未登录仅本机。
6. 输出方式/文件名/分页记忆（v2.9）：「▾」选「CSV」→重进仍 CSV（清 `h2x.prefs` 回默认 xlsx）；文件名「订单_{date}」→重进变「订单_<当天日期>」；分页页「采集全部页 ▾」→「开始采集」逐页推进「第 1/5 页，已采集 9 行」、上限 2 只采 2 页；「下一页 »」指定后重进复用（toast「已复用上次指定的翻页按钮」），失效提示「上次记住的翻页按钮未生效，已清除记忆」。
7. 导出格式下拉合并（v2.10）：分体按钮主体「导出 Excel」，点「▾」选「CSV (.csv)」→主体文案「导出 CSV」；菜单 Esc/点空白收起、↑/↓+Enter 操作；未选表或忙碌时整块灰置；列设置联动：取消原列导出→其新列联动置灰并排除导出。
8. 拆分控件单控件（v2.10.2）：未拆分行拆分列仅一个勾选框；点勾选框即拆分并展开配置子行；收起/展开用旁侧 chevron 按钮（不取消拆分）；取消勾选移除子行；不填分隔符就收起再保存→自动展开并标红输入框；已保存规则重开面板恢复展开；子行三项输入等宽。

控件取值规则见 [docs/controls.md](../docs/controls.md)；真实页面回归：点三咪折扣活动编辑页（长列表+一口价 input 列）。
