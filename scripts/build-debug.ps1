param(
    [string]$Version = "0.1.0-dev",
    # Entitlement token verification keys embedded into the app (Phase D).
    # Format: "kid:hexPublicKey,kid2:hexPublicKey" (genkey output of alslime-server).
    [string]$EntitlementKeys = "",
    [ValidateSet("windows", "linux")]
    [string]$TargetOS = "windows",
    [ValidateSet("amd64", "arm64")]
    [string]$TargetArch = "amd64",
    [switch]$KeepCache,
    # Also build the ComfyUI sidecar module (for sidecar-mode verification).
    [switch]$BuildModule
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$AlslimeRoot = Resolve-Path (Join-Path $ScriptDir "..")
$FrontendRoot = Join-Path $AlslimeRoot "frontend"
$OutputDir = Join-Path $AlslimeRoot "build\debug"
$GoCacheDir = Join-Path $AlslimeRoot ".gocache"
$GoTmpDir = Join-Path $AlslimeRoot ".gotmp"

function Get-OutputPath {
    $name = "alslime-$Version-debug-$TargetOS-$TargetArch"
    if ($TargetOS -eq "windows") {
        $name = "$name.exe"
    }
    return Join-Path $OutputDir $name
}

function Get-NpmCommand {
    if (Get-Command "npm.cmd" -ErrorAction SilentlyContinue) {
        return "npm.cmd"
    }
    return "npm"
}

Write-Host "[debug] frontend build"
if (-not (Test-Path -LiteralPath (Join-Path $FrontendRoot "node_modules"))) {
    throw "alslime/frontend dependencies are missing. Run npm ci in alslime/frontend first."
}
Push-Location $FrontendRoot
try {
    $npm = Get-NpmCommand
    # Build only alslime/frontend for the embedded debug frontend.
    & $npm run build -- --mode development --outDir "../internal/frontend/dist_debug"
} finally {
    Pop-Location
}

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
New-Item -ItemType Directory -Force -Path $GoCacheDir | Out-Null
New-Item -ItemType Directory -Force -Path $GoTmpDir | Out-Null

$env:GOCACHE = $GoCacheDir
$env:GOTMPDIR = $GoTmpDir
$env:GOOS = $TargetOS
$env:GOARCH = $TargetArch
$env:CGO_ENABLED = "0"

$ldflags = @(
    "-X", "alslime/internal/buildinfo.version=$Version",
    "-X", "alslime/internal/buildinfo.buildMode=debug"
)
if ($EntitlementKeys -ne "") {
    # Tier is no longer build-embedded; features unlock via signed entitlement tokens.
    $ldflags += @("-X", "alslime/core/featuresimpl.embeddedPublicKeys=$EntitlementKeys")
}
$ldflagsText = $ldflags -join " "
$outputPath = Get-OutputPath

Write-Host "[debug] backend build: $TargetOS/$TargetArch"
Push-Location $AlslimeRoot
try {
    go build -tags debug -buildvcs=false -ldflags $ldflagsText -o $outputPath ./cmd/app
} finally {
    Pop-Location
}

if ($BuildModule) {
    # Sidecar module (lives in the core repository).
    $CoreRoot = Resolve-Path (Join-Path $AlslimeRoot "..\alslime-core")
    $moduleName = "alslime-comfy-$Version-debug-$TargetOS-$TargetArch"
    if ($TargetOS -eq "windows") {
        $moduleName = "$moduleName.exe"
    }
    $modulePath = Join-Path $OutputDir $moduleName
    Write-Host "[debug] module build: $TargetOS/$TargetArch"
    Push-Location $CoreRoot
    try {
        go build -buildvcs=false -o $modulePath ./cmd/comfymodule
    } finally {
        Pop-Location
    }
    Write-Host "[debug] module output: $modulePath"
}

if (-not $KeepCache) {
    Remove-Item -LiteralPath $GoCacheDir -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $GoTmpDir -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host "[debug] output: $outputPath"
