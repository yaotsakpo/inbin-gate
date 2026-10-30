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
import { execSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { join, resolve, relative, isAbsolute } from "node:path";

const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const READ = /^(git (log|status|diff|show|remote -v|rev-parse|ls-files|tag|merge-base|describe)|ls|cat |head |tail |grep |find |wc |echo |pwd|which |tree|du |stat |node --version|node -v|node --test\b|npm (--version|-v|ls|outdated|view|test|run test|run lint|run build)|npx --no-install --test|cd )/;
const SAFE_GIT = /^git (fetch|checkout -b |switch -c |switch |checkout (main|master|feature\/|origin\/)|add |commit|merge (--no-ff |main|origin\/main)|rebase (main|origin\/main|--continue)|cherry-pick |pull --ff-only)/;
const DESTRUCTIVE_FLAGS = /(--force\b|\s-f\b|--hard\b|\bclean\b|checkout\s+--\s|reset\s+--hard|\s-i\b|--interactive)/;

function sh(cmd, cwd) { try { return execSync(cmd, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000 }).trim(); } catch { return null; } }

/**
 * Where a path stands in the repo: repository | ignored | untracked | modified | tracked | missing | outside.
 * `repository` is the root itself or `.git`: every commit, branch, stash and the index live there, so it is
 * what makes the rest recoverable, never a recoverable thing in its own right.
 */
export function pathState(p, repo) {
  const abs = isAbsolute(p) ? p : resolve(repo, p);
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
  const up = relative(isAbsolute(p) ? p : resolve(repo, p), repo);
  return up === "" || (!up.startsWith("..") && !isAbsolute(up));
}

