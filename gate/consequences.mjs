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
 *   work.delete            removes or overwrites untracked or modified files, a stash entry, or a branch whose
 *                          commits may be on no other branch (`branch -D`): no other copy exists
 *   history.shared         force-pushes: rewrites what a remote already has, for everyone
 *   checks.disable         skips or removes the repository's own checks (git hooks): --no-verify, `commit -n`,
 *                          a core.hooksPath other than the configured one, HUSKY=0, or removing, moving,
 *                          overwriting or un-executing a hook file (.git/hooks, .husky, the configured hooksPath)
 *   push                   publishes commits
 *   dependency.add         adds a package (also npx of a package that is not installed: it fetches and runs it)
 *   code.run:<object>      runs code that lives in the repository: a file, a package.json script or an installed
 *                          binary. The object is what the developer or a maintainer names. The gate classifies
 *                          the command, never the code it runs: see "what the gate does not see" in README.
 *   privileged             sudo, chown, chmod on paths outside the repo, writing outside the repo (the OS temp
 *                          directory is scratch and counts as regenerable)
 *   unknown                anything not classified: treated as needing authority
 *
 * The default maintainer grant covers reads, regenerable.delete, tracked.delete,
 * history.local and git.safe. Everything else needs the developer (or a policy
 * entry). This is what lets "remove build artefacts" run while "rm -rf notes/"
 * still stops: same command, different fact.
 */
import { execSync, execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { join, resolve, relative, isAbsolute, basename, dirname } from "node:path";

const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const READ = /^(pre-commit run\b|git (log|status|diff|show|remote -v|rev-parse|ls-files|tag|merge-base|describe)|ls|cat( |$)|head( |$)|tail( |$)|grep |find |wc( |$)|echo |pwd|which |tree|du |stat |node --version|node -v|node --test\b|npm (--version|-v|ls|outdated|view|test|run test|run lint|run build)|npx --no-install --test|cd )/;
const SAFE_GIT = /^git (fetch|checkout -b |switch -c |switch |checkout (main|master|feature\/|origin\/)|add |commit|merge (--no-ff |main|origin\/main)|rebase (main|origin\/main|--continue)|cherry-pick |pull --ff-only)/;
const DESTRUCTIVE_FLAGS = /(--force\b|\s-f\b|--hard\b|(?:^|\s)clean(?=\s|$)|checkout\s+--\s|reset\s+--hard|\s-i\b|--interactive)/;

/** git with an argument list (no shell), read-only uses only, bounded; null when it fails or times out. */
function git(args, cwd) { try { return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000, maxBuffer: 4 << 20 }).replace(/\s+$/, ""); } catch { return null; } }
/**
 * The directory the statement being classified runs in. A command is taken to start at the repository root (null);
 * a `cd` or `git -C` that can be followed moves it; one that cannot (a variable, `cd -`, a directory that does not
 * exist) makes it UNKNOWN_DIR. Relative paths resolve against it (against the root when it is unknown, as before).
 */
