# AGENTS.md — AI 协作须知

Chrome MV3 扩展（原生 JS，零构建）。架构与产品信息见 [docs/architecture.md](docs/architecture.md)、[docs/product.md](docs/product.md)，不在此重复。

## 硬性约定

- 不引入构建步骤、框架、npm 依赖；SheetJS 已本地内置（`lib/xlsx.full.min.js`），直接引用
- 权限最小化：改动 `manifest.json` 权限需有明确理由
- 注释与文档用中文；提交信息格式：一行标题 + 要点列表

## 验证命令（本机为 PowerShell）

```powershell
node --check content/content.js
node --check background/service-worker.js
node test/algo-check.cjs
```

注意：PowerShell 不支持 `&&` 和 heredoc；多行提交信息用 `git commit -F <文件>`。

改代码后的浏览器验证：`chrome://extensions` 刷新扩展 → 刷新目标页 → 用 `test/virtual-fixture.html`（虚拟滚动+表单控件列）和 `test/fixture.html`（合并单元格+控件取值，第 4 节行内标注预期值）回归。控件取值规则见 [docs/controls.md](docs/controls.md)。

## 坑（已踩过，勿再踩）

- 单元格取文本：离屏容器不能加 `visibility:hidden`（innerText 会排除不可见文本）；input 值必须从原元素读（cloneNode 丢属性设值）。详见 architecture.md 设计决策表
- `test/dianxiaomi-table.html` 含真实业务数据，已在 .gitignore，勿提交勿删除该忽略规则
