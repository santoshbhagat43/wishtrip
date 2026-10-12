#!/usr/bin/env bash
# Deploy or update WishTrip on the server:  ./deploy/deploy.sh
# First run: creates .env.production from the example with fresh secrets, then stops so you
# can add OPENROUTER_API_KEY. Every run after: pulls main, rebuilds, restarts.
set -euo pipefail
cd "$(dirname "$0")/.."
COMPOSE=(docker compose --env-file .env.production -f docker-compose.prod.yml)

secret() { openssl rand -base64 36 | tr -dc 'A-Za-z0-9' | head -c "${1:-32}"; }
fill() { # fill KEY with VALUE if it's empty in .env.production
  grep -q "^$1=$" .env.production && sed -i "s|^$1=$|$1=$2|" .env.production || true
}

if [ ! -f .env.production ]; then
  cp .env.production.example .env.production
  chmod 600 .env.production
  fill POSTGRES_PASSWORD "$(secret 32)"
  fill JWT_SECRET "$(secret 48)"
  fill ADMIN_PASSWORD "$(secret 20)"
  fill DEMO_TRAVELER_PASSWORD "$(secret 20)"
  echo "Created .env.production with generated secrets."
  echo "Add OPENROUTER_API_KEY and ADMIN_EMAIL (DEMO_TRAVELER_EMAIL optional), then run this again."
  exit 0
fi
if grep -qE "^(OPENROUTER_API_KEY|ADMIN_EMAIL)=$" .env.production; then
  echo "Fill in OPENROUTER_API_KEY and ADMIN_EMAIL in .env.production first." >&2
  exit 1
fi

# Update to GitHub's main. Fetch and fast-forward explicitly (a bare `git pull` can trip over
# FETCH_HEAD), then re-run this script so the new version of it is the one that deploys.
if [ -z "${WISHTRIP_UPDATED:-}" ]; then
  git fetch --quiet origin main
  git merge --ff-only --quiet origin/main
  WISHTRIP_UPDATED=1 exec "$0" "$@"
fi

# Website preview login (/gate): generate a password once.
grep -q "^SITE_USER=" .env.production || printf '\nSITE_USER=wishtrip\nSITE_PASSWORD=\n' >> .env.production
if grep -q "^SITE_PASSWORD=$" .env.production; then
  sed -i "s|^SITE_PASSWORD=$|SITE_PASSWORD=$(secret 16)|" .env.production
  echo "Website login: user $(grep '^SITE_USER=' .env.production | cut -d= -f2-), password in .env.production (SITE_PASSWORD)."
fi
"${COMPOSE[@]}" up -d --build --remove-orphans
"${COMPOSE[@]}" ps
echo "Deployed $(git rev-parse --short HEAD)."
