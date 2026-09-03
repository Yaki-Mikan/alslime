$script:ReleaseMetadataEnvelopePrefix = 'ALSLIME_METADATA_V1:'
$script:ReleaseMetadataEnvelopeSuffix = ':END_ALSLIME_METADATA_V1'
$script:ReleaseMetadataConfigPath = Join-Path $PSScriptRoot 'release-metadata.json'

function Get-ReleaseMetadataConfig {
    if (-not (Test-Path -LiteralPath $script:ReleaseMetadataConfigPath -PathType Leaf)) {
        throw "Release metadata config not found: $script:ReleaseMetadataConfigPath"
    }
    return Get-Content -LiteralPath $script:ReleaseMetadataConfigPath -Raw -Encoding UTF8 |
        ConvertFrom-Json
}

function New-ReleaseMetadataEnvelope {
    param(
        [Parameter(Mandatory = $true)][string]$ComponentId,
        [Parameter(Mandatory = $true)][string]$Version,
        [Parameter(Mandatory = $true)][ValidateSet('windows', 'linux')][string]$TargetOS,
        [Parameter(Mandatory = $true)][ValidateSet('amd64', 'arm64')][string]$TargetArch
    )

    $Config = Get-ReleaseMetadataConfig
    $Component = $Config.components.PSObject.Properties[$ComponentId].Value
    if ($null -eq $Component) {
        throw "Release metadata component is not configured: $ComponentId"
    }
    $OriginalFilenameProperty = "${TargetOS}OriginalFilename"
    $OriginalFilename = [string]$Component.PSObject.Properties[$OriginalFilenameProperty].Value
    if ([string]::IsNullOrWhiteSpace($OriginalFilename)) {
        throw "Release metadata original filename is not configured: $ComponentId/$TargetOS"
    }

    $GnuBuildId = ''
    if ($TargetOS -eq 'linux') {
        $BuildIdBytes = New-Object byte[] ([int]$Config.gnuBuildIdBytes)
        $Random = [Security.Cryptography.RandomNumberGenerator]::Create()
        try {
            $Random.GetBytes($BuildIdBytes)
        } finally {
            $Random.Dispose()
        }
        $GnuBuildId = ($BuildIdBytes | ForEach-Object { $_.ToString('x2') }) -join ''
    }

    $Metadata = [ordered]@{
        schemaVersion = [int]$Config.schemaVersion
        companyName = [string]$Config.companyName
        productName = [string]$Config.productName
        componentId = $ComponentId
        fileDescription = [string]$Component.fileDescription
        version = $Version
        targetOS = $TargetOS
        targetArch = $TargetArch
        originalFilename = $OriginalFilename
        sourceUrl = [string]$Config.sourceUrl
        gnuBuildId = $GnuBuildId
    }
    $Json = $Metadata | ConvertTo-Json -Compress
    $Encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($Json))
    return [pscustomobject]@{
        Metadata = [pscustomobject]$Metadata
        Envelope = "$script:ReleaseMetadataEnvelopePrefix$Encoded$script:ReleaseMetadataEnvelopeSuffix"
    }
}

function Test-LinuxReleaseMetadata {
    param(
        [Parameter(Mandatory = $true)][string]$BinaryPath,
        [Parameter(Mandatory = $true)][psobject]$ExpectedMetadata,
        [Parameter(Mandatory = $true)][string]$AlslimeRoot
    )

    $VerifierPackage = './cmd/verifyreleasemeta'
    $SavedEnvironment = @{}
    foreach ($Name in @('GOOS', 'GOARCH', 'CGO_ENABLED')) {
        $SavedEnvironment[$Name] = [Environment]::GetEnvironmentVariable(
            $Name,
            [EnvironmentVariableTarget]::Process
        )
        [Environment]::SetEnvironmentVariable(
            $Name,
            $null,
            [EnvironmentVariableTarget]::Process
        )
    }

    Push-Location $AlslimeRoot
    try {
        $VerifierOutput = & go run $VerifierPackage -file $BinaryPath 2>&1
        if ($LASTEXITCODE -ne 0) {
            throw "Linux release metadata verification failed: $($VerifierOutput -join [Environment]::NewLine)"
        }
    } finally {
        Pop-Location
        foreach ($Name in $SavedEnvironment.Keys) {
            [Environment]::SetEnvironmentVariable(
                $Name,
                $SavedEnvironment[$Name],
                [EnvironmentVariableTarget]::Process
            )
        }
    }

    $ActualMetadata = ($VerifierOutput -join [Environment]::NewLine) |
        ConvertFrom-Json
    foreach ($ExpectedProperty in $ExpectedMetadata.PSObject.Properties) {
        $ActualProperty = $ActualMetadata.PSObject.Properties[$ExpectedProperty.Name]
        if ($null -eq $ActualProperty -or
            [string]$ActualProperty.Value -ne [string]$ExpectedProperty.Value) {
            throw "Linux metadata mismatch: $($ExpectedProperty.Name)=$($ActualProperty.Value) (expected: $($ExpectedProperty.Value))"
        }
    }
    return $ActualMetadata
}
