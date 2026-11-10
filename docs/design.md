# Design

## What it answers

*Is config B better than config A on these tasks, and how sure are we?* Getting a correct answer needs three things:

1. **The two arms must differ only in the variable under test.** Same tasks, same tools, same limits, same Hermes commit, and the same isolation for every run.
2. **The outcomes must be trustworthy.** Graders decide pass or fail deterministically, and a broken grader or a platform failure must never be counted as a model failure.
3. **The uncertainty must be honest.** The analysis has to say "we can't tell" when it can't.

Everything below serves one of those three.

## Architecture

```
 Vue UI (:5173) ──/api──▶ NestJS API (:3000) ────────────────▶ Postgres (runs table = job queue)
                           │  catalog: suites/*.yaml, configs/*.yaml → validated snapshots
                           │  experiments: create (expand tasks × arms × trials), start/cancel
                           │  analysis: paired bootstrap over tasks, computed on read
                           │
                           └─ Runner (in-process worker, N concurrent)
                                claim run ─▶ plan ─▶ write run dir ─▶ spawn driver.py ─▶ normalize
                                     ▲                                  │                   │
                                     │                       Hermes AIAgent (Python)   classify ─▶ grade ─▶ persist
                                     │                       tools run in a docker     │
                                     └── retry (infra) ◀─────  sandbox: only /workspace ┘
```

- **One process per run.** `runner/driver.py` wraps Hermes's `AIAgent.run_conversation()`. It gets a fresh `HERMES_HOME` (config, skills, memory) and a fresh workspace (fixtures) every time, and writes one JSON result. Nothing carries over between runs, so runs can't contaminate each other, and a crash takes down only one run.
- **Postgres is the queue.** The `runs` table holds every planned run. Workers claim one with `UPDATE … WHERE id = (SELECT … FOR UPDATE SKIP LOCKED)`, which is atomic, needs no extra queue service, and lets several workers run safely. On startup, runs left `running` by a crashed process are re-queued.
- **Shared contract.** `packages/shared` holds zod schemas (grader specs, snapshots, request bodies) and response types. The API validates with the schemas, and the UI is typed against them.

## Data model

| Table | Purpose |
|---|---|
| `suites`, `tasks` | Loaded from YAML. Upserted by slug and never deleted, because runs reference them. A task removed from a file becomes `active = false`. |
| `agent_configs` | Loaded from YAML. |
| `experiments`, `experiment_arms` | An arm stores a **frozen `config_snapshot`**, and the experiment records the Hermes commit and the bootstrap seed. |
| `runs` | One row per (arm, task, trial). This is also the queue: status, attempt, `available_at` for retry backoff, tokens, cost, duration, error kind. It stores a **frozen `task_snapshot`**. |
| `run_sessions` | Per session: prompt, final response, full message list, available tools, Hermes outcome and memory snapshot. |
| `grader_results` | One row per grader: passed, score and **reason**. |

The snapshots are frozen deliberately. Editing a config or task later can't change what a stored result was produced or graded with.

## Run lifecycle

1. **Plan** (`runner/plan-run.ts`, pure) turns config + task into files and a driver spec. This is where "A vs B" becomes concrete, so it's the most heavily tested module.
   - The `skills` toolset is on in *both* arms, so only the skill's *presence* differs.
   - `delegation` is always off: sub-agents bypass the background-review switch.
   - Memory is set explicitly, because Hermes defaults it to on. Skill-creation and memory nudges are off.
   - Iterations and time take the stricter of the task's and the config's limits.
   - Fixture paths can't escape the workspace.
   - A test asserts that the baseline and +skill plans differ **only** in the skill files.
2. **Spawn** (`spawn-driver.ts`) starts the driver in its own process group, with an environment built from scratch so no other credentials leak in. A hard timeout of budget × sessions + 60s kills the whole process group.
3. **Normalize** (`trace.ts`) turns Hermes's result into sessions, tool calls and token counts, and validates its shape.
4. **Classify** (`classify.ts`, below) decides whether the attempt counts as evidence.
5. **Grade** (`grading/graders.ts`) runs each grader against the final response, the tool calls, or files the agent wrote, read through a reader confined to the workspace with a 1 MB cap.
6. **Persist** runs as one transaction. It replaces the previous attempt's evidence, so a retried run never shows two sets of results. When the last run finishes, the experiment is marked complete.

## Failure handling: what counts as evidence

| Outcome | Examples | Counted as |
|---|---|---|
| `passed` / `failed` | Graders ran | Evidence |
| `agent_error` | Iteration limit hit, context overflow, model refused | **A failure.** The config did this. |
| `timeout` | The run exceeded its budget and was killed | **A failure** (see [limits](limits.md)) |
| `infra_error` | Rate limit, 5xx, network, driver crash, unreadable result | **Retried** after 15s, 60s, 240s, up to 3 attempts, then **excluded** from the statistics and counted separately |
| fatal | Invalid key, billing, unknown model | **Stops the experiment.** Every later run would fail the same way. |

The asymmetry is deliberate:
- Counting an infra error as a fail would penalise whichever arm happened to hit an outage.
- Excluding agent errors would hide real failures of a config.

