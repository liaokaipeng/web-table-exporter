# 关键机制与开发侧限制

本文承接 [architecture.md](architecture.md)（系统构成与模块职责），描述跨模块的运行时机制；用户可见行为与界面交互见 [product.md](product.md)。

## 关键机制

- **UI/事件**（main.js）：单 Shadow DOM host（`all:initial`），含悬浮高亮层、已选覆盖层、底部工具栏、toast 容器。`mouseover` 委托找 table，`hitRoot()` 解析逻辑根（分体取包装容器；v2.1 无 table 命中回落网格表格根，v2.2 `gridRootOf()` 分发，内嵌 table 优先内层）；`click` v2.4 起捕获阶段放行：非表格点击不拦截（`pruneDetached()` 剔除被替换的选中表格，`exporting` 跳过），仅表格点选与链接 `a[href]` 拦截（红框 1s + toast）；采集中全拦截（2s 节流 toast）；`keydown` Esc 退出 / Enter 导出（焦点在页面元素时放行；拆分面板打开时关面板 / 保存）；`scroll`/`resize` rAF 节流重定位。v2.0：`toast()` 句柄、进度型复用同一条；hint 留引导/进行时、结果性通知走 toast；采集中「取消」变「停止采集」（`stopCollect()` 仅 genToken++）；选中徽标贴边翻内侧（flip-x/y）。v2.4：toast 语义色图标 + 浅底 + 加粗，warn 停留 4s；`doExport()` 迭代前快照表格列表（`yieldToMain()` 期间 prune 不影响导出范围与列设置）

- **分体表格合并**（table.js `splitGroupOf()`）：组件库（Element Plus el-table / vxe-table 等）把表头、表体渲染为两个独立 `<table>`。识别：成员须为片段（纯表头 / 纯数据），自最紧祖先向上找容器（首个命中即返回、深度 ≤12、容器顶层 table ≤8）；配对 = 纯表头表 + 纯数据表**视觉纵向拼接**（间隙 -10\~10px、左对齐、宽度相近、列数差 ≤1 容忍 gutter 列）。`visualRect`：数据表被垂直滚动容器裁剪时 top 取容器顶边，left/width 取 table 本身；水平滚动（scrollable-x）时表头/表体同步平移，容器宽度被裁剪不能用于宽度比较。`pairSplitGroup()` 纯函数（描述符入参不碰 DOM，algo-check.cjs 离线回归）。悬浮/点选/导出以包装容器为键（`hitRoot()`），`getRows()` 合并两表行（表头行在前），空 `gutter` 列跳过

- **div 网格表格**（table.js，v2.1 引入、v2.2 适配器注册表）：虚拟化表格无 `<table>`——div + ARIA role 模拟，只渲染可见窗口行。每组件一适配器（`name` + `rootSel` + 五钩子 `isRoot/headerRowsOf/bodyRowsOf/scrollElsOf/headerCellsOf`），注册表 `GRID_ADAPTERS` 按序分发；virtual/main/persist 经分发入口间接调用。识别 = 组件根特征类（`.el-table-v2__root` / `.ag-root-wrapper` / `.MuiDataGrid-root` / `.tabulator`，后者另校验 `.tabulator-tableHolder`）。`gridRowsOf()` = `headerRowsOf()` 表头行 + `bodyRowsOf()` 数据行：多分区组件（el-table-v2 left/main/right、AG Grid pinned/center）表头行按行号对齐拼接、数据行按视觉序 zip；行节点复用组件（AG Grid / MUI X）DOM 序非视觉序，先经 `rowsSortedByRowIndex()` 按 `aria-rowindex` 数值升序（全部行带该属性才排序，部分缺失保持 DOM 序）。`gridScrollEls()`：el-table-v2 多分区各返回一个（联动 scrollTop），其余单滚动容器

- **提取**（table.js `getRows()`）：兼容 thead 直接嵌 th（无 tr）；过滤 virtual-spacer 占位行、`display:none` 隐藏行；网格表格（v2.2 适配器命中）走 `gridRowsOf()`，普通 table / 分体结构走原路径

