# GitHub 远程操作（推送 / Tag / Release）

Chrome Web Store 扩展仓库的远程 GitHub 操作统一收于此文档（本机为 Windows PowerShell，未装 `gh` CLI，远程一律走 `git` + GitHub REST API）。版本号以 `extension/manifest.json` 为准；代码与产品上下文见 [architecture.md](architecture.md)、[product.md](product.md)。

## 推送

```powershell
git push origin main          # 常规提交推送（推送前须先 commit）
git push origin <tag>         # 只推单个 tag（如 v2.6.1）
```

- 提交信息格式、文档同步义务与 `git commit -F <文件>` 约定见 ../AGENTS.md「硬性约定」
- 不得 force push 到 main（`--force` / `--force-with-lease`），远端落后时先 `git pull --rebase`

## 打 Tag

- tag 命名 `v<version>`（版本号以 manifest.json 为准）
- 用 annotated tag（含 tagger 与说明）；多行说明须 `-F` 文件（PowerShell 不支持 heredoc）

```powershell
git tag -a v2.6.1 -F <tag_msg_file>
git push origin v2.6.1
```

## GitHub Release（发版）

流程 = 回归打包 → git tag 推送 → REST API 建 Release：

```powershell
# 1. 全量回归 + 打包（pack.ps1 内含语法/算法/E2E 回归），产物 release\web-table-exporter-<ver>.zip
.\release\pack.ps1

# 2. 打 annotated tag 并推送（见上节）
git tag -a v2.6.1 -F <tag_msg_file>
git push origin main
git push origin v2.6.1

# 3. 用下方 API 要点建 Release 并上传 zip 附件，核对非 draft、附件可访问
```

### Release API 代发要点（已踩过，勿再踩）

- token：`git credential fill`（stdin 写 `protocol=https`/`host=github.com`）读本机凭据管理器，token 全程不回显；先置 `GCM_INTERACTIVE=never` 防弹窗。**PowerShell `-File` 嵌套进程向 git 管道传 stdin 会失败（fatal: missing protocol field）**，须在内联终端执行或 `System.Diagnostics.Process` 直写 stdin
- body：正文存 UTF-8 文件，用 `[string](Get-Content -LiteralPath <f> -Raw -Encoding UTF8)` 读取；**必须强转 `[string]`**，否则 PS 5.1 `ConvertTo-Json` 把文件对象序列化进 body，GitHub 返回 422「body is not a string」
- 创建：`POST /repos/<owner>/<repo>/releases`，JSON（tag_name/name/target_commitish/body），body 以 UTF-8 字节发送
- 附件：`POST /repos/<owner>/<repo>/releases/<id>/assets?name=web-table-exporter-<ver>.zip`，头 `Content-Type: application/zip`，`Invoke-RestMethod -InFile <zip>`

## 凭据与安全

- GitHub 凭据由 Git Credential Manager 管理（交互式 shell 中 `git push` 免密即凭证在册）；自动化脚本先置 `GCM_INTERACTIVE=never`，避免弹窗挂起
- token 属敏感凭据：取到后只在进程变量中使用，禁止回显、禁止写入脚本文件
- 临时脚本与正文文件放 `.git/`（不入库），用毕即删
- 上架相关检查清单见 ../release/review-notes.md，商店文案见 ../release/store-listing.md
