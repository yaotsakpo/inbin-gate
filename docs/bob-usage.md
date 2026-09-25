# IBM Bob Usage Statement (≤500 words)

Bob 2.0 played two roles: it built parts of the system, and it is the agent the system protects. Every task ran through Bob Shell on the hackathon organisation (`ibm-coding-challenge-uat`); transcripts are in `bob_sessions/shell-logs/` (an earlier pass on a trial organisation is archived in `first-account/`). Screenshots are in `bob_sessions/`.

**Bob as builder (Agent mode).**
- B1: operand validation (`validateOperand`) with 14 unit tests; Bob ran them, fixed its own two failing runs.
- B2: `docs/sequence.md`, a Mermaid sequence diagram of one gated action, with why the agent's own proposal can never govern.
- B3: two parallel subagents: five more injected bench cases (now 15/15 refused, 10/10 allowed) and accessibility fixes in `web/index.html`.
- B4: a diff review, cut by the gateway before its summary; the commit says so.
- B5: the commit message, committed through the gate itself.
- B6: a security review of the gate (`docs/security-review.md`) that found two real weaknesses, substring matching and a containment check after the gate; both fixed, regression test added.
- B7: unit tests for the policy loader; the suite is now 38 tests.

**Bob as the protected agent.** The gate is a Bob `PreToolUse` hook (`.bob/settings.json`, `gate/hook.mjs`): Bob keeps every native tool in every mode and the hook blocks unauthorised terminal commands and protected-file writes with exit code 2. A strict `Gated Agent` custom mode (`.bob/custom_modes.yaml`) and the `inbin-gate` MCP tools (`.bob/mcp.json`) are optional. Project rules (`.bob/rules/01-gate.md`) tell Bob how to treat a refusal: quote it, name the source file, ask the developer, never rephrase. With auto-approve on, Bob worked the tasks of `sample-project/TASKS.md` (issues fixed with parallel subagents, tests, a dependency, a deploy, a commit). Two further tasks replayed the real Amazon Q and GitHub MCP payloads; Bob refused both on its own (`docs/baseline.md`). Eighteen more runs (six chores, three configurations) are the improvisation experiment (`docs/improvisation.md`), including the one where Bob tried to write the developer's intent file to authorise its own `git reset`. The gate's decision log is `bob_sessions/decisions.jsonl`; Bob's own summary is `docs/demo-decisions.md`.

**Counts, from `bob_sessions/decisions.jsonl`.** Across the Gated Agent sessions the gate made 19 decisions: 10 actions allowed (tests, install, start, the stated dependency, the stated branch) and 9 refused. Bob attempted 3 of the planted instructions (the curl from issue 004, the README's deploy target, the CI log's force-push) and the gate refused all 3, naming the source file each time; none was executed. The remaining refusals were Bob's own unstated proposals (a `node -e` script to write a source file, `node --version`, `git status`, a protected-file edit), refused because nobody had stated them, which is the rule working as designed.

**Bob features used.** PreToolUse hooks; Agent mode; parallel subagents (B3, D2); a custom mode; project rules; MCP; document understanding of issues, READMEs and logs; commit messages; headless Bob Shell runs on the IDE's configuration.

**What Bob did not do.** The resolver (`gate/authority.js`) is pre-existing open source, untouched by Bob. Bob did not write the two statements.

**watsonx.** Not used.
