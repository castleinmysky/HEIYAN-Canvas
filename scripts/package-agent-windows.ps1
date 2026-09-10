param([string]$VendorRoot, [string]$RuntimeRoot)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$connectorVersion = [string](Get-Content -LiteralPath (Join-Path $projectRoot 'server/agent-package.json') -Raw | ConvertFrom-Json).version
if ($connectorVersion -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid connector package version.' }
if (!$VendorRoot) { $VendorRoot = Join-Path $projectRoot '.runtime-portable/vendor' }
$VendorRoot = [IO.Path]::GetFullPath($VendorRoot)
$RuntimeRoot = if ($RuntimeRoot) { [IO.Path]::GetFullPath($RuntimeRoot) } else { $null }
$sources = @(
  @{ file = 'codex.tar.gz'; sha256 = 'a6ef3442cb12766a88b39311d79244289e4f9763e2c53ff4fbebc2cb653cc5f3'; url = 'https://github.com/openai/codex/releases/download/rust-v0.153.4/codex-package-x86_64-pc-windows-msvc.tar.gz' },
  @{ file = 'node.zip'; sha256 = '1177b4137ba5adaa56354ae40f1080c7450e8ae09cecb47da459d1c52ac99f97'; url = 'https://nodejs.org/dist/v22.23.2/node-v22.23.2-win-x64.zip' }
)
if (!$RuntimeRoot) {
  foreach ($source in $sources) { if ((Get-FileHash -LiteralPath (Join-Path $VendorRoot $source.file) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $source.sha256) { throw 'Official runtime archive checksum mismatch.' } }
}
$buildRoot = Join-Path $projectRoot '.runtime-portable'
$stage = Join-Path $buildRoot ('stage-' + [guid]::NewGuid().ToString('N'))
$packageRoot = Join-Path $stage 'HEIYAN-Connector'
New-Item -ItemType Directory -Path $packageRoot -Force | Out-Null
$files = @('LICENSE','scripts/portable-launcher.mjs')
foreach ($file in $files) {
  $destination = Join-Path $packageRoot $file
  New-Item -ItemType Directory -Path (Split-Path $destination -Parent) -Force | Out-Null
  Copy-Item -LiteralPath (Join-Path $projectRoot $file) -Destination $destination
}
Copy-Item -LiteralPath (Join-Path $projectRoot 'scripts/portable/start.cmd') -Destination (Join-Path $packageRoot '启动黑岩连接器.cmd')
Copy-Item -LiteralPath (Join-Path $projectRoot 'scripts/portable/stop.cmd') -Destination (Join-Path $packageRoot '停止黑岩连接器.cmd')
Copy-Item -LiteralPath (Join-Path $projectRoot 'scripts/portable/connector.json') -Destination (Join-Path $packageRoot 'connector.json')
Copy-Item -LiteralPath (Join-Path $projectRoot 'server/agent-package.json') -Destination (Join-Path $packageRoot 'package.json')
Copy-Item -LiteralPath (Join-Path $projectRoot 'docs/codex-connector-windows.md') -Destination (Join-Path $packageRoot '使用说明.md')
$utf8 = [Text.UTF8Encoding]::new($false)
& node (Join-Path $PSScriptRoot 'build-connector-update.mjs') $projectRoot $connectorVersion
if ($LASTEXITCODE -ne 0) { throw 'Connector update manifest generation failed.' }
$releaseSource = Join-Path $projectRoot ('public/downloads/heiyan-connector-update/' + $connectorVersion)
$releaseTarget = Join-Path $packageRoot ('app/releases/' + $connectorVersion)
New-Item -ItemType Directory -Path (Split-Path $releaseTarget -Parent) -Force | Out-Null
Copy-Item -LiteralPath $releaseSource -Destination $releaseTarget -Recurse
[IO.File]::WriteAllText((Join-Path $packageRoot 'app/current.json'), (@{ version = $connectorVersion } | ConvertTo-Json -Compress) + [Environment]::NewLine, $utf8)
if ($RuntimeRoot) {
  $manifestPath = Join-Path $RuntimeRoot 'runtime-manifest.json'
  $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  if ($manifest.nodeVersion -ne '22.23.2' -or $manifest.codexVersion -ne '0.153.4') { throw 'Installed runtime version does not match the pinned portable build.' }
  $runtimePrefix = $RuntimeRoot.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
  foreach ($entry in $manifest.files) {
    $file = [IO.Path]::GetFullPath((Join-Path $RuntimeRoot ([string]$entry.path)))
    if (!$file.StartsWith($runtimePrefix, [StringComparison]::OrdinalIgnoreCase) -or (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() -ne [string]$entry.sha256) { throw 'Installed runtime checksum mismatch.' }
  }
  Copy-Item -LiteralPath (Join-Path $RuntimeRoot 'runtime') -Destination (Join-Path $packageRoot 'runtime') -Recurse
  Copy-Item -LiteralPath $manifestPath -Destination (Join-Path $packageRoot 'runtime-manifest.json')
} else {
  New-Item -ItemType Directory -Force -Path (Join-Path $packageRoot 'runtime/node'),(Join-Path $packageRoot 'runtime/codex') | Out-Null
  Copy-Item -LiteralPath (Join-Path $VendorRoot 'node/node-v22.23.2-win-x64/node.exe') -Destination (Join-Path $packageRoot 'runtime/node/node.exe')
  Copy-Item -LiteralPath (Join-Path $VendorRoot 'node/node-v22.23.2-win-x64/LICENSE') -Destination (Join-Path $packageRoot 'runtime/node/LICENSE')
  foreach ($item in @('bin','codex-path','codex-resources','codex-package.json')) { Copy-Item -LiteralPath (Join-Path $VendorRoot ('codex/' + $item)) -Destination (Join-Path $packageRoot 'runtime/codex') -Recurse }
  foreach ($item in @('CODEX-LICENSE','CODEX-NOTICE')) { Copy-Item -LiteralPath (Join-Path $VendorRoot $item) -Destination (Join-Path $packageRoot ('runtime/codex/' + $item)) }
  $runtimeFiles = @(Get-ChildItem -LiteralPath (Join-Path $packageRoot 'runtime') -File -Recurse | ForEach-Object { @{ path = [IO.Path]::GetRelativePath($packageRoot, $_.FullName).Replace('\','/'); sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() } })
  [IO.File]::WriteAllText((Join-Path $packageRoot 'runtime-manifest.json'), (@{ nodeVersion = '22.23.2'; codexVersion = '0.153.4'; sources = $sources; files = $runtimeFiles } | ConvertTo-Json -Depth 8), $utf8)
}
$outputDir = Join-Path $buildRoot 'output'
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
$archive = Join-Path $outputDir 'HEIYAN-Connector-Windows-x64.zip'
Compress-Archive -LiteralPath $packageRoot -DestinationPath $archive -CompressionLevel Optimal -Force
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::OpenRead($archive)
try {
  $names = @($zip.Entries | Where-Object { $_.Name } | ForEach-Object { $_.FullName.Replace('\','/') })
  foreach ($required in @('启动黑岩连接器.cmd','停止黑岩连接器.cmd','runtime/node/node.exe','runtime/codex/bin/codex.exe','runtime/codex/bin/codex-code-mode-host.exe','runtime-manifest.json','app/current.json',"app/releases/$connectorVersion/manifest.json","app/releases/$connectorVersion/portable-main.mjs","app/releases/$connectorVersion/server/agent-version.js")) { if ($names -notcontains ('HEIYAN-Connector/' + $required)) { throw "Missing portable entry: $required" } }
  if (@($names | Where-Object { $_ -match '(^|/)(auth.json|config.toml|instance.json|private|\.git|node_modules)(/|$)' }).Count) { throw 'Unexpected private files in archive.' }
} finally { $zip.Dispose() }
& node (Join-Path $PSScriptRoot 'split-portable-download.mjs') $archive (Join-Path $projectRoot 'public/downloads/heiyan-windows') $connectorVersion
if ($LASTEXITCODE -ne 0) { throw 'Download partitioning failed.' }
Write-Output ('Portable archive: ' + $archive)
Write-Output ('Unpacked QA directory: ' + $packageRoot)
