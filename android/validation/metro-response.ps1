# PowerShell 5.1 can expose an HTTP response without Content-Type as byte[].
# Keep conversion independent of HTTP so the readiness failure is reproducible offline.
function ConvertFrom-MetroContent([object]$Content) {
    if ($Content -is [byte[]]) { return [System.Text.Encoding]::UTF8.GetString($Content) }
    if ($Content -is [string]) { return $Content }
    throw 'Unsupported Metro response content type.'
}

# Accept both Windows PowerShell 5.1 WebException and PowerShell 7 HTTP errors.
function Get-MetroFailureBody([object]$Failure) {
    $detail = [string]$Failure.ErrorDetails.Message
    if (![string]::IsNullOrWhiteSpace($detail)) { return $detail }
    try {
        $response = $Failure.Exception.Response
        if ($null -ne $response.Content) {
            return $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
        }
        if ($null -ne $response) {
            $stream = $response.GetResponseStream()
            if ($null -ne $stream) {
                $reader = [System.IO.StreamReader]::new($stream)
                try { return $reader.ReadToEnd() }
                finally { $reader.Dispose() }
            }
        }
    } catch { }
    return [string]$Failure.Exception.Message
}

# Port/project identity is checked by the caller before consulting this command line.
# Refuse relative or ambiguous commands instead of stopping an unrelated node process.
function Test-MetroProcessIdentity([object]$Process, [string]$CliPath) {
    if ($null -eq $Process -or $Process.Name -ne 'node.exe') { return $false }
    $command = ([string]$Process.CommandLine).Replace('/', '\')
    $cli = $CliPath.Replace('/', '\')
    return $command.IndexOf($cli, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and
        $command -match '\sstart(?:\s|$)' -and $command -match '(?:^|\s)--port(?:\s+|=)8081(?:\s|$)'
}

function Get-MetroReadiness([object]$Response, [string]$ExpectedProjectRoot) {
    $result = [ordered]@{ Ready = $false; ServerRunning = $false; Detail = '' }
    if ([int]$Response.StatusCode -ne 200) {
        $result.Detail = "Metro status returned HTTP $($Response.StatusCode)."
        return [pscustomobject]$result
    }
    $contentType = if ($null -eq $Response.Content) { 'null' } else { $Response.Content.GetType().FullName }
    try { $body = ConvertFrom-MetroContent $Response.Content }
    catch {
        $result.Detail = "Cannot decode Metro status ($contentType)."
        return [pscustomobject]$result
    }
    if ($body.Trim() -ne 'packager-status:running') {
        $result.Detail = "Port 8081 returned an unexpected status body ($contentType)."
        return [pscustomobject]$result
    }
    $result.ServerRunning = $true
    $header = [string]$Response.Headers['X-React-Native-Project-Root']
    if ([string]::IsNullOrWhiteSpace($header)) {
        $result.Detail = 'Metro is running, but its project-root header is missing.'
        return [pscustomobject]$result
    }
    try {
        $actual = [System.IO.Path]::GetFullPath([Uri]::UnescapeDataString($header).Replace('/', '\')).TrimEnd('\')
        $expected = [System.IO.Path]::GetFullPath($ExpectedProjectRoot).TrimEnd('\')
        if (![string]::Equals($actual, $expected, [StringComparison]::OrdinalIgnoreCase)) {
            $result.Detail = "Port 8081 serves a different project: $actual"
            return [pscustomobject]$result
        }
    } catch {
        $result.Detail = 'Metro returned an invalid project-root header.'
        return [pscustomobject]$result
    }
    $result.Ready = $true
    $result.Detail = "Metro ready for this project ($contentType)."
    return [pscustomobject]$result
}