const UNKNOWN_DIR = Symbol("unknown directory");
let CWD = null;
const baseDir = (repo) => (typeof CWD === "string" ? CWD : repo);
/** The directory state is read in, or null when it is not known or not in this repository (state reads then fail closed). */
function stateDir(repo) {
  if (CWD === UNKNOWN_DIR) return null;
  const d = CWD ?? repo;
  if (!existsSync(d) || (CWD !== null && relative(repo, CWD).startsWith(".."))) return null;
  return d;
}
function followCd(arg, repo) {
  const w = shellWords(arg ?? "");
  if (!w.length || /^(~|-)/.test(w[0]) || /[$`]/.test(w[0]) || (CWD === UNKNOWN_DIR && !isAbsolute(w[0]))) { CWD = UNKNOWN_DIR; return; }
  const abs = resolve(baseDir(repo), w[0]);
  let dir = false; try { dir = statSync(abs).isDirectory(); } catch {}
  CWD = !dir ? UNKNOWN_DIR : abs === resolve(repo) ? null : abs;
}
const sameCommit = (a, b, repo) => { const x = git(["rev-parse", "-q", "--verify", `${a}^{commit}`], repo); return x !== null && x === git(["rev-parse", "-q", "--verify", `${b}^{commit}`], repo); };
/**
 * Would throwing away the working tree (reset --hard, checkout -f, switch --discard-changes) towards `target`
 * lose anything? Uncommitted or staged changes to tracked files are lost; so is an untracked file at a path the
 * target commit tracks. True when a read fails.
 */
function discardLoses(target, repo) {
  const dir = stateDir(repo); if (!dir) return true;
  const st = git(["status", "--porcelain", "--untracked-files=no"], dir); if (st === null || st !== "") return true;
  if (!target || sameCommit(target, "HEAD", dir)) return false;
  const tree = git(["ls-tree", "-r", "--name-only", "--full-tree", target], dir), un = git(["ls-files", "--others", "--exclude-standard", "--full-name"], dir);
  if (tree === null || un === null) return true;
  const tracked = new Set(tree.split("\n"));
  return un.split("\n").filter(Boolean).some((f) => tracked.has(f));
}
/**
 * What `git clean` would remove, asked of git itself with -n and the same flags (never the real one). Ignored
 * output is regenerable; anything else it lists is untracked work. Null when it cannot be read.
 */
function classifyClean(s, repo) {
  const w = shellWords(s).slice(2), args = []; let forces = 0;
  for (const t of w) {
    if (t === "-i" || t === "--interactive" || (/^-[a-zA-Z]+$/.test(t) && t.includes("i"))) return null;
    if (t === "-f" || t === "--force") { forces++; continue; }
    if (t === "-q" || t === "--quiet") continue;
    if (/^-[a-zA-Z]+$/.test(t)) { forces += (t.match(/f/g) || []).length; const rest = t.slice(1).replace(/[fq]/g, ""); if (rest) args.push("-" + rest); continue; }
    args.push(t);
  }
  const dir = stateDir(repo); if (!dir) return null;
  const out = git(["clean", "-n", ...args], dir); if (out === null) return null;
  const lines = out.split("\n").filter(Boolean);
  if (forces > 1 && lines.some((l) => l.startsWith("Would skip repository"))) return ["work.delete"];   // -ff removes nested repositories
  const paths = lines.filter((l) => l.startsWith("Would remove ")).map((l) => l.slice(13));
  if (!paths.length) return ["reads"];
  if (paths.some((p) => p.startsWith('"'))) return null;   // a quoted name with escapes: not read
  return paths.every((p) => pathState(resolve(dir, p), repo) === "ignored") ? ["regenerable.delete"] : ["work.delete"];
}

function sh(cmd, cwd) { try { return execSync(cmd, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000 }).trim(); } catch { return null; } }

/**
 * Where a path stands in the repo: repository | ignored | untracked | modified | tracked | missing | outside.
 * `repository` is the root itself or `.git`: every commit, branch, stash and the index live there, so it is
 * what makes the rest recoverable, never a recoverable thing in its own right.
 */
export function pathState(p, repo) {
  const abs = isAbsolute(p) ? p : resolve(baseDir(repo), p);
  const rel = relative(repo, abs);
  if (rel === "" || rel === ".git") return "repository";
  if (rel.startsWith("..")) return "outside";
  if (!existsSync(abs)) return "missing";
  if (sh(`git check-ignore -q -- ${JSON.stringify(rel)} && echo yes`, repo) === "yes") return "ignored";
  const st = sh(`git status --porcelain --untracked-files=all -- ${JSON.stringify(rel)}`, repo) ?? "";
  if (st.split("\n").some((l) => l.startsWith("??"))) return "untracked";
  if (st.trim()) return "modified";
  const tracked = sh(`git ls-files --error-unmatch -- ${JSON.stringify(rel)} >/dev/null 2>&1 && echo yes`, repo);
  return tracked === "yes" ? "tracked" : (statSync(abs).isDirectory() ? "tracked" : "untracked");
}

/** Is the repository root inside (or equal to) this path? Deleting such a path deletes the repository. */
function containsRepo(p, repo) {
  if (/\$|`/.test(p)) return false;
  const up = relative(resolve(baseDir(repo), p), repo);
  return up === "" || (!up.startsWith("..") && !isAbsolute(up));
}

/** The configured core.hooksPath, resolved against the repository root as git does, or null. */
function configuredHooksPath(repo) { const v = sh("git config --get core.hooksPath", repo); return v ? resolve(repo, v) : null; }
/**
 * The directories git runs hooks from: core.hooksPath when it is set, otherwise .git/hooks. Husky sets core.hooksPath
 * to `.husky/_`, whose scripts call the hooks in `.husky`, so the parent of a `_` hooks directory counts too. When
 * the configuration cannot be read, every usual place counts (fail closed).
 */
function activeHookDirs(repo) {
  const v = git(["config", "--default", "", "--get", "core.hooksPath"], repo);
  if (v === null) return [join(repo, ".git", "hooks"), join(repo, ".husky"), join(repo, ".githooks")];
  if (!v) return [join(repo, ".git", "hooks")];
  const d = resolve(repo, v);
  return basename(d) === "_" ? [d, dirname(d)] : [d];
}
/**
 * Does writing (write = true), or removing, moving or un-executing, this path touch a hook git actually runs? A
 * removal of something that is not there touches nothing; a write creates a hook that will run. A directory that
 * contains a live hooks directory counts.
 */
function isHookPath(p, repo, write = false) {
  if (!p || /\$|`/.test(p)) return false;
  const abs = resolve(baseDir(repo), p);
  if (!write && !existsSync(abs)) return false;
  return activeHookDirs(repo).some((d) => abs === d || abs.startsWith(d + "/") || d.startsWith(abs + "/"));
}
/** Would core.hooksPath set to this value run other hooks than the ones git runs now? (Empty runs none.) */
function changesHooksPath(v, repo) { return v === "" || resolve(repo, v) !== (configuredHooksPath(repo) ?? join(repo, ".git", "hooks")); }
/** Does a chmod mode take the execute bit away from the owner (`-x`, `a-x`, `u=rw`, `644`)? A hook without it does not run. */
function removesExec(mode) {
  if (/^[0-7]{3,4}$/.test(mode)) return (Number(mode[mode.length - 3]) & 1) === 0;
  return mode.split(",").some((part) => {
    const m = /^([ugoa]*)([-=])([rwxXst]*)$/.exec(part);
    return !!m && (m[1] === "" || /[ua]/.test(m[1])) && (m[2] === "-" ? m[3].includes("x") : !m[3].includes("x"));
  });
}

const HOOK_ENV = /^(HUSKY|HUSKY_SKIP_HOOKS|GIT_CONFIG_COUNT|GIT_CONFIG_KEY_\d+|GIT_CONFIG_VALUE_\d+|GIT_CONFIG_PARAMETERS)$/;
const unquote = (v) => v.replace(/^(["'])(.*)\1$/, "$2");
/**
 * Switches in a statement that skip or remove the repository's own checks (agent-guard-bench holdout19, R6):
 * --no-verify, `git commit -n`, HUSKY=0, a core.hooksPath (by `git -c`, `git config` or GIT_CONFIG_* variables)
 * other than the configured one, uninstalling the hook manager. Returns whether it disarms the checks and the
 * statement without those switches, so that what remains is still classified; `done` when nothing remains.
 */
function disarmedChecks(s, repo) {
  let disable = false;
  // variable assignments before the command, or exported for the rest of the session
  // env's own options may come first (`env -i HUSKY=0 git commit` skipped the hooks unseen)
  let m = /^(env(?:\s+(?:-i|--ignore-environment|-u\s+\S+|--unset=\S+|--))*\s+|export\s+)?((?:[A-Za-z_]\w*=(?:"(?:[^"\\]|\\.)*"|'[^']*'|[^\s"']*)(?:\s+|$))+)/.exec(s);
  if (m) {
    const env = Object.fromEntries([...m[2].matchAll(/([A-Za-z_]\w*)=("(?:[^"\\]|\\.)*"|'[^']*'|[^\s"']*)/g)].map(([, k, v]) => [k, unquote(v)]));
    const viaKeys = Object.keys(env).some((k) => /^GIT_CONFIG_KEY_\d+$/.test(k) && /^core\.hookspath$/i.test(env[k]) && changesHooksPath(env[k.replace("KEY", "VALUE")] ?? "", repo));
    const viaParams = /core\.hookspath=([^'"\s]*)/i.exec(env.GIT_CONFIG_PARAMETERS ?? "");
    if (env.HUSKY === "0" || (env.HUSKY_SKIP_HOOKS ?? "") !== "" || viaKeys || (viaParams && changesHooksPath(viaParams[1], repo))) {
      disable = true;
      if (Object.keys(env).every((k) => HOOK_ENV.test(k))) s = /^export/.test(m[1] ?? "") ? "" : s.slice(m[0].length);
    }
  }
  if (/^(npx\s+)?(husky|pre-commit|lefthook)\s+uninstall\b/.test(s)) return { disable: true, s: "" };
  // git -c core.hooksPath=<another directory> <command>
  m = /^git((?:\s+-c\s+\S+)+)(\s|$)/.exec(s);
  if (m) {
    const kept = [];
    for (const [, v] of m[1].matchAll(/-c\s+(\S+)/g)) {
      const kv = /^core\.hookspath=(.*)$/i.exec(unquote(v));
      if (kv && changesHooksPath(unquote(kv[1]), repo)) disable = true; else kept.push(`-c ${v}`);
    }
    s = ["git", ...kept].join(" ") + s.slice(m[0].length - m[2].length);
  }
  // git config core.hooksPath <another directory>, or --unset core.hooksPath (git then runs .git/hooks)
  m = /^git config\b(.*)$/.exec(s);
  if (m) {
    const toks = m[1].trim().split(/\s+/), k = toks.findIndex((t) => /^core\.hookspath$/i.test(unquote(t)));
    if (k >= 0 && toks.some((t) => /^--unset(-all)?$/.test(t))) return { disable: true, s: "" };
    if (k >= 0 && toks[k + 1] !== undefined && !toks.some((t) => /^(--get|--get-all|--get-regexp|-l|--list)$/.test(t)) && changesHooksPath(unquote(toks[k + 1]), repo)) return { disable: true, s: "" };
  }
  if (/^git\s/.test(s)) {
    const unquoted = s.replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, '""');
    if (/(^|\s)--no-verify(\s|$)/.test(unquoted)) { disable = true; s = s.replace(/(^|\s)--no-verify(?=\s|$)/g, ""); }
    // `git commit -n` is --no-verify (for push -n is --dry-run, for merge --no-stat); letters after one that
    // takes a value (-m, -F, -C, -c, -t, -S) are that value
    if (/^git commit\b/.test(s)) {
      const toks = unquoted.split(/\s+/).slice(2);
      for (let i = 0; i < toks.length; i++) {
        const t = toks[i]; if (!/^-[a-zA-Z]+$/.test(t)) continue;
        const letters = t.slice(1), v = letters.search(/[mFCctS]/), head = v < 0 ? letters : letters.slice(0, v + 1);
        if (v >= 0 && v === letters.length - 1 && letters[v] !== "S") i++;   // the next word is the value
        if (!head.includes("n")) continue;
        disable = true;
        const fixed = head.replace(/n/g, "") + (v < 0 ? "" : letters.slice(v + 1));
        s = s.replace(new RegExp(`(^|\\s)${t}(?=\\s|$)`), fixed ? `$1-${fixed}` : "");
      }
    }
  }
  return { disable, s: s.trim() };
}

/** Does this stash entry exist (any entry when `ref` is null)? True when the name is a variable or a read fails. */
function stashEntryExists(ref, repo) {
  if (ref !== null && /[$`]/.test(ref)) return true;
  const dir = stateDir(repo); if (!dir) return true;
  if (ref === null) { const l = git(["stash", "list"], dir); return l === null || l !== ""; }
  const r = /^\d+$/.test(ref) ? `stash@{${ref}}` : ref;
  if (git(["rev-parse", "--git-dir"], dir) === null) return true;
  return git(["rev-parse", "-q", "--verify", r], dir) !== null;
}
/**
 * Does deleting this branch (refs/heads/<name>, or refs/remotes/<name> with `remote`) lose commits: commits reachable
 * from it and from no other branch and no remote-tracking ref? False when the branch does not exist; true when a
 * read fails or the name is a variable.
 */
