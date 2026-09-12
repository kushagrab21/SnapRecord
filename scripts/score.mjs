// SnapRecord P-002: deterministic scoring of extraction responses against user-typed ground truth.
// Usage: node scripts/score.mjs [--out supervision/evidence/P-002-matrix.md]
// Reads fixtures/ground-truth.json and every supervision/evidence/responses/*-meta.json.
// No model is asked to grade anything; every verdict below is computed.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GT_FILE = path.join(ROOT, 'fixtures', 'ground-truth.json');
const RESP = path.join(ROOT, 'supervision', 'evidence', 'responses');

const args = {};
for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].slice(2)] = process.argv[i + 1];
const OUT = path.resolve(ROOT, args.out || 'supervision/evidence/P-002-matrix.md');

// normalisation: lowercase, strip punctuation to spaces, collapse whitespace
const norm = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
// a downscaled/full variant maps back to the original capture filename used as the ground-truth key
const baseKey = f => f.replace(/-(1568|full)(\.[A-Za-z0-9]+)$/, '$2');

function scoreFact(fact, parsed) {
  if (!parsed) return { verdict: 'missed', where: null, unit_join_would_match: false };
  const labelText = typeof parsed.label_text === 'string' ? parsed.label_text : '';
  const attrs = Array.isArray(parsed.attributes) ? parsed.attributes : [];
  const attrValues = attrs.map(a => (a && typeof a.value === 'string') ? a.value : '').filter(Boolean);

  // packet rule: exact = case-sensitive substring of label_text or of any attribute value
  if (labelText.includes(fact)) return { verdict: 'exact', where: 'label_text', unit_join_would_match: false };
  const ai = attrValues.findIndex(v => v.includes(fact));
  if (ai >= 0) return { verdict: 'exact', where: `attributes[${ai}].value`, unit_join_would_match: false };

  const nf = norm(fact);
  if (nf && norm(labelText).includes(nf)) return { verdict: 'normalised', where: 'label_text', unit_join_would_match: false };
  const ni = attrValues.findIndex(v => nf && norm(v).includes(nf));
  if (ni >= 0) return { verdict: 'normalised', where: `attributes[${ni}].value`, unit_join_would_match: false };

  // diagnostic only, never a score: would "<value> <unit>" have matched?
  const joinHit = attrs.some(a => a && nf && norm(`${a.value ?? ''} ${a.unit ?? ''}`).includes(nf));
  return { verdict: 'missed', where: null, unit_join_would_match: joinHit };
}

const gt = JSON.parse(fs.readFileSync(GT_FILE, 'utf8'));
const metas = fs.readdirSync(RESP).filter(f => f.endsWith('-meta.json')).sort()
  .map(f => JSON.parse(fs.readFileSync(path.join(RESP, f), 'utf8')));

const rows = [];
for (const m of metas) {
  const key = baseKey(m.image);
  const truth = gt.photos?.[key];
  const facts = truth ? [truth.product_name, truth.numeric_value, truth.phrase] : [null, null, null];
  const scored = facts.map(f => f == null ? { verdict: 'no-ground-truth', where: null, unit_join_would_match: false }
                                          : scoreFact(f, m.parsed));
  const p = m.parsed || {};
  const fcVals = (p.field_confidence && typeof p.field_confidence === 'object') ? Object.entries(p.field_confidence) : [];
  const lowFc = fcVals.filter(([, v]) => typeof v === 'number' && v < 0.7);
  rows.push({
    tag: m.tag, photo: key, model: m.model, resolution: m.resolution,
    valid: m.valid, errors: m.errors,
    scores: scored.map(s => s.verdict), where: scored.map(s => s.where),
    unit_join: scored.map(s => s.unit_join_would_match),
    label_legible: p?.capture?.label_legible ?? null,
    issues: Array.isArray(p?.capture?.issues) ? p.capture.issues : null,
    uncertain_fields: Array.isArray(p?.uncertain_fields) ? p.uncertain_fields : null,
    confidence: typeof p.confidence === 'number' ? p.confidence : null,
    field_confidence: Object.fromEntries(fcVals),
    any_fc_below_07: fcVals.length ? lowFc.length > 0 : null,
    low_fc_fields: lowFc.map(([k, v]) => `${k}=${v}`),
    prompt_tokens: m.prompt_tokens, completion_tokens: m.completion_tokens,
    elapsed_ms: m.elapsed_ms, cost_usd: m.cost_usd, cost_source: m.cost_source,
    started_at: m.started_at,
  });
}

