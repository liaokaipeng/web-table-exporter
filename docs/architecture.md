# 架构文档

## 总体结构

```
┌─────────────┐  点击图标   ┌──────────────────┐  按需注入   ┌─────────────────┐
│ 扩展图标     │ ─────────→ │ service-worker.js │ ─────────→ │ 页面 isolated    │
│ (action)    │            │ (background)      │            │ world           │
└─────────────┘            └────────┬─────────┘            │ ├ xlsx.full.min  │
                                    │ sendMessage          │ └ content.js     │
                                    ↓ (base64)             └────────┬────────┘
                           ┌──────────────────┐                     │
                           │ chrome.downloads │ ←───────────────────┘
                           └──────────────────┘   生成 xlsx 后经后台下载
```

## 模块职责

### manifest.json

- MV3，权限最小化：`activeTab` + `scripting`（点击时注入）+ `downloads`（绕过页面 CSP）
- 无 `host_permissions`、无静态 `content_scripts`——SheetJS 约 950KB，不常驻所有页面

### background/service-worker.js

- 监听 `chrome.action.onClicked`：向当前 tab 按序注入 `lib/xlsx.full.min.js`、`content/content.js`（同一 isolated world，content.js 可直接使用全局 `XLSX`）
- 监听 `chrome.runtime.onMessage`（`type: 'html2xlsx-download'`）：接收 base64 数据，经 `chrome.downloads.download` 落盘，回传结果
- 受限页面（chrome:// 等）注入失败时静默处理

### content/content.js（IIFE，核心）

注入守卫：`window.__html2xlsx` 存在则调用 `toggle()` 退出（再次点击图标 = 退出选择模式），否则初始化。

| 模块 | 职责 |
|---|---|
| UI | 单个 Shadow DOM host（`all:initial` 隔离页面样式），含悬浮高亮层、已选覆盖层（Shadow 内动态增删）、底部工具栏 |
| 事件 | `mouseover`（委托找 table）、`click`（捕获阶段拦截页面跳转，工具栏自身放行）、`keydown`（Esc 退出 / Enter 导出）、`scroll`/`resize`（rAF 节流重定位） |
| 提取 | `getRows()`：兼容 thead 直接嵌 th（无 tr）；过滤 virtual-spacer 占位行、`display:none` 隐藏行 |
| 单元格 | `cellText()`：视觉上分离的文本块（换行/连续空格/nbsp）统一压缩为单个空格，本来连在一起的文本保持相连。含 input/textarea/select 时克隆单元格、**从原元素读取实时值**（cloneNode 只复制特性，Vue 属性设值会丢）替换控件后离屏渲染取文本。离屏容器**不能加 `visibility:hidden`**（innerText 按规范排除不可见文本） |
| 合并单元格 | `extractTable()`：rowspan/colspan 展开成网格 + 生成 SheetJS `!merges` |
| 虚拟滚动 | `isVirtualTable()` 识别（占位行类名/带高度空 tr）→ `collectVirtual()`：回顶 → 按视口 80% 步长下滚 → 每窗口提取可见行按内容签名去重（表头天然只留一份）→ 还原滚动位置。采集期间锁交互（`collecting`），`genToken` 代际令牌防退出后回调写入 |
| 导出 | 多表 → 多 Sheet（caption/aria-label/id 命名，31 字符截断去重）→ `XLSX.write` ArrayBuffer → base64 → 优先 `chrome.runtime.sendMessage` 走后台下载；失败回退页面内 `blob:` 链接下载 |

## 关键设计决策

| 决策 | 理由 |
|---|---|
| 按需注入而非静态 content_scripts | SheetJS 体积大，避免所有页面常驻开销；activeTab 权限利于商店审核 |
| 下载走后台 chrome.downloads | 页面 CSP（如 ERP 后台）会拦截 blob: 下载且静默失败；扩展 downloads API 不受页面策略限制。失败时仍回退 blob |
| UI 全部 Shadow DOM + 内联样式 | 不注入 CSS 文件，`all:initial` 阻断页面样式污染 |
| 虚拟表格内容签名去重 | 滚动时 DOM 行被销毁重建，无法靠元素身份判断重复；步长 80% 视口保证不跳行但有重叠，需去重。代价：全列完全相同的合法重复行会被合并 |
| genToken 代际令牌 | 异步采集过程中用户可能退出/重选，令牌使旧任务的回调失效 |
| 下载文件名 sanitize | 过滤 `\/:*?"<>|`、去首部点号（chrome.downloads 限制）、补 .xlsx 后缀 |

## 已知限制

- 仅顶层文档表格，iframe 内表格不处理（点三咪页面有 1 个 iframe，目标表格在主文档）
- 单元格导出纯文本，不保留颜色/字体样式；图片列导出为空
- 无设置持久化（每次进入选择模式重填默认文件名）
- 合法全同重复行在虚拟表格采集中会被去重合并
