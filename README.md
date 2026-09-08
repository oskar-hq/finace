# Finanz-Dashboard

Ein persoenliches Markt-Dashboard: Basis-Finanzdaten aus robusten, kostenlosen
Quellen, per Cron aktualisiert – einmal taeglich oder im 15-Minuten-Takt. Es gibt
eine **Monitor-Ansicht ohne Scrollen** (`?kiosk`) fuer einen fest montierten
Bildschirm.

Optional kann pro Tag **ein** KI-Call zu jeder Kennzahl eine kurze Erklaerung
auf Deutsch schreiben – wahlweise ueber **Google Gemini** (kostenloser Tarif)
oder **Anthropic (Claude)**. Das ist ein Zusatz, kein Kern: ohne API-Key laeuft
alles unveraendert durch.

Zwei getrennte Teile:

1. **Generator** (`npm run update`) – laeuft serverseitig per Cron: holt Marktdaten,
   speichert sie in SQLite, berechnet Veraenderungen, laesst sich von Claude die
   Erklaerungen schreiben und legt alles als fertige `public/data/latest.json` ab.
2. **Frontend** (`public/`) – statisches HTML/CSS/JS ohne Build-Schritt. Es liest
   ausschliesslich diese JSON-Datei. Keine API-Calls, keine Secrets im Browser,
   sofortiger Seitenaufbau.

Pro Tag faellt genau **ein** KI-Call an (alle Kennzahlen in einer Anfrage) –
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

**Alle API-Keys sind optional.** Ohne KI-Key laeuft `npm run update`
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
  prune.js              unplausible Werte aus der Datenbank raeumen
  demo.js               synthetische Daten fuers Frontend-Testen
  serve.js              minimaler statischer Server fuer public/
  lib/
    env.js              .env laden + Konfiguration
    db.js               SQLite-Schema und Zugriff
    http.js             fetch mit Timeout und Retry
    dates.js            Datums-Helfer (alles YYYY-MM-DD, UTC)
    analyze.js          Veraenderungen, abgeleitete Reihen, Snapshots
    output.js           JSON atomar schreiben, vorherige Ausgabe lesen
    sdmx.js             CSV-Parser fuer Bundesbank und EZB
    redact.js           API-Keys aus URLs entfernen, bevor sie geloggt werden
  providers/            eine Datei pro Datenquelle, einzeln austauschbar
    index.js            Registry, Fallback-Kette, Ratenlimit
    twelvedata.js  alphavantage.js  cboe.js  stooq.js  yahoo.js  fred.js
    bundesbank.js  ecb.js  frankfurter.js  coingecko.js
  ai/
    prompt.js           System-Prompt, User-Prompt, JSON-Schema
    explain.js          Anbieterwahl + der eine KI-Call pro Tag
    providers/          gemini.js  anthropic.js
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
| Gold USD | **Twelve Data `XAU/USD`** → stooq `xauusd` → Yahoo `GC=F` |
| Gold EUR | berechnet aus Gold USD / EURUSD |
| Brent-Oel | FRED `DCOILBRENTEU` → Yahoo `BZ=F` → stooq `cb.f` → Alpha Vantage `BRENT` |
| US-Rendite 10J | FRED `DGS10` → Yahoo `^TNX` → Alpha Vantage `TREASURY_YIELD` |
| **Bundesanleihe 10J** | **Bundesbank** → EZB-Zinskurve (Euroraum AAA) → FRED (monatlich) |
| US-Dollar-Index | FRED `DTWEXBGS` (handelsgewichtet) → Yahoo `DX-Y.NYB` (DXY) |
| EUR/USD | frankfurter (EZB) → Twelve Data `EUR/USD` → stooq `eurusd` → Alpha Vantage `FX_DAILY` |
| DAX | Yahoo `^GDAXI` → stooq `^dax` → Twelve Data `GDAXI` |
| Bitcoin | CoinGecko → Twelve Data `BTC/USD` → stooq `btcusd` |
| VIX | **CBOE (offiziell, keyfrei)** → Twelve Data `VIX` → Yahoo `^VIX` → stooq `^vix` |

