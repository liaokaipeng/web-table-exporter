# 一键回归：语法检查 → 算法回归 → 起静态服务 → E2E 注入回归
# 用法（仓库根目录）：
#   .\test\run-all.ps1             自动模式（默认）：headless 浏览器跑 E2E，控制台出结论（约 2-5 秒）
#   .\test\run-all.ps1 -Interactive 交互模式：打开浏览器页面人工核对，回车停止静态服务
# 原理：headless Chromium + --virtual-time-budget 虚拟时间（定时器快进、后台标签页
# 免节流），--dump-dom 抓取页底结果浮层解析 PASS/FAIL，无需人工核对即可全链路回归。
# 任一步失败即退出（$ErrorActionPreference = 'Stop'）；本文件须保持 UTF-8 带 BOM（PowerShell 5 中文兼容）
param([switch]$Interactive)
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

Write-Host "`n== 3/3 E2E 注入回归 ==" -ForegroundColor Cyan
$port = 3000
$base = "http://localhost:$port"
# 后台起静态服务；若 3000 已被本仓库的 serve 占用，复用亦无妨（同目录）
$srv = Start-Process -FilePath 'npx.cmd' -ArgumentList 'serve', '.', '-l', "$port" -WorkingDirectory $root -PassThru -WindowStyle Hidden
$e2eFail = 0
try {
  $ready = $false
  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Milliseconds 500
    try { Invoke-WebRequest -UseBasicParsing "$base/test/fixture.html" | Out-Null; $ready = $true; break } catch {}
  }
  if (-not $ready) { throw '静态服务 15 秒内未就绪（npx serve 启动失败？）' }
  $pages = @(
    @{ name = 'fixture';  url = "$base/test/fixture.html#e2e=1" },
    @{ name = 'virtual';  url = "$base/test/virtual-fixture.html#e2e=1" },
    @{ name = 'tablev2';  url = "$base/test/tablev2-fixture.html#e2e=1" }
  )

  if ($Interactive) {
    # ---- 交互模式：浏览器打开两页人工核对（页底浮层显示结果，标题带 [全部 PASS] / [FAIL n]）----
    Write-Host "E2E 页面（人工核对，虚拟滚动采集约 10-30 秒）："
    $pages | ForEach-Object { Write-Host "  $($_.url)"; Start-Process $_.url }
    Write-Host "`n看完两个页面的结论后，按回车停止静态服务…" -ForegroundColor Yellow
    [void](Read-Host)
    return
  }

  # ---- 自动模式：headless Chromium 跑三页（并行进程互不干扰），解析页底结果 ----
  $browser = $null
  $cands = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
  )
  foreach ($c in $cands) { if (Test-Path $c) { $browser = $c; break } }
  if (-not $browser) {
    # 找不到浏览器：降级交互模式
    Write-Host "未找到 Chrome/Edge，降级为交互模式（人工核对）" -ForegroundColor Yellow
    $pages | ForEach-Object { Start-Process $_.url }
    Write-Host "`n看完两个页面的结论后，按回车停止静态服务…" -ForegroundColor Yellow
    [void](Read-Host)
    return
  }

  # 两/三页并行启动后依次收割（各自独立 headless 进程 + 独立临时 profile）
  $runners = @()
  foreach ($pg in $pages) {
    $stamp = [System.IO.Path]::GetFileName([System.IO.Path]::GetRandomFileName())
    $outFile = "$env:TEMP\h2x-e2e-$stamp.html"
    $profile = "$env:TEMP\h2x-e2e-profile-$stamp"
    $p = Start-Process -FilePath $browser -ArgumentList @(
        '--headless', '--disable-gpu', '--disable-extensions', '--no-first-run',
        '--no-default-browser-check', "--user-data-dir=$profile", '--window-size=1366,900',
        # 虚拟时间预算须覆盖 harness 全部定时器总和（toast 2.5s × 数十条 + 采集 settle 等，实测 <120s）；
        # 预算只在页面空闲时快进耗尽，取大不影响实际耗时
        '--virtual-time-budget=600000', '--dump-dom', $pg.url
      ) -RedirectStandardOutput $outFile -RedirectStandardError "$env:TEMP\h2x-e2e-$stamp.err" -PassThru -WindowStyle Hidden
    $runners += @{ page = $pg; proc = $p; outFile = $outFile; profile = $profile; errFile = "$env:TEMP\h2x-e2e-$stamp.err"; watch = [System.Diagnostics.Stopwatch]::StartNew() }
  }

  $results = @()
  foreach ($r in $runners) {
    $pg = $r.page
    if (-not $r.proc.WaitForExit(180000)) {
      taskkill /PID $r.proc.Id /T /F | Out-Null
      $results += @{ page = $pg; ok = $false; summary = 'headless 运行超时（180 秒）'; fails = @(); ms = $r.watch.ElapsedMilliseconds }
      continue
    }
    $null = $r.proc.WaitForExit()   # 无参重载：等待重定向流句柄关闭，防止读输出文件撞锁
    $ms = $r.watch.ElapsedMilliseconds
    $txt = ''
    if (Test-Path $r.outFile) {
      # 流句柄关闭与 AV 扫描都可能短暂锁文件：小重试兜底
      for ($i = 0; $i -lt 5 -and $txt -eq ''; $i++) {
        try { $txt = [System.IO.File]::ReadAllText($r.outFile, [System.Text.Encoding]::UTF8) } catch { Start-Sleep -Milliseconds 200 }
      }
    }
    Remove-Item $r.outFile, $r.profile, $r.errFile -Recurse -Force -ErrorAction SilentlyContinue
    $title = [regex]::Match($txt, '<title>([^<]*)</title>').Groups[1].Value
    $sums = [regex]::Matches($txt, 'id="e2e-summary"[^>]*>([^<]*)</b>')
    $summary = if ($sums.Count -gt 0) { $sums[$sums.Count - 1].Groups[1].Value } else { '(页底无结果浮层)' }
    $fails = @([regex]::Matches($txt, '>FAIL ([^<]*)</li>') | ForEach-Object {
      $_.Groups[1].Value -replace '&lt;', '<' -replace '&gt;', '>' -replace '&quot;', '"' -replace '&amp;', '&'
    })
    $ok = $title.Contains('[全部 PASS]')
    if (-not $ok -and -not $title.Contains('[')) { $summary = '未完成（无结论徽标，虚拟时间预算内未跑完）' }
    $results += @{ page = $pg; ok = $ok; summary = $summary; fails = $fails; ms = $ms }
  }

  Write-Host "浏览器：$(Split-Path -Leaf $browser)，三页并行 headless 运行："
  foreach ($res in $results) {
    $mark = if ($res.ok) { 'PASS' } else { 'FAIL' }
    $color = if ($res.ok) { 'Green' } else { 'Red' }
    Write-Host ("  [{0}] {1}（{2}ms）：{3}" -f $mark, $res.page.name, $res.ms, $res.summary) -ForegroundColor $color
    foreach ($f in $res.fails) { Write-Host "      FAIL $f" -ForegroundColor Red }
    if (-not $res.ok) { $e2eFail++ }
  }
  if ($e2eFail -eq 0) { Write-Host "`n全部通过：语法 + 算法 + E2E（fixture / virtual / tablev2）" -ForegroundColor Green }
} finally {
  if ($srv -and -not $srv.HasExited) { taskkill /PID $srv.Id /T /F | Out-Null }
}
if ($e2eFail -gt 0) { exit 1 }
