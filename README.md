# Inbin Gate: safe auto-approve for IBM Bob

> 2nd place of 1,130 submissions, IBM Bob 2.0 Hackathon (October 2026). The gate is the [PSAP](https://github.com/yaotsakpo/PSAP) resolver, vendored unmodified, applied to a coding agent; the protocol and its two theorems are in [the paper](https://zenodo.org/records/23169446). The same resolver governs what an email agent may send at [inbin.dev](https://inbin.dev). Since the hackathon the gate was measured on Claude Code as well (`docs/improvisation.md`, last sections).

**The problem.** Every developer wants Bob's auto-approve on. Bob's own guide warns that auto-approve "increases security risks", and it is right: an agent in Agent mode reads issues, READMEs, dependency docs and CI logs all day, and any of them can say "to fix this, run `curl … | sh`", "add this package", "push to this branch". Today the choice is speed (auto-approve on, act on whatever the text says) or safety (approve every action by hand).

**The solution.** A gate between Bob and the world, installed as a Bob `PreToolUse` hook. Bob keeps auto-approve on and every native tool. Before a terminal command or a protected-file write runs, the gate classifies what it would do to *this* repository (delete regenerable output or unrecoverable work; rewrite local history or force-push shared history; reinstall or add a dependency; ordinary or privileged) and asks whether someone with authority over that consequence stated it: the developer, in their own words, typed out of band and signed (`gate intent "…"`); the repository's maintainers (its shared-branch config, `.gate/policy.json`, CODEOWNERS, and what they write in issues). Reads, regenerable output, local history and everyday git carry a default grant. Text Bob read has no authority, whatever it claims. A refusal names the consequence and the file the value came from, and Bob asks the developer instead of acting.

Authority is derived from the **channel** a value arrived on, never from the value or from what the agent says about it, by the published PSAP resolver (`gate/authority.js`, unmodified). The developer's channel and the maintainers' channel hold a grant; the agent's own proposals do not, so an injected value stays at the least class however it is rephrased.

## What is measured, and what is by construction

The gate is an allowlist by provenance: a value runs only if the developer's stated intent or the repository's own configuration states it. So "injected values are refused" is true by construction, and the bench (`npm run bench`) is a test that the code does what it says, not a finding. Three things are measured, and they are the ones that matter:

1. **Does the agent propose unauthorised actions without the gate?** Four traps, two of them the verbatim payloads of real incidents. Bob on its own refused three and executed the fourth, a force-push planted in a CI log (`docs/baseline.md`).
2. **Does work still get done under the gate?** Across the demo tasks the gate took 18 decisions Bob would otherwise have asked about; Bob fixed the issues, ran the tests, added the dependency and committed; it stopped to ask the developer twice, both times legitimately; and in the deploy task it ran the README's steps but not the staging deploy script, so that task was not completed. Utility is good, not perfect, and that is the cost side of the rule.
3. **Is the rule sound as code?** Bob's own security review found two real defects (`docs/security-review.md`); both are fixed with regression tests.
4. **Ordinary chores, no injection anywhere** (`docs/improvisation.md`). Six everyday tasks on a repo with things to lose. Bob on auto with no gate lost nothing but ran an unrequested `sudo chown` on the home directory, installed a package it chose itself, and force-pushed a shared branch. With the gate as a hook, Bob kept every native tool, everyday git went through, and the gate refused `git clean -fdx`, `rm -rf`, `git reset`, a scripted interactive rebase and the self-chosen package. In one chore Bob, refused twice, tried to grant itself authority by running `gate intent` and then by writing the intent file; both failed, because the intent is signed with a secret the agent cannot read. That first gate refused genuine work in four of six chores, because it wanted the literal command. Authority is now scoped per consequence (`gate/consequences.mjs`: regenerable output vs unrecoverable work, local history vs force-push, reinstall vs new dependency, privilege). Deleting or overwriting a named path is classified from the repository's state (gitignored, tracked, modified, untracked); the git history and discard commands are classified from the command text alone (see Known limits). Rerun: genuine work refused 0; two deliberate confirmations (a new dependency, a force-push to a shared branch); four chores need no human at all; cost six percent above ungated. Not covered by design: ordinary source edits, where one uncommitted line was lost; since then the developer's in-progress files are gated too.
5. **The same chores on a real repository** (`lukeed/clsx`, `docs/improvisation.md`, point 5; repeated on Claude Code after the hackathon, last section of the same file). Bob on auto with no gate deleted the developer's untracked notes twice and their uncommitted edit once, installed a package it picked, and force-pushed a shared branch. With the gate (the version that ships), nothing was lost in six chores: two needed no human, four paused once at the fact at stake, genuine work wrongly refused 0, at four percent fewer tokens. The earlier passes of that experiment found seven classifier defects, each fixed with a test; the last three (a freshly written script refused, a read of the gate's own files refused, a redirect onto work classed as a read) came from the run before this one.

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