- **单元格四通道**（cell.js `openBatch()` 批量两阶段）：merged（控件替换为实时值后的完整文本，默认导出，v1.2 行为不变）/ ctrl（控件实时值**数组**，按 DOM 顺序逐个保留、空值占位不串位，供 control 拆分每控件一列）/ text（移除命中控件后的页面文本）/ blocks（按换行切分的视觉文本块）。归一化：视觉分离的文本块（换行/连续空格/nbsp）压为单空格。控件值经 `controlValue()` 三层判定后**从原元素读实时值**（cloneNode 丢属性设值）替换克隆中的控件再离屏渲染取文本；未命中候选由 innerText 兜底；离屏容器**不能加 `visibility:hidden`**（innerText 排除不可见文本）。性能（v1.8）：逐格离屏挂载每格 2-3 次强制回流，万格表格上万次 reflow；批量两阶段（prepare 全表克隆 → resolve 一次挂载 + 两轮集中读取，写读分组）把整表回流降到常数 \~3 次，普通表（extractTable）与虚拟采集窗口（takeWindow）均受益

- **合并单元格**（table.js `extractTable()`）：rowspan/colspan 展开成网格（每格一次存四通道结果）+ 生成 SheetJS `!merges`，结尾按通道转置产出同形状 aoa/ctrl/text/blocks

- **列拆分**（split.js `applyColumnSplits()` 纯函数 + panel.js 面板）：control 模式**每控件各成一列**（`ctrlCountOf()` 取数据行最大控件数，列名 `ctrlColNames()` 为「原名\_控件」单控件 / 「原名\_控件1..N」多控件，末尾追加「原名\_文本」；控件数不足补空）+ block 按 blocks 通道拆（行内空格不拆）+ delimiter 按分隔符拆段（段数上限并入末段）。block/delimiter 共用「最大段数对齐 + 原名+序号命名」骨架，段值与列名经 `splitSegments()`/`splitColName()` 统一供导出与预览（预览即所得）；多规则按目标列**从右到左**应用；原列保留、新列追加其后；含 merges 或规则解析不到时原样返回（零回归 + 二次防御）。面板交互（智能预填、全列预览、硬校验）见 [product.md](product.md)「列设置面板」

- **导出列筛选**（split.js `colKeys()`/`columnLayout()`/`filterColumns()` + panel.js 面板）：列标识 `colKeys()` 与拆分规则 `resolveRuleCol()` 互逆（唯一非空表头文本 → 文本，否则列序号），拆分新列标识 `key#段号`。`columnLayout()` 模拟 `applyColumnSplits()` 的短路条件与段数计算，产出「输出列号 → 标识」映射；`filterColumns()` 按排除集过滤列。导出链路 `applyColumnSplits → columnLayout → filterColumns`，列号严格对齐（algo-check.cjs 端到端回归）。排除集与规则同存会话内存 Map（无记录 = 全列导出零回归）。含 merges 表跳过筛选（`!merges` 列号基于原始 aoa，过滤会错位；面板同步禁用）。v2.8 列顺序：`reorderColumns(aoa, layout, excluded, order)` 为管线最后一步（拆分 → 筛选 → 格式 → 重排）——按 colKey 排原列顺序、段列紧随原列（不可单独移动），`keep` 判定与 filterColumns 同算法、因入参 aoa 已过滤故按「过滤后位置」重排（无筛选时等价）；order 未命中的键静默忽略、其余按自然序补齐；顺序未变返回原引用（零回归）。含 merges 表面板禁用，`buildAoa()` 亦跳过

- **列格式**（split.js `toNumValue()`/`formatColumns()`/`applyColFormats()` + panel.js 面板）：SheetJS `aoa_to_sheet` 对字符串一律写文本（实测 t:'s'），默认 = 全列文本（订单号/产品ID 前导零与长数字不变形，零回归）；「数字」= 导出前数据行数值化（`toNumValue()` 剥千分位逗号/空白后 Number 解析，空值/解析失败/非有限数保持原文本），表头行不动。格式以原列（colKey）为基准，该列及拆分新列（同源值）一并生效；`formatColumns()` 复用 `filterColumns` 保留判定把格式映射到筛选后输出列号。含 merges 表也可用（layout 给出原列映射；面板仅禁用拆分/筛选）

