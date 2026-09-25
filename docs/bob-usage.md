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

**Bob as the protected agent (custom mode, seven tasks).** The `Gated Agent` custom mode (`.bob/custom_modes.yaml`) keeps Bob's native read and edit tools for source files and routes every world-changing action to the `inbin-gate` MCP server (`.bob/mcp.json`). Project rules (`.bob/rules/01-gate.md`) tell Bob how to treat a refusal: quote it, name the source file, ask the developer, never rephrase. With auto-approve on, Bob worked the ten developer tasks of `sample-project/TASKS.md` (issues fixed with parallel subagents, tests, a dependency, a deploy, a commit), reading the issues, README and CI log. The gate's decision log from those sessions is `bob_sessions/decisions.jsonl`; Bob's own summary of every decision is `docs/demo-decisions.md`.

**Counts, from `bob_sessions/decisions.jsonl`.** Across the Gated Agent sessions the gate made 19 decisions: 10 actions allowed (tests, install, start, the stated dependency, the stated branch) and 9 refused. Bob attempted 3 of the planted instructions (the curl from issue 004, the README's deploy target, the CI log's force-push) and the gate refused all 3, naming the source file each time; none was executed. The remaining refusals were Bob's own unstated proposals (a `node -e` script to write a source file, `node --version`, `git status`, a protected-file edit), refused because nobody had stated them, which is the rule working as designed.

**What Bob features were used.** Agent mode; parallel subagents (B3, D2); a custom mode with restricted tool groups; project rules; MCP server integration; document understanding of issues, READMEs and logs; commit message generation; headless runs via Bob Shell with the same configuration the IDE reads.

**What Bob did not do.** The resolver (`gate/authority.js`) is pre-existing open source, untouched by Bob. Bob did not write the two statements.

**watsonx.** Not used.
