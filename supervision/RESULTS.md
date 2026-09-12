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

### R-0012 — RULING: P-001 is ACCEPTED
- **Claim:** The supervisor ruled P-001 ACCEPTED on 2026-09-12 at commit `737c33f`, covering results R-0001..R-0011.
- **Evidence:** Packet P-002, "Supervisor rulings to record before work", item 1: "P-001 is ACCEPTED (commit `737c33f`, R-0001..R-0011)."
- **Caveat:** Three caveats are carried forward explicitly and remain open: (a) the `ANTHROPIC_API_KEY` is present but has never been exercised and is unproven; (b) OCR fidelity is unmeasured — no close-up label has been extracted; (c) the `capture="environment"` picker observation (R-0006) is browser-specific and does not generalise until reproduced in Safari proper.

### R-0013 — RULING: fidelity is measured in code against pre-declared ground truth
- **Claim:** Extraction fidelity is to be measured deterministically in code against ground truth the USER types before any extraction runs. The model is never asked to grade itself, and the user is never asked to grade the model's output after having seen it.
- **Evidence:** Packet P-002, "Supervisor rulings to record before work", item 2.
- **Caveat:** This constrains method, not outcome. A post-hoc user judgement is still admissible for one purpose only — naming fabricated values the model produced (the hallucination check, packet step 8) — because that question cannot be answered from ground truth typed in advance.

### R-0014 — RULING: P-003's model, resolution and schema are chosen from P-002's numbers
- **Claim:** The extraction model, the image resolution, and the schema version that P-003 builds on are to be selected from this packet's measurements, not from preference or convenience.
- **Evidence:** Packet P-002, "Supervisor rulings to record before work", item 3.
- **Caveat:** If the matrix does not separate the candidates on fidelity, the recommendation must say so and fall back to a stated tiebreak (cost) rather than assert a distinction the numbers do not support.

### R-0015 — In Safari proper, `capture="environment"` DID open the camera directly (supersedes the generalisation of R-0006)
- **Claim:** The picker seen in P-001 was the Google app's in-app browser behaving differently, not iOS behaviour. In Safari proper the same `<input type="file" accept="image/*" capture="environment">` opened the camera directly.
- **Evidence:** Three uploads at 2026-09-12T05:05:50Z, 05:06:13Z and 05:06:23Z carried user-agent `Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5.2 Mobile/15E148 Safari/604.1` — a `Version/` token and no `GSA` token, i.e. Safari, not the Google app. Asked what happened when they tapped the input, the user answered: "yes it did open the camera directly".
- **Caveat:** R-0006 is not wrong and is not retracted — the picker really did appear in the Google-app WebView (`GSA/437.4`). What changes is its scope: the behaviour is browser-specific, so the capture page must not assume a direct viewfinder when opened from an in-app browser. Note also that the Safari user-agent reports `iPhone OS 18_7` while the Google-app user-agent on the same handset reported `iPhone OS 26_5_2`; at least one of the two is a frozen/spoofed UA string, so the UA is not a reliable source of OS version.

### R-0016 — RULING: ground truth may be known by construction (amends R-0013, does not waive it)
- **Claim:** Ground truth must still exist before extraction and must still never be a model's or the Runner's reading of a photograph. It MAY, however, be established by construction: text the Runner generates, records with a timestamp, renders, and the user photographs. The three captures taken before this ruling (AC medium, AC close, poster wall) have NO ground truth and are scored for consistency only; no accuracy claim may be made about them anywhere in this packet or any later one.
- **Evidence:** Packet P-002A, "Supervisor rulings to record before work", item 4, issued on the Runner's report that ground truth was blocking and the user's statement that they could not type it.
- **Caveat:** Constructed ground truth measures transcription of screen-rendered text, not of physical packaging. Print on a real package differs in ways that matter — curved surfaces, reflective foil, small condensed type, colour-on-colour — and a screen adds moiré and backlight that print does not. A fidelity number from this packet therefore bounds nothing about real packaging and must not be quoted as if it did.

