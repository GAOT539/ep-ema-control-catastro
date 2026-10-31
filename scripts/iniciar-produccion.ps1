# scripts/iniciar-produccion.ps1
# Script de arranque autónomo en segundo plano para Windows 10 Pro (Puerto 5050)
# Regla estricta: SOLO verifica si la BD responde por red; NO toca ni altera el servicio MySQL.

$ErrorActionPreference = "Continue"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot

$LogDir = Join-Path $ProjectRoot "logs"
if (-not (Test-Path $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
}
$LogFile = Join-Path $LogDir "autostart-service.log"

function Write-StartupLog([string]$Message) {
    $Timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $Line = "[$Timestamp] $Message"
    Add-Content -Path $LogFile -Value $Line -Encoding UTF8
}

Write-StartupLog "=== Iniciando secuencia de arranque automático EP-EMA (Puerto 5050) ==="

# 1. Extraer host y puerto de DATABASE_URL en .env (solo lectura)
$DbHost = "localhost"
$DbPort = 3306
$EnvFile = Join-Path $ProjectRoot ".env"

if (Test-Path $EnvFile) {
    $EnvContent = Get-Content $EnvFile -Raw
    if ($EnvContent -match '(?m)^DATABASE_URL\s*=\s*["'']?mysql://[^@]+@([^:/"''\s]+):(\d+)/') {
        $DbHost = $Matches[1]
        $DbPort = [int]$Matches[2]
    }
}

# 2. Solo verificar conexión TCP a MySQL (sin tocar ningún servicio del sistema)
$DbDisponible = $false
for ($Intento = 1; $Intento -le 5; $Intento++) {
    try {
        $TcpClient = New-Object System.Net.Sockets.TcpClient
        $ConnectAsync = $TcpClient.BeginConnect($DbHost, $DbPort, $null, $null)
        $Wait = $ConnectAsync.AsyncWaitHandle.WaitOne(2000, $false)
        if ($Wait -and $TcpClient.Connected) {
            $DbDisponible = $true
            $TcpClient.Close()
            break
        }
        $TcpClient.Close()
    } catch {
        # Ignorar error de socket y reintentar
    }
    Write-StartupLog "Verificando disponibilidad de MySQL en ${DbHost}:${DbPort} (intento $Intento/5)..."
    Start-Sleep -Seconds 3
}

if ($DbDisponible) {
    Write-StartupLog "[OK] Conexión verificada con MySQL en ${DbHost}:${DbPort}."
} else {
    Write-StartupLog "[AVISO] MySQL en ${DbHost}:${DbPort} aún no responde. Iniciando el sistema en modo resiliente (tolerante a desconexión de BD)."
}

# 3. Verificar si ya existe un proceso escuchando en el puerto 5050
$PuertoOcupado = Get-NetTCPConnection -LocalPort 5050 -State Listen -ErrorAction SilentlyContinue
if ($PuertoOcupado) {
    Write-StartupLog "[INFO] El puerto 5050 ya se encuentra activo. No se requiere iniciar otra instancia."
    exit 0
}

# 4. Verificar que exista la compilación de producción (.next/BUILD_ID)
$BuildIdFile = Join-Path $ProjectRoot ".next\BUILD_ID"
if (-not (Test-Path $BuildIdFile)) {
    Write-StartupLog "Compilación .next no encontrada. Ejecutando pnpm build..."
    cmd.exe /c "pnpm build >> `"$LogFile`" 2>&1"
}

# 5. Iniciar el servidor de producción en el puerto 5050
Write-StartupLog "Iniciando servidor de producción Next.js en 0.0.0.0:5050..."
cmd.exe /c "pnpm start >> `"$LogFile`" 2>&1"