Graders **never throw** on anything the agent did. A missing file, invalid JSON or no answer is a graded failure, because a throw would surface as an infra error and the run would quietly drop out of the statistics. A run with no required graders never passes.

## Statistics

Computed on read, from stored outcomes (`analysis/stats.ts`, `experiments/analysis.ts`).

- **The unit is the task, not the run.** Trials of the same task are correlated (same prompt, same difficulty), so treating 140 runs as 140 independent observations would make the CI far too narrow.
- **Paired difference:** for each task present in both arms, δₜ = pass rate of B over its trials − pass rate of A over its trials. The reported Δ is the mean of δₜ over the paired tasks.
- **Uncertainty:** a **percentile bootstrap that resamples tasks** with replacement, using 10,000 resamples and a seeded PRNG (mulberry32), so a stored experiment always reproduces the same interval. The 95% CI therefore reflects which tasks happened to be in the suite, which is the question that matters ("would this hold on similar tasks?"), not only trial noise.
- **Verdict:**
  - **better** if the CI is entirely above 0;
  - **worse** if it's entirely below 0;
  - **inconclusive** otherwise;
  - **insufficient_data** below 5 paired tasks.

  A positive point estimate with a CI that crosses 0 is shown as "no clear difference" and never as a win; `format.spec.ts` tests exactly that.
- **Per arm**, the UI also shows cost (infra-error attempts count, since they cost money), mean latency and mean tokens (evidence runs only), and the per-task table grouped by category.

This approach follows the "clustered standard errors / resample the clusters" advice for LLM evals (e.g. Miller, *Adding Error Bars to Evals*, 2024), and bootstrapping avoids assuming normality with very few tasks.

## Sandbox

Hermes's file tools **aren't confined to the working directory**: they print a warning for paths outside it and then read them anyway. In the first pilot the baseline arm searched the host and **read the skill file straight from this repo**, so the "without skill" arm had the skill. Details are in [results.md](results.md#the-pilot-that-caught-contamination).

Every run therefore uses Hermes's docker terminal backend, and in that mode its file tools also run inside the container:
- a fresh `python:3.13-slim` container per run, with no reuse across sessions or processes;
- **only the run's workspace** bind-mounted at `/workspace`, as an explicit volume;
- no network.

Skills and memory are read by Hermes outside the container, from the run's own `HERMES_HOME`, so the +skill arm still has its skill. The runner checks Docker at startup and **refuses to run** rather than silently falling back to the host. `SANDBOX=local` is an explicit, logged opt-out.

## Graders

All graders are deterministic and code-checked. Every task in the shipped suites has a **golden attempt** (`suites/golden/<suite>/<task>.yaml`). `shipped-suites.spec.ts` asserts three things:
1. the golden attempt passes every required grader;
2. an empty attempt (fixtures only, no answer) fails every task;
3. the experiment's configs differ only in the variable under test.

For the CRM suite, the expected values came from a reference implementation of the skill's rules, not from hand arithmetic.

`llm_judge` exists in the schema but isn't implemented. It fails explicitly instead of passing ([limits](limits.md)).

## Testing strategy

The tests concentrate where **a bug would quietly change a conclusion instead of crashing**:

| Area | Why it's tested |
|---|---|
| Graders (27 tests) | A grader that passes vacuously or throws would turn into fake passes or quietly dropped runs. |
| Statistics (16) + analysis mapping (8) | A wrong CI or a status counted in the wrong bucket would flip the verdict. |
| Run planner (23) | Arms must differ only in the variable under test; sandbox, memory and toolset settings. |
| Failure classifier (31) and retry decisions (11) | Decide what counts as evidence. |
| Catalog parsing (13) | A typo in a task file must fail at load time, not mid-experiment. |
| Shipped suites (46) | Golden passes, empty fails, configs differ in one variable. |
| Queue (7, against real Postgres) | Atomic claims under concurrency, backoff, crash recovery. |
| Live end to end (1, opt-in) | One real Hermes run through the whole pipeline. |
| UI verdict formatting (7) | "Inconclusive" must never read as a win; signs and rounding. |

Not unit-tested, on purpose: Nest wiring, controllers and the Vue pages. They're thin, and they were checked by running them against real data.

The two trial-run bugs, contamination and the empty-workspace mount, weren't catchable by unit tests. That's why every experiment design here includes a **cheap 1-trial pilot**, whose transcripts get read before spending on the full run.

## Main decisions and trade-offs

| Decision | Alternative | Why |
|---|---|---|
| Hermes as a subprocess per run, through our own driver | Hermes's HTTP server / gateway | Full isolation per run, and exact control of config and toolsets. The cost is about 7k cached tokens of Hermes system prompt per call. |
| Postgres as the queue | Redis/BullMQ | One less service. `SKIP LOCKED` is enough at this scale, and state and queue can't drift apart. |
| Bootstrap over tasks | A t-test over runs | Correct clustering, no normality assumption, and an honest "can't tell" with few tasks. |
| YAML catalog, upserted on boot | CRUD UI for tasks and configs | Task content belongs in version control and in review. The UI is read-only for them. |
| Deterministic graders first | LLM judge everywhere | Reproducible and free. A judge needs its own validation against human labels before it can be trusted. |
| Docker sandbox by default | Run tools on the host | The first trial run showed the host is not a fair test environment. |
