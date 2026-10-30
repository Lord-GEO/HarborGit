param([string]$ContextFile = (Join-Path $PSScriptRoot '..\docs\installer-qa-context.json'))
$ErrorActionPreference = 'Stop'
$context = Get-Content -LiteralPath $ContextFile -Raw -Encoding UTF8 | ConvertFrom-Json
$project = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$qaParent = [IO.Path]::GetFullPath((Join-Path $project '..\..\work\installer-verification'))
$qaRoot = [IO.Path]::GetFullPath($context.root)
if (!$qaRoot.StartsWith($qaParent + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or !(Split-Path $qaRoot -Leaf).StartsWith('harborgit-setup-qa-')) { throw 'QA root is outside the dedicated test directory' }
function Assert-OwnedPath([string]$value) {
  $resolved = [IO.Path]::GetFullPath($value)
  if (!$resolved.StartsWith($qaRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw "Path is outside QA root: $resolved" }
  return $resolved
}
$setup = Assert-OwnedPath $context.setup
$installDir = Assert-OwnedPath $context.installDir
$installedExe = Assert-OwnedPath (Join-Path $installDir $context.exeName)
$desktopLink = Join-Path ([Environment]::GetFolderPath('Desktop')) ($context.qaName + '.lnk')
$menuLink = Join-Path ([Environment]::GetFolderPath('Programs')) ($context.qaName + '.lnk')
$registryRoot = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall'
function Get-QARegistration {
  @(Get-ChildItem -LiteralPath $registryRoot | ForEach-Object {
    $value = Get-ItemProperty -LiteralPath $_.PSPath
    if ($value.PSObject.Properties['DisplayName'] -and $value.DisplayName -eq $context.qaName) { $value }
  })
}
if (@(Get-QARegistration).Count -or (Test-Path -LiteralPath $desktopLink) -or (Test-Path -LiteralPath $menuLink)) { throw 'Existing QA registration/shortcut found; refusing to overwrite it' }
if (Test-Path -LiteralPath $installDir) { throw 'QA installation directory already exists' }
$originalMain = @(Get-CimInstance Win32_Process -Filter "Name='HarborGit.exe'" | Where-Object { $_.CommandLine -notmatch '--type=' } | Select-Object ProcessId,ExecutablePath)
$result = [ordered]@{ version = $context.version; qaIdentity = $context.qaName; installDir = $installDir; originalHarborGitBefore = $originalMain; checks = @() }
$oldExecutable = $env:HARBOR_EXECUTABLE
$oldExpectInstaller = $env:HARBOR_EXPECT_INSTALLER
$installed = $false
try {
  $process = Start-Process -FilePath $setup -ArgumentList @('/S','/currentuser',"/D=$installDir") -WindowStyle Hidden -Wait -PassThru
  if ($process.ExitCode -ne 0) { throw "Installer failed: $($process.ExitCode)" }
  if (!(Test-Path -LiteralPath $installedExe)) { throw 'Installed executable missing; custom directory was not honored' }
  $installed = $true
  $registration = @(Get-QARegistration)
  if ($registration.Count -ne 1 -or $registration[0].DisplayVersion -ne $context.version) { throw 'Uninstall registration/version mismatch' }
  $result.registration = @{ path = $registration[0].PSPath; version = $registration[0].DisplayVersion; displayIcon = $registration[0].DisplayIcon }
  $shell = New-Object -ComObject WScript.Shell
  foreach ($link in @($desktopLink, $menuLink)) {
    if (!(Test-Path -LiteralPath $link)) { throw "Shortcut missing: $link" }
    $shortcut = $shell.CreateShortcut($link)
    if ([IO.Path]::GetFullPath($shortcut.TargetPath) -ne $installedExe) { throw "Shortcut target mismatch: $link" }
  }
  $expectedHash = (Get-FileHash -LiteralPath (Join-Path $project 'release\win-unpacked\HarborGit.exe') -Algorithm SHA256).Hash
  if ((Get-FileHash -LiteralPath $installedExe -Algorithm SHA256).Hash -ne $expectedHash) { throw 'Installed QA executable differs from the exact shipped payload' }
  $asarHash = (Get-FileHash -LiteralPath (Join-Path $project 'release\win-unpacked\resources\app.asar') -Algorithm SHA256).Hash
  if ((Get-FileHash -LiteralPath (Join-Path $installDir 'resources\app.asar') -Algorithm SHA256).Hash -ne $asarHash) { throw 'Installed QA application archive differs from the shipped payload' }
  $result.payloadHashes = @{ exe = $expectedHash; asar = $asarHash }
  $result.checks += 'Custom install path containing spaces and Chinese characters accepted'
  $result.checks += 'Start menu/desktop shortcuts and uninstall registry entry created'
  $result.checks += 'Installed executable is byte-identical to shipped HarborGit.exe (only filename differs)'
  $env:HARBOR_EXECUTABLE = $installedExe
  $env:HARBOR_EXPECT_INSTALLER = '1'
  $uiLog = Join-Path $project ("docs\verification-v" + $context.version + '-installed-ui.txt')
  # Windows PowerShell 5 treats native stderr warnings as errors when Stop is set.
  # Check the child exit code instead; a harmless Node color warning is not a failed test.
  $ErrorActionPreference = 'Continue'
  try {
    & npm.cmd run test:ui -- --grep 'desktop UI: open|software updates: installed' *> $uiLog
    $uiExitCode = $LASTEXITCODE
  } finally { $ErrorActionPreference = 'Stop' }
  if ($uiExitCode -ne 0) { throw "Installed app UI test failed; see $uiLog" }
  $result.checks += 'Installed application passed core Git UI flow and real installed updater detection/IPC/preference checks'
} finally {
  if ($oldExecutable) { $env:HARBOR_EXECUTABLE = $oldExecutable } else { Remove-Item Env:HARBOR_EXECUTABLE -ErrorAction SilentlyContinue }
  if ($oldExpectInstaller) { $env:HARBOR_EXPECT_INSTALLER = $oldExpectInstaller } else { Remove-Item Env:HARBOR_EXPECT_INSTALLER -ErrorAction SilentlyContinue }
  if ($installed) {
    $uninstaller = @(Get-ChildItem -LiteralPath $installDir -File -Filter 'Uninstall*.exe')
    if ($uninstaller.Count -ne 1) { throw 'QA uninstaller missing or ambiguous' }
    $uninstallPath = Assert-OwnedPath $uninstaller[0].FullName
    $process = Start-Process -FilePath $uninstallPath -ArgumentList @('/S','/currentuser') -WindowStyle Hidden -Wait -PassThru
    if ($process.ExitCode -ne 0) { throw "Uninstaller failed: $($process.ExitCode)" }
    $deadline = [DateTime]::UtcNow.AddSeconds(30)
    while ((Test-Path -LiteralPath $installedExe) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 250 }
    if ((Test-Path -LiteralPath $installedExe) -or @(Get-QARegistration).Count -or (Test-Path -LiteralPath $desktopLink) -or (Test-Path -LiteralPath $menuLink)) { throw 'QA uninstall did not remove its application/registration/shortcuts' }
    $result.checks += 'Uninstall removed the QA application, registration and both shortcuts'
  }
  $result.originalHarborGitAfter = @(Get-CimInstance Win32_Process -Filter "Name='HarborGit.exe'" | Where-Object { $_.CommandLine -notmatch '--type=' } | Select-Object ProcessId,ExecutablePath)
  $result.status = if ($result.checks.Count -eq 5) { 'passed' } else { 'incomplete' }
  $result | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $project ("docs\verification-v" + $context.version + '-installer.json')) -Encoding utf8
}
$result | ConvertTo-Json -Depth 6
# Remove only the freshly-created QA tree after all uninstall checks succeeded.
if ($result.status -eq 'passed' -and $qaRoot.StartsWith($qaParent + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { Remove-Item -LiteralPath $qaRoot -Recurse -Force }
