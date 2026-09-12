# SnapRecord — ORIENTATION

**Directory:** `/Users/kushagra/Desktop/SnapRecord` (created 2026-09-12, empty before this packet). Separate from Followthrough at `~/Desktop/Demo_AI`, which is never modified.

**What SnapRecord is:** photograph a physical object or its label with a phone camera, turn it into a validated, stored, structured record.

## Stack decision — PENDING
No framework, no database, no dependencies are installed. Both P-001 proofs ran on zero dependencies: Node 26 stdlib `http` + `fetch`, and macOS `sips` for image work. The stack choice (PWA vs. plain page, SQLite vs. files) is deliberately unmade and belongs to the first product packet.

## Credentials (presence only, values never read or printed)
- `OPENROUTER_API_KEY` — PRESENT
- `ANTHROPIC_API_KEY` — PRESENT
- `LLM_PROVIDER`, `LLM_MODEL`, `LLM_TIMEOUT_MS`, `LLM_MAX_COMPLETION_TOKENS` — PRESENT (non-secret selectors)
Stored in `.env` mode 600, git-ignored. `.env.example` is committed with empty values.

## What Proof A established
A phone on the same Wi-Fi CAN deliver a camera photo to a process on this laptop over plain HTTP, no tunnel, no HTTPS. An iPhone (iOS 26.5.2, Google-app WebView) uploaded a 2,767,840-byte 4032x3024 JPEG to `http://192.168.100.104:8787/upload`. Two caveats matter downstream: `capture="environment"` did NOT open the camera directly — the user reports a picker appeared — and `sips` reports EXIF orientation `<nil>`, so orientation cannot be relied on as present.

## What Proof B established
A vision model returns schema-valid JSON for a real photo. `google/gemini-3.8-flash` via OpenRouter passed the hand-written validator on 3 of 3 runs against `schema/item.v0.json`, at ~1,450 prompt tokens and 7–15s per call, USD 0.0034 average per photo (OpenRouter `usage.cost`). Total packet spend USD 0.0103 against a 0.50 cap.

## Open questions
1. OCR accuracy on a real label is UNPROVEN. The test photo was a ceiling AC unit shot from ~3m with no close-up label; the user's verdict on `label_text` was "Accurate but incomplete". A close-up label photo must be run before trusting `label_text`.
2. `capture="environment"` behaviour in Safari proper is untested — only the Google-app WebView was exercised.
3. Whether HTTPS is needed depends entirely on whether the capture page moves to `getUserMedia`; the `file`-input path needs none.
4. Image orientation handling is undecided given absent EXIF.

## Next step
P-002: a close-up label capture + extraction run to measure real OCR fidelity, before any storage or review UI is built.