- **持久化**（persist.js）：拆分规则、列筛选、列格式与列顺序经 `chrome.storage.local` 跨会话保留，定位键 = 页面键（origin+pathname，忽略 query/hash）+ 表指纹（`tableKeyOf()` 取逻辑根内首个 table **表头**单元格文本归一化拼接，兼容 thead 直接嵌 th 无 tr 的 vxe-table 写法——`table.rows` 不含这类 th，取 tbody 首行在虚拟滚动下不稳定，指纹绝不落数据行；分体取表头表；v2.1 网格表格无 table，v2.2 经 `gridHeaderCellsOf()` 取组件表头格拼接（如 el-table-v2 取 `.el-table-v2__dynamic-header-row`），分区间 DOM 序固定故稳定）。数据流：会话内存 Map 是唯一会话真相，`addSelected()` 按指纹恢复（`getSaved()`），面板保存回写 Map 并 `save()` 异步落盘（失败降级当次会话）；`doExport()`/面板入口 `await ready()` 兜底注入初期加载竞态。取消选中/退出只清内存不清存储（重选自动恢复）；保存空配置 = 删记录。表头变更 → 指纹不匹配 → 不恢复（列定位另有 `resolveRuleCol` 静默跳过）。单页条目上限 50，超出按最新 `updatedAt` LRU 淘汰；损坏记录经 `sanitizeRecord()` 剔除自愈；扩展上下文失效读写失败自动降级。v2.8 跨设备同步：local 为真相源（唯一写入口 `scheduleWrite()`），写盘时 `writePage()` 镜像到 `chrome.storage.sync`（独立 20 页 LRU + 单项 ≤7KB 预检，超限只跳过镜像，不影响 local）；注入时 `loadRecords()` 依次读 local 与 sync，按表逐条取 `updatedAt` 更新者合并（相同则先读的 local 胜出）；sync 不可用（未登录/未授权）链路不动，行为与 v1.7 一致

- **虚拟滚动**（virtual.js）：识别（v2.1 网格表格恒虚拟（只渲染可见窗口行）/ 类名含 virtual 的占位元素 / 带高度空 tr，宁可误报——误报时采集无损）→ `collectVirtual()`：回顶 → 按视口 80% 步长下滚 → 每窗口先比对**行 DOM 引用**（同批节点 = 无新行，补等 250ms 重试），再用后缀/前缀重叠合并衔接数据行（表头剥离只留一份，行以 { merged, ctrl, text, blocks } 对象累积）。采集期间锁交互，`genToken` 防退出后回调写入；v2.0「停止采集」复用同一令牌（`stopCollect()` 仅 genToken++，collectVirtual 下一检查点返回 null 且 finally 还原滚动，快照不写入、表格不选中）。快照 `{ rows, ctrl, text, blocks, headerRows }` 与 extractTable 同构。性能（v1.8）：分体组整个采集期解析一次逐窗复用（节点失联时重解析），窗内取值走 openBatch 批量两阶段，行签名数组随 data 同步增长。v2.1：网格表格滚动容器 = `gridScrollEls()` 各分区滚动 window（固定列多分区联动 scrollTop，否则 left/right 窗口与 main 错位丢行）

