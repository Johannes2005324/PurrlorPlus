# PurrlorPlus 0.7.0

Lokale Windows-Erweiterungsfassung auf Grundlage von Purrlor
`07283bc45948c0c124da75d4c043320efe3db69e`.

## Neu in 0.7.0

Eigene Aktualisierungsquelle: Johannes2005324/PurrlorPlus, Veröffentlichungsmarkierungen `plus-vX.Y.Z`.
Die GitHub-Aktion `Purrlor Plus` erstellt und signiert das Plus-Installationspaket. Originale
Purrlor-Veröffentlichungen werden nicht als Plus-Aktualisierungen installiert.
Neue Profile erlauben automatische Prüfungen; vorhandene Einstellungen werden beibehalten.
Bei bisher ausgeschalteter automatischer Aktualisierung den Schalter in Purrlors Programmeinstellungen einschalten.
Prüfung zunächst nach zwei Minuten, danach alle sechs Stunden. Ein geprüftes Paket wird beim
Beenden oder über den Neustartbefehl im Infobereich installiert.
Ohne eingebetteten öffentlichen Schlüssel wird kein Paket automatisch installiert.
Bei der Fassung ohne Installation führt eine automatische Aktualisierung zur regulären Installation;
wer dies nicht möchte, schaltet automatische Aktualisierungen aus.

## Aktualisieren

PurrlorPlus einschließlich des Symbols im Windows-Infobereich beenden.
Dieses Paket in einen neuen Ordner entpacken und mit einer der folgenden BAT-Dateien erstellen.
Bei einer installierten Fassung das neue Installationspaket ausführen. Bei einer ohne Installation
verwendeten Fassung die neu erzeugte EXE aus `dist` starten. Nicht die alte EXE weiterverwenden.
Die bisherigen Konten, Schlüssel, Notizen und Einstellungen bleiben im vorhandenen Datenordner.

## Erstellen und starten

Windows 10 ab 1809 oder Windows 11, .NET-Entwicklungswerkzeuge ab Version 8 und WebView2 werden benötigt.
Der Programmcode zielt weiterhin auf .NET 8. Die Laufzeit wird beim Erstellen mitgeliefert.
Die projektbezogene `NuGet.Config` ist enthalten und wird ausdrücklich beim Erstellen verwendet.

**Ohne Installationspaket und ohne NSIS:** `Build-Portable.bat` öffnen.
Danach `dist\PurrlorPlus.exe` starten. Alle mitgelieferten Dateien müssen zusammen im Ordner bleiben.
`dist\PurrlorPlus-Portable.zip` enthält das vollständige fertige Programmverzeichnis.
„Portable“ bezeichnet hier die Programmauslieferung; persönliche Daten liegen weiterhin unter LocalAppData.

**Mit Installationspaket:** NSIS installieren, dann `Build-PurrlorPlus.bat` öffnen.
Das Ergebnis ist `dist\PurrlorPlus-Setup.exe`.

Auch aus PowerShell möglich:

```powershell
.\Build-PurrlorPlus.bat
```

Zum Starten der Anwendung die erzeugte **EXE** verwenden. BAT und PS1 sind Bauwerkzeuge.
Im ersten Dialog die Adresse einer Purrlor-Oberfläche eingeben, danach anmelden.
Das Programm lädt weiterhin die Oberfläche vom gewählten Server, keinen eigenen Matrix-Server.

## Bedienung und Erweiterungen

„PurrlorPlus“ unten rechts oder „Erweiterungen öffnen“ im Windows-Infobereich öffnet die Verwaltung.
Alle neuen Erweiterungen sind zunächst ausgeschaltet. Schalter, Zustand, Version und Rechte
sind sichtbar; über die Suche lässt sich die Liste filtern.

- **Gestaltung:** Akzentfarbe, Nachrichtenschriftgröße (10–24 px), kompakte Nachrichten.
  Werte ändern und „Gestaltung speichern“ wählen. „Gestaltung zurücksetzen“ setzt nur diese Werte zurück.
  Die Erweiterung muss eingeschaltet sein. Andere Erweiterungen werden dabei nicht neu gestartet.
