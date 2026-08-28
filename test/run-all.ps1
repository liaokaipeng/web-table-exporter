# 一键回归：语法检查 → 算法回归 → 起静态服务 → 浏览器跑两个 E2E 页面
# 用法（仓库根目录）：.\test\run-all.ps1
# 任一步失败即退出（$ErrorActionPreference = 'Stop'），全过后回车停止静态服务
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot   # 仓库根

Write-Host "== 1/3 语法检查（内容脚本 + service-worker）==" -ForegroundColor Cyan
$files = @(Get-ChildItem (Join-Path $root 'extension/content') -Filter *.js)
$sw = Join-Path $root 'extension/background/service-worker.js'
$fail = 0
foreach ($f in $files) { node --check $f.FullName; if ($LASTEXITCODE -ne 0) { $fail++ } }
node --check $sw; if ($LASTEXITCODE -ne 0) { $fail++ }
if ($fail -gt 0) { Write-Host "语法检查 $fail 个文件失败" -ForegroundColor Red; exit 1 }
Write-Host "语法检查通过（$($files.Count + 1) 个文件）"

Write-Host "`n== 2/3 算法回归（algo-check.cjs，含模块清单一致性）==" -ForegroundColor Cyan
Push-Location $root
try {
  # algo-check 自带 PASS/FAIL 明细与汇总行，失败退出码非 0
  node test/algo-check.cjs
  if ($LASTEXITCODE -ne 0) { Write-Host '算法回归失败' -ForegroundColor Red; exit 1 }
} finally { Pop-Location }

Write-Host "`n== 3/3 E2E 注入回归（浏览器自动运行）==" -ForegroundColor Cyan
$port = 3000
$base = "http://localhost:$port"
# 后台起静态服务；若 3000 已被本仓库的 serve 占用，复用亦无妨（同目录）
$srv = Start-Process -FilePath 'npx.cmd' -ArgumentList 'serve', '.', '-l', "$port" -WorkingDirectory $root -PassThru -WindowStyle Hidden
try {
  $ready = $false
  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Milliseconds 500
    try { Invoke-WebRequest -UseBasicParsing "$base/test/fixture.html" | Out-Null; $ready = $true; break } catch {}
  }
  if (-not $ready) { throw '静态服务 15 秒内未就绪（npx serve 启动失败？）' }
  $e2e = @("$base/test/fixture.html#e2e=1", "$base/test/virtual-fixture.html#e2e=1")
  Write-Host "E2E 页面（页底浮层显示结果，标签页标题带 [全部 PASS] / [FAIL n]）："
  $e2e | ForEach-Object { Write-Host "  $_" }
  # 虚拟滚动页采集约 10-30 秒，两个标签页可同时跑（各自独立页面，互不干扰）
  $e2e | ForEach-Object { Start-Process $_ }
  Write-Host "`n看完两个页面的结论后，按回车停止静态服务…" -ForegroundColor Yellow
  [void](Read-Host)
} finally {
  if ($srv -and -not $srv.HasExited) { taskkill /PID $srv.Id /T /F | Out-Null }
}
