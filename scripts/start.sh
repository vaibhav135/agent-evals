#!/usr/bin/env bash
# One command to run the platform locally: `bun run start`.
#
#   1. checks prerequisites (bun, Docker, an Anthropic key in .env)
#   2. sets up Hermes on first run (runner/setup-hermes.sh, pinned commit)
#   3. starts Postgres (docker compose) and waits until it is healthy
#   4. builds and starts the API (which runs the experiment worker) and the web UI
#
# Ctrl-C stops the API and the UI; Postgres keeps running (`docker compose down` stops it).
set -euo pipefail
cd "$(dirname "$0")/.."

say() { printf '\033[1m▸ %s\033[0m\n' "$*"; }
die() { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

command -v bun >/dev/null || die "bun is required: https://bun.sh"
command -v docker >/dev/null || die "Docker is required (Docker Desktop, or colima on macOS)"
docker info >/dev/null 2>&1 || die "Docker is not running. Start Docker Desktop (or: colima start) and retry."

# Compose v2 ships as `docker compose`; some installs (e.g. Homebrew + colima) only have `docker-compose`.
if docker compose version >/dev/null 2>&1; then COMPOSE=(docker compose); else COMPOSE=(docker-compose); fi
command -v "${COMPOSE[0]}" >/dev/null || die "docker compose is required"

# Fail fast if something already holds our ports: otherwise the new API dies
# with EADDRINUSE while the health check below passes against the OLD one.
for port in 3000 5173; do
  if pid=$(lsof -ti "tcp:$port" -sTCP:LISTEN 2>/dev/null) && [ -n "$pid" ]; then
    die "Port $port is in use by pid $pid ($(ps -o command= -p "${pid%%$'\n'*}" | cut -c1-60)). Stop it (kill $pid) and rerun."
  fi
done

[ -f .env ] || { cp .env.example .env; die "Created .env from .env.example: set ANTHROPIC_API_KEY in it, then rerun."; }
# Checks the key is non-empty without printing it.
grep -Eq '^ANTHROPIC_API_KEY=.+' .env || die "Set ANTHROPIC_API_KEY in .env, then rerun."

if [ ! -f runner/.hermes-env.json ]; then
  say "First run: installing Hermes at the pinned commit (a few minutes)"
  ./runner/setup-hermes.sh
fi

say "Installing JS dependencies"
bun install --frozen-lockfile

say "Starting Postgres"
"${COMPOSE[@]}" up -d --wait postgres

say "Building"
bun run build:shared
bun run --filter @agent-evals/api build

pids=()
cleanup() { for p in ${pids[@]+"${pids[@]}"}; do kill "$p" 2>/dev/null || true; done; }
trap cleanup EXIT INT TERM

say "Starting API on :3000 (applies migrations, loads suites/ and configs/, starts the runner)"
(cd apps/api && node dist/main.js) & pids+=($!)

for _ in $(seq 1 60); do curl -sf localhost:3000/api/health >/dev/null && break; sleep 1; done
curl -sf localhost:3000/api/health >/dev/null || die "API did not come up; see its log above."

say "Starting web UI on http://localhost:5173"
bun run --filter @agent-evals/web dev & pids+=($!)

wait
