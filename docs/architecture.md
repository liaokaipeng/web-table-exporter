# 架构文档

## 总体结构

```
┌─────────────┐  点击图标   ┌──────────────────┐  按需注入   ┌─────────────────┐
│ 扩展图标     │ ─────────→ │ service-worker.js │ ─────────→ │ 页面 isolated    │
│ (action)    │            │ (background)      │            │ world           │
└─────────────┘            └────────┬─────────┘            │ ├ xlsx.full.min  │
                                    │ sendMessage          │ └ content/ 11 文件│
                                    ↓ (base64)             └────────┬────────┘
                           ┌──────────────────┐                     │
                           │ chrome.downloads │ ←───────────────────┘
                           └──────────────────┘   生成导出文件后经后台下载
```

## 模块职责

### extension/manifest.json

- MV3，权限最小化：`activeTab` + `scripting`（点击时注入）+ `downloads`（绕过页面 CSP）+ `storage`（v1.7 拆分规则与列筛选持久化；无安装警告的本地存储）
- 无 `host_permissions`、无静态 `content_scripts`——SheetJS 约 950KB，不常驻所有页面
- `extension/` 为插件本体目录（chrome://extensions 加载）；`test/`、`docs/` 为开发材料，不随插件分发

### extension/background/service-worker.js

- `chrome.action.onClicked`：向当前 tab 注入 `lib/xlsx.full.min.js` 与 `content/` 下 11 个文件（同一 isolated world，main.js 直接用全局 `XLSX`；路径相对 extension/ 根）
- `chrome.runtime.onMessage`（`type: 'html2xlsx-download'`）：base64 数据（按 `msg.mime` 定 MIME，缺省 xlsx）经 `chrome.downloads.download` 落盘并回传结果
- 受限页面（chrome:// 等）注入失败静默处理

### extension/content/（11 文件按依赖拓扑序注入，每文件一个 IIFE 挂载到 window.__h2x）

注入守卫（entry.js）：`window.__html2xlsx` 已存在 → 标记 `__h2x.aborted` 并调上轮 `toggle()` 退出（再次点击图标 = 退出选择模式，本轮后续文件放弃初始化）；否则创建命名空间。零构建无 import/export，**注入顺序即依赖顺序**：

| 文件 | 依赖 | 职责 |
|---|---|---|
| entry.js | — | 注入守卫 + `__h2x` 命名空间 |
| util.js | — | timestamp() / sanitizeFilename() / escapeHtml() |
| controls.js | — | `controlValue()` 三层判定 + CONTROL_SEL（详见 docs/controls.md） |
| split.js | — | 列拆分/列筛选/列格式/列宽纯函数 17 个；零依赖（algo-check.cjs 整文件加载回归，不得引用其他模块） |
| cell.js | controls, split | `openBatch()` 批量两阶段四通道取值 + 归一化 + 图片链接替换 |
| table.js | cell | `getRows()` / `extractTable()` / `makeSheetName()` / `splitGroupOf()` / `pairSplitGroup()`（分体识别 + 纯函数配对，模块级零 DOM 引用，algo-check.cjs 离线回归）；表头行判定 = thead/tfoot 行 + tbody 全 th 行（extractTable 取前导连续段） |
| virtual.js | table | `isVirtualTable()` / `collectVirtual()` / `overlapLen()` |
| persist.js | entry | 拆分规则/列筛选/列格式持久化：`tableKeyOf()` 表指纹 + `getSaved()`/`save()` 恢复与落盘 + `ready()` 就绪兜底；页面键 = origin+pathname，存 `chrome.storage.local`（单页一条，LRU 上限 50 页）；纯函数可离线回归（详见 docs/persist-plan.md） |
| format.js | util | 导出格式序列化纯函数：`toCsv()`（RFC4180+BOM）/ `toJson()`（行对象）/ `toMarkdown()`（GFM 表格）/ `toHtmlDocument()`（完整文档）；algo-check.cjs 离线回归 |
| panel.js | util, table, split, persist | 「列设置」面板（导出列筛选 + 拆分配置 + 列格式）；v2.0 重构：列行折叠式（拆分配置收进展开子行，模式/分隔符键入只局部刷新新列勾选区）、多表页签（带已配置状态点）、最终输出全列预览、校验错误就地标红 + 底部汇总、focus trap + role="dialog"；依赖经 `panel.init({ host, selected, snapshots, splitRules, colFilters, colFormats, isBusy, isAlive, updateBar, toast })` 注入，UI 层内部契约显式化；面板样式自持，按钮样式共用主 UI 的 `<style>`；保存时经 `ns.persist.save()` 落盘 |
| main.js | 其余全部 | 主 UI / 事件 / 选中管理 / 导出 / 退出清理 / 启动装配；v2.0 新增：toast 反馈系统（结果性通知迁出 hint，成功/信息 2.5s 自动消失、错误常驻可关、同屏 3 条上限）、虚拟采集可中止（「停止采集」genToken 作废当前任务）、导出后保留选择（toast「退出」动作）、设计 token + 深色模式（prefers-color-scheme）+ 动效（prefers-reduced-motion） |

