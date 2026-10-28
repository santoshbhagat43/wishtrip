#!/usr/bin/env bash
# FOR LOCAL TESTING ONLY: send this machine's TripJack calls through the server, whose address is
# the one TripJack has whitelisted.
#
#   ./deploy/tripjack-tunnel.sh start    opens an SSH SOCKS tunnel to the server (port 1080)
#   ./deploy/tripjack-tunnel.sh status
#   ./deploy/tripjack-tunnel.sh stop     closes it
#
# Then, in the repo's .env, set  TRIPJACK_PROXY=socks5://host.docker.internal:1080  and restart
# the backend and workers:  docker compose up -d backend worker media-worker
# To switch it off: stop the tunnel, empty TRIPJACK_PROXY, restart again. The server itself never
# uses this (TRIPJACK_PROXY is ignored when ENVIRONMENT=production).
#
# The tunnel listens on this machine's loopback only (127.0.0.1), so nobody else on the network
# can use it. Docker Desktop lets containers reach it through host.docker.internal.
set -euo pipefail
HOST="${TRIPJACK_TUNNEL_HOST:-root@147.93.29.128}"
PORT="${TRIPJACK_TUNNEL_PORT:-1080}"
SOCK="${TMPDIR:-/tmp}/wishtrip-tripjack-tunnel.sock"

up() { ssh -S "$SOCK" -O check "$HOST" >/dev/null 2>&1; }

case "${1:-}" in
  start)
    if up; then echo "Tunnel already open on port $PORT."; exit 0; fi
    ssh -M -S "$SOCK" -fN -D "127.0.0.1:$PORT" -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 "$HOST"
    echo "Tunnel open on 127.0.0.1:$PORT. Set TRIPJACK_PROXY=socks5://host.docker.internal:$PORT in .env"
    echo "and restart the backend. Close it with: $0 stop"
    ;;
  stop)
    if up; then ssh -S "$SOCK" -O exit "$HOST" >/dev/null 2>&1 && echo "Tunnel closed."; else echo "No tunnel is open."; fi
    echo "Remember to empty TRIPJACK_PROXY in .env and restart the backend."
    ;;
  status)
    if up; then echo "Tunnel is open on port $PORT."; else echo "No tunnel is open."; fi
    ;;
  *) echo "Usage: $0 start|stop|status" >&2; exit 2 ;;
esac
