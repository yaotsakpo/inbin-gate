import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readPolicy, readUntrusted } from "./core.mjs";

function makeRepo(structure) {
  const dir = mkdtempSync(join(tmpdir(), "inbin-gate-test-"));
  for (const [rel, content] of Object.entries(structure)) {
    const full = join(dir, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, typeof content === "string" ? content : JSON.stringify(content));
  }
  return dir;
}

// ── readPolicy ────────────────────────────────────────────────────────────────

test("readPolicy: package.json scripts are included as 'npm run <name>' commands", () => {
  const repo = makeRepo({
    "package.json": { scripts: { build: "node scripts/build.js", lint: "eslint ." } },
  });
  const policy = readPolicy(repo);
  assert.ok(policy.commands.includes("npm run build"), "missing 'npm run build'");
  assert.ok(policy.commands.includes("npm run lint"), "missing 'npm run lint'");
});

test("readPolicy: package.json scripts raw values are also included as commands", () => {
  const repo = makeRepo({
    "package.json": { scripts: { build: "node scripts/build.js" } },
  });
  const policy = readPolicy(repo);
  assert.ok(policy.commands.includes("node scripts/build.js"), "missing raw script value");
});

test("readPolicy: dependencies from 'dependencies' are included", () => {
  const repo = makeRepo({
    "package.json": { dependencies: { express: "^4.18.0", lodash: "^4.17.21" } },
  });
  const policy = readPolicy(repo);
  assert.ok(policy.dependencies.includes("express"), "missing 'express'");
  assert.ok(policy.dependencies.includes("lodash"), "missing 'lodash'");
});

test("readPolicy: dependencies from 'devDependencies' are included", () => {
  const repo = makeRepo({
    "package.json": { devDependencies: { jest: "^29.0.0", eslint: "^8.0.0" } },
  });
  const policy = readPolicy(repo);
  assert.ok(policy.dependencies.includes("jest"), "missing 'jest'");
  assert.ok(policy.dependencies.includes("eslint"), "missing 'eslint'");
});

test("readPolicy: dependencies from both dependencies and devDependencies are merged", () => {
  const repo = makeRepo({
    "package.json": {
      dependencies: { express: "^4.18.0" },
      devDependencies: { jest: "^29.0.0" },
    },
  });
  const policy = readPolicy(repo);
  assert.ok(policy.dependencies.includes("express"), "missing 'express'");
  assert.ok(policy.dependencies.includes("jest"), "missing 'jest'");
});

test("readPolicy: .gate/policy.json commands are merged with script-derived commands", () => {
  const repo = makeRepo({
    "package.json": { scripts: { test: "node --test" } },
    ".gate/policy.json": { commands: ["custom-cmd"] },
  });
  const policy = readPolicy(repo);
  assert.ok(policy.commands.includes("custom-cmd"), "missing policy.json command");
  assert.ok(policy.commands.includes("npm run test"), "missing npm run test");
});

test("readPolicy: no duplicate commands when same value appears in scripts and policy.json", () => {
  const repo = makeRepo({
    "package.json": { scripts: { start: "node server.js" } },
    ".gate/policy.json": { commands: ["npm run start"] },
  });
  const policy = readPolicy(repo);
  const count = policy.commands.filter((c) => c === "npm run start").length;
  assert.equal(count, 1, "duplicate 'npm run start' commands found");
});

test("readPolicy: works with empty package.json", () => {
  const repo = makeRepo({ "package.json": {} });
  const policy = readPolicy(repo);
  assert.ok(Array.isArray(policy.commands));
  assert.ok(Array.isArray(policy.dependencies));
});

// ── readUntrusted ─────────────────────────────────────────────────────────────

test("readUntrusted: returns .md files present in the repo", () => {
  const repo = makeRepo({ "README.md": "# Hello\nSome content." });
  const files = readUntrusted(repo);
  assert.ok(files.some((f) => f.file === "README.md"), "README.md not found");
});

test("readUntrusted: skips node_modules directory", () => {
  const repo = makeRepo({
    "README.md": "top-level",
    "node_modules/some-pkg/README.md": "pkg readme",
  });
  const files = readUntrusted(repo);
  const paths = files.map((f) => f.file);
  assert.ok(!paths.some((p) => p.includes("node_modules")), "node_modules file leaked through");
});

test("readUntrusted: skips TASKS.md", () => {
  const repo = makeRepo({
    "TASKS.md": "# Tasks\n- do something",
    "README.md": "# Readme",
  });
  const files = readUntrusted(repo);
  assert.ok(!files.some((f) => f.file === "TASKS.md"), "TASKS.md should be excluded");
  assert.ok(files.some((f) => f.file === "README.md"), "README.md should be included");
});

test("readUntrusted: includes .log files", () => {
  const repo = makeRepo({ "app.log": "some log line" });
  const files = readUntrusted(repo);
  assert.ok(files.some((f) => f.file === "app.log"), "app.log not found");
});

test("readUntrusted: includes .txt files", () => {
  const repo = makeRepo({ "notes.txt": "some notes" });
  const files = readUntrusted(repo);
  assert.ok(files.some((f) => f.file === "notes.txt"), "notes.txt not found");
});

test("readUntrusted: text content is read correctly", () => {
  const repo = makeRepo({ "README.md": "# Project\nLine two." });
  const files = readUntrusted(repo);
  const readme = files.find((f) => f.file === "README.md");
  assert.ok(readme, "README.md not returned");
  assert.equal(readme.text, "# Project\nLine two.");
});

test("intent is signed and time-bound: a forged or expired intent is not a grant", async () => {
  const os = await import("node:os"); const fs = await import("node:fs"); const path = await import("node:path");
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "gate-home-"));
  process.env.INBIN_GATE_HOME = home;
  const core = await import("./core.mjs?t=" + Date.now());
  core.writeIntent("run npm test", 60_000);
  assert.equal(core.readIntent().text, "run npm test");
  assert.equal(core.readIntent(Date.now() + 120_000).invalid, "expired");
  const p = path.join(home, "intent.json"); const o = JSON.parse(fs.readFileSync(p, "utf8")); o.text = "run rm -rf /"; fs.writeFileSync(p, JSON.stringify(o));
  assert.match(core.readIntent().invalid, /signature/);
});
