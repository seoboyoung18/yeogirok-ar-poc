$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'metro-response.ps1')
$project = 'C:\work\AR Project'
$checks = 0
function Assert-Ready([object]$Response, [bool]$Expected, [string]$Label) {
    $actual = Get-MetroReadiness $Response $project
    if ($actual.Ready -ne $Expected) { throw "$Label : $($actual.Detail)" }
    $script:checks++
}
function Response([object]$Content = 'packager-status:running', [int]$Status = 200,
    [string]$Root = 'C:/work/AR%20Project') {
    [pscustomobject]@{ StatusCode = $Status; Content = $Content; Headers = @{ 'X-React-Native-Project-Root' = $Root } }
}
$binary = [System.Text.Encoding]::UTF8.GetBytes('packager-status:running')
if ([bool]($binary -match 'packager-status:running')) { throw 'Regression fixture did not reproduce the old failure.' }
$checks++
Assert-Ready (Response -Content $binary) $true 'PowerShell byte-array status'
Assert-Ready (Response) $true 'String status'
Assert-Ready (Response -Content "packager-status:running`r`n") $true 'Trailing newline'
Assert-Ready (Response -Root 'c:/WORK/ar%20project/') $true 'Windows path normalization'
Assert-Ready (Response -Root 'C:/work/another-project') $false 'Different Metro project'
Assert-Ready (Response -Root '') $false 'Missing project identity'
Assert-Ready (Response -Status 503) $false 'HTTP failure'
Assert-Ready (Response -Content 'not-packager-status:running') $false 'False-positive status text'
Assert-Ready (Response -Content 123) $false 'Unexpected content type'
$bundle = 'CloudValidationPanel;yeogirok-cloud-anchor'
if ((ConvertFrom-MetroContent ([System.Text.Encoding]::UTF8.GetBytes($bundle))) -ne $bundle) {
    throw 'Binary bundle decoding failed.'
}
$checks++
function Assert-Equal([object]$Actual, [object]$Expected, [string]$Label) {
    if ($Actual -cne $Expected) { throw "$Label : unexpected result" }
    $script:checks++
}
$body = '{"type":"InternalError","message":"Got unexpected undefined","errors":[]}'
Assert-Equal (Get-MetroFailureBody ([pscustomobject]@{
    ErrorDetails = [pscustomobject]@{ Message = $body }
    Exception = [pscustomobject]@{ Message = 'HTTP 500'; Response = $null }
})) $body 'Preserve HTTP error JSON'
$streamResponse = [pscustomobject]@{}
$streamResponse | Add-Member ScriptMethod GetResponseStream {
    [System.IO.MemoryStream]::new([System.Text.Encoding]::UTF8.GetBytes('stream error detail'))
}
Assert-Equal (Get-MetroFailureBody ([pscustomobject]@{
    ErrorDetails = $null
    Exception = [pscustomobject]@{ Message = 'HTTP 500'; Response = $streamResponse }
})) 'stream error detail' 'Windows PowerShell response stream'
Assert-Equal (Get-MetroFailureBody ([pscustomobject]@{
    ErrorDetails = $null
    Exception = [pscustomobject]@{ Message = 'connection failed'; Response = $null }
})) 'connection failed' 'Network failure without HTTP response'
$cli = 'C:\work\AR Project\node_modules\react-native\cli.js'
$owner = [pscustomobject]@{ Name = 'node.exe'; CommandLine = 'node.exe "C:\work\AR Project\node_modules\react-native\cli.js" start --port 8081' }
Assert-Equal (Test-MetroProcessIdentity $owner $cli) $true 'Expected absolute CLI'
$owner.CommandLine = 'node.exe "C:/WORK/AR Project/node_modules/react-native/cli.js" start --port=8081 --reset-cache'
Assert-Equal (Test-MetroProcessIdentity $owner $cli) $true 'Windows path normalization'
$owner.CommandLine = 'node.exe "C:\work\another-project\node_modules\react-native\cli.js" start --port 8081'
Assert-Equal (Test-MetroProcessIdentity $owner $cli) $false 'Never stop another project'
$owner.CommandLine = 'node.exe node_modules/react-native/cli.js start --port 8081'
Assert-Equal (Test-MetroProcessIdentity $owner $cli) $false 'Ambiguous relative CLI'
$owner.CommandLine = 'node.exe "C:\work\AR Project\node_modules\react-native\cli.js" start --port 8082'
Assert-Equal (Test-MetroProcessIdentity $owner $cli) $false 'Other Metro port'
$owner.CommandLine = 'node.exe "C:\work\AR Project\node_modules\react-native\cli.js" bundle --port 8081'
Assert-Equal (Test-MetroProcessIdentity $owner $cli) $false 'Non-server command'
Assert-Equal (Test-MetroProcessIdentity $null $cli) $false 'Missing process'
$tokens = $null; $parseErrors = $null
[System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'check-device.ps1'), [ref]$tokens, [ref]$parseErrors) | Out-Null
if ($parseErrors.Count -gt 0) { throw 'Device script has PowerShell syntax errors.' }
$checks++
Write-Output "Metro response regression: $checks checks passed."
