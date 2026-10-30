# Reads text from a part of the screen with the OCR built into Windows (Russian).
# Prints one JSON line per change: {"type":"frame","t":<ms>,"w":<width>,"lines":[{"text","x","y","r"}]}
# Test on an image: powershell -File ocr-helper.ps1 -ImagePath chat.png
param(
  [int]$X = 0, [int]$Y = 0, [int]$W = 0, [int]$H = 0,
  [int]$IntervalMs = 250, [int]$Scale = 2, [int]$ParentPid = 0,
  [string]$ImagePath = ''
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Emit($obj) { [Console]::Out.WriteLine(($obj | ConvertTo-Json -Compress -Depth 5)); [Console]::Out.Flush() }

try {
  Add-Type -AssemblyName System.Drawing
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  Add-Type -TypeDefinition 'using System.Runtime.InteropServices; public static class RqDpi { [DllImport("user32.dll")] public static extern bool SetProcessDPIAware(); }'
  [void][RqDpi]::SetProcessDPIAware()
  $null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
  $null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]
  $null = [Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime]
  $asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
      $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
  $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage((New-Object Windows.Globalization.Language 'ru'))
  if (-not $engine) { Emit @{ type = 'error'; code = 'no-ru-ocr'; message = 'Russian OCR language is not installed' }; exit 2 }
} catch {
  Emit @{ type = 'error'; code = 'init'; message = $_.Exception.Message }
  exit 2
}

function Await($op, [Type]$type) {
  $task = $asTask.MakeGenericMethod($type).Invoke($null, @($op))
  $null = $task.Wait(-1)
  $task.Result
}

function Recognize([System.Drawing.Bitmap]$src) {
  $bw = $src.Width * $Scale; $bh = $src.Height * $Scale
  $big = New-Object System.Drawing.Bitmap $bw, $bh
  $g = [System.Drawing.Graphics]::FromImage($big)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.DrawImage($src, 0, 0, $bw, $bh)
  $g.Dispose()
  $ms = New-Object System.IO.MemoryStream
  $big.Save($ms, [System.Drawing.Imaging.ImageFormat]::Bmp)
  $big.Dispose()
  $ms.Position = 0
  $ras = [System.IO.WindowsRuntimeStreamExtensions]::AsRandomAccessStream($ms)
  $dec = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($ras)) ([Windows.Graphics.Imaging.BitmapDecoder])
  $sb = Await ($dec.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
  $res = Await ($engine.RecognizeAsync($sb)) ([Windows.Media.Ocr.OcrResult])
  $sb.Dispose(); $ras.Dispose(); $ms.Dispose()
  $out = New-Object System.Collections.ArrayList
  foreach ($line in $res.Lines) {
    $words = @($line.Words)
    if ($words.Count -eq 0) { continue }
    $a = $words[0].BoundingRect; $z = $words[$words.Count - 1].BoundingRect
    $ws = New-Object System.Collections.ArrayList
    foreach ($wd in $words) { [void]$ws.Add(@{ t = $wd.Text; x = [int]($wd.BoundingRect.X / $Scale) }) }
    [void]$out.Add(@{ text = $line.Text; x = [int]($a.X / $Scale); y = [int]($a.Y / $Scale); r = [int](($z.X + $z.Width) / $Scale); words = $ws })
  }
  return , $out
}

function Now() { [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() }

if ($ImagePath) {
  $img = [System.Drawing.Bitmap]::FromFile($ImagePath)
  $lines = Recognize $img
  Emit @{ type = 'frame'; t = (Now); w = $img.Width; lines = $lines }
  $img.Dispose()
  exit 0
}

if ($W -le 0 -or $H -le 0) { Emit @{ type = 'error'; code = 'no-region'; message = 'Chat area is not set' }; exit 3 }

$cap = New-Object System.Drawing.Bitmap $W, $H, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$gc = [System.Drawing.Graphics]::FromImage($cap)
$md5 = [System.Security.Cryptography.MD5]::Create()
$rect = New-Object System.Drawing.Rectangle 0, 0, $W, $H
$prev = ''
$loops = 0
Emit @{ type = 'ready' }

while ($true) {
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  try {
    $gc.CopyFromScreen($X, $Y, 0, 0, $cap.Size)
    $data = $cap.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, $cap.PixelFormat)
    $bytes = New-Object byte[] ($data.Stride * $H)
    [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)
    $cap.UnlockBits($data)
    $hash = [Convert]::ToBase64String($md5.ComputeHash($bytes))
    if ($hash -ne $prev) {
      $prev = $hash
      $t = Now
      $lines = Recognize $cap
      Emit @{ type = 'frame'; t = $t; w = $W; lines = $lines }
    }
  } catch {
    Emit @{ type = 'error'; message = $_.Exception.Message }
    Start-Sleep -Milliseconds 1000
  }
  $loops++
  if ($ParentPid -gt 0 -and ($loops % 20) -eq 0) {
    if (-not (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue)) { exit 0 }
  }
  $rest = $IntervalMs - $sw.ElapsedMilliseconds
  if ($rest -gt 0) { Start-Sleep -Milliseconds $rest }
}
