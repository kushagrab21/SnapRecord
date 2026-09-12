// Ingests already-received uploads into the content-addressed store (P-002A ruling 5),
// recovering user-agent / content-type / received-at from proof-capture.log.
// Usage: node scripts/ingest-captures.mjs <file> [<file> ...]
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, storeCapture, deriveCapture } from './store.mjs';

const LOG = path.join(ROOT, 'supervision', 'evidence', 'proof-capture.log');
const logLines = fs.readFileSync(LOG, 'utf8').split('\n');

function lookup(basename) {
  const line = logLines.find(l => l.includes(`UPLOAD ok file=${basename} `));
  if (!line) return {};
  return {
    receivedAt: (line.match(/^\[([^\]]+)\]/) || [])[1] ?? null,
    contentType: (line.match(/content-type=(\S+)/) || [])[1] ?? null,
    userAgent: (line.match(/user-agent="([^"]*)"/) || [])[1] ?? null,
  };
}

for (const f of process.argv.slice(2)) {
  const basename = path.basename(f);
  const buf = fs.readFileSync(f);
  const found = lookup(basename);
  const r = storeCapture(buf, { originalFilename: basename, ...found, note: 'ingested from P-002 raw upload directory' });
  const d = deriveCapture(r.sha256, r.ext);
  console.log(`${basename}`);
  console.log(`  original sha256 ${r.sha256}  ${r.sidecar.width}x${r.sidecar.height}  ${r.sidecar.bytes} bytes  ${r.already ? '(already stored)' : '(stored)'}`);
  console.log(`  derived  sha256 ${d.sha256}  ${d.width}x${d.height}`);
  console.log(`  received_at ${r.sidecar.received_at}  ua ${r.sidecar.user_agent ? r.sidecar.user_agent.slice(0, 60) + '…' : 'unknown'}`);
}
