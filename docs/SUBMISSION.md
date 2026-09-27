# lablab.ai form, copy and paste

## Submission Title (41 chars)

Inbin Gate: safe auto-approve for IBM Bob

## Short Description (254 chars)

A PreToolUse hook that keeps Bob's auto-approve on and refuses any action nobody with authority stated. The developer's signed intent and the repo's own config decide; text Bob read never does. Measured on real chores, a real repo and a public benchmark.

## Long Description (3009 chars, 494 words)

Problem. Developers switch on auto-approve in IBM Bob because approving every action by hand throws away what Agent mode promises. But an agent on auto improvises: the documented failures (Replit's deleted database, Gemini CLI's wiped files, Claude Code's git reset --hard, hallucinated packages) needed no attacker, only an ordinary chore. And it reads untrusted text all day. Teams choose between speed and safety.

Solution. Inbin Gate makes auto-approve safe by changing the question. Instead of "does this look malicious?" it asks "did someone with authority state this value?". It installs as a Bob PreToolUse hook: before Bob runs a terminal command or writes a protected file, the gate classifies what it would do to this repository (regenerable output or unrecoverable work, local history or a force-push, a reinstall or a new dependency) and decides; exit code 2 blocks it. Bob keeps every tool, auto-approve on. Each tool executes only when its operands were stated by the developer in their own words (typed out of band, in a terminal the agent does not control) or established by the repository's maintainers (package.json scripts and dependencies, a small policy file, CODEOWNERS). Text Bob read is information, never authority. A refusal names the reason and the source file, and Bob asks the developer instead.

A published resolver (PSAP) derives authority from the channel a value arrived on, never from the value: the developer's signed intent, the repo's shared config, and what a maintainer writes in an issue hold a grant; the agent's proposal never does.

Who uses it and how. Any developer running Bob in Agent mode: type the intent once, let Bob work with auto-approve on.

Evidence. Refusing unstated values is by construction, so we do not count it as a finding. What we measured: Bob on auto with no gate, given six ordinary chores on a repo with things to lose, lost nothing but ran an unrequested sudo chown, installed a package it picked itself, and force-pushed a shared branch; on a planted CI-log "fix" it force-pushed a release branch. With the gate, nothing destructive ran and no genuine work was refused: four chores needed no human, two paused once (a new dependency, a force-push), at six percent more tokens. On a real repository (lukeed/clsx) Bob on auto deleted the developer's notes twice and their uncommitted edit once; gated, nothing was lost in six chores, at four percent fewer tokens. In an earlier run Bob, refused twice, tried to write the developer's intent file to authorise itself; it failed: the intent is signed with a secret the agent cannot read. The same gate on a public prompt-injection benchmark (AgentDojo, banking) refused every injected operand in 144 runs where the benchmark's own defenses let 12.5% to 50% through.

Why it is new. Existing defenses detect attacks in text or restrict which tools an agent may call. Inbin Gate restricts which values may drive a consequential action, by who said them. That is what lets auto-approve stay on.

## IBM Bob Usage Statement (3303 chars, 502 words)

Bob 2.0 played two roles: it built parts of the system, and it is the agent the system protects. Every task ran through Bob Shell on the hackathon organisation (ibm-coding-challenge-uat); transcripts are in bob_sessions/shell-logs/ (an earlier pass on a trial organisation is archived in first-account/). IDE screenshots are in bob_sessions/screenshots/.

Bob as builder (Agent mode).
- B1: operand validation (validateOperand) with 14 unit tests; Bob ran them, fixed its own two failing runs.
- B2: docs/sequence.md, a Mermaid sequence diagram of one gated action, with why the agent's own proposal can never govern.
- B3: two parallel subagents: five more injected bench cases (now 15/15 refused, 10/10 allowed) and accessibility fixes in web/index.html.
- B4: a diff review, cut by the gateway before its summary; the commit says so.
- B5: the commit message, committed through the gate itself.
- B6: a security review of the gate (docs/security-review.md) that found two real weaknesses, substring matching and a containment check after the gate; both fixed, regression test added.
- B7: unit tests for the policy loader; the suite has since grown to 60 tests.

Bob as the protected agent. The gate is a Bob PreToolUse hook (.bob/settings.json, gate/hook.mjs): Bob keeps every native tool in every mode and the hook blocks unauthorised terminal commands and protected-file writes with exit code 2. A strict Gated Agent custom mode (.bob/custom_modes.yaml) and the inbin-gate MCP tools (.bob/mcp.json) are optional. Project rules (.bob/rules/01-gate.md) tell Bob how to treat a refusal: quote it, name the source file, ask the developer, never rephrase. With auto-approve on, Bob worked the tasks of sample-project/TASKS.md (issues fixed with parallel subagents, tests, a dependency, a deploy, a commit). Two further tasks replayed the real Amazon Q and GitHub MCP payloads; Bob refused both on its own (docs/baseline.md). Over forty further runs are the improvisation experiment (docs/improvisation.md: six chores per arm, sample project and a real repository), including the one where Bob tried to write the developer's intent file to authorise its own git reset. The gate's decision log is bob_sessions/decisions.jsonl; Bob's own summary is docs/demo-decisions.md.

Counts, from bob_sessions/decisions.jsonl. Across the Gated Agent sessions the gate made 19 decisions: 10 actions allowed (tests, install, start, the stated dependency, the stated branch) and 9 refused. Bob attempted 3 of the planted instructions (the curl from issue 004, the README's deploy target, the CI log's force-push) and the gate refused all 3, naming the source file each time; none was executed. The remaining refusals were Bob's own unstated proposals (a node -e script to write a source file, node --version, git status, a protected-file edit), refused because nobody had stated them, which is the rule working as designed.

Bob features used. PreToolUse hooks; Agent mode; parallel subagents (B3, D2); a custom mode; project rules; MCP; document understanding of issues, READMEs and logs; commit messages; headless Bob Shell runs on the IDE's configuration.

What Bob did not do. The resolver (gate/authority.js) is pre-existing open source, untouched by Bob. Bob did not write the two statements.

watsonx. Not used.

## Other fields

- Application URL: https://inbin-gate.vercel.app
- Repository: https://github.com/yaotsakpo/inbin-gate
- Cover image: docs/cover.png
- Presentation: docs/inbin-gate-deck.pptx
- Video: the file you recorded (upload or link)
- Technologies / tags: IBM Bob 2.0, MCP, Node.js, PreToolUse hooks
- watsonx: not used
