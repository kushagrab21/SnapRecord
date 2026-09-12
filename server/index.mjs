// SnapRecord P-003 — the whole product in one process.
// phone photo -> original stored by sha256 (R-0017) -> derived 1568px -> extraction
// -> v1 validation -> SQLite row -> server-rendered list.
// Zero dependencies (R-0020): node:http, node:sqlite, macOS sips.
//   node server/index.mjs
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { storeCapture, deriveCapture, dims, sha256File, CAPTURES, DERIVED, MAX_EDGE, ROOT } from '../scripts/store.mjs';
import { validate } from '../scripts/validate.mjs';
import { promptFor } from '../scripts/prompt.mjs';

const PORT = 8788;
const MODEL = 'google/gemini-3.8-flash';
const SCHEMA_VERSION = 'v2';               // schema/item.v2.json, see scripts/prompt.mjs
const SPEND_CAP_USD = 0.20;                       // P-003/P-005 boundary
const DB_PATH = path.join(ROOT, 'data', 'snaprecord.sqlite');
const LOG_FILE = path.join(ROOT, 'supervision', 'evidence', 'P-003-server.log');

// --- env (same loader as scripts/extract.mjs) ---
for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] ??= m[2];
}
const KEY = process.env.OPENROUTER_API_KEY;
if (!KEY) { console.error('OPENROUTER_API_KEY ABSENT'); process.exit(1); }

function log(line) {
  const entry = `[${new Date().toISOString()}] ${line}`;
  console.log(entry);
  try { fs.appendFileSync(LOG_FILE, entry + '\n'); } catch {}
}

// --- schema (created on start if absent) ---
fs.mkdirSync(path.join(ROOT, 'data'), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec(`CREATE TABLE IF NOT EXISTS records (
  id INTEGER PRIMARY KEY,
  original_sha256 TEXT NOT NULL,
  derived_sha256  TEXT,
  received_at     TEXT NOT NULL,
  model           TEXT,
  status          TEXT NOT NULL CHECK (status IN ('valid','invalid')),
  record_json     TEXT,
  raw_response    TEXT,
  usage_json      TEXT,
  cost_usd        REAL,
  elapsed_ms      INTEGER
)`);
// P-005: the note is evidence and must survive even on rows the model failed (R-0024),
// so it lives in its own columns as well as inside record_json.
for (const col of ['user_note_text TEXT', 'user_note_source TEXT', 'audio_sha256 TEXT', 'transcript_model TEXT'])
  try { db.exec(`ALTER TABLE records ADD COLUMN ${col}`); } catch {}   // throws once the column exists

// --- extraction: one call, same shape as scripts/extract.mjs ---
async function extract(derivedPath, noteText = '') {
  const b64 = fs.readFileSync(derivedPath).toString('base64');
  const prompt = promptFor(noteText);
  const t0 = Date.now();
  let body = null, transportError = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: MODEL,
          usage: { include: true },
          messages: [{ role: 'user', content: [
            { type: 'text', text: prompt },
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
  if (!body) return { elapsed_ms, body: { transport_error: transportError }, cost: null };

  const u = body?.usage || {};
  let cost = u.cost ?? null;
  if (cost == null && body?.id) {
    try {
      await new Promise(r => setTimeout(r, 1500));
      const g = await (await fetch(`https://openrouter.ai/api/v1/generation?id=${body.id}`,
        { headers: { Authorization: `Bearer ${KEY}` } })).json();
      if (g?.data?.total_cost != null) cost = g.data.total_cost;
    } catch {}
  }
  return { elapsed_ms, body, usage: u, cost, prompt };
}

// --- minimal multipart/form-data reader (no dependencies) ---
function firstFilePart(buf, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  if (!m) return null;
  const boundary = Buffer.from('--' + (m[1] || m[2]).trim());
  let pos = buf.indexOf(boundary);
  while (pos !== -1) {
    const start = pos + boundary.length;
    const next = buf.indexOf(boundary, start);
    if (next === -1) break;
    const part = buf.subarray(start, next);
    const sep = part.indexOf('\r\n\r\n');
    if (sep !== -1) {
      const headers = part.subarray(0, sep).toString('utf8');
      const fn = /filename="([^"]*)"/i.exec(headers);
      if (fn && fn[1]) {
        let bodyPart = part.subarray(sep + 4);
        if (bodyPart.subarray(-2).toString() === '\r\n') bodyPart = bodyPart.subarray(0, -2);
        const ct = (/content-type:\s*([^\r\n]+)/i.exec(headers) || [])[1] || '';
        if (bodyPart.length > 0) return { filename: fn[1], contentType: ct.trim(), buf: bodyPart };
      }
    }
    pos = next;
  }
  return null;
}

// P-005: the same walk, returning the non-file fields (we want `note`).
function formFields(buf, contentType) {
  const out = {};
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  if (!m) return out;
  const boundary = Buffer.from('--' + (m[1] || m[2]).trim());
  let pos = buf.indexOf(boundary);
  while (pos !== -1) {
    const start = pos + boundary.length;
    const next = buf.indexOf(boundary, start);
    if (next === -1) break;
    const part = buf.subarray(start, next);
    const sep = part.indexOf('\r\n\r\n');
    if (sep !== -1) {
      const headers = part.subarray(0, sep).toString('utf8');
      const nm = /name="([^"]*)"/i.exec(headers);
      if (nm && !/filename="/i.test(headers)) {
        let v = part.subarray(sep + 4);
        if (v.subarray(-2).toString() === '\r\n') v = v.subarray(0, -2);
        out[nm[1]] = v.toString('utf8');
      }
    }
    pos = next;
  }
  return out;
}

