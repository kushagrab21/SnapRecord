# SnapRecord — RESULTS ledger

Append-only. Never edit or delete an existing entry; supersede it with a new one that names the ID it replaces.

**ID scheme:** `R-NNNN`, zero-padded, monotonically increasing from `R-0001`.
**Collision check:** before appending, run `grep -oE '^### R-[0-9]{4}' supervision/RESULTS.md | sort | tail -1` and take the next integer. Run for this packet: the file did not exist, so zero IDs were in use and `R-0001`–`R-0011` were free.

---

### R-0001 — Working directory exists and was empty
- **Claim:** `/Users/kushagra/Desktop/SnapRecord` did not exist before 2026-09-12 and was created empty by this packet.
- **Evidence:** `ls: /Users/kushagra/Desktop/SnapRecord: No such file or directory`, then `pwd` = `/Users/kushagra/Desktop/SnapRecord` with a listing of `.` and `..` only; `git status` = `fatal: not a git repository`.
- **Caveat:** None. Nothing was overwritten because nothing was there.

### R-0002 — Runtime baseline
- **Claim:** Node v26.8.2, npm 11.19.1, python3 3.14.6, git 2.50.1 (Apple Git-155), sqlite3 3.51.0, npx 11.19.1, macOS 26.5.1 (25F80), 782Gi free on `/`.
- **Evidence:** direct `--version` output captured in `supervision/reports/P-001.md`.
- **Caveat:** `sqlite3` is the system CLI; no Node binding for it is installed and none was tested.

### R-0003 — LAN address
- **Claim:** The laptop is reachable on the LAN at `192.168.100.104` on interface `en0`; it is the only non-loopback IPv4.
- **Evidence:** `ipconfig getifaddr en0` → `192.168.100.104`; `en1`/`en2` return nothing; `ifconfig | grep "inet "` shows one non-loopback address.
- **Caveat:** DHCP-assigned and will change between networks; nothing may hard-code it.

### R-0004 — Credentials present
- **Claim:** `OPENROUTER_API_KEY` and `ANTHROPIC_API_KEY` are both PRESENT in `~/Desktop/SnapRecord/.env` (mode 600, git-ignored), alongside non-secret `LLM_*` selectors.
- **Evidence:** presence test on each key printing only PRESENT/ABSENT; `ls -la .env` → `-rw-------`. The OpenRouter key is additionally proven live by R-0008.
- **Caveat:** The Anthropic key is present but was never exercised; it is unproven. Values, prefixes and lengths were never printed.

### R-0005 — PROOF A PASSED: phone camera photo reaches this laptop over plain HTTP
- **Claim:** An iPhone on the same Wi-Fi delivered a camera photo to a Node process on this laptop with no tunnel, no HTTPS and no dependencies.
- **Evidence:** `supervision/evidence/proof-capture.log`: `UPLOAD ok file=2026-09-12T04-48-56-748Z.jpg bytes=2767840 content-type=image/jpeg remote=192.168.100.21 user-agent="Mozilla/5.0 (iPhone; CPU iPhone OS 26_5_2 like Mac OS X) AppleWebKit/605.1.15 ... GSA/437.4.973319807 Mobile/15E148 Safari/604.1"`. `sips` → 4032x3024 jpeg.
- **Caveat:** Proven once, on one network, from one WebView. No retry, concurrency, or large-file behaviour was tested; the server accepts unauthenticated uploads from anyone on the LAN.

### R-0006 — `capture="environment"` did NOT open the camera directly
- **Claim:** On this device the attribute produced an intermediate picker rather than a direct viewfinder.
- **Evidence:** The user, asked what happened when they tapped the input, answered: "A picker appeared".
- **Caveat:** Tested only in the Google-app WebView (`GSA/437.4` in the user-agent), not Safari proper. Safari may differ and is untested.

### R-0007 — EXIF orientation is absent on the delivered image
- **Claim:** The uploaded JPEG carries no usable EXIF orientation value.
- **Evidence:** `sips -g orientation` → `orientation: <nil>`.
- **Caveat:** `exiftool` is not installed, so only `sips` was consulted; a richer tool might read a tag `sips` ignores. Whether the phone or the WebView stripped it is unknown.

### R-0008 — PROOF B PASSED: a vision model returns schema-valid JSON
- **Claim:** `google/gemini-3.8-flash` via OpenRouter returned JSON passing the hand-written validator against `schema/item.v0.json` on 3 of 3 runs on the same real photo.
- **Evidence:** `supervision/evidence/proof-extract-run{1,2,3}-raw.json` and `-content.txt`; validator reported PASS with zero errors each run. Tokens 1450/563, 1451/616, 1450/705; elapsed 7111ms, 14910ms, 6827ms.
- **Caveat:** One model, one image, three runs. No fence-stripping was needed but the parser tolerates fences, so raw-format strictness is not separately proven.

### R-0009 — Extraction cost per photo
- **Claim:** A single extraction at 1568px costs about USD 0.0034; the three runs totalled USD 0.010328.
- **Evidence:** OpenRouter `usage.cost` returned in each response body (0.00319875, 0.00339825, 0.00373125), requested via `usage: {include: true}`. Source is the provider's own accounting, not a computed estimate.
- **Caveat:** Cost scales with completion length, which varies with how much label text the image contains; a dense nutrition label will cost more than this sparse image.

### R-0010 — `label_text` fidelity is only partly established
- **Claim:** For this photo the model's `label_text` of `TOSHIBA` was judged accurate but not complete.
- **Evidence:** The user, asked whether `TOSHIBA` matches what is printed on the object, answered: "Accurate but incomplete" — the user's statement, not the assistant's.
- **Caveat:** This is a weak test of OCR. Field accuracy on a real dense label remains UNPROVEN.

### R-0011 — The Proof B image was not a close-up label
- **Claim:** The photograph is a ceiling-mounted air-conditioning cassette shot from several metres below; no label is legible at that distance.
- **Evidence:** Direct inspection of `supervision/evidence/proof-extract-input.jpg`; the model itself returned only a brand mark and set `confidence` 0.80–0.85.
- **Caveat:** All `label_text` conclusions from this packet inherit this limitation and must be re-run against a close-up label.
