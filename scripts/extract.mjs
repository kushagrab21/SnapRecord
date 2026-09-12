// SnapRecord P-002: one extraction call. Dependency-free.
// Usage: node scripts/extract.mjs --image <path> --model <id> --schema v1 --out <tag>
//   writes supervision/evidence/responses/<tag>-raw.json  (provider body, verbatim)
//          supervision/evidence/responses/<tag>-meta.json (timings, tokens, cost, validation)
// Reads ONLY the schema file and the image. Never reads fixtures/.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validate } from './validate.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EVID = path.join(ROOT, 'supervision', 'evidence');
const OUTDIR = path.join(EVID, 'responses');
const SPEND_FILE = path.join(EVID, 'P-002-spend.json');
const CALL_CAP_USD = 0.25;
const TOTAL_CAP_USD = 2.00;

// --- args ---
const args = {};
for (let i = 2; i < process.argv.length; i += 2) {
  const k = process.argv[i];
  if (!k.startsWith('--')) { console.error(`bad argument: ${k}`); process.exit(2); }
  args[k.slice(2)] = process.argv[i + 1];
}
for (const req of ['image', 'model', 'schema', 'out']) {
  if (!args[req]) { console.error(`missing --${req}`); process.exit(2); }
}
const SCHEMA_VERSION = args.schema;
const SCHEMA_PATH = path.join(ROOT, 'schema', `item.${SCHEMA_VERSION}.json`);
if (!fs.existsSync(SCHEMA_PATH)) { console.error(`no such schema: ${SCHEMA_PATH}`); process.exit(2); }
if (!fs.existsSync(args.image)) { console.error(`no such image: ${args.image}`); process.exit(2); }

// --- env ---
for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] ??= m[2];
}
const KEY = process.env.OPENROUTER_API_KEY;
if (!KEY) { console.error('OPENROUTER_API_KEY ABSENT'); process.exit(1); }

// --- spend guard ---
fs.mkdirSync(OUTDIR, { recursive: true });
const spend = fs.existsSync(SPEND_FILE) ? JSON.parse(fs.readFileSync(SPEND_FILE, 'utf8')) : { calls: [], total_usd: 0 };
if (spend.total_usd >= TOTAL_CAP_USD) {
  console.error(`CUMULATIVE CAP REACHED: USD ${spend.total_usd.toFixed(6)} >= ${TOTAL_CAP_USD}. Refusing to call.`);
  process.exit(3);
}

// --- image ---
function dims(p) {
  const out = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', p]).toString();
  return { w: +(out.match(/pixelWidth:\s*(\d+)/) || [])[1], h: +(out.match(/pixelHeight:\s*(\d+)/) || [])[1] };
}
const d = dims(args.image);
const bytes = fs.statSync(args.image).size;
const b64 = fs.readFileSync(args.image).toString('base64');

// --- the prompt: fixed before call 1, identical for every call in the matrix ---
const schemaText = fs.readFileSync(SCHEMA_PATH, 'utf8');
const PROMPT = `You are extracting a structured record from a photograph of a physical object or its label.
Return ONLY a single JSON object, no markdown fence, no prose, matching exactly this JSON Schema:

${schemaText}

Rules:
- label_text must contain ALL legible text on the label, verbatim, preserving line order; use \\n between lines.
- attributes is an array of {key, value, unit} objects; unit may be null.
- confidence is your overall confidence 0..1.
- uncertain_fields lists the names of any fields you were unsure about.
- field_confidence gives one 0..1 score per top-level content field you filled (item_name, brand, category, label_text, attributes, quantity). Score each field on its own; do not repeat your overall confidence.
- capture.label_legible is true only if label text is actually readable in the image; capture.issues lists what degrades it, such as glare, blur, cropped, distance. Use an empty array if nothing does.
- Do not add any property not in the schema.`;

const promptFile = path.join(EVID, `P-002-prompt-${SCHEMA_VERSION}.txt`);
if (!fs.existsSync(promptFile)) fs.writeFileSync(promptFile, PROMPT);
else if (fs.readFileSync(promptFile, 'utf8') !== PROMPT) {
  console.error('PROMPT DRIFT: the prompt differs from the one fixed before call 1. Refusing to run.');
  process.exit(4);
}