// --- P-004: locating stored pixels ------------------------------------------
// The original's extension is whatever it was stored as (R-0017), so it is
// discovered on disk rather than assumed; the sidecar carries mime and dims.
const MIME_BY_EXT = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.heic': 'image/heic', '.webp': 'image/webp' };

export function resolveOriginal(sha) {
  if (!/^[0-9a-f]{64}$/.test(sha)) return null;
  let sidecar = null;
  const sidecarPath = path.join(CAPTURES, `${sha}.json`);
  if (fs.existsSync(sidecarPath)) { try { sidecar = JSON.parse(fs.readFileSync(sidecarPath, 'utf8')); } catch {} }
  const file = fs.readdirSync(CAPTURES).find(f => f.startsWith(sha) && !f.endsWith('.json'));
  if (!file) return null;
  const p = path.join(CAPTURES, file);
  const ext = path.extname(file).toLowerCase();
  const stat = fs.statSync(p);
  return {
    path: p, ext, sha256: sha, sidecar,
    mime: sidecar?.content_type || MIME_BY_EXT[ext] || 'application/octet-stream',
    width: sidecar?.width ?? null,
    height: sidecar?.height ?? null,
    bytes: stat.size,
  };
}

export function derivedInfo(originalSha) {
  const p = path.join(DERIVED, `${originalSha}.${MAX_EDGE}.jpg`);
  if (!fs.existsSync(p)) return null;
  const d = dims(p);
  return { path: p, mime: 'image/jpeg', sha256: sha256File(p), width: d.width, height: d.height, bytes: fs.statSync(p).size };
}

