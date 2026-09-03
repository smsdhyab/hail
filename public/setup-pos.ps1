# ══════════════════════════════════════════════════════════════════════════
#  مُعِدّ جهاز الكاشير — HAIL POS one-shot installer
#  يكتشف طابعة الفواتير، يشاركها، يجعلها الافتراضية، يثبّت وكيل القاصة
#  ويشغّله مع بدء التشغيل، يختبر فتح الدرج، ويصنع اختصار «كاشير هيل»
#  بوضع الطباعة الصامتة. آمن لإعادة التشغيل في أي وقت.
#
#  التشغيل: انسخ سطر التثبيت من ملف «تثبيت — كاشير …» وألصقه في PowerShell.
#
#  -Station  both | pastry | cafe   (أي كاشير يعمل عليه هذا الجهاز؛ both = صندوق واحد للقسمين)
#  -Url      رابط النظام     (إن تُرك فارغاً يسأل عنه)
# ══════════════════════════════════════════════════════════════════════════
param(
  [ValidateSet("both", "pastry", "cafe")][string]$Station = "",
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
  Say "Run PowerShell as Administrator, then try again." $false
  Read-Host "Press Enter to close"
  exit 1
}

# ── 0.5) أي كاشير؟ وما رابط النظام؟ ────────────────────────────────────────
if (-not $Station) {
  Write-Host ""
  Write-Host "  1) BOTH    - one register selling cafe AND bakery"
  Write-Host "  2) PASTRY  - bakery register only"
  Write-Host "  3) CAFE    - cafe register only"
  $pick = Read-Host "Which register is THIS computer? type 1, 2 or 3"
  $Station = switch ($pick) { "2" { "pastry" } "3" { "cafe" } default { "both" } }
}
$StationName  = switch ($Station) { "cafe" { "كاشير الكافيه" } "pastry" { "كاشير المعجنات" } default { "كاشير هيل" } }
$StationLatin = switch ($Station) { "cafe" { "CAFE register" } "pastry" { "PASTRY register" } default { "HAIL register (cafe + bakery)" } }

# المحل نطاق واحد، فالسؤال فرصة خطأ إملائي لا أكثر — Enter يقبل الافتراضي.
if (-not $Url) {
  $Url = Read-Host "System link - press Enter for https://hail.cafe"
  if (-not $Url) { $Url = "https://hail.cafe" }
}
$Url = $Url.Trim().TrimEnd("/")
if (-not $Url.StartsWith("http")) { $Url = "https://$Url" }

Write-Host ""
Write-Host "====== HAIL Bakery & Cafe - setting up: $StationLatin ======"
Write-Host "Link: $Url"
Write-Host ""

# ── 1) اكتشاف طابعة الفواتير ────────────────────────────────────────────────
$pat = "POS|-80|80mm|58|Receipt|Thermal|BIXOLON|EPSON TM|TM-|XP-|Xprinter|SAM4S|Citizen|POSBANK|SEWOO|Rongta|GP-|SPRT|HPRT"
# The Print Spooler has to be up or Get-Printer returns nothing at all, which
# looks exactly like "no printer" and sends people hunting for a driver.
$spooler = Get-Service Spooler -ErrorAction SilentlyContinue
if ($spooler -and $spooler.Status -ne "Running") {
  Say "Print Spooler service was stopped - starting it" $false
  try { Start-Service Spooler -ErrorAction Stop; Start-Sleep -Seconds 2 } catch {}
}

$every = @(Get-Printer -ErrorAction SilentlyContinue)
$all = @($every | Where-Object { $_.Name -notmatch "OneNote|PDF|XPS|Fax" })

if (-not $all) {
  Say "No receipt printer found." $false
  Write-Host ""
  Write-Host "Windows currently sees these printers:"
  if ($every) { $every | Format-Table Name, DriverName, PortName -AutoSize | Out-String | Write-Host }
  else { Write-Host "  (none at all)" }

  # A USB device that Windows can see but has no driver shows up here, which
  # tells you the cable is fine and only the driver is missing.
  $usb = @(Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue |
           Where-Object { $_.Class -in @("Printer", "USB") -and $_.FriendlyName -match "print|POS|thermal|USB Printing" })
  if ($usb) {
    Write-Host "USB devices that look like a printer:"
    $usb | Format-Table FriendlyName, Status -AutoSize | Out-String | Write-Host
  }

  Write-Host "CHECK, in this order:"
  Write-Host "  1) Printer power ON and the light is steady (not blinking)?"
  Write-Host "  2) USB cable seated at BOTH ends? try another USB port."
  Write-Host "  3) Paper roll loaded? press FEED - paper should come out."
  Write-Host "  4) Driver installed? Settings > Bluetooth & devices > Printers"
  Write-Host "     > Add device. If it does not appear, download the driver for"
  Write-Host "     your printer model from the maker's site and install it."
  Write-Host "  5) Then run this installer again."
  Write-Host ""
  Read-Host "Press Enter to close"
  exit 1
}
$defaultName = (Get-CimInstance Win32_Printer | Where-Object { $_.Default }).Name
$cands = @($all | Where-Object { $_.Name -match $pat })
$chosen = $null
if ($defaultName -and ($cands | Where-Object { $_.Name -eq $defaultName })) { $chosen = $all | Where-Object { $_.Name -eq $defaultName } | Select-Object -First 1 }
elseif ($cands) { $chosen = $cands | Select-Object -First 1 }
elseif ($defaultName) { $chosen = $all | Where-Object { $_.Name -eq $defaultName } | Select-Object -First 1 }
else { $chosen = $all | Select-Object -First 1 }

