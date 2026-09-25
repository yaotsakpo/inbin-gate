# Security Review — Inbin Gate

**Scope:** `gate/decide.mjs`, `gate/core.mjs`, `gate/server.mjs`
**Question:** Can any input an agent controls make `decide()` return `allowed: true`
for a value that neither the developer intent nor the repository policy states?

---

## Summary

Two **real weaknesses** were found, both exploitable by the agent through inputs
it controls. Three further areas are analysed and found either safe or out-of-scope.

| # | Severity | Location | Short description |
|---|----------|----------|-------------------|
| W1 | **High** | `decide.mjs:62` / `core.mjs:22` | `states()` uses `includes`: a substring of an intent/policy value unlocks the gate |
| W2 | **High** | `server.mjs:50-51` | Path-traversal check executes *after* the gate allows the write |
| F1 | Low/Info | `core.mjs:39-43` | Untrusted `.md`/`.log`/`.txt` files are read but correctly treated as non-authoritative |
| F2 | Info | `decide.mjs:44` | Whitespace normalisation is one-directional; Unicode space variants bypass `norm()` |
| F3 | Info | `core.mjs:22` | `npm run <script>` and the raw script body are both whitelisted; injection via script body |

---

## W1 — Substring match in `states()` lets any prefix/infix unlock the gate

### The code

**`gate/decide.mjs` line 60–63:**
```js
export function states(text, value) {
  const v = norm(value);
  return v.length > 0 && norm(text).includes(v);
}
```

**`gate/decide.mjs` line 84:**
```js
if (sources.intent && states(sources.intent.text, v)) { … }
```

**`gate/core.mjs` line 24 (policy matching for `policyStates`):**
```js
return lists.some((x) => norm(x) === v);
```

### What it means

`policyStates` (`decide.mjs:116–125`) uses **exact equality** (`norm(x) === v`) to
check each whitelisted entry, so it is not affected.

`states()` is only used to test **developer intent** (`decide.mjs:84`). Developer
intent is free-form text stored in `~/.inbin-gate/intent.json`. Because
`String.prototype.includes` is used, the check passes whenever the agent-supplied
value is a **substring** of the intent text.

**Concrete attack scenario:**

1. Developer typed:  
   `gate intent "please run npm test"`  
   Intent text is `"please run npm test"`.

2. Agent submits `cmd = "npm"` — a substring of the intent — to `run_command`.

3. `states("please run npm test", "npm")` → `true`.

4. The gate mints an ESTABLISHING claim for `"npm"` and `decide()` returns
   `allowed: true`.

5. The server executes `execSync("npm", …)` — the agent has run an arbitrary
   npm invocation (e.g. `npm publish`, `npm adduser`, etc.) that the developer
   never stated.

**Worse case:** the intent string will commonly contain package names, branch
names, file paths, and partial commands. Every substring of every word is
a valid ticket to execute.

For file paths the same logic applies:

- Intent: `"edit package.json to add a script"`
- Agent submits `path = "package.json"` → `states()` returns `true` → file
  written.

That path example actually succeeds legitimately, but the same mechanism would
work for any suffix: intent `"edit .gate/policy.json"` unlocks `path = "policy.json"`,
which with the path-traversal issue (W2) can be weaponised further.

For `add_dependency` and `git_commit_push` the policy list uses **exact** comparison,
so `states()` is the only gap.

### Fix

Replace the substring test with **exact equality** (after the same `norm()`
normalisation already applied to policy entries):