// --- page ---
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function renderPage(rows) {
  const items = rows.map(r => {
    let rec = null;
    try { rec = r.record_json ? JSON.parse(r.record_json) : null; } catch {}
    const bad = r.status === 'invalid';
    const full = rec ?? { raw_response: r.raw_response };
    // P-005: the note is shown from its own column so it appears on invalid rows too.
    const noteText = r.user_note_text ?? rec?.user_note?.text ?? '';
    const noteSrc = r.user_note_source ?? rec?.user_note?.source ?? 'none';
    const noteBlock = noteText
      ? `<p class="note">\u201c${esc(noteText)}\u201d <span class="dim">\u2014 ${esc(noteSrc)}${r.audio_sha256 ? ' \u00b7 audio ' + esc(String(r.audio_sha256).slice(0, 12)) + '\u2026' : ''}</span></p>`
      : '<p class="note dim">(no note)</p>';
    return `<article class="card${bad ? ' bad' : ''}">
  <img src="/derived/${esc(r.original_sha256)}" alt="">
  <div class="meta">
    ${bad ? '<p class="flag">INVALID — did not pass the v1 validator</p>' : ''}
    <h2>${esc(rec?.item_name ?? '(no item_name)')}</h2>
    <p class="row"><span>category</span> ${esc(rec?.category ?? '—')}</p>
    <p class="row"><span>confidence</span> ${rec?.confidence ?? '—'}</p>
    <p class="row"><span>label_legible</span> ${rec?.capture?.label_legible === undefined ? '—' : String(rec.capture.label_legible)}</p>
    ${noteBlock}
    <p class="row dim"><span>sha256</span> ${esc(r.original_sha256.slice(0, 16))}… · ${esc(r.received_at)} · ${r.elapsed_ms}ms · USD ${r.cost_usd ?? '—'}</p>
    <details><summary>full JSON</summary><pre>${esc(JSON.stringify(full, null, 2))}</pre></details>
  </div>
</article>`;
  }).join('\n');

  return `<!doctype html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>SnapRecord</title>
<style>
 :root{color-scheme:dark}
 body{font:16px -apple-system,system-ui,sans-serif;margin:0;padding:20px;background:#111;color:#eee;max-width:760px}
 h1{font-size:20px;margin:0 0 4px}
 .sub{color:#999;font-size:13px;margin:0 0 20px}
 form{background:#1b1b1b;border:1px solid #333;border-radius:10px;padding:16px}
 input[type=file]{display:block;width:100%;box-sizing:border-box;padding:14px;background:#222;border:1px solid #444;border-radius:8px;color:#eee}
 button{margin-top:14px;width:100%;padding:16px;font-size:17px;background:#2d7;color:#062;border:0;border-radius:8px;font-weight:600}
 .card{display:flex;gap:14px;margin-top:18px;padding:14px;background:#1b1b1b;border:1px solid #333;border-radius:10px}
 .card.bad{border-color:#a33;background:#221616}
 .card img{width:110px;height:110px;object-fit:cover;border-radius:8px;background:#000;flex:none}
 .meta{min-width:0;flex:1}
 .meta h2{font-size:17px;margin:0 0 8px}
 .row{margin:3px 0;font-size:14px}
 .row span{display:inline-block;min-width:110px;color:#888}
 .dim{color:#777;font-size:12px}
 .flag{color:#f77;font-weight:600;margin:0 0 6px;font-size:13px}
 .note{margin:8px 0 0;font-size:14px;color:#dda;border-left:2px solid #554;padding-left:8px}
 .note.dim{color:#666;border-color:#333}
 textarea{display:block;width:100%;box-sizing:border-box;margin-top:12px;padding:14px;min-height:74px;
   background:#222;border:1px solid #444;border-radius:8px;color:#eee;font:16px -apple-system,system-ui,sans-serif;resize:vertical}
 #rec{margin-top:12px;width:100%;padding:14px;font-size:16px;background:#333;color:#eee;border:1px solid #555;border-radius:8px}
 #rec.on{background:#a33;color:#fff}
 details{margin-top:8px} summary{cursor:pointer;color:#8bd;font-size:13px}
 pre{white-space:pre-wrap;word-break:break-word;background:#000;padding:10px;border-radius:6px;font-size:12px;overflow-x:auto}
 @media (max-width:520px){.card{flex-direction:column}.card img{width:100%;height:180px}}
</style></head><body>
<h1>SnapRecord</h1>
<p class="sub">Photograph an object or its label. Extraction accuracy has not been measured.</p>
<form method="post" action="/upload" enctype="multipart/form-data">
  <input name="photo" type="file" accept="image/*" capture="environment" required>
  <textarea name="note" id="note" placeholder="Say or type what this is"></textarea>
  <p class="sub" style="margin:6px 0 0">Tap the microphone on your keyboard to dictate. Stored word for word.</p>
  <button id="go" type="submit">Extract record</button>
  <p id="working" class="sub" style="margin:10px 0 0" hidden>Uploading and extracting — this takes about 10 seconds. Keep this page open.</p>
</form>
<script>
 var f=document.querySelector('form'),b=document.getElementById('go'),
     w=document.getElementById('working'),inp=f.querySelector('input[type=file]');
 f.addEventListener('submit',function(e){
   var file=inp.files&&inp.files[0];
   if(!file){ w.hidden=false; w.textContent='Choose a photo first.'; e.preventDefault(); return; }
   e.preventDefault();
   b.disabled=true; b.textContent='Working...';
   w.hidden=false; w.textContent='Uploading '+file.size+' bytes and extracting - about 10 seconds.';
   var note=document.getElementById('note').value||'';
   // Headers are latin-1 on the wire; base64 carries UTF-8 dictation through intact.
   var h={'content-type':file.type||'application/octet-stream','x-filename':file.name||'photo.jpg'};
   if(note) h['x-user-note']=btoa(String.fromCharCode.apply(null,new TextEncoder().encode(note)));
   fetch('/upload',{method:'POST',headers:h,body:file})
    .then(function(r){return r.text();})
    .then(function(t){ w.textContent=t+' - reloading'; location.reload(); })
    .catch(function(err){ w.textContent='Upload failed: '+err; b.disabled=false; b.textContent='Extract record'; });
 });
</script>
${rows.length ? items : '<p class="sub" style="margin-top:20px">No records yet.</p>'}
</body></html>`;
}