关键机制：

- **UI/事件**（main.js）：单个 Shadow DOM host（`all:initial` 隔离页面样式），含悬浮高亮层、已选覆盖层、底部工具栏、toast 容器。`mouseover` 委托找 table，经 `hitRoot()` 解析为逻辑表格根（分体结构取包装容器）；`click` 捕获阶段拦截页面跳转（工具栏自身放行）；`keydown` Esc 退出 / Enter 导出（拆分面板打开时改为关面板 / 保存）；`scroll`/`resize` rAF 节流重定位。v2.0：设计 token（颜色/圆角 CSS 变量定义于 :host，工具栏与面板共享，深色模式经 `prefers-color-scheme` 覆写）；toast 系统（`toast()` 返回句柄支持进度型复用同一条）；反馈双通道——hint 行只留引导/进行时文案（默认提示、采集进度、导出中），结果性通知全走 toast；采集期间「取消」按钮变「停止采集」（`stopCollect()` 仅 genToken++ 作废任务，不退出选择模式）；选中徽标贴视口边缘时翻内侧（flip-x/y）
- **分体表格合并**（table.js `splitGroupOf()`）：组件库（Element Plus el-table / vxe-table 等）把表头与表体渲染成两个独立 `<table>`。识别：成员 table 须为片段（纯表头 / 纯数据），自最紧祖先向上找容器（首个命中即返回、深度 ≤12、容器顶层 table ≤8，防误并远祖容器中的独立表格）；配对 = 纯表头表 + 纯数据表**视觉纵向拼接**（间隙 -10~10px、左对齐、宽度相近、列数差 ≤1 容忍滚动条 gutter 列）。视觉矩形（`visualRect`）：数据表被垂直滚动容器裁剪时 top 取容器顶边（滚动会移动 table 本身），left/width 仍取 table 本身——水平滚动（scrollable-x）时组件库同步平移表头/表体（天然对齐），而容器宽度被水平裁剪（表宽 > 容器宽），不能用于宽度比较。配对判定核心 `pairSplitGroup()` 为纯函数（描述符入参不碰 DOM，algo-check.cjs 离线回归）。悬浮/点选/导出统一以包装容器为键（`hitRoot()`），`getRows()` 合并两表行（表头行在前），表头空 `gutter` 列跳过；虚拟采集同理从数据表找滚动容器
- **提取**（table.js `getRows()`）：兼容 thead 直接嵌 th（无 tr）；过滤 virtual-spacer 占位行、`display:none` 隐藏行
- **单元格四通道**（cell.js `openBatch()` 批量两阶段）：merged（控件替换为实时值后的完整文本，默认导出，v1.2 行为不变）/ ctrl（控件实时值**数组**，按 DOM 顺序逐个保留、空值占位不串位，供 control 拆分每控件一列）/ text（移除命中控件后的页面文本）/ blocks（按换行切分的视觉文本块，如「标题/产品ID」双行格 → [标题, 产品ID]）。归一化：视觉上分离的文本块（换行/连续空格/nbsp）压缩为单个空格，本来相连的文本保持相连。控件值经 `controlValue()` 三层判定后**从原元素读取实时值**（cloneNode 丢属性设值）替换克隆中的控件再离屏渲染取文本；未命中候选保留原样由 innerText 兜底；离屏容器**不能加 `visibility:hidden`**（innerText 排除不可见文本）。性能（v1.8）：逐格离屏挂载每格 2-3 次强制回流，万格表格 = 上万次 reflow；批量两阶段（prepare 全表克隆 → resolve 一次挂载 + 两轮集中读取，写读分组）把整表回流降到常数 ~3 次，普通表（extractTable）与虚拟采集窗口（takeWindow）均受益
- **合并单元格**（table.js `extractTable()`）：rowspan/colspan 展开成网格（每格一次存四通道结果）+ 生成 SheetJS `!merges`，结尾按通道转置产出同形状的 aoa/ctrl/text/blocks
- **列拆分**（split.js `applyColumnSplits()` 纯函数 + panel.js 面板）：control 模式**每个控件各成一列**（`ctrlCountOf()` 取数据行最大控件数，列名 `ctrlColNames()` 为「原名_控件」单控件 / 「原名_控件1..N」多控件，末尾追加「原名_文本」；控件数不足的行补空，同格多控件不再顿号合并）+ block 模式按 blocks 通道拆（行内空格不拆）+ delimiter 模式按分隔符拆段（段数上限并入末段）。block/delimiter 共用「最大段数对齐 + 原名+序号命名」骨架，段值与列名经 `splitSegments()`/`splitColName()` 统一供导出与预览（预览即所得）；多规则按目标列**从右到左**应用；原列保留、新列追加其后；含 merges 或规则解析不到时原样返回（零回归 + 二次防御）。面板（v2.0）：智能预填（多行文本列默认展开 block、控件列展开后预设 control）、最终输出全列预览（原列 + 新列完整结构，前 3 行实时刷新，预览即所得）、硬校验（分隔符非空、上限 ≥2 或不限，错误就地标红 + 底部汇总）；普通表现跑 extractTable 取样，虚拟表须采集完成后用快照取样
- **导出列筛选**（split.js `colKeys()`/`columnLayout()`/`filterColumns()` + panel.js 面板）：列标识 `colKeys()` 与拆分规则的 `resolveRuleCol()` 互逆（唯一非空表头文本 → 文本，否则列序号），拆分新列标识为 `key#段号`。`columnLayout()` 模拟 `applyColumnSplits()` 的短路条件与段数计算，产出「输出列号 → 标识」映射；`filterColumns()` 按排除集过滤列。导出链路：`applyColumnSplits → columnLayout → filterColumns`，三者列号严格对齐（algo-check.cjs 端到端回归）。排除集与规则同存会话内存 Map（无记录 = 全列导出零回归），持久化生命周期见下条。含 merges 的表跳过筛选（`!merges` 列号基于原始 aoa，过滤会错位；面板侧同步禁用）。面板：每列「导出」勾选（默认全选）+ 拆分列子行的逐新列勾选 + 全选/全不选快捷按钮 + 「至少保留一列」硬校验；预览对不导出列划线灰显
- **列格式**（split.js `toNumValue()`/`formatColumns()`/`applyColFormats()` + panel.js 面板）：SheetJS `aoa_to_sheet` 对字符串一律写文本（实测 t:'s'），故默认行为 = 全列文本（订单号/产品ID 前导零与长数字不变形，零回归）；列格式「数字」= 导出前把数据行数值化（`toNumValue()` 剥千分位逗号/空白后 Number 解析，空值/解析失败/非有限数保持原文本），表头行不动。格式以原列（colKey）为基准，该列及其拆分新列（同源值）一并生效；`formatColumns()` 复用 `filterColumns` 的保留判定把格式映射到筛选后的输出列号（列号对齐）。含 merges 的表也可用（不涉及列重排，layout 对 merges 表给出原列映射；面板仅禁用拆分/筛选）。面板：每列行末「格式」下拉（文本=默认/数字），预览对数字列即时显示数值化结果（预览即所得）
- **持久化**（persist.js）：拆分规则、列筛选与列格式经 `chrome.storage.local` 跨会话保留，定位键 = 页面键（origin+pathname，忽略 query/hash）+ 表指纹（`tableKeyOf()` 取逻辑根内首个 table **表头**单元格文本归一化拼接，兼容 thead 直接嵌 th 无 tr 的 vxe-table 写法——`table.rows` 不含这类 th，取 tbody 首行会在虚拟滚动下不稳定，指纹绝不落数据行；分体结构取表头表）。数据流：会话内存 Map 是唯一会话真相，`addSelected()` 时按指纹恢复（`getSaved()`），面板保存时回写 Map 并 `save()` 异步落盘（fire-and-forget，失败降级当次会话有效）；`doExport()`/面板入口 `await ready()` 兜底注入初期的加载竞态。取消选中/退出只清内存不清存储（重选自动恢复）；保存空配置 = 删除记录（重置路径）。表头变更 → 指纹不匹配 → 不恢复（列定位另有 `resolveRuleCol` 静默跳过防御）。单页条目上限 50，超出按页面最新 `updatedAt` LRU 淘汰；损坏记录经 `sanitizeRecord()` 剔除自愈；扩展上下文失效（重载扩展）读写失败自动降级
- **虚拟滚动**（virtual.js）：识别（类名含 virtual 的占位元素 / 带高度空 tr，宁可误报——误报时采集流程无损）→ `collectVirtual()`：回顶 → 按视口 80% 步长下滚 → 每窗口先比对**行 DOM 引用**（同批节点 = 无新行，补等 250ms 重试），再用后缀/前缀重叠合并衔接数据行（表头剥离只留一份，行以 { merged, ctrl, text, blocks } 对象累积）。采集期间锁交互，`genToken` 代际令牌防退出后回调写入；v2.0「停止采集」复用同一令牌（`stopCollect()` 仅 genToken++，collectVirtual 在下一检查点返回 null 且 finally 还原滚动位置，快照不写入、表格不选中）。快照 `{ rows, ctrl, text, blocks, headerRows }` 与 extractTable 结果同构（列拆分数据流统一）。性能（v1.8）：分体组整个采集期间解析一次逐窗复用（表格节点失联时重解析），窗内取值走 openBatch 批量两阶段，行签名数组随 data 同步增长免逐窗全量重算
- **导出**（main.js + format.js）：工具栏格式下拉（Excel/CSV/JSON/Markdown/HTML 人话标签），统一管线：逐表 `buildAoa()`（拆分/筛选/格式已应用）组装表单元 { name, aoa, headerRows, merges } → 按格式生成文件列表 → 逐文件 base64 → 优先 `chrome.runtime.sendMessage` 走后台下载（消息携带 mime）；失败回退页面内 `blob:` 链接。xlsx：多表 → 多 Sheet（caption/aria-label/id 命名，31 字符截断去重）+ SheetJS `!cols` 自适应列宽（split.js `autoColWidths()`，按最终输出 aoa 逐列取最大视觉宽度钳制 6~50）+ `!merges` 合并单元格。CSV（format.js `toCsv()`）：RFC4180 转义 + UTF-8 BOM + CRLF 行尾，Excel 直接打开不乱码；多表拆多文件（文件名带表名后缀）。JSON（`toJson()`）：单表 = 行对象数组、多表 = 表名键嵌套；列名取末行表头，空名补「列N」、重名加序号，数字列输出数值。Markdown（`toMarkdown()`）：GFM 表格，多表二级标题分区，竖线转义、单元格内换行转 `<br>`，无表头生成「列N」表头行。HTML（`toHtmlDocument()`）：完整文档（UTF-8 声明 + 极简表格样式），表头行入 thead/th，可浏览器直接打开。文本格式均为平面数据不还原 merges。性能（v1.8）：逐表之间让出主线程（MessageChannel，不受后台标签页定时器节流影响），导出期间页面可交互；base64 用 FileReader 原生编码替代分块拼接；`exporting` 重入标志防 yield 间隙双击重复导出。v2.0：导出中按钮「导出中…」+ hint 进行时文案；多文件下载 toast 实时进度（「正在下载 i/n」句柄复用同一条）；成功后 `finish()` 保留选择不自动退出，toast 提供「退出」动作（Esc / 取消 / toast 退出三条路径均可退出）

