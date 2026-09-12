// SnapRecord P-005 Tier 2c — transcribe a stored audio file with ONE model.
//   node scripts/transcribe.mjs data/audio/<sha256>.m4a
//
// Model: google/gemini-3.8-flash. Chosen because it is the model the product
// already calls and OpenRouter's live /models list reports its input_modalities
// as ["text","image","video","file","audio"] — checked 2026-09-12 (R-0027).
// The transcript is a derivative (R-0025); the audio bytes stay untouched.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './store.mjs';

for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] ??= m[2];
}

export const TRANSCRIBE_MODEL = 'google/gemini-3.8-flash';

// OpenRouter's audio part takes a bare base64 payload plus a format token,
// not a data: URL. iOS MediaRecorder emits audio/mp4, which is format "mp4".
const FORMAT = { '.m4a': 'mp4', '.mp4': 'mp4', '.aac': 'aac', '.mp3': 'mp3',
                 '.webm': 'webm', '.ogg': 'ogg', '.wav': 'wav' };

const TRANSCRIBE_PROMPT =
  'Transcribe the speech in this audio exactly as spoken. Return only the transcript text: ' +
  'no quotation marks, no preamble, no commentary, no description of the audio. ' +
  'If there is no intelligible speech, return an empty response.';

export async function transcribe(audioPath) {
  const KEY = process.env.OPENROUTER_API_KEY;
  if (!KEY) throw new Error('OPENROUTER_API_KEY ABSENT');
  const ext = path.extname(audioPath).toLowerCase();
  const format = FORMAT[ext] || 'mp4';
  const b64 = fs.readFileSync(audioPath).toString('base64');
  const t0 = Date.now();
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: TRANSCRIBE_MODEL,
      usage: { include: true },
      messages: [{ role: 'user', content: [
        { type: 'text', text: TRANSCRIBE_PROMPT },
        { type: 'input_audio', input_audio: { data: b64, format } },
      ]}],
    }),
  });
  const body = await res.json();
  const elapsed_ms = Date.now() - t0;
  const text = (body?.choices?.[0]?.message?.content ?? '').trim();
  return {
    ok: !body?.error && text.length > 0,
    text,                                   // verbatim, stored as-is (R-0024)
    model: TRANSCRIBE_MODEL,
    format,
    cost: body?.usage?.cost ?? null,
    usage: body?.usage ?? null,
    elapsed_ms,
    error: body?.error ? JSON.stringify(body.error) : (text.length ? null : 'empty transcript'),
    body,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const p = process.argv[2];
  if (!p) { console.error('usage: node scripts/transcribe.mjs <audio file>'); process.exit(2); }
  const r = await transcribe(path.resolve(p));
  console.log(JSON.stringify({ ok: r.ok, model: r.model, format: r.format, cost: r.cost,
                               elapsed_ms: r.elapsed_ms, error: r.error, text: r.text }, null, 2));
  process.exit(r.ok ? 0 : 1);
}
