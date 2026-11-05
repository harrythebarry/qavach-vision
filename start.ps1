# Starts Qavach Safety Intelligence with Docker and prints the address to open (Windows). Run it with start.cmd.
# Uses port 8830 when that is free, otherwise the next free one, and remembers the choice in .env.
Set-Location -Path $PSScriptRoot

docker info *> $null
if ($LASTEXITCODE -ne 0) {
  Write-Host "Docker is not running. Start Docker Desktop, wait until it says it is running, then run this again."
  exit 1
}

function Test-InUse([int]$Port) {
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $pending = $client.BeginConnect('127.0.0.1', $Port, $null, $null)
    return ($pending.AsyncWaitHandle.WaitOne(300) -and $client.Connected)
  } catch { return $false } finally { $client.Close() }
}

$port = $null
$running = docker compose port qavach 8830 2>$null          # already running: keep its port
if ($LASTEXITCODE -eq 0 -and $running) { $port = [int](($running | Select-Object -First 1) -split ':')[-1] }
if (-not $port) {
  $preferred = 8830
  if (Test-Path .env) {
    $line = Get-Content .env | Where-Object { $_ -match '^QAVACH_PORT=(\d+)' } | Select-Object -Last 1
    if ($line) { $preferred = [int]($line -split '=')[1] }
  }
  $port = $preferred
  while (Test-InUse $port) {
    $port++
    if ($port -gt $preferred + 100) { Write-Host "Could not find a free port near $preferred."; exit 1 }
  }
}

Set-Content -Path .env -Value "QAVACH_PORT=$port" -Encoding ascii
Write-Host "Starting Qavach on port $port (the first run builds the image and can take 10-20 minutes)..."
$env:QAVACH_PORT = "$port"
docker compose up -d --wait
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host ""
Write-Host "Ready. Open:  http://localhost:$port"
