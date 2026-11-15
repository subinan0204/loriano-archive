param([Parameter(Mandatory=$true)][string]$PrivateBackup)
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$log=[System.Collections.Generic.List[string]]::new()
function Run-Test([string]$File,[string[]]$Extra=@()) {
  $output=& node --preserve-symlinks --preserve-symlinks-main $File @Extra 2>&1
  foreach($line in $output){Write-Output $line; $log.Add([string]$line)}
  if($LASTEXITCODE -ne 0){throw "Test failed: $File"}
}
Run-Test (Join-Path $PSScriptRoot 'data-regression.mjs') @($PrivateBackup)
Run-Test (Join-Path $PSScriptRoot 'sw-regression.mjs')
Run-Test (Join-Path $PSScriptRoot 'mini-player-regression.mjs')
Run-Test (Join-Path $PSScriptRoot 'storage-safety.mjs') @($PrivateBackup)
Run-Test (Join-Path $root 'playlist-sync-worker.test.mjs')
$log.Add('PASS: all Node suites. No live network, production DB, deployment, or real media tests were performed.')
$log | Set-Content -LiteralPath (Join-Path $root 'results\run-all.log') -Encoding utf8
