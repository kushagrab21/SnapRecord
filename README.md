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

Records are validated against `schema/item.v2.json`; the validator is `scripts/validate.mjs` and rejects any property the schema does not name. `item_name` is what the thing is and `brand` is who made it, or null. `category` is a free-text class. `label_text` is all legible text on the label, verbatim, with newlines preserved. `attributes` is an array of `{key, value, unit}` objects with `unit` nullable, and `quantity` is a number or null. `confidence` is the model's own overall 0..1 score, and `field_confidence` gives one 0..1 score per content field it filled. `uncertain_fields` names fields the model was unsure of. `capture.label_legible` says whether label text was actually readable, and `capture.issues` lists what degraded it — glare, blur, cropped, distance — or is empty. `user_note` is what the user said about the object and is described in **Voice** below.

`schema/item.v0.json` and `schema/item.v1.json` are unchanged and the validator still accepts both: `validate(obj, 'v1')` behaves exactly as it did before v2 existed. The versions are closed against each other in both directions — a v1 record fails under v2 because `user_note` is now required, and a v2 record fails under v1 because v1 does not know the property.

Extraction accuracy has not been measured.

Every number above that a model produced describes the model's opinion of itself and has been checked by nothing.

## Voice

You can say what a thing is instead of typing it, and there are two ways to do that with very different requirements.

**Dictation works everywhere, over plain HTTP.** Under the file input is a box reading *Say or type what this is*. Tap it, tap the microphone key on the iOS keyboard, and speak; iOS turns the speech into text before the page sees a character. This needs no permission prompt, no secure origin and no certificate, which is why it is the path the product actually ships on — the LAN server is plain HTTP and browsers will not grant a microphone to a plain-HTTP page.

**Recording needs the HTTPS URL and a certificate the phone trusts.** `navigator.mediaDevices.getUserMedia` and `MediaRecorder` exist only on a secure origin, so a *Hold to record* button appears under the note box only when the browser offers both. To get there, generate a certificate for this machine's LAN address and restart:

```
sh scripts/make-cert.sh          # writes data/cert/{cert.pem,key.pem}, git-ignored
node server/index.mjs            # now also listens on https://<lan-ip>:8789
```

Then open `https://<lan-ip>:8789/` **in Safari**, not in an in-app browser, and accept the certificate warning. It is self-signed, so the phone will object; getting past that objection is a human action that can fail, and if it fails, dictation over HTTP is the whole feature. The certificate is generated against whatever `ipconfig getifaddr en0` reports at the time, because the LAN address is DHCP-assigned and changes between networks.

**What is stored where.** The note lands in the record as `user_note`, an object of four fields. `text` is what was said. `source` is `none` when the box was left empty, `dictation` when the text came from the keyboard, and `transcription` when it came from a recording. `audio_sha256` is the hash of the recording, or null. `transcript_model` names the model that produced the transcript, or null. A `user_note` whose source is `transcription` must carry an `audio_sha256`, and the validator rejects it otherwise — a transcript always names the audio it came from.

Recorded audio is stored the same way pixels are: the exact bytes the browser handed over, written once to `data/audio/<sha256>.<ext>` and never rewritten, with a sidecar `data/audio/<sha256>.json` beside them recording bytes, content type, user agent and arrival time. No mime type is requested from `MediaRecorder` — iOS gives `audio/mp4`, other browsers `audio/webm` — and nothing normalises what arrives. The transcript is a derivative of those bytes, not a replacement for them; `GET /audio/<sha256>` serves the original recording back. Transcription uses `google/gemini-3.8-flash`, whose OpenRouter `input_modalities` include `audio`, and its cost is added to the row.

**The note is verbatim.** Whatever arrives is stored exactly as received and no code and no model edits it. The extraction model is given the note as context, in one fixed sentence — *The user said about this object: «…». Use it to resolve ambiguity; never contradict what is visibly printed.* — and is told not to emit `user_note` at all; if it emits one anyway the value is logged and thrown away and the stored note is put back. Print the exact prompt with `node scripts/prompt.mjs "what the user said"`.

One limit worth stating plainly: verbatim binds the server and the model, not the microphone. iOS dictation has already interpreted the speech by the time the page sees text, so a dictation mishearing is recorded as faithfully as a typed word and is indistinguishable from one in the stored row. For a recording, only the audio bytes are primary; the transcript is one model's reading of them.

## Supervision

This repository is built under a written supervision protocol: work arrives as numbered packets in `supervision/orders/`, and every finding, ruling and limitation is recorded as a numbered result in `supervision/RESULTS.md` with its evidence and its caveat. `supervision/ORIENTATION.md` is the standing brief — what exists, what is decided, what is open — and is the file to read first.
