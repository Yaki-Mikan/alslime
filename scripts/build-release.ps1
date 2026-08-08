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
    # Release builds obfuscate only the private alslime-core module.
    # Public packages, the Go runtime, and third-party dependencies stay untouched.
    # Pass -NoGarble only for local diagnostics; never ship a -NoGarble build.
    [switch]$NoGarble,
    # Enable tiny only for legacy comparison builds. The release default is off.
    [switch]$Tiny,
    [switch]$KeepCache,
    # Also build the ComfyUI sidecar module (alslime-core/cmd/comfymodule).
    # Deploy it as <WORKSPACE_ROOT>/modules/alslime-comfy(.exe).
    [switch]$BuildModule,
    # Also build the action-choice sidecar module (alslime-core/cmd/actionchoicemodule).
    # Deploy it as <WORKSPACE_ROOT>/modules/alslime-actionchoice(.exe).
    [switch]$BuildActionChoiceModule,
    # Package the release archive for GitHub Releases (ファイル自動更新、確認 01番 10章).
    # Windows は zip、Linux は tar.gz（Unix 実行権限を保持するため）。どちらも
    # バイナリを固定名 (alslime-<ver>/alslime(.exe)) で格納するので、アプリ内
    # アップデートでユーザーのショートカットが壊れない。SHA256SUMS.txt も生成する。
    # アーカイブと SHA256SUMS.txt の両方を Release アセットとしてアップロードする。
    [switch]$Package
)

$ErrorActionPreference = "Stop"

# -Package の前提はビルド前（冒頭）で検証する（交換日記 005-6）。
# Version は exe 名・package ディレクトリ・zip 名・Remove-Item 対象に直接使われるため、
# パス区切りや ".." を含む値を拒否する。先頭 v も拒否（GitHub タグはクライアント側で
# v 無しへ正規化されるので、v 付きだと自動リロード判定と zip 名の照合が壊れる）。
if ($Package) {
    if ($Public) {
        # Public builds are for the Lightsail server deployment, never for the
        # downloadable zip. Fail loudly instead of shipping the wrong binary.
        throw "-Package cannot be combined with -Public. Package the local (non-public) release build."
    }
    if ($Version -notmatch '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$') {
        throw "-Package requires Version in X.Y.Z form (no leading 'v', no path characters). Got: '$Version'"
    }
}

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

