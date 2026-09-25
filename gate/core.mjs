/** Inbin Gate: load the channels from disk, decide, log. */
import { readFileSync, existsSync, mkdirSync, appendFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { decide } from "./decide.mjs";

export const HOME = process.env.INBIN_GATE_HOME || join(homedir(), ".inbin-gate");
export const REPO = resolve(process.env.INBIN_GATE_REPO || process.cwd());

const readJSON = (p, d) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return d; } };

/** The developer's channel: typed out of band with `gate intent "..."`, stored OUTSIDE the repository. */
export function readIntent() {
  const p = join(HOME, "intent.json");
  return existsSync(p) ? readJSON(p, null) : null;
}

/** The maintainers' channel: what the repository itself establishes. */
export function readPolicy(repo = REPO) {
  const pkg = readJSON(join(repo, "package.json"), {});
  const policy = readJSON(join(repo, ".gate", "policy.json"), {});
  const scripts = Object.keys(pkg.scripts || {}).flatMap((k) => [`npm run ${k}`, `npm ${k}`, pkg.scripts[k]]);
  const deps = Object.keys({ ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) });
  return {
    commands: [...new Set([...(policy.commands || []), ...scripts, "npm install", "npm test", "npm ci"])],
    dependencies: [...new Set([...(policy.dependencies || []), ...deps])],
    branches: policy.branches || [],
    editableProtectedFiles: policy.editableProtectedFiles || [],
    protectedFiles: policy.protectedFiles || ["package.json", ".github/**", "ci/**", "deploy/**", ".env*", ".gate/**"],
  };
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

export function sources(repo = REPO) {
  return { intent: readIntent(), policy: readPolicy(repo), untrusted: readUntrusted(repo) };
}

export function gate(action, args, repo = REPO) {
  const d = decide(action, args, sources(repo));
  log({ at: new Date().toISOString(), repo, action, args, ...d });
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
