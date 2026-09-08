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

/**
 * Standardmodell: bewusst der Alias und keine feste Versionsnummer. Google
 * zieht ihn auf das jeweils aktuelle Flash-Modell nach, waehrend konkrete
 * Versionen mit der Zeit verschwinden - `gemini-2.5-flash` antwortet heute
 * schon mit HTTP 404. Ein Dashboard im Cron-Betrieb soll deswegen nicht eines
 * Tages stumm ausfallen.
 */
export const DEFAULT_MODEL = 'gemini-flash-latest';

/**
 * Ausweichmodell, wenn das eingestellte ueberlastet ist.
 *
 * Der kostenlose Tarif teilt sich die Kapazitaet mit vielen anderen: die
 * grossen Flash-Modelle antworten dort regelmaessig mit HTTP 503 ("high
 * demand"), waehrend die Lite-Variante in denselben Sekunden durchlaeuft.
 * Statt den Tageslauf ohne Texte zu beenden, wird dann das kleinere Modell
 * gefragt - erkennbar an ai.model in der latest.json.
 *
 * Nur aktiv, solange GEMINI_MODEL beim Standard steht: wer ein Modell fest
 * vorgibt, bekommt genau dieses.
 */
const BUSY_FALLBACK_MODEL = 'gemini-flash-lite-latest';

/** Ueberlastet (503) oder Kontingent erschoepft (429) - hier lohnt Warten. */
const isBusy = (err) => err.status === 429 || err.status === 503;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function isConfigured() {
  return Boolean(config.geminiApiKey);
}

/** Leeres GEMINI_MODEL heisst: Standardmodell samt Ausweichkette. */
const activeModel = () => config.geminiModel || DEFAULT_MODEL;

export function modelName() {
  return activeModel();
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

async function callGemini(body, model = config.geminiModel) {
  const url = `${BASE}/models/${encodeURIComponent(model)}:generateContent`;
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
 * Der eine Call pro Tag soll nicht an einer Lastspitze scheitern: bei 429/503
 * nachfassen (2s, 4s) und danach das Ausweichmodell probieren.
 *
 * Die Versuche sind ungleich verteilt, und zwar entlang der Kontingente des
 * kostenlosen Tarifs: die grossen Flash-Modelle erlauben dort nur 20 Anfragen
 * pro Tag und 5 pro Minute, die Lite-Modelle dagegen 500 bzw. 15. Beim
 * Standardmodell lohnt Nachfassen deshalb nicht - jeder Fehlversuch kostet
 * einen der 20 Tagesabrufe. Also einmal anklopfen und dann dorthin wechseln,
 * wo Wiederholungen billig sind.
 *
 * @returns {Promise<{ json: object, model: string }>}
 */
async function callGeminiResilient(body) {
  const models = config.geminiModel ? [config.geminiModel] : [DEFAULT_MODEL, BUSY_FALLBACK_MODEL];
  const attemptsFor = (model) => (models.length > 1 && model === models[0] ? 1 : 3);

  let lastErr;
  for (const model of models) {
    const attempts = attemptsFor(model);
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        return { json: await callGemini(body, model), model };
      } catch (err) {
        lastErr = err;
        if (!isBusy(err)) throw err;
        if (attempt < attempts - 1) {
          log.warn(`${model} gerade ueberlastet (HTTP ${err.status}) - neuer Versuch`);
          await sleep(2000 * 2 ** attempt);
        }
      }
    }
    const next = models[models.indexOf(model) + 1];
    if (next) log.warn(`${model} ueberlastet (HTTP ${lastErr.status}) - weiter mit ${next}`);
  }
  throw lastErr;
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
 * @returns {Promise<{ text: string, usage: object, model: string }>}
 *          model = das Modell, das tatsaechlich geantwortet hat (kann bei
 *          Ueberlastung das Ausweichmodell sein).
 */
export async function generate({ systemPrompt, userPrompt, schema }) {
  const base = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
  };

  let json;
  let model;
  try {
    ({ json, model } = await callGeminiResilient({
      ...base,
      generationConfig: {
        maxOutputTokens: config.aiMaxTokens,
        responseMimeType: 'application/json',
        responseSchema: toGeminiSchema(schema),
      },
    }));
  } catch (err) {
    if (err.status === 404) {
      const models = await suggestModels();
      throw new Error(
        `Modell "${activeModel()}" gibt es nicht.` +
          (models.length
            ? ` Verfuegbar waeren u.a.: ${models.join(', ')}. Passendes Modell in GEMINI_MODEL eintragen.`
            : ' Verfuegbare Modelle konnten nicht abgefragt werden - Key pruefen.'),
      );
    }
    // Ueberlastung ist kein Formatproblem - da hat callGeminiResilient bereits
    // alles versucht, und ein Call ohne Schema wuerde genauso abgewiesen.
    if (isBusy(err)) throw err;
    // Manche Modelle/Tarife lehnen responseSchema ab. Dann ohne Schema, mit
    // der Formatvorgabe im Prompt - dasselbe Muster wie bei Anthropic.
    log.warn(`Gemini: Structured Output nicht moeglich (${err.message}) - versuche Klartext-JSON`);
    ({ json, model } = await callGeminiResilient({
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
    }));
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
    model,
    // Denk-Bloecke sind kein Antworttext und haben im JSON nichts zu suchen.
    text: (candidate.content?.parts ?? [])
      .filter((p) => !p.thought)
      .map((p) => p.text ?? '')
      .join('')
      .trim(),
    usage: {
      input_tokens: json.usageMetadata?.promptTokenCount ?? null,
      output_tokens: json.usageMetadata?.candidatesTokenCount ?? null,
      // Gemini denkt vor der Antwort nach. Diese Tokens stehen nicht im Text,
      // zaehlen aber gegen AI_MAX_TOKENS - darum hier sichtbar gemacht.
      thinking_tokens: json.usageMetadata?.thoughtsTokenCount ?? null,
    },
  };
}