/** The configured core.hooksPath, resolved against the repository root as git does, or null. */
function configuredHooksPath(repo) { const v = sh("git config --get core.hooksPath", repo); return v ? resolve(repo, v) : null; }
/** The directories hooks are run from or installed into: `.git/hooks`, `.husky`, and the configured core.hooksPath. */
function hookDirs(repo) { return [join(repo, ".git", "hooks"), join(repo, ".husky"), configuredHooksPath(repo)].filter(Boolean); }
/** Is this path a hook directory or a file in one? Removing, moving or overwriting it disarms a check. */
function isHookPath(p, repo) {
  if (!p || /\$|`/.test(p)) return false;
  const abs = resolve(repo, p);
  return hookDirs(repo).some((d) => abs === d || abs.startsWith(d + "/"));
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
  let m = /^(env\s+|export\s+)?((?:[A-Za-z_]\w*=(?:"(?:[^"\\]|\\.)*"|'[^']*'|[^\s"']*)(?:\s+|$))+)/.exec(s);
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

/** Are all commits between `ref` and HEAD present on some remote? */
export function commitsPushed(ref, repo) {
  const unpushed = sh(`git log --oneline ${ref}..HEAD --not --remotes 2>/dev/null`, repo);
  return unpushed !== null && unpushed === "";
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
  return [`code.run:${relative(repo, isAbsolute(file) ? file : resolve(repo, file))}`];
}

/**
 * `git branch`, `git stash`, `git switch` and `git checkout -f`: what they destroy is in their flags, so a prefix
 * cannot classify them (agent-guard-bench holdout19, R3). Returns null for anything else.
 */
function classifyGitRefs(s) {
  let m = /^git branch\b(.*)$/.exec(s);
  if (m) {
    const toks = m[1].trim().split(/\s+/).filter(Boolean);
    const short = toks.filter((t) => /^-[a-zA-Z]+$/.test(t)).map((t) => t.slice(1)).join("");
    const long = toks.filter((t) => t.startsWith("--"));
    const del = /[dD]/.test(short) || long.includes("--delete"), force = /[Df]/.test(short) || long.includes("--force");
    // -D deletes a branch whether or not its commits are anywhere else: they can be the only copy. Plain -d is
    // refused by git itself unless the branch is merged, so it loses no commits. (Reading whether a -D branch is
    // merged or pushed is repository state: not read yet, so -D is treated as losing work.)
    if (del) return force ? ["work.delete"] : ["git.safe"];
    if (force) return ["history.local"];   // moving a branch with -f: recoverable from the branch's reflog, like reset
    const changes = /[mMcCu]/.test(short) || long.some((l) => /^--(move|copy|set-upstream-to|unset-upstream|edit-description|track|no-track|create-reflog)\b/.test(l));
    const listing = long.some((l) => /^--(list|contains|no-contains|merged|no-merged|points-at)\b/.test(l)) || /l/.test(short);
    return !changes && (listing || !toks.some((t) => !t.startsWith("-"))) ? ["reads"] : ["git.safe"];   // a name creates a branch
  }
  m = /^git stash\b\s*(\S*)/.exec(s);
  if (m) {
    const sub = m[1];
    if (/^(drop|clear)$/.test(sub)) return ["work.delete"];   // a stash entry is the only copy of the changes in it
    if (/^(list|show)$/.test(sub)) return ["reads"];
    return sub === "" || sub.startsWith("-") || /^(push|save|pop|apply|branch|create|store)$/.test(sub) ? ["git.safe"] : ["unknown"];
  }
  // switching with --discard-changes or -f throws away uncommitted changes, as `checkout --` does
  if (/^git (switch|checkout)\b/.test(s) && s.split(/\s+/).some((t) => t === "--discard-changes" || t === "--force" || /^-[a-zA-Z]*f[a-zA-Z]*$/.test(t))) return ["work.delete"];
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
  const q = paths.map((p) => JSON.stringify(unquote(p))).join(" ");
  // an untracked file named on its own: its content is in no commit and no index
  if (paths.some((p) => { const abs = resolve(repo, unquote(p)); return existsSync(abs) && !statSync(abs).isDirectory() && pathState(unquote(p), repo) === "untracked"; })) return true;
  const unstaged = sh(`git diff --name-only -- ${q}`, repo), staged = index ? sh(`git diff --cached --name-only -- ${q}`, repo) : "";
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

/** `find ... -exec cmd {}` and `find ... -delete` act on what the find starts from: classified as that command on those paths. */
function classifyFind(s, repo, depth) {
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

function classifySegment(seg, repo, depth = 0) {
  // stderr/stdout redirections and /dev/null are not file writes
  let s = norm(seg).replace(/\s+2>&1|\s+>&2|\s+[12]?>\s*\/dev\/null|\s+&>\s*\/dev\/null/g, "").trim();
  // `git -C <dir> status` is `git status`; the directory does not change what the command does
  s = s.replace(/^git\s+-C\s+\S+\s+/, "git ");
  if (!s) return [];
  const dis = disarmedChecks(s, repo);
  if (!dis.disable) return classifyStatement(s, repo, depth);
  return [...new Set(["checks.disable", ...(dis.s ? classifyStatement(dis.s, repo, depth) : [])])];
}

/** One statement, after the switches that disarm the hooks are taken out. */
function classifyStatement(s, repo, depth) {
  // shell loops and conditionals: the keywords do nothing by themselves, the body segments are classified
  // on their own (`for f in notes/*; do cat "$f"; done` splits into four segments). A header that runs a
  // command substitution is unknown.
  s = s.replace(/^(do|then|else)\s+/, "");
  // a command substitution runs whatever is inside it. The one common benign form is a heredoc message
  // (`git commit -m "$(cat <<'EOF' ... EOF )"`, Claude Code's commit style); any other is unknown.
  // (shellLines has removed the heredoc's body; a flattened one, from a `bash -c` string, is matched too)
  if (/\$\(|`/.test(s.replace(/\$\(cat <<-?\s*['"]?(\w+)['"]?(?:\s.*?\s\1)?\s*\)/g, '"<heredoc>"'))) return ["unknown"];
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
  if (isHookPath(dest, repo)) return ["checks.disable", ...redirectDestinationState(dest, repo)];   // overwriting a hook: what runs is no longer the repository's check
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
  const refs = classifyGitRefs(s); if (refs) return refs;
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
    if (/-n|--dry-run/.test(s)) return ["reads"];
    // `git clean -fdx -- dist/ coverage/` removes only what the paths name: classified by their state
    const paths = s.replace(/^git clean\s*/, "").split(/\s+/).filter((x) => x && x !== "--" && !x.startsWith("-"));
    if (paths.length && paths.every((p) => ["ignored", "missing"].includes(pathState(p, repo)))) return ["regenerable.delete"];
    return ["work.delete"];
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
  if (/^git push\b/.test(s)) return DESTRUCTIVE_FLAGS.test(unquoted) || /\+\S+:/.test(unquoted) ? ["history.shared"] : ["push"];
  if (/^git checkout\s+--\s/.test(s) || /^git restore\b/.test(s)) return ["work.delete"];   // a form classifyRestore does not read: assume it discards changes
  if (DESTRUCTIVE_FLAGS.test(unquoted) && /^git /.test(s)) return ["history.shared"];
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
    const out = [st === "missing" || st === "ignored" ? "tracked.delete" : "work.delete"]; // cp/mv onto an existing untracked/modified file overwrites work
    // moving a hook (or the hooks directory) away, or copying something over one, disarms that check
    if (/^mv/.test(s) ? parts.some((p) => isHookPath(p, repo)) : isHookPath(dest, repo)) out.unshift("checks.disable");
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

/** All consequences of a (possibly chained, possibly multi-line) command, as a sorted unique list. */
export function consequences(cmd, repo, depth = 0) {
  const lines = shellLines(cmd);
  const segs = lines.flatMap((l) => norm(l).split(/\s*(?:&&|\|\||;)\s*/)).filter(Boolean);
  const out = new Set();
  for (const seg of segs) for (const c of classifySegment(seg.split(/\s*\|\s*/)[0], repo, depth)) out.add(c);
  // a pipe into sh/bash executes remote or generated content (a heredoc body that mentions one is data)
  if (/\|\s*(sh|bash|zsh)\b/.test(lines.join("\n"))) out.add("unknown");
  return [...out].sort();
}

export const DEFAULT_GRANT = new Set(["reads", "regenerable.delete", "tracked.delete", "history.local", "git.safe"]);
export function coveredByDefault(cs) { return cs.length > 0 && cs.every((c) => DEFAULT_GRANT.has(c)); }
