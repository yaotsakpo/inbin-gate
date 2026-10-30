/**
 * Facts about a package from the npm registry: does it exist, how old is it, how much is it used.
 * Admissibility, not authority: a maintainer's policy can say "an established package needs no
 * one's word", and the registry is what makes "established" a checkable fact rather than the
 * agent's opinion. A hallucinated name (the slopsquatting surface) has no facts at all.
 * Results are cached for a day; a lookup that fails or times out yields no facts, which means
 * the package is NOT established, so a network problem can only make the gate stricter.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { shellLines, shellStatements, shellWords } from "./consequences.mjs";

const TTL = 24 * 3600 * 1000;
export async function registryFacts(name, home) {
  if (!isPackageName(name)) return { exists: false, invalid: true };   // a variable, a path, a URL, or an install we could not read: never looked up, never established
  const cacheFile = join(home, "registry-cache.json");
  let cache = {}; try { cache = JSON.parse(readFileSync(cacheFile, "utf8")); } catch {}
  const hit = cache[name]; if (hit && Date.now() - hit.at < TTL) return hit.facts;
  let facts = { exists: false };
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 5000);
    const [meta, dl] = await Promise.all([
      fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}`, { signal: ctl.signal }).then((r) => (r.ok ? r.json() : null)),
      fetch(`https://api.npmjs.org/downloads/point/last-week/${encodeURIComponent(name)}`, { signal: ctl.signal }).then((r) => (r.ok ? r.json() : null)),
    ]);
    clearTimeout(t);
    if (meta && meta.time && meta.time.created) {
      facts = { exists: true, ageDays: Math.floor((Date.now() - Date.parse(meta.time.created)) / 86400000), weeklyDownloads: dl?.downloads ?? 0, license: meta.license ?? null, versions: Object.keys(meta.versions || {}).length };
    }
  } catch { facts = { exists: false, error: "lookup failed" }; }
  try { mkdirSync(home, { recursive: true }); cache[name] = { at: Date.now(), facts }; writeFileSync(cacheFile, JSON.stringify(cache)); } catch {}
  return facts;
}
/** An npm package name (scoped or not): anything else (a variable, a path, a URL, a tarball) is not one. */
export function isPackageName(n) { return typeof n === "string" && /^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/i.test(n); }

/** Stands for an install whose packages cannot be read from the command (stdin, a substitution, an unknown form). */
export const UNREADABLE = "<unreadable install>";

// Read with the shell's grammar, not by splitting on spaces: statements and pipeline stages come from the
// classifier's own splitter (quotes, `&`, `|`), redirects and their targets are not words, wrappers and variable
// prefixes are read through as the classifier does, and a flag's value is not a package. Every installer the
// parser cannot read still yields a name, UNREADABLE, which no registry fact can establish: a package the rule
// does not see must never be covered by the ones it does.
const REDIRECT = /^(\d+|&)?(>>?|<<<?|<|>&|<&|>\|)/;
const WRAPPER_ARGS = {
  timeout: /^(-s|-k|--signal|--kill-after)$/, nice: /^(-n|--adjustment)$/, time: /^(-f|--format|-o|--output)$/,
  ionice: /^(-c|--class|-n|--classdata)$/, stdbuf: /^(-i|-o|-e|--input|--output|--error)$/, env: /^(-u|--unset)$/, nohup: /^$/,
};
const VALUE_FLAGS = /^(--registry|--tag|--prefix|-w|--workspace|--save-prefix|--omit|--include|--install-strategy|--cache|--userconfig|-C|--dir|--filter|-F|--network-timeout|--cwd|--modules-folder|-p|--package)$/;
const INSTALLER = /^(npm|pnpm|yarn|bun)$/, ADD = /^(install|i|add)$/, EXEC = /^(exec|x|dlx)$/, RUNNER = /^(npx|pnpx|bunx)$/;

function withoutRedirects(words) {
  const out = [];
  for (let i = 0; i < words.length; i++) {
    const m = REDIRECT.exec(words[i]);
    if (m) { if (words[i].length === m[0].length) i++; continue; }   // `>` alone takes the next word as its target
    out.push(words[i]);
  }
  return out;
}
function underWrappers(w) {
  for (;;) {
    if (w.length && /^[A-Za-z_]\w*=/.test(w[0])) { w = w.slice(1); continue; }
    const args = WRAPPER_ARGS[w[0]]; if (!args) return w;
    let i = 1;
    while (i < w.length && w[i].startsWith("-")) { if (w[i] === "--") { i++; break; } i += args.test(w[i]) ? 2 : 1; }
    if (w[0] === "timeout") i++;   // the duration
    w = w.slice(i);
  }
}
const stripVersion = (x) => x.replace(/(.)@[^@/]*$/, "$1");
function named(args, firstOnly) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--") { if (firstOnly) break; continue; }
    if (a.startsWith("-")) {
      if (/^(-p|--package)$/.test(a)) out.push(stripVersion(args[++i] ?? UNREADABLE));
      else if (/^--package=/.test(a)) out.push(stripVersion(a.slice(10)));
      else if (VALUE_FLAGS.test(a)) i++;
      continue;
    }
    out.push(stripVersion(a));
    if (firstOnly) break;   // npx runs its first word; the rest are that program's arguments
  }
  return out;
}

/** Package names a command would add: by an install, or fetched to run by npx and its kin. */
export function packagesInCommand(cmd) {
  const out = [];
  for (const line of shellLines(String(cmd ?? ""))) for (const pipeline of shellStatements(line)) for (const stage of pipeline) {
    const raw = shellWords(stage), w = underWrappers(withoutRedirects(raw));
    if (INSTALLER.test(w[0] ?? "") && ADD.test(w[1] ?? "")) { out.push(...named(w.slice(2), false)); continue; }
    if (RUNNER.test(w[0] ?? "")) { const n = named(w.slice(1), true); out.push(...(n.length ? n : [UNREADABLE])); continue; }
    if (INSTALLER.test(w[0] ?? "") && EXEC.test(w[1] ?? "")) { const n = named(w.slice(2), true); out.push(...(n.length ? n : [UNREADABLE])); continue; }
    // an installer anywhere else in the stage (xargs npm install, sudo npm i): an install we cannot read. Inside a
    // quoted string it counts only when a shell runs that string (sh -c "npx ...", eval); a commit message does not.
    const shellRuns = /^(sh|bash|zsh|dash|ksh|eval)$/.test(w[0] ?? "");
    if (raw.some((t, i) => (INSTALLER.test(t) && (ADD.test(raw[i + 1] ?? "") || EXEC.test(raw[i + 1] ?? ""))) || RUNNER.test(t) || (shellRuns && /(^|[\s;&|(])(npx|pnpx|bunx|(npm|pnpm|yarn|bun)\s+(install|i|add|exec|x|dlx))(\s|$)/.test(t)))) out.push(UNREADABLE);
  }
  return [...new Set(out)];
}
export function established(facts, rule) {
  if (!rule || !facts || !facts.exists) return false;
  return facts.ageDays >= (rule.minAgeDays ?? 365) && facts.weeklyDownloads >= (rule.minWeeklyDownloads ?? 10000);
}
