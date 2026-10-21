param([switch]$Portable)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$project = Join-Path $root "PurrlorPlus\PurrlorPlus.csproj"
$installerDir = Join-Path $root "installer"
$distDir = Join-Path $root "dist"
$publishDir = Join-Path $root "PurrlorPlus\bin\Release\net8.0-windows10.0.17763.0\win-x64\publish"
$bootstrapper = Join-Path $installerDir "MicrosoftEdgeWebview2Setup.exe"
$configFile = Join-Path $root "NuGet.Config"
if (!(Get-Command dotnet -ErrorAction SilentlyContinue)) { throw ".NET-Entwicklungswerkzeuge fehlen. Bitte das .NET SDK installieren." }

$version = ([xml](Get-Content $project)).Project.PropertyGroup.Version | Where-Object { $_ } | Select-Object -First 1
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw "PurrlorPlus.csproj <Version> must be MAJOR.MINOR.PATCH, got '$version'" }

if (Test-Path $distDir) { Remove-Item $distDir -Recurse -Force }
New-Item -ItemType Directory -Force -Path $distDir | Out-Null

if (Test-Path $publishDir) { Remove-Item $publishDir -Recurse -Force }
dotnet publish $project -c Release -r win-x64 --self-contained true /p:PublishSingleFile=false "/p:RestoreConfigFile=$configFile"
if ($LASTEXITCODE -ne 0) { throw "dotnet publish failed" }
if (!(Test-Path (Join-Path $publishDir "PurrlorPlus.exe"))) { throw "Publish failed: PurrlorPlus.exe was not found in $publishDir" }

if ($Portable) {
    Copy-Item -Path (Join-Path $publishDir "*") -Destination $distDir -Recurse -Force
    Compress-Archive -Path (Join-Path $publishDir "*") -DestinationPath (Join-Path $distDir "PurrlorPlus-Portable.zip") -Force
    Write-Host "Fertig: $distDir\PurrlorPlus.exe und PurrlorPlus-Portable.zip"
    exit 0
}

# makensis: on PATH, from the NSIS installer's registry entry, or the default install location.
$nsis = (Get-Command makensis.exe -ErrorAction SilentlyContinue).Source
if (!$nsis) {
    $nsisDir = (Get-ItemProperty "HKLM:\SOFTWARE\WOW6432Node\NSIS" -ErrorAction SilentlyContinue).'(default)'
    if ($nsisDir) { $nsis = Join-Path $nsisDir "makensis.exe" }
}
if (!$nsis -or !(Test-Path $nsis)) { $nsis = "C:\Program Files (x86)\NSIS\makensis.exe" }
if (!(Test-Path $nsis)) { throw "NSIS not found. Install it from https://nsis.sourceforge.io or put makensis.exe on PATH." }
if (!(Test-Path (Join-Path $installerDir "purrlor.ico"))) { throw "Installer icon missing: $installerDir\purrlor.ico" }

# Microsoft's WebView2 bootstrapper, bundled so the installer can add the runtime on machines
# that lack it. Downloaded at build time (not committed) and only accepted with a valid
# Microsoft signature.
if (!(Test-Path $bootstrapper)) {
    Invoke-WebRequest "https://go.microsoft.com/fwlink/p/?LinkId=2124703" -OutFile $bootstrapper -UseBasicParsing
}
$sig = Get-AuthenticodeSignature $bootstrapper
if ($sig.Status -ne "Valid" -or $sig.SignerCertificate.Subject -notmatch "O=Microsoft Corporation") {
    Remove-Item $bootstrapper -Force
    throw "WebView2 bootstrapper signature check failed ($($sig.Status))."
}

Push-Location $installerDir
try {
    & $nsis "/DAPPVERSION=$version" ".\PurrlorPlus.nsi"
    if ($LASTEXITCODE -ne 0) { throw "NSIS failed with exit code $LASTEXITCODE" }
} finally { Pop-Location }

Write-Host "Done. PurrlorPlus $version installer: $distDir\PurrlorPlus-Setup.exe"
