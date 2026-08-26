# AGENTS.md — AI 协作须知

Chrome MV3 扩展（原生 JS，零构建）。架构与产品信息见 [docs/architecture.md](docs/architecture.md)、[docs/product.md](docs/product.md)，不在此重复。

目录约定：`extension/` 是插件本体（chrome://extensions 加载该目录）；`test/`、`docs/` 为开发材料，不随插件分发。

## 硬性约定

- 不引入构建步骤、框架、npm 依赖；SheetJS 已本地内置（`extension/lib/xlsx.full.min.js`），直接引用
- 权限最小化：改动 `extension/manifest.json` 权限需有明确理由
- 注释与文档用中文；提交信息格式：一行标题 + 要点列表

## 验证命令（本机为 PowerShell）

```powershell
# 内容脚本语法检查（9 个文件，依赖序注入，见 docs/architecture.md）
Get-ChildItem extension/content/*.js | ForEach-Object { node --check $_.FullName }
node --check extension/background/service-worker.js
node test/algo-check.cjs
```

注意：PowerShell 不支持 `&&` 和 heredoc；多行提交信息用 `git commit -F <文件>`。

改代码后的浏览器回归：`chrome://extensions` 刷新扩展 → 刷新目标页 → 按 [test/README.md](test/README.md) 用两个 fixture 页对照页内预期值验证。控件取值规则见 [docs/controls.md](docs/controls.md)。

## 坑（已踩过，勿再踩）

- 单元格取文本：离屏容器不能加 `visibility:hidden`（innerText 会排除不可见文本）；input 值必须从原元素读（cloneNode 丢属性设值）。详见 architecture.md 设计决策表
- `test/dianxiaomi-table.html` 含真实业务数据，已在 .gitignore，勿提交勿删除该忽略规则
