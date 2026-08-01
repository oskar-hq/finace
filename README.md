# Finanz-Dashboard

Ein persoenliches Markt-Dashboard, das einmal taeglich per Cron aktualisiert wird
und zu jeder Kennzahl eine kurze, verstaendliche Erklaerung auf Deutsch mitliefert.
Gedacht als taegliches Lernwerkzeug, nicht als Trading-Terminal.

Zwei getrennte Teile:

1. **Generator** (`npm run update`) – laeuft serverseitig per Cron: holt Marktdaten,
   speichert sie in SQLite, berechnet Veraenderungen, laesst sich von Claude die
   Erklaerungen schreiben und legt alles als fertige `public/data/latest.json` ab.
2. **Frontend** (`public/`) – statisches HTML/CSS/JS ohne Build-Schritt. Es liest
   ausschliesslich diese JSON-Datei. Keine API-Calls, keine Secrets im Browser,
   sofortiger Seitenaufbau.

Pro Tag faellt genau **ein** Anthropic-Call an (alle Kennzahlen in einer Anfrage) –
und auch der ist optional: ohne API-Key laeuft alles durch, nur eben ohne Texte.

---

## Schnellstart

```bash
git clone <repo> && cd finace
npm install
cp .env.example .env      # beide Keys sind optional, siehe unten

npm run verify            # Welche Datenquellen sind erreichbar?
npm run update            # Daten holen + Erklaerungen erzeugen
npm run serve             # http://127.0.0.1:8080
```

**Beide API-Keys sind optional.** Ohne `ANTHROPIC_API_KEY` laeuft `npm run update`
vollstaendig durch und schreibt die Marktdaten – es entfallen nur die
Erklaerungstexte, die Gesamteinschaetzung und der Begriff des Tages. Die Karten
zeigen dann Wert, Veraenderungen und Verlauf ohne Textblock; oben steht ein
dezenter Hinweis. Sobald ein Key hinterlegt ist, sind die Texte beim naechsten
Lauf wieder da – ohne weitere Aenderung.

Ohne API-Keys und ohne Internet zuerst nur das Layout ansehen:

```bash
npm run demo && npm run serve
```

`npm run demo` erzeugt eine `latest.json` aus **synthetischen** Zahlen (eigene
Datenbank `data/demo.db`, die echte bleibt unberuehrt). Die Seite kennzeichnet
das oben deutlich als Demo.

**Voraussetzung:** Node.js **≥ 22.5** – das Projekt nutzt das eingebaute
`node:sqlite` und hat damit keine nativen Abhaengigkeiten (kein
`better-sqlite3`, keine Build-Toolchain im LXC). Einzige npm-Abhaengigkeit ist
das offizielle `@anthropic-ai/sdk`.

---

## Projektstruktur

```
config/metrics.js       <- ZENTRALE Kennzahlen-Konfiguration (hier erweitern)
src/
  update.js             Cron-Einstiegspunkt: holen -> speichern -> erklaeren -> JSON
  verify.js             Quellen-Check ohne Seiteneffekte
  demo.js               synthetische Daten fuers Frontend-Testen
  serve.js              minimaler statischer Server fuer public/
  lib/
    env.js              .env laden + Konfiguration
    db.js               SQLite-Schema und Zugriff
    http.js             fetch mit Timeout und Retry
    dates.js            Datums-Helfer (alles YYYY-MM-DD, UTC)
    analyze.js          Veraenderungen, abgeleitete Reihen, Snapshots
    output.js           atomares Schreiben der JSON-Datei
  providers/            eine Datei pro Datenquelle, einzeln austauschbar
    index.js  stooq.js  yahoo.js  fred.js  frankfurter.js  coingecko.js
  ai/
    prompt.js           System-Prompt, User-Prompt, JSON-Schema
    explain.js          der eine Anthropic-Call pro Tag
    glossary.js         Rotation "Begriff des Tages"
public/
  index.html  styles.css  app.js
  data/latest.json      <- erzeugt, nicht eingecheckt
data/finance.db         <- erzeugt, nicht eingecheckt
```

---

## Kennzahlen

| Kennzahl | Quellenkette (erste erreichbare gewinnt) |
|---|---|
| Gold USD | stooq `xauusd` → Yahoo `GC=F` |
| Gold EUR | berechnet aus Gold USD / EURUSD |
| Brent-Oel | FRED `DCOILBRENTEU` → Yahoo `BZ=F` → stooq `cb.f` |
| US-Rendite 10J | FRED `DGS10` → Yahoo `^TNX` |
| US-Dollar-Index | FRED `DTWEXBGS` (handelsgewichtet) → Yahoo `DX-Y.NYB` (DXY) |
| EUR/USD | frankfurter (EZB) → stooq `eurusd` |
| DAX | stooq `^dax` → Yahoo `^GDAXI` |
| Bitcoin | CoinGecko → stooq `btcusd` |
| VIX | stooq `^vix` → Yahoo `^VIX` |

### Kennzahl hinzufuegen