### R-0017 — RULING: captures are content-addressed and originals are immutable
- **Claim:** Every capture is stored at its exact original bytes under `data/captures/<sha256>.<ext>` with a sidecar `<sha256>.json` recording original filename, bytes, width, height, content-type, user-agent and received-at. The original file is never rewritten. The downscaled copy is a derivative at `data/derived/<sha256>.1568.jpg`, used for inference only. Every extraction result records BOTH the original and the derived sha256. `data/` is git-ignored; sidecars are copied into `supervision/evidence/` because they contain no pixels.
- **Evidence:** Packet P-002A, item 5.
- **Caveat:** Content addressing makes a byte-identical re-upload collapse onto the same record, so two genuinely separate photographs of the same scene are distinguishable only if their bytes differ — which JPEG capture makes near-certain, but which is not guaranteed. Immutability is enforced by convention and verified by re-hashing at the end of the packet; nothing in the filesystem prevents a later process from overwriting a capture.

### R-0018 — RULING: the three existing photos and the second model are confirmed; do not re-ask
- **Claim:** The supervisor records that the user has, in this session, confirmed the three existing photographs as the unlabelled set and confirmed the choice of `anthropic/claude-sonnet-4.6` as the second model. The Runner is not to re-ask.
- **Evidence:** Packet P-002A, item 6. In-session basis: the Runner reported the three photos' limitations in detail and named the second model with its prices; the user replied "ok continue now" and, separately, "yes it did open the camera directly", and raised no objection to either.
- **Caveat:** This is a supervisor ruling recorded as such, not a verbatim user confirmation. The user never uttered the words "I confirm the three photos" or named the model; their assent is inferred from twice instructing the Runner to continue after being shown what the photos contain. Anyone relying on this entry should read it as the supervisor closing the question, not as direct user testimony.

### R-0019 — RULING: P-002A is CANCELLED; fidelity remains UNMEASURED and is an open ledger item
- **Claim:** P-002A was cancelled before its first model call. Extraction fidelity has never been measured against ground truth of any kind. No accuracy claim may appear in the product UI, the README, or any report. Ruling 5 of P-002A (R-0017 — originals preserved by sha256, derivatives for inference only) stands and now applies to the product, not only to the evidence directory.
- **Evidence:** Packet P-003, "Supervisor rulings to record before work", item 7.
- **Caveat:** Cancellation leaves the model choice (`google/gemini-3.8-flash`) resting on P-001 Proof B alone, which established only that the model returns schema-valid JSON for one photo of a ceiling AC unit — it establishes nothing about whether the values are correct. The product therefore ships a number (`confidence`) that the model reports about itself and that nothing has checked. Carried forward as the open item it is.