// --- call ---
const started_at = new Date().toISOString();
const t0 = Date.now();
let body = null, transportError = null;
for (let attempt = 1; attempt <= 2; attempt++) {
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: args.model,
        usage: { include: true },
        messages: [{ role: 'user', content: [
          { type: 'text', text: PROMPT },
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64}` } },
        ]}],
      }),
    });
    body = await res.json();
    transportError = null;
    break;
  } catch (e) {
    transportError = String(e);
    if (attempt === 2) break;
    await new Promise(r => setTimeout(r, 2000));
  }
}
const elapsed_ms = Date.now() - t0;
const finished_at = new Date().toISOString();

fs.writeFileSync(path.join(OUTDIR, `${args.out}-raw.json`), JSON.stringify(body ?? { transport_error: transportError }, null, 2));

if (!body) {
  console.error(`${args.out}: TRANSPORT ERROR after 2 attempts: ${transportError}`);
  process.exit(5);
}

const u = body?.usage || {};
const prompt_tokens = u.prompt_tokens ?? null;
const completion_tokens = u.completion_tokens ?? null;
let cost = u.cost ?? null;
let cost_source = cost != null ? 'OpenRouter usage.cost (response body)' : null;
if (cost == null && body?.id) {
  try {
    await new Promise(r => setTimeout(r, 1500));
    const g = await (await fetch(`https://openrouter.ai/api/v1/generation?id=${body.id}`,
      { headers: { Authorization: `Bearer ${KEY}` } })).json();
    if (g?.data?.total_cost != null) { cost = g.data.total_cost; cost_source = 'OpenRouter /generation endpoint'; }
  } catch {}
}

const content = body?.choices?.[0]?.message?.content ?? '';
let cleaned = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
let parsed = null, parse_error = null;
try { parsed = JSON.parse(cleaned); } catch (e) { parse_error = String(e); }
const errors = parsed ? validate(parsed, SCHEMA_VERSION) : [`JSON.parse failed: ${parse_error}`];
const valid = errors.length === 0;

const meta = {
  tag: args.out, model: args.model, schema: SCHEMA_VERSION,
  image: path.basename(args.image), image_path: args.image,
  resolution: `${d.w}x${d.h}`, image_bytes: bytes,
  started_at, finished_at, elapsed_ms,
  prompt_tokens, completion_tokens, total_tokens: u.total_tokens ?? null,
  cost_usd: cost, cost_source,
  valid, errors, parsed, content,
  finish_reason: body?.choices?.[0]?.finish_reason ?? null,
  provider: body?.provider ?? null,
  api_error: body?.error ?? null,
};
fs.writeFileSync(path.join(OUTDIR, `${args.out}-meta.json`), JSON.stringify(meta, null, 2));

spend.calls.push({ tag: args.out, model: args.model, cost_usd: cost, at: finished_at });
spend.total_usd = spend.calls.reduce((s, c) => s + (c.cost_usd || 0), 0);
fs.writeFileSync(SPEND_FILE, JSON.stringify(spend, null, 2));

console.log(`${args.out}  ${args.model}  ${d.w}x${d.h}  validation=${valid ? 'PASS' : 'FAIL'}` +
  `${valid ? '' : ' -> ' + errors.slice(0, 4).join('; ')}`);
console.log(`  tokens=${prompt_tokens}/${completion_tokens} elapsed_ms=${elapsed_ms} cost_usd=${cost} (${cost_source})`);
console.log(`  cumulative_usd=${spend.total_usd.toFixed(6)} / ${TOTAL_CAP_USD}`);

if (cost != null && cost > CALL_CAP_USD) {
  console.error(`  !! SINGLE CALL EXCEEDED USD ${CALL_CAP_USD} — STOP AND REPORT`);
  process.exit(6);
}
if (spend.total_usd > TOTAL_CAP_USD) {
  console.error(`  !! CUMULATIVE SPEND EXCEEDED USD ${TOTAL_CAP_USD} — STOP AND REPORT`);
  process.exit(7);
}
