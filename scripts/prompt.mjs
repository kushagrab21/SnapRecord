// SnapRecord extraction prompt. Split out of server/index.mjs in P-005 so the exact
// text sent to the model can be printed as evidence without starting the server:
//   node scripts/prompt.mjs "what the user said"
// The P-002 body is copied verbatim and not edited; P-005 adds the user_note rules.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './store.mjs';

export const SCHEMA_VERSION = 'v2';
const schemaText = fs.readFileSync(path.join(ROOT, 'schema', `item.${SCHEMA_VERSION}.json`), 'utf8');

export const PROMPT = `You are extracting a structured record from a photograph of a physical object or its label.
Return ONLY a single JSON object, no markdown fence, no prose, matching exactly this JSON Schema:

${schemaText}

Rules:
- label_text must contain ALL legible text on the label, verbatim, preserving line order; use \\n between lines.
- attributes is an array of {key, value, unit} objects; unit may be null.
- confidence is your overall confidence 0..1.
- uncertain_fields lists the names of any fields you were unsure about.
- field_confidence gives one 0..1 score per top-level content field you filled (item_name, brand, category, label_text, attributes, quantity). Score each field on its own; do not repeat your overall confidence.
- capture.label_legible is true only if label text is actually readable in the image; capture.issues lists what degrades it, such as glare, blur, cropped, distance. Use an empty array if nothing does.
- Do not add any property not in the schema.
- Do NOT output user_note. The server fills that field with what the user said, verbatim; anything you put there is discarded.`;

// P-005 ruling 11 (R-0024): the note is context for the model and nothing more. This
// sentence is fixed; only the note itself is interpolated, and it is not rewritten.
export function promptFor(noteText) {
  if (!noteText) return PROMPT;
  return PROMPT + `\n\nThe user said about this object: «${noteText}». Use it to resolve ambiguity; never contradict what is visibly printed.`;
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write(promptFor(process.argv[2] || '') + '\n');