const shortModel = id => id.replace('google/', '').replace('anthropic/', '');
const cell = v => v == null ? '—' : String(v);
const list = a => (a == null) ? '—' : (a.length ? a.join(', ') : '(empty)');

let md = `# P-002 matrix — extraction fidelity against user-typed ground truth\n\n`;
md += `Generated ${new Date().toISOString()} by \`scripts/score.mjs\`. Every verdict is computed, not judged.\n\n`;
md += `Per-fact scoring: **exact** = case-sensitive substring of \`label_text\` or of any \`attributes[].value\`; `;
md += `**normalised** = same after lowercasing, stripping punctuation and collapsing whitespace; **missed** = neither.\n`;
md += `Facts per photo, as typed by the user before any extraction ran: **F1** product name, **F2** numeric value with unit, **F3** contiguous phrase (>= 6 words).\n\n`;
md += `| # | photo | model | res | valid | F1 name | F2 number | F3 phrase | legible | capture.issues | uncertain_fields | conf | any fc<0.7 | tokens p/c | ms | USD |\n`;
md += `|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|\n`;
rows.forEach((r, i) => {
  md += `| ${i + 1} | ${r.photo.replace(/\.jpg$/, '')} | ${shortModel(r.model)} | ${r.resolution} | ${r.valid ? 'PASS' : 'FAIL'} `;
  md += `| ${r.scores[0]} | ${r.scores[1]} | ${r.scores[2]} `;
  md += `| ${cell(r.label_legible)} | ${list(r.issues)} | ${list(r.uncertain_fields)} | ${cell(r.confidence)} `;
  md += `| ${r.any_fc_below_07 === null ? '—' : (r.any_fc_below_07 ? 'yes: ' + r.low_fc_fields.join(' ') : 'no')} `;
  md += `| ${cell(r.prompt_tokens)}/${cell(r.completion_tokens)} | ${cell(r.elapsed_ms)} | ${r.cost_usd == null ? '—' : r.cost_usd.toFixed(6)} |\n`;
});

const totals = rows.reduce((s, r) => s + (r.cost_usd || 0), 0);
md += `\n**Total spend across ${rows.length} calls: USD ${totals.toFixed(6)}** (source: OpenRouter \`usage.cost\`, the provider's own accounting).\n`;

// per-model / per-resolution roll-up
md += `\n## Roll-up\n\n| group | calls | valid | exact | normalised | missed | mean USD | mean ms |\n|---|---|---|---|---|---|---|---|\n`;
const groups = {};
for (const r of rows) {
  const g = `${shortModel(r.model)} @ ${r.resolution.split('x').map(Number).sort((a,b)=>b-a)[0]}px`;
  (groups[g] ||= []).push(r);
}
for (const [g, rs] of Object.entries(groups)) {
  const all = rs.flatMap(r => r.scores);
  const n = v => all.filter(x => x === v).length;
  md += `| ${g} | ${rs.length} | ${rs.filter(r => r.valid).length}/${rs.length} | ${n('exact')} | ${n('normalised')} | ${n('missed')} `;
  md += `| ${(rs.reduce((s, r) => s + (r.cost_usd || 0), 0) / rs.length).toFixed(6)} | ${Math.round(rs.reduce((s, r) => s + r.elapsed_ms, 0) / rs.length)} |\n`;
}

// misses, spelled out
const misses = rows.flatMap((r, i) => r.scores.map((s, j) => ({ r, i, j, s })).filter(x => x.s === 'missed'));
md += `\n## Misses (${misses.length})\n\n`;
if (!misses.length) md += `None. Every fact was found in every response.\n`;
else {
  md += `| row | photo | model | fact | would "value unit" have matched? |\n|---|---|---|---|---|\n`;
  for (const x of misses) md += `| ${x.i + 1} | ${x.r.photo.replace(/\.jpg$/, '')} | ${shortModel(x.r.model)} | F${x.j + 1} | ${x.r.unit_join[x.j] ? 'yes (diagnostic only, not scored)' : 'no'} |\n`;
}

md += `\n## Validation failures\n\n`;
const bad = rows.filter(r => !r.valid);
if (!bad.length) md += `None. All ${rows.length} responses validated against \`schema/item.v1.json\`.\n`;
else for (const r of bad) md += `- \`${r.tag}\` (${shortModel(r.model)}): ${r.errors.join('; ')}\n`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, md);
fs.writeFileSync(path.join(ROOT, 'supervision', 'evidence', 'P-002-scores.json'), JSON.stringify({ ground_truth_recorded_at: gt.recorded_at, rows }, null, 2));
console.log(md);
console.log(`\nwrote ${OUT}`);
