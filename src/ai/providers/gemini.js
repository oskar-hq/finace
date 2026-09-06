import { config } from '../../lib/env.js';
import { log } from '../../lib/log.js';

/**
 * Google Gemini als Textlieferant fuer die Erklaerungen.
 *
 * Interessant, weil es einen kostenlosen Tarif gibt. Angesprochen wird die
 * REST-Schnittstelle direkt per fetch - so bleibt das Projekt bei genau einer
 * npm-Abhaengigkeit (@anthropic-ai/sdk), statt fuer einen optionalen
 * Zusatzanbieter ein zweites SDK mitzuschleppen.
 *
 * Der Key wird als Header "x-goog-api-key" geschickt, nicht als
 * Query-Parameter - so kann er gar nicht erst in einer URL landen, die
 * irgendwo protokolliert wird. Das gilt fuer alte Standard-Keys (AIza...)
 * genauso wie fuer die neuen Auth-Keys (AQ...).
 */
export const id = 'gemini';
export const label = 'Google Gemini';
export const keyEnvVar = 'GEMINI_API_KEY';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

export function isConfigured() {
  return Boolean(config.geminiApiKey);
}

export function modelName() {
  return config.geminiModel;
}

/**
 * Unser JSON-Schema in Geminis responseSchema uebersetzen.
 *
 * Gemini erwartet eine Teilmenge von OpenAPI 3.0: Typen in Grossbuchstaben,
 * und "additionalProperties" kennt es nicht (fuehrt zu HTTP 400). Die
 * Reihenfolge der Felder muss man ueber propertyOrdering vorgeben, sonst ist
 * sie nicht garantiert.
 */
function toGeminiSchema(schema) {
  if (!schema || typeof schema !== 'object') return schema;

  const out = {};
  if (schema.type) out.type = String(schema.type).toUpperCase();
  if (schema.description) out.description = schema.description;

  if (schema.properties) {
    out.properties = {};
    for (const [key, value] of Object.entries(schema.properties)) {
      out.properties[key] = toGeminiSchema(value);
    }
    out.propertyOrdering = Object.keys(schema.properties);
  }
  if (schema.items) out.items = toGeminiSchema(schema.items);
  if (Array.isArray(schema.required)) out.required = schema.required;

  return out;
}

async function callGemini(body) {
  const url = `${BASE}/models/${encodeURIComponent(config.geminiModel)}:generateContent`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      'x-goog-api-key': config.geminiApiKey,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120000),
  });

  const text = await res.text();
  if (!res.ok) {
    const detail = text.trim().slice(0, 300).replace(/\s+/g, ' ');
    const err = new Error(`Gemini HTTP ${res.status} - ${detail}`);
    err.status = res.status;
    err.body = text;
    throw err;
  }
  return JSON.parse(text);
}

/**
 * Bei einem unbekannten Modellnamen die verfuegbaren Modelle auflisten.
 * Modellnamen aendern sich bei Google haeufig; das erspart das Raten.
 */
async function suggestModels() {
  try {
    const res = await fetch(`${BASE}/models`, {
      headers: { accept: 'application/json', 'x-goog-api-key': config.geminiApiKey },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return [];
    const json = await res.json();
    return (json.models ?? [])
      .filter((m) => (m.supportedGenerationMethods ?? []).includes('generateContent'))
      .map((m) => String(m.name).replace(/^models\//, ''))
      .slice(0, 12);
  } catch {
    return [];
  }
}

/**
 * @returns {Promise<{ text: string, usage: {input_tokens, output_tokens} }>}
 */
export async function generate({ systemPrompt, userPrompt, schema }) {
  const base = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
  };

  let json;
  try {
    json = await callGemini({
      ...base,
      generationConfig: {
        maxOutputTokens: config.aiMaxTokens,
        responseMimeType: 'application/json',
        responseSchema: toGeminiSchema(schema),
      },
    });
  } catch (err) {
    if (err.status === 404) {
      const models = await suggestModels();
      throw new Error(
        `Modell "${config.geminiModel}" gibt es nicht.` +
          (models.length
            ? ` Verfuegbar waeren u.a.: ${models.join(', ')}. Passendes Modell in GEMINI_MODEL eintragen.`
            : ' Verfuegbare Modelle konnten nicht abgefragt werden - Key pruefen.'),
      );
    }
    // Manche Modelle/Tarife lehnen responseSchema ab. Dann ohne Schema, mit
    // der Formatvorgabe im Prompt - dasselbe Muster wie bei Anthropic.
    log.warn(`Gemini: Structured Output nicht moeglich (${err.message}) - versuche Klartext-JSON`);
    json = await callGemini({
      ...base,
      contents: [
        {
          role: 'user',
          parts: [
            {
              text:
                `${userPrompt}\n\nAntworte AUSSCHLIESSLICH mit einem JSON-Objekt dieser Form, ohne ` +
                'Code-Fences und ohne Text davor oder danach:\n' +
                '{"summary": "...", "glossary": "...", "metrics": [{"id": "...", "text": "..."}]}',
            },
          ],
        },
      ],
      generationConfig: { maxOutputTokens: config.aiMaxTokens, responseMimeType: 'application/json' },
    });
  }

  const blocked = json?.promptFeedback?.blockReason;
  if (blocked) throw new Error(`Anfrage von Gemini blockiert (${blocked})`);

  const candidate = json?.candidates?.[0];
  if (!candidate) throw new Error('Gemini hat keine Antwort geliefert');
  if (candidate.finishReason === 'MAX_TOKENS') {
    log.warn('Gemini-Antwort wurde durch maxOutputTokens abgeschnitten - AI_MAX_TOKENS erhoehen');
  } else if (candidate.finishReason && candidate.finishReason !== 'STOP') {
    throw new Error(`Gemini hat abgebrochen (finishReason: ${candidate.finishReason})`);
  }

  return {
    text: (candidate.content?.parts ?? [])
      .map((p) => p.text ?? '')
      .join('')
      .trim(),
    usage: {
      input_tokens: json.usageMetadata?.promptTokenCount ?? null,
      output_tokens: json.usageMetadata?.candidatesTokenCount ?? null,
    },
  };
}
