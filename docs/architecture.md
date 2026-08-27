# 架构文档

## 总体结构

```
┌─────────────┐  点击图标   ┌──────────────────┐  按需注入   ┌─────────────────┐
│ 扩展图标     │ ─────────→ │ service-worker.js │ ─────────→ │ 页面 isolated    │
│ (action)    │            │ (background)      │            │ world           │
└─────────────┘            └────────┬─────────┘            │ ├ xlsx.full.min  │
                                    │ sendMessage          │ └ content/ 9 文件 │
                                    ↓ (base64)             └────────┬────────┘
                           ┌──────────────────┐                     │
                           │ chrome.downloads │ ←───────────────────┘
                           └──────────────────┘   生成 xlsx 后经后台下载
```

## 模块职责

### extension/manifest.json

- MV3，权限最小化：`activeTab` + `scripting`（点击时注入）+ `downloads`（绕过页面 CSP）
- 无 `host_permissions`、无静态 `content_scripts`——SheetJS 约 950KB，不常驻所有页面
- `extension/` 为插件本体目录（chrome://extensions 加载）；`test/`、`docs/` 为开发材料，不随插件分发

### extension/background/service-worker.js

- `chrome.action.onClicked`：向当前 tab 注入 `lib/xlsx.full.min.js` 与 `content/` 下 9 个文件（同一 isolated world，main.js 直接用全局 `XLSX`；路径相对 extension/ 根）
- `chrome.runtime.onMessage`（`type: 'html2xlsx-download'`）：base64 数据经 `chrome.downloads.download` 落盘并回传结果
- 受限页面（chrome:// 等）注入失败静默处理

### extension/content/（9 文件按依赖拓扑序注入，每文件一个 IIFE 挂载到 window.__h2x）

注入守卫（entry.js）：`window.__html2xlsx` 已存在 → 标记 `__h2x.aborted` 并调上轮 `toggle()` 退出（再次点击图标 = 退出选择模式，本轮后续文件放弃初始化）；否则创建命名空间。零构建无 import/export，**注入顺序即依赖顺序**：

| 文件 | 依赖 | 职责 |
|---|---|---|
| entry.js | — | 注入守卫 + `__h2x` 命名空间 |
| util.js | — | timestamp() / sanitizeFilename() / escapeHtml() |
| controls.js | — | `controlValue()` 三层判定 + CONTROL_SEL（详见 docs/controls.md） |
| split.js | — | 列拆分纯函数 7 个；零依赖（algo-check.cjs 整文件加载回归，不得引用其他模块） |
| cell.js | controls | `cellParts()` 四通道取值 + 归一化 |
| table.js | cell | `getRows()` / `extractTable()` / `makeSheetName()` / `splitGroupOf()` / `pairSplitGroup()`（分体识别 + 纯函数配对，模块级零 DOM 引用，algo-check.cjs 离线回归） |
| virtual.js | table | `isVirtualTable()` / `collectVirtual()` / `overlapLen()` |
| panel.js | util, table, split | 「拆分列」面板；依赖经 `panel.init({ host, selected, snapshots, splitRules, isBusy, isAlive, updateBar, setHint, resetHint })` 注入，UI 层内部契约显式化；面板样式自持，按钮样式共用主 UI 的 `<style>` |
| main.js | 其余全部 | 主 UI / 事件 / 选中管理 / 导出 / 退出清理 / 启动装配 |

关键机制：

