const ts = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

export const log = {
  info: (...a) => console.log(`[${ts()}]`, ...a),
  ok: (...a) => console.log(`[${ts()}]   ok  `, ...a),
  warn: (...a) => console.warn(`[${ts()}]  warn`, ...a),
  error: (...a) => console.error(`[${ts()}] ERROR`, ...a),
};