### Warum Twelve Data vorne steht

Auf einem Server gilt: **stooq blockt Rechenzentrums-IP-Bereiche pauschal** (es
kommt HTML statt CSV zurueck), und **Yahoos inoffizielle Chart-API antwortet von
Server-IPs praktisch immer mit HTTP 429**. Betroffen waren damit Gold, DAX und
VIX komplett, weil deren Kette nur aus genau diesen beiden Quellen bestand.

Twelve Data (kostenloser Tarif, Key noetig) steht deshalb bei **Gold** an
erster Stelle. Bei **VIX** uebernimmt inzwischen die CBOE direkt, beim **DAX**
fuehrt Yahoo – Twelve Data liefert dort im freien Tarif keinen Index (siehe die
beiden folgenden Abschnitte). stooq und Yahoo bleiben ueberall als Glieder
dahinter – vom Heimanschluss aus funktionieren sie weiterhin und kosten dort
kein Kontingent.

Zwei Einschraenkungen, die du kennen solltest:

* Der Free-Tier erlaubt **800 Abrufe pro Tag und 8 pro Minute**. Das Ratenlimit
  haelt der Generator selbst ein (`minIntervalMs` im Provider); ein Lauf mit
  mehreren Twelve-Data-Kennzahlen dauert dadurch ein paar Sekunden laenger.
* **Forex und Krypto** (`XAU/USD`, `EUR/USD`, `BTC/USD`) funktionieren im
  kostenlosen Tarif. **Indizes sind das Problem:** `DAX` und `VIX` antworten
  mit HTTP 404 – Twelve Data kennt sie unter diesem Namen nicht.

FRED scheidet fuer Gold uebrigens aus: die Reihe `GOLDAMGBD228NLBM` wurde
eingestellt und liefert keine neuen Werte mehr.

### Das richtige Twelve-Data-Symbol finden

Twelve Data benennt Indizes oft anders als andere Anbieter. Statt zu raten:
**`npm run verify` fragt bei einem 404 automatisch deren Symbolsuche** und
listet die Treffer mit Boerse, Land und Instrumententyp auf. Das passende
Symbol dann in `config/metrics.js` eintragen – fertig.

Beim DAX habe ich bereits `exchange: 'XETR'` entfernt, weil genau diese
Kombination den 404 ausgeloest hat.

### Plausibilitaetsgrenzen: der wichtigste Schutz

Jede Kennzahl hat in `config/metrics.js` ein Feld `sanity: { min, max }`.
Liefert eine Quelle etwas ausserhalb, gilt sie als kaputt und die naechste
Quelle uebernimmt – mit einer klaren Meldung im Log.

Das faengt das gefaehrlichste Fehlerbild dieser Architektur ab: **ein Symbol
existiert, meint aber etwas anderes.** Twelve Data liefert unter `DAX` den
*Global X DAX Germany ETF* (NASDAQ, in Dollar) – rund 46 statt rund 26.000.
Diese Zahl sah im Dashboard voellig plausibel aus; nur eben nicht als DAX.
Genau deshalb steht in der Konfiguration ein Kommentar, dass dieses Symbol
nicht zurueckgeaendert werden darf.

Die Bereiche sind bewusst grosszuegig (DAX 3.000–200.000): sie sollen ueber
Jahre halten und nur grobe Verwechslungen fangen, keine Marktbewegungen.

**Bereits gespeicherte Falschwerte** raeumt `npm run prune` auf – es listet sie
nach Quelle gruppiert auf und loescht erst mit `--yes`:

```bash
npm run prune                        # nur anzeigen
npm run prune -- --metric dax --yes  # loeschen
npm run update                       # Luecken neu fuellen
```

### VIX und DAX ohne Twelve Data

**VIX ist geloest:** Die CBOE berechnet den Index selbst und stellt die
komplette Tageshistorie als CSV bereit – kein Key, keine Bot-Sperre, offizielle
Quelle. Der Provider schneidet direkt auf den angefragten Zeitraum zu, damit
nicht bei jedem Lauf 9000 Zeilen seit 1990 in die Datenbank wandern.

