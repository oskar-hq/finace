import Anthropic from '@anthropic-ai/sdk';
import { config } from '../lib/env.js';
import { log } from '../lib/log.js';
import { SYSTEM_PROMPT, RESPONSE_SCHEMA, buildUserPrompt } from './prompt.js';

/**
 * Genau ein Anthropic-Call pro Lauf: alle Kennzahlen, die Gesamteinschaetzung
 * und der Glossarbegriff werden in einer Anfrage erzeugt.
 *
 * Rueckgabe:
 *   { status: 'ok'|'skipped'|'error', explanations: Map<id,string>,
 *     summary, glossary, usage, error }
 */
export async function generateExplanations(snapshots, metricsById, glossaryTerm, dateLabel) {
  const empty = { explanations: new Map(), summary: null, glossary: null, usage: null };

  if (config.skipAi) {
    log.info('KI-Erklaerungen uebersprungen (SKIP_AI=1)');
    return { ...empty, status: 'skipped', error: null };
  }
  if (!config.anthropicApiKey) {
    // Kein Fehlerfall: ohne Key laeuft der Generator vollstaendig durch und
    // schreibt die Marktdaten - nur eben ohne Erklaerungstexte.
    log.info('Kein ANTHROPIC_API_KEY gesetzt - Dashboard wird ohne Erklaerungen erzeugt');
    return { ...empty, status: 'skipped', error: null };
  }

  const client = new Anthropic({ apiKey: config.anthropicApiKey });
  const userPrompt = buildUserPrompt(snapshots, metricsById, glossaryTerm, dateLabel);

  const request = {
    model: config.aiModel,
    max_tokens: config.aiMaxTokens,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  };

  let response;
  try {
    // Bevorzugt mit Structured Outputs - dann ist die Antwort garantiert
    // schema-konformes JSON.
    response = await client.messages.create({
      ...request,
      output_config: { format: { type: 'json_schema', schema: RESPONSE_SCHEMA } },
    });
  } catch (err) {
    log.warn(`Structured Output nicht moeglich (${err.message}) - versuche Klartext-JSON`);
    try {
      response = await client.messages.create({
        ...request,
        messages: [
          {
            role: 'user',
            content:
              `${userPrompt}\n\nAntworte AUSSCHLIESSLICH mit einem JSON-Objekt dieser Form, ohne ` +
              'Code-Fences und ohne Text davor oder danach:\n' +
              '{"summary": "...", "glossary": "...", "metrics": [{"id": "...", "text": "..."}]}',
          },
        ],
      });
    } catch (err2) {
      log.error(`Anthropic-Aufruf fehlgeschlagen: ${err2.message}`);
      return { ...empty, status: 'error', error: err2.message };
    }
  }

  if (response.stop_reason === 'refusal') {
    log.error('Anthropic hat die Anfrage abgelehnt (stop_reason: refusal)');
    return { ...empty, status: 'error', error: 'Anfrage abgelehnt (refusal)' };
  }

  const text = response.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();

  let parsed;
  try {
    parsed = JSON.parse(stripFences(text));
  } catch {
    log.error('Antwort der KI war kein gueltiges JSON');
    return { ...empty, status: 'error', error: 'Antwort war kein gueltiges JSON' };
  }

  const explanations = new Map();
  for (const item of parsed.metrics ?? []) {
    if (item?.id && typeof item.text === 'string') explanations.set(item.id, item.text.trim());
  }

  if (response.stop_reason === 'max_tokens') {
    log.warn('KI-Antwort wurde durch max_tokens abgeschnitten - AI_MAX_TOKENS erhoehen');
  }

  const usage = {
    input_tokens: response.usage?.input_tokens ?? null,
    output_tokens: response.usage?.output_tokens ?? null,
  };
  log.ok(
    `KI-Erklaerungen erzeugt: ${explanations.size}/${snapshots.length} Kennzahlen, ` +
      `${usage.input_tokens} in / ${usage.output_tokens} out Tokens`,
  );

  return {
    status: 'ok',
    explanations,
    summary: typeof parsed.summary === 'string' ? parsed.summary.trim() : null,
    glossary: typeof parsed.glossary === 'string' ? parsed.glossary.trim() : null,
    usage,
    error: null,
  };
}

function stripFences(text) {
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return fenced ? fenced[1] : text;
}