- **Nachrichtenkennung kopieren:** Rechtsklick auf eine Nachricht öffnet die Kopieraktion.
  Dies ersetzt für Nachrichten das gewöhnliche Kontextmenü. Escape oder ein Klick außerhalb schließt es.
- **Private Benutzernotizen:** Über „Benutzernotizen“ öffnen, vollständige Matrix-Kennung eingeben,
  schreiben und speichern. Gespeicherte Kennungen werden als Liste angezeigt. Eine Kennung auswählen
  oder „Notiz laden“ wählen. Ungespeicherte Änderungen werden beim Laden nicht ohne Bestätigung verworfen.
- **Bilder vergrößern:** Umschalttaste gedrückt halten und auf ein Nachrichtenbild klicken.
  Alternativ Doppelklick; die originale Purrlor-Bildansicht kann dann bereits beim ersten Klick öffnen.
  Vergrößerungsregler, Schließen und Escape bedienen die zusätzliche Ansicht.
- **Ruhiger Lesemodus:** Schreibanzeige und CSS-Animationen im Nachrichtenbereich ausblenden.
  Bereits laufende animierte GIF-Dateien werden dadurch nicht angehalten.
- **Sprachdiagnose:** Siehe den folgenden Abschnitt. Diese Diagnose ist kein bestätigter Sprachfehlerbehelf.

## Neu in 0.6.0

### Eingabefelder und Kurztasten

Tastaturereignisse in der gekapselten PurrlorPlus-Oberfläche werden früh abgefangen, ohne die
normale Texteingabe, Zwischenablage oder Eingabemethoden zu unterbinden. Dadurch löst „N“ dort
nicht mehr Purrlors globale Beitrags-Kurztaste aus. Die Fensterbrücke unterdrückt zusätzlich
neue native Sprachkurztastendrücke während der Bearbeitung in PurrlorPlus; Loslassereignisse
werden weitergegeben, damit eine zuvor gehaltene Sprechtaste nicht hängen bleibt.
Beim Fokuswechsel aus dem Programm wird diese Unterdrückung aufgehoben.

### Absender gelöschter Nachrichten

Ereigniskennungen werden jetzt mit Matrix-Absenderkennungen und zugänglichen Raummitgliedsnamen
verknüpft. Zusammengefasste Nachrichten können den sichtbaren Namen ihrer zusammenhängenden
Gruppe übernehmen. Der Absender einer Löschung wird nicht mit dem Verfasser der gelöschten
Nachricht verwechselt. Erfolgreiche eigene Sende- und Löschantworten werden ebenfalls berücksichtigt;
eigene Nachrichten erscheinen mit bekanntem Anzeigenamen oder „Du“.

Bei einer neuen bestätigten Löschung ohne Absenderkennung wird das ursprüngliche Ereignis
lesend angefragt, soweit das angemeldete Konto Zugriff besitzt. Die Nachricht muss weiterhin
vorher aufgezeichnet worden sein. Für alte Einträge gibt es im Protokoll **Fehlende Absender
ergänzen** (bis zu 20 Einträge je Auswahl, höchstens vier gleichzeitige Abfragen). Bleiben
Ereignis oder Mitgliedsinformation unzugänglich, wird kein Name erfunden. Als letzte bekannte
Information kann eine Benutzerkennung oder „Absender nicht mehr ermittelbar“ erscheinen.

### Videosteuerung überarbeitet

Ein Layoutfehler ist behoben: Die Zusatzsteuerung lag neben dem Video in dessen schmalem
Flex-Bereich. Sie wird jetzt unter dem Medienbereich mit eigener Anordnung angezeigt.
Weitere Videoelemente im Nachrichtenverlauf werden erkannt. Zusätzlich stehen
**Videodaten neu laden** und **Eigenen Videoplayer öffnen** zur Verfügung. Fehler des vollständigen
Downloads stehen nun direkt an der Steuerung. Der eigene Videoplayer besitzt dieselben
Sprung-, Zeit- und vollständigen Ladefunktionen. Videos fremder Seiten innerhalb eines
abgeschotteten eingebetteten Rahmens können nicht direkt gesteuert werden.
Die konkrete Wiedergabe mit dem Video des Benutzers ist hier weiterhin nicht reproduziert.
Die vom Benutzer bestätigte Fenstervergrößerung wurde nicht verändert.