## 关键设计决策

| 决策 | 理由 |
|---|---|
| 零构建多文件：注入顺序即依赖 + `__h2x` 命名空间 | 不引打包器（硬约束）；每文件一个 IIFE 挂载模块，service-worker 的 files 数组即依赖拓扑序；split.js 零依赖使 algo-check.cjs 可整文件加载回归 |
| 按需注入而非静态 content_scripts | SheetJS 体积大，避免所有页面常驻开销；activeTab 权限利于商店审核 |
| 下载走后台 chrome.downloads | 页面 CSP（如 ERP 后台）拦截 blob: 下载且静默失败；扩展 downloads API 不受页面策略限制，失败时仍回退 blob |
| UI 全部 Shadow DOM + 内联样式 | 不注入 CSS 文件，`all:initial` 阻断页面样式污染 |
| 虚拟采集用「DOM 引用判定 + 相邻窗口重叠合并」 | DOM 引用相同 = 窗口没变（非虚拟误报 / 渲染未完成）直接跳过；后缀/前缀匹配消除窗口重叠区重复，同时保留数据中合法的重复行（全局内容去重做不到） |
| genToken 代际令牌 | 异步采集中用户退出/重选时，令牌使旧任务回调失效 |
| 列拆分用「四通道 + 纯函数」 | 采集时一次取齐，默认导出走 merged 通道与 v1.2 完全一致；blocks 保留块级元素边界使双行格能按行拆而块内空格不拆；applyColumnSplits 不碰 DOM 可离线回归 |
| 列筛选用「排除集 + 输出列布局」 | 无记录 = 全列导出（零回归）；`columnLayout()` 与 `applyColumnSplits()` 共用短路条件与段数算法，过滤列号严格对齐 |
| 列格式只存「数字」且以原列为基准 | `aoa_to_sheet` 对字符串一律写文本，文本即默认行为无需记录；拆分新列与原列同源，格式随原列继承（一处设置全链路生效）；`formatColumns()` 复用筛选保留判定，筛选后输出列号不错位；数值化剥千分位/空白、失败保原文本，Excel 里不丢内容 |
| 自适应列宽用「视觉宽度估算 + 上下限钳制」 | 逐列取单元格最大视觉宽度（`isWideCode()` 判 CJK/全角/谚文按 2、半角按 1，内嵌换行取最长行），钳制 [6, 50]（`wch` 字符数）：下限防窄列挤成一条线，上限防超长内容撑爆版面；计满上限即截断返回（结果等价，万行大表免逐字符全量计数）；在列拆分/筛选/格式应用后的最终 aoa 上计算，列序天然对齐 |
| 持久化用「页面键 + 表指纹」而非 DOM 引用 | DOM 元素无法序列化；表头文本与 colKeys 列标识同一哲学，表头变 → 指纹不匹配 → 安全降级默认配置（旧规则不误用）；会话内存 Map 仍为唯一真相，面板/导出链路零改动即可读到恢复值；chrome.storage.local 仅本地不上传，读写失败自动降级当次会话有效（详见 docs/persist-plan.md） |
| 图片导出为链接（cell.js） | img 值从原元素读（`src` 解析后的绝对地址，srcset 场景兜底 `currentSrc`），按索引对齐替换进克隆——与控件同套路；替换先于控件值替换执行，防止嵌在命中控件内的 img 随控件整体替换丢失而串位；链接进入 merged/text/blocks 通道，导出、预览、列拆分全链路一致 |
| 单元格取值用批量两阶段（cell.js `openBatch()`） | 逐格离屏挂载 = 每格 2-3 次强制回流（innerText 依赖渲染布局），万格表格上万次 reflow；写读分组集中执行（克隆先挂游离 holder → 一次挂载 → 两轮集中读 → 集中移除注入节点再集中读）把整表回流降为常数 ~3 次，行为与逐格实现完全一致（同克隆骨架同两轮读取） |
| 面板段数计算按参数记忆化（panel.js `segCountOf`） | 面板每次勾选/键入都触发全列全行重扫，万行虚拟快照下交互卡顿；缓存键 = (列, 模式, 分隔符, 上限) 即全部输入（sample 面板生命周期内不变），无需失效机制 |
| 分体表格用「结构片段 + 视觉拼接」双重判定 | 只认片段 table（纯表头/纯数据），完整表格零回归；视觉拼接（间隙/对齐/宽度/列数）防止把同容器里两个独立表格误并；自最紧祖先向上首个命中即返回，无需维护组件库类名清单 |
| 下载文件名 sanitize | 过滤 `\/:*?"<>|`、去首部点号（chrome.downloads 限制）、按所选格式补扩展名（xlsx/csv/json/md/html） |
| 多格式序列化为纯函数模块（format.js） | 与 XLSX 库解耦（仅 xlsx 路径依赖 SheetJS）；输入即导出管线末端的 aoa（拆分/筛选/列格式已应用），全格式列设置行为一致；algo-check.cjs 离线回归转义与结构 |
| CSV 多表拆多文件、json/md/html 汇总单文件 | CSV 单文件无法承载多表（拼接会破坏列结构）；JSON 表名键嵌套、MD 二级标题分区、HTML 多 `<table>` 天然支持多表；单表时文件名不带表名后缀保持简洁 |
| JSON 行对象的列名规则：末行表头 + 列N 补齐 + 重名加序号 | 多行表头末行最贴近数据（叶子列名）；空列名/无表头补「列N」保证键完整；重名列作对象键会静默覆盖丢数据，序号后缀保住全部列 |
| MD 单元格竖线转义、换行转 `<br>` | GFM 表格行以竖线定界、单元格内不允许裸换行，不转义会破坏表格结构；无表头表格生成「列N」表头行（GFM 必须有表头） |
| 表头行判定：thead/tfoot 行 + tbody 全 th 前导行（v1.11） | 手写表格（内网页/生成报表）常见 `<tr><th>` 无 thead 写法，此前 headerRows=0 会让 json/md/html 把表头行当数据（xlsx 全行照写不可见）；全 th 行计为表头后无 thead 表也能得到真实列名/表头区。xlsx 输出不变（无规则时 aoa 全行照写），指纹不变（headerCellsOf 无 thead 时本就取首行），虚拟表/分体配对（headerRowCount 独立只认 thead）不受影响；代价：无 thead 表的持久化列键从数字变文本，旧保存配置不恢复（回落智能预填，一次性） |
| 反馈双通道：hint 留引导/进行时，结果性通知走 toast（v2.0） | hint 是工具栏内一行小字，成功提示与错误混排会顶掉引导文案且错误转瞬即逝；toast 右上角独立堆叠（成功/信息 2.5s 自动消失、错误常驻 + 关闭钮、同屏 3 条上限），进度型经返回句柄复用同一条（下载进度 i/n 不刷屏）；面板与主 UI 共用 deps.toast 注入，不新增内容脚本模块 |
| 导出成功保留选择，不自动退出（v2.0） | 自动退出是「一锤子买卖」，换格式连续导出（Excel 给同事、CSV 给程序）须重选全部表格；保留选择后 toast 提供「退出」动作 + Esc/取消兜底，三条退出路径闭环；此为交互模型变更 → 主版本号 2.0 |
| 虚拟采集可中止，复用 genToken（v2.0） | 采集不可中止时「取消」= 整体退出，误触代价大（须重进选择模式重选）；「停止采集」只 genToken++ 作废当前任务（collectVirtual 检查点返回 null、finally 还原滚动），选择模式保留可重新点选；与退出共用同一令牌机制，无新增状态 |
| 视觉 token 化 + 深色模式跟随系统（v2.0） | 颜色/圆角集中为 :host CSS 变量，工具栏与面板两个 `<style>` 共享一份 token，改色一处生效；深色模式经 prefers-color-scheme 覆写 token、无手动开关（避免面板多一个控件，且与系统一致的心智负担最小）；prefers-reduced-motion 全局关动效 |

