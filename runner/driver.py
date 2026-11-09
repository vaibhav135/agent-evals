"""Run ONE eval task through Hermes Agent and write a JSON result file.

Usage (the Nest runner spawns this; nothing else should):

    <python> runner/driver.py SPEC.json

where <python> and the environment come from runner/.hermes-env.json, written
by runner/setup-hermes.sh. NOT via scripts/run-in-hermes-env: that wrapper
reinstalls dependencies for every fresh HERMES_HOME (see setup-hermes.sh).

The caller owns isolation and must set, BEFORE this process starts (Hermes
reads them at import time):
    HERMES_HOME               fresh per run (config.yaml, skills/, memories/)
    HERMES_RUNTIME_DIR        "runtimeDir" from .hermes-env.json
    PYTHONPATH                "pythonPath" (Hermes root modules)
    PATH                      "pathPrefix" + system PATH (Hermes's tool binaries)
    PLAYWRIGHT_BROWSERS_PATH  "playwrightBrowsersPath"
    ANTHROPIC_API_KEY

SPEC.json:
    {
      "model": "claude-haiku-5.5", "provider": "anthropic",
      "enabledToolsets": ["file", "terminal", "skills"],
      "disabledToolsets": ["delegation"],
      "skipMemory": true,
      "maxIterations": 30, "runBudgetSeconds": 300,
      "workspace": "/abs/path/to/task/workspace",
      "sessions": [{"prompt": "..."}, ...],
      "outputPath": "/abs/path/result.json"
    }

Design notes:
- Spec comes in as a file path and the result goes out to a file, not
  stdin/stdout: Hermes may re-exec a process that imports it (upstream #122160),
  which keeps argv but not consumed stdin, and stray prints to stdout from
  Hermes or its tools would corrupt a stdout JSON protocol.
- Each session is a NEW AIAgent on the same HERMES_HOME. Memory is injected as
  a frozen snapshot at session start, so this is what makes multi-session
  memory tasks meaningful.
- Self-contained on purpose (stdlib + Hermes only, no local imports): the
  re-exec above can drop this script's directory from sys.path.
"""

import json
import sys
import time
import traceback

_USAGE_KEYS = (
    "input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens",
    "reasoning_tokens", "total_tokens", "api_calls",
)
_COST_KEYS = ("estimated_cost_usd", "cost_status", "cost_source")
_OUTCOME_KEYS = (
    "completed", "failed", "partial", "error",
    "failure_reason", "failure_retryable", "turn_exit_reason",
)


def run_session(spec: dict, index: int, prompt: str) -> dict:
    from run_agent import AIAgent  # imported late: HERMES_HOME must already be set

    started = time.monotonic()
    agent = None
    out: dict = {"index": index, "prompt": prompt}
    try:
        agent = AIAgent(
            model=spec["model"],
            provider=spec.get("provider", "anthropic"),
            quiet_mode=True,
            # False on purpose: True would also strip the skills index and
            # pinned skills from the system prompt (agent/system_prompt.py),
            # silently turning a "+skill" arm into the baseline. Isolation
            # comes from the fresh workspace + HERMES_HOME instead.
            skip_context_files=False,
            skip_memory=bool(spec.get("skipMemory", True)),
            # Post-turn self-improvement writes memories/skills from a
            # background thread that may race process exit: non-deterministic.
            skip_background_review=True,
            enabled_toolsets=spec.get("enabledToolsets"),
            disabled_toolsets=spec.get("disabledToolsets"),
            # Never rely on Hermes's default (unbounded / inconsistent, #75097).
            max_iterations=int(spec.get("maxIterations", 30)),
            run_budget_seconds=spec.get("runBudgetSeconds"),
            cwd=spec["workspace"],
        )
        out["available_tools"] = sorted(getattr(agent, "valid_tool_names", []) or [])
        result = agent.run_conversation(prompt) or {}

        out["final_response"] = result.get("final_response")
        out["messages"] = result.get("messages") or []
        for key in _OUTCOME_KEYS + _USAGE_KEYS + _COST_KEYS:
            if key in result:
                out[key] = result[key]
    except Exception as exc:  # anything here is harness/infra, not agent behaviour
        out["exception"] = {
            "type": type(exc).__name__,
            "message": str(exc),
            "traceback": traceback.format_exc(),
        }
    finally:
        out["duration_ms"] = int((time.monotonic() - started) * 1000)
        if agent is not None:
            try:
                agent.close()
            except Exception:
                pass
    return out


def memory_snapshot() -> dict:
    """MEMORY.md / USER.md as they are right now. Taken after each session:
    the only point where "what did the agent carry into the next session"
    can be observed, which is what explains a memory task's result."""
    import os

    home = os.environ.get("HERMES_HOME", "")
    snap = {}
    for name in ("MEMORY.md", "USER.md"):
        path = os.path.join(home, "memories", name)
        if os.path.isfile(path):
            with open(path, encoding="utf-8", errors="replace") as fh:
                snap[name] = fh.read()
    return snap


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: driver.py SPEC.json", file=sys.stderr)
        return 2
    with open(sys.argv[1], encoding="utf-8") as fh:
        spec = json.load(fh)

    sessions = []
    for i, session in enumerate(spec["sessions"]):
        res = run_session(spec, i, session["prompt"])
        res["memory_snapshot"] = memory_snapshot()
        sessions.append(res)
        if "exception" in res:
            break  # later sessions depend on earlier ones; stop at first crash

    result = {"driver_version": 1, "sessions": sessions}
    # default=str: message payloads can carry non-JSON objects; never crash here.
    with open(spec["outputPath"], "w", encoding="utf-8") as fh:
        json.dump(result, fh, default=str)
    return 0


if __name__ == "__main__":
    sys.exit(main())
