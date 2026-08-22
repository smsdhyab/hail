# ══════════════════════════════════════════════════════════════════════════
#  مُصلح الطابعة — HAIL printer doctor
#  يعالج توقف طابعة الفواتير بعد إعادة التشغيل: سبولر متجمد، طابور معلّق،
#  وضع Offline، تغيّر الافتراضية — ثم يطبع سطر اختبار حقيقياً ويختبر القاصة.
#
#  التشغيل (PowerShell كمسؤول):
#    irm http://localhost:3000/scripts/fix-printer.ps1 -OutFile "$env:TEMP\hail-fix.ps1"; powershell -ExecutionPolicy Bypass -File "$env:TEMP\hail-fix.ps1"
# ══════════════════════════════════════════════════════════════════════════
$ErrorActionPreference = "Continue"
chcp 65001 | Out-Null

function Say($msg, $ok = $true) {
  $mark = if ($ok) { "[ OK ]" } else { "[ !! ]" }
  Write-Host "$mark $msg"
}

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  if ($PSCommandPath) { Start-Process powershell -Verb RunAs -ArgumentList "-ExecutionPolicy Bypass -File `"$PSCommandPath`""; exit }
  Say "شغّل PowerShell كمسؤول ثم أعد المحاولة" $false
  Read-Host "اضغط Enter للإغلاق"
  exit 1
}

Write-Host ""
Write-Host "══════ إصلاح طابعة هيل ══════"
Write-Host ""

# ── 1) إعادة تشغيل خدمة الطباعة (تحل أغلب حالات التجمد) ────────────────────
try {
  Restart-Service Spooler -Force -ErrorAction Stop
  Start-Sleep -Seconds 2
  Say "خدمة الطباعة (Spooler) أُعيد تشغيلها"
} catch {
  Say "تعذّرت إعادة تشغيل خدمة الطباعة: $($_.Exception.Message)" $false
}
try { Start-Service LanmanServer -ErrorAction SilentlyContinue } catch {}

# ── 2) العثور على طابعة الفواتير ────────────────────────────────────────────
$pat = "POS|-80|80mm|58|Receipt|Thermal|BIXOLON|EPSON TM|TM-|XP-|Xprinter|SAM4S|Citizen|POSBANK|SEWOO|Rongta|GP-|SPRT|HPRT"
$all = @(Get-Printer | Where-Object { $_.Name -notmatch "OneNote|PDF|XPS|Fax" })
$chosen = $all | Where-Object { $_.Shared -and $_.ShareName } | Select-Object -First 1
if (-not $chosen) { $chosen = $all | Where-Object { $_.Name -match $pat } | Select-Object -First 1 }
if (-not $chosen) { $chosen = $all | Select-Object -First 1 }
if (-not $chosen) {
  Say "لا توجد طابعة مثبتة إطلاقاً! تأكد من كابل USB وتشغيل الطابعة ثم ثبّت التعريف" $false
  Read-Host "اضغط Enter للإغلاق"
  exit 1
}
Say "الطابعة: $($chosen.Name)"

# ── 3) مسح الطابور المعلّق (مهمة عالقة توقف كل ما بعدها) ───────────────────
try {
  $jobs = @(Get-PrintJob -PrinterName $chosen.Name -ErrorAction Stop)
  if ($jobs.Count) {
    $jobs | Remove-PrintJob -ErrorAction SilentlyContinue
    Say "أُلغيت $($jobs.Count) مهمة معلّقة في الطابور"
  } else {
    Say "الطابور فارغ"
  }
} catch {
  Say "الطابور فارغ"
}

# ── 4) إخراجها من وضع Offline إن علقت فيه ──────────────────────────────────
try {
  $wmi = Get-CimInstance Win32_Printer -Filter "Name='$($chosen.Name.Replace("'","''"))'"
  if ($wmi.WorkOffline) {
    $wmi | Set-CimInstance -Property @{ WorkOffline = $false }
    Say "كانت بوضع Offline — أُعيدت للاتصال"
  } else {
    Say "ليست بوضع Offline"
  }
} catch {
  Say "تعذّر فحص وضع Offline: $($_.Exception.Message)" $false
}

# ── 5) التأكد من المشاركة والافتراضية ──────────────────────────────────────
$share = $chosen.ShareName
if (-not ($chosen.Shared -and $share)) {
  $share = "POS80"
  try { Set-Printer -Name $chosen.Name -Shared $true -ShareName $share -ErrorAction Stop; Say "أُعيدت المشاركة بالاسم $share" } catch { Say "تعذّرت المشاركة: $($_.Exception.Message)" $false }
} else {
  Say "المشاركة سليمة: $share"
}
try {
  (New-Object -ComObject WScript.Network).SetDefaultPrinter($chosen.Name)
  New-ItemProperty -Path "HKCU:\Software\Microsoft\Windows NT\CurrentVersion\Windows" -Name "LegacyDefaultPrinterMode" -Value 1 -PropertyType DWord -Force | Out-Null
  Say "ثُبّتت كطابعة افتراضية"
} catch {
  Say "تعذّر ضبط الافتراضية" $false
}

# ── 6) طباعة سطر اختبار حقيقي عبر المشاركة ─────────────────────────────────
$test = [byte[]](27, 64) + [Text.Encoding]::ASCII.GetBytes("HAIL PRINT TEST`n`n`n`n`n") + [byte[]](29, 86, 66, 0)  # ESC @ init, feed, partial cut
$tf = Join-Path $env:TEMP "hail-print-test.bin"
[IO.File]::WriteAllBytes($tf, $test)
cmd /c "copy /b `"$tf`" \\127.0.0.1\$share" | Out-Null
if ($LASTEXITCODE -eq 0) {
  Say "أُرسل سطر اختبار — يجب أن تخرج ورقة الآن 🖨️"
} else {
  Say "فشل الإرسال للمشاركة \\127.0.0.1\$share — تأكد أن الطابعة موصولة ومشغّلة" $false
}

# ── 7) وكيل القاصة: تشغيل + اختبار ─────────────────────────────────────────
$agentRunning = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -like "*drawer-agent.ps1*" }
if (-not $agentRunning -and (Test-Path "C:\hail\drawer-agent.ps1")) {
  Start-Process powershell -WindowStyle Hidden -ArgumentList "-ExecutionPolicy Bypass -File `"C:\hail\drawer-agent.ps1`""
  Start-Sleep -Seconds 2
  Say "وكيل القاصة لم يكن يعمل — شُغّل الآن"
} elseif ($agentRunning) {
  Say "وكيل القاصة يعمل"
}
try {
  Invoke-WebRequest "http://127.0.0.1:9977/kick" -UseBasicParsing -TimeoutSec 6 | Out-Null
  Say "نبضة اختبار للقاصة أُرسلت 💰"
} catch {
  Say "وكيل القاصة لا يستجيب — أعد تشغيل الجهاز إن لم يفتح الدرج" $false
}

Write-Host ""
Write-Host "══════ انتهى الإصلاح ══════"
Write-Host "إن لم تخرج ورقة الاختبار: تأكد من (1) الطابعة مشغّلة والأضواء خضراء"
Write-Host "(2) غطاء الورق مغلق والرول بالاتجاه الصحيح (3) كابل USB مثبت — ثم أعد تشغيل الأداة"
Write-Host ""
Read-Host "اضغط Enter للإغلاق"