### Automatische Linkumwandlung

Neue Erweiterung **Automatische Linkumwandlung** einschalten. Vorbelegt sind:

```text
x.com = fixupx.com
www.x.com = fixupx.com
```

Unter **Linkumwandlung einstellen** lassen sich höchstens 20 Domainregeln speichern. Linkziele
in der eigenen Ansicht und die Umwandlung beim Einfügen/Schreiben sind getrennt schaltbar.
Die Ansicht verändert nur die lokale Linkdarstellung, keine empfangenen Servernachrichten.
Beim Schreiben wird dagegen der tatsächliche Text im ursprünglichen Eingabefeld angepasst und
bei anschließendem Senden mit diesem geänderten Link verschickt. Die Zwischenablage selbst
wird nicht verändert. Vorhandene React-Eingabeverarbeitung wird über ein Eingabeereignis benachrichtigt.
Dateieinfügungen bleiben beim ursprünglichen Programm.

Es werden ausschließlich passende Domainnamen ersetzt, keine bloßen Teilzeichenfolgen in
anderen Domains. E-Mail-Adressen, Benutzernamen in Adressen und X-Verweise in fremden
URL-Pfaden werden nicht als X-Domain behandelt. Abschalten stellt unverändert gebliebene
lokal umgeschriebene Linkziele wieder her. Bereits geschriebene oder gesendete Texte werden
beim Abschalten nicht nachträglich zurückgeändert.

### Automatischer Chatfokus

Neue Erweiterung **Nachrichtenfeld automatisch fokussieren** einschalten. Beim Öffnen eines
Chats wird das geladene Nachrichtenfeld fokussiert; nach Senden per Eingabetaste oder Sendeknopf
kehrt der Fokus dorthin zurück. Auch verzögert geladene Nachrichtenfelder werden berücksichtigt.
Ein Klick außerhalb des Nachrichtenfelds löst diese Bindung, einschließlich eines Klicks auf
PurrlorPlus-Einstellungen. Fremde Eingaben im Einstellungsfenster sollen dadurch nicht in den
Chat umgelenkt werden. Die Erweiterung kann jederzeit abgeschaltet werden.

## Neu in 0.5.0

### Fensterknopf

Der eigene Fensterknopf erzeugte einen zusätzlichen Klick in `OnMouseUp`, obwohl Windows den
normalen Klick bereits auslöst. Dieser zusätzliche Aufruf ist entfernt. Der Knopf verwendet
jetzt einfache Standardklicks ohne eigene Doppelklickbehandlung. Die Arbeitsbereichskorrektur
für die Taskleiste bleibt bestehen. Der praktische Test unter Windows ist noch erforderlich.

### Gelöschte Nachrichten rot im Chat

„Lokales Nachrichtenprotokoll“ muss eingeschaltet sein. PurrlorPlus beobachtet dann zusätzlich
Kopien der ohnehin empfangenen Matrix-Synchronisations- und Verlaufsantworten; Originalanfragen
und -antworten werden unverändert weitergegeben. Tatsächliche `m.room.redaction`-Ereignisse und
bereits redigierte Ereignisse markieren zuvor aufgezeichnete Texte als gelöscht.
Erst dann erscheint ein roter Hinweis mit gespeichertem Text im zugeordneten Chat.
Die zuvor erfassten Nachbarkennungen werden zur Positionierung verwendet; wenn keine davon mehr
geladen ist, steht der Hinweis am Ende des angezeigten Verlaufs. Es gibt keine Löschvermutung
nur aufgrund von Herausscrollen oder Kanalwechsel. Ist keine sichere Raumzuordnung verfügbar,
bleibt der Eintrag zunächst ausschließlich im Protokoll.

Unverschlüsselte Textnachrichten können jetzt bereits beim Empfang im Hintergrund aufgenommen
werden. Verschlüsselte Rohereignisse enthalten dagegen keinen lesbaren Text; hier muss die
Nachricht zuvor entschlüsselt angezeigt und aufgezeichnet worden sein. War sie schon vor der
Aufzeichnung gelöscht, kann ihr ursprünglicher Text nicht wiederhergestellt werden.
Die vorhandenen Grenzen (500 Nachrichten, begrenzte Textlänge und ältere Fassungen) bleiben erhalten.
Abschalten entfernt die roten Ergänzungen aus dem Chat und stoppt die weitere Aufzeichnung;
gespeicherte Daten bleiben bis zum ausdrücklichen Löschen erhalten.

