# install.ps1 — Install Orc as a standalone binary (no Node.js needed)
#
# Usage:
#   irm https://github.com/aasm3535/orc/raw/master/install.ps1 | iex
#
# Or download directly:
#   Invoke-WebRequest -Uri https://github.com/aasm3535/orc/releases/latest/download/orc-win-x64.exe -OutFile "$env:USERPROFILE\.local\bin\orc.exe"

param()

$Repo = "aasm3535/orc"
$Binary = "orc.exe"

# ── Detect architecture ──
$Arch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture
if ($Arch -match "X64|AMD64") {
    $Platform = "win-x64"
} elseif ($Arch -match "Arm64") {
    $Platform = "win-arm64"
} else {
    Write-Host "Unsupported architecture: $Arch" -ForegroundColor Red
    exit 1
}

$FileName = "orc-$Platform.exe"
$Url = "https://github.com/$Repo/releases/latest/download/$FileName"

# ── Install directory ──
$BinDir = "$env:USERPROFILE\.local\bin"
if (-not (Test-Path $BinDir)) {
    New-Item -ItemType Directory -Path $BinDir -Force | Out-Null
}

$Target = Join-Path $BinDir $Binary

# ── Download ──
Write-Host ""
Write-Host "  -- Orc Installer --" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Platform: $Platform"
Write-Host "  Binary:   $FileName"
Write-Host "  Install:  $Target"
Write-Host ""
Write-Host "  Downloading..." -ForegroundColor Yellow

try {
    Invoke-WebRequest -Uri $Url -OutFile $Target -UseBasicParsing
} catch {
    Write-Host "  Error: Failed to download from $Url" -ForegroundColor Red
    Write-Host "  $_"
    exit 1
}

# ── Verify ──
if (Test-Path $Target) {
    $Version = & $Target --version 2>$null
    if ($LASTEXITCODE -eq 0 -and $Version) {
        Write-Host "  OK Orc v$Version installed to $Target" -ForegroundColor Green
    } else {
        Write-Host "  OK Binary installed to $Target" -ForegroundColor Green
        Write-Host "    Try: orc --help" -ForegroundColor Dim
    }
} else {
    Write-Host "  Error: Download failed" -ForegroundColor Red
    exit 1
}

# ── PATH hint ──
$PathDirs = $env:PATH -split ";"
if ($BinDir -notin $PathDirs) {
    Write-Host ""
    Write-Host "  Add to PATH (current session):" -ForegroundColor Yellow
    Write-Host "    `$env:PATH += `";$BinDir`"" -ForegroundColor White
    Write-Host ""
    Write-Host "  Add to PATH (permanent):" -ForegroundColor Yellow
    Write-Host "    [Environment]::SetEnvironmentVariable('PATH', `$env:PATH + `";$BinDir`", 'User')" -ForegroundColor White
}

Write-Host ""
