// P-001 Proof B: vision model -> schema-valid JSON. Dependency-free.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CAPTURE_DIR = path.join(ROOT, 'supervision', 'evidence', 'captures');
const EVID = path.join(ROOT, 'supervision', 'evidence');
const MODEL = process.env.PROOF_MODEL || 'google/gemini-3.8-flash';
const MAX_EDGE = 1568;
const RUNS = 3;

// --- env ---
for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] ??= m[2];
}
const KEY = process.env.OPENROUTER_API_KEY;
if (!KEY) { console.error('OPENROUTER_API_KEY ABSENT'); process.exit(1); }

// --- pick image ---
const arg = process.argv[2];
let img = arg;
if (!img) {
  const files = fs.readdirSync(CAPTURE_DIR).filter(f => /\.(jpe?g|png|heic)$/i.test(f)).sort();
  if (!files.length) { console.error('No capture found in ' + CAPTURE_DIR); process.exit(1); }
  img = path.join(CAPTURE_DIR, files[files.length - 1]);
}
function dims(p) {
  const out = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', p]).toString();
  return {
    w: +(out.match(/pixelWidth:\s*(\d+)/) || [])[1],
    h: +(out.match(/pixelHeight:\s*(\d+)/) || [])[1],
  };
}
const before = dims(img);
const beforeBytes = fs.statSync(img).size;
let sendPath = img;
if (Math.max(before.w, before.h) > MAX_EDGE || /\.heic$/i.test(img)) {
  sendPath = path.join(EVID, 'proof-extract-input.jpg');
  execFileSync('sips', ['-s', 'format', 'jpeg', '-Z', String(MAX_EDGE), img, '--out', sendPath]);
}
const after = dims(sendPath);
const afterBytes = fs.statSync(sendPath).size;
console.log(`image: ${path.basename(img)}`);
console.log(`before: ${before.w}x${before.h}, ${beforeBytes} bytes`);
console.log(`after : ${after.w}x${after.h}, ${afterBytes} bytes  (${sendPath === img ? 'no downscale needed' : 'downscaled'})`);

const b64 = fs.readFileSync(sendPath).toString('base64');
const schema = fs.readFileSync(path.join(ROOT, 'schema', 'item.v0.json'), 'utf8');

const PROMPT = `You are extracting a structured record from a photograph of a physical object or its label.
Return ONLY a single JSON object, no markdown fence, no prose, matching exactly this JSON Schema:

${schema}

Rules:
- label_text must contain ALL legible text on the label, verbatim, preserving line order; use \\n between lines.
- attributes is an array of {key, value, unit} objects; unit may be null.
- confidence is your overall confidence 0..1.
- uncertain_fields lists the names of any fields you were unsure about.
- Do not add any property not in the schema.`;

// --- hand-written validator ---
function validate(obj) {
  const errs = [];
  const isStr = v => typeof v === 'string';
  const isNum = v => typeof v === 'number' && Number.isFinite(v);
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return ['root: not an object'];
  const allowed = ['item_name','brand','category','label_text','attributes','quantity','confidence','uncertain_fields'];
  for (const k of Object.keys(obj)) if (!allowed.includes(k)) errs.push(`additionalProperties: unexpected key "${k}"`);
  for (const k of ['item_name','category','label_text','attributes','confidence'])
    if (!(k in obj)) errs.push(`required: missing "${k}"`);
  if ('item_name' in obj && !isStr(obj.item_name)) errs.push('item_name: not a string');
  if ('category' in obj && !isStr(obj.category)) errs.push('category: not a string');
  if ('label_text' in obj && !isStr(obj.label_text)) errs.push('label_text: not a string');
  if ('brand' in obj && !(isStr(obj.brand) || obj.brand === null)) errs.push('brand: not string|null');
  if ('quantity' in obj && !(isNum(obj.quantity) || obj.quantity === null)) errs.push('quantity: not number|null');
  if ('confidence' in obj) {
    if (!isNum(obj.confidence)) errs.push('confidence: not a number');
    else if (obj.confidence < 0 || obj.confidence > 1) errs.push('confidence: out of range 0..1');
  }
  if ('attributes' in obj) {
    if (!Array.isArray(obj.attributes)) errs.push('attributes: not an array');
    else obj.attributes.forEach((a, i) => {
      if (a === null || typeof a !== 'object' || Array.isArray(a)) { errs.push(`attributes[${i}]: not an object`); return; }
      if (!('key' in a)) errs.push(`attributes[${i}].key: missing`);
      else if (!isStr(a.key)) errs.push(`attributes[${i}].key: not a string`);
      if (!('value' in a)) errs.push(`attributes[${i}].value: missing`);
      else if (!isStr(a.value)) errs.push(`attributes[${i}].value: not a string`);
      if ('unit' in a && !(isStr(a.unit) || a.unit === null)) errs.push(`attributes[${i}].unit: not string|null`);
    });
  }
  if ('uncertain_fields' in obj) {
    if (!Array.isArray(obj.uncertain_fields)) errs.push('uncertain_fields: not an array');
    else obj.uncertain_fields.forEach((s, i) => { if (!isStr(s)) errs.push(`uncertain_fields[${i}]: not a string`); });
  }
  return errs;
}

