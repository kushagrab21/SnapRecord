#!/usr/bin/env node
// SnapRecord P-004 — ask a vision model a question about a stored capture.
// Usage: node scripts/ask.mjs <sha256-or-record-id> "<question>" [--variant original|derived] [--model id]
//
// Ruling 9 (R-0022): the stored ORIGINAL at data/captures/<sha256>.<ext> is the
// canonical image and is read byte-for-byte. --variant derived is the explicit,
// labelled alternative and is never the default.
// Zero dependencies (R-0020): node:fetch, node:sqlite, macOS sips.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { CAPTURES, DERIVED, MAX_EDGE, ROOT, dims, sha256File } from './store.mjs';

const DEFAULT_MODEL = 'google/gemini-3.8-flash';
const SPEND_FILE = path.join(ROOT, 'supervision', 'evidence', 'P-004-spend.json');
const SPEND_CAP_USD = 0.10;                       // P-004 boundary
const MIME_BY_EXT = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.heic': 'image/heic', '.webp': 'image/webp' };

// --- args: two positionals, then optional flags ---
const argv = process.argv.slice(2);
const positional = [];
const flags = {};
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith('--')) flags[argv[i].slice(2)] = argv[++i];
  else positional.push(argv[i]);
}
const [target, question] = positional;
if (!target || !question) {
  console.error('usage: node scripts/ask.mjs <sha256-or-record-id> "<question>" [--variant original|derived] [--model id]');
  process.exit(2);
}
const variant = flags.variant || 'original';
if (variant !== 'original' && variant !== 'derived') { console.error('--variant must be original or derived'); process.exit(2); }
const model = flags.model || DEFAULT_MODEL;

// --- resolve the target to a stored original sha256 ---
// A short all-digit token is a record id; anything else is a sha256 or a prefix of one.
function resolveSha(t) {
  if (/^\d{1,6}$/.test(t)) {
    const db = new DatabaseSync(path.join(ROOT, 'data', 'snaprecord.sqlite'), { readOnly: true });
    const row = db.prepare('SELECT original_sha256 FROM records WHERE id = ?').get(Number(t));
    if (!row) { console.error(`no record with id ${t}`); process.exit(2); }
    return row.original_sha256;
  }
  if (!/^[0-9a-f]{4,64}$/i.test(t)) { console.error(`not a record id or sha256: ${t}`); process.exit(2); }
  const pre = t.toLowerCase();
  const hits = [...new Set(fs.readdirSync(CAPTURES).filter(f => f.startsWith(pre)).map(f => f.slice(0, 64)))];
  if (hits.length === 0) { console.error(`no stored capture matches ${t}`); process.exit(2); }
  if (hits.length > 1) { console.error(`ambiguous prefix ${t}: ${hits.join(', ')}`); process.exit(2); }
  return hits[0];
}
const sha = resolveSha(target);

// --- the file itself ---
let imagePath, mime;
if (variant === 'original') {
  const file = fs.readdirSync(CAPTURES).find(f => f.startsWith(sha) && !f.endsWith('.json'));
  if (!file) { console.error(`no original on disk for ${sha}`); process.exit(2); }
  imagePath = path.join(CAPTURES, file);
  let sidecar = null;
  try { sidecar = JSON.parse(fs.readFileSync(path.join(CAPTURES, `${sha}.json`), 'utf8')); } catch {}
  mime = sidecar?.content_type || MIME_BY_EXT[path.extname(file).toLowerCase()] || 'image/jpeg';
} else {
  imagePath = path.join(DERIVED, `${sha}.${MAX_EDGE}.jpg`);
  if (!fs.existsSync(imagePath)) { console.error(`no derived copy on disk for ${sha}`); process.exit(2); }
  mime = 'image/jpeg';
}
const buf = fs.readFileSync(imagePath);            // byte-for-byte, no re-encode
const d = dims(imagePath);

// --- env (same loader as scripts/extract.mjs) ---
for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] ??= m[2];
}
const KEY = process.env.OPENROUTER_API_KEY;
if (!KEY) { console.error('OPENROUTER_API_KEY ABSENT'); process.exit(1); }

// --- spend guard ---
const spend = fs.existsSync(SPEND_FILE) ? JSON.parse(fs.readFileSync(SPEND_FILE, 'utf8')) : { calls: [], total_usd: 0 };
if (spend.total_usd >= SPEND_CAP_USD) {
  console.error(`P-004 CAP REACHED: USD ${spend.total_usd.toFixed(6)} >= ${SPEND_CAP_USD}. Refusing to call.`);
  process.exit(3);
}

console.error(`> ${variant} ${path.relative(ROOT, imagePath)}  ${d.width}x${d.height}  ${buf.length} bytes  sha256=${variant === 'original' ? sha : sha256File(imagePath)}`);
console.error(`> model ${model}`);

// --- the call: same OpenRouter path as scripts/extract.mjs and server/index.mjs ---
const t0 = Date.now();
let body = null, transportError = null;
for (let attempt = 1; attempt <= 2; attempt++) {
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        usage: { include: true },
        messages: [{ role: 'user', content: [
          { type: 'text', text: question },
          { type: 'image_url', image_url: { url: `data:${mime};base64,${buf.toString('base64')}` } },
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
if (!body) { console.error(`TRANSPORT ERROR after 2 attempts: ${transportError}`); process.exit(5); }
if (body.error) { console.error(`API ERROR: ${JSON.stringify(body.error)}`); process.exit(5); }

const u = body.usage || {};
let cost = u.cost ?? null;
let cost_source = cost != null ? 'usage.cost' : null;
if (cost == null && body.id) {
  try {
    await new Promise(r => setTimeout(r, 1500));
    const g = await (await fetch(`https://openrouter.ai/api/v1/generation?id=${body.id}`,
      { headers: { Authorization: `Bearer ${KEY}` } })).json();
    if (g?.data?.total_cost != null) { cost = g.data.total_cost; cost_source = '/generation'; }
  } catch {}
}

spend.calls.push({ sha, variant, model, cost_usd: cost, at: new Date().toISOString() });
spend.total_usd = spend.calls.reduce((s, c) => s + (c.cost_usd || 0), 0);
fs.mkdirSync(path.dirname(SPEND_FILE), { recursive: true });
fs.writeFileSync(SPEND_FILE, JSON.stringify(spend, null, 2));

console.log(body.choices?.[0]?.message?.content ?? '(no content)');
console.error(`\n> tokens=${u.prompt_tokens}/${u.completion_tokens} elapsed_ms=${elapsed_ms} usage.cost=USD ${cost} (${cost_source})`);
console.error(`> P-004 cumulative USD ${spend.total_usd.toFixed(6)} / ${SPEND_CAP_USD}`);
if (spend.total_usd > SPEND_CAP_USD) { console.error('> !! P-004 SPEND CAP EXCEEDED — STOP AND REPORT'); process.exit(7); }
