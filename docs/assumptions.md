# Assumptions

These are the places where the assignment left room for interpretation, and what I chose.

1. **"Better" means a higher task pass rate.** A run passes when all of its required graders pass. The continuous `score` (the weighted mean of grader scores) is recorded and shown, but verdicts use pass or fail, because "did it do the job" is what a user acts on, and partial credit is easy to game.
2. **The unit of evidence is the task.** Trials of one task aren't independent, so uncertainty comes from resampling tasks, and the conclusion generalises to "tasks like these" (see [design](design.md#statistics)).
3. **An agent config is model + skills (and how they're exposed) + memory mode + toolsets + limits.** Each experiment compares exactly two configs and is meant to vary one of these. The shipped configs are checked to differ in only one field.
4. **Each run starts from nothing.** It gets a fresh Hermes home, workspace and sandbox. "Memory" means memory carried across the sessions *of one task*, not across tasks or runs. Otherwise trials wouldn't be independent and the order of runs would affect results.
5. **Tasks are graded by code where possible.** The sample suite is deliberately code-checkable, with exact files and values. An LLM judge is the planned extension for open-ended tasks (see [limits](limits.md)).
6. **Infrastructure failures aren't evidence about the agent; agent failures are.** Rate limits, outages and driver crashes are retried and then excluded. Iteration limits, context overflow, refusals and timeouts count as failures of that config.
7. **Model sampling settings are Hermes's defaults.** Trials capture the model's own variability; temperature wasn't tuned.
8. **Single local user, Anthropic only.** Haiku 5.5 was used for cost; the platform has no model-specific logic beyond pricing.
9. **The sample domain is a fictional agency's CRM playbook** (Brightline Realty, Indian phone numbers and INR budgets). Its rules are invented on purpose, so the model can't already know them and a skill's effect can be measured cleanly.
10. **Suites and configs are code.** They're edited as YAML in the repository and reviewed like code, not created in the UI.