const allRows = () => db.prepare('SELECT * FROM records ORDER BY id DESC').all();
const spentSoFar = () => db.prepare('SELECT COALESCE(SUM(cost_usd),0) AS t FROM records').get().t;

// --- routes ---
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  log(`REQ ${req.method} ${url.pathname} remote=${req.socket.remoteAddress} ` +
      `len=${req.headers['content-length'] ?? '-'} ct=${req.headers['content-type'] ?? '-'} ua="${req.headers['user-agent'] || ''}"`);

  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(renderPage(allRows()));
  }

  if (req.method === 'GET' && url.pathname === '/api/records') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify(allRows(), null, 2));
  }

  if (req.method === 'GET' && url.pathname.startsWith('/derived/')) {
    const sha = url.pathname.slice('/derived/'.length);
    if (!/^[0-9a-f]{64}$/.test(sha)) { res.writeHead(400); return res.end('bad sha'); }
    const p = path.join(DERIVED, `${sha}.1568.jpg`);
    if (!fs.existsSync(p)) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=31536000' });
    return res.end(fs.readFileSync(p));
  }

  if (req.method === 'POST' && url.pathname === '/upload') {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', async () => {
      try {
        const raw = Buffer.concat(chunks);
        const ct = req.headers['content-type'] || '';
        const isMultipart = /multipart\/form-data/i.test(ct);

        // P-005 Tier 1: the note arrives as a multipart field on the form path and as a
        // base64 X-User-Note header on the raw-fetch path (headers are latin-1 on the wire,
        // so base64 is how UTF-8 dictation survives it). Stored exactly as received (R-0024).
        let noteText = '';
        if (isMultipart) {
          noteText = formFields(raw, ct).note ?? '';
        } else if (req.headers['x-user-note']) {
          try { noteText = Buffer.from(String(req.headers['x-user-note']), 'base64').toString('utf8'); }
          catch (e) { log(`NOTE DECODE FAILED ${e}`); }
        }

        const part = isMultipart
          ? firstFilePart(raw, ct)
          : (raw.length ? { buf: raw, contentType: ct, filename: req.headers['x-filename'] || 'photo.jpg' } : null);
        if (!part) {
          log(`UPLOAD REJECTED: no file part. bytes=${raw.length} content-type=${req.headers['content-type']}`);
          res.writeHead(400, { 'content-type': 'text/plain' });
          return res.end('no file part in upload');
        }
        const received_at = new Date().toISOString();

        // R-0017: original bytes stored by sha256, never rewritten; sidecar alongside.
        const stored = storeCapture(part.buf, {
          contentType: part.contentType,
          originalFilename: part.filename,
          userAgent: req.headers['user-agent'],
          receivedAt: received_at,
          note: 'P-003 product upload',
        });
        const derived = deriveCapture(stored.sha256, stored.ext);
        log(`UPLOAD sha256=${stored.sha256} bytes=${part.buf.length} ${stored.sidecar.width}x${stored.sidecar.height} ` +
            `content-type=${part.contentType} derived=${derived.sha256.slice(0, 12)} remote=${req.socket.remoteAddress}`);

        // The note object as it will be stored. Never rewritten after this point.
        const user_note = {
          text: noteText,
          source: noteText.length ? 'dictation' : 'none',
          audio_sha256: null,
          transcript_model: null,
        };
        log(`NOTE source=${user_note.source} chars=${noteText.length} text=${JSON.stringify(noteText)}`);

        const spent = spentSoFar();
        let status, record_json = null, raw_response, usage_json = null, cost = null, elapsed_ms = 0;

        if (spent >= SPEND_CAP_USD) {
          status = 'invalid';
          raw_response = JSON.stringify({ refused: `P-003 spend cap USD ${SPEND_CAP_USD} reached (spent ${spent}); no model call made.` });
          log(`SPEND CAP REACHED spent=${spent} — refused to call the model`);
        } else {
          const r = await extract(derived.path, user_note.text);
          elapsed_ms = r.elapsed_ms;
          cost = r.cost ?? null;
          usage_json = r.usage ? JSON.stringify(r.usage) : null;
          raw_response = JSON.stringify(r.body);
          const content = r.body?.choices?.[0]?.message?.content ?? '';
          const cleaned = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
          let parsed = null, parseError = null;
          try { parsed = JSON.parse(cleaned); } catch (e) { parseError = String(e); }
          // R-0024: whatever the model said about user_note is discarded and the stored
          // note is substituted verbatim. The model may USE the note; it may not edit it.
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            if ('user_note' in parsed) log(`NOTE MODEL OVERRIDE DISCARDED: ${JSON.stringify(parsed.user_note)}`);
            parsed.user_note = user_note;
          }
          const errors = parsed ? validate(parsed, SCHEMA_VERSION) : [`JSON.parse failed: ${parseError}`];
          status = errors.length === 0 ? 'valid' : 'invalid';
          if (status === 'valid') record_json = JSON.stringify(parsed);
          log(`EXTRACT sha256=${stored.sha256.slice(0, 12)} model=${MODEL} status=${status} ` +
              `elapsed_ms=${elapsed_ms} cost_usd=${cost} tokens=${r.usage?.prompt_tokens}/${r.usage?.completion_tokens}` +
              (status === 'valid' ? '' : ` errors=${errors.slice(0, 3).join('; ')}`));
        }

        const info = db.prepare(`INSERT INTO records
          (original_sha256, derived_sha256, received_at, model, status, record_json, raw_response, usage_json, cost_usd, elapsed_ms,
           user_note_text, user_note_source, audio_sha256, transcript_model)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
            stored.sha256, derived.sha256, received_at, MODEL, status,
            record_json, raw_response, usage_json, cost, elapsed_ms,
            user_note.text, user_note.source, user_note.audio_sha256, user_note.transcript_model);
        log(`ROW id=${info.lastInsertRowid} status=${status} original_sha256=${stored.sha256} cost_usd=${cost}`);

        if (/multipart\/form-data/i.test(req.headers['content-type'] || '')) {
          res.writeHead(303, { location: '/' });
          return res.end();
        }
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end(`ok id=${info.lastInsertRowid} status=${status}`);
      } catch (e) {
        log(`UPLOAD FAILED ${e?.stack || e}`);
        res.writeHead(500, { 'content-type': 'text/plain' });
        res.end('upload failed: ' + (e?.message || e));
      }
    });
    return;
  }

  // --- P-004: pixels over HTTP ---------------------------------------------
  // Ruling 9 (R-0022): the stored original is canonical. /original/:sha serves
  // the exact bytes on disk; the derived copy is only ever an explicit opt-in.

  if (req.method === 'GET' && url.pathname.startsWith('/original/')) {
    const sha = url.pathname.slice('/original/'.length);
    if (!/^[0-9a-f]{64}$/.test(sha)) { res.writeHead(400); return res.end('bad sha'); }
    const cap = resolveOriginal(sha);
    if (!cap) { res.writeHead(404); return res.end('not found'); }
    const buf = fs.readFileSync(cap.path);
    res.writeHead(200, {
      'content-type': cap.mime,
      'content-length': String(buf.length),
      'etag': `"${sha}"`,
      'cache-control': 'public, max-age=31536000, immutable',
    });
    return res.end(buf);
  }

  const recMatch = /^\/api\/records\/(\d+)(\/image)?$/.exec(url.pathname);
  if (req.method === 'GET' && recMatch) {
    const row = db.prepare('SELECT * FROM records WHERE id = ?').get(Number(recMatch[1]));
    if (!row) { res.writeHead(404, { 'content-type': 'application/json' }); return res.end('{"error":"no such record"}'); }
    const orig = resolveOriginal(row.original_sha256);

    if (!recMatch[2]) {
      const der = derivedInfo(row.original_sha256);
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({
        ...row,
        original_url: `/original/${row.original_sha256}`,
        derived_url: `/derived/${row.original_sha256}`,
        original_sha256: row.original_sha256,
        derived_sha256: row.derived_sha256,
        width: orig?.width ?? null,
        height: orig?.height ?? null,
        bytes: orig?.bytes ?? null,
        original: orig ? { sha256: row.original_sha256, path: path.relative(ROOT, orig.path), mime: orig.mime, width: orig.width, height: orig.height, bytes: orig.bytes } : null,
        derived: der ? { sha256: row.derived_sha256, path: path.relative(ROOT, der.path), mime: der.mime, width: der.width, height: der.height, bytes: der.bytes } : null,
      }, null, 2));
    }

    // /api/records/:id/image?variant=original|derived&as=base64   (variant defaults to original)
    const variant = url.searchParams.get('variant') || 'original';
    if (variant !== 'original' && variant !== 'derived') {
      res.writeHead(400, { 'content-type': 'application/json' });
      return res.end('{"error":"variant must be original or derived"}');
    }
    const info = variant === 'original' ? orig : derivedInfo(row.original_sha256);
    if (!info) { res.writeHead(404, { 'content-type': 'application/json' }); return res.end('{"error":"image file missing"}'); }
    const buf = fs.readFileSync(info.path);

    if ((url.searchParams.get('as') || 'base64') !== 'base64') {
      res.writeHead(200, { 'content-type': info.mime, 'content-length': String(buf.length), 'etag': `"${info.sha256}"` });
      return res.end(buf);
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({
      variant,
      sha256: info.sha256,
      mime: info.mime,
      width: info.width,
      height: info.height,
      bytes: info.bytes,
      data_url: `data:${info.mime};base64,${buf.toString('base64')}`,
    }));
  }

  res.writeHead(404).end('not found');
});

server.listen(PORT, '0.0.0.0', () => {
  log(`SnapRecord listening on 0.0.0.0:${PORT}  db=${path.relative(ROOT, DB_PATH)}  rows=${allRows().length}`);
  const ips = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces()))
    for (const a of addrs || []) if (a.family === 'IPv4' && !a.internal) ips.push({ name, address: a.address });
  for (const ip of ips) log(`OPEN ON PHONE: http://${ip.address}:${PORT}/   (interface ${ip.name})`);
  if (!ips.length) log('NO LAN IP FOUND');
});
