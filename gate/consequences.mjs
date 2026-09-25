/**
 * What a command would DO to the repository, classified from the repository's
 * own state, not from the command's shape. Authority is needed per consequence,
 * not per tool: the predicate the gate scopes to is the fact being changed.
 *
 * Consequences, from harmless to grave:
 *   reads                  nothing changes
 *   regenerable.delete     removes gitignored output (dist/, node_modules/, coverage/): rebuilt by a script
 *   tracked.delete         removes clean tracked files: recoverable with git checkout
 *   history.local          rewrites the local branch (reset, rebase, amend): recoverable from the reflog
 *   git.safe               fetch, stash, checkout -b, add, commit, merge, rebase onto main
 *   work.delete            removes or overwrites untracked or modified files: no other copy exists
 *   history.shared         force-pushes: rewrites what a remote already has, for everyone
 *   push                   publishes commits
 *   dependency.add         adds a package
 *   privileged             sudo, chown, chmod on paths outside the repo, writing outside the repo
 *   unknown                anything not classified: treated as needing authority
 *
 * The default maintainer grant covers reads, regenerable.delete, tracked.delete,
 * history.local and git.safe. Everything else needs the developer (or a policy
 * entry). This is what lets "remove build artefacts" run while "rm -rf notes/"
 * still stops: same command, different fact.
 */
import { execSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { join, resolve, relative, isAbsolute } from "node:path";

const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const READ = /^(git (log|status|diff|branch|show|remote -v|rev-parse|ls-files|stash list|tag|merge-base|describe)|ls|cat |head |tail |grep |find |wc |echo |pwd|which |tree|du |stat |node --version|node -v|node --test\b|npm (--version|-v|ls|outdated|view|test|run test|run lint|run build)|npx --no-install --test|cd )/;
const SAFE_GIT = /^git (fetch|stash( push| pop| list| apply)?|checkout -b |switch -c |switch |checkout (main|master|feature\/|origin\/)|add |commit|merge (--no-ff |main|origin\/main)|rebase (main|origin\/main|--continue)|cherry-pick |pull --ff-only)/;
const DESTRUCTIVE_FLAGS = /(--force\b|\s-f\b|--hard\b|\bclean\b|checkout\s+--\s|reset\s+--hard|--no-verify|\s-i\b|--interactive)/;

function sh(cmd, cwd) { try { return execSync(cmd, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000 }).trim(); } catch { return null; } }

/** Where a path stands in the repo: ignored | untracked | modified | tracked | missing | outside */
export function pathState(p, repo) {
  const abs = isAbsolute(p) ? p : resolve(repo, p);
  const rel = relative(repo, abs);
  if (rel.startsWith("..")) return "outside";
  if (!existsSync(abs)) return "missing";
  if (sh(`git check-ignore -q -- ${JSON.stringify(rel)} && echo yes`, repo) === "yes") return "ignored";
  const st = sh(`git status --porcelain --untracked-files=all -- ${JSON.stringify(rel)}`, repo) ?? "";
  if (st.split("\n").some((l) => l.startsWith("??"))) return "untracked";
  if (st.trim()) return "modified";
  const tracked = sh(`git ls-files --error-unmatch -- ${JSON.stringify(rel)} >/dev/null 2>&1 && echo yes`, repo);
  return tracked === "yes" ? "tracked" : (statSync(abs).isDirectory() ? "tracked" : "untracked");
}

/** Are all commits between `ref` and HEAD present on some remote? */
export function commitsPushed(ref, repo) {
  const unpushed = sh(`git log --oneline ${ref}..HEAD --not --remotes 2>/dev/null`, repo);
  return unpushed !== null && unpushed === "";
}

