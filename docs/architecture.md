# 架构文档

## 总体结构

```
┌─────────────┐  点击图标   ┌──────────────────┐  按需注入   ┌─────────────────┐
│ 扩展图标     │ ─────────→ │ service-worker.js │ ─────────→ │ 页面 isolated    │
│ (action)    │            │ (background)      │            │ world           │
└─────────────┘            └────────┬─────────┘            │ ├ xlsx.full.min  │
                                    │ sendMessage          │ ├ i18n（界面语言）  │
                                    ↓ (base64)             │ └ content/ 13 文件│
                           ┌──────────────────┐             └────────┬────────┘
                           │ chrome.downloads │ ←───────────────────┘
                           └──────────────────┘   生成导出文件后经后台下载
```

## 模块职责

### extension/manifest.json

- MV3，权限最小化：`activeTab` + `scripting`（点击时注入）+ `downloads`（绕过页面 CSP）+ `storage`（v1.7 拆分规则与列筛选持久化；无安装警告）

- 无 `host_permissions`、无静态 `content_scripts`——SheetJS 约 950KB，不常驻所有页面

- 图标 16/32/48/128 四尺寸（品牌蓝底 + 白色表格）：`test/gen-icon.ps1` GDI+ 矢量绘制 512px 母版降采样生成，勿手改二进制

- 国际化（v2.6）：`default_locale: zh_CN`（默认简体中文，开发语言）；`name`/`description`/`action.default_title` 用 `__MSG_*` 占位符，Chrome 按浏览器 UI 语言从 `_locales/<lang>/messages.json` 取词。v2.6.1 界面语言可手动指定（工具栏「中文 | EN」，偏好存 `chrome.storage.local`），默认跟随浏览器；运行时取词经 i18n.js 优先手动偏好，见「_locales/ 与国际化约定」节

- `extension/` 为插件本体目录（chrome://extensions 加载）；`test/`、`docs/` 为开发材料，不随插件分发

### extension/background/service-worker.js

- `chrome.action.onClicked`：向当前 tab 注入 `lib/xlsx.full.min.js` 与 `content/` 下 13 个文件（同一 isolated world，main.js 直接用全局 `XLSX`；路径相对 extension/ 根）

- `chrome.runtime.onMessage`：
  - `type: 'html2xlsx-download'`——base64 数据（按 `msg.mime` 定 MIME，缺省 xlsx）经 `chrome.downloads.download` 落盘并回传结果
  - `type: 'h2x-i18n-catalog'`（v2.6.1）——读取扩展包 `_locales/<lang>/messages.json` 回传（内容脚本无法直接 fetch chrome-extension:// 资源，手动英文词表由后台代理；同源资源，无需 web_accessible_resources）

- 受限页面（chrome:// 等）注入失败静默处理

### extension/content/

零构建无 import/export，**注入顺序即依赖顺序**；每文件一个 IIFE 挂载到 `window.__h2x`。

注入守卫（entry.js）：`window.__html2xlsx` 已存在 → 标记 `__h2x.aborted` 并调上轮 `toggle()` 退出（再次点击图标 = 退出选择模式，本轮后续文件放弃初始化）；否则创建命名空间。

#### entry.js（依赖：—）

- 注入守卫 + `__h2x` 命名空间

#### i18n.js（依赖：—）

- 界面语言（v2.6.1）：手动中英文偏好与词表解析统一入口 `ns.i18n`（`t()` / `lang()` / `langOf()` / `setLang()` / `init()`）；各模块就地 `t()` 优先经它取词
- 手动英文词表经后台消息拉取（见 service-worker 节）
- Node/E2E 环境守卫降级，行为零回归

#### util.js（依赖：—）

- `timestamp()` / `sanitizeFilename()` / `escapeHtml()`

#### controls.js（依赖：—）

- `controlValue()` 三层判定 + `CONTROL_SEL`（详见 [controls.md](controls.md)）

#### split.js（依赖：—）

- 列拆分 / 列筛选 / 列顺序 / 列格式 / 列宽纯函数 18 个（v2.8 增 `reorderColumns()`）
- 零依赖（algo-check.cjs 整文件加载回归，不得引用其他模块）

#### cell.js（依赖：controls, split）

- `openBatch()` 批量两阶段四通道取值 + 归一化 + 图片链接替换

#### table.js（依赖：cell）

