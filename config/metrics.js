/**
 * Zentrale Kennzahlen-Konfiguration.
 *
 * Hier (und nur hier) werden Kennzahlen ergaenzt, entfernt oder umsortiert.
 *
 * Feld-Referenz
 * -------------
 * id          eindeutiger Schluessel (auch Primaerschluessel in der SQLite-DB)
 * label       Anzeigename im Frontend
 * group       Ueberschrift der Karten-Gruppe im Frontend
 * blurb       kurzer Fixtext unter dem Titel (kein KI-Text)
 * format      { style: 'currency'|'decimal'|'percent', currency, digits, suffix }
 * providers   Liste von Quellen, der Reihe nach probiert. Die erste, die
 *             Daten liefert, gewinnt ("graceful degradation").
 *             { source, symbol, scale?, variant?, note? }
 *             - scale:   Faktor auf den Rohwert (Default 1)
 *             - variant: Name des Index/Kontrakts. Unterscheiden sich die
 *                        Varianten zweier Provider, werden Veraenderungen
 *                        ueber den Quellenwechsel hinweg NICHT berechnet
 *                        (sonst vergleicht man Aepfel mit Birnen).
 * derived     statt providers: aus anderen Kennzahlen berechnet
 *             { op: 'divide'|'multiply', a: <id>, b: <id> }
 * aiHint      Zusatzkontext, der im Prompt an Claude mitgeschickt wird
 */

