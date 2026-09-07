import { config } from '../lib/env.js';
import { log } from '../lib/log.js';
import { SYSTEM_PROMPT, RESPONSE_SCHEMA, buildUserPrompt } from './prompt.js';
import * as anthropic from './providers/anthropic.js';
import * as gemini from './providers/gemini.js';

/**
 * Genau ein KI-Call pro Lauf: alle Kennzahlen, die Gesamteinschaetzung und der
 * Glossarbegriff entstehen in einer einzigen Anfrage.
 *
 * Der Anbieter ist austauschbar. Beide bekommen denselben Prompt und dasselbe
 * JSON-Schema (src/ai/prompt.js) - die Texte sind damit vergleichbar, egal
 * welcher Dienst antwortet.
 *
 * Rueckgabe:
 *   { status: 'ok'|'skipped'|'error', explanations: Map<id,string>,
 *     summary, glossary, usage, provider, model, error }
 */

// Reihenfolge zaehlt bei AI_PROVIDER=auto: Gemini zuerst, weil es einen
// kostenlosen Tarif hat. Wer beide Keys hinterlegt und trotzdem Claude will,
// setzt AI_PROVIDER=anthropic.
const PROVIDERS = [gemini, anthropic];

export function chooseProvider() {
  const wanted = (config.aiProvider || 'auto').toLowerCase();

  if (wanted !== 'auto') {
    const picked = PROVIDERS.find((p) => p.id === wanted);
    if (!picked) {
      return { error: `Unbekannter AI_PROVIDER "${wanted}" - erlaubt: gemini, anthropic, auto` };
    }
    if (!picked.isConfigured()) {
      return { error: `AI_PROVIDER=${wanted}, aber ${picked.keyEnvVar} ist nicht gesetzt` };
    }
    return { provider: picked };
  }

  const picked = PROVIDERS.find((p) => p.isConfigured());
  return picked ? { provider: picked } : { provider: null };
}

export async function generateExplanations(snapshots, metricsById, glossaryTerm, dateLabel) {
  const empty = {
    explanations: new Map(),
    summary: null,
    glossary: null,
    usage: null,
    provider: null,
    model: null,
  };

  if (config.skipAi) {
    log.info('KI-Erklaerungen uebersprungen (SKIP_AI=1)');
    return { ...empty, status: 'skipped', error: null };
  }

  const { provider, error: chooseError } = chooseProvider();
  if (chooseError) {
    log.error(chooseError);
    return { ...empty, status: 'error', error: chooseError };
  }
  if (!provider) {
    // Kein Fehlerfall: ohne Key laeuft der Generator vollstaendig durch und
    // schreibt die Marktdaten - nur eben ohne Erklaerungstexte.
    log.info('Kein KI-Key gesetzt (GEMINI_API_KEY oder ANTHROPIC_API_KEY) - Dashboard ohne Erklaerungen');
    return { ...empty, status: 'skipped', error: null };
  }

  const model = provider.modelName();
  log.info(`KI-Erklaerungen ueber ${provider.label}, Modell ${model}`);

  let result;
  try {
    result = await provider.generate({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: buildUserPrompt(snapshots, metricsById, glossaryTerm, dateLabel),
      schema: RESPONSE_SCHEMA,
    });
  } catch (err) {
    log.error(`${provider.label}: ${err.message}`);
    return { ...empty, status: 'error', provider: provider.id, model, error: err.message };
  }

  let parsed;
  try {
    parsed = JSON.parse(stripFences(result.text));
  } catch {
    log.error(`Antwort von ${provider.label} war kein gueltiges JSON`);
    return {
      ...empty,
      status: 'error',
      provider: provider.id,
      model,
      error: 'Antwort war kein gueltiges JSON',
    };
  }

  const explanations = new Map();
  for (const item of parsed.metrics ?? []) {
    if (item?.id && typeof item.text === 'string') explanations.set(item.id, item.text.trim());
  }

  // Bei Ueberlastung kann ein Ausweichmodell geantwortet haben - fuer Log und
  // Ausgabe zaehlt, wer den Text wirklich geschrieben hat.
  const usedModel = result.model ?? model;
  log.ok(
    `KI-Erklaerungen erzeugt (${usedModel}): ${explanations.size}/${snapshots.length} Kennzahlen, ` +
      `${result.usage.input_tokens} in / ${result.usage.output_tokens} out Tokens` +
      (result.usage.thinking_tokens ? ` (+${result.usage.thinking_tokens} intern)` : ''),
  );

  return {
    status: 'ok',
    explanations,
    summary: typeof parsed.summary === 'string' ? parsed.summary.trim() : null,
    glossary: typeof parsed.glossary === 'string' ? parsed.glossary.trim() : null,
    usage: result.usage,
    provider: provider.id,
    model: usedModel,
    error: null,
  };
}

function stripFences(text) {
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenced ? fenced[1] : text;
}