**Beim DAX gibt es keine vergleichbar saubere Gratisquelle.** Die Deutsche
Boerse veroeffentlicht keine freie Kurs-API fuer den Index (ISIN DE0008469008,
WKN 846900, Xetra). Der beste Weg zum echten Index ist deshalb Yahoo `^GDAXI`
mit der Sitzung aus dem naechsten Abschnitt; stooq `^dax` liefert ihn ebenfalls,
aber nur von Heim-IPs.

Bewusst **nicht** als Ersatz eingebaut sind ETFs, die den DAX abbilden – weder
`EWG` (MSCI Germany) noch der Global X DAX Germany ETF, den Twelve Data unter
`DAX` ausliefert. Beide notieren in Dollar bei zweistelligen Kursen. Eine
ehrlich leere Karte ist besser als eine falsche Zahl unter richtigem Namen; die
Plausibilitaetsgrenzen sorgen jetzt dafuer, dass so etwas gar nicht mehr
durchrutschen kann.

Auch **Alpha Vantage hilft beim DAX nicht** – Aktienindizes gehoeren nicht zum
Angebot. Nuetzlich ist es dort, wo es eigene, kostenlose Fachendpunkte hat:
Brent (`BRENT`), US-Rendite (`TREASURY_YIELD:10year`) und Wechselkurse
(`FX_DAILY:EUR/USD`). Genau dafuer ist es als letzte Reserve eingetragen –
letzte Position, weil der freie Tarif nur **25 Abrufe pro Tag** erlaubt und
damit fuer den 15-Minuten-Takt ausscheidet.

### Yahoo: warum HTTP 429, und was dagegen hilft

Yahoos 429 von Server-IPs ist meist **kein** Ratenlimit, sondern eine fehlende
Sitzung. Der Provider baut sie jetzt nach: erst ein Consent-Cookie von
`fc.yahoo.com` holen, damit einen „Crumb" von `/v1/test/getcrumb` abrufen, und
beides an die eigentliche Abfrage haengen. Die Sitzung gilt 30 Minuten und wird
fuer alle Kennzahlen eines Laufs wiederverwendet; laeuft sie ab, wird einmal
automatisch erneuert.

Das ist ein Workaround fuer eine undokumentierte Schnittstelle und kann
jederzeit brechen – deshalb steht Yahoo nirgends an erster Stelle. Klappt der
Sitzungsaufbau nicht, sagt `verify` das jetzt im Klartext statt nur „429".

### stooq

stooq liefert von Rechenzentrums-IPs eine JS-Challenge statt CSV. Der Provider
erkennt das am HTML-Anfang, probiert zusaetzlich `stooq.pl` und meldet dann
verstaendlich, dass der Bot-Schutz zugeschlagen hat. Vom Heimanschluss aus
funktioniert stooq weiterhin – deshalb bleibt es als letztes Glied drin.

### Deutsche Staatsanleihen

Die 10-jaehrige Bundesanleihe kommt primaer von der **Bundesbank** ueber deren
offene REST-Schnittstelle – offizielle Quelle, kein Key, taegliche Werte
(Reihe `BBSIS/D.I.ZST.ZI.EUR.S1311.B.A604.R10XX.R.A.A._Z._Z.A`, Rendite
boersennotierter Bundeswertpapiere mit 10 Jahren Restlaufzeit).

Faellt die aus, greift die **EZB-Zinskurve** für AAA-Emittenten des Euroraums.
Das ist bewusst als eigene Datenbasis gekennzeichnet: die Kurve laeuft nah an
der Bundesanleihe, ist aber nicht dasselbe – deshalb werden Veraenderungen
ueber diesen Quellenwechsel hinweg nicht berechnet (siehe unten). Ganz hinten
steht eine FRED-Reihe, die nur Monatswerte hat; damit sind Tagesveraenderungen
naturgemaess nicht darstellbar.

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

Ein Call pro Tag, alle Kennzahlen gebuendelt, Antwort als schema-validiertes
JSON (faellt automatisch auf normales JSON-Parsing zurueck, falls das Modell
das Format nicht unterstuetzt).