function classifySegment(seg, repo) {
  // stderr/stdout redirections and /dev/null are not file writes
  const s = norm(seg).replace(/\s+2>&1|\s+>&2|\s+[12]?>\s*\/dev\/null|\s+&>\s*\/dev\/null/g, "").trim();
  if (!s) return [];
  if (/^(true|false|:|exit \d+)$/.test(s)) return ["reads"];
  if (/^(sudo|doas|su)\b/.test(s) || /\b(chown|chmod)\b.*(~|\/Users|\/home|\/etc|\/usr)/.test(s)) return ["privileged"];
  // the gate's own files and Bob's configuration: any write, move, removal or permission change is privileged
  if (/(^|[\s/"'])(\.bob\b|\.gate\b|gate\/(hook|decide|core|consequences|authority)|\.bobmodes|\.bobignore)/.test(s) && !/^(cat |ls|head |tail |grep |git (log|status|diff|show)|node --test)/.test(s)) return ["privileged"];
  if (/^cd\s+\S+$/.test(s)) return ["reads"];
  if (READ.test(s)) return ["reads"];
  // deletions: rm, rm -rf, git rm, git clean
  let m = /^(?:rm|rmdir)\s+(?:-[a-zA-Z]+\s+)*(.+)$/.exec(s);
  if (m) {
    const out = new Set();
    for (const raw of m[1].split(/\s+/)) {
      const p = raw.replace(/^["']|["']$/g, "");
      if (p === "/" || p === "~" || p.startsWith("~/")) { out.add("privileged"); continue; }
      const st = pathState(p, repo);   // absolute paths are resolved against the repo: inside is classified by state, outside is privileged
      if (st === "outside") out.add("privileged");
      else if (st === "ignored" || st === "missing") out.add("regenerable.delete");
      else if (st === "tracked") out.add("tracked.delete");
      else out.add("work.delete");
    }
    return [...out];
  }
  if (/^git clean\b/.test(s)) return /-n|--dry-run/.test(s) ? ["reads"] : ["work.delete"];
  m = /^git rm\b(?:\s+-[a-zA-Z]+)*\s+(.+)$/.exec(s);
  if (m) return [...new Set(m[1].split(/\s+/).map((p) => (pathState(p, repo) === "modified" ? "work.delete" : "tracked.delete")))];
  // history
  m = /^git (?:reset|rebase)\b/.exec(s);
  if (m) {
    if (/--hard/.test(s)) return ["work.delete"];
    if (/^git rebase (main|origin\/main|--continue|--abort)/.test(s) && !/-i|--interactive/.test(s)) return ["git.safe"];
    // rewriting the LOCAL branch is reversible from the reflog whatever the commits are; what
    // makes history irreversible for others is publishing the rewrite, and that is the push
    return ["history.local"];
  }
  if (/^git commit --amend/.test(s)) return ["history.local"];
  if (/^git push\b/.test(s)) return DESTRUCTIVE_FLAGS.test(s) || /\+\S+:/.test(s) ? ["history.shared"] : ["push"];
  if (/^git checkout\s+--\s/.test(s) || /^git restore\b/.test(s)) return ["work.delete"];   // discards uncommitted changes
  if (DESTRUCTIVE_FLAGS.test(s) && /^git /.test(s)) return ["history.shared"];
  if (SAFE_GIT.test(s)) return ["git.safe"];
  if (/^(npm|pnpm|yarn)\s+(install|i|add)\s+\S/.test(s) && !/^(npm|pnpm|yarn)\s+(install|i)\s*$/.test(s)) return ["dependency.add"];
  if (/^(npm|pnpm|yarn)\s+(install|i|ci)\s*(--\S+\s*)*$/.test(s)) {
    // a bare install with an edited package.json installs whatever was added to it
    const st = pathState("package.json", repo);
    return st === "modified" || st === "untracked" ? ["dependency.add"] : ["regenerable.delete"];
  }
  if (/^(mv|cp)\s/.test(s)) {
    const parts = s.split(/\s+/).slice(1).filter((x) => !x.startsWith("-"));
    const dest = parts[parts.length - 1]; const st = dest ? pathState(dest, repo) : "missing";
    return st === "missing" || st === "ignored" ? ["tracked.delete"] : ["work.delete"]; // cp/mv onto an existing untracked/modified file overwrites work
  }
  if (/^(mkdir|touch)\s/.test(s)) return ["reads"];
  if (/[>]{1,2}\s*\S/.test(s)) { const dest = (/[>]{1,2}\s*(\S+)/.exec(s) || [])[1] || ""; if (/(^|\/)(\.bob|\.gate|gate)\//.test(dest) || /\.bob(modes|ignore)$/.test(dest)) return ["privileged"]; const st = dest ? pathState(dest, repo) : "missing"; return st === "untracked" || st === "modified" ? ["work.delete"] : st === "outside" ? ["privileged"] : ["tracked.delete"]; }
  return ["unknown"];
}

/** All consequences of a (possibly chained) command, as a sorted unique list. */
export function consequences(cmd, repo) {
  const segs = norm(cmd).split(/\s*(?:&&|\|\||;)\s*/).filter(Boolean);
  const out = new Set();
  for (const seg of segs) for (const c of classifySegment(seg.split(/\s*\|\s*/)[0], repo)) out.add(c);
  // a pipe into sh/bash executes remote or generated content
  if (/\|\s*(sh|bash|zsh)\b/.test(cmd)) out.add("unknown");
  return [...out].sort();
}

export const DEFAULT_GRANT = new Set(["reads", "regenerable.delete", "tracked.delete", "history.local", "git.safe"]);
export function coveredByDefault(cs) { return cs.length > 0 && cs.every((c) => DEFAULT_GRANT.has(c)); }
