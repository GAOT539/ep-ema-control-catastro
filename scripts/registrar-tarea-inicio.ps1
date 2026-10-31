# scripts/registrar-tarea-inicio.ps1
# Registra la tarea programada en Windows 10 Pro para iniciar EP-EMA en segundo plano al arrancar el PC

$TaskName = "EP-EMA-Control-Catastro-5050"
$ScriptPath = Join-Path $PSScriptRoot "iniciar-produccion.ps1"

$Action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$ScriptPath`"" `
    -WorkingDirectory (Split-Path -Parent $PSScriptRoot)

$Trigger = New-ScheduledTaskTrigger -AtStartup
$Settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit (New-TimeSpan -Days 365)

$Principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $Action `
    -Trigger $Trigger `
    -Settings $Settings `
    -Principal $Principal `
    -Description "Inicia automáticamente el sistema EP-EMA Control Catastro en el puerto 5050 tras verificar la BD." `
    -Force

Write-Host "✅ Tarea programada '$TaskName' registrada exitosamente en segundo plano." -ForegroundColor Green

