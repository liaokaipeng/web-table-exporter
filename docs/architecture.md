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
- v2.15 窗口拖动：`clampPos()` 视口钳制纯函数（algo-check 离线回归）+ `draggable(el, {handle, ignore})` 指针事件拖拽助手（单击阈值、实化定位、视口钳制、resize 重钳制、dispose 摘监听）——主工具栏与列设置面板共用

#### controls.js（依赖：—）

- `controlValue()` 三层判定 + `CONTROL_SEL`（详见 [controls.md](controls.md)）

#### split.js（依赖：—）

- 列拆分 / 列筛选 / 列顺序 / 列格式 / 列宽纯函数 20 个（v2.8 增 `reorderColumns()`；`keepColIdx()` 为 filterColumns / reorderColumns / formatColumns 三处共用的保留列判定，无排除/全排除/不存在的 key 均返回 null 由调用方原样短路；`maxColsOf()` 为本模块 colKeys/applyColumnSplits 与 format.headerKeys/panel.buildPanelCols 共用的列数基准）
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

- 虚拟滚动采集：`isVirtualTable()` 识别 → `collectVirtual()` 回顶、按视口 80% 步长下滚、逐窗提取并经 `overlapLen()` 重叠合并衔接（v2.9 起「元素身份优先、内容匹配兜底」：`refOverlapLen()` / `refTopsMatch()`）
- v2.1：网格表格恒走滚动采集，固定列多分区（left/main/right）联动设置 scrollTop
- 机制与参数（识别规则、窗口衔接、停止与快照结构）见 [mechanisms.md](mechanisms.md)「虚拟滚动」

#### pagination.js（依赖：table, persist, virtual）

- 分页表格自动翻页采集（v2.5）：`PAGER_ADAPTERS` 适配器注册表 + `manualPager()` 手动指定两层定位；`collectPaged()` 采集引擎（逐页 extractTable + overlapLen 页级重叠合并、起点归一、指纹校验、多重停止兜底、页间停顿）；`isPagingClick()` 编程式点击豁免
- 机制与参数（翻页等待预算、停止条件、起点归一阈值、页间停顿）见 [mechanisms.md](mechanisms.md)「分页翻页采集」；用户向行为（采集组件、进度提示、提醒框）见 [product.md](product.md)「分页表格」

#### persist.js（依赖：entry）

- 列设置持久化（拆分规则 / 列筛选 / 列格式 / 列顺序，v2.8 增后两者）：`pageKeyOf()` 页面键 + `tableKeyOf()` 表指纹定位，`getSaved()` / `save()` 恢复与落盘、`ready()` 就绪兜底；`chrome.storage.local` 为真相源并镜像 `chrome.storage.sync` 跨设备同步（v2.8），注入时按更新时间取更新者合并
- 另管界面偏好（`h2x.prefs`：输出方式 + 文件名模板）与手动翻页按钮记忆（`h2x.pager.v1`，LRU 30 条）的存储面——集中理由见 [decisions.md](decisions.md)「存储面集中 persist，UI 面留 main」，main.js 只留模板渲染、「已动过控件」会话守卫与 DOM 应用
- 机制与参数（定位键构成、指纹算法、LRU 淘汰、sync 镜像与合并规则）见 [mechanisms.md](mechanisms.md)「持久化」；纯函数可离线回归（algo-check.cjs）

#### format.js（依赖：util, split）

- 导出格式序列化纯函数：`toCsv()`（RFC4180+BOM）/ `toTsv()`（v2.7 剪贴板：制表符分隔、无 BOM）/ `toJson()`（行对象）/ `toMarkdown()`（GFM 表格）/ `toHtmlDocument()`（完整文档）
- algo-check.cjs 离线回归

#### panel.js（依赖：util, table, split, persist）

- 「列设置」面板：导出列筛选 + 拆分配置 + 列格式 + 列顺序（v2.8），保存经 `ns.persist.save()` 落盘；依赖经 `panel.init({ host, selected, snapshots, splitRules, colFilters, colFormats, colOrders, hasColCfg, isBusy, updateBar, toast })` 注入（`isBusy` 与主工具栏 `updateBar()` 的 busy 同源：采集中/导出中/子模式中）；面板样式自持，按钮样式共用主 UI 的 `<style>`
- 交互行为（页签、全列预览、校验、拆分控件、列序手柄、恢复默认、可拖动）见 [product.md](product.md)「列设置面板」；拆分/筛选/列顺序/列格式机制见 [mechanisms.md](mechanisms.md)「列拆分 / 导出列筛选 / 列格式」