# More than one candidate (an A4 office printer sitting next to the receipt
# printer) - ask rather than guess, because sharing the wrong one silently
# means receipts print on A4 all day.
if ($all.Count -gt 1) {
  Write-Host ""
  Write-Host "More than one printer is installed:"
  for ($i = 0; $i -lt $all.Count; $i++) {
    $mark = if ($all[$i].Name -eq $chosen.Name) { "<= receipt printer?" } else { "" }
    Write-Host ("  {0}) {1}  {2}" -f ($i + 1), $all[$i].Name, $mark)
  }
  $ans = Read-Host ("Press Enter to accept [{0}], or type its number" -f $chosen.Name)
  if ($ans -match '^\d+$' -and [int]$ans -ge 1 -and [int]$ans -le $all.Count) {
    $chosen = $all[[int]$ans - 1]
  }
}
Say "Receipt printer: $($chosen.Name)"

# ── 2) مشاركة الطابعة (أو استخدام مشاركتها الحالية) ────────────────────────
try { Start-Service LanmanServer -ErrorAction Stop } catch {}
$share = $null
if ($chosen.Shared -and $chosen.ShareName) {
  $share = $chosen.ShareName
  Say "Printer already shared as: $share (keeping it)"
} else {
  $share = "POS80"
  try {
    Set-Printer -Name $chosen.Name -Shared $true -ShareName $share -ErrorAction Stop
    Say "Printer shared as: $share"
  } catch {
    Say "Could not share automatically: $($_.Exception.Message) - share it manually as POS80" $false
  }
}

# ── 3) جعلها الطابعة الافتراضية وتثبيت ذلك ─────────────────────────────────
try {
  (New-Object -ComObject WScript.Network).SetDefaultPrinter($chosen.Name)
  New-ItemProperty -Path "HKCU:\Software\Microsoft\Windows NT\CurrentVersion\Windows" -Name "LegacyDefaultPrinterMode" -Value 1 -PropertyType DWord -Force | Out-Null
  Say "Set as default printer (Windows auto-switching disabled)"
} catch {
  Say "Could not set default - set it from Windows printer settings" $false
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
Say "Cash-drawer agent installed at $dir\drawer-agent.ps1 (share: $share)"

# ── 5) التشغيل مع إقلاع الجهاز + تشغيله الآن ────────────────────────────────
$startupDir = "C:\ProgramData\Microsoft\Windows\Start Menu\Programs\StartUp"
"@echo off`r`nstart `"`" /min powershell -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$dir\drawer-agent.ps1`"" |
  Set-Content -Path "$startupDir\hail-drawer.cmd" -Encoding ASCII
Say "Added to Windows startup"

Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
  Where-Object { $_.CommandLine -like "*drawer-agent.ps1*" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Process powershell -WindowStyle Hidden -ArgumentList "-ExecutionPolicy Bypass -File `"$dir\drawer-agent.ps1`""
Start-Sleep -Seconds 2
Say "Agent is running"

# ── 6) اختبار فتح الدرج ─────────────────────────────────────────────────────
try {
  Invoke-WebRequest "http://127.0.0.1:9977/kick" -UseBasicParsing -TimeoutSec 6 | Out-Null
  Say "TEST PULSE SENT >>> the cash drawer should OPEN NOW <<<"
} catch {
  Say "Agent did not answer - restart the PC, then open http://127.0.0.1:9977/kick" $false
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
  #
  # ‎--disable-features=PrivateNetworkAccess…‎ : بلا هذا يحجب Chrome الحديث
  # مناداة صفحة hail.cafe (عامّة) لوكيل الدرج على 127.0.0.1 (محلي)، فلا يفتح
  # الدرج رغم أن الوكيل يعمل. هذه الأعلام تُلغي فحص الشبكة المحلية — آمنة على
  # جهاز كاشير مخصّص يفتح نطاق النظام وحده.
  $chromeFlags = "--kiosk-printing --start-maximized --no-first-run --disable-features=PrivateNetworkAccessSendPreflights,PrivateNetworkAccessRespectPreflightResults,LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests"
  $lnk.Arguments = "--app=$Url/orders $chromeFlags"
  if ($ico -and (Test-Path $ico)) { $lnk.IconLocation = "$ico,0" } else { $lnk.IconLocation = "$browser,0" }
  $lnk.Save()
  Say "Desktop shortcut created (clean app window, HAIL icon, silent printing)"

  # ── يفتح الكاشير تلقائياً عند تشغيل ويندوز (نسخة من الاختصار في مجلد بدء التشغيل) ──
  $startupLnk = $ws.CreateShortcut("$startupDir\$StationName.lnk")
  $startupLnk.TargetPath  = $browser
  $startupLnk.Arguments   = $lnk.Arguments
  $startupLnk.IconLocation = $lnk.IconLocation
  $startupLnk.Save()
  Say "The register screen will open automatically at Windows startup"
} else {
  Say "Chrome or Edge not found - install one, then re-run." $false
}

Write-Host ""
Write-Host "====== SETUP COMPLETE ======"
Write-Host "This computer: $StationLatin"
Write-Host "Printer: $($chosen.Name)  |  Share: $share  |  Drawer agent: 127.0.0.1:9977"
Write-Host "Link: $Url/orders"
Write-Host ""
Write-Host "Screen + drawer agent both start automatically with Windows."
Write-Host "ONE-TIME steps left for you:"
Write-Host "  1) Open the desktop shortcut, pick your register, sign in."
Write-Host "  2) Inside the screen switch ON: auto-print  AND  open-drawer-on-payment."
Write-Host ""
Write-Host "Optional - fully unattended boot (no Windows password prompt):"
Write-Host "  Run  netplwiz  > untick 'Users must enter a user name and password' > type it once."
Write-Host "  (Windows setting, stores the password locally - only on a dedicated register PC.)"
Write-Host ""
Read-Host "اضغط Enter للإغلاق"
