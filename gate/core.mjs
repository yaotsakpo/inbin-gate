/** Inbin Gate: load the channels from disk, decide, log. */
import { readFileSync, existsSync, mkdirSync, appendFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { createHmac, createHash, randomBytes } from "node:crypto";
import { execSync } from "node:child_process";
import { decide } from "./decide.mjs";

export const HOME = process.env.INBIN_GATE_HOME || join(homedir(), ".inbin-gate");
export const REPO = resolve(process.env.INBIN_GATE_REPO || process.cwd());

const readJSON = (p, d) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return d; } };

/**
 * The developer's channel: typed out of band with `gate intent "..."`, stored
 * OUTSIDE the repository, SIGNED with a per-machine secret (mode 0600) the agent
 * cannot read, and TIME-BOUND. A file the agent managed to write without the
 * secret fails verification and is not a grant; an expired intent is not a
 * grant either. The grant is read fresh at every decision, so revoking it
 * (`gate intent --clear`) takes effect on the next action with no window.
 */
function secret() {
  mkdirSync(HOME, { recursive: true, mode: 0o700 });
  const p = join(HOME, "secret");
  if (!existsSync(p)) writeFileSync(p, randomBytes(32).toString("hex"), { mode: 0o600 });
  return readFileSync(p, "utf8").trim();
}
const sign = (o) => createHmac("sha256", secret()).update(JSON.stringify([o.text, o.at, o.expiresAt ?? null])).digest("hex");
export function writeIntent(text, forMs = 60 * 60 * 1000) {
  const at = new Date().toISOString(), expiresAt = new Date(Date.now() + forMs).toISOString();
  const o = { text, at, expiresAt }; o.sig = sign(o);
  mkdirSync(HOME, { recursive: true, mode: 0o700 });
  writeFileSync(join(HOME, "intent.json"), JSON.stringify(o, null, 2), { mode: 0o600 });
  return o;
}
export function readIntent(now = Date.now()) {
  const p = join(HOME, "intent.json");
  const o = existsSync(p) ? readJSON(p, null) : null;
  if (!o) return null;
  if (o.sig !== sign(o)) return { ...o, invalid: "signature does not verify: not the developer's channel", text: "" };
  if (o.expiresAt && Date.parse(o.expiresAt) < now) return { ...o, invalid: "expired", text: "" };
  return o;
}

/** The maintainers' channel: what the repository itself establishes. */
function sharedPackageJson(repo) {
  // the policy is what the SHARED branch says, so an agent editing package.json in the working
  // tree cannot grant itself a script or a dependency; those become policy when a human pushes
  let prefix = "";
  try { prefix = execSync("git rev-parse --show-prefix", { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return readJSON(join(repo, "package.json"), {}); }
  for (const ref of ["origin/main", "origin/master", "HEAD"]) {
    try { return JSON.parse(execSync(`git show ${ref}:${prefix}package.json`, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })); } catch {}
  }
  return readJSON(join(repo, "package.json"), {});
}
export function readPolicy(repo = REPO) {
  const pkg = sharedPackageJson(repo);
  const policy = readJSON(join(repo, ".gate", "policy.json"), {});
  const scripts = Object.keys(pkg.scripts || {}).flatMap((k) => [`npm run ${k}`, `npm ${k}`, pkg.scripts[k]]);
  const deps = Object.keys({ ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) });
  return {
    commands: [...new Set([...(policy.commands || []), ...scripts, "npm install", "npm test", "npm ci"])],
    dependencies: [...new Set([...(policy.dependencies || []), ...deps])],
    branches: policy.branches || [],
    editableProtectedFiles: policy.editableProtectedFiles || [],
    // package.json is no longer protected: editing it is ordinary work and grants nothing until pushed
    // the gate itself, Bob's configuration and the hook script are always protected: an agent that
    // can edit .bob/settings.json or gate/hook.mjs can switch itself off
    protectedFiles: [...new Set([...(policy.protectedFiles || [".github/**", "ci/**", "deploy/**", ".env*", "package-lock.json"]),
      ".gate/**", ".bob/**", ".bobmodes", ".bobignore", "gate/**", "**/.bob/**", "**/gate/hook.mjs", "**/gate/decide.mjs", "**/gate/core.mjs", "**/gate/consequences.mjs", "**/gate/authority.js"])],
  };
}

