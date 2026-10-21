# Requires PowerShell 7; private keys stay outside the repository.
#Requires -Version 7.0
$ErrorActionPreference = 'Stop'
$repository = 'Johannes2005324/PurrlorPlus'
if (!(Get-Command gh -ErrorAction SilentlyContinue)) { throw 'GitHub CLI fehlt. Installieren und gh auth login ausfÃ¼hren.' }
& gh auth status
if ($LASTEXITCODE -ne 0) { throw 'Bitte zuerst gh auth login ausfÃ¼hren.' }
$keyDirectory = Join-Path ([Environment]::GetFolderPath('UserProfile')) '.purrlorplus-signing'
New-Item -ItemType Directory -Path $keyDirectory -Force | Out-Null
$keyPath = Join-Path $keyDirectory 'update-private.pem'
$key = [Security.Cryptography.ECDsa]::Create(); $key.KeySize = 256
try {
    if (Test-Path $keyPath) { $key.ImportFromPem([IO.File]::ReadAllText($keyPath)) }
    else { [IO.File]::WriteAllText($keyPath, $key.ExportPkcs8PrivateKeyPem()) }
    $publicKey = [Convert]::ToBase64String($key.ExportSubjectPublicKeyInfo())
    [IO.File]::ReadAllText($keyPath) | & gh secret set PLUS_UPDATE_SIGNING_KEY --repo $repository
    if ($LASTEXITCODE -ne 0) { throw 'Privater SchlÃ¼ssel konnte nicht als Repository-Geheimnis hinterlegt werden.' }
    & gh variable set PLUS_UPDATE_PUBLIC_KEY --repo $repository --body $publicKey
    if ($LASTEXITCODE -ne 0) { throw 'Ã–ffentlicher SchlÃ¼ssel konnte nicht hinterlegt werden.' }
    [IO.File]::WriteAllText((Join-Path $PSScriptRoot 'PurrlorPlus/UpdatePublicKey.txt'), $publicKey)
    Write-Host "Eingerichtet. Den privaten SchlÃ¼ssel unter $keyPath sicher aufbewahren. Nicht verÃ¶ffentlichen!"
    Write-Host 'Jetzt den Programmcode hochladen und fÃ¼r die erste VerÃ¶ffentlichung die Markierung plus-v0.7.0 anlegen.'
} finally { if ($null -ne $key) { $key.Dispose() } }

