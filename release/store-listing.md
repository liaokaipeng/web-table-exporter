# Chrome Web Store 商店信息（双语）

提交时在开发者控制台「商品详情」页填写。中文填「默认语言」，英文在「添加语言 → English」中填写。

---

## 中文

**扩展名称**（≤45 字符）

```
Web Table Exporter - 网页表格导出
```

**简短说明**（≤132 字符）

```
选择网页表格，一键导出 xlsx/csv/json/md/html。支持虚拟滚动全量采集与 Element Plus、AG Grid 等组件表格，列规则自动记忆。
```

**详细说明**

```
Web Table Exporter 帮助你把网页上的表格一键导出为 Excel 等文件，无需复制粘贴。

【使用方式】
1. 点击浏览器工具栏的扩展图标，进入选择模式
2. 鼠标悬停高亮表格，点击选中（可多选多个表格）
3. 点击「导出」，文件自动下载

【支持格式】
xlsx（多表多 Sheet）、csv、json、md、html，工具栏下拉切换

【核心能力】
· 虚拟滚动全量采集：vxe-table、el-table-v2、AG Grid 等只渲染可见行的表格，自动滚动采集全部数据并去重
· 主流组件适配：Element Plus、AG Grid、MUI X DataGrid、Tabulator、Ant Design Vue 等
· 表单控件取值：单元格内的输入框、下拉框、开关等按当前值导出
· 合并单元格：rowspan/colspan 原样保留
· 分体表格合并：表头与表体分离渲染的组件表格自动识别为一张逻辑表

【列设置】
· 拆分：按分隔符、按换行、按控件值把一列拆成多列
· 筛选：勾选需要的列导出
· 格式：指定数字列，导出为数值而非文本
· 规则按页面自动记忆，下次打开同页面自动恢复

【隐私】
不收集任何数据。列设置仅保存在本机浏览器存储中，不上传。

【适用场景】
后台管理系统数据导出、电商订单表格整理、报表搬运、数据核对。
```

**分类**：生产力工具（Productivity）

**网站**（可选）：可填项目仓库地址，无则留空

---

## English

**Extension name** (≤45 chars)

```
Web Table Exporter
```

**Short description** (≤132 chars)

```
Select web tables and export them to xlsx/csv/json/md/html in one click. Supports virtual-scrolling grids and column rules memory.
```

**Detailed description**

```
Web Table Exporter turns web page tables into Excel and other files with one click — no more copy-paste.

HOW TO USE
1. Click the extension icon to enter selection mode
2. Hover to highlight tables, click to select (multiple tables supported)
3. Click "Export" and the file downloads automatically

EXPORT FORMATS
xlsx (one sheet per table), csv, json, md, html — switch via the toolbar dropdown

KEY FEATURES
· Full collection of virtual-scrolling tables: grids that only render visible rows (vxe-table, el-table-v2, AG Grid, etc.) are auto-scrolled to collect every row with deduplication
· Component support: Element Plus, AG Grid, MUI X DataGrid, Tabulator, Ant Design Vue and more
· Form control values: inputs, selects and switches inside cells are exported with their current values
· Merged cells: rowspan/colspan preserved exactly
· Split-header tables: components rendering header and body as separate tables are merged into one logical table

COLUMN SETTINGS
· Split: split a column into several by delimiter, line break, or control values
· Filter: export only the columns you need
· Format: mark numeric columns so they export as numbers, not text
· Rules are remembered per page and restored automatically next time

PRIVACY
No data is collected. Column settings are stored only in your local browser storage and never uploaded.

USE CASES
Exporting admin dashboard data, organizing e-commerce order tables, moving reports, cross-checking data.
```

**Category**: Productivity