/**
 * Maintainers' statements inside issues and pull requests. An issue's author is
 * an authenticated attribute (on GitHub: OWNER / MEMBER / COLLABORATOR /
 * CONTRIBUTOR / NONE; here: the `Reporter:` / `Author:` line matched against
 * CODEOWNERS). Text written by a maintainer is a statement by a maintainer and
 * carries their grant; the same text by anyone else carries nothing. This is
 * the membership tier of the trust model: who you are, on top of what channel.
 */
export function readCodeowners(repo = REPO) {
  for (const f of [".github/CODEOWNERS", "CODEOWNERS", "docs/CODEOWNERS"]) {
    const p = join(repo, f);
    if (existsSync(p)) return readFileSync(p, "utf8").split("\n").filter((l) => l.trim() && !l.startsWith("#")).flatMap((l) => l.split(/\s+/).slice(1)).map((x) => x.replace(/^@/, "").toLowerCase());
  }
  return [];
}
export function readMaintainerStatements(repo = REPO) {
  const owners = readCodeowners(repo);
  const out = [];
  for (const dir of ["issues", "pull-requests", ".gate/issues"]) {
    const d = join(repo, dir);
    if (!existsSync(d)) continue;
    for (const name of readdirSync(d)) {
      if (!/\.(md|json)$/.test(name)) continue;
      const text = readFileSync(join(d, name), "utf8");
      let author = null, association = null;
      if (name.endsWith(".json")) { try { const j = JSON.parse(text); author = j.author; association = j.authorAssociation; } catch { continue; } }
      else { const m = text.match(/^(?:Reporter|Author):\s*@?([^\s]+)/m); author = m ? m[1] : null; }
      const a = (author || "").toLowerCase();
      const isMaintainer = ["OWNER", "MEMBER", "COLLABORATOR"].includes(String(association || "").toUpperCase()) || owners.some((o) => a === o || a.endsWith("/" + o) || o.endsWith("/" + a));
      if (isMaintainer) out.push({ file: `${dir}/${name}`, author: author, text: name.endsWith(".json") ? (JSON.parse(text).body || "") : text });
    }
  }
  return out;
}

/** Not a channel. Collected only so a refusal can tell the human where a value came from. */
export function readUntrusted(repo = REPO) {
  const out = [];
  const walk = (dir, depth) => {
    if (depth > 4) return;
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name.startsWith(".git")) continue;
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p, depth + 1);
      else if (/\.(md|log|txt)$/i.test(name) && name !== "TASKS.md" && st.size < 512 * 1024) out.push({ file: p.slice(repo.length + 1), text: readFileSync(p, "utf8") });
    }
  };
  try { walk(repo, 0); } catch {}
  return out;
}

export function policyHash(repo = REPO) {
  const h = createHash("sha256");
  for (const f of ["package.json", ".gate/policy.json", ".github/CODEOWNERS"]) { const p = join(repo, f); if (existsSync(p)) h.update(f + "\n" + readFileSync(p, "utf8")); }
  return h.digest("hex").slice(0, 16);
}
export function sources(repo = REPO) {
  return { repo, intent: readIntent(), policy: readPolicy(repo), maintainerStatements: readMaintainerStatements(repo), untrusted: readUntrusted(repo) };
}

export function gate(action, args, repo = REPO) {
  const src = sources(repo);
  const d = decide(action, args, src);
  log({ at: new Date().toISOString(), repo, action, args, policyHash: policyHash(repo), intentAt: src.intent?.at ?? null, intentValid: src.intent ? !src.intent.invalid : null, ...d });
  return d;
}

export function log(entry) {
  mkdirSync(HOME, { recursive: true });
  appendFileSync(join(HOME, "decisions.jsonl"), JSON.stringify(entry) + "\n");
  try { mkdirSync(join(REPO, ".gate"), { recursive: true }); appendFileSync(join(REPO, ".gate", "decisions.jsonl"), JSON.stringify(entry) + "\n"); } catch {}
}

export function readLog(n = 20) {
  const p = join(HOME, "decisions.jsonl");
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf8").trim().split("\n").filter(Boolean).slice(-n).map((l) => JSON.parse(l));
}
