# SnapRecord — ORIENTATION

**Directory:** `~/Desktop/SnapRecord`. Separate from Followthrough at `~/Desktop/Demo_AI`.

**What it is:** photograph an object or its label; get a validated stored structured record.

## Stack — DECIDED (R-0020)
Zero dependencies: Node 26 `http`/`fetch`, built-in `node:sqlite`, macOS `sips`. No framework, no PWA, no HTTPS. One command: `node server/index.mjs`, port 8788.

## What exists
`server/index.mjs` is the product. `POST /upload` stores the original by sha256 with a sidecar (R-0017), derives a 1568px copy, calls `google/gemini-3.8-flash` with the P-002 prompt, validates against `schema/item.v1.json`, inserts into `data/snaprecord.sqlite`, redirects. `GET /` renders form and list; `/derived/:sha` thumbnails; `/api/records` rows. Invalid extractions are stored with their raw response and shown marked. `data/` is git-ignored.

## Open
1. **Fidelity UNMEASURED** (R-0019) — no accuracy claim anywhere; the `confidence` shown is the model's own.
2. Orientation unhandled. 3. Plain HTTP, no auth.

## Next
Measure fidelity against constructed ground truth (R-0016), or the review UI P-003 excluded.
