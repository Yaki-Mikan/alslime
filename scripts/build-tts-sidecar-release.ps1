param(
    [Parameter(Mandatory = $true)]
    [string]$Version,

    [Parameter(Mandatory = $true)]
    [string]$EntitlementKeys,

    [Parameter(Mandatory = $true)]
    [string]$OutputPath,

    [ValidateSet('windows', 'linux')]
    [string]$TargetOS = 'windows',

    [ValidateSet('amd64', 'arm64')]
    [string]$TargetArch = 'amd64',

    [switch]$Tiny
)

$CommonScript = Join-Path $PSScriptRoot 'build-sidecar-release.common.ps1'
& $CommonScript `
    -Version $Version `
    -EntitlementKeys $EntitlementKeys `
    -OutputPath $OutputPath `
    -CommandName 'ttsmodule' `
    -TargetOS $TargetOS `
    -TargetArch $TargetArch `
    -Tiny:$Tiny