function Get-CoreGarblePattern {
    $coreGoMod = Join-Path $WorkspaceRoot "alslime-core\go.mod"
    if (-not (Test-Path -LiteralPath $coreGoMod)) {
        throw "alslime-core/go.mod not found. Place the core repository next to alslime."
    }

    $moduleLine = Get-Content -LiteralPath $coreGoMod -Encoding UTF8 |
        Where-Object { $_ -match "^\s*module\s+\S+\s*$" } |
        Select-Object -First 1
    if (-not $moduleLine -or $moduleLine -notmatch "^\s*module\s+(\S+)\s*$") {
        throw "alslime-core/go.mod does not contain a valid module declaration."
    }
    return $Matches[1]
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

$previousGoGarble = $env:GOGARBLE

try {
$CoreGarblePattern = Get-CoreGarblePattern
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
$useTiny = [bool]$Tiny
if ($useGarble -and -not (Get-Command garble -ErrorAction SilentlyContinue)) {
    # Do NOT silently fall back to a plaintext build. A release binary built
    # without garble leaks core analysis-derived literals. Fail loudly instead.
    throw "garble not found. Install it (go install mvdan.cc/garble@latest) or pass -NoGarble explicitly for a diagnostic (non-shippable) build."
}
if ($NoGarble) {
    Write-Warning "[release] -NoGarble specified: core literals will be PLAINTEXT. Diagnostic build only. Do NOT distribute."
} else {
    $env:GOGARBLE = $CoreGarblePattern
}

$buildTags = "release"
if ($Public) {
    # Lightsail（自前サーバー）向けのみ、画像生成の in-process 実装を内蔵する。
    # 配布ビルド（タグ無し）はサイドカーモジュール経由のみとなる。
    $buildTags = "release,public,comfyembed"
}

Write-Host "[release] backend build: $TargetOS/$TargetArch (garble=$useGarble, scope=$CoreGarblePattern, tiny=$useTiny, public=$([bool]$Public))"
Push-Location $AlslimeRoot
try {
    # ビルド前の依存グラフ検証: 配布ビルドに画像生成の in-process 実装
    # （alslime/core/comfyui）が混入していないこと、逆に -Public（Lightsail）
    # ビルドには内蔵されていることを両向きで確認する。タグ指定ミスが
    # どちらの方向にも黙って通らないようにする。
    $comfyDeps = go list -deps -tags $buildTags ./cmd/app | Select-String -SimpleMatch "alslime/core/comfyui"
    if ($LASTEXITCODE -ne 0) {
        throw "go list -deps failed (exit $LASTEXITCODE)"
    }
    if ($Public) {
        if (-not $comfyDeps) {
            throw "public (Lightsail) build must embed in-process image generation, but alslime/core/comfyui is missing from the dependency graph (comfyembed tag lost?)"
        }
    } elseif ($comfyDeps) {
        throw "distribution build must NOT embed in-process image generation, but the dependency graph contains: $(($comfyDeps | ForEach-Object { $_.Line }) -join ', ')"
    }
    if ($useGarble) {
        $garbleArgs = @("-literals")
        if ($useTiny) {
            $garbleArgs += "-tiny"
        }
        $garbleArgs += @("-seed=random", "build")
        & garble @garbleArgs -tags $buildTags -trimpath -buildvcs=false -ldflags $ldflagsText -o $outputPath ./cmd/app
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

# Module ldflags: modules must carry the release build mode (and the embedded
# verification keys) or the startup entitlement check would be silently skipped.
# Fail-close: never ship a module built without the release mode injection.
$moduleLdflags = @(
    "-s",
    "-w",
    "-X", "alslime/internal/buildinfo.buildMode=release"
)
if ($EntitlementKeys -ne "") {
    $moduleLdflags += @("-X", "alslime/core/featuresimpl.embeddedPublicKeys=$EntitlementKeys")
} elseif ($BuildModule -or $BuildActionChoiceModule) {
    Write-Warning "[release] -EntitlementKeys not set: module binaries will have no embedded keys and reject ALL tokens at startup."
}
$moduleLdflagsText = $moduleLdflags -join " "

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
    Write-Host "[release] module build: $TargetOS/$TargetArch (garble=$useGarble, tiny=$useTiny)"
    Push-Location $CoreRoot
    try {
        if ($useGarble) {
            $garbleArgs = @("-literals")
            if ($useTiny) {
                $garbleArgs += "-tiny"
            }
            $garbleArgs += @("-seed=random", "build")
            & garble @garbleArgs -trimpath -buildvcs=false -ldflags $moduleLdflagsText -o $modulePath ./cmd/comfymodule
        } else {
            go build -trimpath -buildvcs=false -ldflags $moduleLdflagsText -o $modulePath ./cmd/comfymodule
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
    Write-Host "[release] action-choice module build: $TargetOS/$TargetArch (garble=$useGarble, tiny=$useTiny)"
    Push-Location $CoreRoot
    try {
        if ($useGarble) {
            $garbleArgs = @("-literals")
            if ($useTiny) {
                $garbleArgs += "-tiny"
            }
            $garbleArgs += @("-seed=random", "build")
            & garble @garbleArgs -trimpath -buildvcs=false -ldflags $moduleLdflagsText -o $acModulePath ./cmd/actionchoicemodule
        } else {
            go build -trimpath -buildvcs=false -ldflags $moduleLdflagsText -o $acModulePath ./cmd/actionchoicemodule
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

if ($Package) {
    $pkgName = "alslime-$Version"
    $pkgDir = Join-Path $OutputDir $pkgName
    # 多層防御: Version は冒頭で検証済みだが、削除・上書きの前に出力先が
    # build\release 直下から出ていないことを絶対パスで確認する（交換日記 005-6）。
    $outFull = [System.IO.Path]::GetFullPath($OutputDir) + [System.IO.Path]::DirectorySeparatorChar
    $pkgDirFull = [System.IO.Path]::GetFullPath($pkgDir)
    if (-not $pkgDirFull.StartsWith($outFull)) {
        throw "package dir escapes the build output dir: $pkgDirFull"
    }
    if (Test-Path -LiteralPath $pkgDir) {
        Remove-Item -LiteralPath $pkgDir -Recurse -Force
    }
    New-Item -ItemType Directory -Force -Path $pkgDir | Out-Null

    # Fixed executable name inside the zip (01番 R6): shortcuts keep working across
    # updates, and the in-app updater looks for exactly this name.
    $fixedExe = "alslime"
    if ($TargetOS -eq "windows") {
        $fixedExe = "$fixedExe.exe"
    }
    Copy-Item -LiteralPath $outputPath -Destination (Join-Path $pkgDir $fixedExe)
    foreach ($doc in @("EULA.md", "EULA.en.md", "LICENSE.md", "README.md", "README.en.md", "THIRD-PARTY-NOTICES.md")) {
        Copy-Item -LiteralPath (Join-Path $AlslimeRoot $doc) -Destination $pkgDir
    }

    # アーカイブ形式は OS で分ける。zip は Unix の実行権限を保持できないため、
    # Linux は tar.gz とし、cmd/mkdisttar がヘッダへ権限（alslime のみ 0755）を
    # 明示して生成する。展開だけでそのまま実行できる。
    if ($TargetOS -eq "windows") {
        $archiveName = "alslime-$Version-$TargetOS-$TargetArch.zip"
    } else {
        $archiveName = "alslime-$Version-$TargetOS-$TargetArch.tar.gz"
    }
    $archivePath = Join-Path $OutputDir $archiveName
    $archiveFull = [System.IO.Path]::GetFullPath($archivePath)
    if (-not $archiveFull.StartsWith($outFull)) {
        throw "archive path escapes the build output dir: $archiveFull"
    }
    if (Test-Path -LiteralPath $archivePath) {
        Remove-Item -LiteralPath $archivePath -Force
    }
    if ($TargetOS -eq "windows") {
        Compress-Archive -Path $pkgDir -DestinationPath $archivePath
    } else {
        # mkdisttar はホスト側で動かすツールなので、クロスビルド用の
        # GOOS/GOARCH を go run の間だけ外し、終わったら必ず戻す。
        $prevGoos = $env:GOOS
        $prevGoarch = $env:GOARCH
        $env:GOOS = ""
        $env:GOARCH = ""
        try {
            Push-Location $AlslimeRoot
            try {
                go run ./cmd/mkdisttar -src $pkgDir -out $archivePath -exe $fixedExe
            } finally {
                Pop-Location
            }
            if ($LASTEXITCODE -ne 0) {
                throw "mkdisttar failed (exit $LASTEXITCODE)"
            }
        } finally {
            $env:GOOS = $prevGoos
            $env:GOARCH = $prevGoarch
        }
    }
    Remove-Item -LiteralPath $pkgDir -Recurse -Force

    # SHA256SUMS.txt: アプリ内アップデータがこのアセットを取得し、アーカイブの
    # ハッシュをファイル名で照合してから差し替える（Go 側は全行を
    # 「ファイル名→ハッシュ」で読む）。ASCII（BOM 無し）を維持する。
    # マルチ OS リリースは OS 毎に本スクリプトを 1 回ずつ実行するため、単純上書きに
    # すると後の実行が先の OS の行を消す。同一バージョンの他アーカイブの行だけ保持し、
    # 別バージョンの行と今回アーカイブ自身の旧行は破棄する。
    $hash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLower()
    $sumsPath = Join-Path $OutputDir "SHA256SUMS.txt"
    $keptLines = @()
    if (Test-Path -LiteralPath $sumsPath) {
        $sameVersionPrefix = [regex]::Escape("alslime-$Version-")
        $selfName = [regex]::Escape($archiveName)
        $keptLines = @(Get-Content -LiteralPath $sumsPath | Where-Object {
            $_ -match "^[0-9a-f]{64}  $sameVersionPrefix\S+\.(zip|tar\.gz)\s*$" -and $_ -notmatch "  $selfName\s*$"
        })
    }
    @($keptLines + "$hash  $archiveName") | Out-File -LiteralPath $sumsPath -Encoding ascii
    Write-Host "[release] package: $archivePath"
    Write-Host "[release] sums:    $sumsPath"
    Write-Host "[release] upload BOTH files as release assets (in-app update requires SHA256SUMS.txt)"
}

Write-Host "[release] output: $outputPath"
} finally {
    if ($null -eq $previousGoGarble) {
        Remove-Item Env:GOGARBLE -ErrorAction SilentlyContinue
    } else {
        $env:GOGARBLE = $previousGoGarble
    }
    if (-not $KeepCache) {
        Remove-Item -LiteralPath $GoCacheDir -Recurse -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath $GoTmpDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}
