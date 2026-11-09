#!/usr/bin/env bash
# Prepare the pinned Hermes Agent checkout the eval runner drives.
#
# Hermes does not support being installed as a package (its setup.py blocks
# wheel builds, and a wheel would lack the bundled skills, see upstream #66733).
# The documented way to use it as a library is a source checkout set up by its
# own installer (website/docs/guides/python-library.md), so we:
#   1. fetch Hermes at the commit in runner/HERMES_COMMIT into runner/.hermes
#   2. run Hermes's own installer (--runtime-only) from its uv.lock, ONLY if
#      this commit isn't installed yet (see "Install" below for why)
#   3. record how eval runs launch Hermes directly (runner/.hermes-env.json)
#   4. smoke-check that exact launch path with a throwaway HERMES_HOME
#
# Idempotent: once installed, re-running makes no network calls.
set -euo pipefail

RUNNER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMMIT="$(tr -d '[:space:]' < "$RUNNER_DIR/HERMES_COMMIT")"
SRC="$RUNNER_DIR/.hermes"
REPO_URL="https://github.com/NousResearch/hermes-agent.git"

# Shared tool store (pinned Python, ripgrep, ...) for setup AND every run.
export HERMES_RUNTIME_DIR="$RUNNER_DIR/.hermes-tools"
# The install home: holds the installed dependency venv. Eval runs never use it
# as their HERMES_HOME; each run gets a fresh one for config/skills/memory.
INSTALL_HOME="$RUNNER_DIR/.hermes-setup-home"
export HERMES_HOME="$INSTALL_HOME"
STAMP="$INSTALL_HOME/installed-commit"
ENV_FILE="$RUNNER_DIR/.hermes-env.json"
mkdir -p "$HERMES_RUNTIME_DIR" "$INSTALL_HOME"

# --- 1. Checkout ------------------------------------------------------------
if [ ! -d "$SRC/.git" ]; then
  echo "→ Fetching Hermes @ ${COMMIT:0:7}"
  git init -q "$SRC"
  git -C "$SRC" remote add origin "$REPO_URL"
fi
if [ "$(git -C "$SRC" rev-parse HEAD 2>/dev/null || true)" != "$COMMIT" ]; then
  # Fetch only the pinned commit (shallow), not the whole history.
  git -C "$SRC" fetch -q --depth 1 origin "$COMMIT"
  git -C "$SRC" checkout -q --detach FETCH_HEAD
fi
echo "→ Hermes checkout at $(git -C "$SRC" rev-parse --short HEAD)"

# Hermes's own Python (any interpreter works for these stdlib-only helpers).
store_python() { ls -d "$HERMES_RUNTIME_DIR"/python-3.14*/bin/python3 2>/dev/null | head -1; }

# Write .hermes-env.json: how eval runs launch Hermes WITHOUT
# scripts/run-in-hermes-env. That wrapper keys installed dependencies to
# HERMES_HOME, so with a fresh HERMES_HOME per run it reinstalls everything
# each time (~2 min + network). Instead runs launch the committed venv's own
# interpreter, which Hermes accepts because "a venv interpreter carries its own
# packages" (pm/environments.py, _require_own_dependencies).
record_env() {
  PYTHONPATH="$SRC" "$(store_python)" - "$SRC" "$HERMES_RUNTIME_DIR" "$COMMIT" "$ENV_FILE" <<'PY'
import json, os, sys
from pathlib import Path
# Hermes's own read-only views of its install: "Read the installed PM
# environment; do not provision or switch imports." Using them (not a
# hand-kept list) keeps our runs' toolbox identical to stock Hermes.
from pm.environments import activation_environment, selected_venv

src, runtime_dir, commit, out = sys.argv[1:5]
root = Path(src)
act = activation_environment(root)
env = {
    "hermesCommit": commit,
    "python": str(selected_venv(root) / "bin" / "python"),
    "pythonPath": src,  # Hermes root modules (run_agent, ...)
    # Tool dirs Hermes puts on PATH (ripgrep, node, ffmpeg, ...), in its order.
    "pathPrefix": [p for p in act.get("PATH", "").split(os.pathsep) if p.startswith(runtime_dir)],
    "runtimeDir": runtime_dir,
    "playwrightBrowsersPath": act.get("PLAYWRIGHT_BROWSERS_PATH", runtime_dir),
}
Path(out).write_text(json.dumps(env, indent=2) + "\n")
PY
}

# Launch exactly as eval runs do: venv python, recorded env, throwaway home.
smoke_check() {
  local home py pypath path_prefix
  home="$(mktemp -d)"
  read -r py pypath path_prefix < <(python3 -I -c '
import json, os, sys
e = json.load(open(sys.argv[1]))
print(e["python"], e["pythonPath"], os.pathsep.join(e["pathPrefix"]))' "$ENV_FILE")
  env -i HOME="$HOME" PATH="$path_prefix:/usr/bin:/bin" PYTHONPATH="$pypath" \
    HERMES_RUNTIME_DIR="$HERMES_RUNTIME_DIR" HERMES_HOME="$home" \
    "$py" -c "import sys; from run_agent import AIAgent; print('AIAgent import OK on Python', sys.version.split()[0])"
  local status=$?
  rm -rf "$home"
  return $status
}

# --- 2. Install (only when needed) -------------------------------------------
# Hermes's installer re-resolves EVERY declared extra on each run, including an
# optional TTS wheel (kittentts) pinned to a GitHub release URL that is served
# `cache-control: no-cache` and fails intermittently or per-region (upstream
# #147860; we saw a persistent 504 from GitHub's centralindia edge). So we run
# it only when this commit isn't installed yet, and retry when we do.
if [ "$(cat "$STAMP" 2>/dev/null || true)" = "$COMMIT" ] && [ -n "$(store_python)" ] \
   && record_env && smoke_check >/dev/null 2>&1; then
  echo "→ Hermes @ ${COMMIT:0:7} already installed; skipping installer (no network)"
else
  MAX_ATTEMPTS=4
  for attempt in $(seq 1 "$MAX_ATTEMPTS"); do
    echo "→ Running Hermes installer (runtime only), attempt $attempt/$MAX_ATTEMPTS"
    if "$SRC/setup-hermes.sh" --runtime-only; then
      break
    fi
    if [ "$attempt" -eq "$MAX_ATTEMPTS" ]; then
      echo "✗ Hermes install failed after $MAX_ATTEMPTS attempts (see upstream #147860)." >&2
      exit 1
    fi
    wait_s=$((15 * (1 << (attempt - 1))))  # 15s, 30s, 60s
    echo "  install failed; retrying in ${wait_s}s (known flaky upstream download, #147860)"
    sleep "$wait_s"
  done
  printf '%s\n' "$COMMIT" > "$STAMP"
  record_env
fi

# --- 3/4. Record + verify the launch path ------------------------------------
echo "→ Launch environment recorded in ${ENV_FILE#"$RUNNER_DIR"/}"
echo "→ Smoke check (direct launch, fresh HERMES_HOME)"
smoke_check