### R-0020 — RULING: zero new dependencies; `node:sqlite` is the database
- **Claim:** P-003 adds no npm packages. Node 26's built-in `node:sqlite` is the database; there is no framework, and the product is one process started by one command.
- **Evidence:** Packet P-003, "Supervisor rulings to record before work", item 8. Node version in use: v26.8.2.
- **Caveat:** `node:sqlite` is a built-in but not a frozen API; code written against it may need revision on a future Node. The zero-dependency rule also means image work stays on macOS `sips` (R-0017's derivation path), so the server as written does not run on Linux without replacing that call.

### R-0021 — In the Google-app WebView a native multipart form submit produced NO request at all; the `fetch` raw-body upload worked
- **Claim:** A plain `<form method="post" enctype="multipart/form-data">` submitted from the Google app's in-app browser on the iPhone generated no HTTP request whatsoever — the server logged the `GET /` that served the page and then nothing. Replacing the submit handler with the `fetch`-with-raw-body upload copied from `scripts/proof-capture.mjs` made the same phone, the same page and the same photo upload immediately. `POST /upload` therefore accepts both shapes: multipart when the content-type says so, raw bytes plus an `x-filename` header otherwise.
- **Evidence:** `supervision/evidence/P-003-server.log`. At 05:26:17Z, `REQ GET / remote=192.168.100.21 ua="...GSA/437.4.973319807..."` with no POST following, while the user reported tapping the button and seeing no response. After the patch, 05:29:19Z `GET /` and 05:29:28Z `REQ POST /upload ... len=1864421 ct=image/jpeg` from the same address and user-agent, producing row id=2.
- **Caveat:** The cause was not diagnosed, only routed around. No client-side error was captured from the phone, so whether the WebView blocked the submit, swallowed an error, or never fired the event is unknown; a 20-minute packet bought the working path rather than the explanation. Note also that this handset reached the page through the Google app (`GSA/437.4`) and not Safari, so R-0015's finding that Safari proper opens the camera directly was not exercised here.

### R-0022 — RULING: the stored original is the canonical image for any model call
- **Claim:** The stored original is the canonical image. Anything that hands pixels to a model — an HTTP endpoint, a script, or an example in the README — reads `data/captures/<sha256>.<ext>` byte-for-byte. The derived 1568px copy is offered only as an explicit, labelled alternative, never as the default.
- **Evidence:** Packet P-004, "Supervisor rulings to record before work", item 9.
- **Caveat:** This reverses the default the product itself uses: `server/index.mjs` extraction (R-0017, P-003) sends the *derived* copy, and every row now in the database was extracted from a derivative. So the canonical path is canonical for new consumers, not retroactively for the stored rows; a full-resolution original also costs more tokens and may exceed provider size limits where the 1568px copy would not.

### R-0023 — RULING: only the load-bearing check is verified in P-004
- **Claim:** Verification for P-004 is a single script call that sends a stored original to the model and returns an answer. Nothing else in the packet is checked.
- **Evidence:** Packet P-004, "Supervisor rulings to record before work", item 10.
- **Caveat:** The three new HTTP endpoints, the README's curl and Node examples, and the `--variant derived` path therefore ship UNVERIFIED. They are written, not exercised; anything asserted about them here is a claim about the code, not a measurement.

### R-0024 — RULING: the spoken note is evidence, stored verbatim
- **Claim:** Whatever the user said — as dictated text or as transcribed audio — is stored exactly as received in `user_note.text` and is never altered by the extraction model. The model may USE it; the record must show what it was given.
- **Evidence:** Packet P-005, "Supervisor rulings to record before work", item 11.
- **Caveat:** "Verbatim" bounds what the *server* and the *model* do, not what the input device does. iOS keyboard dictation already interprets speech into text before the page sees a character, so `user_note.text` is verbatim with respect to the textarea's contents, not with respect to the sound the user made; dictation mishears are recorded as if the user had typed them and are indistinguishable from typing in the stored row. The same holds one level further out for `source: 'transcription'`, where the transcript is a model's reading of the audio and only the audio bytes are primary.

### R-0025 — RULING: audio bytes follow ruling 5 (R-0017)
- **Claim:** Any recorded audio is stored untouched at `data/audio/<sha256>.<ext>` with a sidecar, hash-linked from the record. The transcript is a derivative.
- **Evidence:** Packet P-005, "Supervisor rulings to record before work", item 12.
- **Caveat:** Inherits R-0017's caveat: content addressing collapses byte-identical re-uploads onto one file, and immutability is convention plus a `wx` open, not a filesystem guarantee. New here is that the container the browser hands over is not chosen by this product — `MediaRecorder` emits whatever mime it likes (`audio/mp4` on iOS, `audio/webm` elsewhere) — so the stored extension varies by device and nothing normalises it.

### R-0026 — RULING: Tier 2 is proven or reported failed, never assumed
- **Claim:** A record whose `user_note.source` is `transcription` must carry an `audio_sha256` whose file exists. Tier 2 (recorded audio over HTTPS) is either demonstrated end-to-end or marked FAILED with the symptom recorded; it is never described as working on the strength of the code having been written.
- **Evidence:** Packet P-005, "Supervisor rulings to record before work", item 13.
- **Caveat:** This is the general form of R-0023's restriction and it cuts both ways: code that ships unexercised under this ruling must be *called* unexercised in the report, including the `MediaRecorder` path, the HTTPS listener and the transcription call if the packet's one verification does not touch them.