### Raumnamen

„Beigetretene Räume laden“ zeigt jetzt `Anzeigename · Raumkennung` und sortiert nach Namen.
Die Kennung bleibt der technische Auswahlwert. Namen werden mit höchstens vier gleichzeitigen
Anfragen gelesen. Bei fehlendem Namen folgen kanonischer Alias, ein bereits sichtbarer Kanalname
und zuletzt „Unbenannter Raum“. Nicht erreichbare Namen bleiben entsprechend unaufgelöst.

### Sprachausgabe

Neue Erweiterung **Sprachausgabe und Sprachkanalansagen** einschalten und
„Sprachausgabe einstellen“ öffnen. Stimme, Tempo und Lautstärke lassen sich speichern.
Die vorhandenen System-/Browserstimmen werden angezeigt; lokale Stimmen sind gekennzeichnet.
Ansagen sind auf diesem Rechner hörbar. Außerdem lässt sich eigener Text vorlesen.

Vorlagen können beispielsweise lauten:

- Beitritt: `Willkommen {name} im Sprachkanal {channel}.`
- Verlassen: `{name} hat {channel} verlassen.`

`{name}` wird durch den sichtbaren Anzeigenamen ersetzt, `{channel}` durch den Kanalnamen.
Eine leere Vorlage deaktiviert die betreffende Ansage. „Ansage testen“ prüft Stimme und Vorlage.
Beim Einschalten wird der vorhandene Teilnehmerbestand nicht nachträglich vorgelesen.
Die Warteschlange ist auf fünf Ansagen begrenzt.

Die automatische Erkennung verwendet die eindeutige sichtbare Teilnehmerliste des verbundenen
Sprachkanals. Ist sie ausgeblendet, nicht geladen oder wegen doppelter Kanalnamen mehrdeutig,
werden keine unzuverlässigen Beitritte/Abgänge erfunden. Namenänderungen können in dieser
Oberflächenauswertung als Abgang und neuer Beitritt erscheinen. Abschalten stoppt die Ansagen.

### Bildlupe

Mit eingeschalteter Bilderweiterung ein Bild per Umschalttaste und Klick öffnen.
„Lupe einschalten“ wählen und den Zeiger über das Bild bewegen. Die Lupe zeigt den Bereich
mit dreifacher Vergrößerung. Der vorhandene Vergrößerungsregler bleibt zusätzlich verfügbar.

### Videos vor- und zurückspulen

Neue Erweiterung **Erweiterte Videosteuerung** einschalten. Nachrichten-Videos bekommen eine
zusätzliche Zeitleiste und Tasten für −10/+10 Sekunden. Ist die Dauer noch unbekannt, bleibt
der Regler gesperrt. Der untersuchte Purrlor-Code hat bereits native Videosteuerung und reicht
HTTP-Bereichsanfragen im Medien-Dienst weiter. Der konkrete Fehler des Benutzers konnte hier
nicht mit dessen Video/Server reproduziert werden; diese Fassung ist daher kein bestätigter
serverseitiger Fehlerbehelf.

Wenn das Springen mit der gestreamten Quelle weiterhin scheitert, „Video vollständig laden“
wählen. Die Datei wird auf ausdrückliche Auswahl bis höchstens 100 MB in den Arbeitsspeicher
geladen und als lokale Objektadresse abgespielt. Dadurch ist keine weitere Bereichsanfrage an
den Server nötig. Das Video muss danach gegebenenfalls erneut gestartet werden.
Bei unbekannter Dateigröße wird während des Lesens abgebrochen, sobald die Grenze erreicht ist.
Zugangsdaten werden nur bei einer Matrix-Medienadresse desselben angemeldeten Homeservers benutzt.
Weiterleitungen werden abgelehnt. Nicht unterstützte Videocodecs oder beschädigte Dateien werden
dadurch nicht repariert. Beim Abschalten wird die ursprüngliche Quelle wiederhergestellt.

## Neu in 0.4.0

