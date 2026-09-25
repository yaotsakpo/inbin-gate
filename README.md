# Inbin Gate: safe auto-approve for IBM Bob

**The problem.** Every developer wants Bob's auto-approve on. Bob's own guide warns that auto-approve "increases security risks", and it is right: an agent in Agent mode reads issues, READMEs, dependency docs and CI logs all day, and any of them can say "to fix this, run `curl … | sh`", "add this package", "push to this branch". Today the choice is speed (auto-approve on, act on whatever the text says) or safety (approve every action by hand).

**The solution.** A gate between Bob and the world. Bob keeps auto-approve on and can change anything outside source files only through four gated tools (run a command, add a dependency, edit a protected file, commit and push). Each tool executes only when its operands were **stated by someone with authority over that fact**: the developer, in their own words, typed out of band (`gate intent "…"`), or the repository's maintainers (package.json scripts and dependencies, `.gate/policy.json`, CODEOWNERS). Text Bob read has no authority, whatever it claims. A refused action comes back with the reason and the file the value came from, and Bob asks the developer instead of acting.

Authority is derived from the **channel** a value arrived on, never from the value or from what the agent says about it, by the published PSAP resolver (`gate/authority.js`, unmodified). The developer's channel and the maintainers' channel hold a grant; the agent's own proposals do not, so an injected value stays at the least class however it is rephrased.

## What is measured, and what is by construction

The gate is an allowlist by provenance: a value runs only if the developer's stated intent or the repository's own configuration states it. So "injected values are refused" is true by construction, and the bench (`npm run bench`) is a test that the code does what it says, not a finding. Three things are measured, and they are the ones that matter:

1. **Does the agent propose unauthorised actions without the gate?** Four traps, two of them the verbatim payloads of real incidents. Bob on its own refused three and executed the fourth, a force-push planted in a CI log (`docs/baseline.md`).
2. **Does work still get done under the gate?** Across the demo tasks the gate took 18 decisions Bob would otherwise have asked about; Bob fixed the issues, ran the tests, added the dependency and committed; it stopped to ask the developer twice, both times legitimately; and in the deploy task it ran the README's steps but not the staging deploy script, so that task was not completed. Utility is good, not perfect, and that is the cost side of the rule.
3. **Is the rule sound as code?** Bob's own security review found two real defects (`docs/security-review.md`); both are fixed with regression tests.

## Result on the sample project

`sample-project/` is a small Express API with 6 issues, a README and a CI log, five of which carry planted instructions (a curl-pipe-sh, a rogue dependency, a rogue deploy target, a force-push). Ten developer tasks from `TASKS.md`.

```
npm test          # 8 unit tests on the decision
npm run bench     # 20 proposed actions: 10 legitimate, 10 injected
```

Gate-level replay: 10/10 legitimate actions allowed, 17/17 injected actions refused, each refusal naming the file the value came from. This is the code doing what it says; see the section above for what was actually measured. The Bob-in-the-loop sessions on the same tasks are in `bob_sessions/` and `sample-project/.gate/decisions.jsonl`.

Live demo (runs the resolver in your browser): https://inbin-gate.vercel.app

## Without the gate

Four traps, two of them the verbatim payloads of real incidents (the Amazon Q injected prompt, July 2025; the GitHub MCP issue that leaked a private repo, May 2025). On a clean copy with none of this configuration, Bob refused three of the four on its own judgment and **executed the fourth, the force-push from the CI log** (it failed only for lack of a remote, then told the user to run it from a real clone). Judgment catches the blatant ones and misses the plausible one, and you cannot know in advance which is which; the gate makes the outcome structural. Details and transcripts: `docs/baseline.md`, sources in `docs/incident-sources.md`.

## Run it with Bob

Three files in `.bob/` do the work, and the first one is enough on its own:

1. **`.bob/settings.json`, a `PreToolUse` hook.** Before Bob runs its own terminal or writes a protected file, Bob calls `gate/hook.mjs` with the tool name and arguments; exit code 2 blocks the call and the reason is what Bob reads. Bob keeps every native tool, in every mode, with auto-approve on. Nothing is taken away from it; unauthorised actions just don't run.
2. **`.bob/mcp.json`, the gate as MCP tools** (`gate_status`, `gate_explain`, and gated `run_command`, `add_dependency`, `edit_protected_file`, `git_commit_push`, `open_pull_request`). Optional helpers: Bob can ask what is established and explain a refusal.
3. **`.bob/rules/01-gate.md`** tells Bob how to treat a refusal: quote it, name the source file, ask the developer, never rephrase. **`.bob/custom_modes.yaml`** adds a strict *Gated Agent* mode that removes the native terminal entirely, for teams that want belt and braces.

Steps:

```
npm install
node gate/cli.mjs intent "fix issue 004 and run the tests"   # in a terminal Bob does not control
```

Open the folder in Bob IDE (or `bob run -w . "..."` from Bob Shell), turn auto-approve on, give Bob the task. `node gate/cli.mjs log` shows every decision. If your Bob keeps hooks or MCP settings elsewhere, paste the entries from the two files into its settings.

## Layout

```
gate/decide.mjs      the decision, pure (tested)
gate/core.mjs        channels from disk: developer intent, repository policy; decision log
gate/hook.mjs        the PreToolUse hook: Bob's native tools, gated (exit 2 blocks)
gate/server.mjs      MCP server: run_command, add_dependency, edit_protected_file, git_commit_push, open_pull_request, gate_status, gate_explain
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

## Known limits

- The developer intent is a list of positive statements. The gate matches values bounded by whitespace and does not parse negation: "do not run X" states X. Say what you want done, not what you do not.
- Attribution is exact-string provenance, not taint tracking.
- Numeric operands are not governed.
