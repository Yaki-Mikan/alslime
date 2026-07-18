param(
    [string]$Version = "0.1.0-dev",
    # Entitlement token verification keys embedded into the app (Phase D).
    # Format: "kid:hexPublicKey,kid2:hexPublicKey" (genkey output of alslime-server).
    [string]$EntitlementKeys = "",
    [ValidateSet("windows", "linux")]
    [string]$TargetOS = "windows",
    [ValidateSet("amd64", "arm64")]
    [string]$TargetArch = "amd64",
    # Public (internet-facing) build. Compiles with -tags public so the binary
    # REFUSES to start without FIREBASE_PROJECT_ID (fail-closed), and bakes the
    # Firebase client config from frontend/.env.public.local via `vite --mode public`
    # so a local build can never accidentally embed (or omit) the auth gate.
    [switch]$Public,
    # Release builds are ALWAYS obfuscated with garble by default. This is a
    # security requirement: without garble, core analysis-derived literals
    # (system prompts, native-history markers, internal CLI strings) appear in
    # the binary as plaintext and can be extracted with a single `strings` pass.
    # Pass -NoGarble ONLY for local diagnostics; never ship a -NoGarble build.
    [switch]$NoGarble,
    [switch]$KeepCache,
    # Also build the ComfyUI sidecar module (alslime-core/cmd/comfymodule).
    # Deploy it as <WORKSPACE_ROOT>/modules/alslime-comfy(.exe).
    [switch]$BuildModule,
    # Also build the action-choice sidecar module (alslime-core/cmd/actionchoicemodule).
    # Deploy it as <WORKSPACE_ROOT>/modules/alslime-actionchoice(.exe).
    [switch]$BuildActionChoiceModule
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$AlslimeRoot = Resolve-Path (Join-Path $ScriptDir "..")
$WorkspaceRoot = Resolve-Path (Join-Path $AlslimeRoot "..")
$FrontendRoot = Join-Path $AlslimeRoot "frontend"
$OutputDir = Join-Path $AlslimeRoot "build\release"
$GoCacheDir = Join-Path $AlslimeRoot ".gocache"
$GoTmpDir = Join-Path $AlslimeRoot ".gotmp"

function Get-CommitHash {
    try {
        $commit = git -C $WorkspaceRoot rev-parse --short HEAD 2>$null
        if ($LASTEXITCODE -eq 0) {
            return $commit.Trim()
        }
    } catch {
        return ""
    }
    return ""
}

function Get-OutputPath {
    $name = "alslime-$Version-$TargetOS-$TargetArch"
    if ($Public) {
        # Distinguish public binaries so a local build can never be deployed by mistake.
        $name = "$name-public"
    }
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

Write-Host "[release] frontend build"
if (-not (Test-Path -LiteralPath (Join-Path $FrontendRoot "node_modules"))) {
    throw "alslime/frontend dependencies are missing. Run npm ci in alslime/frontend first."
}
Push-Location $FrontendRoot
try {
    $npm = Get-NpmCommand
    if ($Public) {
        # Public build: the Firebase client config is REQUIRED. It lives only in
        # .env.public.local (loaded exclusively by `vite --mode public`), so it can
        # never leak into a local build, and a public build fails loudly without it.
        $publicEnv = Join-Path $FrontendRoot ".env.public.local"
        if (-not (Test-Path -LiteralPath $publicEnv)) {
            throw "frontend/.env.public.local not found. Copy deploy/lightsail/frontend.env.public.example there and fill in the VITE_FIREBASE_* values."
        }
        $publicEnvText = Get-Content -LiteralPath $publicEnv -Raw
        if ($publicEnvText -notmatch "(?m)^VITE_FIREBASE_API_KEY=\S" -or $publicEnvText -match "<") {
            throw "frontend/.env.public.local is incomplete: VITE_FIREBASE_API_KEY missing or '<...>' placeholders left."
        }
        & $npm run build -- --mode public --outDir "../internal/frontend/dist_release"
    } else {
        # Build only alslime/frontend for the embedded release frontend.
        & $npm run build -- --outDir "../internal/frontend/dist_release"
    }
    # $ErrorActionPreference does not catch native exit codes; check explicitly.
    if ($LASTEXITCODE -ne 0) {
        throw "frontend build failed (exit $LASTEXITCODE)"
    }
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

$commit = Get-CommitHash
$ldflags = @(
    "-s",
    "-w",
    "-X", "alslime/internal/buildinfo.version=$Version",
    "-X", "alslime/internal/buildinfo.buildMode=release"
)
if ($commit -ne "") {
    $ldflags += @("-X", "alslime/internal/buildinfo.commit=$commit")
}
if ($EntitlementKeys -ne "") {
    # Tier is no longer build-embedded; features unlock via signed entitlement tokens.
    $ldflags += @("-X", "alslime/core/featuresimpl.embeddedPublicKeys=$EntitlementKeys")
}
$ldflagsText = $ldflags -join " "
$outputPath = Get-OutputPath

$useGarble = -not $NoGarble
if ($useGarble -and -not (Get-Command garble -ErrorAction SilentlyContinue)) {
    # Do NOT silently fall back to a plaintext build. A release binary built
    # without garble leaks core analysis-derived literals. Fail loudly instead.
    throw "garble not found. Install it (go install mvdan.cc/garble@latest) or pass -NoGarble explicitly for a diagnostic (non-shippable) build."
}
if ($NoGarble) {
    Write-Warning "[release] -NoGarble specified: core literals will be PLAINTEXT. Diagnostic build only. Do NOT distribute."
}

$buildTags = "release"
if ($Public) {
    $buildTags = "release,public"
}

Write-Host "[release] backend build: $TargetOS/$TargetArch (garble=$useGarble, public=$([bool]$Public))"
Push-Location $AlslimeRoot
try {
    if ($useGarble) {
        garble -literals -tiny -seed=random build -tags $buildTags -trimpath -buildvcs=false -ldflags $ldflagsText -o $outputPath ./cmd/app
    } else {
        go build -tags $buildTags -trimpath -buildvcs=false -ldflags $ldflagsText -o $outputPath ./cmd/app
    }
    # Fail loudly: without this check a compile failure would still print
    # "[release] output:" and leave a stale/absent binary undetected.
    if ($LASTEXITCODE -ne 0) {
        throw "backend build failed (exit $LASTEXITCODE)"
    }
} finally {
    Pop-Location
}

if ($BuildModule) {
    # Sidecar module (lives in the core repository). Pure Go, same OS/ARCH as the app.
    $CoreRoot = Join-Path $WorkspaceRoot "alslime-core"
    if (-not (Test-Path -LiteralPath (Join-Path $CoreRoot "cmd\comfymodule"))) {
        throw "alslime-core/cmd/comfymodule not found. Place the core repository next to alslime."
    }
    $moduleName = "alslime-comfy-$Version-$TargetOS-$TargetArch"
    if ($TargetOS -eq "windows") {
        $moduleName = "$moduleName.exe"
    }
    $modulePath = Join-Path $OutputDir $moduleName
    Write-Host "[release] module build: $TargetOS/$TargetArch (garble=$useGarble)"
    Push-Location $CoreRoot
    try {
        if ($useGarble) {
            garble -literals -tiny -seed=random build -trimpath -buildvcs=false -ldflags "-s -w" -o $modulePath ./cmd/comfymodule
        } else {
            go build -trimpath -buildvcs=false -ldflags "-s -w" -o $modulePath ./cmd/comfymodule
        }
        if ($LASTEXITCODE -ne 0) {
            throw "module build failed (exit $LASTEXITCODE)"
        }
    } finally {
        Pop-Location
    }
    Write-Host "[release] module output: $modulePath"
    Write-Host "[release] deploy hint: copy as <WORKSPACE_ROOT>/modules/alslime-comfy$(if ($TargetOS -eq 'windows') { '.exe' })"
}

if ($BuildActionChoiceModule) {
    # Action-choice sidecar module (lives in the core repository). Pure Go, same OS/ARCH as the app.
    $CoreRoot = Join-Path $WorkspaceRoot "alslime-core"
    if (-not (Test-Path -LiteralPath (Join-Path $CoreRoot "cmd\actionchoicemodule"))) {
        throw "alslime-core/cmd/actionchoicemodule not found. Place the core repository next to alslime."
    }
    $acModuleName = "alslime-actionchoice-$Version-$TargetOS-$TargetArch"
    if ($TargetOS -eq "windows") {
        $acModuleName = "$acModuleName.exe"
    }
    $acModulePath = Join-Path $OutputDir $acModuleName
    Write-Host "[release] action-choice module build: $TargetOS/$TargetArch (garble=$useGarble)"
    Push-Location $CoreRoot
    try {
        if ($useGarble) {
            garble -literals -tiny -seed=random build -trimpath -buildvcs=false -ldflags "-s -w" -o $acModulePath ./cmd/actionchoicemodule
        } else {
            go build -trimpath -buildvcs=false -ldflags "-s -w" -o $acModulePath ./cmd/actionchoicemodule
        }
        if ($LASTEXITCODE -ne 0) {
            throw "action-choice module build failed (exit $LASTEXITCODE)"
        }
    } finally {
        Pop-Location
    }
    Write-Host "[release] action-choice module output: $acModulePath"
    Write-Host "[release] deploy hint: copy as <WORKSPACE_ROOT>/modules/alslime-actionchoice$(if ($TargetOS -eq 'windows') { '.exe' })"
}

if (-not $KeepCache) {
    Remove-Item -LiteralPath $GoCacheDir -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $GoTmpDir -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host "[release] output: $outputPath"
