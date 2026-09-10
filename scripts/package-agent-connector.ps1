param([string]$OutputPath)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (!$OutputPath) { $OutputPath = Join-Path $projectRoot 'public/downloads/heiyan-codex-connector.zip' }
$OutputPath = [IO.Path]::GetFullPath($OutputPath)
$downloadRoot = [IO.Path]::GetFullPath((Join-Path $projectRoot 'public/downloads'))
if (!(Split-Path $OutputPath -Parent).Equals($downloadRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Archive must remain in public/downloads.' }
$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd([IO.Path]::DirectorySeparatorChar)
$stage = Join-Path $tempRoot ('heiyan-connector-package-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $stage | Out-Null
try {
  $files = @('LICENSE', 'server/agent-connector.js', 'server/agent-contract.js', 'server/agent-version.js', 'server/codex-runtime.js', 'scripts/start-agent-connector.mjs')
  foreach ($file in $files) {
    $destination = Join-Path $stage $file
    New-Item -ItemType Directory -Path (Split-Path $destination -Parent) -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $projectRoot $file) -Destination $destination
  }
  Copy-Item -LiteralPath (Join-Path $projectRoot 'server/agent-package.json') -Destination (Join-Path $stage 'package.json')
  Copy-Item -LiteralPath (Join-Path $projectRoot 'docs/codex-connector.md') -Destination (Join-Path $stage 'README.md')
  New-Item -ItemType Directory -Path $downloadRoot -Force | Out-Null
  Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $OutputPath -Force
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archive = [IO.Compression.ZipFile]::OpenRead($OutputPath)
  try {
    $entries = @($archive.Entries | Where-Object { $_.Name } | ForEach-Object { $_.FullName.Replace('\','/') })
    $expected = @($files) + @('package.json', 'README.md')
    if (@(Compare-Object ($entries | Sort-Object) ($expected | Sort-Object)).Count) { throw 'Unexpected archive contents.' }
    Write-Output ('Connector archive validated: ' + $entries.Count + ' source files; no credentials or models.')
  } finally { $archive.Dispose() }
} finally {
  $resolved = [IO.Path]::GetFullPath($stage)
  if (!$resolved.StartsWith($tempRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or !(Split-Path $resolved -Leaf).StartsWith('heiyan-connector-package-')) { throw 'Unsafe temporary path.' }
  Remove-Item -LiteralPath $resolved -Recurse -Force
}
