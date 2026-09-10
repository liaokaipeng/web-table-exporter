# Chrome Web Store 商店信息（双语）

提交时在开发者控制台「商品详情」页填写。中文填「默认语言」，英文在「添加语言 → English」中填写。

***

## 中文

**扩展名称**（≤45 字符）

```
Web Table Exporter：导出表格
```

**简短说明**（≤132 字符）

```
网页表格导出，免费开源、不收集任何数据。支持虚拟滚动与分页表格自动全量采集，兼容主流组件表格，支持列拆分/筛选等，格式规则按页面自动记忆。
```

**详细说明**

```
把网页表格一键导出为 Excel、CSV 等文件，无需复制粘贴。完全免费、代码开源，不收集任何数据。

虚拟滚动、分页加载的长表格自动全量采集；主流前端组件库的表格开箱即识别；独特的「列设置」让导出结果开箱即用，规则按页面自动记忆。

【使用方式】
1. 点击浏览器工具栏的扩展图标，进入选择模式
2. 鼠标悬停高亮表格，点击选中（可多选多个表格）
3. 点击「导出」，文件自动下载（也可选「复制为表格 / 复制为 Markdown」直接进剪贴板）

【列设置 · 按页面记忆】
· 拆分：按分隔符、按换行、按控件值把一列拆成多列（如「2249 PHP」拆为价格与币种两列）
· 筛选：勾选需要的列导出，不必导出后再删
· 排序：拖动列前手柄调整导出列的顺序（拆分出的新列跟随原列）
· 格式：指定数字列，导出为数值而非文本，Excel 可直接求和
· 记忆：规则仅存本机，按「页面 + 表头」定位，下次打开同页面自动恢复；面板「恢复默认」可一键重置并清除本页记忆

【支持格式】
xlsx（多表多 Sheet）、csv、json、md、html，工具栏下拉切换；另支持复制到剪贴板（表格 TSV / Markdown），不落盘，可直接粘贴进 Excel、飞书或笔记

【核心能力】
· 虚拟滚动全量采集：只渲染可见行的长表格，自动滚动采集全部数据并去重
· 分页表格全量采集：分页加载的表格自动逐页翻页采集全部数据，可设页数上限
· 组件表格适配：主流前端组件库的表格开箱即识别，无需配置
· 分体表格合并：表头与表体分离渲染的组件表格自动识别为一张逻辑表
· 表单控件取值：单元格内的输入框、下拉框、开关等按当前值导出
· 图片链接导出：单元格内的图片以链接导出，Excel 中可直接打开
· 复制到剪贴板：不想落盘时可直接复制为表格（TSV）或 Markdown，粘贴进表格软件与文档

【隐私与数据安全】
· 不收集任何数据，无任何网络请求，表格数据始终在本机处理，不出浏览器
· 列设置默认仅存本机；登录 Chrome 账号时随浏览器账号在您自己的设备间同步（由浏览器提供，不经过任何第三方服务器）
· 完全免费、代码开源，可自行审计：https://github.com/liaokaipeng/web-table-exporter

【适用场景】
后台管理系统数据导出、电商订单表格整理、报表搬运、数据核对。
```

**分类**：生产力工具（Productivity）

**网站**：<https://github.com/liaokaipeng/web-table-exporter>

***

## English

**Extension name** (≤45 chars)

```
Web Table Exporter
```

**Short description** (≤132 chars)

```
Export web tables. Free & open source, no data collected. Virtual-scrolling grids collected in full, component tables supported.
```

**Detailed description**

```
Turn web page tables into Excel, CSV and more with one click — no more copy-paste. Completely free, open source, and collects no data.

Virtual-scrolling and paginated tables are collected in full automatically; tables rendered by mainstream component libraries are recognized out of the box; unique column settings shape each export exactly the way you need, with rules remembered per page.

HOW TO USE
1. Click the extension icon to enter selection mode
2. Hover to highlight tables, click to select (multiple tables supported)
3. Click "Export" and the file downloads automatically (or pick "Copy as table / Copy as Markdown" to put it straight on the clipboard)

COLUMN SETTINGS · REMEMBERED PER PAGE
· Split: break a column into several by delimiter, line break, or control values (e.g. "2249 PHP" becomes price and currency columns)
· Filter: export only the columns you need
· Reorder: drag the handle in front of a column to change the export order (split columns follow their source column)
· Format: mark numeric columns so they export as real numbers you can sum in Excel
· Memory: rules are stored locally, keyed by page + header, and restored automatically next time; the "Reset" button clears the memory for the current table

EXPORT FORMATS
xlsx (one sheet per table), csv, json, md, html — switch via the toolbar dropdown. You can also copy to the clipboard (table TSV / Markdown) without saving a file, ready to paste into Excel, Sheets or your notes.

KEY FEATURES
· Full capture of virtual-scrolling tables: grids that only render visible rows are auto-scrolled to collect every row with deduplication
· Full capture of paginated tables: paginated tables are auto-paged through to collect every row, with an optional page limit
· Component support: tables rendered by mainstream component libraries are recognized out of the box
· Split-header tables: components rendering header and body as separate tables are merged into one logical table
· Form control values: inputs, selects and switches inside cells are exported with their current values
· Image links: images inside cells are exported as links you can open directly in Excel
· Copy to clipboard: copy as a table (TSV) or as Markdown and paste into any spreadsheet, doc or note

PRIVACY & DATA SAFETY
· No data collected, no network requests at all — table data is processed entirely on your device and never leaves your browser
· Column settings are stored locally by default; when you are signed in to Chrome they sync across your own devices through your browser account (handled by the browser, never by a third-party server)
· Free and open source — audit the code yourself: https://github.com/liaokaipeng/web-table-exporter

USE CASES
Exporting admin dashboard data, organizing e-commerce order tables, moving reports, cross-checking data.
```

**Category**: Productivity