## 已知限制

- 仅顶层文档表格，iframe 内表格不处理
- 单元格导出纯文本，不保留颜色/字体样式；图片导出为链接（src 绝对地址），video/svg/iframe 导出为空
- 文件名输入框默认值每次进入选择模式重填（仅拆分规则、列筛选与列格式持久化，见 persist.js）
- 持久化按表指纹定位：表头变更后不恢复（回落默认）；同页两个表头完全一致的表格共享一份配置；同页多 tab 并发保存 last-write-wins（低频低危）
- 含合并单元格的表格不支持列筛选（!merges 列号基于原始网格，过滤会错位；面板已禁用；列格式不涉及列重排，仍可用）；合并单元格仅在 xlsx 导出还原，csv/json/md/html 为平面数据
- 数字列格式（数值化）全格式生效，但 csv/md/html 单元格为字符串形式（如 `"123"`），仅 json 保留数值类型（`123`）
- 虚拟滚动 + 整行内容完全相同且相邻出现时，理论上可能少采（内容对齐的固有歧义；分散出现的重复行不受影响）
- 分体表格合并依赖「纯表头表 + 纯数据表视觉纵向拼接」判定：同容器中两个视觉上无缝拼接、列数一致的独立表格（如空表头表格紧贴数据表格）会被视为一个表格；组件库的汇总行表（如 el-table show-summary 的 footer 表）不参与合并
