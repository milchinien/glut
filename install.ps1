param([string]$Code)

$ErrorActionPreference = 'Stop'

function Find-Node {
  $paths = @()
  $command = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($command) { $paths += $command.Source }
  if ($env:ProgramFiles) { $paths += (Join-Path $env:ProgramFiles 'nodejs\node.exe') }
  if ($env:LOCALAPPDATA) { $paths += (Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe') }
  foreach ($candidate in ($paths | Select-Object -Unique)) {
    if (-not (Test-Path -LiteralPath $candidate)) { continue }
    try {
      $version = [version]((& $candidate --version).TrimStart('v'))
      if ($version -ge [version]'22.13.0') { return $candidate }
    } catch { }
  }
  return $null
}

$node = Find-Node
if (-not $node) {
  if (-not (Get-Command winget.exe -ErrorAction SilentlyContinue)) {
    throw 'Node.js 22.13 oder neuer fehlt und winget ist nicht verfügbar. Bitte Node.js installieren und diesen Befehl erneut starten.'
  }
  Write-Host 'Installiere Node.js LTS mit winget ...'
  & winget.exe install --id OpenJS.NodeJS.LTS --exact --source winget --silent --accept-package-agreements --accept-source-agreements
  if ($LASTEXITCODE -ne 0) { throw "winget konnte Node.js nicht installieren (Exitcode $LASTEXITCODE)." }
  $node = Find-Node
  if (-not $node) { throw 'Node.js wurde installiert, ist aber in dieser PowerShell noch nicht erreichbar. Bitte PowerShell neu öffnen und den Befehl erneut ausführen.' }
}

$installDir = Join-Path $env:LOCALAPPDATA 'Glut'
$stage = Join-Path ([IO.Path]::GetTempPath()) ('glut-install-' + [guid]::NewGuid().ToString('N'))
$zip = Join-Path $stage 'source.zip'
New-Item -ItemType Directory -Path $stage,$installDir -Force | Out-Null
try {
  Write-Host 'Lade Glut von GitHub ...'
  Invoke-WebRequest 'https://github.com/milchinien/glut/archive/refs/heads/main.zip' -OutFile $zip
  Expand-Archive -LiteralPath $zip -DestinationPath $stage -Force
  $source = Join-Path $stage 'glut-main'
  if (-not (Test-Path -LiteralPath (Join-Path $source 'src/collector.mjs'))) { throw 'Das Glut-Paket ist unvollständig.' }
  foreach ($folder in 'src','public') {
    $target = Join-Path $installDir $folder
    New-Item -ItemType Directory -Path $target -Force | Out-Null
    Copy-Item -Path (Join-Path $source "$folder/*") -Destination $target -Recurse -Force
  }
  Copy-Item -LiteralPath (Join-Path $source 'package.json') -Destination $installDir -Force

  Push-Location $installDir
  try {
    if (-not $Code) { $Code = Read-Host 'Jetzt Einrichtungscode aus https://miwale.com/usage eingeben' }
    $Code = $Code.Trim().ToUpperInvariant()
    if ($Code -notmatch '^[0-9A-F]{16}$') { throw 'Der Einrichtungscode muss aus 16 Zeichen bestehen.' }
    & $node 'src/collector.mjs' '--pair' $Code
    if ($LASTEXITCODE -ne 0) { throw 'Gerät konnte nicht verbunden werden. Bitte einen neuen Einrichtungscode erzeugen und den Befehl erneut ausführen.' }
    $action = New-ScheduledTaskAction -Execute $node -Argument 'src/collector.mjs' -WorkingDirectory $installDir
    $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration (New-TimeSpan -Days 3650)
    Register-ScheduledTask -TaskName 'GlutUsageCollector' -Action $action -Trigger $trigger -Description 'Überträgt Codex- und Claude-Nutzungsstatistiken alle fünf Minuten an miwale.com/usage' -Force | Out-Null
    Write-Host 'Fertig. Dieses Gerät wird alle fünf Minuten automatisch synchronisiert.'
  } finally { Pop-Location }
} finally {
  Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
}
