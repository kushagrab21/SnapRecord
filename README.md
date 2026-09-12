# SnapRecord

SnapRecord turns a photograph of a physical object or its label into a structured, validated, stored record. You open a page on your phone, photograph a thing, and the server keeps the original image byte-for-byte, sends a downscaled copy to a vision model, validates what comes back against a JSON Schema, and writes a row to SQLite. The same page on a laptop lists every record so far. It is one Node process with no dependencies, no build step and no framework — `node:http`, `node:sqlite`, `fetch`, and macOS `sips` for image work.

## Run

```
node server/index.mjs
```

It listens on port 8788 and prints a LAN URL; open that URL on a phone joined to the same Wi-Fi (it is plain HTTP, no auth, no HTTPS). One caveat worth knowing before you demonstrate it: opening the page inside the Google app's in-app WebView on iOS, rather than in Safari proper, made a native multipart form submit produce no HTTP request at all, so the upload button now sends the file with `fetch` instead — see R-0021 in `supervision/RESULTS.md`.

## Where the pixels live

Every capture is content-addressed by the SHA-256 of its bytes. The untouched original is written once to `data/captures/<sha256>.<ext>` and never rewritten; the downscaled copy that goes to the model is `data/derived/<sha256>.1568.jpg`, where `<sha256>` is still the *original's* hash and 1568 is the longest edge in pixels. Beside each original sits a sidecar `data/captures/<sha256>.json` carrying `sha256`, `stored_as`, `original_filename`, `bytes`, `width`, `height`, `content_type`, `user_agent`, `received_at` and a free-text `note` — metadata only, no pixels, which is why sidecars are mirrored into `supervision/evidence/capture-sidecars/`. The rows live in `data/snaprecord.sqlite`. The whole `data/` directory is git-ignored, so nothing in this repository contains an image.

The original is the canonical image. Everything below hands a model the bytes from `data/captures/`; the derived copy is available as an explicit, labelled alternative — it is cheaper in tokens and safer against provider size limits, but it is a re-encode, not the photograph.

## Feeding an image to an LLM

Three ways in, all reading the same stored original. First, ask the server for the image as a data URL ready to paste into a vision request:

```
curl -s 'http://localhost:8788/api/records/2/image?variant=original&as=base64'
```

That returns `{ sha256, mime, width, height, bytes, data_url }`, where `data_url` is `data:image/jpeg;base64,...`. Add `variant=derived` for the 1568px copy. The raw bytes are also served on their own at `GET /original/<sha256>` with the correct `Content-Type`, `Content-Length` and `ETag: "<sha256>"`, and `GET /api/records/<id>` returns the row with `original_url`, `derived_url`, both hashes, and the width, height and byte count.

Second, ask a question from the shell — this reads the original off disk and needs no server running:

```
node scripts/ask.mjs 992e8692a142 "What is printed on this label?"
```

The first argument is a record id or a SHA-256 (a unique prefix is enough). It prints the model's answer on stdout and the token counts and provider `usage.cost` on stderr, so `... | pbcopy` gets you only the answer. Defaults are the stored original and `google/gemini-3.8-flash`; override with `--variant derived` and `--model <id>`.

Third, build the request yourself. This is the whole of it:

```js
import fs from 'node:fs';
const b64 = fs.readFileSync('data/captures/992e8692a142….jpg').toString('base64');
const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
  method: 'POST',
  headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ model: 'google/gemini-3.8-flash', usage: { include: true },
    messages: [{ role: 'user', content: [
      { type: 'text', text: 'What is printed on this label?' },
      { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64}` } }]}] }),
});
const body = await res.json();
console.log(body.choices[0].message.content, body.usage.cost);
```

## The record schema

Records are validated against `schema/item.v1.json`; the validator is `scripts/validate.mjs` and rejects any property the schema does not name. `item_name` is what the thing is and `brand` is who made it, or null. `category` is a free-text class. `label_text` is all legible text on the label, verbatim, with newlines preserved. `attributes` is an array of `{key, value, unit}` objects with `unit` nullable, and `quantity` is a number or null. `confidence` is the model's own overall 0..1 score, and `field_confidence` gives one 0..1 score per content field it filled. `uncertain_fields` names fields the model was unsure of. `capture.label_legible` says whether label text was actually readable, and `capture.issues` lists what degraded it — glare, blur, cropped, distance — or is empty.

Extraction accuracy has not been measured.

Every number above that a model produced describes the model's opinion of itself and has been checked by nothing.

## Supervision

This repository is built under a written supervision protocol: work arrives as numbered packets in `supervision/orders/`, and every finding, ruling and limitation is recorded as a numbered result in `supervision/RESULTS.md` with its evidence and its caveat. `supervision/ORIENTATION.md` is the standing brief — what exists, what is decided, what is open — and is the file to read first.
