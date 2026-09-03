param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$')]
    [string]$Version,

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[A-Za-z0-9._-]+:[0-9A-Fa-f]{64}(,[A-Za-z0-9._-]+:[0-9A-Fa-f]{64})*$')]
    [string]$EntitlementKeys,

    [Parameter(Mandatory = $true)]
    [string]$OutputPath,

    [Parameter(Mandatory = $true)]
    [ValidateSet('comfymodule', 'ttsmodule')]
    [string]$CommandName,

    [ValidateSet('windows', 'linux')]
    [string]$TargetOS = 'windows',

    [ValidateSet('amd64', 'arm64')]
    [string]$TargetArch = 'amd64',

    [switch]$Tiny
)

$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $ScriptDir 'release-metadata.ps1')

$ClientRoot = Resolve-Path (Join-Path $ScriptDir '..')
$WorkspaceRoot = Resolve-Path (Join-Path $ClientRoot '..')
$CoreRoot = Join-Path $WorkspaceRoot 'alslime-core'
$GoWorkPath = Join-Path $WorkspaceRoot 'go.work'
$ModuleCmdDir = Join-Path $CoreRoot "cmd\$CommandName"
$WinresJson = Join-Path $ModuleCmdDir 'winres\winres.json'
$ResolvedOutputPath = [IO.Path]::GetFullPath($OutputPath)
$OutputDir = Split-Path -Parent $ResolvedOutputPath
$GoCacheDir = Join-Path $ClientRoot '.gocache'
$GoTmpDir = Join-Path $ClientRoot '.gotmp'
$GarbleCacheDir = Join-Path $ClientRoot '.garble-cache'
$ComponentId = switch ($CommandName) {
    'comfymodule' { 'alslime-comfy' }
    'ttsmodule' { 'alslime-tts' }
}

foreach ($RequiredPath in @($CoreRoot, $GoWorkPath, $ModuleCmdDir, $OutputDir)) {
    if (-not (Test-Path -LiteralPath $RequiredPath)) {
        throw "Required path not found: $RequiredPath"
    }
}
if ($TargetOS -eq 'windows' -and -not (Test-Path -LiteralPath $WinresJson -PathType Leaf)) {
    throw "Required Windows resource config not found: $WinresJson"
}
if (Test-Path -LiteralPath $ResolvedOutputPath) {
    throw "Refusing to overwrite an existing artifact: $ResolvedOutputPath"
}
foreach ($Command in @('go', 'garble')) {
    if (-not (Get-Command $Command -ErrorAction SilentlyContinue)) {
        throw "Required command not found: $Command"
    }
}
if ($TargetOS -eq 'windows' -and -not (Get-Command 'go-winres' -ErrorAction SilentlyContinue)) {
    throw 'Required command not found: go-winres'
}

$VersionMatch = [regex]::Match($Version, '^(?<numeric>\d+\.\d+\.\d+)')
if (-not $VersionMatch.Success) {
    throw "Could not derive a numeric VERSIONINFO value from: $Version"
}
$WinresVersion = $VersionMatch.Groups['numeric'].Value
$MetadataBundle = New-ReleaseMetadataEnvelope `
    -ComponentId $ComponentId `
    -Version $Version `
    -TargetOS $TargetOS `
    -TargetArch $TargetArch

