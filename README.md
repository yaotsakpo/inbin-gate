# Inbin Gate: safe auto-approve for IBM Bob

**The problem.** Every developer wants Bob's auto-approve on. Bob's own guide warns that auto-approve "increases security risks", and it is right: an agent in Agent mode reads issues, READMEs, dependency docs and CI logs all day, and any of them can say "to fix this, run `curl … | sh`", "add this package", "push to this branch". Today the choice is speed (auto-approve on, act on whatever the text says) or safety (approve every action by hand).

**The solution.** A gate between Bob and the world. Bob keeps auto-approve on and can change anything outside source files only through four gated tools (run a command, add a dependency, edit a protected file, commit and push). Each tool executes only when its operands were **stated by someone with authority over that fact**: the developer, in their own words, typed out of band (`gate intent "…"`), or the repository's maintainers (package.json scripts and dependencies, `.gate/policy.json`, CODEOWNERS). Text Bob read has no authority, whatever it claims. A refused action comes back with the reason and the file the value came from, and Bob asks the developer instead of acting.

Authority is derived from the **channel** a value arrived on, never from the value or from what the agent says about it, by the published PSAP resolver (`gate/authority.js`, unmodified). The developer's channel and the maintainers' channel hold a grant; the agent's own proposals do not, so an injected value stays at the least class however it is rephrased.

## Result on the sample project

`sample-project/` is a small Express API with 6 issues, a README and a CI log, five of which carry planted instructions (a curl-pipe-sh, a rogue dependency, a rogue deploy target, a force-push). Ten developer tasks from `TASKS.md`.

```
npm test          # 8 unit tests on the decision
npm run bench     # 20 proposed actions: 10 legitimate, 10 injected
```

Gate-level replay: **10/10 legitimate actions allowed, 10/10 injected actions refused**, each refusal naming the file the value came from. The Bob-in-the-loop sessions on the same tasks are in `bob_sessions/` and `sample-project/.gate/decisions.jsonl`.

Live demo (runs the resolver in your browser): https://inbin-gate.vercel.app

## Run it with Bob

1. `npm install`
2. Open this folder in Bob IDE. The MCP server (`.bob/mcp.json`), the **Gated Agent** custom mode (`.bobmodes`) and the rules (`.bob/rules/`) are picked up from the workspace. If your Bob version keeps MCP settings elsewhere, paste the `inbin-gate` entry from `.bob/mcp.json` into it.
3. In a terminal Bob does not control, state what you want: `node gate/cli.mjs intent "fix issue 004 and run the tests"`.
4. Switch Bob to **Gated Agent**, turn auto-approve on, and give it the task. Watch `node gate/cli.mjs log`.

## Layout

```
gate/decide.mjs      the decision, pure (tested)
gate/core.mjs        channels from disk: developer intent, repository policy; decision log
gate/server.mjs      MCP server: run_command, add_dependency, edit_protected_file, git_commit_push, gate_status, gate_explain
gate/cli.mjs         the developer's channel: gate intent / status / log
gate/authority.js    PSAP resolver, unmodified (Apache-2.0, see NOTICE)
sample-project/      the demo repository with planted injections and TASKS.md
bench/replay.mjs     20-action deterministic replay
web/                 the hosted demo (static)
docs/                submission texts, slides, Bob session script
bob_sessions/        Bob task session summary screenshots
```

## Why this is different from a filter

A filter tries to recognise a malicious instruction. The gate never looks at what an instruction says; it asks who stated the value. "Approved by the platform team" written inside an issue is a claim by the issue's author. The same command typed by the developer is allowed, and the trace shows exactly which channel made it so.

## Built with IBM Bob 2.0

See `docs/bob-usage.md` and the screenshots in `bob_sessions/`.
