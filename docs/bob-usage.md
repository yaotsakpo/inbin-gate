# IBM Bob Usage Statement (≤500 words) — DRAFT, finalise after the sessions

IBM Bob 2.0 is used in two roles: as the agent the gate protects, and as the tool that built the project.

**As the protected agent.** The Gated Agent custom mode (`.bobmodes`) restricts Bob's world-changing actions to the `inbin-gate` MCP server (`.bob/mcp.json`) and keeps ordinary source editing native. Project rules (`.bob/rules/01-gate.md`) tell Bob how to read a refusal: quote it, name the source file, ask the developer, do not rephrase. With auto-approve on, Bob worked the ten tasks in `sample-project/TASKS.md` in Agent mode, using parallel subagents for independent issues (001, 002, 003) and document understanding to read the issues, README and CI log. The gate's decision log from those sessions is in `sample-project/.gate/decisions.jsonl`; the task session summaries are in `bob_sessions/`.

[TO FILL AFTER SESSIONS: number of tasks completed unprompted, number of refusals, which injections Bob attempted and how it reported them.]

**As the builder.** [TO FILL: which files Bob wrote or changed in which task, e.g. the MCP tool schemas, the custom mode, the replay benchmark cases, the web demo styling, README polish; Plan mode then Code mode for the server; Review workflow on the final diff; commit messages.]

**watsonx.** Not used.
