param([Parameter(Mandatory=$true)][string]$Code)
$ErrorActionPreference = 'Stop'
$node = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $node) { throw 'Node.js 22.13 oder neuer fehlt. Bitte von nodejs.org installieren und den Befehl erneut starten.' }
$major = [int]((& $node.Source --version).TrimStart('v').Split('.')[0])
if ($major -lt 22) { throw 'Node.js 22.13 oder neuer wird benötigt.' }

$installDir = Join-Path $env:LOCALAPPDATA 'Glut'
$stage = Join-Path ([IO.Path]::GetTempPath()) ('glut-install-' + [guid]::NewGuid().ToString('N'))
$zip = Join-Path $stage 'source.zip'
New-Item -ItemType Directory -Path $stage,$installDir -Force | Out-Null
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
  & $node.Source 'src/collector.mjs' '--pair' $Code
  if ($LASTEXITCODE -ne 0) { throw 'Gerät konnte nicht verbunden werden.' }
  $action = New-ScheduledTaskAction -Execute $node.Source -Argument 'src/collector.mjs' -WorkingDirectory $installDir
  $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration (New-TimeSpan -Days 3650)
  Register-ScheduledTask -TaskName 'GlutUsageCollector' -Action $action -Trigger $trigger -Description 'Überträgt Codex- und Claude-Nutzungsstatistiken alle fünf Minuten an miwale.com/usage' -Force | Out-Null
  Write-Host 'Fertig. Glut synchronisiert dieses Gerät jetzt alle fünf Minuten.'
} finally { Pop-Location }
