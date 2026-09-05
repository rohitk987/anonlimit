param(
    [ValidateRange(10, 180)]
    [int]$TimeoutSeconds = 90
)

$ErrorActionPreference = 'Stop'
$taskDockerCommand = Get-Command docker.exe -ErrorAction Stop
$taskDockerExe = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'

if (-not (Test-Path -LiteralPath $taskDockerExe)) {
    throw "Docker Desktop was not found at $taskDockerExe"
}

function Get-TaskDockerServerVersion {
    $taskProbe = [System.Diagnostics.Process]::new()
    $taskProbe.StartInfo.FileName = $taskDockerCommand.Source
    $taskProbe.StartInfo.Arguments = 'version --format "{{.Server.Version}}"'
    $taskProbe.StartInfo.UseShellExecute = $false
    $taskProbe.StartInfo.CreateNoWindow = $true
    $taskProbe.StartInfo.RedirectStandardOutput = $true
    $taskProbe.StartInfo.RedirectStandardError = $true
    try {
        [void]$taskProbe.Start()
        $taskOutput = $taskProbe.StandardOutput.ReadToEndAsync()
        $taskErrorOutput = $taskProbe.StandardError.ReadToEndAsync()
        if (-not $taskProbe.WaitForExit(3000)) {
            $taskProbe.Kill()
            $taskProbe.WaitForExit()
            [void]$taskOutput.GetAwaiter().GetResult()
            [void]$taskErrorOutput.GetAwaiter().GetResult()
            return $null
        }
        $taskVersion = $taskOutput.GetAwaiter().GetResult().Trim()
        [void]$taskErrorOutput.GetAwaiter().GetResult()
        if ($taskProbe.ExitCode -eq 0 -and $taskVersion) {
            return $taskVersion
        }
        return $null
    } finally {
        $taskProbe.Dispose()
    }
}

$taskServerVersion = Get-TaskDockerServerVersion
if ($taskServerVersion) {
    Write-Output "Docker engine is ready: $taskServerVersion"
    exit 0
}

# Ask the existing Explorer desktop to launch Docker in the user's shell context.
# Direct child-process startup left inaccessible AppData sockets on this machine.
$taskShell = New-Object -ComObject Shell.Application
$taskDesktopHandle = 0
$taskDesktop = $taskShell.Windows().FindWindowSW(0, $null, 8, [ref]$taskDesktopHandle, 1)
if (-not $taskDesktop) {
    throw 'Windows Explorer desktop is unavailable. Open Docker Desktop from the Start menu.'
}
$taskDesktop.Document.Application.ShellExecute(
    $taskDockerExe, '', (Split-Path -Parent $taskDockerExe), 'open', 0
)

$taskDeadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
do {
    $taskServerVersion = Get-TaskDockerServerVersion
    if ($taskServerVersion) {
        Write-Output "Docker engine is ready: $taskServerVersion"
        exit 0
    }
    Start-Sleep -Seconds 2
} while ([DateTime]::UtcNow -lt $taskDeadline)

throw "Docker engine is still unavailable after the $TimeoutSeconds-second polling budget. Inspect the Docker Desktop error and startup logs; this helper does not reset data or stop Docker processes."