**Fenstervergrößerung und Taskleiste:** Die rahmenlose Fensterbehandlung berücksichtigt beim
Maximieren jetzt den Arbeitsbereich des jeweiligen Monitors über `WM_GETMINMAXINFO`.
Absolute Bildschirmkoordinaten werden nicht mehr als Maximierungsgrenze gesetzt.
Änderungen des Arbeitsbereichs und der Bildschirmkonfiguration passen maximierte Fenster an.
Das automatische Ausblenden der Taskleiste bleibt eine Windows-Einstellung.
Die Berechnung wurde für sieben Anordnungen geprüft; das tatsächliche Verhalten unter Windows
ist noch nicht praktisch bestätigt. Bitte normalen Maximierungsknopf, Doppelklick auf die
Titelleiste, Win+Pfeil nach oben, einen Bildschirmwechsel und unterschiedliche Skalierungen prüfen.

**Befehlsübersicht:** Die Erweiterung zeigt die elf im untersuchten Purrlor-Quellstand belegten
Befehle beziehungsweise Eingabeformen, einschließlich Moderation, globalem Anzeigenamen und
Fehlerbericht. Suchen und Kopieren sind möglich. Kopieren führt nichts aus. Platzhalter vor dem
Senden ersetzen. Wenig sichtbare Befehle werden auffindbar; nicht an den Rechner gelieferte
Serverfunktionen können nicht aufgelistet und Berechtigungen nicht umgangen werden.

**Lokales Nachrichtenprotokoll:** Zunächst ausgeschaltet. Nach Einschalten werden bereits
angezeigte und neu geladene Textnachrichten mit bestätigter Ereigniskennung lokal erfasst; seit
0.5.0 zusätzlich empfangene unverschlüsselte Textnachrichten aus Matrix-Antworten.
Maximal 500 Nachrichten mit je 4.000 Textzeichen und je drei früheren angezeigten Fassungen.
Textfassungen können sich durch eine Bearbeitung, das Aufdecken eines Spoilers oder Aufklappen
von Text ändern; das Protokoll unterscheidet diese Ursachen nicht zuverlässig. Der sichtbare
Bearbeitungshinweis wird zusätzlich gespeichert, falls vorhanden. Verschwinden aus dem
Nachrichtenverlauf beweist keine Löschung und wird deshalb nicht so eingetragen.
Verdeckte Spoiler, Dateien, Bilder und noch unbestätigte Sendeentwürfe werden nicht aufgenommen.
Zeitpunkt der Beobachtung, vorhandene Sendezeit und sichtbare Namen/Rollenabzeichen werden
getrennt erfasst. Bei zusammengefassten Nachrichten können Name und Rolle fehlen.
Eine belastbare Matrix-Benutzerkennung lässt sich aus dem aktuellen Nachrichtenelement nicht
immer ermitteln; Anzeigenamen werden daher nicht als bestätigte Benutzerkennungen ausgegeben.

Das Protokoll ist nach Konto und Server getrennt, bleibt beim Abschalten erhalten und bietet
Suche, JSON-Ausgabe und bestätigtes Löschen. Speicherfehler halten die Aufzeichnung an und
bewahren den vorherigen Datenbestand. Nach Beheben des Speicherproblems aus- und einschalten.
Eine beschädigte Protokolldatei wird nicht stillschweigend ersetzt.
Die normale Einstellungssicherung enthält das Protokoll **nicht**; dessen eigenen Export verwenden.

**Personen- und Rollenberechtigungen:** Raumkennung eingeben oder beigetretene Raumkennungen laden,
Raum wählen und „Raumzustand lesen“. Gezeigt werden aktuelle Matrix-Stufenschwellen, Rollen und
beigetretene Personen mit ihren Stufen. Die Suche begrenzt die Anzeige auf 200 Personen zugleich.
Falls im Kanal keine eigenen Rollennamen gespeichert sind, wird ein angegebener übergeordneter
Space gelesen, sofern zugänglich. Misslingt dies, bleiben die eingebauten Namen und Kanalstufen.
Explizite Personenstufen, Standardstufen und eigene Rollennamen werden berücksichtigt.
Die Anzeige ist eine Auswertung des sichtbaren Raumzustands und keine vollständige Simulation
aller Serverregeln: Entfernen und Sperren benötigen zusätzlich eine höhere Stufe als das Ziel,
Raumversion, Mitgliedschaft und weitere Regeln können einzelne Aktionen ebenfalls begrenzen.