- `getRows()` / `extractTable()` / `makeSheetName()` / `splitGroupOf()` / `pairSplitGroup()`（分体识别 + 纯函数配对，模块级零 DOM 引用，algo-check.cjs 离线回归）
- 表头行判定 = thead/tfoot 行 + tbody 全 th 行（extractTable 取前导连续段）
- v2.1 新增 div 网格表格，v2.2 重构为适配器注册表（el-table-v2 / AG Grid / MUI X DataGrid / Tabulator）：
  - `isGridTable()` 根特征类分发
  - `gridRowsOf()` 取行 + `gridScrollEls()` 滚动容器
  - `gridRootOf()` / `GRID_ROOT_SELECTOR` 命中入口
  - `gridHeaderCellsOf()` 指纹表头分发
  - `rowsSortedByRowIndex()` 行序排序纯函数（aria-rowindex，复用行节点组件）

#### virtual.js（依赖：table）

- `isVirtualTable()` / `collectVirtual()` / `overlapLen()`
- v2.1：网格表格恒走滚动采集，固定列多分区（left/main/right）联动设置 scrollTop
- v2.9：窗口衔接改「元素身份优先、内容匹配兜底」——`refOverlapLen()`（窗口头部与上窗尾部的 DOM 行元素对齐数）+ `refTopsMatch()`（引用重叠的 k 行内容须与已累积尾部一致，否则视为误判、回落内容匹配）
- 「整窗同一批节点」不再直接短路为「零新增」，而是交给内容匹配（内容也相同 = 零新增，内容变了 = 按内容求重叠）

#### pagination.js（依赖：table, persist, virtual）

- 分页表格自动翻页采集（v2.5）：
  - `PAGER_ADAPTERS` 分页适配器注册表（el-pagination / ant-pagination，`detectPager()` 自表格根向上找分页器）
  - `manualPager()` 用户指定按钮定位器（`locatorOf` / `resolveLocator` 跨页重解析）
  - `collectPaged()` 采集引擎（逐页 extractTable + overlapLen 页级重叠合并，起点归一 / 指纹校验 / 三重停止）
  - `isPagingClick()` 编程式点击豁免
- v2.9：适配器增 `pageSel`（页码项选择器，末页号即总页数）与 `total(root)`（0 = 未知）；`collectPaged()` 结果增 `reason`（noNew / tableLost / headerChanged / stopped / maxPages / 空）与 `pages`；`manualPager()` 返回定位器 `loc`，新增 `pagerByLocator()`（解析不到返回 null 由主 UI 回落子模式）

#### persist.js（依赖：entry）

- 拆分规则 / 列筛选 / 列格式 / 列顺序持久化（v2.8 增列顺序与跨设备同步）：`tableKeyOf()` 表指纹 + `getSaved()` / `save()` 恢复与落盘 + `ready()` 就绪兜底
- 页面键 = origin+pathname，`chrome.storage.local` 为真相源（单页一条，LRU 上限 50 页）并镜像到 `chrome.storage.sync`（≤20 页、单项 ≤7KB，随 Chrome 账号跨设备）；注入时两侧按表取 `updatedAt` 更新者合并
- 纯函数可离线回归

#### format.js（依赖：util）

- 导出格式序列化纯函数：`toCsv()`（RFC4180+BOM）/ `toTsv()`（v2.7 剪贴板：制表符分隔、无 BOM）/ `toJson()`（行对象）/ `toMarkdown()`（GFM 表格）/ `toHtmlDocument()`（完整文档）
- algo-check.cjs 离线回归

#### panel.js（依赖：util, table, split, persist）

- 「列设置」面板（导出列筛选 + 拆分配置 + 列格式）
- 依赖经 `panel.init({ host, selected, snapshots, splitRules, colFilters, colFormats, colOrders, isBusy, isAlive, updateBar, toast })` 注入；面板样式自持，按钮样式共用主 UI 的 `<style>`；保存经 `ns.persist.save()` 落盘
- v2.0 重构：列行折叠式（拆分配置收进展开子行，模式/分隔符键入只局部刷新新列勾选区）、多表页签（带已配置状态点）、最终输出全列预览、校验错误就地标红 + 底部汇总、focus trap + `role="dialog"`
- v2.7：底部「恢复默认」显式重置入口（`resetDraft()` 只回默认草稿 + 清校验态，落盘仍走「保存」，空配置即删记忆）
- v2.8 列顺序：`entry.order`（显示序，列索引数组）驱动列区与预览渲染，手柄拖放（`onColDragStart` / `onColDragOver` / `onColDrop`，落点以内阴影标示）与手柄聚焦 Alt+↑/↓（`onColGripKey`）统一经 `applyMove()` 改序，`orderKeysOf()` 保存时把自然序折叠为 `[]`（不落记录，零回归），含 merges 表渲染占位手柄不参与拖拽
- v2.10.1 拆分控件状态化：草稿增 `open`（配置子行展开态，与「是否有拆分规则」`checked` 解耦；`open` 不落盘，仅当次会话视图态），子行渲染条件 `checked && open`，保存校验失败自动 `open=true` 展开出错列
- v2.10.2 主行拆分控件合并为单控件：`splitCtlHtml()` 输出勾选框 `h2x-ck-sp`（拆分开关，`onColChange`：勾选=拆分并展开、取消=删规则）+ 折线 chevron 图标按钮 `h2x-sfold`（内嵌 `<svg class="h2x-chev">` 两条边、非实心三角，朝向由 `aria-expanded` 经 CSS 旋转 180°；只控配置子行显隐，`onColClick` 处理，未拆分时 hidden），状态变化经 `syncSplitCtl(col, row, d)` 就地同步（不重建 DOM、键盘焦点保留）