Nur `config/metrics.js` anfassen – ein Eintrag mehr im Array `METRICS`:

```js
{
  id: 'sp500',
  label: 'S&P 500',
  group: 'Aktien & Risiko',
  blurb: 'US-Leitindex (Kursindex)',
  format: { style: 'decimal', digits: 2 },
  providers: [
    { source: 'stooq', symbol: '^spx', variant: 'S&P 500' },
    { source: 'yahoo', symbol: '^GSPC', variant: 'S&P 500' },
  ],
  aiHint: 'Kurzer fachlicher Kontext, der in den Prompt wandert.',
}
```

Danach `npm run verify` – dort sieht man sofort, ob das Symbol stimmt.
Frontend und Datenbank ziehen automatisch nach; `group` erzeugt bei Bedarf
eine neue Abschnittsueberschrift.

Eine neue **Datenquelle** ist eine Datei in `src/providers/` mit
`id`, `label`, `needsKey`, optional `isConfigured()` und
`fetchSeries(spec, { from, to })`, die `[{ date, value }, …]` liefert – plus ein
Eintrag in `src/providers/index.js`. Sonst aendert sich nichts.

---

## Robustheit: was passiert, wenn eine Quelle ausfaellt

* Innerhalb einer Kennzahl wird die naechste Quelle probiert (`http.js` macht
  je Versuch zwei Retries mit wachsender Wartezeit).
* Faellt die ganze Kette aus, zeigt die Karte **„Daten aktuell nicht verfuegbar"**,
  alle anderen Kennzahlen erscheinen normal. Der Generator bricht nicht ab.
* Sind noch alte Werte in der Datenbank, werden diese weiter angezeigt, mit
  Hinweis auf das Datum, sobald sie aelter als 5 Tage sind.
* Die JSON-Datei wird atomar geschrieben (`.tmp` + `rename`) – die Seite sieht
  nie eine halbfertige Datei.
* Exit-Code 1 nur dann, wenn **keine einzige** Kennzahl aktualisiert werden
  konnte – daran kann ein Monitoring haengen.

**Ein Detail, das leicht zu uebersehen ist:** Beim US-Dollar-Index liefert FRED
den handelsgewichteten Fed-Index (Basis ~100), Yahoo dagegen den klassischen DXY
(anderes Niveau, andere Zusammensetzung). Bei einem Quellenwechsel darf man die
Werte nicht miteinander vergleichen. Deshalb speichert die Datenbank zu jedem
Wert die Quelle, und Veraenderungen werden **nur innerhalb derselben Quelle**
berechnet. Nach einem Wechsel steht bei den betroffenen Zeitraeumen „–", bis
genug Historie aus der neuen Quelle vorliegt. Das ist Absicht, kein Fehler.

---

## Die KI-Erklaerungen

Ein Call pro Tag mit `claude-haiku-4-5`, alle Kennzahlen gebuendelt, Antwort als
schema-validiertes JSON (Structured Outputs; faellt automatisch auf normales
JSON-Parsing zurueck, falls das Modell das Format nicht unterstuetzt).

Der System-Prompt (`src/ai/prompt.js`) legt fest:

* pro Kennzahl 2–4 Saetze, die drei Dinge leisten: **was ist passiert**,
  **welcher Mechanismus steckt typischerweise dahinter**, **was sagt die
  Kennzahl grundsaetzlich aus**;
