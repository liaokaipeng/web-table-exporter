# gen-icon.ps1 — 生成 Web Table Exporter 扩展图标（icon16/32/48/128.png）
# 风格：纯色极简 —— 品牌蓝圆角底 + 白色表格（实心表头 + 白色网格线），无徽章无渐变
# 原理：GDI+ 在 512px 母版上矢量绘制，再高质量降采样到各尺寸（避免手改二进制）
# 用法：powershell -File test/gen-icon.ps1（输出到 extension/icons/）
Add-Type -AssemblyName System.Drawing

$size = 512
$round = 116
$bg = [System.Drawing.Color]::FromArgb(255, 37, 99, 235)    # 品牌蓝 #2563EB
$fg = [System.Drawing.Color]::FromArgb(255, 255, 255, 255)  # 纯白图形

function New-RoundRect([float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
    $p = New-Object System.Drawing.Drawing2D.GraphicsPath
    $p.AddArc($x, $y, 2*$r, 2*$r, 180, 90)
    $p.AddArc($x+$w-2*$r, $y, 2*$r, 2*$r, 270, 90)
    $p.AddArc($x+$w-2*$r, $y+$h-2*$r, 2*$r, 2*$r, 0, 90)
    $p.AddArc($x, $y+$h-2*$r, 2*$r, 2*$r, 90, 90)
    $p.CloseFigure()
    return $p
}

$outDir = Join-Path $PSScriptRoot "..\extension\icons"
if (!(Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir | Out-Null }

$bmp = New-Object System.Drawing.Bitmap($size, $size)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

# 1) 纯色圆角底
$bgPath = New-RoundRect 6 6 500 500 $round
$brushBg = New-Object System.Drawing.SolidBrush($bg)
$g.FillPath($brushBg, $bgPath)
$brushBg.Dispose()

# 2) 白色表格：粗外框 + 实心表头行 + 网格线（整体垂直居中）
$tblX = 96.0; $tblY = 128.0; $tblW = 320.0; $tblH = 256.0; $outerR = 28.0
$rows = 3; $cols = 3
$outerPath = New-RoundRect $tblX $tblY $tblW $tblH $outerR

# 表头行实心白（裁剪到外框路径内，圆角处不溢出）
$g.SetClip($outerPath)
$brushHdr = New-Object System.Drawing.SolidBrush($fg)
$g.FillRectangle($brushHdr, $tblX, $tblY, $tblW, ($tblH / $rows))
$brushHdr.Dispose()

# 网格线（裁剪到外框内，端点与外框自然融合）
$penLine = New-Object System.Drawing.Pen($fg, 22)
$penLine.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$penLine.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
for ($i = 1; $i -lt $rows; $i++) {
    $y = $tblY + $tblH * $i / $rows
    $g.DrawLine($penLine, $tblX, $y, ($tblX + $tblW), $y)
}
for ($c = 1; $c -lt $cols; $c++) {
    $x = $tblX + $tblW * $c / $cols
    $g.DrawLine($penLine, $x, $tblY, $x, ($tblY + $tblH))
}
$penLine.Dispose()
$g.ResetClip()

# 外框最后画，盖住裁剪边缘
$penOuter = New-Object System.Drawing.Pen($fg, 34)
$penOuter.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
$g.DrawPath($penOuter, $outerPath)
$penOuter.Dispose()

$g.Dispose()

# 3) 降采样导出
foreach ($s in @(128, 48, 32, 16)) {
    $small = New-Object System.Drawing.Bitmap($s, $s)
    $sg = [System.Drawing.Graphics]::FromImage($small)
    $sg.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $sg.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $sg.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $attr = New-Object System.Drawing.Imaging.ImageAttributes
    $attr.SetWrapMode([System.Drawing.Drawing2D.WrapMode]::TileFlipXY)
    $dst = New-Object System.Drawing.Rectangle(0, 0, $s, $s)
    $sg.DrawImage($bmp, $dst, 0, 0, 512, 512, [System.Drawing.GraphicsUnit]::Pixel, $attr)
    $sg.Dispose(); $attr.Dispose()
    $path = Join-Path $outDir ("icon{0}.png" -f $s)
    $small.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $small.Dispose()
    Write-Output ("generated {0}: {1} bytes" -f (Split-Path $path -Leaf), (Get-Item $path).Length)
}
$bmp.Dispose()