#### main.js（依赖：其余全部）

- 主 UI / 事件 / 选中管理 / 导出 / 退出清理 / 启动装配
- v2.0：toast 反馈系统（结果性通知迁出 hint，成功/信息 2.5s 自动消失、错误常驻可关、同屏 3 条上限）、虚拟采集可中止（「停止采集」genToken 作废当前任务）、导出后保留选择（toast「退出」动作）、设计 token + 深色模式（prefers-color-scheme）+ 动效（prefers-reduced-motion）
- v2.1：`hitRoot()` 与表格存在性检查支持 div 网格表格
- v2.2：经 `gridRootOf()` / `GRID_ROOT_SELECTOR` 适配器分发，覆盖全部注册组件
- v2.4：选择模式点击放行（非表格点击不拦截 + `pruneDetached()` 剔除被页面交互替换的选中表格，链接拦截改 toast 提示）
- v2.5：「采集全部页」入口（取最后选中的表，识别不到分页器进入「指定翻页按钮」子模式）+ 分页采集选中迁移（表格被重建时换新根）+ 采集期点击豁免经 `isPagingClick()`
- v2.5.1：页数输入框与采集按钮合并为句子式复合组件「采集 N/全部 页」（整组点击采集、页数槽 Enter 同效，div 容器 + `aria-disabled`）
- v2.5.2：改下拉展开式——主按钮「采集全部页 ▾」+ 分页采集设置面板（页数上限输入槽留空=全部页、取消/开始采集按钮，点开聚焦输入槽、Esc/点外部/再点按钮收拢；采集中禁用主按钮并收拢）。启动调 `updateBar()` 统一初始按钮态——未选表时与「列设置」「导出」一致禁用（HTML `disabled` 仅装配前兜底，此后以 `updateBar()` 为单一来源）
- v2.5.3：分页采集限定单表——`updateBar()` 中多选（≥2）即禁用主按钮并切换 `title` 提示「多表选择时不支持分页采集」，`onCollectAllPages()` 恒取唯一选中表
- v2.6.1：工具栏「中文 | EN」语言分段开关——忙态（采集/导出/面板/子模式）禁用，`pickLang()` 切换后 `refreshTexts()` 就地重取词 + `syncLangUI()` 高亮，启动经 `ns.i18n.init()` 恢复存储偏好；工具栏宽度自适应（`width:max-content`：单行恰包内容、仅超 96vw 上限才折行，折行各行两端贴边）
- v2.7：`CLIPBOARD` 输出方式注册表（`copy-tsv` / `copy-md`，与 `FORMATS` 同列于下拉），`doExport()` 取数后按模式分流——剪贴板经 `writeClipboard()`（Clipboard API 优先、execCommand 兜底）写文本并 toast 行数，不落盘；已选计数旁 `clearSelection()` 一键清空
- v2.8：`exportToken` 导出代际令牌 + `abortExport()`（导出中「取消」变「停止导出」；`doExport()` 各 yield 检查点比对令牌，`finally` 按 `aborted && active` 提示已下载文件数，剪贴板成功路径以 `copied` 排除双 toast）；`colOrders` Map 经 `buildAoa()` 最后一环 `reorderColumns()` 生效；剪贴板与下载成功 toast 均带「退出」动作
- v2.9：界面偏好与翻页按钮记忆——`loadPrefs()` / `savePrefs()`（存储键 `h2x.prefs` 存输出方式 + 文件名模板，`renderNameTpl()` 单遍渲染 `{title}` / `{date}` / `{time}`，`fmtTouched` / `nameDirty` 防异步回填覆盖用户操作，文件名 blur 时记住、清空即回落默认模板）、分页进度带总页数（collectPaged 第三参，0 = 未知则退回「第 i 页」）、`getPagerMem()` / `savePagerMem()` / `loadPagerMem()`（存储键 `h2x.pager.v1`，键 = 页面键 + 表指纹，值 = 定位器，LRU 30 条；命中即直接采集并 toast 复用，复用后 reason 为 noNew/tableLost 即清除记忆并提示重新指定）
- v2.10：输出方式下拉与导出按钮合并为分体按钮（主按钮 `.h2x-exp` 导出当前格式，右侧 `.h2x-expdrop` 内为透明原生 select `.h2x-ext` 覆盖箭头，保留原生下拉与键盘交互、E2E 桩零改动），二者启用/禁用同源（`updateBar()` 中 `expOff = busy || selected.size === 0` 同时作用于按钮、select 与下拉区灰显 class），进行时经 `lockExpDrop()` 就地灰置、结束后统一恢复
- v2.11：输出方式下拉改自绘菜单（原生 select 弹层内容贴边且无法定制）——`.h2x-expwrap` 内 `.h2x-expdrop` 由 span 改箭头 `<button>`，新增 `.h2x-expmenu`（`role="listbox"`，项 `.h2x-expopt[data-k]`），`openExpMenu()` / `closeExpMenu()` / `toggleExpMenu()` / `pickFmt()` / `syncExpMenu()` / `onExpMenuKey()`（↑/↓ 首尾循环）；菜单点选与原生 select 的 change 共用 `applyFmt()`（`fmtTouched` + `syncExportBtn` + `savePrefs`）；原生 select `.h2x-ext` 保留于 DOM 但 `hidden`（仅作格式状态与词条来源，`fmtSel.value` + change 的 E2E 契约不变）；禁用改经 `expDrop.disabled`（样式走 `:disabled`）；收拢路径：点项、点工具栏其他处、点页面处（`onClickCapture`）、Esc（优先于分页面板，收拢后回焦箭头）、焦点移出（`focusout`）、菜单失效时

