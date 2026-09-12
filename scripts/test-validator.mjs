// Unit tests for the hand-written validator. Dependency-free.
// Run: node scripts/test-validator.mjs   (exits non-zero on any failure)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate } from './validate.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIX = path.join(ROOT, 'fixtures', 'validator');
const load = f => JSON.parse(fs.readFileSync(path.join(FIX, f), 'utf8'));

let failures = 0;
function check(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '\n        ' + detail : ''}`);
  if (!ok) failures++;
}
// expect the validator to produce errors matching every one of `wanted` (substring match), and no others missing
function expectInvalid(name, obj, version, wanted) {
  const errs = validate(obj, version);
  const missing = wanted.filter(w => !errs.some(e => e.includes(w)));
  check(name, errs.length > 0 && missing.length === 0,
    `errors: ${JSON.stringify(errs)}${missing.length ? `\n        MISSING expected: ${JSON.stringify(missing)}` : ''}`);
}

console.log('validator tests — schema v2 (and v1/v0 regression)\n');

// 1. valid v1
{
  const errs = validate(load('v1-valid.json'), 'v1');
  check('v1 valid fixture reports zero errors', errs.length === 0, errs.length ? `errors: ${JSON.stringify(errs)}` : '');
}
// 2. missing required
expectInvalid('v1 missing required "capture" is rejected', load('v1-invalid-missing-required.json'), 'v1',
  ['required: missing "capture"']);
// 3. wrong type
expectInvalid('v1 wrong types (field_confidence value, capture.label_legible) are rejected',
  load('v1-invalid-wrong-type.json'), 'v1',
  ['field_confidence["item_name"]: not a number', 'capture.label_legible: not a boolean']);
// 4. extra property
expectInvalid('v1 extra properties at root and inside capture are rejected',
  load('v1-invalid-extra-property.json'), 'v1',
  ['additionalProperties: unexpected key "expiry_date"', 'capture: additionalProperties: unexpected key "lighting"']);

// --- extra guards ---
// 5. v0 unchanged: the P-001 shape still validates under v0
{
  const errs = validate(load('v0-valid.json'), 'v0');
  check('v0 fixture still valid under v0 (v0 unchanged)', errs.length === 0, errs.length ? `errors: ${JSON.stringify(errs)}` : '');
}
// 6. v0 shape must FAIL v1 (v1 adds required fields)
expectInvalid('v0 shape fails under v1 (field_confidence + capture now required)', load('v0-valid.json'), 'v1',
  ['required: missing "field_confidence"', 'required: missing "capture"']);
// 7. field_confidence key set is closed
expectInvalid('field_confidence rejects a key that is not a top-level content field',
  { ...load('v1-valid.json'), field_confidence: { confidence: 0.9 } }, 'v1',
  ['field_confidence: unexpected key "confidence"']);
// 8. numeric range enforced
expectInvalid('field_confidence rejects a value outside 0..1',
  { ...load('v1-valid.json'), field_confidence: { item_name: 1.4 } }, 'v1',
  ['field_confidence["item_name"]: out of range 0..1']);
// 9. non-object root
expectInvalid('a JSON array is not a valid record', [1, 2, 3], 'v1', ['root: not an object']);

// --- v2: user_note (P-005) ---
// 10. valid v2
{
  const errs = validate(load('v2-valid.json'), 'v2');
  check('v2 valid fixture reports zero errors', errs.length === 0, errs.length ? `errors: ${JSON.stringify(errs)}` : '');
}
// 11. v1 shape must FAIL v2 (user_note now required)
expectInvalid('v1 shape fails under v2 (user_note now required)', load('v1-valid.json'), 'v2',
  ['required: missing "user_note"']);
// 12. v2 shape must FAIL v1 (v1 is closed and does not know user_note)
expectInvalid('v2 shape fails under v1 (v1 unchanged and closed)', load('v2-valid.json'), 'v1',
  ['additionalProperties: unexpected key "user_note"']);
// 13. user_note is closed
expectInvalid('user_note rejects an unexpected key',
  { ...load('v2-valid.json'), user_note: { text: '', source: 'none', audio_sha256: null, transcript_model: null, language: 'en' } }, 'v2',
  ['user_note: additionalProperties: unexpected key "language"']);
// 14. source enum
expectInvalid('user_note.source rejects a value outside the enum',
  { ...load('v2-valid.json'), user_note: { text: 'x', source: 'typed', audio_sha256: null, transcript_model: null } }, 'v2',
  ['user_note.source: not one of none|dictation|transcription']);
// 15. R-0026: transcription must name its audio
expectInvalid('user_note.source "transcription" without audio_sha256 is rejected (R-0026)',
  { ...load('v2-valid.json'), user_note: { text: 'x', source: 'transcription', audio_sha256: null, transcript_model: 'some/model' } }, 'v2',
  ['requires an audio_sha256']);
// 16. an empty note is legal
{
  const errs = validate({ ...load('v2-valid.json'), user_note: { text: '', source: 'none', audio_sha256: null, transcript_model: null } }, 'v2');
  check('an empty note with source "none" is valid', errs.length === 0, errs.length ? `errors: ${JSON.stringify(errs)}` : '');
}

console.log(`\n${failures === 0 ? 'ALL TESTS PASSED' : failures + ' TEST(S) FAILED'} (16 tests)`);
process.exit(failures === 0 ? 0 : 1);