function branchHoldsOnlyCopy(name, remote, repo) {
  if (!name || /[$`]/.test(name)) return true;
  const dir = stateDir(repo); if (!dir) return true;
  const ref = `refs/${remote ? "remotes" : "heads"}/${name}`;
  if (git(["show-ref", "--verify", "--quiet", ref], dir) === null) return git(["rev-parse", "--git-dir"], dir) === null;   // no such branch: nothing to lose
  // --exclude patterns for --branches and --remotes are written without their refs/heads/ or refs/remotes/ prefix
  const only = git(["rev-list", "--max-count=1", ref, "--not", ...(remote ? [] : [`--exclude=${name}`]), "--branches", ...(remote ? [`--exclude=${name}`] : []), "--remotes"], dir);
  return only === null || only !== "";
}

const INTERP = /^(node|python3?|ruby|perl|bash|sh|zsh|deno run|bun|tsx|ts-node)\s+/;
const PURE_READ = /^(git (ls-files|check-ignore|grep|blame)\b)/;
/** Inside the OS temp directory (not the directory itself): scratch, regenerable, nobody's work. */
const isTemp = (p) => /^((\/private)?\/(var\/)?tmp|"?\$\{?TMPDIR\}?"?)\/.+/.test(p);
/** Tools that only print; `sed -i`, `sort -o` and awk's own `>` write and are excluded where they occur. */
const PRINT_ONLY = /^(echo|uniq|cut|tr|diff|cmp|jq|od|xxd|file|realpath|basename|dirname|date|printf|less|more|nl|column|strings|md5sum|shasum|sha256sum|type|command -v)\b/;
function readJson(p) { try { return JSON.parse(execSync(`cat ${JSON.stringify(p)}`, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })); } catch { return null; } }
function binExists(name, repo) { return !/[\/\\]/.test(name) && existsSync(join(repo, "node_modules", ".bin", name)); }

/** The body of a package.json script in the working tree, or null. */
export function scriptBody(name, repo) { const b = readJson(join(repo, "package.json"))?.scripts?.[name]; return typeof b === "string" ? b : null; }

/** `code.run:<object>` where the object is a path inside the repo, a package.json script name or an installed binary. */
function runFile(file, repo) {
  const st = pathState(file, repo);
  if (st === "outside") return ["privileged"];
  if (st === "missing") return ["unknown"];
  return [`code.run:${relative(repo, resolve(baseDir(repo), file))}`];
}

/**
 * `git branch`, `git stash`, `git switch` and `git checkout -f`: what they destroy is in their flags, so a prefix
 * cannot classify them (agent-guard-bench holdout19, R3). Returns null for anything else.
 */
function classifyGitRefs(s, repo) {
  let m = /^git branch\b(.*)$/.exec(s);
  if (m) {
    const toks = m[1].trim().split(/\s+/).filter(Boolean);
    const short = toks.filter((t) => /^-[a-zA-Z]+$/.test(t)).map((t) => t.slice(1)).join("");
    const long = toks.filter((t) => t.startsWith("--"));
    const del = /[dD]/.test(short) || long.includes("--delete"), force = /[Df]/.test(short) || long.includes("--force");
    // -D deletes a branch whether or not its commits are anywhere else: read whether they are (another branch or a
    // remote-tracking ref). Plain -d is refused by git itself unless the branch is merged, so it loses no commits.
    if (del && force) {
      const names = toks.filter((t) => !t.startsWith("-")), remote = /r/.test(short) || long.includes("--remotes");
      return names.length && names.every((n) => !branchHoldsOnlyCopy(unquote(n), remote, repo)) ? ["git.safe"] : ["work.delete"];
    }
    if (del) return ["git.safe"];
    if (force) return ["history.local"];   // moving a branch with -f: recoverable from the branch's reflog, like reset
    const changes = /[mMcCu]/.test(short) || long.some((l) => /^--(move|copy|set-upstream-to|unset-upstream|edit-description|track|no-track|create-reflog)\b/.test(l));
    const listing = long.some((l) => /^--(list|contains|no-contains|merged|no-merged|points-at)\b/.test(l)) || /l/.test(short);
    return !changes && (listing || !toks.some((t) => !t.startsWith("-"))) ? ["reads"] : ["git.safe"];   // a name creates a branch
  }
  m = /^git stash\b\s*(\S*)/.exec(s);
  if (m) {
    const sub = m[1];
    // a stash entry is the only copy of the changes in it: read whether the entry exists
    if (/^(drop|clear)$/.test(sub)) return stashEntryExists(sub === "clear" ? null : shellWords(s).slice(3).find((t) => !t.startsWith("-")) ?? "stash@{0}", repo) ? ["work.delete"] : ["git.safe"];
    if (/^(list|show)$/.test(sub)) return ["reads"];
    return sub === "" || sub.startsWith("-") || /^(push|save|pop|apply|branch|create|store)$/.test(sub) ? ["git.safe"] : ["unknown"];
  }
  // switching with --discard-changes or -f throws away uncommitted changes, as `checkout --` does; read from the
  // working tree whether there are any (only for the plain form: one branch or commit, no paths)
  if (/^git (switch|checkout)\b/.test(s) && s.split(/\s+/).some((t) => t === "--discard-changes" || t === "--force" || /^-[a-zA-Z]*f[a-zA-Z]*$/.test(t))) {
    const w = shellWords(s).slice(2), pos = w.filter((t) => !t.startsWith("-")), flags = w.filter((t) => t.startsWith("-"));
    const plain = flags.every((t) => /^(-f|--force|--discard-changes|-q|--quiet|--)$/.test(t)) && pos.length <= 1 && (!pos.length || isCommit(pos[0], repo));
    return plain && !discardLoses(pos[0] ?? null, repo) ? ["git.safe"] : ["work.delete"];
  }
  return null;
}

/** Does this word name a commit in the repository (a branch, a tag, HEAD~1, a sha)? Read from the repository. */
function isCommit(word, repo) {
  if (!word || /[$`]/.test(word)) return false;
  return sh(`git rev-parse -q --verify ${JSON.stringify(word + "^{commit}")}`, repo) !== null;
}
/** Would replacing these paths in the working tree (and, with `index`, in the index) lose uncommitted content? */
function losesUncommitted(paths, repo, index) {
  if (paths.some((p) => /[$`]/.test(p))) return true;   // a variable: the paths are not known
  const dir = stateDir(repo); if (!dir) return true;
  const ps = paths.map((p) => unquote(p));
  // an untracked file named on its own: its content is in no commit and no index
  if (ps.some((p) => { const abs = resolve(dir, p); return existsSync(abs) && !statSync(abs).isDirectory() && pathState(abs, repo) === "untracked"; })) return true;
  const unstaged = git(["diff", "--name-only", "--", ...ps], dir), staged = index ? git(["diff", "--cached", "--name-only", "--", ...ps], dir) : "";
  return unstaged === null || staged === null || unstaged !== "" || staged !== "";
}
/**
 * `git restore`, `git checkout [<commit>] [--] <paths>` and `git reset [<commit>] [--] <paths>`, classified by what
 * they would overwrite (agent-guard-bench holdout19, R7). Unstaging touches only the index. Restoring a clean or
 * missing file loses nothing; a file with uncommitted changes, or an untracked file, is work.delete. Returns null
 * for forms this does not read (switching branches, --hard, flags it does not know).
 */
function classifyRestore(s, repo) {
  let m = /^git (restore|checkout|reset)\b(.*)$/.exec(s); if (!m) return null;
  const verb = m[1], toks = m[2].trim().split(/\s+/).filter(Boolean);
  const dd = toks.indexOf("--"), before = dd < 0 ? toks : toks.slice(0, dd), after = dd < 0 ? [] : toks.slice(dd + 1);
  const flags = before.filter((t) => t.startsWith("-")), words = before.filter((t) => !t.startsWith("-"));
  if (verb === "restore") {
    let staged = false, worktree = false, source = null;
    for (let i = 0; i < before.length; i++) {
      const t = before[i];
      if (/^(-S|--staged)$/.test(t)) staged = true;
      else if (/^(-W|--worktree)$/.test(t)) worktree = true;
      else if (/^-[SW]{2}$/.test(t)) staged = worktree = true;
      else if (/^(-s|--source)$/.test(t)) { source = before[++i]; words.splice(words.indexOf(source), 1); }
      else if (/^--source=/.test(t)) source = t.slice(9);
      else if (!/^(-q|--quiet|-p|--patch|--overlay|--no-overlay|--progress|--no-progress)$/.test(t) && t.startsWith("-")) return null;
    }
    const paths = [...words, ...after]; if (!paths.length) return null;
    if (staged && !worktree) return ["git.safe"];   // only the index changes; the files on disk stay as they are
    return losesUncommitted(paths, repo, staged) ? ["work.delete"] : ["tracked.delete"];
  }
  if (verb === "reset") {
    if (flags.some((t) => !/^(-q|--quiet|--mixed|-p|--patch)$/.test(t))) return null;   // --soft, --keep, --merge, --hard: read below
    if (flags.some((t) => /^(-p|--patch)$/.test(t))) return ["git.safe"];   // picks hunks out of the index only
  } else if (flags.some((t) => !/^(-q|--quiet)$/.test(t))) return null;
  if (verb === "reset") {
    // `git reset [<commit>] [--] <paths>` sets index entries only; without paths it moves the branch unless the commit is HEAD
    const commit = dd < 0 && words.length && isCommit(words[0], repo) ? words[0] : dd >= 0 ? words[0] : null;
    const paths = dd >= 0 ? after : commit ? words.slice(1) : words;
    if (paths.length) return ["git.safe"];
    if (!commit || sh(`git rev-parse -q --verify ${JSON.stringify(commit + "^{commit}")}`, repo) === sh("git rev-parse -q --verify HEAD", repo)) return ["git.safe"];   // unstage everything: only the index changes
    return ["history.local"];
  }
  // checkout: with `--`, an optional commit then paths; without, a commit alone switches branches (git refuses to
  // overwrite local changes), a commit with more words checks those paths out of it, anything else is paths
  let commit = null, paths;
  if (dd >= 0) { if (words.length > 1) return null; commit = words[0] ?? null; paths = after; }
  else if (words.length && (words[0] === "-" || isCommit(words[0], repo))) { if (words.length === 1) return null; commit = words[0]; paths = words.slice(1); }
  else paths = words;
  if (!paths.length) return null;
  return losesUncommitted(paths, repo, commit !== null) ? ["work.delete"] : ["tracked.delete"];
}

/** The words of a statement as the shell would pass them: quotes removed, a quoted string kept as one word. */
export function shellWords(str) {
  const out = []; let cur = "", q = null, has = false;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (q) { if (ch === q) q = null; else if (q === '"' && ch === "\\" && i + 1 < str.length) cur += str[++i]; else cur += ch; continue; }
    if (ch === "'" || ch === '"') { q = ch; has = true; continue; }
    if (ch === "\\" && i + 1 < str.length) { cur += str[++i]; has = true; continue; }
    if (/\s/.test(ch)) { if (cur || has) out.push(cur); cur = ""; has = false; continue; }
    cur += ch;
  }
  if (cur || has) out.push(cur);
  return out;
}

/**
 * Environment variables that only change logging, colour, locale or commit metadata. Any other variable set for a
 * command can change what it does (GIT_DIR points git at another repository, PATH or NODE_OPTIONS load other code,
 * GIT_EDITOR or PAGER run a program), so a command carrying one stays unknown.
 */
const BENIGN_ENV = /^(GIT_TRACE\w*|GIT_CURL_VERBOSE|GIT_TERMINAL_PROMPT|GIT_(AUTHOR|COMMITTER)_(NAME|EMAIL|DATE)|GIT_MERGE_AUTOEDIT|GIT_OPTIONAL_LOCKS|CI|NODE_ENV|DEBUG|FORCE_COLOR|NO_COLOR|TERM|LANG|LC_\w+|TZ|COLUMNS|LINES|PYTHONUNBUFFERED|PYTHONDONTWRITEBYTECODE|HUSKY)$/;
const benignEnv = (k, v) => BENIGN_ENV.test(k) || (/^(GIT_PAGER|PAGER)$/.test(k) && /^(cat)?$/.test(v));
/** Shell variables whose plain assignment already changes later commands (they are exported or read by the shell). */
const SHELL_SENSITIVE = /^(PATH|HOME|IFS|CDPATH|ENV|BASH_ENV|SHELLOPTS|BASHOPTS|PS4|PROMPT_COMMAND|LD_\w+|DYLD_\w+|NODE_OPTIONS|NODE_PATH|PYTHON\w*|PERL5\w*|PERLLIB|RUBY\w*|GEM_\w+|GIT_\w+|EDITOR|VISUAL|PAGER|SSH_\w+|INBIN_GATE\w*|NPM_CONFIG_\w+|HUSKY\w*|SKIP|PRE_COMMIT\w*|FPATH|MANPATH)$/i;
const ASSIGN = /^([A-Za-z_]\w*)=((?:"(?:[^"\\]|\\.)*"|'[^']*'|[^\s"'])*)(\s+|$)/;

/** git -c keys that only change output, metadata or merge defaults. Others (core.pager, core.editor, core.fsmonitor, core.sshCommand, ...) can run code. */
const BENIGN_GIT_C = /^(color\.[\w.-]+|core\.quotepath|core\.autocrlf|core\.safecrlf|user\.(name|email)|advice\.\w+|log\.\w+|init\.defaultbranch|i18n\.\w+|status\.\w+|diff\.renames|merge\.ff|pull\.(rebase|ff)|column\.\w+)$/i;

/** Aliases defined in the command being classified (`git config alias.x ...` earlier in it), consulted before the repository's own. */
let ALIASES = new Map();
/** Shell functions and aliases defined earlier in the command being classified: their bodies are already counted. */
let DEFINED = new Set();
function gitAlias(name, repo) {
  if (ALIASES.has(name)) return ALIASES.get(name);
  return sh(`git config --get ${JSON.stringify("alias." + name)}`, repo);
}
/** What running `git <alias> <args>` does: the alias body, a git command or (with `!`) a shell command. */
function expandAlias(body, args, repo, depth) {
  if (depth > 2) return ["unknown"];
  return body.startsWith("!") ? consequences(`${body.slice(1)} ${args.join(" ")}`, repo, depth + 1) : classifySegment(`git ${body} ${args.join(" ")}`, repo, depth + 1);
}

/**
 * The dependencies a bare install in the current directory would add: the names in the package.json it reads (the
 * nearest one at or above the directory, within the repository) whose range is new or changed against the baseline.
 * The baseline is that package.json as committed, or, when it is not committed, a lockfile that is tracked and
 * unchanged; with neither, every dependency counts. Null when it cannot be read.
 */
function addedHere(repo) {
  let dir = stateDir(repo); if (!dir) return null;
  while (!existsSync(join(dir, "package.json"))) { if (resolve(dir) === resolve(repo)) return []; dir = dirname(dir); }   // no package.json: nothing to add
  const deps = (p) => Object.assign({}, p?.peerDependencies, p?.optionalDependencies, p?.devDependencies, p?.dependencies);
  const cur = readJson(join(dir, "package.json")); if (!cur) return null;
  const now = deps(cur), rel = relative(repo, join(dir, "package.json"));
  let base = {};
  const committed = git(["show", `HEAD:${rel}`], repo);
  if (committed !== null) { try { base = deps(JSON.parse(committed)); } catch { return null; } }
  else if (pathState(join(dir, "package-lock.json"), repo) === "tracked") {
    const lock = readJson(join(dir, "package-lock.json"));
    if (lock?.packages?.[""]) base = deps(lock.packages[""]);
    else if (lock?.dependencies) base = Object.fromEntries(Object.keys(lock.dependencies).map((k) => [k, now[k]]));   // v1 records names, not ranges
  }
  return Object.keys(now).filter((k) => !(k in base) || base[k] !== now[k]).sort();
}
/** The packages a command's bare installs would add (for the registry rule), following its cd's; null when one cannot be read. */
export function addedDependencies(cmd, repo) {
  const out = new Set(); let unknown = false;
  walkStatements(cmd, repo, 0, (seg) => {
    if (!/^(npm|pnpm|yarn)\s+(install|i|ci)\s*(--\S+\s*)*$/.test(seg.replace(/\s+2>&1|\s+[12]?>\s*\S+/g, "").trim())) return;
    const a = addedHere(repo); if (a === null) unknown = true; else a.forEach((n) => out.add(n));
  });
  return unknown ? null : [...out].sort();
}

/**
 * Everyday git commands the lists did not know (agent-guard-bench holdout19, R8), by what they do. Returns null
 * for anything else.
 */
function classifyEverydayGit(s, repo, depth) {
  const w = shellWords(s); if (w[0] !== "git") return null;
  const sub = w[1], rest = w.slice(2), flags = rest.filter((t) => t.startsWith("-")), args = rest.filter((t) => !t.startsWith("-"));
  if (sub === "config") {
    if (rest.some((t) => /^(--global|--system|--file|-f)$/.test(t) || /^--file=/.test(t)) && !rest.some((t) => /^(--get|--get-all|--get-regexp|-l|--list)$/.test(t)))
      return args.length >= 2 || rest.some((t) => /^--(unset|unset-all|add|replace-all|rename-section|remove-section|edit)$/.test(t)) ? ["privileged"] : ["reads"];   // writes a file outside the repository
    if (rest.some((t) => /^(--get|--get-all|--get-regexp|-l|--list|--get-urlmatch)$/.test(t))) return ["reads"];
    if (flags.some((t) => !/^(--local|--worktree|--show-origin|--show-scope|--null|-z|--type=\w+|--bool|--int|--path)$/.test(t))) return null;
    if (args.length === 1) return ["reads"];   // `git config <key>` prints the value
    if (args.length !== 2) return null;
    const [key, value] = args;
    // an alias does nothing until it runs; what it enables is what its body does
    if (/^alias\./i.test(key)) return expandAlias(value, [], repo, depth);
    if (sh(`git config --get ${JSON.stringify(key)}`, repo) === value) return ["reads"];   // the value it already has
    return null;   // any other change to the repository's configuration: what later commands do changes, which the gate does not model
  }
  if (sub === "worktree") {
    const op = rest[0], wargs = rest.slice(1);
    if (op === "list") return ["reads"];
    if (/^(prune|lock|unlock|repair)$/.test(op ?? "")) return ["git.safe"];
    if (op === "add") {
      const pos = []; for (let i = 0; i < wargs.length; i++) { if (/^(-b|-B|--reason)$/.test(wargs[i])) i++; else if (!wargs[i].startsWith("-")) pos.push(wargs[i]); }
      const p = pos[0]; if (!p || /[$`]/.test(p)) return null;
      const abs = resolve(baseDir(repo), p);
      return isTemp(abs) || !relative(repo, abs).startsWith("..") ? ["git.safe"] : ["privileged"];   // a new directory outside the repository and the temp directory
    }
    if (op === "remove") {
      const p = wargs.find((t) => !t.startsWith("-")); if (!p || /[$`]/.test(p)) return null;
      if (!wargs.some((t) => /^(-f|--force)$/.test(t))) return ["git.safe"];   // git refuses to remove a worktree with changes or untracked files
      const st = git(["-C", resolve(baseDir(repo), p), "status", "--porcelain", "--untracked-files=all"], repo);
      return st === "" ? ["git.safe"] : ["work.delete"];   // --force removes the uncommitted and untracked files in it
    }
    return null;
  }
  if (sub === "gc") return rest.some((t) => /^--prune=(now|all)$/.test(t)) ? ["work.delete"] : ["git.safe"];   // default expiry keeps recent unreachable objects
  // pruning unreachable objects or expiring the reflog removes the last copy of a dropped stash or a reset-away commit
  if (sub === "prune") return rest.some((t) => /^(-n|--dry-run)$/.test(t)) ? ["reads"] : ["work.delete"];
  if (sub === "reflog") return !rest[0] || /^(show|exists)$/.test(rest[0]) || rest[0].startsWith("-") ? ["reads"] : /^(expire|delete)$/.test(rest[0]) ? ["work.delete"] : null;
  // merging and reverting add commits; git refuses to start when local changes would be overwritten
  if (sub === "merge" || sub === "revert") return rest.some((t) => /^--(abort|quit)$/.test(t)) ? null : ["git.safe"];
  if (sub === "update-index") return rest.length && rest.every((t) => /^--(refresh|really-refresh|(no-)?assume-unchanged|(no-)?skip-worktree|q|quiet)$/.test(t) || !t.startsWith("-")) ? ["git.safe"] : null;
  if (sub === "checkout" && (rest.some((t) => /^--(orphan|detach)$/.test(t)) || (rest.length === 1 && isCommit(rest[0], repo)))) return ["git.safe"];   // switching keeps or refuses local changes
  if (sub === "remote" && /^(prune|show|get-url)$/.test(rest[0] ?? "")) return rest[0] === "prune" ? ["git.safe"] : ["reads"];
  if (/^(cat-file|show-ref|for-each-ref|rev-list|ls-tree|count-objects|shortlog|name-rev|var|check-attr|verify-commit|verify-tag|fsck)$/.test(sub ?? "") || sub === "--version" || sub === "version") return ["reads"];
  return null;
}

/**
 * The files a deleting find would remove, listed by running the same find without its action (read-only: -print0
 * only), and classified by their state in one pass. Null when the expression cannot be listed safely (an -o or a
 * comma changes what the action applies to, -fprint and friends write files, a variable, too many matches, a failed
 * read); the caller then keeps the conservative reading.
 */
function classifyFindMatches(roots, expr, recursiveRm, repo) {
  if ([...roots, ...expr].some((t) => /[$`]/.test(t)) || expr.some((t) => /^(-o|-or|,|-fprint|-fprint0|-fprintf|-fls)$/.test(t))) return null;
  const listing = [];
  for (let i = 0; i < expr.length; i++) {
    if (expr[i] === "-delete") continue;
    if (/^-(exec|execdir|ok|okdir)$/.test(expr[i])) { while (i < expr.length && !/^(;|\+)$/.test(expr[i])) i++; continue; }
    listing.push(expr[i]);
  }
  const dir = stateDir(repo); if (!dir) return null;
  let out; try { out = execFileSync("find", [...roots, ...listing, "-print0"], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000, maxBuffer: 4 << 20 }); } catch { return null; }
  const matches = out.split("\0").filter(Boolean); if (matches.length > 2000) return null;
  if (!matches.length) return ["reads"];
  const list = (args) => { const o = git(args, repo); return o === null ? null : new Set(o.split("\0").filter(Boolean)); };
  const ignored = list(["ls-files", "-z", "--others", "--ignored", "--exclude-standard", "--full-name", "--directory"]), untracked = list(["ls-files", "-z", "--others", "--exclude-standard", "--full-name"]);
  const changed = list(["diff", "-z", "--name-only", "HEAD"]);
  if (!ignored || !untracked || !changed) return null;
  const res = new Set();
  for (const m of matches) {
    const abs = resolve(dir, m), rel = relative(repo, abs);
    if (rel.startsWith("..")) { res.add(isTemp(abs) ? "regenerable.delete" : "privileged"); continue; }
    if (rel === "" || rel === ".git" || rel.startsWith(".git/")) { res.add("work.delete"); continue; }
    let st; try { st = statSync(abs); } catch { continue; }
    if (isHookPath(abs, repo)) res.add("checks.disable");
    if (st.isDirectory()) { if (recursiveRm) for (const c of classifySegment(`rm -r ${JSON.stringify(abs)}`, repo, 0)) res.add(c); continue; }   // -delete removes only empty directories
    const underIgnored = [...ignored].some((x) => x === rel || (x.endsWith("/") && rel.startsWith(x)));
    res.add(underIgnored ? "regenerable.delete" : untracked.has(rel) || changed.has(rel) ? "work.delete" : "tracked.delete");
  }
  return res.size ? [...res] : ["reads"];
}