### extension/_locales/ 与国际化约定（v2.6 起，v2.6.1 增手动开关）

- 语言包：`en/messages.json`（内容脚本运行时词条全量）、`zh_CN/messages.json`（manifest 三词条；运行时词条缺省，靠代码内中文回落，zh 界面取词失败即回落原文、零差异）。新增语言只加目录 + 补词条

- `t(key, fb, ...subs)` 各内容脚本**就地定义**（同构拷贝；v2.6.1 起先经 `ns.i18n.t()`——i18n.js 的手动语言统一入口，未注入/不可用（algo-check.cjs 伪 window、E2E 桩）时回落内置 `chrome.i18n` 分支，Node 回归与既有 E2E 断言零改动）：词条缺失或无环境回落 `fb` 中文。静态 HTML 文案在 `root.innerHTML` 数组项内拼 `t()`；进行时文案（hint/按钮/title）动态取词，语言切换后天然生效，仅工具栏 buildUI 一次成型静态项需 `refreshTexts()` 重取词

- 语言解析三层（i18n.js `t()`）：① 手动 zh → 回落代码内中文（zh 无独立词表）② 手动 en → 按 en 词表取词——词表经后台消息 `h2x-i18n-catalog` 拉取 `_locales/en/messages.json`（词表就绪前生效语言不变）③ auto（默认；`chrome.storage.local` 偏好键 `h2x.uiLang` 缺省/删除即 auto）→ `chrome.i18n.getMessage` 按浏览器 UI 语言，v2.6 语义零回归。占位符替换按 placeholders.content 的 `$1/$2` 序号（与 chrome.i18n 一致），非声明顺序

- 切换控件在工具栏最右（「中文 | EN」分段按钮，main.js `pickLang()`）：按钮文案即语言自称（双语恒定、不随界面语言取词），`aria-pressed` 标注生效语言（`syncLangUI()`）；点未激活语言 = 切换并持久化，再点当前**手动**语言 = 回到跟随浏览器（auto），auto 模式点当前语言无操作。忙态禁用开关——`refreshTexts()` 只在空闲态重取词（`updateBar()` 单一状态源同步禁用态）

- 算法层文案一并取词（导出文件内容）：控件值「是/否」、列名兜底「列N」、Sheet 名兜底「表格N」、control 拆分后缀「\_控件/\_文本」、无表头 JSON/MD 列名「列N」、HTML 默认标题「导出表格」、分页采集附注等——手动切换后导出内容同步换语言。持久化列键/表指纹取**页面表头原文**，不受 UI 语言影响；`t` 与既有局部变量（如 table.js `headerRowCount(t)` 形参、main.js `hitRoot` 的 `const t`）遮蔽无害——同名局部函数不调用取词

- 漏翻防护：algo-check.cjs 断言「内容脚本与 manifest 引用的全部词条 ⊆ en 语言包」「manifest 词条 ⊆ zh_CN」「占位符词条消息含对应 `$XXX$`」——新增硬编码中文 UI 文案会被测试暴露

## 相关文档

- 运行时机制与开发侧限制：[mechanisms.md](mechanisms.md)
- 设计决策（为什么这样设计）：[decisions.md](decisions.md)
- 产品行为与交互：[product.md](product.md) ｜ 控件取值规则：[controls.md](controls.md)
