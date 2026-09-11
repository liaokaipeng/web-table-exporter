# GitHub 远程操作（推送 / Tag / Release）

本仓库远程 GitHub 操作统一收于此（Windows PowerShell，无 `gh` CLI，走 `git` + GitHub REST API）。版本号以 `extension/manifest.json` 为准；架构/产品见 [architecture.md](architecture.md)、[product.md](product.md)。

## 推送

```powershell
git push origin main          # 常规提交推送（推送前须先 commit）
git push origin <tag>         # 只推单个 tag（如 v2.6.1）
```

- 提交信息格式、文档同步义务、`git commit -F <文件>` 约定见 ../AGENTS.md「硬性约定」
- 禁 force push main（`--force` / `--force-with-lease`）；远端落后先 `git pull --rebase`

## 打 Tag

- tag 命名 `v<version>`（版本号见 manifest.json）
- 用 annotated tag（含 tagger 与说明）；多行说明须 `-F` 文件（PowerShell 无 heredoc）

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

- token：`git credential fill`（stdin 写 `protocol=https`/`host=github.com` 后留空行）读本机凭据管理器；先置 `GCM_INTERACTIVE=never` 防弹窗。**`-File` 嵌套进程向 git 管道传 stdin 会失败（fatal: refusing to work with credential missing protocol field，来自 GCM）**：脚本文件执行（含 `-File` 自动化终端）不可用管道喂 stdin，须内联执行，或改用**文件重定向 stdin**（`-File` 下唯一稳）：

```powershell
$env:GCM_INTERACTIVE='never'
[System.IO.File]::WriteAllText('.git\_cred_in.txt', "protocol=https`nhost=github.com`n`n")
Start-Process git -ArgumentList 'credential','fill' `
  -RedirectStandardInput '.git\_cred_in.txt' -RedirectStandardOutput '.git\_cred_out.txt' `
  -RedirectStandardError '.git\_cred_err.txt' -NoNewWindow -Wait
# 再从 _cred_out.txt 取 password= 行；用毕删除三个临时文件
```

- `cmd /c "... < file"` 更短，但工具链禁 `cmd`，勿依赖
- body：正文存 UTF-8 文件，用 `[string](Get-Content -LiteralPath <f> -Raw -Encoding UTF8)` 读取；**须强转 `[string]`**，否则 PS 5.1 `ConvertTo-Json` 会把文件对象序列化进 body，GitHub 返回 422「body is not a string」
- 创建：`POST /repos/<owner>/<repo>/releases`，JSON（tag_name/name/target_commitish/body），body 按 UTF-8 字节发送
- 附件：**须用创建响应里的 `upload_url`（`https://uploads.github.com/...`），不可自行拼 `api.github.com` 路径**——`POST https://api.github.com/repos/<owner>/<repo>/releases/<id>/assets` 一律 404。取法：`($rel.upload_url -replace '\{\?name,label\}','') + '?name=web-table-exporter-<ver>.zip'`，头 `Content-Type: application/zip`，`Invoke-RestMethod -InFile <zip>`
- 核对：`GET /releases/tags/<tag>` 看 `draft=false` 与 body 编码；附件用 `GET /releases/<id>/assets`，对 `browser_download_url` 发 HEAD 应 200 且长度与本地 zip 一致

## 凭据与安全

- 凭据由 Git Credential Manager 管理（交互式 shell 中 `git push` 免密即凭证在册）；自动化脚本先置 `GCM_INTERACTIVE=never`，避免弹窗挂起
- token 属敏感凭据：只在进程变量中用，禁回显、禁写入脚本文件
- 临时脚本与正文文件放 `.git/`（不入库），用毕即删
- 上架检查清单见 ../release/review-notes.md，商店文案见 ../release/store-listing.md
