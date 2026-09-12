// SnapRecord hand-written validator. No dependencies.
// Supports schema v0 (P-001, unchanged), v1 (P-002, unchanged) and v2 (P-005).
// Exported: validate(obj, version) -> array of error strings (empty === valid).

const isStr  = v => typeof v === 'string';
const isNum  = v => typeof v === 'number' && Number.isFinite(v);
const isBool = v => typeof v === 'boolean';
const isObj  = v => v !== null && typeof v === 'object' && !Array.isArray(v);

const V0_KEYS = ['item_name','brand','category','label_text','attributes','quantity','confidence','uncertain_fields'];
const V1_KEYS = [...V0_KEYS, 'field_confidence', 'capture'];
const V2_KEYS = [...V1_KEYS, 'user_note'];
const V0_REQUIRED = ['item_name','category','label_text','attributes','confidence'];
const V1_REQUIRED = [...V0_REQUIRED, 'field_confidence', 'capture'];
const V2_REQUIRED = [...V1_REQUIRED, 'user_note'];
const NOTE_SOURCES = ['none','dictation','transcription'];
// field_confidence keys are closed to the top-level CONTENT fields (not the meta fields)
const FC_KEYS = ['item_name','brand','category','label_text','attributes','quantity'];

export function validate(obj, version = 'v2') {
  if (!['v0','v1','v2'].includes(version)) return [`unknown schema version "${version}"`];
  const errs = [];
  if (!isObj(obj)) return ['root: not an object'];

  const allowed  = version === 'v2' ? V2_KEYS : version === 'v1' ? V1_KEYS : V0_KEYS;
  const required = version === 'v2' ? V2_REQUIRED : version === 'v1' ? V1_REQUIRED : V0_REQUIRED;

  for (const k of Object.keys(obj)) if (!allowed.includes(k)) errs.push(`additionalProperties: unexpected key "${k}"`);
  for (const k of required) if (!(k in obj)) errs.push(`required: missing "${k}"`);

  if ('item_name'  in obj && !isStr(obj.item_name))  errs.push('item_name: not a string');
  if ('category'   in obj && !isStr(obj.category))   errs.push('category: not a string');
  if ('label_text' in obj && !isStr(obj.label_text)) errs.push('label_text: not a string');
  if ('brand'      in obj && !(isStr(obj.brand) || obj.brand === null)) errs.push('brand: not string|null');
  if ('quantity'   in obj && !(isNum(obj.quantity) || obj.quantity === null)) errs.push('quantity: not number|null');

  if ('confidence' in obj) {
    if (!isNum(obj.confidence)) errs.push('confidence: not a number');
    else if (obj.confidence < 0 || obj.confidence > 1) errs.push('confidence: out of range 0..1');
  }

  if ('attributes' in obj) {
    if (!Array.isArray(obj.attributes)) errs.push('attributes: not an array');
    else obj.attributes.forEach((a, i) => {
      if (!isObj(a)) { errs.push(`attributes[${i}]: not an object`); return; }
      for (const k of Object.keys(a)) if (!['key','value','unit'].includes(k))
        errs.push(`attributes[${i}]: additionalProperties: unexpected key "${k}"`);
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

  if (version === 'v0') return errs;

  // --- v1 additions (also present in v2) ---
  if ('field_confidence' in obj) {
    if (!isObj(obj.field_confidence)) errs.push('field_confidence: not an object');
    else for (const [k, v] of Object.entries(obj.field_confidence)) {
      if (!FC_KEYS.includes(k)) errs.push(`field_confidence: unexpected key "${k}"`);
      if (!isNum(v)) errs.push(`field_confidence["${k}"]: not a number`);
      else if (v < 0 || v > 1) errs.push(`field_confidence["${k}"]: out of range 0..1`);
    }
  }

  if ('capture' in obj) {
    const c = obj.capture;
    if (!isObj(c)) errs.push('capture: not an object');
    else {
      for (const k of Object.keys(c)) if (!['label_legible','issues'].includes(k))
        errs.push(`capture: additionalProperties: unexpected key "${k}"`);
      if (!('label_legible' in c)) errs.push('capture.label_legible: missing');
      else if (!isBool(c.label_legible)) errs.push('capture.label_legible: not a boolean');
      if (!('issues' in c)) errs.push('capture.issues: missing');
      else if (!Array.isArray(c.issues)) errs.push('capture.issues: not an array');
      else c.issues.forEach((s, i) => { if (!isStr(s)) errs.push(`capture.issues[${i}]: not a string`); });
    }
  }

  if (version === 'v1') return errs;

  // --- v2 addition: user_note (P-005, R-0024/R-0026) ---
  if ('user_note' in obj) {
    const n = obj.user_note;
    if (!isObj(n)) errs.push('user_note: not an object');
    else {
      for (const k of Object.keys(n)) if (!['text','source','audio_sha256','transcript_model'].includes(k))
        errs.push(`user_note: additionalProperties: unexpected key "${k}"`);
      if (!('text' in n)) errs.push('user_note.text: missing');
      else if (!isStr(n.text)) errs.push('user_note.text: not a string');
      if (!('source' in n)) errs.push('user_note.source: missing');
      else if (!NOTE_SOURCES.includes(n.source)) errs.push(`user_note.source: not one of ${NOTE_SOURCES.join('|')}`);
      if (!('audio_sha256' in n)) errs.push('user_note.audio_sha256: missing');
      else if (!(isStr(n.audio_sha256) || n.audio_sha256 === null)) errs.push('user_note.audio_sha256: not string|null');
      if (!('transcript_model' in n)) errs.push('user_note.transcript_model: missing');
      else if (!(isStr(n.transcript_model) || n.transcript_model === null)) errs.push('user_note.transcript_model: not string|null');
      // R-0026: a transcription must name the audio it came from.
      if (n.source === 'transcription' && !isStr(n.audio_sha256))
        errs.push('user_note: source "transcription" requires an audio_sha256 (R-0026)');
    }
  }

  return errs;
}
