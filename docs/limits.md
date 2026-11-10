# Known limits

Roughly in order of how much each could affect a conclusion.

## Measurement

- **Small suite, wide intervals.** With 14 tasks, even a perfectly clean flip gives a CI of +29 to +86. Detecting small effects (a few points) would need dozens or hundreds of tasks, ideally drawn from real failures. There's no power or sample-size calculator.
- **The headline Δ depends on the suite's mix.** It's a mean over tasks, so the share of skill vs control tasks sets its size. The UI shows per-category rows next to it; read those first.
- **Only pass rate gets a confidence interval.** Cost, latency and tokens are shown as means, without intervals or a significance test.
- **Two arms at a time.** Comparing many configs, or running many experiments, needs a multiple-comparison correction; there's none.
- **A timeout counts as a failure.** That's right when the agent loops, but a hung sandbox or Docker call can't be told apart from it. This was seen once, in pilot 3, and never in the 140-run experiment. `KEEP_RUN_DIRS=true` keeps Hermes's logs for diagnosis.
- **No LLM-judge grader.** The `llm_judge` type exists in the schema but fails explicitly rather than passing. Every shipped task is code-checked, which suits rule-following work but not open-ended answers such as tone, helpfulness or summaries. A judge would also need validating against human labels before its verdicts could be trusted.
- **The memory suite is shipped but wasn't run as an experiment.** Its 4 two-session tasks and the `haiku-memory` config are ready, and their golden checks pass, but there are no results for it.
- **The skill tasks were designed to be unguessable.** The real experiment therefore mostly shows the platform works and catches side effects. It is not evidence about skills in general.

## Isolation and environment

- **Docker is required for fair results.** `SANDBOX=local` runs the agent's tools on the host with full access to it. The first pilot showed the baseline reading the skill from this repo that way.
- **The sandbox has no network.** Tasks that need the web can't be run as configured; the `web` toolset is never enabled.
- **The host workspace path appears in the agent's system prompt**, because Hermes's `cwd` is the host path. The agent can't read it, but it does see it.
- **Run folders live under `~/.cache/agent-evals-runs`.** Colima and Docker Desktop only share `$HOME` with their VM, and a bind mount of an unshared path is silently empty.
- **The app itself isn't containerised.** `docker-compose.yml` runs only Postgres. Hermes's virtualenv is built for the host (macOS here), and putting the API in a container would mean building Hermes inside a Linux image, including its flaky optional dependencies. `bun run start` is the one command instead.
- **Hermes setup can fail on upstream downloads.** Its installer fetches some optional dependencies from GitHub, which intermittently return 504 (upstream issue #147860). `setup-hermes.sh` retries with backoff and skips the installer once a stamp file matches.
- **Hermes is pinned** at `f404daf`. Upgrading means re-running setup; each experiment records the commit it ran on.

## Platform

- **One global concurrency limit** (`RUNNER_CONCURRENCY`, default 4). There's no per-experiment fairness and no scheduling that respects API rate limits. A 429 is treated as an infrastructure error and retried with backoff.
- **Fatal errors stop the experiment.** That covers an invalid key, billing and an unknown model. Runs already queued stay in the DB; there's no "resume" button, so you create a new experiment.
- **Suites and configs are read-only in the UI.** They live in YAML under version control. A config deleted from `configs/` stays in the DB, and stays selectable, until it's removed manually. Tasks are marked inactive instead.
- **No authentication and a single user.** It's meant to run locally.
- **Only Anthropic was tested.** The `provider` field exists, but no other provider was tried.
- **Haiku's long-prompt price tier is chosen per run, from the average prompt size**, not per call. See [costs](costs.md).