#### main.js（依赖：其余全部）

- 主 UI / 事件 / 选中管理 / 导出 / 分页采集入口 / 退出清理 / 启动装配：`buildUI()` 组装 Shadow DOM 单 host（高亮层、已选覆盖层、底部工具栏、toast 容器），`hitRoot()` 解析表格逻辑根，按钮态经 `updateBar()` 单一状态源驱动（未选 / 忙态禁用）
- 导出编排：`doExport()` 走统一管线（取值 → `buildAoa()` → 生成文件 → 后台下载，v2.7 起剪贴板分流、v2.8 起可中止）；虚拟 / 分页采集入口与进度提示
- 机制细节（事件放行规则、采集与导出中止、翻页等待、语言切换重取词）见 [mechanisms.md](mechanisms.md)；用户向行为（工具栏各控件、toast/hint 文案）见 [product.md](product.md)「选择模式 / 分页表格 / 导出结果 / 状态反馈」

### extension/_locales/ 与国际化约定（v2.6 起，v2.6.1 增手动开关）

- 语言包：`en/messages.json`（内容脚本运行时词条全量）、`zh_CN/messages.json`（manifest 三词条；运行时词条缺省，靠代码内中文回落，zh 界面取词失败即回落原文、零差异）。新增语言只加目录 + 补词条

- `t(key, fb, ...subs)` 各内容脚本**就地定义**（同构拷贝；v2.6.1 起先经 `ns.i18n.t()`——i18n.js 的手动语言统一入口，未注入/不可用（algo-check.cjs 伪 window、E2E 桩）时回落内置 `chrome.i18n` 分支，Node 回归与既有 E2E 断言零改动）：词条缺失或无环境回落 `fb` 中文；buildUI 的 `root.innerHTML` 骨架**不拼** `t()`——只放结构与数据驱动内容（格式选项列表），静态文案经 `fillStaticTexts()` 统一填充（启动与语言切换 `refreshTexts()` 共用同一入口，同一批文案只定义一处），理由见 [decisions.md](decisions.md)「工具栏静态文案单一入口 fillStaticTexts」；内容脚本局部变量一律不用裸 `t` 命名，与取词函数彻底隔离

- 语言解析三层（i18n.js `t()`）：① 手动 zh → 回落代码内中文（zh 无独立词表）② 手动 en → 按 en 词表取词——词表经后台消息 `h2x-i18n-catalog` 拉取 `_locales/en/messages.json`（词表就绪前生效语言不变；拉取失败时复位加载 Promise，后续切换/init 可重试，不判整会话死刑）③ auto（默认；`chrome.storage.local` 偏好键 `h2x.uiLang` 缺省/删除即 auto）→ `chrome.i18n.getMessage` 按浏览器 UI 语言，v2.6 语义零回归。占位符替换按 placeholders.content 的 `$1/$2` 序号（与 chrome.i18n 一致），非声明顺序

- 切换控件在工具栏最右（「中文 | EN」分段按钮，main.js `pickLang()`）：按钮文案即语言自称（双语恒定、不随界面语言取词），`aria-pressed` 标注生效语言（`syncLangUI()`）；点未激活语言 = 切换并持久化，再点当前**手动**语言 = 回到跟随浏览器（auto），auto 模式点当前语言无操作。忙态禁用开关——`refreshTexts()` 只在空闲态重取词（`updateBar()` 单一状态源同步禁用态）。用户向行为见 [product.md](product.md)「选择模式」

- 算法层文案一并取词（导出文件内容）：控件值「是/否」、列名兜底「列N」、Sheet 名兜底「表格N」、control 拆分后缀「\_控件/\_文本」、无表头 JSON/MD 列名「列N」、HTML 默认标题「导出表格」、分页采集附注等——手动切换后导出内容同步换语言。持久化列键/表指纹取**页面表头原文**，不受 UI 语言影响

- 漏翻防护：algo-check.cjs 断言「内容脚本与 manifest 引用的全部词条 ⊆ en 语言包」「manifest 词条 ⊆ zh_CN」「占位符词条消息含对应 `$XXX$`」——新增硬编码中文 UI 文案会被测试暴露（明细见 [test/README.md](../test/README.md)「国际化词条一致性」）

## 相关文档

- 运行时机制与开发侧限制：[mechanisms.md](mechanisms.md)
- 设计决策（为什么这样设计）：[decisions.md](decisions.md)
- 产品行为与交互：[product.md](product.md) ｜ 控件取值规则：[controls.md](controls.md)
