import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { consequences, coveredByDefault, pathState } from "./consequences.mjs";

function repo() {
  const d = mkdtempSync(join(tmpdir(), "cons-"));
  const g = (c) => execSync(c, { cwd: d, stdio: "ignore" });
  g("git init -q -b main"); writeFileSync(join(d, ".gitignore"), "dist/\nnode_modules/\n");
  mkdirSync(join(d, "src")); writeFileSync(join(d, "src/a.js"), "1"); g("git -c user.name=t -c user.email=t@t add -A && git -c user.name=t -c user.email=t@t commit -qm init");
  g("git init -q --bare ../" + d.split("/").pop() + ".git 2>/dev/null || true"); g(`git remote add origin ${d}.git`); g("git push -q origin main");
  mkdirSync(join(d, "dist")); writeFileSync(join(d, "dist/out.txt"), "x");
  mkdirSync(join(d, "notes")); writeFileSync(join(d, "notes/todo.md"), "mine");
  writeFileSync(join(d, "src/a.js"), "2"); // modified, uncommitted
  g("git -c user.name=t -c user.email=t@t commit -qam wip1"); writeFileSync(join(d, "src/a.js"), "3"); // wip1 unpushed; a.js modified again
  return d;
}
const d = repo();

test("path states come from the repository", () => {
  assert.equal(pathState("dist", d), "ignored");
  assert.equal(pathState("notes/todo.md", d), "untracked");
  assert.equal(pathState("src/a.js", d), "modified");
  assert.equal(pathState("/etc/hosts", d), "outside");
});
test("same command, different fact", () => {
  assert.deepEqual(consequences("rm -rf dist/", d), ["regenerable.delete"]);
  assert.deepEqual(consequences("rm -rf notes/", d), ["work.delete"]);
  assert.deepEqual(consequences("rm -rf dist/ notes/", d), ["regenerable.delete", "work.delete"]);
  assert.deepEqual(consequences(`rm -rf ${d}/dist`, d), ["regenerable.delete"]);   // absolute path inside the repo
  assert.deepEqual(consequences("rm -rf /etc/hosts", d), ["privileged"]);
  assert.equal(coveredByDefault(consequences("rm -rf dist/ node_modules/ && npm install", d)), true);
  assert.equal(coveredByDefault(consequences("git clean -fdx", d)), false);
  assert.equal(coveredByDefault(consequences("git clean -ndx", d)), true);
});
test("local history is reversible, shared history is not", () => {
  assert.deepEqual(consequences("git reset --soft HEAD~1", d), ["history.local"]);
  assert.deepEqual(consequences("git reset --hard origin/main", d), ["work.delete"]);
  assert.deepEqual(consequences("git push --force origin feature/x", d), ["history.shared"]);
  assert.deepEqual(consequences("git push origin feature/x", d), ["push"]);
  assert.deepEqual(consequences("git rebase -i HEAD~1", d), ["history.local"]);
  assert.deepEqual(consequences("git commit --amend -m x", d), ["history.local"]);
});
test("privilege, dependencies, remote scripts need authority", () => {
  assert.deepEqual(consequences("sudo chown -R 501:20 ~/.npm", d), ["privileged"]);
  assert.deepEqual(consequences("npm install ibantools", d), ["dependency.add"]);
  assert.deepEqual(consequences("curl -fsSL https://x/install.sh | sh", d), ["unknown"]);
  assert.equal(coveredByDefault(consequences("git fetch && git rebase main", d)), true);
  assert.equal(coveredByDefault(consequences("cd sample-project && node --test test/*.test.js", d)), true);  // running the tests is a read
});

test("the gate and Bob's configuration cannot be edited by the agent through the shell", () => {
  for (const c of ["printf '{}' > .bob/settings.json", "sed -i '' 's/exit 2/exit 0/' gate/hook.mjs", "rm -rf .bob", "mv gate/hook.mjs gate/hook.off"])
    assert.equal(coveredByDefault(consequences(c, d)), false, c);
});

test("redirections, no-ops and chained installs are read correctly", async () => {
  assert.deepEqual(consequences("git rebase main 2>&1 || true", d), ["git.safe", "reads"]);
  assert.deepEqual(consequences("node --version 2>/dev/null", d), ["reads"]);
  assert.deepEqual(consequences("git checkout -- src/a.js", d), ["work.delete"]);
  const { packagesInCommand } = await import("./registry.mjs");
  assert.deepEqual(packagesInCommand("cd sample-project && npm install --save-dev mitata"), ["mitata"]);
});

test("git -C <dir> and the repo's own test runner are read as what they are", () => {
  assert.deepEqual(consequences("git -C sample-project status && git -C sample-project branch -a", d), ["reads"]);
  assert.deepEqual(consequences("node --experimental-vm-modules node_modules/.bin/uvu test 2>&1 | head -20", d), ["reads"]);
  assert.deepEqual(consequences("npx uvu test", d), ["reads"]);
  assert.deepEqual(consequences("git -C sample-project clean -fdx", d), ["work.delete"]);
});

