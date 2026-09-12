# SnapRecord

Photograph a physical object or its label with a phone; SnapRecord stores the original, extracts a structured record with a vision model, validates it against `schema/item.v1.json`, and lists every record it has.

Run it with `node server/index.mjs` — one process, no dependencies, no build step.

Open the LAN URL it prints on a phone on the same Wi-Fi (plain HTTP); the same URL on the laptop shows every record so far.

Originals are kept byte-for-byte at `data/captures/<sha256>.<ext>` with a `<sha256>.json` sidecar and are never rewritten; the 1568px copies sent to the model live in `data/derived/`, and the rows in `data/snaprecord.sqlite`.

Extraction accuracy has not been measured.
