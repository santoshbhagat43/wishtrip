# Deploying WishTrip

Server: `root@147.93.29.128` (Ubuntu, Docker, ufw allowing only SSH/80/443). Code lives in
`/opt/wishtrip`, a clone of `git@github.com:santoshbhagat43/wishtrip.git` using the server's
deploy key (`/root/.ssh/github_wishtrip`, read-only on GitHub).

| Site | Domain | Service |
|---|---|---|
| Traveler website | https://wishtrip.listnr.co | `website` (Next.js, `next start`) |
| Staff dashboard | https://wishtrip-dashboard.listnr.co | `dashboard` (Next.js, `next start`) |
| API + docs | https://wishtrip-api.listnr.co (`/docs`) | `backend` (FastAPI) |

The traveler website is behind a browser login (basic auth) while it's private: the user is
`SITE_USER` and the password `SITE_PASSWORD` in `.env.production`. To change it, set a new
`SITE_PASSWORD`, empty `SITE_PASSWORD_HASH=`, and run `./deploy/deploy.sh`. To make the site
public, remove the `basic_auth` block from `deploy/Caddyfile`.

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