- **分页翻页采集**（pagination.js，v2.5）：`collectPaged()` 把虚拟采集的「窗口」换成「页」——逐页 `extractTable` 后数据行经 `overlapLen` 重叠合并（页间通常无重叠 k=0 直接拼接；渲染未完成时窗口仍为上一页内容，重叠自然消重），表头只留第一页并逐页经 `tableKeyOf` 指纹校验。起点归一：prev 可用且未禁用则先回第一页再采集。停止四重兜底：下一页 disabled（适配器结构态）/ 连续 2 页无新行（手动按钮无 disabled 态时的行为判定）/ 500 页硬上限 / maxPages 页数上限（0 = 全部页）；结束后 prev 可用时逐页回退到起始页。取消分阶段：起点归一中取消返回 null（尚无数据）；开始后取消返回已采页的部分结果（note 注明「已停止采集，保留已采集的 N 页」，手动中止不丢已采页；退出选择模式由 main 侧 `!active` 短路整体丢弃）。翻页按钮编程式点击经 `isPagingClick()` 豁免采集期拦截（分页器常为 a\[href]，否则 v2.4 链接拦截会使翻页永不发生）。快照与 collectVirtual 同构（不含 merges——跨页拼接的合并行号无法稳定对齐），入 main.js `snapshots` 供导出与列设置取样；翻页中表格根被整段重建时经指纹重解析找回新根（`resolveRoot`），选中随之迁移

- **导出**（main.js + format.js）：导出按钮右侧分体下拉（Excel/CSV/JSON/Markdown/HTML；v2.10 起与导出按钮合并为一个控件）。统一管线：逐表 `buildAoa()`（拆分/筛选/格式已应用）组装 { name, aoa, headerRows, merges } → 生成文件列表 → 逐文件 base64 → 优先 `chrome.runtime.sendMessage` 走后台下载（携带 mime），失败回退页面内 `blob:` 链接；xlsx 多表 → 多 Sheet（caption/aria-label/id 命名，31 字符截断去重）+ `!cols` 自适应列宽（`autoColWidths()`）+ `!merges`。各格式序列化规则与列设置行为见 [product.md](product.md)「导出结果」。性能（v1.8）：逐表间让出主线程（MessageChannel，不受后台标签页定时器节流影响）；base64 用 FileReader 原生编码；`exporting` 重入标志防 yield 间隙双击。v2.0：导出中按钮「导出中…」+ hint 文案；多文件下载 toast 进度（句柄复用同一条）；成功后 `finish()` 保留选择不自动退出，toast 提供「退出」动作。v2.7 剪贴板：下拉末两项（`copy-tsv`/`copy-md`）走同一取数与 `buildAoa` 管线，在「生成文件」前分流——TSV 逐表 `toTsv(tb.aoa)` 空行拼接、Markdown 直接 `toMarkdown(tables)`，经 `writeClipboard()`（Clipboard API 优先 → `execCommand` 兜底 → 双失败常驻错误 toast）写剪贴板并 toast 行数；不下载、不动选择。v2.8 可中止：「取消」在 `exporting` 期变「停止导出」（`abortExport()` 仅 `exportToken++`），`doExport()` 各 yield 检查点比对 `gen !== exportToken` 即静默返回（已落盘文件保留、进度 toast 关闭），`finally` 中 `aborted && active` 补发「已停止导出（已下载 N 个文件）」（`copied` 排除剪贴板重复提示）；Esc 仍整体退出

## 已知限制（开发侧）

用户向限制（合并单元格不还原、iframe 表格、指纹定位失效等）见 [product.md](product.md)「已知限制」，此处仅列开发侧补充：

- 文件名输入框默认值每次进入选择模式重填（仅拆分规则、列筛选、列格式与列顺序持久化，见 persist.js）

- 同页多 tab 并发保存 last-write-wins（低频低危，接受）

- **面板内不要直接调 `toast()`**：`.h2x-mask` 与 `.h2x-toasts` 同为 `z-index:1`，而面板遮罩是后插入的兄弟节点（后插入者在上），面板打开期间 toast 会被遮罩压住。面板内反馈走就地文案（错误汇总 + 输入框标红），需要 toast 时先关面板（当前保存路径即先 `closeSplitPanel()` 再 toast）

- 跨设备同步不做实时推送：仅注入时合并一次（`chrome.storage.onChanged` 未接入，避免与页面注入时序耦合）；sync 写入失败/超限只 `console.warn`，用户侧无感知（local 结果不受影响）