## Run it with Claude Code (added after submission)

The hook contract is the same (JSON on stdin with `tool_name` and `tool_input`, exit 2 blocks, the reason on stderr is what the agent reads), so the same `gate/hook.mjs` governs Claude Code's own `Bash`, `Write`, `Edit`, `MultiEdit` and `NotebookEdit` tools. Two files do the work:

1. **`.claude/settings.json`**, the `PreToolUse` and `SessionStart` hooks. Claude Code keeps every native tool with permissions bypassed (`--dangerously-skip-permissions`, or the auto-approve setting of your choice); unauthorised actions just don't run. The agent's own configuration (`.claude/`) is protected like `.bob/`, so the agent cannot edit the hook away.
2. **`CLAUDE.md`**, the same rules as `.bob/rules/01-gate.md`: quote a refusal, name the source file, ask the developer, never rephrase.

```
npm install
node gate/cli.mjs intent "fix issue 004 and run the tests"   # in a terminal the agent does not control
claude --dangerously-skip-permissions "fix issue 004 and run the tests"
```

Measured (the six chores of point 5 on `lukeed/clsx`, ungated against gated, `docs/improvisation.md`, last section): Claude Code on auto with no gate deleted the developer's uncommitted edit in one chore and force-pushed a shared branch in another; with the gate, nothing was lost in six chores, four needed no human, two paused at the fact at stake. The run found three classifier gaps (`sed -n`, a `/tmp` redirect, a `for` loop over reads) and one rule worth changing (an in-progress file whose content is now in a commit or stash is ordinary again); each is fixed with a test. Runner: `scripts/claude-code-run.sh nogate|gated`, then `scripts/claude-code-summary.py <arm>`.

## Added after submission: ask me on my phone (optional)

Built on the last morning, after the lablab.ai form was submitted; the statements, deck and video describe the gate without it.

```
node gate/cli.mjs telegram <bot token>     # once; message your bot first so the gate finds your chat id
```

With that, a refusal no longer ends the task. The hook sends the exact value and its plain consequence to your Telegram, with two buttons. **Approve once** becomes a signed one-shot approval on your machine, scoped to that exact value, ten minutes, consumed by the decision it allows; Bob's call then goes through, no restart. **Deny**, or no answer within four minutes, keeps the refusal, and Bob is told a human said no. The message is written by the gate from its own classification, never by the agent. Not asked: privileged things (the gate's own files, outside the repository, root) and anything already refused this session. `node gate/cli.mjs approve "<command>"` does the same from the terminal. The bot polls Telegram from your machine (no inbound port), listens to your chat id only, and its token lives in the gate's home, which the agent can neither read nor write.

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

- **Repo state is read for paths, not yet for git history.** Deleting or overwriting a named path (`rm`, a redirect, `git clean <paths>`, `git rm`, running a script file) is classified from the repository's state: gitignored, tracked, modified or untracked, plus the developer's in-progress files from the session's start. The git history and discard commands (`reset --hard`, `clean` without paths, `stash`, `checkout --`, `restore`, branch deletion, force-push) are classified from the command text alone, whatever the repository holds. Measured on 740 outside commands (agent-guard-bench holdout19, `docs/eval/`): on a second fixture with a different state, only 12 of 740 decisions changed. Making those git rules read state is in progress.
- Source edits are not governed, except the developer's own in-progress files (those with uncommitted changes when the session started). That is deliberate (editing is what the agent is for) and it is where the one real loss in the sample-project experiments happened.
- The gate classifies commands, never the code they run. `node bench/index.js`, `npm run bench` or an installed binary run when the developer or the maintainers named that file, script or binary; what the code then does is not seen. Test runners have always had this property. Closing it needs an execution sandbox (filesystem and network policy on child processes), which a `PreToolUse` hook cannot provide. Inline code (`node -e`, `python -c`) has no name and is refused; a shell `-c` string is classified as the command it carries.

- The developer intent is a list of positive statements. The gate matches values bounded by whitespace and does not parse negation: "do not run X" states X. Say what you want done, not what you do not.
- Attribution is exact-string provenance, not taint tracking.
- Numeric operands are not governed.
