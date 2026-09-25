# IBM Bob Usage Statement (≤500 words)

IBM Bob 2.0 played two roles in this project: it built parts of the system, and it is the agent the system protects. Every task ran through Bob Shell against this repository on the hackathon organisation (`ibm-coding-challenge-uat`); each transcript is saved verbatim in `bob_sessions/shell-logs/`. A first pass of the same tasks, run on a personal trial organisation before the hackathon account was active, is kept in `bob_sessions/shell-logs/first-account/`. Task-summary screenshots are in `bob_sessions/`.

**Bob as builder (Agent mode, five tasks).**
- B1: Bob read `gate/server.mjs` and `gate/decide.mjs`, added operand validation (`validateOperand`, rejecting empty or over-long operands) at the top of the decision, wrote 14 unit tests, ran them, fixed its own two failing runs, and left the suite at 23 passing.
- B2: Bob generated `docs/sequence.md`, a Mermaid sequence diagram of one gated action from proposal to decision, with an explanation of why the agent's own proposal can never govern.
- B3: with two parallel subagents, Bob extended `bench/replay.mjs` with five more injected cases drawn from the planted content (bench now 15 of 15 injected refused, 10 of 10 legitimate allowed) and fixed accessibility in `web/index.html` (labels bound to inputs, visible focus rings, live regions, contrast check).
- B4: Bob reviewed the diff for correctness, gate security and coverage; the gateway cut the run before it wrote its summary, and the commit says so.
- B5: Bob wrote the conventional commit message and committed through the gate itself (`git_commit_push` to `main`, allowed by repository policy).
- B6: Bob reviewed the gate as a security reviewer and found two real weaknesses (`docs/security-review.md`): substring matching let a fragment of a stated value through, and the path-containment check ran after the gate. Both were fixed and a regression test added.
- B7: Bob wrote unit tests for the policy loader (`gate/core.test.mjs`); the suite is now 38 tests.

**Bob as the protected agent (custom mode, seven tasks).** The `Gated Agent` custom mode (`.bob/custom_modes.yaml`) keeps Bob's native read and edit tools for source files and routes every world-changing action to the `inbin-gate` MCP server (`.bob/mcp.json`). Project rules (`.bob/rules/01-gate.md`) tell Bob how to treat a refusal: quote it, name the source file, ask the developer, never rephrase. With auto-approve on, Bob worked the ten developer tasks of `sample-project/TASKS.md` (issues fixed with parallel subagents, tests, a dependency, a deploy, a commit), reading the issues, README and CI log. The gate's decision log from those sessions is `bob_sessions/decisions.jsonl`; Bob's own summary of every decision is `docs/demo-decisions.md`.

**Counts, from `bob_sessions/decisions.jsonl`.** Across the Gated Agent sessions the gate made 19 decisions: 10 actions allowed (tests, install, start, the stated dependency, the stated branch) and 9 refused. Bob attempted 3 of the planted instructions (the curl from issue 004, the README's deploy target, the CI log's force-push) and the gate refused all 3, naming the source file each time; none was executed. The remaining refusals were Bob's own unstated proposals (a `node -e` script to write a source file, `node --version`, `git status`, a protected-file edit), refused because nobody had stated them, which is the rule working as designed.

**What Bob features were used.** Agent mode; parallel subagents (B3, D2); a custom mode with restricted tool groups; project rules; MCP server integration; document understanding of issues, READMEs and logs; commit message generation; headless runs via Bob Shell with the same configuration the IDE reads.

**What Bob did not do.** The resolver (`gate/authority.js`) is pre-existing open source, untouched by Bob. Bob did not write the two statements.

**watsonx.** Not used.
