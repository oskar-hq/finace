import { GLOSSARY_TERMS } from '../../config/metrics.js';
import { recentGlossaryTerms, recordGlossaryTerm } from '../lib/db.js';

/**
 * Waehlt den "Begriff des Tages": den am laengsten nicht verwendeten Begriff
 * aus der Liste in config/metrics.js. So rotiert das Glossar vollstaendig,
 * bevor sich etwas wiederholt.
 *
 * Waehlen und Vormerken sind bewusst getrennt: Laeuft der Generator ohne
 * ANTHROPIC_API_KEY, gibt es keine Erklaerung zum Begriff - dann darf er auch
 * nicht als "schon dagewesen" gelten, sonst wandert die Rotation Tag fuer Tag
 * weiter, ohne dass je ein Begriff erklaert wurde.
 */
export function chooseGlossaryTerm(db) {
  if (GLOSSARY_TERMS.length === 0) return null;

  const recent = recentGlossaryTerms(db, GLOSSARY_TERMS.length);
  const unused = GLOSSARY_TERMS.filter((t) => !recent.includes(t));

  // `recent` ist neueste-zuerst sortiert: ein hoher Index heisst "lange her".
  return unused.length > 0
    ? unused[0]
    : GLOSSARY_TERMS.slice().sort((a, b) => recent.indexOf(b) - recent.indexOf(a))[0];
}

/** Erst aufrufen, wenn zu dem Begriff wirklich eine Erklaerung vorliegt. */
export function markGlossaryTermUsed(db, term, date) {
  if (term) recordGlossaryTerm(db, term, date);
}
