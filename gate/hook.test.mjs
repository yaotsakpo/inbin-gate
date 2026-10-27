import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync, execSync } from "node:child_process";

const HOOK = new URL("./hook.mjs", import.meta.url).pathname;

/** A workspace holding a small git repository with an untracked notes file (work to lose). */
function makeWorkspace() {
  const ws = mkdtempSync(join(tmpdir(), "inbin-gate-hook-"));
  const repo = join(ws, "sample-project");
  mkdirSync(join(repo, "src"), { recursive: true });
  writeFileSync(join(repo, "package.json"), JSON.stringify({ name: "fx", scripts: { test: "node test.js" } }));
  writeFileSync(join(repo, "src", "index.js"), "module.exports = 1;\n");
  execSync("git init -q . && git add -A && git -c user.name=t -c user.email=t@x commit -qm init", { cwd: repo });
  mkdirSync(join(repo, "notes")); writeFileSync(join(repo, "notes", "todo.md"), "never committed\n");
  return { ws, repo, home: join(ws, ".gate-home") };
}

function runHook({ ws, repo, home }, payload) {
  return spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify(payload), encoding: "utf8",
    env: { ...process.env, INBIN_GATE_WORKSPACE: ws, INBIN_GATE_REPO: repo, INBIN_GATE_HOME: home, INBIN_GATE_TELEGRAM: "" },
  });
}

test("Claude Code: a Bash command that would delete untracked work is refused with the gate's reason", () => {
  const r = runHook(makeWorkspace(), { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "rm -rf notes", description: "clean up" } });
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /REFUSED by Inbin Gate/);
});

test("Claude Code: a read-only Bash command passes", () => {
  const r = runHook(makeWorkspace(), { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "git status" } });
  assert.equal(r.status, 0, r.stderr);
});

test("Claude Code: writing the agent's own hook configuration (.claude/) is refused", () => {
  const w = makeWorkspace();
  const r = runHook(w, { hook_event_name: "PreToolUse", tool_name: "Write", tool_input: { file_path: join(w.ws, ".claude", "settings.json"), content: "{}" } });
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /REFUSED by Inbin Gate/);
});

test("Claude Code: an ordinary Edit of a clean tracked source file passes", () => {
  const w = makeWorkspace();
  const r = runHook(w, { hook_event_name: "PreToolUse", tool_name: "Edit", tool_input: { file_path: join(w.repo, "src", "index.js"), old_string: "1", new_string: "2" } });
  assert.equal(r.status, 0, r.stderr);
});

test("Bob's tool names still map (regression)", () => {
  const r = runHook(makeWorkspace(), { hook_event_name: "PreToolUse", tool_name: "execute_command", tool_input: { command: "rm -rf notes" } });
  assert.equal(r.status, 2, r.stderr);
});

/** A workspace whose repo has a tracked file with an uncommitted edit (work in progress) at session start. */
function makeWorkspaceWithWip() {
  const w = makeWorkspace();
  writeFileSync(join(w.repo, "src", "index.js"), "module.exports = 1;\n// TODO(dev): uncommitted\n");
  runHook(w, { hook_event_name: "SessionStart", source: "startup" });
  return w;
}
const editIndex = (w) => runHook(w, { hook_event_name: "PreToolUse", tool_name: "Edit", tool_input: { file_path: join(w.repo, "src", "index.js"), old_string: "1", new_string: "2" } });

test("an Edit of a file holding the developer's uncommitted work is refused", () => {
  const r = editIndex(makeWorkspaceWithWip());
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /uncommitted work/);
});

// Found by the Claude Code run (R2): the agent committed the developer's edit, then rebased and could not
// resolve the conflict, because the file was still on the session baseline. Once the baseline content is
// in a commit (or a stash) there is another copy, and the protection has done its job.
test("once the baseline content is committed, the file is ordinary again", () => {
  const w = makeWorkspaceWithWip();
  execSync("git -c user.name=t -c user.email=t@x commit -qam 'wip 4'", { cwd: w.repo });
  writeFileSync(join(w.repo, "src", "index.js"), "<<<<<<< HEAD\nconflict\n>>>>>>> x\n"); // a rebase conflict leaves it modified
  const r = editIndex(w);
  assert.equal(r.status, 0, r.stderr);
});

test("once the baseline content is stashed, the file is ordinary again", () => {
  const w = makeWorkspaceWithWip();
  execSync("git -c user.name=t -c user.email=t@x stash -q && echo changed >> src/index.js", { cwd: w.repo });
  assert.equal(editIndex(w).status, 0);
});