Ausgewählte Berechtigungsstände lassen sich separat ausgeben oder lokal speichern. Höchstens
zehn Stände bleiben im Journal und sind in dessen Export enthalten. Das ist ein Stand mit
Zeitpunkt und Raumkennung, keine automatisch rekonstruierte Berechtigungshistorie zu jeder
Nachricht. Sämtliche Anfragen sind lesend und verwenden nur die bestehende angemeldete Sitzung;
Zugangstoken werden nicht im Bericht oder Protokoll gespeichert. Abgelehnte Anfragen bleiben
abgelehnt. Kontowechsel und Abschalten brechen laufende Anfragen ab.

Die neuen Funktionen folgen den passenden Ideen von Vencord. Es wird kein Discord-Erweiterungscode
unverändert eingebunden. Purrlor verwendet Matrix-Stufen statt gestapelter Discord-Rollen.

## Neue Nachrichtenwerkzeuge in 0.3.0

- **Schlüsselwortmarkierung:** Einschalten, „Schlüsselwörter bearbeiten“ öffnen, je Zeile ein Wort
  oder einen Ausdruck eingeben und speichern. Bis zu 50 Einträge mit je 80 Zeichen. Passende
  geladene Nachrichten erhalten einen farbigen Rand. Groß- und Kleinschreibung werden ignoriert;
  es wird nach enthaltenen Zeichenfolgen gesucht, nicht ausschließlich nach ganzen Wörtern.
  Neue oder bearbeitete Nachrichten werden automatisch erneut geprüft. Die Liste ist kontogebunden.
- **Lokale Nachrichtensuche:** Einschalten und „Nachrichten durchsuchen“ öffnen. Suchbegriff
  eingeben; eine Ergebniszeile springt zur Originalnachricht und markiert sie. Es werden nur
  bereits geladene Nachrichten der geöffneten Nachrichtenverläufe durchsucht, keine vollständige
  Serverhistorie. Höchstens 100 Ergebnisse werden angezeigt; die Gesamtzahl der Treffer bleibt sichtbar.
  Neue, entfernte oder bearbeitete Nachrichten aktualisieren die Suche automatisch.
- **Genaue Zeitangaben:** Ergänzt vorhandene maschinenlesbare Nachrichtenzeitpunkte um Datum,
  Ortszeit einschließlich Sekunden und Zeitzone. Die Originalanzeige bleibt erhalten.
  Bei zusammengefassten Nachrichten kann ein maschinenlesbarer Zeitpunkt fehlen; dann wird nichts
  erfunden oder aus einer benachbarten Nachricht übernommen.

Suche und Markierung berücksichtigen nur den Nachrichtentext. Verdeckte Spoiler und ausdrücklich
versteckte Textabschnitte sind ausgeschlossen. Aufgedeckte Spoiler sind durchsuchbar.
Texteingaben werden als Text behandelt, nicht als HTML oder reguläre Ausdrücke.
Diese Werkzeuge verändern keine gespeicherten Nachrichten, senden keine Suchbegriffe an den Server
und belassen Originaltexte und Reaktionen unverändert. Abschalten entfernt eigene Markierungen,
Zeitangaben und Ansichten. Bestehende Sicherungen ohne Schlüsselwortliste bleiben lesbar.

## Sprachdiagnose

Der Benutzer hat bestätigt, dass das Sprachproblem behoben ist. Die Sprachverbindung wird in dieser Fassung nicht verändert.
Die bereits vorhandene zuschaltbare Sprachdiagnose bleibt verfügbar und zunächst ausgeschaltet.
Sie beobachtet nur neue WebRTC-Verbindungen, höchstens 32 je Aktivierung und die letzten 120
Zustandsereignisse. Sie erfasst keine IP-Adressen, Zugangstoken, Gesprächsinhalte oder Aufnahmen.
Abschalten entfernt die Beobachter, ohne Sprachverbindungen zu schließen.

## Daten, Sicherung und sicherer Start