**Zwei Anbieter zur Wahl** – beide bekommen denselben Prompt und dasselbe
Schema aus `src/ai/prompt.js`, die Texte sind also vergleichbar:

| Anbieter | Key | Kosten |
|---|---|---|
| **Google Gemini** | `GEMINI_API_KEY` ([AI Studio](https://aistudio.google.com/apikey)) | kostenloser Tarif |
| **Anthropic (Claude)** | `ANTHROPIC_API_KEY` | rund 1 US-Cent pro Tag |

`AI_PROVIDER` steuert die Wahl: `auto` (Standard) nimmt den ersten Anbieter,
fuer den ein Key hinterlegt ist – **Gemini zuerst, weil kostenlos**. Wer beide
Keys hat und trotzdem Claude will, setzt `AI_PROVIDER=anthropic`.

Die Modellnamen stehen in `GEMINI_MODEL` und `AI_MODEL` (Standard
`claude-haiku-4-5`). Bei Google wechseln die Namen haeufig; passt der
eingetragene nicht, **nennt die Fehlermeldung die tatsaechlich verfuegbaren
Modelle** – der Provider fragt dafuer Googles Modell-Liste ab.

**`GEMINI_MODEL` laesst man am besten leer.** Dann gilt der Alias
`gemini-flash-latest`, und zwei Eigenheiten des kostenlosen Tarifs sind
abgefangen, die im Betrieb wirklich auftreten:

* Die grossen Flash-Modelle antworten dort regelmaessig mit
  `HTTP 503 – high demand`. Der Provider fasst deshalb zweimal nach (2 s, 4 s)
  und weicht danach auf `gemini-flash-lite-latest` aus. In `latest.json` steht
  unter `ai.model`, wer tatsaechlich geantwortet hat. Wer `GEMINI_MODEL` fest
  setzt, bekommt genau dieses Modell und kein Ausweichmanoever.
* Feste Versionsnummern verschwinden mit der Zeit – `gemini-2.5-flash`
  antwortet bereits mit 404. Den Alias zieht Google dagegen nach.

Noch eine Gemini-Eigenheit: das Modell denkt vor der Antwort nach, und diese
internen Tokens zaehlen gegen `AI_MAX_TOKENS`. Sie stehen als
`ai.usage.thinking_tokens` in der Ausgabe (im Testlauf 500–1.600 Stueck);
unter 8.000 wird es damit schnell knapp.

**Warum nur ein Anlauf beim grossen Modell:** der kostenlose Tarif deckelt die
grossen Flash-Modelle bei **20 Anfragen pro Tag und 5 pro Minute**, die
Lite-Modelle dagegen bei **500 bzw. 15**. Jeder Fehlversuch kostet also einen
der 20 Tagesabrufe – Nachfassen lohnt erst dort, wo Wiederholungen billig sind.
Deshalb: einmal beim Standardmodell anklopfen, dann auf das Lite-Modell
wechseln und dort bis zu dreimal (2 s, 4 s).

### Wenn der Morgenlauf ohne Texte bleibt

Kurze Laeufe (`update:quick`) rufen die KI grundsaetzlich nicht auf – sie
reichen die Texte des Volllaufs weiter. **Eine Ausnahme gibt es:** liegen fuer
heute noch gar keine Texte vor, holt der naechste kurze Lauf den Call nach.

Das ist kein Schoenheitsfehler, sondern der Normalfall bei einem kostenlosen
Kontingent: ist der Dienst um 6:30 gerade ueberlastet, haette das Dashboard
sonst den ganzen Tag keine Erklaerungen. So steht es spaetestens eine
Viertelstunde spaeter da. Sobald ein Versuch klappt, ist wieder Ruhe.

`AI_MAX_ATTEMPTS` (Standard 6) deckelt das: so viele fehlgeschlagene KI-Calls
darf ein Tag haben, danach wird bis zum naechsten Morgen nicht mehr gefragt.
Gezaehlt wird ueber die `runs`-Tabelle in der Datenbank.

Der Gemini-Key geht als Header `x-goog-api-key` raus, nicht als
Query-Parameter. So kann er gar nicht erst in einer URL landen, die irgendwo
protokolliert wird. Angesprochen wird die REST-Schnittstelle direkt per
`fetch` – so bleibt das Projekt bei genau einer npm-Abhaengigkeit, statt fuer
einen optionalen Zusatzanbieter ein zweites SDK mitzuschleppen.

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

**Kosten:** rund 2.100 Eingabe- und 1.300–1.600 Ausgabe-Tokens pro Lauf (bei
Gemini kommen die Denk-Tokens obendrauf). Mit Gemini im kostenlosen Tarif also
nichts; mit Haiku 4.5 grob 1 US-Cent pro Tag, etwa 3 US-Dollar im Jahr.

### Betrieb ohne Key

Der KI-Call ist durchgehend optional. Ist weder `GEMINI_API_KEY` noch
`ANTHROPIC_API_KEY` gesetzt (oder steht `SKIP_AI=1`), wird er ohne
Fehlermeldung uebersprungen:

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

**Zuerst die Zeitzone klaeren.** Cron richtet sich nach der Systemzeit des
Containers, und ein frisch aufgesetzter LXC steht meist auf UTC. `30 6 * * *`
feuert dann im Sommer erst um 8:30 Ortszeit – wer morgens um sieben aufs
Dashboard schaut, sieht die Texte des Vortags nicht und die von heute noch
nicht. Entweder den Container umstellen:

```bash
timedatectl set-timezone Europe/Berlin
```

… oder, ohne das System anzufassen, als erste Zeile in den Crontab:

```cron
CRON_TZ=Europe/Berlin
```

Beides folgt automatisch der Sommerzeit. Die Logzeilen bleiben davon
unberuehrt: `src/lib/log.js` schreibt bewusst UTC, wie alle Zeitangaben im
Projekt. Zwischen Logzeit und Wanduhr liegen also im Sommer zwei Stunden – das
ist Absicht, aber gut zu wissen, bevor man einen Lauf fuer ausgefallen haelt.

Fuer ein Dashboard, das man einmal am Tag anschaut, reicht ein Lauf:

```cron
# Taeglich 06:30 - nach dem US-Settlement, vor dem Kaffee.
30 6 * * * cd /opt/finance-dashboard && /usr/bin/npm run update >> /var/log/finance-dashboard.log 2>&1
```

Fuer einen Monitor, der laufend aktuell sein soll, zwei Eintraege:

```cron
# Einmal taeglich der volle Lauf: lange Historie, plus KI-Texte falls Key da.
30 6 * * * cd /opt/finance-dashboard && /usr/bin/npm run update >> /var/log/finance-dashboard.log 2>&1

# Alle 15 Minuten der kurze Lauf, um 5 Minuten versetzt: nur die letzten Tage.
5,20,35,50 * * * * cd /opt/finance-dashboard && /usr/bin/npm run update:quick >> /var/log/finance-dashboard.log 2>&1
```

**Der Versatz ist Absicht.** Mit `*/15` faellt der kurze Lauf einmal taeglich
genau auf die 6:30 des Volllaufs. Beide starten dann in derselben Sekunde,
greifen gleichzeitig auf dieselbe SQLite-Datei zu, und einer von beiden bricht
mit `database is locked` ab. Seit `PRAGMA busy_timeout` wartet der zweite
Lauf, statt zu sterben – aber dann holt er dieselben Daten ein zweites Mal und
verbraucht Abrufe bei Twelve Data. Fuenf Minuten Versatz kosten nichts und
ersparen beides.

`update:quick` holt nur `QUICK_FETCH_DAYS` (Standard 10) statt 180 Tage und
ueberspringt die KI grundsaetzlich. Die lange Historie bleibt erhalten, weil sie
in der Datenbank steht – der kurze Lauf frischt nur die juengsten Tage auf.

**Die Erklaerungstexte ueberleben das.** Findet ein kurzer Lauf eine
`latest.json` vom selben Kalendertag mit Texten, uebernimmt er sie
(`ai.status: "reused"`). Ohne das wuerde der 15-Minuten-Takt die Texte vom
Morgen bei jedem Durchlauf loeschen. Bewusst nur fuer denselben Tag: eine
Einschaetzung von gestern wuerde zu den heutigen Zahlen nicht mehr passen.

**Kontingent im Blick behalten:** 96 kurze Laeufe pro Tag mal der Anzahl
Twelve-Data-Kennzahlen muss unter 800 Abrufen bleiben. Mit den vier
konfigurierten Kennzahlen sind das rund 384 – passt. Wer mehr Kennzahlen ueber
Twelve Data holt, sollte den Takt strecken (`*/30`).

Cron kennt die `.env` nicht – deshalb liest der Generator sie selbst ein
(`src/lib/env.js`). Wichtig ist nur, dass `cd` ins Projektverzeichnis fuehrt.
Bereits gesetzte Umgebungsvariablen haben Vorrang vor der Datei, einzelne Werte
lassen sich also im Cron-Eintrag ueberschreiben.

### Monitor-Ansicht (Kiosk)

`https://finanzen.example.com/?kiosk` zeigt alles auf **einer Bildschirmseite,
ohne Scrollen** – gedacht fuer einen fest montierten Monitor. Weg fallen
Bedienelemente, Fusszeile, Quellenangaben, Tabellen und Erklaerungstexte; die
Schriftgroessen haengen an der Fensterhoehe, damit dieselbe Seite auf einem
24-Zoll-Monitor genauso passt wie auf einem kleinen Panel (geprueft mit
1920×1080 und 1366×768).

Die Seite **laedt sich selbst nach** – im Kiosk alle 60 Sekunden, sonst alle 120.
Sie holt dabei nur die JSON-Datei und zeichnet neu, wenn sich `generated_at`
geaendert hat; ein Browser-Reload ist nie noetig. Anpassen mit `?kiosk&refresh=30`
(Sekunden, Minimum 15). Faellt der Server kurz aus, bleibt die zuletzt
gezeichnete Ansicht stehen, statt leer zu werden.

Im Browser des Monitors einfach Vollbild (F11) und die URL als Startseite
setzen. Der Knopf ⛶ oben rechts schaltet zwischen beiden Ansichten um.

**Wenn eine Aenderung im Browser nicht ankommt:** Der Server liefert HTML, CSS
und JS jetzt mit `ETag` und `cache-control: no-cache` aus, wird also bei jedem
Aufruf revalidiert (ein 304 kostet praktisch nichts, die Dateien sind wenige
KB). Vorher lagen sie 5 Minuten fest im Cache – dabei konnte man neues HTML mit
altem CSS mischen, sodass der Kiosk-Knopf da war, die zugehoerigen CSS-Regeln
aber fehlten und der Klick wirkungslos blieb.

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

* Alle Keys (`GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `TWELVEDATA_API_KEY`,
  `ALPHAVANTAGE_API_KEY`, `FRED_API_KEY`) stehen
  ausschliesslich in `.env` und werden nur serverseitig gelesen. `.env` ist per
  `.gitignore` ausgeschlossen.
* **Keys tauchen nie in Fehlermeldungen auf.** Twelve Data und FRED erwarten den
  Schluessel als Query-Parameter; ohne Gegenmassnahme landet er damit in jeder
  Fehlerzeile – also in der Konsole, in `/var/log` und in jedem Screenshot, den
  man zur Fehlersuche weiterschickt. `src/lib/redact.js` ersetzt bekannte
  Key-Parameter durch `***`, bevor eine URL in eine Meldung geschrieben wird.
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
  Der 15-Minuten-Takt ist gegen eine lokal simulierte Datenquelle geprueft:
  `update:quick` holt den kurzen Zeitraum, ueberspringt die KI und uebernimmt
  die Texte des Tages (`ai.status: "reused"`). Die Kiosk-Ansicht wurde bei
  1920×1080 und 1366×768 gemessen – in beiden Faellen exakt eine
  Bildschirmseite, kein Scrollen –, und das automatische Nachladen wurde
  geprueft, indem die JSON-Datei bei offener Seite geaendert wurde.
  Die CSV-Parser sind gegen nachgebaute Antworten getestet: der SDMX-Parser
  gegen EZB-Format (Komma), Bundesbank-Format (Semikolon, deutsche
  Dezimalkommas), Monatswerte, fehlende Werte (`.`) und eine Datei ohne
  Kopfzeile; der CBOE-Parser gegen gemischte Datumsformate (`M/D/YYYY` und ISO)
  samt Zeitraumfilter. Die Key-Redaktion ist gegen eine echte Twelve-Data-URL
  geprueft. Der Gemini-Anbieter ist gegen einen Mock in Googles Antwortformat
  getestet: kompletter Lauf bis in die `latest.json`, Key kommt als Header an,
  `responseSchema` und `systemInstruction` werden gesendet, ein unbekannter
  Modellname fuehrt zur Liste der verfuegbaren Modelle, und die Anbieterwahl
  stimmt in allen Faellen (nur Gemini, nur Claude, beide, keiner, erzwungen
  ohne Key).
  **Inzwischen auch gegen die echte Gemini-API geprueft:** vollstaendiger Lauf
  mit `AI_PROVIDER=gemini`, Text zu allen zehn Kennzahlen plus
  Gesamteinschaetzung und Begriff des Tages als schema-konformes JSON, sowohl
  mit dem Alias als auch mit fest gesetztem `GEMINI_MODEL`; ein unbekannter
  Modellname liefert wirklich die Modell-Liste. Das Ausweichen bei
  Ueberlastung ist gegen ein erzwungenes `HTTP 503` geprueft (zwei Nachfassen,
  dann `gemini-flash-lite-latest`, und `ai.model` weist das aus). Das
  `HTTP 503` der grossen Flash-Modelle und das 404 auf `gemini-2.5-flash`
  wurden dabei real beobachtet – daher der Alias als Standard.
  Das Nachholen in kurzen Laeufen ist gegen ein dauerhaft mit `503`
  antwortendes Gemini geprueft: Volllauf scheitert, die folgenden kurzen Laeufe
  holen nach, und nach `AI_MAX_ATTEMPTS` ist Schluss. Der Gegentest mit einem
  antwortenden Dienst zeigt das erwartete Gegenstueck: ein Call, danach
  `ai.status: "reused"` ohne weiteren Aufruf.
  Der `busy_timeout` ist mit zwei echten Prozessen geprueft: einer haelt die
  Schreibsperre drei Sekunden, der andere will hinein. Ohne die Einstellung
  bricht er nach 0,0 s mit `database is locked` ab (genau die Meldung aus dem
  Server-Log), mit ihr wartet er und schreibt.
* **Nicht getestet:** die tatsaechlichen HTTP-Abrufe bei Twelve Data, CBOE,
  Bundesbank, EZB, stooq, Yahoo, FRED, frankfurter und CoinGecko sowie der
  KI-Call bei Anthropic – die Entwicklungsumgebung erreicht keinen
  dieser Hosts. (Googles Endpunkt war erreichbar und steht deshalb oben unter
  „getestet".)
  Besonders im Blick behalten: welches Twelve-Data-Symbol der DAX wirklich hat
  (`verify` schlaegt Kandidaten vor), ob der Yahoo-Sitzungsaufbau von deiner
  Server-IP durchgeht, und ob die Bundesbank-Reihe genau dieses CSV-Format
  liefert.

Genau dafuer gibt es `npm run verify`: der Befehl probiert jede einzelne Quelle
aus und zeigt pro Zeile, ob sie antwortet, wie aktuell sie ist und welchen Wert
sie liefert. **Bitte diesen Befehl als Erstes ausfuehren.** Meldet eine Quelle
einen Fehler, ist fast immer nur das Symbol in `config/metrics.js` anzupassen –
haeufige Kandidaten sind die stooq-Kuerzel fuer Futures (`cb.f`) und der
Skalierungsfaktor bei Yahoos `^TNX` (dort gibt es `scale` im Provider-Eintrag,
falls die Rendite um den Faktor 10 danebenliegt).
