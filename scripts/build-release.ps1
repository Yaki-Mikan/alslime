param(
    [string]$Version = "0.1.0-dev",
    # Entitlement token verification keys embedded into the app (Phase D).
    # Format: "kid:hexPublicKey,kid2:hexPublicKey" (genkey output of alslime-server).
    [string]$EntitlementKeys = "",
    # Download-manifest verification keys embedded into the app (same format as
    # EntitlementKeys, but a separate key table: the manifest signing key lives on
    # the publishing PC and must never be able to sign entitlement tokens).
    # Required: without it the app cannot verify the download list, so the script stops before building.
    [string]$ManifestKeys = "",
    # Optional source revision supplied by the caller. The build script never runs git.
    [ValidatePattern('^$|^[0-9A-Fa-f]{7,64}$')]
    [string]$Commit = "",
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
    # Also build the TTS sidecar module (alslime-core/cmd/ttsmodule).
    # Deploy it as <WORKSPACE_ROOT>/modules/alslime-tts(.exe).
    [switch]$BuildTTSModule,
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

# 検証鍵の指定（kid:hex 公開鍵のカンマ区切り）の前提もビルド前に検証する。
#
# 配布ファイル一覧の検証鍵（ManifestKeys）は常に必須。release ビルドは検証鍵を環境変数から
# 読まないため、埋め込みが無い本体は一覧の署名確認に必ず失敗し、サイドカーの導入・更新・
# クリーン再導入と支援者向けパックの取得がすべて使えなくなる。このスクリプトの成果物は
# どの指定でも配布物と同じ名前の release ビルドになり、鍵なしで作られたかどうかを後から
# 見分けられないため、鍵なしで通る経路は設けない。
#
# 同じ kid の重複は、公開鍵が同じでも拒否する。本体は後ろの指定で黙って上書きするため、
# 鍵の入れ替えで kid を変え忘れると、片方の鍵しか埋め込まれない本体ができてしまう。
function Assert-NoDuplicateKeyId([string]$ParameterName, [string]$Spec) {
    $seen = @{}
    foreach ($entry in $Spec.Split(',')) {
        $parts = $entry.Trim().Split(':', 2)
        if ($parts.Count -lt 2) { continue }
        $kid = $parts[0].Trim()
        if ($kid -eq '') { continue }
        if ($seen.ContainsKey($kid)) {
            throw "-$ParameterName lists the key id '$kid' more than once. Each key id must appear exactly once (the app silently keeps only the last one)."
        }
        $seen[$kid] = $true
    }
}
$ManifestKeySpecPattern = '^[0-9A-Za-z._-]+:[0-9A-Fa-f]{64}(,[0-9A-Za-z._-]+:[0-9A-Fa-f]{64})*$'
if ($ManifestKeys -eq "") {
    throw "-ManifestKeys is required. Without it the app cannot verify the download list, so sidecar install/update/clean-reinstall and sponsor packs all fail."
}
if ($ManifestKeys -notmatch $ManifestKeySpecPattern) {
    throw "-ManifestKeys must be comma-separated 'kid:hexPublicKey' pairs (64 hex chars each, no spaces)."
}
Assert-NoDuplicateKeyId 'ManifestKeys' $ManifestKeys
if ($EntitlementKeys -ne "") {
    Assert-NoDuplicateKeyId 'EntitlementKeys' $EntitlementKeys
}

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$AlslimeRoot = Resolve-Path (Join-Path $ScriptDir "..")
$WorkspaceRoot = Resolve-Path (Join-Path $AlslimeRoot "..")
$FrontendRoot = Join-Path $AlslimeRoot "frontend"
$OutputDir = Join-Path $AlslimeRoot "build\release"
$GoCacheDir = Join-Path $AlslimeRoot ".gocache"
$GoTmpDir = Join-Path $AlslimeRoot ".gotmp"
$GarbleCacheDir = Join-Path $AlslimeRoot ".garble-cache"
. (Join-Path $ScriptDir 'release-metadata.ps1')

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
New-Item -ItemType Directory -Force -Path $GarbleCacheDir | Out-Null

$previousGarbleCache = [Environment]::GetEnvironmentVariable(
    'GARBLE_CACHE',
    [EnvironmentVariableTarget]::Process
)
$env:GOCACHE = $GoCacheDir
$env:GOTMPDIR = $GoTmpDir
$env:GARBLE_CACHE = $GarbleCacheDir
$env:GOOS = $TargetOS
$env:GOARCH = $TargetArch
$env:CGO_ENABLED = "0"

$previousGoGarble = $env:GOGARBLE

# Windows VERSIONINFO / manifest. Unsigned executables with no version resource
# are a common heuristic trigger for AV vendors, so every distributed Windows
# executable embeds its product metadata from <cmd>/winres/winres.json.
# The generated .syso files are removed after each build and Linux skips this.
function Invoke-WindowsResource([string]$CmdDir, [string]$Label) {
    if ($TargetOS -ne "windows") {
        return
    }
    $winresJson = Join-Path $CmdDir "winres\winres.json"
    if (-not (Test-Path -LiteralPath $winresJson)) {
        throw "$Label`: winres/winres.json not found ($winresJson). Windows executables must carry version info."
    }
    if (-not (Get-Command go-winres -ErrorAction SilentlyContinue)) {
        throw "go-winres not found. Install with: go install github.com/tc-hib/go-winres@latest"
    }
    # go-winres accepts only numeric X.Y.Z(.W); strip any pre-release suffix.
    $numericVersion = "0.0.0"
    if ($Version -match '^([0-9]+\.[0-9]+\.[0-9]+)') {
        $numericVersion = $Matches[1]
    }
    Push-Location $CmdDir
    try {
        & go-winres make --in $winresJson --out rsrc --product-version $numericVersion --file-version $numericVersion
        if ($LASTEXITCODE -ne 0) {
            throw "$Label`: go-winres make failed (exit $LASTEXITCODE)"
        }
    } finally {
        Pop-Location
    }
    Write-Host "[release] $Label`: version resource embedded (version=$numericVersion)"
}

function Remove-WindowsResource([string]$CmdDir) {
    Get-ChildItem -LiteralPath $CmdDir -Filter "rsrc_*.syso" -ErrorAction SilentlyContinue | Remove-Item -Force
}

function Test-WindowsReleaseMetadata(
    [string]$BinaryPath,
    [string]$CmdDir,
    [psobject]$MetadataBundle
) {
    $winresJson = Join-Path $CmdDir 'winres\winres.json'
    $winresConfig = Get-Content -LiteralPath $winresJson -Raw -Encoding UTF8 |
        ConvertFrom-Json
    $expectedInfo = $winresConfig.RT_VERSION.'#1'.'0000'.info.'0409'
    $numericVersion = ([regex]::Match($Version, '^(\d+\.\d+\.\d+)')).Groups[1].Value
    $versionInfo = (Get-Item -LiteralPath $BinaryPath).VersionInfo
    $expectedFields = [ordered]@{
        FileVersion = $numericVersion
        ProductVersion = $numericVersion
        CompanyName = [string]$MetadataBundle.Metadata.companyName
        ProductName = [string]$MetadataBundle.Metadata.productName
        FileDescription = [string]$MetadataBundle.Metadata.fileDescription
        InternalName = [string]$MetadataBundle.Metadata.componentId
        OriginalFilename = [string]$MetadataBundle.Metadata.originalFilename
    }
    foreach ($entry in $expectedFields.GetEnumerator()) {
        $actualValue = $versionInfo.PSObject.Properties[$entry.Key].Value
        if ([string]$actualValue -ne [string]$entry.Value) {
            throw "Windows metadata mismatch: $($entry.Key)=$actualValue (expected: $($entry.Value))"
        }
    }
    if ([string]$expectedInfo.InternalName -ne [string]$MetadataBundle.Metadata.componentId -or
        [string]$expectedInfo.OriginalFilename -ne [string]$MetadataBundle.Metadata.originalFilename) {
        throw "winres config and release metadata config disagree for $($MetadataBundle.Metadata.componentId)."
    }
}

function Test-ReleaseBinaryMetadata(
    [string]$BinaryPath,
    [string]$CmdDir,
    [psobject]$MetadataBundle
) {
    try {
        if ($TargetOS -eq 'windows') {
            Test-WindowsReleaseMetadata `
                -BinaryPath $BinaryPath `
                -CmdDir $CmdDir `
                -MetadataBundle $MetadataBundle
        } else {
            Test-LinuxReleaseMetadata `
                -BinaryPath $BinaryPath `
                -ExpectedMetadata $MetadataBundle.Metadata `
                -AlslimeRoot $AlslimeRoot | Out-Null
        }
    } catch {
        if (Test-Path -LiteralPath $BinaryPath -PathType Leaf) {
            Remove-Item -LiteralPath $BinaryPath -Force
        }
        throw
    }
}

function New-ModuleBuildSettings([string]$ComponentId) {
    $metadataBundle = New-ReleaseMetadataEnvelope `
        -ComponentId $ComponentId `
        -Version $Version `
        -TargetOS $TargetOS `
        -TargetArch $TargetArch
    $flags = @(
        '-s',
        '-w',
        '-X', "alslime/internal/buildinfo.version=$Version",
        '-X', 'alslime/internal/buildinfo.buildMode=release',
        '-X', "alslime/internal/buildinfo.metadataEnvelope=$($metadataBundle.Envelope)"
    )
    if ($TargetOS -eq 'linux') {
        $flags += @('-B', "0x$($metadataBundle.Metadata.gnuBuildId)")
    }
    if ($EntitlementKeys -ne '') {
        $flags += @('-X', "alslime/core/featuresimpl.embeddedPublicKeys=$EntitlementKeys")
    }
    return [pscustomobject]@{
        MetadataBundle = $metadataBundle
        LdflagsText = $flags -join ' '
    }
}

try {
$CoreGarblePattern = Get-CoreGarblePattern
$appMetadata = New-ReleaseMetadataEnvelope `
    -ComponentId 'alslime' `
    -Version $Version `
    -TargetOS $TargetOS `
    -TargetArch $TargetArch
$ldflags = @(
    "-s",
    "-w",
    "-X", "alslime/internal/buildinfo.version=$Version",
    "-X", "alslime/internal/buildinfo.buildMode=release",
    "-X", "alslime/internal/buildinfo.metadataEnvelope=$($appMetadata.Envelope)"
)
if ($TargetOS -eq 'linux') {
    $ldflags += @('-B', "0x$($appMetadata.Metadata.gnuBuildId)")
}
if ($Commit -ne "") {
    $ldflags += @("-X", "alslime/internal/buildinfo.commit=$Commit")
}
if ($EntitlementKeys -ne "") {
    # Tier is no longer build-embedded; features unlock via signed entitlement tokens.
    $ldflags += @("-X", "alslime/core/featuresimpl.embeddedPublicKeys=$EntitlementKeys")
}
if ($ManifestKeys -ne "") {
    $ldflags += @("-X", "alslime/core/featuresimpl.embeddedManifestPublicKeys=$ManifestKeys")
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
    # Lightsail（自前サーバー）向けのみ、画像生成と読み上げの in-process 実装を内蔵する。
    # 配布ビルド（タグ無し）はサイドカーモジュール経由のみとなる。
    $buildTags = "release,public,comfyembed,ttsembed"
}

Write-Host "[release] backend build: $TargetOS/$TargetArch (garble=$useGarble, scope=$CoreGarblePattern, tiny=$useTiny, public=$([bool]$Public))"
$appCmdDir = Join-Path $AlslimeRoot "cmd\app"
Push-Location $AlslimeRoot
try {
    Invoke-WindowsResource -CmdDir $appCmdDir -Label "app"
    # ビルド前の依存グラフ検証: 配布ビルドに画像生成・読み上げの in-process 実装
    # （alslime/core/comfyui・alslime/core/tts）が混入していないこと、逆に
    # -Public（Lightsail）ビルドには内蔵されていることを両向きで確認する。
    # タグ指定ミスがどちらの方向にも黙って通らないようにする。
    $appDeps = go list -deps -tags $buildTags ./cmd/app
    if ($LASTEXITCODE -ne 0) {
        throw "go list -deps failed (exit $LASTEXITCODE)"
    }
    # 判定は go list が返す import path の完全一致で行う（部分一致は別パッケージを巻き込む）。
    # 画像生成の in-process 実装: ComfyUI 連携本体・その API・タグ判定・容姿プロンプト作成。
    $imageGenPackages = @(
        "alslime/core/comfyui",
        "alslime/core/comfyuiapi",
        "alslime/core/providers/tagjudge",
        "alslime/core/providers/appearance"
    )
    # 読み上げの in-process 実装。
    $ttsPackages = @(
        "alslime/core/tts",
        "alslime/core/tts/latentpre"
    )
    $comfyDeps = @($appDeps | Where-Object { $imageGenPackages -contains $_ })
    $ttsDeps = @($appDeps | Where-Object { $ttsPackages -contains $_ })
    if ($Public) {
        $comfyMissing = @($imageGenPackages | Where-Object { $comfyDeps -notcontains $_ })
        if ($comfyMissing.Count -gt 0) {
            throw "public (Lightsail) build must embed in-process image generation, but the dependency graph lacks: $($comfyMissing -join ', ') (comfyembed tag lost?)"
        }
        $ttsMissing = @($ttsPackages | Where-Object { $ttsDeps -notcontains $_ })
        if ($ttsMissing.Count -gt 0) {
            throw "public (Lightsail) build must embed in-process TTS, but the dependency graph lacks: $($ttsMissing -join ', ') (ttsembed tag lost?)"
        }
    } else {
        if ($comfyDeps.Count -gt 0) {
            throw "distribution build must NOT embed in-process image generation, but the dependency graph contains: $($comfyDeps -join ', ')"
        }
        if ($ttsDeps.Count -gt 0) {
            throw "distribution build must NOT embed in-process TTS, but the dependency graph contains: $($ttsDeps -join ', ')"
        }
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
    Remove-WindowsResource -CmdDir $appCmdDir
    Pop-Location
}
Test-ReleaseBinaryMetadata `
    -BinaryPath $outputPath `
    -CmdDir $appCmdDir `
    -MetadataBundle $appMetadata

# Modules must carry release mode, release version, product metadata, GNU Build ID
# on Linux, and the entitlement verification keys.
if ($EntitlementKeys -eq "" -and ($BuildModule -or $BuildActionChoiceModule -or $BuildTTSModule)) {
    Write-Warning "[release] -EntitlementKeys not set: module binaries will have no embedded keys and reject ALL tokens at startup."
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
    Write-Host "[release] module build: $TargetOS/$TargetArch (garble=$useGarble, tiny=$useTiny)"
    $comfyCmdDir = Join-Path $CoreRoot "cmd\comfymodule"
    $comfyBuildSettings = New-ModuleBuildSettings -ComponentId 'alslime-comfy'
    Push-Location $CoreRoot
    try {
        Invoke-WindowsResource -CmdDir $comfyCmdDir -Label "comfy module"
        if ($useGarble) {
            $garbleArgs = @("-literals")
            if ($useTiny) {
                $garbleArgs += "-tiny"
            }
            $garbleArgs += @("-seed=random", "build")
            & garble @garbleArgs -trimpath -buildvcs=false -ldflags $comfyBuildSettings.LdflagsText -o $modulePath ./cmd/comfymodule
        } else {
            go build -trimpath -buildvcs=false -ldflags $comfyBuildSettings.LdflagsText -o $modulePath ./cmd/comfymodule
        }
        if ($LASTEXITCODE -ne 0) {
            throw "module build failed (exit $LASTEXITCODE)"
        }
    } finally {
        Remove-WindowsResource -CmdDir $comfyCmdDir
        Pop-Location
    }
    Test-ReleaseBinaryMetadata `
        -BinaryPath $modulePath `
        -CmdDir $comfyCmdDir `
        -MetadataBundle $comfyBuildSettings.MetadataBundle
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
    $actionChoiceCmdDir = Join-Path $CoreRoot 'cmd\actionchoicemodule'
    $actionChoiceBuildSettings = New-ModuleBuildSettings -ComponentId 'alslime-actionchoice'
    Push-Location $CoreRoot
    try {
        Invoke-WindowsResource -CmdDir $actionChoiceCmdDir -Label "action-choice module"
        if ($useGarble) {
            $garbleArgs = @("-literals")
            if ($useTiny) {
                $garbleArgs += "-tiny"
            }
            $garbleArgs += @("-seed=random", "build")
            & garble @garbleArgs -trimpath -buildvcs=false -ldflags $actionChoiceBuildSettings.LdflagsText -o $acModulePath ./cmd/actionchoicemodule
        } else {
            go build -trimpath -buildvcs=false -ldflags $actionChoiceBuildSettings.LdflagsText -o $acModulePath ./cmd/actionchoicemodule
        }
        if ($LASTEXITCODE -ne 0) {
            throw "action-choice module build failed (exit $LASTEXITCODE)"
        }
    } finally {
        Remove-WindowsResource -CmdDir $actionChoiceCmdDir
        Pop-Location
    }
    Test-ReleaseBinaryMetadata `
        -BinaryPath $acModulePath `
        -CmdDir $actionChoiceCmdDir `
        -MetadataBundle $actionChoiceBuildSettings.MetadataBundle
    Write-Host "[release] action-choice module output: $acModulePath"
    Write-Host "[release] deploy hint: copy as <WORKSPACE_ROOT>/modules/alslime-actionchoice$(if ($TargetOS -eq 'windows') { '.exe' })"
}

if ($BuildTTSModule) {
    # TTS sidecar module (lives in the core repository). Pure Go, same OS/ARCH as the app.
    $CoreRoot = Join-Path $WorkspaceRoot "alslime-core"
    if (-not (Test-Path -LiteralPath (Join-Path $CoreRoot "cmd\ttsmodule"))) {
        throw "alslime-core/cmd/ttsmodule not found. Place the core repository next to alslime."
    }
    $ttsModuleName = "alslime-tts-$Version-$TargetOS-$TargetArch"
    if ($TargetOS -eq "windows") {
        $ttsModuleName = "$ttsModuleName.exe"
    }
    $ttsModulePath = Join-Path $OutputDir $ttsModuleName
    Write-Host "[release] tts module build: $TargetOS/$TargetArch (garble=$useGarble, tiny=$useTiny)"
    $ttsCmdDir = Join-Path $CoreRoot "cmd\ttsmodule"
    $ttsBuildSettings = New-ModuleBuildSettings -ComponentId 'alslime-tts'
    Push-Location $CoreRoot
    try {
        Invoke-WindowsResource -CmdDir $ttsCmdDir -Label "tts module"
        if ($useGarble) {
            $garbleArgs = @("-literals")
            if ($useTiny) {
                $garbleArgs += "-tiny"
            }
            $garbleArgs += @("-seed=random", "build")
            & garble @garbleArgs -trimpath -buildvcs=false -ldflags $ttsBuildSettings.LdflagsText -o $ttsModulePath ./cmd/ttsmodule
        } else {
            go build -trimpath -buildvcs=false -ldflags $ttsBuildSettings.LdflagsText -o $ttsModulePath ./cmd/ttsmodule
        }
        if ($LASTEXITCODE -ne 0) {
            throw "tts module build failed (exit $LASTEXITCODE)"
        }
    } finally {
        Remove-WindowsResource -CmdDir $ttsCmdDir
        Pop-Location
    }
    Test-ReleaseBinaryMetadata `
        -BinaryPath $ttsModulePath `
        -CmdDir $ttsCmdDir `
        -MetadataBundle $ttsBuildSettings.MetadataBundle
    Write-Host "[release] tts module output: $ttsModulePath"
    Write-Host "[release] deploy hint: copy as <WORKSPACE_ROOT>/modules/alslime-tts$(if ($TargetOS -eq 'windows') { '.exe' })"
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
    # Windows は exe 自身がブラウザを開かないため、本体起動とブラウザ起動を
    # まとめて行う起動バッチを同梱する。
    if ($TargetOS -eq "windows") {
        Copy-Item -LiteralPath (Join-Path $AlslimeRoot "start-alslime.bat") -Destination $pkgDir
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
    [Environment]::SetEnvironmentVariable(
        'GARBLE_CACHE',
        $previousGarbleCache,
        [EnvironmentVariableTarget]::Process
    )
    if (-not $KeepCache) {
        Remove-Item -LiteralPath $GoCacheDir -Recurse -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath $GoTmpDir -Recurse -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath $GarbleCacheDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}
