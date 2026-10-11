# AGENTS.md — AI 协作须知

Chrome MV3 扩展（原生 JS，零构建）。架构、机制与产品信息见 [docs/architecture.md](docs/architecture.md)、[docs/mechanisms.md](docs/mechanisms.md)、[docs/product.md](docs/product.md)，设计取舍见 [docs/decisions.md](docs/decisions.md)，不在此重复。

目录约定：`extension/` 是插件本体（chrome://extensions 加载该目录）；`test/`、`docs/` 为开发材料，不随插件分发。

## 硬性约定

- 不引入构建步骤、框架、npm 依赖；SheetJS 已本地内置（`extension/lib/xlsx.full.min.js`），直接引用
- 权限最小化：改动 `extension/manifest.json` 权限需有明确理由
- 注释与文档用中文；提交信息格式：一行标题 + 要点列表
- 每次 git 提交须同步更新相关文档（架构/产品/控件/测试等 docs 与 test/README），保持文档与代码一致
- 商店文案不堆砌关键词：同一卖点/格式清单在详细说明里只写一次、不在开头提前罗列、中英必须同步（Chrome Web Store「产品说明中有过多关键字」违规，参考 ID Yellow Argon）；规则细节与提交前自检见 [release/review-notes.md](release/review-notes.md)

## 验证命令（本机为 PowerShell）

```powershell
# 内容脚本语法检查（13 个文件，依赖序注入见 docs/architecture.md）
Get-ChildItem extension/content/*.js | ForEach-Object { node --check $_.FullName }
# 纯函数算法回归（采集/拆分/筛选/格式/分页/持久化）
node test/algo-check.cjs
# 一键回归（语法 + 算法 + 9 页 E2E 并行，约 5 秒）
.\test\run-all.ps1
```

详细命令（后台 service-worker 语法检查、auto-check 自动回归、交互模式、图标生成等）与覆盖矩阵以 [test/README.md](test/README.md) 为唯一源。

注意：PowerShell 不支持 `&&` 和 heredoc；多行提交信息用 `git commit -F <文件>`。

改代码后的浏览器回归：`chrome://extensions` 刷新扩展 → 刷新目标页 → 按 [test/README.md](test/README.md) 回归。现行规模：9 个 fixture + auto-check + 9 个 E2E harness + algo-check，一键跑 `.\test\run-all.ps1`（细则见 test/README.md）。控件取值规则见 [docs/controls.md](docs/controls.md)。

测试范围：简单功能或小改动不必补自动化测试，至少完成上述语法检查；涉及取值、解析等核心逻辑的改动须跑 `node test/algo-check.cjs` 并做浏览器回归。

小功能从简路径（默认生效，省轮次；拿不准是否算小功能 → 按完整路径）：
- 判定（须全部满足）：改动 ≤3 个文件；不碰取值/解析/采集/导出算法（split/cell/table/virtual/pagination/format）与持久化结构；不动 manifest 权限
- 执行：语法检查 + 浏览器手工回归（只验本功能相关场景，对应 test/README 的回归步骤）；新增了 t() 界面文案的，顺带跑 `node test/algo-check.cjs`（数秒，i18n 词条齐备断言兜底漏翻）
- 不补 E2E 轮次、不加 algo-check 用例（新增纯函数除外）
- 文档最小面：manifest 版本升一位 + architecture/product 各补一句版本行；test/README 覆盖矩阵与计数、decisions 可不写（行为取舍值得记时破例）
- 完整路径（碰核心算法或存储结构、新增内容脚本模块、新增可断言的交互契约）：algo-check + 相关 E2E 轮次 + 文档全量同步（含 test/README 计数修正）

## 远程 GitHub 操作

推送、打 Tag、GitHub Release 代发等全部远程操作（含凭据获取与 API 坑）集中在 [docs/github-remote.md](docs/github-remote.md)，不在此重复。

## 坑（已踩过，勿再踩）

- 单元格取文本：离屏容器不能加 `visibility:hidden`（innerText 会排除不可见文本）；input 值必须从原元素读（cloneNode 丢属性设值）。详见 [docs/mechanisms.md](docs/mechanisms.md)「单元格四通道」条
- `test/dianxiaomi-table.html` 含真实业务数据，已在 .gitignore，勿提交勿删除该忽略规则
