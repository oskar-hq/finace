import Anthropic from '@anthropic-ai/sdk';
import { config } from '../../lib/env.js';
import { log } from '../../lib/log.js';

/**
 * Anthropic (Claude) als Textlieferant fuer die Erklaerungen.
 *
 * Kostet Geld, liefert dafuer sehr verlaessliches Deutsch. Standardmodell ist
 * claude-haiku-4-5 - das guenstigste, das fuer diese Aufgabe voellig reicht.
 */
export const id = 'anthropic';
export const label = 'Anthropic (Claude)';
export const keyEnvVar = 'ANTHROPIC_API_KEY';

export function isConfigured() {
  return Boolean(config.anthropicApiKey);
}

export function modelName() {
  return config.aiModel;
}

/**
 * @returns {Promise<{ text: string, usage: {input_tokens, output_tokens} }>}
 */
export async function generate({ systemPrompt, userPrompt, schema }) {
  const client = new Anthropic({ apiKey: config.anthropicApiKey });

  const request = {
    model: config.aiModel,
    max_tokens: config.aiMaxTokens,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  };

  let response;
  try {
    // Bevorzugt mit Structured Outputs - dann ist die Antwort garantiert
    // schema-konformes JSON.
    response = await client.messages.create({
      ...request,
      output_config: { format: { type: 'json_schema', schema } },
    });
  } catch (err) {
    log.warn(`Structured Output nicht moeglich (${err.message}) - versuche Klartext-JSON`);
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
  }

  if (response.stop_reason === 'refusal') {
    throw new Error('Anfrage abgelehnt (stop_reason: refusal)');
  }
  if (response.stop_reason === 'max_tokens') {
    log.warn('KI-Antwort wurde durch max_tokens abgeschnitten - AI_MAX_TOKENS erhoehen');
  }

  return {
    text: response.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim(),
    usage: {
      input_tokens: response.usage?.input_tokens ?? null,
      output_tokens: response.usage?.output_tokens ?? null,
    },
  };
}
