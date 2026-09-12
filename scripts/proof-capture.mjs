// P-001 Proof A: phone camera -> laptop. Dependency-free Node HTTP server.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CAPTURE_DIR = path.join(ROOT, 'supervision', 'evidence', 'captures');
const LOG_FILE = path.join(ROOT, 'supervision', 'evidence', 'proof-capture.log');
const PORT = 8787;

fs.mkdirSync(CAPTURE_DIR, { recursive: true });

function log(line) {
  const stamp = new Date().toISOString();
  const entry = `[${stamp}] ${line}`;
  console.log(entry);
  fs.appendFileSync(LOG_FILE, entry + '\n');
}

function lanIPs() {
  const out = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal) out.push({ name, address: a.address });
    }
  }
  return out;
}

const PAGE = `<!doctype html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>SnapRecord Proof A</title>
<style>
 body{font:16px -apple-system,system-ui,sans-serif;margin:0;padding:24px;background:#111;color:#eee}
 h1{font-size:20px} label{display:block;margin:24px 0 8px}
 input[type=file]{display:block;width:100%;padding:16px;background:#222;border:1px solid #444;border-radius:8px;color:#eee}
 button{margin-top:24px;width:100%;padding:18px;font-size:18px;background:#2d7;border:0;border-radius:8px;font-weight:600}
 #status{margin-top:20px;padding:12px;border-radius:8px;background:#222;white-space:pre-wrap}
 img{max-width:100%;margin-top:16px;border-radius:8px}
</style></head><body>
<h1>SnapRecord — Proof A</h1>
<p>Photograph any labelled object (packaged food, bottle, book spine).</p>
<form id="f">
  <label for="photo">Tap to open camera:</label>
  <input id="photo" name="photo" type="file" accept="image/*" capture="environment">
  <button type="submit">Send to laptop</button>
</form>
<div id="status">Waiting for a photo.</div>
<img id="preview" hidden>
<script>
const f=document.getElementById('f'),inp=document.getElementById('photo'),
      st=document.getElementById('status'),pv=document.getElementById('preview');
inp.addEventListener('change',()=>{
  const file=inp.files&&inp.files[0];
  if(!file)return;
  st.textContent='Selected: '+file.name+'\\n'+file.type+'\\n'+file.size+' bytes';
  pv.src=URL.createObjectURL(file); pv.hidden=false;
});
f.addEventListener('submit',async e=>{
  e.preventDefault();
  const file=inp.files&&inp.files[0];
  if(!file){st.textContent='No photo selected yet.';return;}
  st.textContent='Uploading '+file.size+' bytes...';
  try{
    const r=await fetch('/upload',{method:'POST',
      headers:{'content-type':file.type||'application/octet-stream',
               'x-filename':file.name||'photo.jpg'},
      body:file});
    st.textContent=await r.text();
  }catch(err){st.textContent='Upload failed: '+err;}
});
</script></body></html>`;

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && (req.url === '/' || req.url.startsWith('/?'))) {
    log(`GET / from ${req.socket.remoteAddress} ua="${req.headers['user-agent'] || ''}"`);
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(PAGE);
  }
  if (req.method === 'POST' && req.url === '/upload') {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const buf = Buffer.concat(chunks);
      const ct = req.headers['content-type'] || 'unknown';
      const ua = req.headers['user-agent'] || 'unknown';
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const ext = ct.includes('png') ? '.png' : ct.includes('heic') ? '.heic' : '.jpg';
      const file = path.join(CAPTURE_DIR, ts + ext);
      fs.writeFileSync(file, buf);
      log(`UPLOAD ok file=${path.basename(file)} bytes=${buf.length} content-type=${ct} remote=${req.socket.remoteAddress} user-agent="${ua}"`);
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(`Received ${buf.length} bytes (${ct}) -> ${path.basename(file)}\nYou can close this page.`);
    });
    return;
  }
  res.writeHead(404).end('not found');
});

server.listen(PORT, '0.0.0.0', () => {
  log(`server listening on 0.0.0.0:${PORT}`);
  const ips = lanIPs();
  for (const ip of ips) log(`OPEN ON PHONE: http://${ip.address}:${PORT}/   (interface ${ip.name})`);
  if (!ips.length) log('NO LAN IP FOUND');
});
