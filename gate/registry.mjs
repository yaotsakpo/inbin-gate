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

const TTL = 24 * 3600 * 1000;
export async function registryFacts(name, home) {
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
/** Package names a command would add. */
export function packagesInCommand(cmd) {
  const out = [];
  for (const seg of String(cmd).split(/\s*(?:&&|\|\||;)\s*/)) {
    const m = /^(?:npm|pnpm|yarn)\s+(?:install|i|add)\s+(.+)$/.exec(seg.trim());
    if (m) for (const x of m[1].split(/\s+/)) if (!x.startsWith("-")) out.push(x.replace(/@[^@/]+$/, "").replace(/^["']|["']$/g, ""));
  }
  return out;
}
export function established(facts, rule) {
  if (!rule || !facts || !facts.exists) return false;
  return facts.ageDays >= (rule.minAgeDays ?? 365) && facts.weeklyDownloads >= (rule.minWeeklyDownloads ?? 10000);
}
