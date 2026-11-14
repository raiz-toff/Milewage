<#
  MileWage on Google Play: the one-time setup, step by step, on a Windows PC.

    pwsh -ExecutionPolicy Bypass -File scripts\play-setup.ps1

  It finds the tools (Git Bash, JDK 17, the Android SDK, Node), makes the upload key, builds the
  App Bundle, and walks through Play Console and Google Cloud: it opens each page, puts each answer
  on the clipboard (from apps/android/play/console-answers.md) and waits for you. What it has done
  is remembered in %USERPROFILE%\.milewage\play-setup-done.txt, so you can stop and run it again.
  Administrator rights are not needed (and do no harm). The keys stay in %USERPROFILE%\.milewage.
#>
param([int]$Step = 0)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
$UserHome = [Environment]::GetFolderPath('UserProfile')
$Keys = Join-Path $UserHome '.milewage'
$DoneFile = Join-Path $Keys 'play-setup-done.txt'
$Answers = Join-Path $Root 'apps\android\play\console-answers.md'
$Version = (Get-Content (Join-Path $Root 'VERSION') -Raw).Trim()
$Aab = Join-Path $Root "apps\android\app\build\outputs\bundle\release\milewage-$Version.aab"
$Notes = Join-Path $Root "apps\android\play\release-notes\en-US\$Version.txt"
$PlayKey = Join-Path $Keys 'play-service-account.json'
$KeystoreEnv = Join-Path $Keys 'keystore.env'
$Console = 'https://play.google.com/console/developers'

# ---------------------------------------------------------------- helpers

function Title($text) { Write-Host ''; Write-Host "=== $text ===" -ForegroundColor Yellow }
function Info($text) { Write-Host $text }
function Good($text) { Write-Host $text -ForegroundColor Green }
function Bad($text) { Write-Host $text -ForegroundColor Red }
function Pause-Here($text = 'Press Enter when done') { [void](Read-Host "  > $text") }
function Ask($question) {
  $a = Read-Host "  > $question [Y/n]"
  return ($a -eq '' -or $a -match '^[yY]')
}
function Copy-Text($label, $text) {
  Set-Clipboard -Value $text
  Write-Host "  [copied] $label" -ForegroundColor Cyan
}
function Open($url) { Start-Process $url | Out-Null; Info "  (opened $url)" }
function Done-Steps {
  if (Test-Path $DoneFile) { return @(Get-Content $DoneFile) } else { return @() }
}
function Mark-Done($id) {
  New-Item -ItemType Directory $Keys -Force | Out-Null
  if ((Done-Steps) -notcontains $id) { Add-Content $DoneFile $id }
}
function Squash($text) { return (($text -replace '\s+', ' ').Trim()) }

# A section of console-answers.md, by its heading (## or ###).
function Section($heading) {
  $all = Get-Content $Answers -Raw -Encoding UTF8
  $m = [regex]::Match($all, "(?ms)^#{2,3} $([regex]::Escape($heading))[ \t]*\r?\n(.*?)(?=^#{2,3} |\z)")
  if (-not $m.Success) { throw "No section '$heading' in console-answers.md" }
  return $m.Groups[1].Value.Trim()
}
# The "- **Label:** text" items of a section, as label => text.
function Items($body) {
  $out = [ordered]@{}
  foreach ($m in [regex]::Matches($body, '(?ms)^- \*\*(.+?):\*\*\s*(.*?)(?=^- \*\*|^\S|\z)')) {
    $out[$m.Groups[1].Value] = $m.Groups[2].Value.Trim()
  }
  return $out
}
function Show-Section($heading) {
  Write-Host ''
  Write-Host "--- $heading ---" -ForegroundColor Cyan
  Write-Host (Section $heading)
}

function Run-Bash($script) {
  & $script:Bash $script | Out-Host
  if ($LASTEXITCODE -ne 0) { throw "$script failed (exit $LASTEXITCODE)" }
}
function Run-Npm([string[]]$npmArgs) {
  & npm @npmArgs | Out-Host
  return ($LASTEXITCODE -eq 0)
}

# ---------------------------------------------------------------- tools

