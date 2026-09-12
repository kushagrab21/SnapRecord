// SnapRecord content-addressed capture store (P-002A ruling 5). Dependency-free.
// data/captures/<sha256>.<ext>        original bytes, written once, never rewritten
// data/captures/<sha256>.json         sidecar metadata (no pixels)
// data/derived/<sha256>.1568.jpg      inference-only derivative
// Sidecars are mirrored into supervision/evidence/capture-sidecars/ because they carry no pixels.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CAPTURES = path.join(ROOT, 'data', 'captures');
export const DERIVED = path.join(ROOT, 'data', 'derived');
export const AUDIO = path.join(ROOT, 'data', 'audio');
export const SIDECAR_EVIDENCE = path.join(ROOT, 'supervision', 'evidence', 'capture-sidecars');
export const MAX_EDGE = 1568;

export const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');
export const sha256File = p => sha256(fs.readFileSync(p));

export function dims(p) {
  const out = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', p]).toString();
  return { width: +(out.match(/pixelWidth:\s*(\d+)/) || [])[1], height: +(out.match(/pixelHeight:\s*(\d+)/) || [])[1] };
}

function extFor(contentType, originalFilename) {
  if (/png/i.test(contentType)) return '.png';
  if (/heic/i.test(contentType)) return '.heic';
  if (/jpe?g/i.test(contentType)) return '.jpg';
  const m = String(originalFilename || '').match(/(\.[A-Za-z0-9]+)$/);
  return m ? m[1].toLowerCase() : '.jpg';
}

// Stores the buffer at its exact original bytes. Idempotent: a byte-identical
// re-upload maps to the same hash and the existing file is left untouched.
export function storeCapture(buf, meta = {}) {
  fs.mkdirSync(CAPTURES, { recursive: true });
  fs.mkdirSync(SIDECAR_EVIDENCE, { recursive: true });
  const hash = sha256(buf);
  const ext = extFor(meta.contentType, meta.originalFilename);
  const file = path.join(CAPTURES, hash + ext);
  let already = fs.existsSync(file);
  if (!already) {
    // 'wx' fails rather than truncating: an original is never rewritten.
    const fd = fs.openSync(file, 'wx');
    try { fs.writeFileSync(fd, buf); } finally { fs.closeSync(fd); }
  }
  const d = dims(file);
  const sidecar = {
    sha256: hash,
    stored_as: path.relative(ROOT, file),
    original_filename: meta.originalFilename ?? null,
    bytes: buf.length,
    width: d.width,
    height: d.height,
    content_type: meta.contentType ?? null,
    user_agent: meta.userAgent ?? null,
    received_at: meta.receivedAt ?? new Date().toISOString(),
    note: meta.note ?? null,
  };
  const sidecarPath = path.join(CAPTURES, hash + '.json');
  if (!fs.existsSync(sidecarPath)) fs.writeFileSync(sidecarPath, JSON.stringify(sidecar, null, 2));
  fs.copyFileSync(sidecarPath, path.join(SIDECAR_EVIDENCE, hash + '.json'));
  return { sha256: hash, ext, file, sidecarPath, sidecar: JSON.parse(fs.readFileSync(sidecarPath, 'utf8')), already };
}

// P-005 ruling 12 (R-0025): recorded audio follows the same rule as pixels — the
// exact bytes the browser handed over, stored once at their own hash, with a
// sidecar beside them. The transcript is a derivative and lives in the record.
const AUDIO_EXT = { 'audio/mp4': '.m4a', 'audio/m4a': '.m4a', 'audio/aac': '.aac', 'audio/mpeg': '.mp3',
                    'audio/webm': '.webm', 'audio/ogg': '.ogg', 'audio/wav': '.wav', 'audio/x-wav': '.wav' };

export function storeAudio(buf, meta = {}) {
  fs.mkdirSync(AUDIO, { recursive: true });
  fs.mkdirSync(SIDECAR_EVIDENCE, { recursive: true });
  const hash = sha256(buf);
  const base = String(meta.contentType || '').split(';')[0].trim().toLowerCase();
  const ext = AUDIO_EXT[base] || '.bin';
  const file = path.join(AUDIO, hash + ext);
  if (!fs.existsSync(file)) {
    const fd = fs.openSync(file, 'wx');           // never rewritten, as with captures
    try { fs.writeFileSync(fd, buf); } finally { fs.closeSync(fd); }
  }
  const sidecar = {
    sha256: hash,
    stored_as: path.relative(ROOT, file),
    bytes: buf.length,
    content_type: meta.contentType ?? null,       // whatever MediaRecorder chose; not normalised
    user_agent: meta.userAgent ?? null,
    received_at: meta.receivedAt ?? new Date().toISOString(),
    note: meta.note ?? null,
  };
  const sidecarPath = path.join(AUDIO, hash + '.json');
  if (!fs.existsSync(sidecarPath)) fs.writeFileSync(sidecarPath, JSON.stringify(sidecar, null, 2));
  fs.copyFileSync(sidecarPath, path.join(SIDECAR_EVIDENCE, hash + '.json'));
  return { sha256: hash, ext, file, sidecarPath, sidecar, mime: base };
}

// Produces the inference-only derivative. Reads the original; never writes to it.
export function deriveCapture(hash, ext) {
  fs.mkdirSync(DERIVED, { recursive: true });
  const src = path.join(CAPTURES, hash + ext);
  const out = path.join(DERIVED, `${hash}.${MAX_EDGE}.jpg`);
  if (!fs.existsSync(out)) execFileSync('sips', ['-s', 'format', 'jpeg', '-Z', String(MAX_EDGE), src, '--out', out]);
  return { path: out, sha256: sha256File(out), ...dims(out) };
}
