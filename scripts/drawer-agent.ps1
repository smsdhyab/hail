# وكيل القاصة — HAIL cash-drawer agent
# يستمع محلياً على 127.0.0.1:9977؛ عند طلب /kick يرسل نبضة فتح الدرج (ESC p)
# إلى طابعة الفواتير عبر اسم مشاركتها. يعمل بلا أي تثبيت (PowerShell فقط).
#
# الإعداد (مرة واحدة على جهاز الكاشير):
#   1) خصائص طابعة الفواتير → Sharing → فعّل المشاركة بالاسم: POS80
#   2) شغّل هذا الملف (انقر يمين → Run with PowerShell)، أو أضِفه لبدء التشغيل:
#      powershell -WindowStyle Hidden -ExecutionPolicy Bypass -File "C:\hail\drawer-agent.ps1"
#   3) في شاشة الكاشير فعّل «💰 فتح القاصة عند الدفع»
param(
  [string]$PrinterShare = "POS80",
  [int]$Port = 9977
)

$bytes = [byte[]](27, 112, 0, 25, 250)   # ESC p 0 25 250 — drawer kick pulse
$kickFile = Join-Path $env:TEMP "hail-drawer-kick.bin"
[IO.File]::WriteAllBytes($kickFile, $bytes)

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://127.0.0.1:$Port/")
$listener.Start()
Write-Host "HAIL drawer agent listening on http://127.0.0.1:$Port → \\127.0.0.1\$PrinterShare"

while ($true) {
  $ctx = $listener.GetContext()
  $req = $ctx.Request
  $res = $ctx.Response
  $res.Headers.Add("Access-Control-Allow-Origin", "*")
  $res.Headers.Add("Access-Control-Allow-Methods", "GET, OPTIONS")
  $res.Headers.Add("Access-Control-Allow-Private-Network", "true")

  if ($req.HttpMethod -eq "OPTIONS") {
    $res.StatusCode = 204
    $res.Close()
    continue
  }

  # صفحة «الأجهزة» داخل النظام تسأل هذا المسار: هل أنا على جهاز الكاشير؟
  # وما الطابعات الموجودة عليه؟ — فيُختصر الفحص اليدوي في PowerShell.
  if ($req.Url.AbsolutePath -eq "/status") {
    $printers = @()
    try {
      $printers = Get-Printer | ForEach-Object {
        [pscustomobject]@{
          name    = $_.Name
          port    = $_.PortName
          shared  = [bool]$_.Shared
          share   = $_.ShareName
          default = $false
        }
      }
      $def = (Get-CimInstance Win32_Printer -Filter "Default = TRUE" -ErrorAction SilentlyContinue).Name
      foreach ($p in $printers) { if ($p.name -eq $def) { $p.default = $true } }
    } catch { }
    $payload = [pscustomobject]@{
      agent    = "hail"
      version  = 2
      host     = $env:COMPUTERNAME
      share    = $PrinterShare
      printers = $printers
    } | ConvertTo-Json -Depth 4 -Compress
    $res.ContentType = "application/json; charset=utf-8"
    $buf = [Text.Encoding]::UTF8.GetBytes($payload)
    $res.OutputStream.Write($buf, 0, $buf.Length)
    $res.Close()
    continue
  }

  if ($req.Url.AbsolutePath -eq "/kick") {
    cmd /c "copy /b `"$kickFile`" \\127.0.0.1\$PrinterShare" | Out-Null
    $buf = [Text.Encoding]::UTF8.GetBytes("ok")
    $res.OutputStream.Write($buf, 0, $buf.Length)
  }
  else {
    $res.StatusCode = 404
  }
  $res.Close()
}