function Find-Tools {
  Title 'Checking the tools'
  $git = Get-Command git -ErrorAction SilentlyContinue
  $candidates = @("$env:ProgramFiles\Git\bin\bash.exe")
  if ($git) { $candidates += (Join-Path (Split-Path (Split-Path $git.Source)) 'bin\bash.exe') }
  $script:Bash = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
  if (-not $script:Bash) { throw 'Git Bash not found. Install Git for Windows (https://git-scm.com).' }
  Good "  Git Bash:    $script:Bash"

  $jdk = $null
  if ($env:JAVA_HOME -and (Test-Path "$env:JAVA_HOME\bin\java.exe") -and ((& "$env:JAVA_HOME\bin\java.exe" -version 2>&1 | Out-String) -match '"17\.')) {
    $jdk = $env:JAVA_HOME
  }
  if (-not $jdk) {
    $jdk = Get-ChildItem "$UserHome\.gradle\jdks", "$env:ProgramFiles\Eclipse Adoptium", "$env:ProgramFiles\Java" -Directory -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -match '(^|[-_])17|jdk-17' -and (Test-Path "$($_.FullName)\bin\java.exe") } |
      Select-Object -First 1 -ExpandProperty FullName
  }
  if (-not $jdk) { throw 'JDK 17 not found. Install Temurin 17 (https://adoptium.net) and run this again.' }
  $env:JAVA_HOME = $jdk
  $env:PATH = "$jdk\bin;$env:PATH"
  Good "  JDK 17:      $jdk"

  $sdk = @($env:ANDROID_HOME, "$env:LOCALAPPDATA\Android\Sdk") | Where-Object { $_ -and (Test-Path "$_\platforms") } | Select-Object -First 1
  if (-not $sdk) { throw 'Android SDK not found. Install Android Studio once (it puts the SDK in %LOCALAPPDATA%\Android\Sdk).' }
  $env:ANDROID_HOME = $sdk -replace '\\', '/'   # forward slashes: it goes into local.properties
  Good "  Android SDK: $sdk"

  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    $node = Get-ChildItem 'D:\Tools', "$env:ProgramFiles\nodejs" -Recurse -Filter node.exe -Depth 3 -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($node) { $env:PATH = "$($node.DirectoryName);$env:PATH" }
  }
  if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw 'Node.js not found. Install Node 22 (https://nodejs.org).' }
  Good "  Node:        $((Get-Command node).Source)"
  if (-not (Test-Path (Join-Path $Root 'node_modules'))) { Info '  Installing the npm packages...'; [void](Run-Npm @('ci', '--silent')) }
  Info "  MileWage $Version"
}

# ---------------------------------------------------------------- steps

function Step-Key {
  Title 'Step 1: the upload key'
  if (Test-Path $KeystoreEnv) {
    Good "  The upload key already exists ($KeystoreEnv)."
  } else {
    Info '  This makes the key that proves an upload to Play comes from you. It is made once, ever.'
    if (-not (Ask 'Make it now?')) { return $false }
    Run-Bash 'scripts/phone-keystore.sh'
  }
  Write-Host ''
  Bad '  BACK UP the .milewage folder now (USB stick, cloud drive or password manager).'
  Bad '  Losing it means asking Google to reset the upload key before you can update the app.'
  Start-Process explorer.exe $Keys
  Pause-Here 'Press Enter once the folder is backed up'
  return $true
}

function Step-Build {
  Title "Step 2: build MileWage $Version"
  if (-not (Test-Path $KeystoreEnv)) { Bad '  Do step 1 first: without the upload key the build is not for Play.'; return $false }
  if ((Test-Path $Aab) -and -not (Ask "milewage-$Version.aab already exists. Build it again?")) { return $true }
  Info '  Tests, lint, then the signed APK and App Bundle. This takes a few minutes.'
  Run-Bash 'scripts/phone-release-build.sh'
  if (-not (Test-Path $Aab)) { Bad "  The build finished but $Aab is missing."; return $false }
  Good "  Built: $Aab"
  return $true
}

function Step-CreateApp {
  Title 'Step 3: create the app in Play Console'
  Open $Console
  Info '  Click "Create app" and fill in:'
  Info '    App name:          MileWage'
  Info '    Default language:  English (United States) - en-US'
  Info '    App or game:       App'
  Info '    Free or paid:      Free'
  Info '    Tick the two declarations, then "Create app".'
  Copy-Text 'MileWage (the app name)' 'MileWage'
  Pause-Here
  return $true
}

