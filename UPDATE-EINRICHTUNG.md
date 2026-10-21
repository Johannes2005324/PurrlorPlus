# Purrlor Plus 0.7.0: einmalige Einrichtung

Das Paket ergänzt das unveränderte Repository Johannes2005324/PurrlorPlus um alle bisherigen
Plus-Erweiterungen und eine eigene Veröffentlichungsaktion. Der ursprüngliche Purrlor-Code bleibt daneben erhalten.
Es wurde hier noch nichts auf GitHub hochgeladen oder veröffentlicht.

1. Git, PowerShell 7, GitHub CLI installieren. In PowerShell `gh auth login` ausführen und mit
   dem Konto anmelden, das Schreibrechte an Johannes2005324/PurrlorPlus besitzt.
2. Das eigene Repository herunterladen:

   ```powershell
   git clone https://github.com/Johannes2005324/PurrlorPlus.git
   cd PurrlorPlus
   ```

3. Den gesamten Inhalt dieses ZIP-Pakets in diesen Repository-Ordner entpacken.
   Dabei müssen `apps` und `.github` direkt im Repository liegen.
4. `apps\desktop-plus\Setup-Updates.bat` öffnen. Das Programm erzeugt einen eigenen Schlüssel
   oder verwendet den schon vorhandenen. Es hinterlegt `PLUS_UPDATE_SIGNING_KEY` als
   GitHub-Geheimnis und `PLUS_UPDATE_PUBLIC_KEY` als GitHub-Variable. Es speichert nur den
   öffentlichen Schlüssel im Programmordner. Der private Schlüssel liegt im Benutzerverzeichnis
   unter `.purrlorplus-signing\update-private.pem`. Diesen sicher aufbewahren, nie hochladen.
5. Den neuen Programmcode übertragen, im Repository-Hauptordner:

   ```powershell
   git add apps/desktop-plus .github/workflows/desktop-plus.yml UPDATE-EINRICHTUNG.md
   git commit -m "Purrlor Plus 0.7.0 und signierte Aktualisierungen"
   git push
   git tag plus-v0.7.0
   git push origin plus-v0.7.0
   ```

6. Unter GitHub → Actions den Ablauf „Purrlor Plus“ abwarten. Falls GitHub Aktionen bei einem
   abgeleiteten Repository zunächst deaktiviert hat, diese zuerst freischalten. Danach steht unter
   Releases das Paket `PurrlorPlus-Setup.exe` samt Signatur bereit.
7. Diese erste signierte Plus-Fassung einmal selbst installieren. Die bisherige 0.6.0 enthält
   noch keinen Schlüssel und kann diesen Übergang nicht automatisch erledigen. Den Schalter
   für automatische Aktualisierung in den Programmeinstellungen einschalten, falls er bisher aus war.

Für spätere Fassungen die Versionsnummer in `PurrlorPlus.csproj` erhöhen und eine dazu passende
Markierung `plus-vX.Y.Z` übertragen. Den bestehenden Signierschlüssel weiterverwenden.
Keinen neuen Schlüssel pro Veröffentlichung erzeugen: Bereits installierte Programme vertrauen dem alten.
Die laufende Version installiert nur neuere Fassungen, niemals dieselbe Versionsnummer erneut.
Änderungen des ursprünglichen Windows-Programms müssen weiterhin in Plus übernommen werden;
die Oberfläche des gewählten Purrlor-Servers wird wie bisher vom Server geladen.

Geprüft: 61 Erweiterungsprüfungen bestanden. Der neue Windows-Erstellungs- und Veröffentlichungsablauf
konnte hier nicht ausgeführt werden; die erste vollständige Prüfung erfolgt in GitHub Actions.