export const METRICS = [
  {
    id: 'gold_usd',
    label: 'Gold (USD)',
    group: 'Rohstoffe & Realwerte',
    blurb: 'Feinunze in US-Dollar',
    format: { style: 'currency', currency: 'USD', digits: 2 },
    providers: [
      { source: 'stooq', symbol: 'xauusd', variant: 'XAU/USD Spot' },
      { source: 'yahoo', symbol: 'GC=F', variant: 'COMEX Gold Future' },
    ],
    aiHint:
      'Gold ist ein zinsloses Asset. Es konkurriert mit dem Realzins: steigen die Realzinsen, ' +
      'steigen die Opportunitaetskosten von Gold. Zusaetzlich wirken der Dollarkurs und die Nachfrage als "sicherer Hafen".',
  },
  {
    id: 'gold_eur',
    label: 'Gold (EUR)',
    group: 'Rohstoffe & Realwerte',
    blurb: 'Feinunze in Euro (berechnet aus Gold USD / EURUSD)',
    format: { style: 'currency', currency: 'EUR', digits: 2 },
    derived: { op: 'divide', a: 'gold_usd', b: 'eurusd' },
    aiHint:
      'Der Euro-Goldpreis enthaelt zwei Effekte: die Bewegung des Goldpreises selbst und die Bewegung des Wechselkurses. ' +
      'Beide koennen sich verstaerken oder aufheben.',
  },
  {
    id: 'brent',
    label: 'Brent-Rohoel',
    group: 'Rohstoffe & Realwerte',
    blurb: 'Barrel in US-Dollar',
    format: { style: 'currency', currency: 'USD', digits: 2 },
    providers: [
      { source: 'fred', symbol: 'DCOILBRENTEU', variant: 'Brent Spot (EIA via FRED)' },
      { source: 'yahoo', symbol: 'BZ=F', variant: 'ICE Brent Future' },
      { source: 'stooq', symbol: 'cb.f', variant: 'ICE Brent Future' },
    ],
    aiHint:
      'Oel ist ein Vorlaufindikator fuer Inflation: teure Energie verteuert Transport und Produktion. ' +
      'Steigende Inflation kann Notenbanken zu hoeheren Zinsen zwingen - was wiederum auf Gold und Aktien wirkt.',
  },
  {
    id: 'us10y',
    label: 'US-Staatsanleihe 10 Jahre',
    group: 'Zinsen & Waehrungen',
    blurb: 'Rendite in Prozent p. a.',
    format: { style: 'decimal', digits: 2, suffix: ' %' },
    providers: [
      { source: 'fred', symbol: 'DGS10', variant: 'Treasury Constant Maturity 10Y' },
      { source: 'yahoo', symbol: '^TNX', variant: 'CBOE 10Y Yield Index' },
    ],
    aiHint:
      'Die 10-jaehrige US-Rendite ist der wichtigste Referenzzins der Welt. Sie enthaelt Erwartungen ueber ' +
      'Notenbankzinsen, Inflation und Risiko. Aenderungen hier wirken auf praktisch jede andere Anlageklasse.',
  },
  {
    id: 'dollar_index',
    label: 'US-Dollar-Index',
    group: 'Zinsen & Waehrungen',
    blurb: 'Bevorzugt handelsgewichteter Fed-Index (breit), sonst DXY',
    format: { style: 'decimal', digits: 2 },
    providers: [
      {
        source: 'fred',
        symbol: 'DTWEXBGS',
        variant: 'Fed Broad Dollar Index (handelsgewichtet)',
        note: 'Breiter, handelsgewichteter Index der Fed. Basis Jan 2006 = 100.',
      },
      {
        source: 'yahoo',
        symbol: 'DX-Y.NYB',
        variant: 'DXY (ICE)',
        note: 'Klassischer DXY - nur 6 Waehrungen, Euro dominiert mit ~58 %.',
      },
    ],
    aiHint:
      'Ein starker Dollar verteuert Rohstoffe fuer den Rest der Welt und belastet tendenziell Gold. ' +
      'Der handelsgewichtete Fed-Index bildet die reale Handelsstruktur ab, der aeltere DXY nur sechs Waehrungen.',
  },
  {
    id: 'eurusd',
    label: 'EUR/USD',
    group: 'Zinsen & Waehrungen',
    blurb: 'US-Dollar je Euro (EZB-Referenz)',
    format: { style: 'decimal', digits: 4 },
    providers: [
      { source: 'frankfurter', symbol: 'USD', variant: 'EZB-Referenzkurs' },
      { source: 'stooq', symbol: 'eurusd', variant: 'Spot' },
    ],
    aiHint:
      'Der Wechselkurs folgt vor allem der Zinsdifferenz zwischen USA und Euroraum. ' +
      'Fuer einen Anleger im Euroraum entscheidet er mit, wie sich Dollar-Anlagen in Euro entwickeln.',
  },
  {
    id: 'dax',
    label: 'DAX',
    group: 'Aktien & Risiko',
    blurb: 'Deutscher Leitindex (Performanceindex)',
    format: { style: 'decimal', digits: 2 },
    providers: [
      { source: 'stooq', symbol: '^dax', variant: 'DAX Performanceindex' },
      { source: 'yahoo', symbol: '^GDAXI', variant: 'DAX Performanceindex' },
    ],
    aiHint:
      'Der DAX ist ein Performanceindex - Dividenden sind eingerechnet, er steigt dadurch strukturell staerker ' +
      'als reine Kursindizes wie der S&P 500. Er reagiert stark auf Exportnachfrage, Energiepreise und Zinsen.',
  },
  {
    id: 'btc_usd',
    label: 'Bitcoin',
    group: 'Aktien & Risiko',
    blurb: 'BTC in US-Dollar',
    format: { style: 'currency', currency: 'USD', digits: 0 },
    providers: [
      { source: 'coingecko', symbol: 'bitcoin', variant: 'CoinGecko Marktpreis' },
      { source: 'stooq', symbol: 'btcusd', variant: 'Spot' },
    ],
    aiHint:
      'Bitcoin dient hier als Kontrast: ein reines Risiko-Asset ohne Zinsertrag und ohne Cashflow. ' +
      'Es reagiert oft auf dieselben Liquiditaetsbedingungen wie Technologieaktien, nur deutlich staerker.',
  },
  {
    id: 'vix',
    label: 'VIX (Angst-Index)',
    group: 'Aktien & Risiko',
    blurb: 'Erwartete Schwankung des S&P 500, in Prozentpunkten',
    optional: true,
    format: { style: 'decimal', digits: 2 },
    providers: [
      { source: 'stooq', symbol: '^vix', variant: 'CBOE VIX' },
      { source: 'yahoo', symbol: '^VIX', variant: 'CBOE VIX' },
    ],
    aiHint:
      'Der VIX misst die vom Optionsmarkt erwartete Schwankungsbreite des S&P 500 fuer die naechsten 30 Tage. ' +
      'Werte unter 15 gelten als ruhig, ueber 25 als nervoes, ueber 35 als Panik.',
  },
];

/** Zeitfenster fuer Veraenderungen (Kalendertage). */
export const CHANGE_WINDOWS = [
  { key: 'd1', days: 1, label: '1 Tag' },
  { key: 'd5', days: 5, label: '5 Tage' },
  { key: 'd30', days: 30, label: '30 Tage' },
];

/** Rotierendes Glossar. Der Begriff des Tages wird KI-erklaert. */
export const GLOSSARY_TERMS = [
  'Realzins',
  'Opportunitaetskosten',
  'Handelsgewichteter Dollar-Index',
  'Sicherer Hafen',
  'Zinsstrukturkurve',
  'Inverse Zinskurve',
  'Anleihenrendite vs. Anleihenkurs',
  'Leitzins',
  'Kerninflation',
  'Basiseffekt',
  'Risikopraemie',
  'Volatilitaet',
  'Liquiditaet',
  'Carry Trade',
  'Performanceindex vs. Kursindex',
  'Contango und Backwardation',
  'Geldmenge M2',
  'Quantitative Lockerung',
  'Bilanzsumme der Notenbank',
  'Terminkurs (Future)',
  'Spread',
  'Korrelation',
  'Diversifikation',
  'Kaufkraftparitaet',
  'Nominal vs. real',
];