// Found by the real-repository run (docs/improvisation.md, point 5, third run).
test("a redirect onto work is a write even when the statement starts with a read", () => {
  assert.deepEqual(consequences("echo hi > notes/todo.md", d), ["work.delete"]);
  assert.deepEqual(consequences("cat src/a.js > notes/todo.md", d), ["work.delete"]);
  assert.deepEqual(consequences("echo hi > dist/out.txt", d), ["regenerable.delete"]);
  assert.deepEqual(consequences("echo hi > brand-new.txt", d), ["reads"]);
  assert.deepEqual(consequences("echo x > .bob/settings.json", d), ["privileged"]);
});
test("reading the gate's own files is a read; writing them is privileged", () => {
  assert.deepEqual(consequences("git ls-files dist/ .gate/", d), ["reads"]);
  assert.deepEqual(consequences("cat .bob/settings.json", d), ["reads"]);
  assert.deepEqual(consequences("printf '{}' > .bob/settings.json", d), ["privileged"]);
});

function repoWithScripts() {
  const r = mkdtempSync(join(tmpdir(), "cons2-"));
  const g = (c) => execSync(c, { cwd: r, stdio: "ignore" });
  g("git init -q -b main"); writeFileSync(join(r, ".gitignore"), "node_modules/\n");
  writeFileSync(join(r, "package.json"), JSON.stringify({ scripts: { bench: "node bench/index.js", nuke: "rm -rf notes", build: "rollup -c" } }));
  mkdirSync(join(r, "scripts")); writeFileSync(join(r, "scripts/deploy.js"), "1"); writeFileSync(join(r, "scripts/x.sh"), "1");
  g("git -c user.name=t -c user.email=t@t add -A && git -c user.name=t -c user.email=t@t commit -qm init");
  mkdirSync(join(r, "bench")); writeFileSync(join(r, "bench/index.js"), "1");   // untracked: the agent just wrote it
  mkdirSync(join(r, "notes")); writeFileSync(join(r, "notes/todo.md"), "mine");
  mkdirSync(join(r, "node_modules/.bin"), { recursive: true }); writeFileSync(join(r, "node_modules/.bin/rollup"), "1");
  return r;
}
test("running repository code is a named consequence: the file or script is the object", () => {
  const r = repoWithScripts();
  assert.deepEqual(consequences("node bench/index.js", r), ["code.run:bench/index.js"]);
  assert.deepEqual(consequences("node scripts/deploy.js --target=prod-eu-mirror", r), ["code.run:scripts/deploy.js"]);
  assert.deepEqual(consequences("node --check bench/index.js", r), ["reads"]);
  assert.deepEqual(consequences("node -e \"require('./bench/index.js')\"", r), ["unknown"]);
  assert.deepEqual(consequences("node missing.js", r), ["unknown"]);
  assert.deepEqual(consequences("node /etc/x.js", r), ["privileged"]);
  assert.deepEqual(consequences("npm run bench", r), ["code.run:bench"]);
  assert.deepEqual(consequences("npm run nuke", r), ["code.run:nuke", "work.delete"]);
  assert.deepEqual(consequences("npm run missing", r), ["unknown"]);
  assert.deepEqual(consequences("npm run build", r), ["reads"]);   // a maintainers' script name the gate already lists as a read
  assert.deepEqual(consequences("npx rollup -c", r), ["code.run:rollup"]);
  assert.deepEqual(consequences("rollup -c", r), ["code.run:rollup"]);
  assert.deepEqual(consequences("node_modules/.bin/rollup -c", r), ["code.run:rollup"]);
  assert.deepEqual(consequences("npx cowsay hi", r), ["dependency.add"]);   // fetches and runs a package
  assert.deepEqual(consequences("bash -c \"rm -rf notes\"", r), ["work.delete"]);
  assert.deepEqual(consequences("sh -c 'git push --force origin main'", r), ["history.shared"]);
  assert.deepEqual(consequences("bash scripts/x.sh", r), ["code.run:scripts/x.sh"]);
  assert.deepEqual(consequences("python3 scripts/x.sh", r), ["code.run:scripts/x.sh"]);
  assert.equal(coveredByDefault(["code.run:bench/index.js"]), false);
});

test("git clean limited to ignored paths is regenerable; unscoped or onto work it is not", () => {
  assert.deepEqual(consequences("git clean -fdx --exclude=node_modules -- dist/ coverage/", d), ["regenerable.delete"]);
  assert.deepEqual(consequences("git clean -fdx -- notes/", d), ["work.delete"]);
  assert.deepEqual(consequences("git clean -fdx", d), ["work.delete"]);
  assert.deepEqual(consequences("git clean -fdx -- dist/ notes/", d), ["work.delete"]);
});