function Step-Forms {
  Title 'Step 4: the forms (Store settings and App content)'
  Info '  In Play Console, inside MileWage: Grow users > Store presence > Store settings, and'
  Info '  Monitor and improve > Policy and programs > App content. One form at a time:'

  Show-Section 'Store settings'
  Copy-Text 'the website' 'https://github.com/raiz-toff/Milewage'
  Pause-Here

  Show-Section 'Privacy policy'
  Copy-Text 'the privacy policy URL' 'https://github.com/raiz-toff/Milewage/blob/main/PRIVACY.md'
  Pause-Here

  $access = Section 'App access'
  Show-Section 'App access'
  $quote = [regex]::Match($access, '(?m)(^\s*> .*\r?\n?)+').Value -replace '(?m)^\s*> ', ''
  Copy-Text 'the name' 'Demo mode (no server needed)'
  Pause-Here 'Paste the name, then press Enter for the instructions'
  Copy-Text 'the instructions' (Squash $quote)
  Pause-Here

  foreach ($h in 'Ads', 'Advertising ID', 'Content rating (IARC questionnaire)', 'Target audience and content', 'News app', 'Government app', 'Financial features', 'Health', 'Data safety') {
    Show-Section $h
    Pause-Here
  }
  return $true
}

function Step-FirstUpload {
  Title 'Step 5: the first upload, by hand'
  if (-not (Test-Path $Aab)) { Bad '  Do step 2 first.'; return $false }
  Info '  Play Console > MileWage > Test and release > Testing > Internal testing:'
  Info '    1. "Create new release". Signing: keep "Let Google manage and protect your app signing key".'
  Info "    2. Upload the bundle: Explorer is showing it ($([IO.Path]::GetFileName($Aab)))."
  Info '    3. Release name: leave it. Release notes: paste (on the clipboard).'
  Info '    4. Next, Save, then roll out to internal testing.'
  Info '    5. Testers tab: create an email list with your own email, Save.'
  Info '  If Play asks about location permissions now, answer with step 8 of this script and come back.'
  Start-Process explorer.exe "/select,`"$Aab`""
  Copy-Text 'the release notes' ("<en-US>`n" + (Get-Content $Notes -Raw -Encoding UTF8).Trim() + "`n</en-US>")
  Pause-Here
  return $true
}

function Step-ApiKey {
  Title 'Step 6: the Play API key (so updates are one command)'
  if (-not (Test-Path $PlayKey)) {
    Info '  a. Create a Google Cloud project (any name, e.g. milewage-play):'
    Open 'https://console.cloud.google.com/projectcreate'
    Pause-Here 'Press Enter once the project exists and is selected'
    Info '  b. Enable the Google Play Android Developer API (click Enable):'
    Open 'https://console.cloud.google.com/apis/library/androidpublisher.googleapis.com'
    Pause-Here
    Info '  c. Create a service account: name milewage-play, Create and continue, no roles, Done.'
    Info '     Then click it > Keys > Add key > Create new key > JSON. It downloads a .json file.'
    Open 'https://console.cloud.google.com/iam-admin/serviceaccounts'
    Pause-Here 'Press Enter once the .json file has downloaded'
    $downloads = Join-Path $UserHome 'Downloads'
    $found = Get-ChildItem $downloads -Filter *.json -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending |
      Where-Object { (Get-Content $_.FullName -Raw) -match '"type"\s*:\s*"service_account"' } | Select-Object -First 1
    if (-not $found) {
      $path = Read-Host '  > Not in Downloads. Paste the full path of the .json file'
      $found = Get-Item $path.Trim('"')
    }
    New-Item -ItemType Directory $Keys -Force | Out-Null
    Move-Item $found.FullName $PlayKey
    Good "  Saved as $PlayKey (outside the repository; back it up with the rest of .milewage)."
  } else {
    Good "  The key is already in $PlayKey."
  }
  $email = (Get-Content $PlayKey -Raw | ConvertFrom-Json).client_email

  Title 'Step 6, continued: let the key into Play'
  Open $Console
  Info '  Play Console (all apps, not inside MileWage) > Users and permissions > Invite new users:'
  Info '    Email: paste (on the clipboard).'
  Info '    App permissions > Add app > MileWage, tick:'
  Info '      - Release to production, exclude devices, and use Play App Signing'
  Info '      - Release apps to testing tracks'
  Info '      - Manage store presence'
  Info '    Apply, Invite user, Send invite.'
  Copy-Text $email $email
  Pause-Here
  return $true
}

function Step-Listing {
  Title 'Step 7: the store listing (text, icon, feature graphic, 7 screenshots)'
  if (-not (Test-Path $PlayKey)) { Bad '  Do step 6 first.'; return $false }
  if (-not (Run-Npm @('run', 'play:check', '--silent'))) { return $false }
  while ($true) {
    if (Run-Npm @('run', 'play:listing', '--silent')) { Good '  The listing is on Play.'; return $true }
    Bad '  Play refused. "The caller does not have permission" right after step 6 usually means wait a few minutes.'
    if (-not (Ask 'Try again?')) { return $false }
  }
}

function Step-Location {
  Title 'Step 8: background location and the foreground service'
  Info '  Play asks for these in App content (Sensitive permissions) after the first upload.'
  Info '  First record the video, 30 seconds at most, on the phone (swipe down > Screen recorder):'
  $bg = Items (Section 'Location permissions (background location)')
  Write-Host $bg['Video (30 seconds or less, an unlisted YouTube link)']
  Info '  Upload it to YouTube as Unlisted and keep the link:'
  Open 'https://studio.youtube.com'
  Pause-Here 'Press Enter once you have the YouTube link'
  foreach ($k in @($bg.Keys)) {
    if ($k -like 'Video*') { continue }
    Write-Host ''
    Write-Host "--- $k ---" -ForegroundColor Cyan
    Copy-Text $k (Squash $bg[$k])
    Pause-Here 'Paste it, then press Enter'
  }
  $fg = Items (Section 'Foreground service (location)')
  foreach ($k in @($fg.Keys)) {
    Write-Host ''
    Write-Host "--- Foreground service: $k ---" -ForegroundColor Cyan
    if ($k -like 'Video*') { Info '  The same YouTube link.'; Pause-Here; continue }
    Copy-Text $k (Squash $fg[$k])
    Pause-Here 'Paste it, then press Enter'
  }
  return $true
}

function Step-GoLive {
  Title 'Step 9: testers, then everyone'
  Info '  Play Console > MileWage > Dashboard says what is left. For a personal account made after'
  Info '  13 November 2023 that includes a closed test: 12 testers, 14 days in a row.'
  Info '    c  send the build on internal testing to closed testing (then add testers in Play)'
  Info '    p  send it to production for 20 % of users (after the closed test, if one is needed)'
  Info '    s  skip for now'
  switch (Read-Host '  > c, p or s') {
    'c' { [void](Run-Npm @('run', 'play:promote', '--', '--from', 'internal', '--track', 'alpha')) }
    'p' { [void](Run-Npm @('run', 'play:promote', '--', '--from', 'internal', '--track', 'production', '--rollout', '0.2')) }
    default { return $false }
  }
  Info '  Then Play Console > Publishing overview > Send changes for review.'
  Pause-Here
  return $true
}

# ---------------------------------------------------------------- main

$steps = @(
  @{ id = 'key'; name = 'Upload key'; run = { Step-Key } },
  @{ id = 'build'; name = "Build $Version"; run = { Step-Build } },
  @{ id = 'app'; name = 'Create the app in Play Console'; run = { Step-CreateApp } },
  @{ id = 'forms'; name = 'Store settings and App content'; run = { Step-Forms } },
  @{ id = 'upload'; name = 'First upload, by hand'; run = { Step-FirstUpload } },
  @{ id = 'apikey'; name = 'Play API key'; run = { Step-ApiKey } },
  @{ id = 'listing'; name = 'Store listing'; run = { Step-Listing } },
  @{ id = 'location'; name = 'Background location (video)'; run = { Step-Location } },
  @{ id = 'live'; name = 'Testers, then everyone'; run = { Step-GoLive } }
)

try {
  Find-Tools
  while ($true) {
    $done = Done-Steps
    Title 'MileWage on Google Play'
    for ($i = 0; $i -lt $steps.Count; $i++) {
      $mark = if ($done -contains $steps[$i].id) { '[x]' } else { '[ ]' }
      Info ("  {0} {1}. {2}" -f $mark, ($i + 1), $steps[$i].name)
    }
    $next = $Step
    $Step = 0
    if ($next -eq 0) {
      $first = 0
      for ($i = 0; $i -lt $steps.Count; $i++) { if ($done -notcontains $steps[$i].id) { $first = $i + 1; break } }
      if ($first -eq 0) { Good '  All done. For a new version see apps/android/play/README.md.'; break }
      $pick = Read-Host "  > Enter for step $first, a number for another step, q to stop"
      if ($pick -match '^[qQ]') { break }
      $next = if ($pick -match '^\d+$') { [int]$pick } else { $first }
    }
    if ($next -lt 1 -or $next -gt $steps.Count) { Bad '  No such step.'; continue }
    $s = $steps[$next - 1]
    try {
      if (& $s.run) { Mark-Done $s.id; Good "  Step $next done." }
      else { Info "  Step $next not finished; run it again when ready." }
    } catch {
      Bad "  $($_.Exception.Message)"
      Info "  Fix that, then pick step $next again."
    }
  }
} catch {
  Bad $_.Exception.Message
  exit 1
}