// published price fallback (USD per token), from OpenRouter /models at time of run
const PRICE = { prompt: 0.00000075, completion: 0.00000375 };

const summary = [];
for (let i = 1; i <= RUNS; i++) {
  const t0 = Date.now();
  let res, body;
  try {
    res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        usage: { include: true },
        messages: [{ role: 'user', content: [
          { type: 'text', text: PROMPT },
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64}` } },
        ]}],
      }),
    });
    body = await res.json();
  } catch (e) {
    console.log(`RUN ${i}: TRANSPORT ERROR ${e}`);
    summary.push({ run: i, error: String(e) });
    continue;
  }
  const elapsed = Date.now() - t0;
  fs.writeFileSync(path.join(EVID, `proof-extract-run${i}-raw.json`), JSON.stringify(body, null, 2));
  const text = body?.choices?.[0]?.message?.content ?? '';
  fs.writeFileSync(path.join(EVID, `proof-extract-run${i}-content.txt`), text);

  const u = body?.usage || {};
  const pt = u.prompt_tokens ?? null, ct = u.completion_tokens ?? null;
  let cost = u.cost ?? null, costSrc = cost != null ? 'OpenRouter usage.cost (response body)' : null;
  if (cost == null && body?.id) {
    try {
      await new Promise(r => setTimeout(r, 1200));
      const g = await (await fetch(`https://openrouter.ai/api/v1/generation?id=${body.id}`,
        { headers: { Authorization: `Bearer ${KEY}` } })).json();
      if (g?.data?.total_cost != null) { cost = g.data.total_cost; costSrc = 'OpenRouter /generation endpoint'; }
    } catch {}
  }
  if (cost == null && pt != null) {
    cost = pt * PRICE.prompt + ct * PRICE.completion;
    costSrc = 'computed from OpenRouter published price';
  }

  // strip fences if present, then parse
  let cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let parsed = null, parseErr = null;
  try { parsed = JSON.parse(cleaned); } catch (e) { parseErr = String(e); }
  const errs = parsed ? validate(parsed) : [`JSON.parse failed: ${parseErr}`];
  const pass = errs.length === 0;

  console.log(`\nRUN ${i}: validation ${pass ? 'PASS' : 'FAIL'}${pass ? '' : ' -> ' + errs.join('; ')}`);
  console.log(`  prompt_tokens=${pt} completion_tokens=${ct} elapsed_ms=${elapsed}`);
  console.log(`  cost_usd=${cost} (source: ${costSrc})`);
  if (parsed) console.log(`  item_name="${parsed.item_name}" brand=${JSON.stringify(parsed.brand)} confidence=${parsed.confidence} attrs=${parsed.attributes?.length}`);
  if (cost > 0.20) { console.log('  !! SINGLE CALL EXCEEDED USD 0.20 — STOPPING'); summary.push({run:i,pass,pt,ct,elapsed,cost,costSrc,errs}); break; }
  summary.push({ run: i, pass, prompt_tokens: pt, completion_tokens: ct, elapsed_ms: elapsed, cost_usd: cost, cost_source: costSrc, errors: errs });
}

const total = summary.reduce((s, r) => s + (r.cost_usd || 0), 0);
console.log(`\nTOTAL COST USD: ${total.toFixed(6)} over ${summary.length} runs, model=${MODEL}`);
fs.writeFileSync(path.join(EVID, 'proof-extract-summary.json'), JSON.stringify({
  model: MODEL, image: path.basename(img),
  before: { ...before, bytes: beforeBytes }, after: { ...after, bytes: afterBytes },
  runs: summary, total_cost_usd: total,
}, null, 2));