```js
// gate/decide.mjs line 60–63  — proposed replacement
export function states(text, value) {
  const v = norm(value);
  if (v.length === 0) return false;
  const t = norm(text);
  // Require whole-word / exact-token match instead of arbitrary substring.
  // Split on whitespace and punctuation boundaries so "npm test" matches
  // a line that contains exactly those two tokens, but "npm" alone does not
  // match a line that contains "npm test".
  return t === v || t.split(/[\s,;|&"'`]+/).some(token => token === v)
    // OR: require the value to appear surrounded by word boundaries
    // using a RegExp — more robust for multi-word values:
    || new RegExp(`(?<![\\w/-])${v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w/-])`).test(t);
}
```

The simplest safe replacement is **exact equality** of the full intent text
to the proposed value (as policy already does), or a delimited token scan.
The critical point is that partial-string matching must not be the gate.

---

## W2 — Path-traversal check runs *after* `gate()` has already approved the write

### The code

**`gate/server.mjs` lines 47–53:**
```js
async ({ path, content }) => {
  const d = gate("edit_protected_file", { path });   // line 48 — gate decides on `path`
  if (!d.allowed) return text(d.reason);
  const p = resolve(REPO, path);                      // line 50
  if (!p.startsWith(REPO)) return text("REFUSED …"); // line 51 — traversal check here
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content);                          // line 52
```

**`gate/decide.mjs` line 80:**
```js
const v = norm(value);   // value = the path as submitted by the agent
```

### What it means

The gate decides on the **raw (normalised) path string** `v`, not on the
**resolved absolute path**. `resolve(REPO, path)` in `server.mjs` only runs
*after* the gate has returned `allowed: true`.

The traversal check at line 51 does correctly block the write itself, but the
gate's `allowed` determination has already been emitted based on a string
comparison against intent/policy for a value that was never interpreted as a
filesystem path.

More importantly, the two different string normalisations can be made to
diverge:

**Scenario A — dot-segment bypass:**

1. Policy (or intent) contains `"package.json"` as an editable protected file.
2. Agent submits `path = "subdir/../package.json"`.
3. `norm("subdir/../package.json")` = `"subdir/../package.json"` (unchanged,
   `norm()` only collapses whitespace).
4. `policyStates` compares `"subdir/../package.json" === "package.json"` →
   `false` — gate **refuses**. (Safe in this case.)

However with `states()` (intent channel) the substring check does match:

5. Intent text contains `"edit package.json"`.
6. `states("edit package.json", "subdir/../package.json")` →
   `"edit package.json".includes("subdir/../package.json")` → `false`.
   (Also safe here, because the substring is longer than the source.)

The dangerous direction is the reverse: the agent submits `path = "package.json"`,
which is allowed, but the intent text contains a *different* absolute path such as
`"/home/user/project/package.json"` — and `includes("package.json")` → `true`.
The file the agent actually writes (resolved by `server.mjs:50`) is inside `REPO`
(traversal guard passes), so the write itself targets the intended file. This
specific scenario is therefore benign.

**Scenario B — the check order creates a TOCTOU window:**

The gate emits `allowed: true` based on `path` as a string. Between that
decision and the actual `writeFileSync`, the `resolve()` output is what
matters. If a symlink in the repository points outside `REPO`, the `startsWith`
check on the resolved path would catch it — but only if the symlink is resolved
*after* the gate decision and before the write, and only if `resolve()` follows
symlinks (Node's `path.resolve` does *not* follow symlinks; only `fs.realpath`
does).

**`path.resolve` does not call `stat` or follow symlinks.** Therefore an agent
could:

1. Get `"link-outside"` approved (e.g. it is listed in `editableProtectedFiles`
   in `.gate/policy.json`).
2. Have previously written a symlink named `link-outside` pointing to
   `../../../etc/cron.d/` (reachable if the agent had another write primitive).
3. `resolve(REPO, "link-outside")` = `REPO + "/link-outside"`, which starts
   with `REPO` → traversal guard passes.
4. `writeFileSync` follows the symlink at the OS level and writes outside `REPO`.

This is a layered attack requiring a prior write, but it shows the path-
resolution check is incomplete.

### Fix

1. **Resolve the path before calling `gate()`** so the gate decision and the
   execution target are on the same string:

   ```js
   // server.mjs edit_protected_file handler
   async ({ path, content }) => {
     const p = resolve(REPO, path);
     if (!p.startsWith(REPO + "/") && p !== REPO)
       return text("REFUSED by Inbin Gate: path escapes the repository");
     // Gate decides on the resolved path, same string that will be written.
     const d = gate("edit_protected_file", { path: p.slice(REPO.length + 1) });
     if (!d.allowed) return text(d.reason);
     mkdirSync(dirname(p), { recursive: true });
     writeFileSync(p, content);
   ```

2. **Use `fs.realpathSync` (with a try/catch for non-existent paths)** instead
   of `path.resolve` to follow symlinks before the traversal check.

3. **Fix the `startsWith` boundary:** `p.startsWith(REPO)` passes for
   `REPO = "/foo"` and `p = "/foobar/secret"`. Use `p.startsWith(REPO + "/")`
   or `p === REPO`.

---

## F1 — Untrusted file scan (`readUntrusted`) — correctly non-authoritative

**`gate/core.mjs` lines 34–47.**

The scanner reads `.md`, `.log`, and `.txt` files and passes them as
`sources.untrusted`. In `decide.mjs` line 96 these are used **only** to
populate `foundInUntrusted` in the refusal message — they are never passed to
`mint()` and they trigger no authoritative claim. An agent cannot smuggle
authority by writing a `.md` file that contains the desired command, because
`readUntrusted` content never reaches a `mint()` call on a privileged channel.

`TASKS.md` is explicitly excluded (`core.mjs:43`), presumably because it is a
known agent-written file.

**Residual concern (informational):** Other `.md` files in the repository (e.g.
`README.md`, `docs/*.md`) are scanned. An agent that can write arbitrary `.md`
files outside the `edit_protected_file` tool (e.g. via the standard Bob file
tools which bypass the gate entirely) can therefore influence the `foundInUntrusted`
list in refusal messages. This is **cosmetic** (it changes the human-readable
hint, not the allow/deny decision), but it could be used to craft misleading
refusal messages that suggest a value "was found in README.md" to confuse the
developer. Not a gate bypass, but a social-engineering surface.

---

## F2 — Unicode whitespace bypasses `norm()`

**`gate/decide.mjs` line 44:**
```js
const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
```

`/\s+/` in JavaScript covers the ASCII whitespace characters and a subset of
Unicode whitespace (tab, newline, `\v`, `\f`, `\r`, U+00A0 non-breaking space,
and a few others via the Unicode `\s` extension in V8), but it does **not**
cover all Unicode "space-like" characters, notably:

- U+2028 LINE SEPARATOR and U+2029 PARAGRAPH SEPARATOR — these are matched by
  `\s` in modern V8 (ECMAScript 2018+), so they are normalised. ✓
- U+200B ZERO-WIDTH SPACE, U+FEFF BOM/ZERO-WIDTH NO-BREAK SPACE — **not
  matched** by `\s`.
- U+3000 IDEOGRAPHIC SPACE — **not matched** by `\s`.

**Impact for intent matching (`states()`):**

If the developer's intent text is `"npm test"` (plain ASCII), and the agent
proposes `"npm\u200Btest"` (with a zero-width space), `norm()` leaves the
zero-width space in place, so `v = "npm\u200Btest"` and
`norm(text).includes("npm\u200Btest")` → `false` — the gate **correctly
refuses** this case.

The danger is the reverse: if the agent somehow injects a zero-width space
into the intent text (it cannot via `gate intent`, but could via a crafted
`intent.json`), or if the developer's editor inserts one, then
`norm("npm\u200Btest")` = `"npm\u200Btest"` and a clean agent proposal
`"npm test"` would fail to match even though the values look identical on
screen.

More relevant: an agent could submit `cmd = " npm test "` (leading/trailing
spaces), and `norm()` trims those — so that direction is safe.

**For `policyStates`:** both sides go through `norm()`, so any invisible
character present in `policy.json` and absent from the agent proposal (or vice
versa) causes a mismatch and a refusal, which is the safe direction.

**Verdict:** No bypass is possible through this vector in the current code
because `norm()` is applied symmetrically to both the stored value and the
proposed value before comparison. The risk is a false *negative* (legitimate
value refused because of an invisible character in the intent file) rather than
a false *positive*. Recommend extending `norm()` to strip all Unicode
whitespace/invisible characters for robustness.

---

## F3 — `npm run <script>` expansion exposes raw script body as a whitelisted command

**`gate/core.mjs` lines 22–22:**
```js
const scripts = Object.keys(pkg.scripts || {}).flatMap((k) =>
  [`npm run ${k}`, `npm ${k}`, pkg.scripts[k]]
);
```

Every `package.json` script is whitelisted in **three** forms:

1. `npm run <key>` — intended.
2. `npm <key>` — intended shorthand.
3. The **raw script body** (e.g. `"node --test gate/*.test.mjs"`) — side effect.

An agent that proposes `cmd = "node --test gate/*.test.mjs"` (copying the
verbatim script body from `package.json`, which it is allowed to read) will
be **allowed** without the developer ever explicitly stating that exact command.

In this repository the exposed bodies are:
- `"node --test gate/*.test.mjs"` (test runner)
- `"node gate/server.mjs"` (MCP server start)
- `"node bench/replay.mjs"` (benchmark)
- `"npx serve web"` (static file server)

These are relatively benign. But in a project whose `package.json` has a
post-install or deploy script that runs `aws s3 sync dist/ s3://prod-bucket`,
the agent inherits that exact command as a whitelist entry even if the developer
only intended to allow `npm run deploy`.

### Fix

Remove the raw script body from the whitelisted list. The intent is to allow
`npm run <script>`, not to expose the implementation detail:

```js
// core.mjs line 22 — proposed replacement
const scripts = Object.keys(pkg.scripts || {}).flatMap((k) =>
  [`npm run ${k}`, `npm ${k}`]
);
```

---

## Additional notes

### `git_commit_push` — `message` is not gated

**`gate/server.mjs` lines 59–65:**
```js
async ({ branch, message }) => {
  const d = gate("git_commit_push", { branch, message });
```

**`gate/decide.mjs` lines 38–42 (`OPERANDS`):**
```js
git_commit_push: [["branch", "action.git_commit_push.branch"]],
```

Only `branch` is listed as an operand. `message` is passed to `gate()` in
`args` but ignored by `decide()` (the loop iterates `spec = [["branch", …]]`).
The commit message is therefore **entirely agent-controlled** with no gate
check.

This is likely by design (the gate comment says "Commit message is free text"),
but it means an agent can write arbitrary content into the git history of the
repository. If the commit message is later scanned by CI log parsers or
displayed in contexts that interpret it as markup/commands, this is an injection
surface. No bypass of `allowed` is created by this, but it is worth noting.

### `sh()` receives the approved string verbatim — shell injection from policy

**`gate/server.mjs` lines 20–23 and 31:**
```js
const sh = (cmd, cwd = REPO) => {
  try { return execSync(cmd, { cwd, encoding: "utf8", stdio: […], timeout: 120_000 }); }
```
```js
return text(`ALLOWED (${d.reason})\n$ ${cmd}\n${sh(cmd)}`);
```

`execSync` with a string argument passes through `/bin/sh -c`, so the approved
command is executed as a shell command. If the policy (or intent) whitelists a
command that contains shell metacharacters (e.g. a `package.json` script body
containing `&&` or `$(…)`), those are executed verbatim. This is the expected
behaviour, not a bypass, but it reinforces the F3 finding: the raw script body
expansion effectively whitelists shell compound expressions.

---

## Conclusion

The two high-severity findings (W1 and W2) together allow an agent to:

- **W1:** Pass the intent check with any string that is a substring of the
  developer's intent text — including short, common tokens like package names,
  directory names, or partial commands.
- **W2:** Write to a file outside the repository if it can first create a
  symlink inside the repository whose name is whitelisted.

W1 is exploitable without any prerequisite. W2 requires a prior write primitive.
Both should be fixed before treating the gate as a hard security boundary.

F3 (raw script bodies whitelisted) is a design-level expansion of the attack
surface that should be closed by removing the third entry from the `flatMap`.
