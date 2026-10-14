# Reel → trip, with creator affiliates

> **Status (14 Oct 2026): built and tested locally; not deployed yet.** Backend: `app/modules/reels`,
> `app/modules/creators`, migration `c97739abff99`. Website: `/reel`, `/c/<code>`. Dashboard:
> Creators. Still needed before it works on the server: a dedicated Instagram account's session
> (see §8). Differences from the first draft are noted inline.

A traveller pastes an Instagram reel link. In the background we download the reel, read the
text on screen (OCR), transcribe the voice-over (Gemini via OpenRouter), combine both with the
caption, find the places, and build an itinerary through the existing chat planner. The reel's
owner is saved as a **creator**, and every traveller that creator brings in is attributed to
them for commission.

## 1. The flow

```
website /reel                    backend API                     worker (Celery, "media" queue)
──────────────                   ───────────                     ──────────────────────────────
paste URL ──POST /reel-imports──▶ validate URL, find shortcode
                                  cached? ──yes──▶ return done
                                  create ReelImport(queued)
                                  enqueue reels.process ───────▶ 1. download     instaloader (subprocess)
poll GET /reel-imports/{id} ◀──── status + step                  2. frames       ffmpeg scene-change frames
  "Watched the reel"                                             3. OCR          tesseract (eng+hin), dedupe
  "Read the captions"                                            4. audio        ffmpeg → mono 16 kHz mp3
  "Heard the voice-over"                                         5. transcribe   Gemini (OpenRouter, input_audio)
  "Found 6 places"                                               6. extract      LLM: caption+OCR+transcript → places
                                                                 7. match        places → KB locations (search)
                                                                 8. creator      upsert Creator + CreatorContent
                                                                 9. plan         chat session seeded with the reel
                                                                 10. clean up    delete video/mp3/frames, keep thumbnail
show places (verified / not in KB)
"Build my trip" → /plan?session=…
```

Each step writes `step` + `progress` on the ReelImport row, so the website shows real progress
(this replaces the static pills on the B4 Reel screen).

## 2. Pipeline details

