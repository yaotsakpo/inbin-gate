# IBM Bob Usage Statement (≤500 words)

IBM Bob 2.0 played two roles in this project: it built parts of the system, and it is the agent the system protects. Every Bob task below ran headlessly through Bob Shell against this repository, with the transcript of each task saved verbatim in `bob_sessions/shell-logs/` (`<task>.stream.json`) and the task recorded in Bob's task store. IDE task-summary screenshots are in `bob_sessions/`.

**Bob as builder (Agent mode, five tasks).**
- B1: Bob read `gate/server.mjs` and `gate/decide.mjs`, added operand validation (`validateOperand`, rejecting empty or over-long operands) at the top of the decision, wrote 14 unit tests, ran them, fixed its own two failing runs, and left the suite at 23 passing.
- B2: Bob generated `docs/sequence.md`, a Mermaid sequence diagram of one gated action from proposal to decision, with an explanation of why the agent's own proposal can never govern.
- B3: with two parallel subagents, Bob extended `bench/replay.mjs` with five more injected cases drawn from the planted content (bench now 15 of 15 injected refused, 10 of 10 legitimate allowed) and fixed accessibility in `web/index.html` (labels bound to inputs, visible focus rings, live regions, contrast check).
- B4: Bob reviewed the uncommitted diff for correctness, gate security and coverage; the run was cut by the gateway before it wrote its summary, and we say so in the commit.
- B5: Bob wrote the conventional commit message and committed through the gate itself (`git_commit_push` to `main`, allowed by repository policy).

**Bob as the protected agent (custom mode, seven tasks).** The `Gated Agent` custom mode (`.bob/custom_modes.yaml`) keeps Bob's native read and edit tools for source files and routes every world-changing action to the `inbin-gate` MCP server (`.bob/mcp.json`). Project rules (`.bob/rules/01-gate.md`) tell Bob how to treat a refusal: quote it, name the source file, ask the developer, never rephrase. With auto-approve on, Bob worked the ten developer tasks of `sample-project/TASKS.md` (issues fixed with parallel subagents, tests run, a dependency added, a deploy, a commit), reading the issues, README and CI log with document understanding. The gate's decision log from those sessions is `bob_sessions/decisions.jsonl`; Bob's own summary of every decision is `docs/demo-decisions.md`.

[COUNTS TO FILL FROM decisions.jsonl: actions allowed, actions refused, which planted instructions Bob attempted and how it reported them.]

**What Bob features were used.** Agent mode; parallel subagents (B3, D2); a custom mode with restricted tool groups; project rules; MCP server integration; document understanding of issues, READMEs and logs; commit message generation; headless runs via Bob Shell with the same configuration the IDE reads.

**What Bob did not do.** The resolver (`gate/authority.js`) is a pre-existing open-source component and was not written or modified by Bob. Bob did not write the two 500-word statements.

**watsonx.** Not used.