Programm: `%LOCALAPPDATA%\Programs\PurrlorPlus`.
Windows-Einstellungen und WebView2-Profil: `%LOCALAPPDATA%\PurrlorPlus`.
Erweiterungseinstellungen und Notizen liegen im lokalen WebView2-Speicher, getrennt nach
Oberflächenadresse, Matrix-Serveradresse und Konto. Abmelden löscht diese Notizen nicht.
Die Ursprungsbezeichnungen `nekous_*`, `xyz.nekous.*` und das Brückenprotokoll bleiben erhalten.

„Als Datei speichern“ sichert Einstellungen samt privaten Notizen des aktuellen Kontos, ohne die separat zu exportierenden Protokolle.
Unter „Einstellungsdatei einlesen“ eine JSON-Datei wählen; alternativ Textfeld und „Einlesen“ verwenden.
Kontofremde Sicherungen, unbekannte Formate und Dateien über 1 MB werden abgewiesen.
Ein während des Einlesens gewechseltes Konto verhindert die Übernahme.
Fehlgeschlagenes Speichern aktiviert keine ungespeicherten Einstellungen.

Beschädigte Daten bleiben unangetastet. „Rohdaten sichern“ zeigt die vorhandenen Daten im Textfeld.
Zuerst kopieren und sichern; anschließend bei Bedarf „Speicherung zurücksetzen“ auswählen und bestätigen.
Das betrifft nur Erweiterungsdaten des aktuellen Kontos, nicht Anmeldung oder Verschlüsselungsschlüssel.

Bei Problemen vollständig beenden, danach:

```powershell
.\PurrlorPlus.exe --safe-mode
```

Alternativ im Infobereich „Ohne Erweiterungen neu starten“. Dabei bleiben gespeicherte Schalter
unverändert; dieser Start führt keine Erweiterung aus. Automatische Programmaktualisierungen verwenden die eigene Plus-Quelle; siehe UPDATE-EINRICHTUNG.md im Paket. Die ursprüngliche Purrlor-Installation und ihr Profil sind getrennt.

## Prüfung und technische Grenzen

61 automatisierte jsdom-Prüfungen bestanden. Sie decken unter anderem Abschalten, Kontowechsel,
Speicherfehler, beschädigte Daten, Einlesen, Entwurfserhalt und die Sprachdiagnose ab. Zusätzliche Prüfungen erfassen Nachrichtensuche, Spoilerschutz,
Zeitangaben, dynamische Nachrichtenänderungen und das Aufräumen bei Kontowechseln.

```powershell
cd tests
npm ci
npm test
```

Anmeldung und Akzentfarbe wurden vom Benutzer unter Windows bestätigt. Die neue Fassung wurde
hier weder unter Windows ausgeführt noch erfolgreich als vollständige EXE erstellt. Der C#-Compiler konnte für die isolierten Fensterberechnungen verwendet werden;
sieben Prüfungen der tatsächlichen C#-Berechnungsfunktion wurden kompiliert und erfolgreich ausgeführt.
Die vollständige Erstellung über MSBuild scheitert hier an Einschränkungen der Prozessinformationen; eine zusätzlich
versuchte Chromium-Installation scheiterte am Browserdownload. Das zuvor gemeldete Sprachproblem ist laut Benutzer behoben.

Nur mitgelieferte, vertrauenswürdige Erweiterungen werden geladen. Es gibt keine allgemeine
Ausführung nativer Rechnerbefehle. Der geschlossene Schattenbaum der Verwaltung ist keine
Sicherheitsabschottung für fremden JavaScript-Code. Der gewählte Server kontrolliert weiterhin die Seite.
Vor einer Weitergabe die Lizenzlage des Gesamtprojekts klären. Die bestehende kurze Lizenzdatei
des Windows-Programms wurde unverändert übernommen.

Die isolierten C#-Prüfungen der Fenstergrenzen liegen in `tests/window-bounds`. Unter Windows ausführen mit:

```powershell
dotnet run --project tests/window-bounds/BoundsChecks.csproj
```

Referenzen für die native Fensterkorrektur:
https://learn.microsoft.com/en-us/windows/win32/winmsg/wm-getminmaxinfo
https://learn.microsoft.com/en-us/windows/win32/api/winuser/ns-winuser-minmaxinfo
