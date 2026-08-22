# ══════════════════════════════════════════════════════════════════════════
#  مُعِدّ جهاز الكاشير — HAIL POS one-shot installer
#  يكتشف طابعة الفواتير، يشاركها، يجعلها الافتراضية، يثبّت وكيل القاصة
#  ويشغّله مع بدء التشغيل، يختبر فتح الدرج، ويصنع اختصار «كاشير هيل»
#  بوضع الطباعة الصامتة. آمن لإعادة التشغيل في أي وقت.
#
#  التشغيل: انسخ سطر التثبيت من ملف «تثبيت — كاشير …» وألصقه في PowerShell.
#
#  -Station  pastry | cafe   (أي كاشير يعمل عليه هذا الجهاز)
#  -Url      رابط النظام     (إن تُرك فارغاً يسأل عنه)
# ══════════════════════════════════════════════════════════════════════════
param(
  [ValidateSet("pastry", "cafe")][string]$Station = "",
  [string]$Url = ""
)
$ErrorActionPreference = "Continue"
chcp 65001 | Out-Null

function Say($msg, $ok = $true) {
  $mark = if ($ok) { "[ OK ]" } else { "[ !! ]" }
  Write-Host "$mark $msg"
}

# ── 0) صلاحيات المسؤول (يرفع نفسه تلقائياً إن أمكن) ─────────────────────────
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  if ($PSCommandPath) {
    Start-Process powershell -Verb RunAs -ArgumentList "-ExecutionPolicy Bypass -File `"$PSCommandPath`""
    exit
  }
  Say "شغّل PowerShell كمسؤول (Run as Administrator) ثم أعد المحاولة" $false
  Read-Host "اضغط Enter للإغلاق"
  exit 1
}

# ── 0.5) أي كاشير؟ وما رابط النظام؟ ────────────────────────────────────────
if (-not $Station) {
  Write-Host ""
  Write-Host "  1) كاشير المعجنات والمخبوزات"
  Write-Host "  2) كاشير الكافيه"
  $pick = Read-Host "اختر رقم الكاشير لهذا الجهاز (1 أو 2)"
  $Station = if ($pick -eq "2") { "cafe" } else { "pastry" }
}
$StationName = if ($Station -eq "cafe") { "كاشير الكافيه" } else { "كاشير المعجنات" }

if (-not $Url) {
  $Url = Read-Host "الصق رابط النظام (مثال: https://hail.example.workers.dev)"
}
$Url = $Url.Trim().TrimEnd("/")
if (-not $Url.StartsWith("http")) { $Url = "https://$Url" }

Write-Host ""
Write-Host "══════ إعداد $StationName — مخبز ومقهى هيل ══════"
Write-Host "الرابط: $Url"
Write-Host ""

# ── 1) اكتشاف طابعة الفواتير ────────────────────────────────────────────────
$pat = "POS|-80|80mm|58|Receipt|Thermal|BIXOLON|EPSON TM|TM-|XP-|Xprinter|SAM4S|Citizen|POSBANK|SEWOO|Rongta|GP-|SPRT|HPRT"
$all = @(Get-Printer | Where-Object { $_.Name -notmatch "OneNote|PDF|XPS|Fax" })
if (-not $all) {
  Say "لا توجد أي طابعة مثبتة! ثبّت تعريف طابعة الفواتير أولاً ثم أعد التشغيل" $false
  Read-Host "اضغط Enter للإغلاق"
  exit 1
}
$defaultName = (Get-CimInstance Win32_Printer | Where-Object { $_.Default }).Name
$cands = @($all | Where-Object { $_.Name -match $pat })
$chosen = $null
if ($defaultName -and ($cands | Where-Object { $_.Name -eq $defaultName })) { $chosen = $all | Where-Object { $_.Name -eq $defaultName } | Select-Object -First 1 }
elseif ($cands) { $chosen = $cands | Select-Object -First 1 }
elseif ($defaultName) { $chosen = $all | Where-Object { $_.Name -eq $defaultName } | Select-Object -First 1 }
else { $chosen = $all | Select-Object -First 1 }
Say "طابعة الفواتير المكتشفة: $($chosen.Name)"

# ── 2) مشاركة الطابعة (أو استخدام مشاركتها الحالية) ────────────────────────
try { Start-Service LanmanServer -ErrorAction Stop } catch {}
$share = $null
if ($chosen.Shared -and $chosen.ShareName) {
  $share = $chosen.ShareName
  Say "الطابعة مشاركة مسبقاً بالاسم: $share (سيُستخدم كما هو)"
} else {
  $share = "POS80"
  try {
    Set-Printer -Name $chosen.Name -Shared $true -ShareName $share -ErrorAction Stop
    Say "تمت مشاركة الطابعة بالاسم: $share"
  } catch {
    Say "تعذّرت المشاركة تلقائياً: $($_.Exception.Message) — شاركها يدوياً بالاسم POS80" $false
  }
}

# ── 3) جعلها الطابعة الافتراضية وتثبيت ذلك ─────────────────────────────────
try {
  (New-Object -ComObject WScript.Network).SetDefaultPrinter($chosen.Name)
  New-ItemProperty -Path "HKCU:\Software\Microsoft\Windows NT\CurrentVersion\Windows" -Name "LegacyDefaultPrinterMode" -Value 1 -PropertyType DWord -Force | Out-Null
  Say "أصبحت الافتراضية (وأوقفنا تبديل Windows التلقائي لها)"
} catch {
  Say "تعذّر ضبط الافتراضية تلقائياً — اضبطها من إعدادات الطابعات" $false
}

# ── 4) تثبيت وكيل القاصة (اسم المشاركة مضمّن تلقائياً) ─────────────────────
$dir = "C:\hail"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$agent = @'
param([string]$PrinterShare = "__SHARE__", [int]$Port = 9977)
$bytes = [byte[]](27, 112, 0, 25, 250)
$kickFile = Join-Path $env:TEMP "hail-drawer-kick.bin"
[IO.File]::WriteAllBytes($kickFile, $bytes)
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://127.0.0.1:$Port/")
$listener.Start()
while ($true) {
  $ctx = $listener.GetContext()
  $req = $ctx.Request; $res = $ctx.Response
  $res.Headers.Add("Access-Control-Allow-Origin", "*")
  $res.Headers.Add("Access-Control-Allow-Methods", "GET, OPTIONS")
  $res.Headers.Add("Access-Control-Allow-Private-Network", "true")
  if ($req.HttpMethod -eq "OPTIONS") { $res.StatusCode = 204; $res.Close(); continue }
  if ($req.Url.AbsolutePath -eq "/kick") {
    cmd /c "copy /b `"$kickFile`" \\127.0.0.1\$PrinterShare" | Out-Null
    $buf = [Text.Encoding]::UTF8.GetBytes("ok")
    $res.OutputStream.Write($buf, 0, $buf.Length)
  } else { $res.StatusCode = 404 }
  $res.Close()
}
'@
$agent.Replace("__SHARE__", $share) | Set-Content -Path "$dir\drawer-agent.ps1" -Encoding UTF8
Say "وكيل القاصة مثبت في $dir\drawer-agent.ps1 (المشاركة: $share)"

