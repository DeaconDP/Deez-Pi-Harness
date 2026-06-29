# Pi Desktop PWA — install if needed, build if needed, start bridge, open UI.
$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

$Cwd = if ($env:PI_PWA_CWD) { $env:PI_PWA_CWD } else { $env:USERPROFILE }
$Port = if ($env:PI_PWA_PORT) { $env:PI_PWA_PORT } else { "3141" }

function Test-NodeVersion {
	$node = Get-Command node -ErrorAction SilentlyContinue
	if (-not $node) {
		Write-Host "Error: Node.js is not installed." -ForegroundColor Red
		Write-Host "Install Node.js >= 22.19.0 from https://nodejs.org/"
		exit 1
	}

	$version = (node -v).TrimStart("v")
	$parts = $version.Split(".")
	$major = [int]$parts[0]
	$minor = if ($parts.Length -gt 1) { [int]$parts[1] } else { 0 }

	if ($major -lt 22 -or ($major -eq 22 -and $minor -lt 19)) {
		Write-Host "Error: Node.js >= 22.19.0 is required (found v$version)." -ForegroundColor Red
		Write-Host "Upgrade from https://nodejs.org/"
		exit 1
	}
}

function Pause-IfInteractive {
	if ($Host.Name -eq "ConsoleHost") {
		Write-Host ""
		Read-Host "Press Enter to close"
	}
}

try {
	Write-Host "=== Pi Desktop PWA ===" -ForegroundColor Cyan
	Write-Host ""
	Write-Host "Project: $Root"
	Write-Host "Agent cwd: $Cwd"
	Write-Host ""

	Test-NodeVersion

	$npm = Get-Command npm -ErrorAction SilentlyContinue
	if (-not $npm) {
		Write-Host "Error: npm is not available (expected with Node.js)." -ForegroundColor Red
		exit 1
	}

	if (-not (Test-Path "node_modules")) {
		Write-Host "-> Installing dependencies..." -ForegroundColor Green
		npm install
		if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
	}

	$ConfigDir = Join-Path $env:USERPROFILE ".pi-pwa"
	New-Item -ItemType Directory -Force -Path $ConfigDir | Out-Null
	@{ projectRoot = $Root } | ConvertTo-Json | Set-Content (Join-Path $ConfigDir "config.json")

	$needsBuild = $false
	if (-not (Test-Path "dist-server/server/index.js") -or -not (Test-Path "client/dist/index.html")) {
		$needsBuild = $true
	} elseif (Test-Path "client/dist/index.html") {
		$distTime = (Get-Item "client/dist/index.html").LastWriteTimeUtc
		$srcNewer = Get-ChildItem -Path "client/src" -Recurse -File -ErrorAction SilentlyContinue |
			Where-Object { $_.LastWriteTimeUtc -gt $distTime } |
			Select-Object -First 1
		if ($srcNewer) { $needsBuild = $true }
	}

	if ($needsBuild) {
		Write-Host "-> Building..." -ForegroundColor Green
		npm run build
		if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
		Write-Host "-> Stopping existing bridge (reload server)..." -ForegroundColor Green
		npm run pi-pwa -- stop 2>$null
	}

	Write-Host "-> Starting bridge (may take up to 30s on first launch)..." -ForegroundColor Green
	npm run pi-pwa -- ensure --cwd $Cwd --port $Port --open
	if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
catch {
	Write-Host ""
	Write-Host "Run failed: $_" -ForegroundColor Red
	Pause-IfInteractive
	exit 1
}