/** `find ... -exec cmd {}` and `find ... -delete` act on what the find matches (listed read-only), or failing that on what it starts from. */
function classifyFind(s, repo, depth) {
  {
    const w = shellWords(s).slice(1), roots = []; while (w.length && !/^[-(!]/.test(w[0])) roots.push(w.shift());
    const execs = []; for (let i = 0; i < w.length; i++) if (/^-(exec|execdir|ok|okdir)$/.test(w[i])) { const c = []; for (i++; i < w.length && !/^(;|\+)$/.test(w[i]); i++) c.push(w[i]); execs.push(c); }
    // only deletion is read this way: -delete, or -exec rm [flags] {} with nothing else run
    if (execs.every((c) => c[0] === "rm" && c.slice(1).every((t) => t === "{}" || /^-[rRfvdI]+$/.test(t)) && c.includes("{}")) && (w.includes("-delete") || execs.length)) {
      const r = classifyFindMatches(roots.length ? roots : ["."], w, execs.some((c) => c.slice(1).some((t) => /^-[a-zA-Z]*[rR]/.test(t))), repo);
      if (r) return r;
    }
  }
  const toks = s.split(/\s+/).slice(1).map((t) => t.replace(/^["']|["']$/g, ""));
  const roots = []; while (toks.length && !/^[-(!]/.test(toks[0])) roots.push(toks.shift());
  if (!roots.length) roots.push(".");
  const out = new Set();
  if (toks.includes("-delete")) for (const c of classifySegment(`rm -r ${roots.join(" ")}`, repo, depth)) out.add(c);
  for (let i = 0; i < toks.length; i++) {
    if (!/^-(exec|execdir|ok|okdir)$/.test(toks[i])) continue;
    const cmd = []; for (i++; i < toks.length && !/^(\\?;|\\|\+)$/.test(toks[i]); i++) cmd.push(toks[i] === "{}" ? roots.join(" ") : toks[i]);
    for (const c of classifySegment(cmd.join(" "), repo, depth)) out.add(c);
  }
  return [...out];
}

// Wrappers run the command underneath them and change nothing this gate judges: a time limit (timeout),
// process priority (nice, ionice), output buffering (stdbuf), timing (time). Each is stripped with its own
// flags and the command underneath is classified. A flag the wrapper does not have, or one that points it
// at something the gate cannot follow (ionice -p, another process), is unknown. The one wrapper effect kept
// is GNU time's -o FILE, which writes its report there: it is classified as a redirect to FILE.
// (env, nohup and xargs are read where they are handled, below and above.)
const WRAPPERS = {
  timeout: { arg: /^(-s|-k|--signal|--kill-after)$/, flag: /^(--signal=\S+|--kill-after=\S+|-s\S+|-k\S+|--preserve-status|--foreground|-v|--verbose)$/, duration: /^\d+(\.\d+)?[smhd]?$/ },
  nice: { arg: /^(-n|--adjustment)$/, flag: /^(--adjustment=[+-]?\d+|-n[+-]?\d+|-[+-]?\d+)$/, alone: true },
  time: { arg: /^(-f|--format|-o|--output)$/, flag: /^(-p|--portability|-v|--verbose|-a|--append|-q|--quiet|--format=.*|--output=.*)$/, alone: true },
  ionice: { arg: /^(-c|--class|-n|--classdata)$/, flag: /^(-c\d|-n\d|-t|--ignore|--class=\S+|--classdata=\S+)$/, alone: true },
  stdbuf: { arg: /^(-i|-o|-e|--input|--output|--error)$/, flag: /^(-[ioe]\S+|--(input|output|error)=\S+)$/ },
};
function unwrap(s) {
  const m = /^(timeout|nice|time|ionice|stdbuf)(\s+|$)/.exec(s); if (!m) return null;
  const name = m[1], spec = WRAPPERS[name]; let rest = s.slice(m[0].length), out = null;
  const take = () => { const t = /^(\S+)(\s+|$)/.exec(rest); if (!t) return null; rest = rest.slice(t[0].length); return t[1]; };
  for (;;) {
    const t = /^\S+/.exec(rest)?.[0];
    if (t === undefined || !t.startsWith("-")) break;
    take();
    if (t === "--") break;
    if (spec.arg.test(t)) { const v = take(); if (v === null) return { unknown: true }; if (name === "time" && /^(-o|--output)$/.test(t)) out = v; continue; }
    if (spec.flag.test(t)) { if (name === "time" && /^--output=/.test(t)) out = t.slice("--output=".length); continue; }
    return { unknown: true };
  }
  if (spec.duration) { const v = take(); if (v === null || !spec.duration.test(v)) return { unknown: true }; }
  if (!rest.trim()) return spec.alone && out === null ? { rest: "" } : { unknown: true };
  if (out !== null) { if (/[\s'"$`]/.test(out)) return { unknown: true }; rest = `${rest} > ${out}`; }
  return { rest };
}

function classifySegment(seg, repo, depth = 0) {
  // stderr/stdout redirections and /dev/null are not file writes
  let s = norm(seg).replace(/\s+2>&1|\s+>&2|\s+[12]?>\s*\/dev\/null|\s+&>\s*\/dev\/null/g, "").trim();
  // `git -C <dir> status` is `git status` run in that directory: paths and state are read there
  const gc = /^git\s+-C\s+(\S+)\s+(.*)$/.exec(s);
  if (gc) { const prev = CWD; followCd(gc[1], repo); try { return classifySegment(`git ${gc[2]}`, repo, depth); } finally { CWD = prev; } }
  if (!s) return [];
  const dis = disarmedChecks(s, repo);
  if (!dis.disable) return classifyStatement(s, repo, depth);
  return [...new Set(["checks.disable", ...(dis.s ? classifyStatement(dis.s, repo, depth) : [])])];
}

/** One statement, after the switches that disarm the hooks are taken out. */
function classifyStatement(s, repo, depth) {
  // a shell function: its body (the rest of this statement and the statements up to its `}`) is classified where it is
  // defined, as if it ran, whatever the arguments; a group `{ ...; }` runs its statements
  let fm = /^(?:function\s+([\w.:-]+)\s*(?:\(\s*\))?|([\w.:-]+)\s*\(\s*\))\s*\{\s*(.*)$/.exec(s);
  if (fm) { DEFINED.add(fm[1] ?? fm[2]); return fm[3] ? classifySegment(fm[3], repo, depth) : ["reads"]; }
  if (/^\{\s+\S/.test(s)) return classifySegment(s.replace(/^\{\s+/, ""), repo, depth);
  if (/^\}$/.test(s) || /^return(\s+\d+)?$/.test(s)) return ["reads"];
  // an alias: its body is classified where it is defined
  if (/^alias\s+\S+=/.test(s)) {
    const out = new Set();
    for (const a of shellWords(s).slice(1)) { const i = a.indexOf("="); if (i < 1) return ["unknown"]; DEFINED.add(a.slice(0, i)); for (const c of consequences(a.slice(i + 1), repo, depth + 1)) out.add(c); }
    return out.size ? [...out] : ["reads"];
  }
  if (/^local\s+/.test(s)) s = s.replace(/^local\s+/, "");   // a function's local variable: an assignment
  s = s.replace(/\s+&$/, "");   // run in the background: the same command
  if (/^nohup\s+/.test(s)) return classifySegment(s.replace(/^nohup\s+/, ""), repo, depth);
  { const w = unwrap(s); if (w) return w.unknown ? ["unknown"] : w.rest ? classifySegment(w.rest, repo, depth) : ["reads"]; }
  // variables: set for one command (`VAR=x cmd`, `env -u X cmd`), exported, or assigned in the shell
  if (!/\$\(|`/.test(s)) {
    let t = s, viaEnv = false, exported = false; const vars = [];
    if (/^env(\s|$)/.test(t)) { viaEnv = true; t = t.replace(/^env\s*/, ""); while (/^(-u\s+\S+|--unset=\S+|-i|--ignore-environment)(\s+|$)/.test(t)) t = t.replace(/^(-u\s+\S+|--unset=\S+|-i|--ignore-environment)(\s+|$)/, ""); t = t.replace(/^--(\s+|$)/, ""); if (/^-/.test(t)) return ["unknown"]; }
    else if (/^export\s+/.test(t)) { exported = true; t = t.replace(/^export\s+/, ""); }
    let m; while ((m = ASSIGN.exec(t))) { vars.push([m[1], unquote(m[2])]); t = t.slice(m[0].length); }
    if (vars.length || viaEnv || exported) {
      if (exported && t) return ["unknown"];
      if (!t && !viaEnv && !exported) return vars.some(([k]) => SHELL_SENSITIVE.test(k)) ? ["unknown"] : ["reads"];   // a shell variable: nothing runs
      if (!vars.every(([k, v]) => benignEnv(k, v))) return ["unknown"];
      return t ? classifySegment(t, repo, depth) : ["reads"];
    }
  }
  // shell loops and conditionals: the keywords do nothing by themselves, the body segments are classified
  // on their own (`for f in notes/*; do cat "$f"; done` splits into four segments). A header that runs a
  // command substitution is unknown.
  s = s.replace(/^(do|then|else)\s+/, "");
  // a command substitution runs whatever is inside it. The one common benign form is a heredoc message
  // (`git commit -m "$(cat <<'EOF' ... EOF )"`, Claude Code's commit style); any other is unknown.
  // (shellLines has removed the heredoc's body; a flattened one, from a `bash -c` string, is matched too)
  if (/\$\(|`/.test(s.replace(/\$\(cat <<-?\s*['"]?(\w+)['"]?(?:\s.*?\s\1)?\s*\)/g, '"<heredoc>"'))) return ["unknown"];
  // a call to a function or alias defined earlier in the command: its body is already counted
  { const w0 = /^([\w.:-]+)(\s|$)/.exec(s)?.[1]; if (w0 && DEFINED.has(w0)) return ["reads"]; }
  if (/^(done|fi|esac|do|then|else)(\s*<\s*\S+)?$/.test(s)) return ["reads"];
  if (/^(for\s+\w+\s+in\b|while\b|until\b|if\b|elif\b|case\b)/.test(s)) return /\$\(|`/.test(s) ? ["unknown"] : ["reads"];
  // the repository's own test runner, invoked directly, is a read like `npm test`
  if (/^(npx\s+(--no-install\s+)?|node_modules\/\.bin\/|node\s+(--[\w-]+\s+)*node_modules\/\.bin\/)(uvu|ava|jest|mocha|vitest|tap|node --test)\b/.test(s)) return ["reads"];
  if (/^(true|false|:|exit \d+)$/.test(s)) return ["reads"];
  if (/^(sudo|doas|su)\b/.test(s) || /\b(chown|chmod)\b.*(~|\/Users|\/home|\/etc|\/usr)/.test(s)) return ["privileged"];
  // awk's `>` inside the program writes a file; without one it only prints
  if (/^awk\b/.test(s)) return />/.test(s) ? ["unknown"] : ["reads"];
  // a redirect is a write to its destination, whatever the statement starts with (`echo x > notes/todo.md`
  // is not a read). Checked before the read list and before self-protection, so that both see it. The
  // destination's consequence is added to the command's own, not put in its place (agent-guard-bench
  // holdout19, R2: `nohup git reset --hard >/tmp/reset.log` was classed by its log file). A command that only
  // reads or prints is described by where its output goes.
  const reds = [...s.matchAll(/[>]{1,2}\s*(\S+)/g)];
  if (reds.length) {
    const own = classifySegment(s.replace(/(?:\d+|&)?>{1,2}\s*\S+/g, " ").trim(), repo, depth).filter((c) => c !== "reads");
    return [...new Set([...redirectDestination(reds[reds.length - 1][1].replace(/^["']|["']$/g, ""), repo), ...own])];
  }
  return classifyCommand(s, repo, depth);
}

/** What writing (truncating) a redirect's destination does. */
function redirectDestination(dest, repo) {
  if (isHookPath(dest, repo, true)) return ["checks.disable", ...redirectDestinationState(dest, repo)];   // overwriting a hook: what runs is no longer the repository's check
  return redirectDestinationState(dest, repo);
}
function redirectDestinationState(dest, repo) {
  if (/(^|\/)(\.bob|\.gate|gate)\//.test(dest) || /\.bob(modes|ignore)$/.test(dest)) return ["privileged"];
  if (isTemp(dest)) return ["regenerable.delete"];
  if (/\$|`/.test(dest)) return ["unknown"];   // a variable or substitution: the destination is not known
  if (dest === "~" || /^(~\/|"?\$\{?HOME\}?)/.test(dest)) return ["privileged"];   // the home directory, which pathState would resolve against the repo
  const st = pathState(dest, repo);
  return st === "untracked" || st === "modified" || st === "repository" ? ["work.delete"] : st === "outside" ? ["privileged"] : st === "ignored" ? ["regenerable.delete"] : st === "missing" ? ["reads"] : ["tracked.delete"];
}

/** A statement without redirects: what the command itself does. */
function classifyCommand(s, repo, depth) {
  // `git -c key=value <command>`: the command, unless a key can change what it runs; an alias given this way is expanded
  if (/^git\s+-c\s/.test(s)) {
    const w = shellWords(s); let i = 1; const local = new Map();
    while (w[i] === "-c" && i + 1 < w.length) {
      const [k, ...v] = w[i + 1].split("="), val = v.join("=");
      if (/^alias\./i.test(k)) local.set(k.slice(6), val);
      else if (!(BENIGN_GIT_C.test(k) || (/^core\.hookspath$/i.test(k) && !changesHooksPath(val, repo)))) return ["unknown"];
      i += 2;
    }
    const sub = w[i], args = w.slice(i + 1);
    if (sub && local.has(sub)) return expandAlias(local.get(sub), args, repo, depth);
    return classifySegment(["git", ...w.slice(i)].map((x) => (/[\s'"]/.test(x) ? JSON.stringify(x) : x)).join(" "), repo, depth);
  }
  // the gate's home (the signing secret, the intent, the Telegram token): even READING it is
  // privileged, because with the secret the agent could sign its own intent
  if (/\.inbin-gate\b|INBIN_GATE_HOME/.test(s)) return ["privileged"];
  // the gate's own files and Bob's configuration: any write, move, removal or permission change is
  // privileged; reading them is a read (`git ls-files .gate/` was refused in the real-repository run)
  if (/(^|[\s/"'])(\.bob\b|\.gate\b|gate\/(hook|decide|core|consequences|authority)|\.bobmodes|\.bobignore)/.test(s) && !READ.test(s) && !PURE_READ.test(s)) return ["privileged"];
  if (/^cd\s+\S+$/.test(s)) return ["reads"];
  if (/^sed\b/.test(s)) return /(^|\s)(-[a-zA-Z]*i[a-zA-Z]*|--in-place)(\s|=|$)/.test(s) ? ["unknown"] : ["reads"];
  if (/^sort\b/.test(s)) return /(^|\s)(-o|--output)\b/.test(s) ? ["unknown"] : ["reads"];
  if (PRINT_ONLY.test(s)) return ["reads"];
  if (/^find\b/.test(s) && /\s-(exec|execdir|ok|okdir|delete)(\s|$)/.test(s)) return classifyFind(s, repo, depth);
  // xargs runs its command with arguments read from its input: classified as that command on an unknown argument
  if (/^xargs(\s|$)/.test(s)) {
    const w = shellWords(s).slice(1); let repl = null;
    while (w.length && w[0].startsWith("-")) { const f = w.shift(); if (/^-[nPLsdEaI]$|^--(max-args|max-procs|delimiter|arg-file|replace)$/.test(f)) { const v = w.shift(); if (f === "-I" || f === "--replace") repl = v; } else if (/^-I./.test(f)) repl = f.slice(2); }
    if (!w.length) return ["reads"];   // xargs alone echoes its input
    const cmd = repl ? w.map((t) => t.split(repl).join('"$XARGS"')) : [...w, '"$XARGS"'];
    return classifySegment(cmd.map((t) => (/^"\$XARGS"$/.test(t) || !/[\s'"]/.test(t) ? t : JSON.stringify(t))).join(" "), repo, depth);
  }
  // tee writes every file it names, as a redirect does
  if (/^tee(\s|$)/.test(s)) {
    const files = shellWords(s).slice(1).filter((t) => !t.startsWith("-"));
    const out = new Set(files.flatMap((f) => redirectDestination(f, repo)));
    return out.size ? [...out] : ["reads"];
  }
  const refs = classifyGitRefs(s, repo); if (refs) return refs;
  if (!/(^|\s)--hard(\s|$)/.test(s)) { const rs = classifyRestore(s, repo); if (rs) return rs; }
  if (READ.test(s) || PURE_READ.test(s)) return ["reads"];
  // deletions: rm, rm -rf, git rm, git clean
  let m = /^(?:rm|rmdir)\s+(?:-[a-zA-Z]+\s+)*(.+)$/.exec(s);
  if (m) {
    const out = new Set();
    for (const raw of m[1].split(/\s+/)) {
      const p = raw.replace(/^["']|["']$/g, "");
      if (p === "/" || p === "~" || p.startsWith("~/")) { out.add("privileged"); continue; }
      if (isHookPath(p, repo)) out.add("checks.disable");
      if (containsRepo(p, repo)) out.add("work.delete");   // the repository goes with it, wherever it lives (also in the temp directory)
      if (isTemp(p)) { if (!containsRepo(p, repo)) out.add("regenerable.delete"); continue; }
      if (/\$|`/.test(p)) { out.add("unknown"); continue; }   // a variable or substitution: the target is not known
      const st = pathState(p, repo);   // absolute paths are resolved against the repo: inside is classified by state, outside is privileged
      if (st === "outside") out.add("privileged");
      else if (st === "ignored" || st === "missing") out.add("regenerable.delete");
      else if (st === "tracked") out.add("tracked.delete");
      else out.add("work.delete");   // untracked, modified, or the repository itself
    }
    return [...out];
  }
  if (/^git clean\b/.test(s)) {
    if (shellWords(s).some((t) => t === "--dry-run" || (/^-[a-zA-Z]+$/.test(t) && t.includes("n")))) return ["reads"];
    return classifyClean(s, repo) ?? ["work.delete"];   // a state read that fails keeps the conservative class
  }
  m = /^git rm\b(?:\s+-[a-zA-Z]+)*\s+(.+)$/.exec(s);
  if (m) {
    const ps = m[1].split(/\s+/), out = new Set(ps.map((p) => (pathState(p, repo) === "modified" ? "work.delete" : "tracked.delete")));
    if (!/(^|\s)--cached\b/.test(s) && ps.some((p) => isHookPath(p, repo))) out.add("checks.disable");
    return [...out];
  }
  // history
  m = /^git (?:reset|rebase)\b/.exec(s);
  if (m) {
    if (/(^|\s)--hard(\s|$)/.test(s) && /^git reset\b/.test(s)) {
      // what reset --hard throws away is whatever is uncommitted: read from the working tree
      const pos = shellWords(s).slice(2).filter((t) => !t.startsWith("-"));
      if (pos.length > 1 || (pos.length && !isCommit(pos[0], repo))) return ["work.delete"];
      if (discardLoses(pos[0] ?? null, repo)) return ["work.delete"];
      return pos.length && !sameCommit(pos[0], "HEAD", repo) ? ["history.local"] : ["git.safe"];   // moving the branch: the reflog keeps it
    }
    if (/--hard/.test(s)) return ["work.delete"];
    if (/^git rebase (main|origin\/main|--continue|--abort)/.test(s) && !/-i|--interactive/.test(s)) return ["git.safe"];
    // rewriting the LOCAL branch is reversible from the reflog whatever the commits are; what
    // makes history irreversible for others is publishing the rewrite, and that is the push
    return ["history.local"];
  }
  if (/^git commit --amend/.test(s)) return ["history.local"];
  // flags are read outside quoted strings: a commit message that says "clean up" is not `git clean`
  // (found on Claude Code: `git commit -m "refactor: clean up ..."` was refused as rewriting shared history)
  const unquoted = s.replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, '""');
  if (/^git push\b/.test(s)) {
    // --dry-run (-n) talks to the remote and publishes nothing (agent-guard-bench holdout19, R10); letters after -o are its value
    if (unquoted.split(/\s+/).some((t) => t === "--dry-run" || (/^-[a-zA-Z]+$/.test(t) && t.slice(1).split("o")[0].includes("n")))) return ["reads"];
    return DESTRUCTIVE_FLAGS.test(unquoted) || /\+\S+:/.test(unquoted) ? ["history.shared"] : ["push"];
  }
  if (/^git checkout\s+--\s/.test(s) || /^git restore\b/.test(s)) return ["work.delete"];   // a form classifyRestore does not read: assume it discards changes
  { const ev = classifyEverydayGit(s, repo, depth); if (ev) return ev; }
  if (DESTRUCTIVE_FLAGS.test(unquoted) && /^git /.test(s)) return ["history.shared"];
  if (SAFE_GIT.test(s)) return ["git.safe"];
  // naming a package adds it; flags alone (`npm install --no-audit`) are a bare install, read below
  if (/^(npm|pnpm|yarn)\s+(install|i|add)\s+\S/.test(s) && shellWords(s).slice(2).some((t) => !t.startsWith("-"))) return ["dependency.add"];
  if (/^(npm|pnpm|yarn)\s+(install|i|ci)\s*(--\S+\s*)*$/.test(s)) {
    // a bare install installs what its package.json lists: it adds only what that file adds over its baseline
    const added = addedHere(repo);
    return added === null || added.length ? ["dependency.add"] : ["regenerable.delete"];
  }
  if (/^(mv|cp)\s/.test(s)) {
    const parts = s.split(/\s+/).slice(1).filter((x) => !x.startsWith("-"));
    const dest = parts[parts.length - 1]; const st = dest ? pathState(dest, repo) : "missing";
    const out = [st === "missing" || st === "ignored" ? "tracked.delete" : "work.delete"]; // cp/mv onto an existing untracked/modified file overwrites work
    // moving a hook (or the hooks directory) away, or copying something over one, disarms that check
    if ((/^mv/.test(s) && parts.slice(0, -1).some((p) => isHookPath(p, repo))) || isHookPath(dest, repo, true)) out.unshift("checks.disable");
    return out;
  }
  if (/^(mkdir|touch)\s/.test(s)) return ["reads"];
  // taking the execute bit away from a hook: git skips a hook that is not executable
  if (/^chmod\s/.test(s)) {
    const toks = s.split(/\s+/).slice(1).filter((t) => !/^(-[RvfcH]+|--\w[\w-]*)$/.test(t));
    if (toks.length > 1 && removesExec(toks[0]) && toks.slice(1).some((p) => isHookPath(unquote(p), repo))) return ["checks.disable"];
  }
  // Running code that lives in the repository. The object is what the developer can name: a file,
  // a package.json script, an installed binary. Inline code (-e, -c) has no name and stays unknown;
  // a shell's -c string is classified as the command it is.
  if (depth < 2) {
    m = /^(bash|sh|zsh)\s+-c\s+(["'])(.*)$/.exec(s);
    if (m) return consequences(m[3].replace(new RegExp(m[2] + "$"), ""), repo, depth + 1);
    m = /^(npm|pnpm|yarn)\s+(?:run|run-script)\s+(\S+)/.exec(s) || /^yarn\s+([^-\s]\S*)$/.exec(s);
    if (m) {
      const name = m[m.length - 1]; const pkg = readJson(join(repo, "package.json"));
      const body = pkg?.scripts?.[name]; if (typeof body !== "string") return ["unknown"];
      const rest = consequences(body, repo, depth + 1).filter((c) => !c.startsWith("code.run:"));
      return [`code.run:${name}`, ...rest];
    }
    m = /^npx\s+((?:--?[\w-]+\s+)*)(\S+)/.exec(s);
    if (m) return binExists(m[2], repo) ? [`code.run:${m[2]}`] : /--no-install/.test(m[1]) ? ["unknown"] : ["dependency.add"];
    m = /^(?:\.\/)?node_modules\/\.bin\/([^\s/]+)/.exec(s);
    if (m) return [`code.run:${m[1]}`];
    m = INTERP.exec(s);
    if (m) {
      const args = s.slice(m[0].length).split(/\s+/); const flags = [];
      while (args.length && args[0].startsWith("-")) { const f = args.shift(); flags.push(f); if (/^(-r|--require|--import|--loader|--experimental-loader)$/.test(f)) args.shift(); }
      if (flags.some((f) => /^(-c|--check)$/.test(f)) && m[1] === "node") return ["reads"];
      if (flags.some((f) => /^(-e|--eval|-p|--print|-c)$/.test(f))) return ["unknown"];
      const file = (args[0] || "").replace(/^["']|["']$/g, ""); if (!file) return ["unknown"];
      return runFile(file, repo);
    }
    m = /^([^\s/]+)(\s|$)/.exec(s);
    if (m && binExists(m[1], repo)) return [`code.run:${m[1]}`];
  }
  // `git <alias>`: what the alias runs (git ignores an alias that shadows a git command, which never gets here)
  m = /^git\s+([\w.-]+)(.*)$/.exec(s);
  if (m) { const body = gitAlias(m[1], repo); if (body !== null) return expandAlias(body, shellWords(m[2]), repo, depth); }
  return ["unknown"];
}

/**
 * The logical lines of a command, as the shell reads them (agent-guard-bench holdout19, R1). A newline outside
 * quotes and command substitutions ends a statement, unless the line ends with `|`, `&&` or `||`; a backslash
 * before a newline joins the lines. A heredoc's body is data for the command that consumes it: the body is
 * removed and the command (`cat > x.sh <<EOF`, `git commit -F - <<EOF`, `bash <<EOF`) stays, to be classified.
 * Comments are dropped. Where this reader is unsure it keeps text rather than dropping it: an unrecognised
 * heredoc leaves its body to be classified as commands, which refuses more, never less.
 */
export function shellLines(cmd) {
  const src = String(cmd ?? "");
  const lines = []; const stack = []; const pending = [];
  let cur = "", i = 0;
  const ctx = () => stack[stack.length - 1]?.t;
  const quoted = () => ctx() === "'" || ctx() === '"';
  while (i < src.length) {
    const ch = src[i], c = ctx();
    if (c === "'") { cur += ch; i++; if (ch === "'") stack.pop(); continue; }
    if (ch === "\\") {
      if (src[i + 1] === "\n") { i += 2; continue; }   // line continuation
      cur += src.slice(i, i + 2); i += 2; continue;
    }
    if (c === '"') {
      if (ch === '"') { stack.pop(); cur += ch; i++; continue; }
      if (src.startsWith("$(", i)) { stack.push({ t: "$(", d: 1 }); cur += "$("; i += 2; continue; }
      if (ch === "`") { stack.push({ t: "`" }); cur += ch; i++; continue; }
      cur += ch; i++; continue;
    }
    // not in a quoted string: top level, $( ), ` `, or arithmetic (( ))
    if (ch === "\n") {
      if (pending.length) {   // the heredoc bodies start on the next line; skip them
        let j = i + 1;
        while (pending.length && j <= src.length) {
          const { delim, tabs } = pending[0];
          let e = src.indexOf("\n", j); if (e < 0) e = src.length;
          const line = src.slice(j, e);
          if ((tabs ? line.replace(/^\t+/, "") : line) === delim) pending.shift();
          j = e + 1;
        }
        pending.length = 0;
        i = j - 1;   // src[i] is the newline after the last body (or past the end), handled below as this line's end
        if (i >= src.length) break;
      }
      if (stack.length) cur += "\n";
      else if (/(\||&&|\|\|)\s*$/.test(cur)) cur += " ";
      else { lines.push(cur); cur = ""; }
      i++; continue;
    }
    if (ch === "'" && c !== "((") { stack.push({ t: "'" }); cur += ch; i++; continue; }
    if (ch === '"' && c !== "((") { stack.push({ t: '"' }); cur += ch; i++; continue; }
    if (ch === "`") { if (c === "`") stack.pop(); else stack.push({ t: "`" }); cur += ch; i++; continue; }
    if (src.startsWith("$((", i) || (src.startsWith("((", i) && /(^|[\s;&|(])$/.test(cur))) {
      const n = src[i] === "$" ? 3 : 2; stack.push({ t: "((", d: 2 }); cur += src.slice(i, i + n); i += n; continue;
    }
    if (src.startsWith("$(", i)) { stack.push({ t: "$(", d: 1 }); cur += "$("; i += 2; continue; }
    if ((c === "$(" || c === "((") && (ch === "(" || ch === ")")) {
      const top = stack[stack.length - 1]; top.d += ch === "(" ? 1 : -1; if (top.d === 0) stack.pop();
      cur += ch; i++; continue;
    }
    if (ch === "#" && c !== "((" && /(^|[\s;&|(])$/.test(cur)) {   // a comment runs to the end of the line
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (ch === "<" && src.startsWith("<<", i) && !src.startsWith("<<<", i) && c !== "((") {
      let j = i + 2; const tabs = src[j] === "-"; if (tabs) j++;
      while (src[j] === " " || src[j] === "\t") j++;
      let delim = "", k = j;
      while (k < src.length && !/[\s;&|<>()]/.test(src[k])) {
        if (src[k] === "'" || src[k] === '"') { const e = src.indexOf(src[k], k + 1); if (e < 0) break; delim += src.slice(k + 1, e); k = e + 1; }
        else if (src[k] === "\\") { delim += src[k + 1] ?? ""; k += 2; }
        else delim += src[k++];
      }
      if (delim && !/^\d+$/.test(delim)) pending.push({ delim, tabs });
      cur += src.slice(i, k); i = k; continue;
    }
    cur += ch; i++;
  }
  lines.push(cur);
  return lines.filter((l) => l.trim());
}

/**
 * The statements of one line, each as its pipeline's stages, split on `&&`, `||`, `;`, `&` and `|` only outside
 * quotes and command substitutions (agent-guard-bench holdout19, R9: a `;` inside a commit message is not a
 * separator). `>&`, `&>` and `2>&1` are redirections, not separators.
 */
export function shellStatements(line) {
  const out = []; let stages = [], cur = "", q = null, depth = 0;
  const endStage = () => { stages.push(cur.trim()); cur = ""; };
  const endStatement = () => { endStage(); if (stages.some(Boolean)) out.push(stages.filter(Boolean)); stages = []; };
  for (let i = 0; i < line.length; i++) {
    const ch = line[i], nx = line[i + 1];
    if (q === "'") { cur += ch; if (ch === "'") q = null; continue; }
    if (ch === "\\") { cur += ch + (nx ?? ""); i++; continue; }
    if (q === '"') {
      cur += ch;
      if (ch === "$" && nx === "(") { depth++; cur += nx; i++; } else if (depth > 0 && ch === "(") depth++; else if (depth > 0 && ch === ")") depth--; else if (ch === '"' && depth === 0) q = null;
      continue;
    }
    if (ch === "'" || ch === '"') { q = ch; cur += ch; continue; }
    if (ch === "$" && nx === "(") { depth++; cur += "$("; i++; continue; }
    if (depth > 0) { if (ch === "(") depth++; else if (ch === ")") depth--; cur += ch; continue; }
    if ((ch === "&" && nx === "&") || (ch === "|" && nx === "|")) { endStatement(); i++; continue; }
    if (ch === ";") { endStatement(); continue; }
    if (ch === "|") { endStage(); if (nx === "&") i++; continue; }
    if (ch === "&" && nx !== ">" && !/[<>]$/.test(cur)) { endStatement(); continue; }
    cur += ch;
  }
  endStatement();
  return out;
}

/**
 * Run `fn` on each statement of a command in order, every stage of every pipeline, with the aliases it defines and
 * the directory its cd's move to in effect. Returns the pipelines.
 */
function walkStatements(cmd, repo, depth, fn) {
  const pipelines = shellLines(cmd).flatMap((l) => shellStatements(l));
  const segs = pipelines.flatMap((p) => p.map((st) => norm(st))).filter(Boolean);
  const savedAliases = ALIASES, savedCwd = CWD, savedDefined = DEFINED; ALIASES = new Map(savedAliases); DEFINED = new Set(savedDefined); if (depth === 0) CWD = null;
  for (const seg of segs) { const w = shellWords(seg); if (w[0] === "git" && w[1] === "config") { const k = w.slice(2).filter((t) => !t.startsWith("-")); if (k.length === 2 && /^alias\./i.test(k[0])) ALIASES.set(k[0].slice(6), k[1]); } }
  try {
    for (const p of pipelines) {
      for (const st of p) { const seg = norm(st); if (seg) fn(seg); }
      const m = p.length === 1 && /^cd(?:\s+(.*))?$/.exec(norm(p[0])); if (m) followCd(m[1], repo);   // a cd inside a pipeline runs in a subshell
    }
  } finally { ALIASES = savedAliases; CWD = savedCwd; DEFINED = savedDefined; }
  return pipelines;
}

/** All consequences of a (possibly chained, possibly multi-line) command, as a sorted unique list. */
export function consequences(cmd, repo, depth = 0) {
  const out = new Set();
  const pipelines = walkStatements(cmd, repo, depth, (seg) => { for (const c of classifySegment(seg, repo, depth)) out.add(c); });
  // a pipe into sh/bash executes remote or generated content (a heredoc body or a quoted string that mentions one is data)
  if (pipelines.some((p) => p.slice(1).some((st) => /^(sudo\s+)?(sh|bash|zsh)\b/.test(st.trim())))) out.add("unknown");
  return [...out].sort();
}

export const DEFAULT_GRANT = new Set(["reads", "regenerable.delete", "tracked.delete", "history.local", "git.safe"]);
export function coveredByDefault(cs) { return cs.length > 0 && cs.every((c) => DEFAULT_GRANT.has(c)); }