* das Modell hat **keinen** Zugriff auf Nachrichten und darf deshalb **keine**
  konkreten Ausloeser erfinden – Ursachen werden ausdruecklich als Moeglichkeit
  formuliert („typischerweise steckt dahinter …", „koennte damit zusammenhaengen,
  dass …");
* Bewegungen unter ~0,5 % werden als Rauschen benannt statt weggedeutet;
* keine Anlageberatung, keine Kursprognosen, kein Markdown.

Dazu kommen eine Gesamteinschaetzung ueber alle Kennzahlen und der **Begriff des
Tages** aus der Liste in `config/metrics.js` – rotierend, sodass erst alle 25
Begriffe durchlaufen, bevor sich einer wiederholt.

**Kosten:** rund 1.400 Eingabe- und 1.500 Ausgabe-Tokens pro Lauf. Mit Haiku 4.5
sind das grob 1 US-Cent pro Tag, also etwa 3 US-Dollar im Jahr.

### Betrieb ohne Key

Der Anthropic-Call ist durchgehend optional. Ist kein `ANTHROPIC_API_KEY`
gesetzt (oder steht `SKIP_AI=1`), wird er ohne Fehlermeldung uebersprungen:

* `npm run update` laeuft normal durch und schreibt `latest.json` mit allen
  Marktdaten. Der Exit-Code haengt allein daran, ob Daten geholt werden konnten –
  ein fehlender Key fuehrt nie zu Exit-Code 1.
* Kennzahlen ohne Erklaerung enthalten das Feld `explanation` gar nicht erst;
  das Frontend rendert dann schlicht keinen Textblock – keinen leeren Kasten.
* Gesamtbild, Begriff des Tages und der KI-Hinweis im Fuss erscheinen nur,
  wenn es dazu auch Text gibt.
* Der Begriff des Tages wird erst dann als „verbraucht" vermerkt, wenn er
  wirklich erklaert wurde. Ohne Key wandert die Rotation also nicht weiter,
  und der erste Lauf mit Key faengt sauber vorne an.

Dasselbe gilt, wenn der Call scheitert (Netzwerkfehler, Rate-Limit): die Zahlen
erscheinen trotzdem, oben steht dann ein Hinweis mit der Fehlerursache.

---

## Betrieb im LXC

### Cron

```bash
crontab -e
```

```cron
# Taeglich 06:30 - nach dem US-Settlement, vor dem Kaffee.
30 6 * * * cd /opt/finance-dashboard && /usr/bin/npm run update >> /var/log/finance-dashboard.log 2>&1
```

Cron kennt die `.env` nicht – deshalb liest der Generator sie selbst ein
(`src/lib/env.js`). Wichtig ist nur, dass `cd` ins Projektverzeichnis fuehrt.
Bereits gesetzte Umgebungsvariablen haben Vorrang vor der Datei, einzelne Werte
lassen sich also im Cron-Eintrag ueberschreiben.

### Frontend ausliefern

Ausgeliefert wird ausschliesslich der Ordner **`public/`**.

Variante A – der mitgelieferte Server:

```bash
npm run serve     # lauscht auf 127.0.0.1:8080 (HOST/PORT in .env)
```

Als systemd-Dienst:

```ini
# /etc/systemd/system/finance-dashboard.service
[Unit]
Description=Finanz-Dashboard (statisch)
After=network.target

[Service]
WorkingDirectory=/opt/finance-dashboard
ExecStart=/usr/bin/npm run serve
Restart=on-failure
User=finance

[Install]
WantedBy=multi-user.target
```

Variante B – nginx/Caddy mit `root /opt/finance-dashboard/public;`. Dann wird
`src/serve.js` gar nicht gebraucht.

### Cloudflare Tunnel

Da nur statische Dateien ausgeliefert werden, genuegt ein Ingress auf den
lokalen Port:

```yaml
# ~/.cloudflared/config.yml
tunnel: <tunnel-id>
credentials-file: /root/.cloudflared/<tunnel-id>.json
ingress:
  - hostname: finanzen.example.com
    service: http://127.0.0.1:8080
  - service: http_status:404
```

Der Server bindet standardmaessig auf `127.0.0.1` – von aussen erreichbar ist er
also nur ueber den Tunnel. Ein Zugriffsschutz (Cloudflare Access) ist sinnvoll,
auch wenn die Seite keine Geheimnisse enthaelt.

---

## Sicherheit

* `ANTHROPIC_API_KEY` und `FRED_API_KEY` stehen ausschliesslich in `.env` und
  werden nur serverseitig gelesen. `.env` ist per `.gitignore` ausgeschlossen.
* Das Frontend bekommt nur die fertige JSON-Datei – dort steht kein Key und
  keine URL mit Key.
* Auch die SQLite-Datenbank (`data/`) und die erzeugte `public/data/latest.json`
  sind aus Git ausgenommen.

---

## Zum Stand der Tests

Ehrlich dazugesagt, damit klar ist, was hier bereits lief und was nicht:

* **Getestet:** Datenbank-Schema und Zeitreihen-Logik, Berechnung der
  Veraenderungen, abgeleitete Kennzahlen, Glossar-Rotation, Prompt-Aufbau,
  JSON-Ausgabe, der statische Server sowie das Frontend in Hell, Dunkel und auf
  Mobilgeroessen (ueber `npm run demo`). Ebenfalls geprueft: ein kompletter
  Lauf ohne `ANTHROPIC_API_KEY` gegen eine lokal simulierte Datenquelle –
  Exit-Code 0, vollstaendige `latest.json`, und im Frontend weder leere
  Textkaesten noch ein Glossarblock ohne Inhalt.
* **Nicht getestet:** die tatsaechlichen HTTP-Abrufe bei stooq, Yahoo, FRED,
  frankfurter und CoinGecko sowie der Anthropic-Call – die Entwicklungsumgebung
  hatte weder Zugriff auf diese Hosts noch einen API-Key. Die Symbole stammen
  aus der Dokumentation der jeweiligen Anbieter und sind nicht gegen die Live-API
  geprueft.

Genau dafuer gibt es `npm run verify`: der Befehl probiert jede einzelne Quelle
aus und zeigt pro Zeile, ob sie antwortet, wie aktuell sie ist und welchen Wert
sie liefert. **Bitte diesen Befehl als Erstes ausfuehren.** Meldet eine Quelle
einen Fehler, ist fast immer nur das Symbol in `config/metrics.js` anzupassen –
haeufige Kandidaten sind die stooq-Kuerzel fuer Futures (`cb.f`) und der
Skalierungsfaktor bei Yahoos `^TNX` (dort gibt es `scale` im Provider-Eintrag,
falls die Rendite um den Faktor 10 danebenliegt).
