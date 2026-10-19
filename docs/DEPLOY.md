# Deploying WishTrip

Server: `root@147.93.29.128` (Ubuntu, Docker, ufw allowing only SSH/80/443). Code lives in
`/opt/wishtrip`, a clone of `git@github.com:santoshbhagat43/wishtrip.git` using the server's
deploy key (`/root/.ssh/github_wishtrip`, read-only on GitHub).

| Site | Domain | Service |
|---|---|---|
| Traveler website | https://wishtrip.listnr.co | `website` (Next.js, `next start`) |
| Staff dashboard | https://wishtrip-dashboard.listnr.co | `dashboard` (Next.js, `next start`) |
| API + docs | https://wishtrip-api.listnr.co (`/docs`) | `backend` (FastAPI) |

The traveler website is private while in preview: `/gate` asks for `SITE_USER` /
`SITE_PASSWORD` from `.env.production` and remembers the browser for 30 days. To change the
password, edit `SITE_PASSWORD` and run `./deploy/deploy.sh` (everyone signs in again). It's an
app page rather than HTTP basic auth on purpose: browsers forget basic-auth credentials whenever
the app answers 401, which made them ask on every refresh.

Caddy (`deploy/Caddyfile`) terminates HTTPS with automatic Let's Encrypt certificates; nothing
else is published. Postgres, Redis and the Celery worker are internal only. On the server the
LLM and embeddings both go through OpenRouter (no Ollama).

## First deploy

```bash
ssh root@147.93.29.128
git clone git@github.com:santoshbhagat43/wishtrip.git /opt/wishtrip && cd /opt/wishtrip
./deploy/deploy.sh            # creates .env.production with generated secrets, then stops
nano .env.production          # add OPENROUTER_API_KEY and ADMIN_EMAIL (DEMO_TRAVELER_EMAIL optional)
./deploy/deploy.sh            # builds and starts everything
```

Then load the data (once):

```bash
C="docker compose --env-file .env.production -f docker-compose.prod.yml"
$C exec backend python -m app.scripts.seed               # admin + demo traveler accounts
$C exec backend python -m app.scripts.import_client_kb   # the client's knowledge base
$C exec backend python -m app.scripts.seed_support_menus # support tickets + site menus
```

Published places are embedded by the worker; check progress on the dashboard overview
("Index now" re-runs it).

## Updating

```bash
ssh root@147.93.29.128 'cd /opt/wishtrip && ./deploy/deploy.sh'
```

It pulls `main`, then rebuilds and restarts only the services whose code changed. If neither
the code nor `.env.production` changed since the last deploy, it says so and restarts nothing;
`./deploy/deploy.sh --force` rebuilds and restarts anyway.

## Useful commands (in /opt/wishtrip)

```bash
C="docker compose --env-file .env.production -f docker-compose.prod.yml"
$C ps                     # what's running
$C logs -f backend        # follow a service's logs (backend, worker, website, dashboard, caddy)
$C restart website        # restart one service
$C exec postgres pg_dump -U wishtrip wishtrip | gzip > backup-$(date +%F).sql.gz   # backup
```

`.env.production` holds every secret (chmod 600, never committed). Sign-in details for the
seeded admin are in it.

## YouTube videos

A reel link can be read from a YouTube video as well as an Instagram reel (`yt-dlp`, in the
media worker). Two things to know:

- The backend image carries Deno. `yt-dlp` needs a JavaScript runtime to solve YouTube's download
  challenge; without one YouTube answers 403 or throttles the download. Rebuild the image (the
  deploy script does) after pulling this change.
- If YouTube still refuses the server ("confirm you're not a bot"), the creator sees "YouTube is
  not letting us read videos right now". The fix is a cookies file from a signed-in YouTube
  session: export it in Netscape format, put it in the private `instaloader` volume (never under
  `MEDIA_ROOT`), and set `YOUTUBE_COOKIES_FILE=/data/instaloader/youtube-cookies.txt`.

Videos longer than `REEL_MAX_SECONDS` (3 minutes) are refused with a message; raise it if you
want longer ones read (the cost is more AI tokens per video).

### If YouTube refuses the server

On a rented server `yt-dlp` often gets "Sign in to confirm you're not a bot" for every video: YouTube
distrusts data-centre addresses, whichever library is used. Three ways round it, in the order
we'd try them:

1. **Creators upload the video file** from the reel's popup. Nothing to configure; it never touches
   YouTube, so it always works.
2. **A proxy** with a residential address: set `YOUTUBE_PROXY=http://user:pass@host:port`. No
   YouTube account needed; the proxy service costs money.
3. **Cookies** from a throwaway signed-in YouTube account (`YOUTUBE_COOKIES_FILE`, above). Free, but
   it risks that account and the cookies expire.

### SaveAPI: the fallback download

Set `SAVEAPI_KEY` (from saveapi.org; it starts `sk_live_`) in `.env.production` and deploy. Then:

- A reel or video is downloaded with our own tool first (instaloader for Instagram, yt-dlp for
  YouTube). Only if that is **blocked, fails or times out** is SaveAPI asked; a private, deleted,
  not-a-video or too-long result is not, since it would fail there too.
- Cost is about 1.5 credits per Instagram reel, 12 per YouTube video (2 to check its length, 10
  to get it). A failed lookup costs 0.1.
- **Every download attempt is recorded** in the `download_requests` table: which tool, whether it
  worked, how long it took, the error code, bytes, and for SaveAPI the credits spent and the
  balance left. Admins can read it at `GET /reels/downloads` (latest attempts, plus totals per
  tool and the last known balance). Failures are kept too.
- If SaveAPI itself refuses us (bad key, no credits left), the creator sees the original failure
  and the backend log says `SaveAPI refused us (QUOTA_EXCEEDED…)`. Watch for that line.

### Itineraries are always made whole

A video only names what it names (a 12-second short may name three places), so after reading it
the itinerary is topped up to **at least two days of three stops** (the video's own number of
days when it says one, up to seven), from:

1. WishTrip's checked knowledge base for the destination ("Checked by WishTrip"), then
2. the AI's own suggestions of well-known places there, labelled **"Suggested · not from the
   reel"** wherever they appear. They are not checked and carry no prices or other facts.

The stops are then grouped into days by where they are. If a video names too few places even for
that, no itinerary is made and the creator is told so, rather than shown a thin one. Re-reading a
video costs no download credits (the read video is cached by its link): "Build itinerary" or "Try
again" completes an itinerary that was made before this existed. `COMPLETE_ITINERARIES=false`
turns the top-up off.