| Step | Tool | Notes |
|---|---|---|
| Download | `instaloader` Python lib, run as a subprocess (`python -m app.reels.download <shortcode> <dir>`) with a 90 s timeout | Gives the mp4, caption, hashtags, location tag, owner username/full name, post date, thumbnail. Uses a logged-in **session file** (see risks). Only reels/posts; reject stories, profiles, private accounts. |
| Frames | `ffmpeg -vf "select='gt(scene,0.3)',scale=720:-1" -vsync vfr` plus one frame every 2 s as a floor | "Every screen" = every scene change; a 60 s reel gives ~20–40 frames instead of 1,800. Cap at 60 frames. |
| OCR | `tesseract` (eng + hin) via `pytesseract`, grayscale + threshold first | Drop lines < 3 chars, drop duplicates across consecutive frames (overlays persist), keep the timestamp of each line. |
| Audio | `ffmpeg -vn -ac 1 -ar 16000 -b:a 48k audio.mp3` | Skip if the reel has no audio stream or it is only music (Gemini returns empty/“music only”). |
| Transcribe | OpenRouter `google/gemini-2.5-flash`, message with `{"type":"input_audio","input_audio":{"data":<base64>,"format":"mp3"}}` | Prompt: verbatim transcript in the original language + English translation, with rough timestamps. Max reel length 3 min (~1.5 MB audio). |
| Extract | Existing `AIOrchestrator.complete(json_mode=True)` | Input: caption, hashtags, location tag, OCR lines, transcript. Output: `{destination, places:[{name, kind: stay/food/sight/experience, evidence, timestamp}], tips, days_hint}`. Every place must quote its evidence (OCR line or transcript sentence); places without evidence are dropped. **No prices** are taken from the reel. |
| Match | Existing KB search (`search` module / embeddings) | Each place → best KB Location above a threshold → `verified`; otherwise kept as `from the reel, not yet verified` (same honesty rule as the chat). |
| Plan | Existing chat pipeline | Create a chat session for the traveller with a seeded first message (“Plan a trip to Goa from @goadiaries' reel: …”) and attach the reel context to the session, so the planner uses KB data + the reel's tips. No second planner. |

All of steps 1–7 run in one Celery task on a dedicated `media` queue with concurrency 1
(protects the Instagram session and the CPU). Steps are idempotent; a retry resumes from the
last completed step using what is already in the row.

## 3. Data model (new `reels` and `creators` modules, one migration)

**creators**
- `id`, `platform` (instagram), `handle` (unique with platform), `display_name`, `profile_url`, `avatar_path`
- `status`: `unclaimed` (auto-created from a reel) → `invited` → `active` (signed the affiliate terms) → `paused`
- `user_id` (nullable — set when the creator claims the profile and logs in)
- `referral_code` (unique, e.g. `goadiaries`), `commission_rate_bps` (default from settings)
- `payout_details` — **not stored now**; handled offline until payouts are built

**creator_content** (one row per reel, the cache)
- `id`, `creator_id`, `platform`, `shortcode` (unique), `url`, `caption`, `posted_at`, `thumbnail_path`
- `ocr_text`, `transcript`, `extracted` (JSONB: destination + places + evidence), `matched_location_ids`

**reel_imports** (one row per paste — the job)
- `id`, `url`, `user_id` (nullable for anonymous), `visitor_id`, `content_id`, `chat_session_id`
- `status` (`queued/running/done/failed`), `step`, `error`, timings

**creator_attributions** (who sent whom)
- `id`, `creator_id`, `content_id` (nullable), `user_id` (nullable until signup), `visitor_id`
- `source`: `reel_paste` | `referral_link`
- `event`: `visit` | `signup` | `trip_planned` | `booking` (booking later, when bookings exist)
- `created_at`
- `users.referred_by_creator_id` (nullable, set once at signup — first-touch wins)

**commission_ledger** (stub today, used once bookings exist)
- `creator_id`, `user_id`, `event`, `amount_paise`, `status` (`pending/approved/paid`)

## 4. Affiliate rules (proposed defaults — confirm)

- A traveller is credited to a creator when they (a) sign up after opening the creator's link
  `wishtrip.listnr.co/c/<code>`, or (b) paste one of that creator's reels within 30 days of
  joining (older accounts pasting a reel are logged as "inspired", not credited).
- Attribution window: 30 days, first touch wins, stored in a `wt_ref` cookie + `visitor_id`, moved
  to `users.referred_by_creator_id` at signup.
- Commission is earned per **credited traveller who plans their first trip** (decided 14 Oct);
  switch to per booking once real bookings exist. The amount is per creator, set by staff in the
  dashboard (default ₹0), and is fixed on the commission entry when it is earned.
- Pasting a reel needs a signed-in traveller (the result opens as their chat session).
- An auto-created creator is `unclaimed`: we track attributions but owe nothing until they accept
  the affiliate terms. We never message or publicly label them as a partner before that.

## 5. API

- `POST /reel-imports {url}` → `{id, status}` (rate-limited: 5/hour per visitor, 20/day per user)
- `GET /reel-imports/{id}` → status, step, places (verified/unverified), creator, `chat_session_id`
- `GET /c/{code}` (website route) → sets `wt_ref`, logs `visit`, redirects to `/`
- Dashboard (staff): `GET/PATCH /creators`, `GET /creators/{id}` (content, attributions, ledger)

## 6. UI

- **Website**: Home "Paste a reel" box and `/reel` call the API; Reel screen shows live steps,
  found places with “Verified” / “From the reel” tags and the evidence on tap; “Build my trip”
  opens the chat with the seeded session. Prices on these screens stay blank until we have
  real pricing.
- **Dashboard**: new **Creators** page — list (handle, status, reels, referred users, trips
  planned), detail (reels with transcript/OCR/places, attributions), actions: invite, activate,
  set commission, pause.

## 7. Infra

- Backend image: `apt-get install ffmpeg tesseract-ocr tesseract-ocr-hin` (~150 MB more).
- Python deps: `instaloader`, `pytesseract`, `pillow`.
- Worker: second Celery worker command `-Q media --concurrency=1` in both compose files.
- Settings: `INSTAGRAM_USERNAME`, `INSTAGRAM_SESSION_FILE` (on the server only, in the media
  volume), `REEL_TRANSCRIBE_MODEL=google/gemini-2.5-flash`, `REEL_MAX_SECONDS=180`,
  `CREATOR_DEFAULT_COMMISSION_BPS`.
- Storage: raw video/audio/frames in `/data/media/reels/<id>/`, deleted after processing; only
  the thumbnail and the text are kept.

## 8. Risks

1. **Instagram blocks anonymous downloads fast.** instaloader needs a logged-in session from a
   dedicated Instagram account (not a personal one). You create that account and run
   `instaloader --login <user>` once on the server; we only read the session file. Expect it to
   get challenged/blocked occasionally — the import then fails with a clear message and the
   traveller can type the places instead.
2. **Terms and copyright.** Automated downloading is against Instagram's terms. Keep it
   low-volume, keep no video, show only our own extracted text + a link back to the creator's
   reel, and get legal sign-off before public launch. The long-term path is creators submitting
   their own reels (or the official Instagram API for claimed creators).
3. **OCR on stylised overlays** is noisy; the LLM extraction requires evidence, and unmatched
   places are shown as unverified, never as facts.
4. **Cost**: Gemini Flash audio ≈ a fraction of a rupee per reel; cached per shortcode so the same
   reel is processed once.

## 9. Today, in order

1. Migration + models: creators, creator_content, reel_imports, creator_attributions, `users.referred_by_creator_id`.
2. Worker pipeline steps 1–10 with unit tests (fixture mp4 checked into tests; instaloader and
   OpenRouter mocked).
3. Gemini audio transcription client + extraction prompt.
4. `POST/GET /reel-imports`; regenerate the website/dashboard API types.
5. Website: wire the Reel screen to the API (live steps, places, Build my trip → chat).
6. Attribution: `/c/<code>`, cookie, signup hook, reel-paste attribution.
7. Dashboard Creators list + detail.
8. Docker image + media worker, deploy, create the Instagram session on the server, test with a real reel.

Later: commission ledger on bookings, creator self-serve claim + payouts, YouTube Shorts via yt-dlp.
