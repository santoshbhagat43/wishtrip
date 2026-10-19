# Live TripJack checks

These tests call the **deployed** API and answer two questions:

1. **Is it really TripJack's data?** Every search response carries a `supplier` block (which
   TripJack host was called, the HTTP status, how long it took). Staff can read back what TripJack
   returned at `GET /tripjack/evidence/{trace_id}` (kept for an hour). The tests compare every
   hotel name and price, every fare and every insurance premium we show with TripJack's own values.
2. **How fast is it?** For each step: the time the test waited, the time our server spent, the time
   TripJack took, and what we add on top. A repeat search must come from cache and say so.

## Run

Get a 30-minute staff token from the server (no password; it never touches a file):

```bash
export LIVE_TOKEN=$(ssh root@147.93.29.128 'cd /opt/wishtrip && docker compose --env-file .env.production \
  -f docker-compose.prod.yml exec -T -w /app -e PYTHONPATH=/app backend python -' < tests/live/mint_token.py 2>/dev/null)

pnpm exec playwright test -c playwright.live.config.ts
pnpm exec playwright show-report playwright-report-live
```

The summary table is printed at the end and saved to `test-results/tripjack-live-summary.md`.