$ExistingResources = @(
    Get-ChildItem -LiteralPath $ModuleCmdDir -Filter 'rsrc_windows_*.syso' `
        -ErrorAction SilentlyContinue
)
if ($ExistingResources.Count -ne 0) {
    throw "Windows resource intermediates already exist: $($ExistingResources.FullName -join ', ')"
}

$TrackedEnvironment = @(
    'GOWORK',
    'GOOS',
    'GOARCH',
    'CGO_ENABLED',
    'GOCACHE',
    'GOTMPDIR',
    'GARBLE_CACHE'
)
$OriginalEnvironment = @{}
foreach ($Name in $TrackedEnvironment) {
    $OriginalEnvironment[$Name] = [Environment]::GetEnvironmentVariable(
        $Name,
        [EnvironmentVariableTarget]::Process
    )
}

$env:GOWORK = $GoWorkPath
$env:GOOS = $TargetOS
$env:GOARCH = $TargetArch
$env:CGO_ENABLED = '0'
$env:GOCACHE = $GoCacheDir
$env:GOTMPDIR = $GoTmpDir
$env:GARBLE_CACHE = $GarbleCacheDir
foreach ($CacheDir in @($GoCacheDir, $GoTmpDir, $GarbleCacheDir)) {
    New-Item -ItemType Directory -Force -Path $CacheDir | Out-Null
}

$ModuleLdflags = @(
    '-s',
    '-w',
    '-X', "alslime/internal/buildinfo.version=$Version",
    '-X', 'alslime/internal/buildinfo.buildMode=release',
    '-X', "alslime/internal/buildinfo.metadataEnvelope=$($MetadataBundle.Envelope)",
    '-X', "alslime/core/featuresimpl.embeddedPublicKeys=$EntitlementKeys"
)
if ($TargetOS -eq 'linux') {
    $ModuleLdflags += @('-B', "0x$($MetadataBundle.Metadata.gnuBuildId)")
}
$ModuleLdflagsText = $ModuleLdflags -join ' '
$BuildStarted = $false

try {
    Push-Location $CoreRoot
    try {
        if ($TargetOS -eq 'windows') {
            go-winres make `
                --in $WinresJson `
                --out (Join-Path $ModuleCmdDir 'rsrc') `
                --product-version $WinresVersion `
                --file-version $WinresVersion
            if ($LASTEXITCODE -ne 0) {
                throw "$CommandName Windows resource generation failed."
            }
        }

        $GarbleArgs = @('-literals')
        if ($Tiny) {
            $GarbleArgs += '-tiny'
        }
        $GarbleArgs += @(
            '-seed=random',
            'build',
            '-trimpath',
            '-buildvcs=false',
            '-ldflags', $ModuleLdflagsText,
            '-o', $ResolvedOutputPath,
            "./cmd/$CommandName"
        )
        $BuildStarted = $true
        & garble @GarbleArgs
        if ($LASTEXITCODE -ne 0) {
            throw "$CommandName release build failed."
        }
    } finally {
        Pop-Location
    }

    if (-not (Test-Path -LiteralPath $ResolvedOutputPath -PathType Leaf)) {
        throw "Build artifact not found: $ResolvedOutputPath"
    }

    if ($TargetOS -eq 'windows') {
        $WinresConfig = Get-Content -LiteralPath $WinresJson -Raw -Encoding UTF8 |
            ConvertFrom-Json
        $ExpectedInfo = $WinresConfig.RT_VERSION.'#1'.'0000'.info.'0409'
        $VersionInfo = (Get-Item -LiteralPath $ResolvedOutputPath).VersionInfo
        $ExpectedFields = [ordered]@{
            FileVersion = $WinresVersion
            ProductVersion = $WinresVersion
            CompanyName = [string]$ExpectedInfo.CompanyName
            ProductName = [string]$ExpectedInfo.ProductName
            FileDescription = [string]$ExpectedInfo.FileDescription
            InternalName = [string]$ExpectedInfo.InternalName
            OriginalFilename = [string]$ExpectedInfo.OriginalFilename
        }
        foreach ($Entry in $ExpectedFields.GetEnumerator()) {
            $ActualValue = $VersionInfo.PSObject.Properties[$Entry.Key].Value
            if ([string]$ActualValue -ne [string]$Entry.Value) {
                throw "VERSIONINFO mismatch: $($Entry.Key)=$ActualValue (expected: $($Entry.Value))"
            }
        }
    } else {
        Test-LinuxReleaseMetadata `
            -BinaryPath $ResolvedOutputPath `
            -ExpectedMetadata $MetadataBundle.Metadata `
            -AlslimeRoot $ClientRoot | Out-Null
    }

    [pscustomobject]@{
        File = $ResolvedOutputPath
        Version = $Version
        TargetOS = $TargetOS
        TargetArch = $TargetArch
        ComponentId = $ComponentId
        ProductName = $MetadataBundle.Metadata.productName
        FileDescription = $MetadataBundle.Metadata.fileDescription
        SHA256 = (Get-FileHash -LiteralPath $ResolvedOutputPath -Algorithm SHA256).Hash
    }
} catch {
    if ($BuildStarted -and (Test-Path -LiteralPath $ResolvedOutputPath -PathType Leaf)) {
        Remove-Item -LiteralPath $ResolvedOutputPath -Force
    }
    throw
} finally {
    Get-ChildItem -LiteralPath $ModuleCmdDir -Filter 'rsrc_windows_*.syso' `
        -ErrorAction SilentlyContinue |
        Remove-Item -Force
    foreach ($Name in $TrackedEnvironment) {
        [Environment]::SetEnvironmentVariable(
            $Name,
            $OriginalEnvironment[$Name],
            [EnvironmentVariableTarget]::Process
        )
    }
}
