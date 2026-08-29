# 打包 Chrome Web Store 发布 zip
# 用法（仓库根目录）：.\release\pack.ps1
# 产物：release\web-table-exporter-<version>.zip（manifest.json 位于 zip 根目录）
# 本文件须保持 UTF-8 带 BOM（PowerShell 5 中文兼容）
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot          # 仓库根
$ext = Join-Path $root 'extension'
$manifest = Join-Path $ext 'manifest.json'

# 从 manifest 读版本号，保证产物名与商店版本一致（manifest 为无 BOM UTF-8，须显式指定编码）
$m = Get-Content $manifest -Raw -Encoding UTF8 | ConvertFrom-Json
$version = $m.version
$name = $m.name
Write-Host "扩展：$name v$version" -ForegroundColor Cyan

# 打包前先跑全量回归，确保发布的是通过验证的代码
Write-Host "`n== 打包前回归 ==" -ForegroundColor Cyan
& (Join-Path $root 'test\run-all.ps1')
if ($LASTEXITCODE -ne 0) { Write-Host '回归未通过，中止打包' -ForegroundColor Red; exit 1 }

# 输出目录与产物名
$out = Join-Path $PSScriptRoot ("web-table-exporter-{0}.zip" -f $version)
if (Test-Path $out) { Remove-Item $out -Force }

# .NET ZipFile：把 extension/ 的「内容」压入（includeBaseDirectory=$false → manifest.json 位于 zip 根）
# 不用 Compress-Archive：其对文件持独占句柄，偶发与 AV 扫描/残留进程撞锁
Write-Host "`n== 打包 ==" -ForegroundColor Cyan
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory($ext, $out, [System.IO.Compression.CompressionLevel]::Optimal, $false)

# 校验 zip 结构：manifest.json 必须在根
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead($out)
try {
  $entries = $zip.Entries | ForEach-Object { $_.FullName }
  $hasManifest = $entries -contains 'manifest.json'
  $size = (Get-Item $out).Length
  Write-Host ("产物：{0}（{1:N0} KB）" -f $out, ($size / 1KB))
  Write-Host "条目数：$($entries.Count)"
  if (-not $hasManifest) { Write-Host '错误：manifest.json 不在 zip 根目录' -ForegroundColor Red; exit 1 }
  Write-Host 'zip 结构校验通过（manifest.json 位于根）' -ForegroundColor Green
} finally { $zip.Dispose() }

Write-Host "`n打包完成，可上传至 Chrome Web Store 开发者控制台。" -ForegroundColor Green