- **UI/事件**（main.js）：单个 Shadow DOM host（`all:initial` 隔离页面样式），含悬浮高亮层、已选覆盖层、底部工具栏。`mouseover` 委托找 table，经 `hitRoot()` 解析为逻辑表格根（分体结构取包装容器）；`click` 捕获阶段拦截页面跳转（工具栏自身放行）；`keydown` Esc 退出 / Enter 导出（拆分面板打开时改为关面板 / 保存）；`scroll`/`resize` rAF 节流重定位
- **分体表格合并**（table.js `splitGroupOf()`）：组件库（Element Plus el-table / vxe-table 等）把表头与表体渲染成两个独立 `<table>`。识别：成员 table 须为片段（纯表头 / 纯数据），自最紧祖先向上找容器（首个命中即返回、深度 ≤12、容器顶层 table ≤8，防误并远祖容器中的独立表格）；配对 = 纯表头表 + 纯数据表**视觉纵向拼接**（间隙 -10~10px、左对齐、宽度相近、列数差 ≤1 容忍滚动条 gutter 列）。视觉矩形（`visualRect`）：数据表被垂直滚动容器裁剪时 top 取容器顶边（滚动会移动 table 本身），left/width 仍取 table 本身——水平滚动（scrollable-x）时组件库同步平移表头/表体（天然对齐），而容器宽度被水平裁剪（表宽 > 容器宽），不能用于宽度比较。配对判定核心 `pairSplitGroup()` 为纯函数（描述符入参不碰 DOM，algo-check.cjs 离线回归）。悬浮/点选/导出统一以包装容器为键（`hitRoot()`），`getRows()` 合并两表行（表头行在前），表头空 `gutter` 列跳过；虚拟采集同理从数据表找滚动容器
- **提取**（table.js `getRows()`）：兼容 thead 直接嵌 th（无 tr）；过滤 virtual-spacer 占位行、`display:none` 隐藏行
- **单元格四通道**（cell.js `cellParts()`）：merged（控件替换为实时值后的完整文本，默认导出，v1.2 行为不变）/ ctrl（控件实时值，多控件格过滤空值顿号连接）/ text（移除命中控件后的页面文本）/ blocks（按换行切分的视觉文本块，如「标题/产品ID」双行格 → [标题, 产品ID]）。归一化：视觉上分离的文本块（换行/连续空格/nbsp）压缩为单个空格，本来相连的文本保持相连。控件值经 `controlValue()` 三层判定后**从原元素读取实时值**（cloneNode 丢属性设值）替换克隆中的控件再离屏渲染取文本；未命中候选保留原样由 innerText 兜底；离屏容器**不能加 `visibility:hidden`**（innerText 排除不可见文本）
- **合并单元格**（table.js `extractTable()`）：rowspan/colspan 展开成网格（每格一次存四通道结果）+ 生成 SheetJS `!merges`，结尾按通道转置产出同形状的 aoa/ctrl/text/blocks
- **列拆分**（split.js `applyColumnSplits()` 纯函数 + panel.js 面板）：control 模式 ctrl/text 通道各成一列；block 模式按 blocks 通道拆（行内空格不拆）；delimiter 模式按分隔符拆段（段数上限并入末段）。block/delimiter 共用「最大段数对齐 + 原名+序号命名」骨架，段值与列名经 `splitSegments()`/`splitColName()` 统一供导出与预览（预览即所得）；多规则按目标列**从右到左**应用；原列保留、新列追加其后；含 merges 或规则解析不到时原样返回（零回归 + 二次防御）。面板：智能预填、前 3 行实时预览、硬校验（分隔符非空、上限 ≥2 或不限）；普通表现跑 extractTable 取样，虚拟表须采集完成后用快照取样
- **虚拟滚动**（virtual.js）：识别（类名含 virtual 的占位元素 / 带高度空 tr，宁可误报——误报时采集流程无损）→ `collectVirtual()`：回顶 → 按视口 80% 步长下滚 → 每窗口先比对**行 DOM 引用**（同批节点 = 无新行，补等 250ms 重试），再用后缀/前缀重叠合并衔接数据行（表头剥离只留一份，行以 { merged, ctrl, text, blocks } 对象累积）。采集期间锁交互，`genToken` 代际令牌防退出后回调写入。快照 `{ rows, ctrl, text, blocks, headerRows }` 与 extractTable 结果同构（列拆分数据流统一）
- **导出**（main.js）：多表 → 多 Sheet（caption/aria-label/id 命名，31 字符截断去重）→ `XLSX.write` ArrayBuffer → base64 → 优先 `chrome.runtime.sendMessage` 走后台下载；失败回退页面内 `blob:` 链接

## 关键设计决策

| 决策 | 理由 |
|---|---|
| 零构建多文件：注入顺序即依赖 + `__h2x` 命名空间 | 不引打包器（硬约束）；每文件一个 IIFE 挂载模块，service-worker 的 files 数组即依赖拓扑序；split.js 零依赖使 algo-check.cjs 可整文件加载回归 |
| 按需注入而非静态 content_scripts | SheetJS 体积大，避免所有页面常驻开销；activeTab 权限利于商店审核 |
| 下载走后台 chrome.downloads | 页面 CSP（如 ERP 后台）拦截 blob: 下载且静默失败；扩展 downloads API 不受页面策略限制，失败时仍回退 blob |
| UI 全部 Shadow DOM + 内联样式 | 不注入 CSS 文件，`all:initial` 阻断页面样式污染 |
| 虚拟采集用「DOM 引用判定 + 相邻窗口重叠合并」 | DOM 引用相同 = 窗口没变（非虚拟误报 / 渲染未完成）直接跳过；后缀/前缀匹配消除窗口重叠区重复，同时保留数据中合法的重复行（全局内容去重做不到） |
| genToken 代际令牌 | 异步采集中用户退出/重选时，令牌使旧任务回调失效 |
| 列拆分用「四通道 + 纯函数」 | 采集时一次取齐，默认导出走 merged 通道与 v1.2 完全一致；blocks 保留块级元素边界使双行格能按行拆而块内空格不拆；applyColumnSplits 不碰 DOM 可离线回归；规则存内存 Map（权限最小化，不碰 chrome.storage） |
| 分体表格用「结构片段 + 视觉拼接」双重判定 | 只认片段 table（纯表头/纯数据），完整表格零回归；视觉拼接（间隙/对齐/宽度/列数）防止把同容器里两个独立表格误并；自最紧祖先向上首个命中即返回，无需维护组件库类名清单 |
| 下载文件名 sanitize | 过滤 `\/:*?"<>|`、去首部点号（chrome.downloads 限制）、补 .xlsx 后缀 |

## 已知限制

- 仅顶层文档表格，iframe 内表格不处理
- 单元格导出纯文本，不保留颜色/字体样式；图片列导出为空
- 无设置持久化（每次进入选择模式重填默认文件名；列拆分规则同为内存态，退出即清空）
- 虚拟滚动 + 整行内容完全相同且相邻出现时，理论上可能少采（内容对齐的固有歧义；分散出现的重复行不受影响）
- 分体表格合并依赖「纯表头表 + 纯数据表视觉纵向拼接」判定：同容器中两个视觉上无缝拼接、列数一致的独立表格（如空表头表格紧贴数据表格）会被视为一个表格；组件库的汇总行表（如 el-table show-summary 的 footer 表）不参与合并
