import { GLOSSARY_TERMS } from '../../config/metrics.js';
import { recentGlossaryTerms, recordGlossaryTerm } from '../lib/db.js';

/**
 * Waehlt den "Begriff des Tages": den am laengsten nicht verwendeten Begriff
 * aus der Liste in config/metrics.js. So rotiert das Glossar vollstaendig,
 * bevor sich etwas wiederholt.
 */
export function pickGlossaryTerm(db, date) {
  if (GLOSSARY_TERMS.length === 0) return null;

  const recent = recentGlossaryTerms(db, GLOSSARY_TERMS.length);
  const unused = GLOSSARY_TERMS.filter((t) => !recent.includes(t));

  // `recent` ist neueste-zuerst sortiert: ein hoher Index heisst "lange her".
  const term = unused.length > 0
    ? unused[0]
    : GLOSSARY_TERMS.slice().sort((a, b) => recent.indexOf(b) - recent.indexOf(a))[0];

  recordGlossaryTerm(db, term, date);
  return term;
}
