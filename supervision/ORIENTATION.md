# SnapRecord — ORIENTATION

**Directory:** `~/Desktop/SnapRecord`. Separate from Followthrough at `~/Desktop/Demo_AI`.

**What it is:** photograph an object or its label; get a validated stored structured record.

## Stack — DECIDED (R-0020)
Zero dependencies: Node 26 `http`/`fetch`, built-in `node:sqlite`, macOS `sips`. No framework, no PWA, no HTTPS. One command: `node server/index.mjs`, port 8788.

## What exists
`server/index.mjs` is the product. `POST /upload` stores the original by sha256 with a sidecar (R-0017), derives a 1568px copy, calls `google/gemini-3.8-flash` with the P-002 prompt, validates against `schema/item.v1.json`, inserts into `data/snaprecord.sqlite`, redirects. `GET /` renders form and list; `/derived/:sha` thumbnails; `/api/records` rows. Invalid extractions are stored with their raw response and shown marked. `data/` is git-ignored.

P-004 opened the stored pixels to model use. The original is canonical (R-0022): `GET /original/:sha` serves exact bytes with `ETag`, `GET /api/records/:id` adds URLs, hashes and dimensions, and `GET /api/records/:id/image?variant=&as=base64` returns a ready-to-send data URL. `scripts/ask.mjs <sha|id> "<question>"` asks a question about an original from the shell. `README.md` is now the real one. Only `ask.mjs` was verified (R-0023); the endpoints and README examples ship unexercised.

## Open
1. **Fidelity UNMEASURED** (R-0019) — no accuracy claim anywhere; the `confidence` shown is the model's own.
2. Orientation unhandled. 3. Plain HTTP, no auth.

## Next
Measure fidelity against constructed ground truth (R-0016), or the review UI P-003 excluded.