# ── 5) التشغيل مع إقلاع الجهاز + تشغيله الآن ────────────────────────────────
$startupDir = "C:\ProgramData\Microsoft\Windows\Start Menu\Programs\StartUp"
"@echo off`r`nstart `"`" /min powershell -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$dir\drawer-agent.ps1`"" |
  Set-Content -Path "$startupDir\hail-drawer.cmd" -Encoding ASCII
Say "أُضيف لبدء التشغيل التلقائي"

Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
  Where-Object { $_.CommandLine -like "*drawer-agent.ps1*" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Process powershell -WindowStyle Hidden -ArgumentList "-ExecutionPolicy Bypass -File `"$dir\drawer-agent.ps1`""
Start-Sleep -Seconds 2
Say "الوكيل يعمل الآن"

# ── 6) اختبار فتح الدرج ─────────────────────────────────────────────────────
try {
  Invoke-WebRequest "http://127.0.0.1:9977/kick" -UseBasicParsing -TimeoutSec 6 | Out-Null
  Say "أُرسلت نبضة الاختبار — إن انفتح الدرج الآن فكل شيء مضبوط 💰"
} catch {
  Say "لم يستجب الوكيل للاختبار — أعد تشغيل الجهاز وجرّب http://127.0.0.1:9977/kick" $false
}

# ── 7) اختصار «كاشير هيل» بوضع الطباعة الصامتة ──────────────────────────
$browser = @(
  "C:\Program Files\Google\Chrome\Application\chrome.exe",
  "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
  "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
  "C:\Program Files\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($browser) {
  # أيقونة هيل للاختصار (تُنزَّل مرة واحدة؛ إن فشل التنزيل نستخدم أيقونة المتصفح)
  $ico = "$dir\hail.ico"
  try {
    Invoke-WebRequest "$Url/icons/icon-192.png" -OutFile "$dir\hail.png" -UseBasicParsing -TimeoutSec 20
    Add-Type -AssemblyName System.Drawing
    $bmp = [Drawing.Bitmap]::FromFile("$dir\hail.png")
    $icon = [Drawing.Icon]::FromHandle($bmp.GetHicon())
    $fs = [IO.File]::Create($ico); $icon.Save($fs); $fs.Close(); $bmp.Dispose()
  } catch { $ico = $null }

  $ws = New-Object -ComObject WScript.Shell
  $lnk = $ws.CreateShortcut("$([Environment]::GetFolderPath('CommonDesktopDirectory'))\$StationName.lnk")
  $lnk.TargetPath = $browser
  # نافذة تطبيق مستقلة بلا أشرطة متصفح (--app) + طباعة صامتة + ملء الشاشة.
  # تفتح على شاشة الطلبات الواردة — وهي شاشة العمل اليومية لكل كاشير.
  $lnk.Arguments = "--app=$Url/orders --kiosk-printing --start-maximized --no-first-run"
  if ($ico -and (Test-Path $ico)) { $lnk.IconLocation = "$ico,0" } else { $lnk.IconLocation = "$browser,0" }
  $lnk.Save()
  Say "اختصار «$StationName» (نافذة تطبيق نظيفة + أيقونة هيل + طباعة صامتة)"

  # ── يفتح الكاشير تلقائياً عند تشغيل ويندوز (نسخة من الاختصار في مجلد بدء التشغيل) ──
  $startupLnk = $ws.CreateShortcut("$startupDir\$StationName.lnk")
  $startupLnk.TargetPath  = $browser
  $startupLnk.Arguments   = $lnk.Arguments
  $startupLnk.IconLocation = $lnk.IconLocation
  $startupLnk.Save()
  Say "الكاشير سيفتح تلقائياً عند بدء تشغيل ويندوز 🚀"
} else {
  Say "لم أجد Chrome أو Edge — ثبّت أحدهما ثم أعد التشغيل" $false
}

Write-Host ""
Write-Host "══════ اكتمل الإعداد ══════"
Write-Host "الجهاز: $StationName"
Write-Host "الطابعة: $($chosen.Name)  |  المشاركة: $share  |  وكيل الدرج: 127.0.0.1:9977"
Write-Host "الرابط: $Url/orders"
Write-Host ""
Write-Host "الشاشة + وكيل الدرج يبدآن تلقائياً عند تشغيل ويندوز (بعد تسجيل الدخول)."
Write-Host "المتبقي عليك مرة واحدة:"
Write-Host "  1) افتح الاختصار، اختر «$StationName»، وسجّل الدخول بحساب هذا الكاشير."
Write-Host "  2) داخل الشاشة فعّل: 🖨️ الطباعة التلقائية  و  💰 فتح القاصة عند الدفع."
Write-Host ""
Write-Host "اختياري — لتشغيل غير مراقَب تماماً (بلا كتابة كلمة سر ويندوز عند الإقلاع):"
Write-Host "  شغّل  netplwiz  ← ألغِ تحديد «يجب على المستخدمين إدخال اسم وكلمة مرور» ← أدخل كلمة السر مرة."
Write-Host "  (هذا إعداد ويندوز يخصّك؛ يخزّن كلمة السر محلياً — فعّله فقط على جهاز الكاشير المخصّص.)"
Write-Host ""
Read-Host "اضغط Enter للإغلاق"
