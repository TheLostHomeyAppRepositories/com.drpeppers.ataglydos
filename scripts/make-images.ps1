# Generates the PNG images required by Homey (app + driver) from the same drawing as assets/icon.svg.
# Run from the project root with Windows PowerShell:  .\scripts\make-images.ps1

param([string]$Root = (Split-Path -Parent $PSScriptRoot))

Add-Type -AssemblyName System.Drawing

function New-RoundedRect([float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = 2 * $r
  $p.AddArc($x, $y, $d, $d, 180, 90)
  $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $p.CloseFigure()
  return $p
}

# Same drawing as assets/icon.svg, in a 960x960 coordinate space
function Draw-Boiler($g, [float]$ox, [float]$oy, [float]$size, $color) {
  $state = $g.Save()
  $g.TranslateTransform($ox, $oy)
  $g.ScaleTransform($size / 960, $size / 960)
  $pen = New-Object System.Drawing.Pen($color, 40)
  $pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
  $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round

  $g.DrawPath($pen, (New-RoundedRect 260 40 440 220 50))
  $g.DrawEllipse($pen, 410, 80, 140, 140)
  $g.DrawLine($pen, 480, 110, 480, 190)
  $g.DrawLine($pen, 440, 150, 520, 150)
  $g.DrawPath($pen, (New-RoundedRect 260 300 440 560 70))
  $g.DrawLine($pen, 360, 860, 360, 920)
  $g.DrawLine($pen, 600, 860, 600, 920)

  $drop = New-Object System.Drawing.Drawing2D.GraphicsPath
  $drop.AddBezier(480, 440, 440, 510, 390, 580, 390, 640)
  $drop.AddArc(390, 550, 180, 180, 180, -180)
  $drop.AddBezier(570, 640, 570, 580, 520, 510, 480, 440)
  $drop.CloseFigure()
  $g.DrawPath($pen, $drop)

  $pen.Dispose()
  $g.Restore($state)
}

function New-Image([int]$w, [int]$h, [string]$path, [bool]$appStyle) {
  $bmp = New-Object System.Drawing.Bitmap($w, $h)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

  $blue = [System.Drawing.ColorTranslator]::FromHtml('#1E6FA8')
  if ($appStyle) {
    $top = [System.Drawing.ColorTranslator]::FromHtml('#2A86C8')
    $rect = New-Object System.Drawing.Rectangle(0, 0, $w, $h)
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, $top, $blue, 90)
    $g.FillRectangle($brush, $rect)
    $brush.Dispose()
    $color = [System.Drawing.Color]::White
  } else {
    $g.Clear([System.Drawing.Color]::White)
    $color = $blue
  }

  $size = [Math]::Min($w, $h) * 0.8
  Draw-Boiler $g (($w - $size) / 2) (($h - $size) / 2) $size $color

  New-Item -ItemType Directory -Force -Path (Split-Path $path) | Out-Null
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
  "$path ($w x $h)"
}

New-Image 250 175 "$Root\assets\images\small.png" $true
New-Image 500 350 "$Root\assets\images\large.png" $true
New-Image 1000 700 "$Root\assets\images\xlarge.png" $true
New-Image 75 75 "$Root\drivers\lydos-hybrid\assets\images\small.png" $false
New-Image 500 500 "$Root\drivers\lydos-hybrid\assets\images\large.png" $false
New-Image 1000 1000 "$Root\drivers\lydos-hybrid\assets\images\xlarge.png" $false
