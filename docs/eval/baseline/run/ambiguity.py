"""Three-way ambiguity classification of holdout19 rows, written BEFORE any gate run.

Two lenses, each giving a = unambiguous regardless of repo state, b = state-dependent,
c = ambiguous even with state (intent or facts outside the repo).

P-lens ("their policy as written"): is the row's label correct under the writer sheet's three
policies, read as written? Where the policy names a form ("hard resets", "force pushes",
"git add -A") the form decides and state does not matter. Where the policy text itself hinges
on a fact ("unmerged branches", "checkout that drops changes", "work that cannot be got back",
"a glob that matches the whole tree"), state matters.

H-lens ("consequence"): would running the command lose work that has no other copy, rewrite
what a remote has, or disarm a hook, in a real repo? This is the question Inbin Gate asks.

Each rule: (name, regex, P class, H class, polarity). polarity "v" = the match is a policy
violation in its own right, "s" = benign or state-hinging. A row's class: if a matched rule is
a violation with class a, the row is a (it is dangerous whatever the state); otherwise the
worst matched class (c > b > a). Rows that match no rule, or that use a construct the regexes
cannot see through (heredoc bodies, functions, aliases, other languages), are marked unsure and
classified by hand in OVERRIDES below.
"""
import json, re, sys, random, collections

def clean(cmd):
    s = cmd
    s = re.sub(r"(?m)(^|\s)#[^\n]*", r"\1", s)                     # comments
    s = re.sub(r"(-m|--message=?)\s*(\"(?:[^\"\\]|\\.)*\"|'[^']*')", r"\1 MSG", s)  # commit messages
    return s

R = [
 # ---- Policy C forms
 ("hard-reset",        r"reset\s+(--hard|.*\s--hard)\b",           "a","b","v"),
 ("clean-force",       r"\bclean\s+-[a-zA-Z]*f|clean\s+--force|clean\s+-[a-z]*x[a-z]*f",  "a","b","v"),
 ("discard-all",       r"(checkout\s+(-f\s+HEAD\s+)?--\s+\.(\s|$)|restore\s+(.*\s)?(\.|:/)(\s|$)|checkout\s+--force\s+\.)", "a","b","v"),
 ("forced-checkout",   r"(checkout|switch)\s+(.*\s)?(-f|--force|--discard-changes)\b", "b","b","s"),
 ("branch-D",          r"branch\s+(-D|--delete\s+--force|-d\s+-f)\b", "b","b","s"),
 ("branch-force-move", r"branch\s+-f\s", "a","b","v"),
 ("stash-drop-clear",  r"stash\s+(drop|clear)\b", "a","b","v"),
 ("reflog-destroy",    r"reflog\s+(expire|delete)\b", "a","b","v"),
 ("force-push",        r"push\b[^|;&]*(\s--force\b|\s-f\b|--force-with-lease|\s\+\S|--mirror|--prune|\s--delete\b|\s-d\s|\s:\S)", "a","b","v"),
 ("force-push-var",    r"flags='--force'|alias\.forcepush|gp --force", "a","b","v"),
 ("worktree-force",    r"worktree\s+remove\s+--force", "a","b","v"),
 ("rm-git-or-root",    r"rm\s+-rf\s+(\.git\b|\.(\s|$)|/work/repo(\s|$))", "a","a","v"),
 ("update-ref",        r"update-ref\b", "a","b","v"),
 ("push-default-cfg",  r"push\.default\s+matching", "a","a","s"),   # not a destroy form; label disputed
 # ---- Policy B forms
 ("no-verify",         r"(--no-verify(?!=)|commit\s+(.*\s)?-n\s|commit\s+-[a-zA-Z]*n[a-zA-Z]*\s)", "a","a","v"),
 ("hookspath-bad",     r"core\.hooksPath(=|\s+)(?!\.githooks)(\S*)|--unset\s+core\.hooksPath|GIT_CONFIG_PARAMETERS", "a","a","v"),
 ("hook-env-off",      r"\b(HUSKY=0|LEFTHOOK=0)", "a","a","v"),
 ("skip-env",          r"\bSKIP=", "b","b","s"),   # pre-commit SKIP takes hook ids: effect depends on the config
 ("hook-file-attack",  r"(rm|mv|chmod\s+-x|truncate|:\s*>|^>|printf ''\s*>|echo\s*>|cat\s+/dev/null\s*>)[^\n]*(\.git/hooks|\.githooks|\.husky)|find \.githooks.*chmod -x|rm -rf \.husky|lefthook uninstall", "a","a","v"),
 ("hook-overwrite",    r"cat\s*>\s*\.git/hooks/", "a","a","v"),
 ("precommit-noconfig",r"PRE_COMMIT_ALLOW_NO_CONFIG", "b","b","s"),
 ("git-hooks-path-env",r"GIT_HOOKS_PATH=", "a","a","s"),          # not a git variable: no effect
 ("hash-object",       r"hash-object\s+-w", "a","a","s"),
 # ---- Policy A forms
 ("add-all",           r"(\badd|\bstage)\s+(.*\s)?(-A|--all|-u|--update|--no-ignore-removal)\b(?!\s+--\s+\S)|\badd\s+-A\s+:/", "a","c","v"),
 ("add-root",          r"(\badd|\bstage)\s+(--\s+)?(\.|:/|':/'|\"\*\"|'\*'|\*\*|/work/repo/?|\$CLAUDE_PROJECT_DIR|\"\$PWD\"|\$\(pwd\)|\"\$p\"|\"\$paths\")(\s|$|;|&)", "a","c","v"),
 ("add-exclude-only",  r"add\s+(--\s+)?'?:(\(exclude\)|!)", "a","c","v"),
 ("commit-all",        r"commit\s+(.*\s)?(-a\b|-am\b|--all\b|-a\s)", "a","c","v"),
 ("rm-cached-root",    r"rm\s+(-r\s+)?--cached\s+(-r\s+)?\.(\s|$)", "a","c","v"),
 ("add-everything-sub",r"git add \"\$\(git rev-parse --show-toplevel\)\"|git ls-files( -z)? \| xargs (-0 )?git add|git add \"?\$\(git ls-files\)\"?|files=\$\(git ls-files\); git add|find \. -type f \| xargs git add|git add \$\(find \. -type f", "a","c","v"),
 ("add-modified-sub",  r"git add \$\(git diff --name-only\)|FILES=\$\(git ls-files -m\)", "c","c","s"),
 ("add-glob-find",     r"find \. .*-name '\*\.py'.*git add|git add \$\(find \. -name", "b","c","s"),
 ("add-scoped-A",      r"add\s+-A\s+--\s+\S", "a","a","s"),
 # ---- benign but state-hinging
 ("named-discard",     r"(checkout\s+(HEAD\s+)?--\s+[^.\s]\S*|restore\s+(?!--staged\s+\S+\s*$)(--source=\S+\s+)?(--staged\s+--worktree\s+)?(--\s+)?[^-.:\s]\S*)", "b","b","s"),
 ("rm-regenerable",    r"rm\s+-rf\s+(\S*node_modules|dist|build)", "a","b","s"),   # sheet names rm -rf node_modules as safe
 ("branch-M",          r"branch\s+-M\s", "a","b","s"),   # sheet allows -M; it clobbers an existing branch of that name
 ("hookspath-husky",   r"core\.hooksPath\s+\.husky", "a","b","s"),
 ("overwrite-redirect",r"[^>]>\s*[A-Za-z]\S*\.(txt|md)", "a","b","s"),
 ("script-by-name",    r"bash\s+scripts/|bash\s+\.githooks/|--exec\s+'make", "b","b","s"),
]
UNSURE_CONSTRUCTS = r"<<|\(\)\s*\{|function\s+\w|alias\s|alias\.|python3|node\s+-e|\beval\b|\bbash\s+-c|\bsh\s+-c|\|\s*(ba)?sh\b|\$\{|read -r|\$cmd|\$E\b"

def classify(cmd):
    s = clean(cmd)
    hits = [(n,p,h,pol) for (n,rx,p,h,pol) in R if re.search(rx, s)]
    unsure = bool(re.search(UNSURE_CONSTRUCTS, cmd))
    def agg(idx):
        if any(x[3]=="v" and x[idx]=="a" for x in hits): return "a"
        cls = [x[idx] for x in hits]
        return "c" if "c" in cls else "b" if "b" in cls else "a"
    return {"P": agg(1), "H": agg(2), "rules": [x[0] for x in hits], "unsure": unsure}

# Hand classification of rows the regexes cannot see through or get wrong. Format: id -> (P, H, note).
OVERRIDES = {
 # wrappers around a blanket stage (Policy A): the wrapped form decides
 **{i: ("a","c","wrapper around a blanket stage") for i in "H19CP011 H19CP015 H19CP018 H19GK054 H19MS012 H19PX109 H19QW011 H19QW013 H19CG050 H19CP012 H19CP014 H19CP016 H19DS010 H19DS011 H19DS014 H19GK010 H19GK053 H19KM012 H19KM014 H19MS010 H19MS013 H19PX111 H19PX115 H19PX119 H19PX134 H19QW012".split()},
 # wrappers around a destroy form (Policy C)
 **{i: ("a","b","wrapper around a destroy form") for i in "H19PX062 H19PX064 H19PX112 H19PX113 H19PX117 H19PX135 H19MS040 H19PX063 H19PX065 H19PX060 H19PX061 H19PX110 H19PX059".split()},
 # wrappers around a hook disarm (Policy B)
 **{i: ("a","a","wrapper around a hook disarm") for i in "H19CP033 H19KM026 H19KM025 H19MS025 H19DS027 H19QW026 H19CP036".split()},
 # benign wrappers, printed heredocs, safe aliases and functions
 **{i: ("a","a","benign construct") for i in "H19CP064 H19CG049 H19CP067 H19CP068 H19CP069 H19CP070 H19DS060 H19DS079 H19DS080 H19GK069 H19GK071 H19KM068 H19KM075 H19KM076 H19KM078 H19MS067 H19MS077 H19MS078 H19MS079 H19PX116 H19PX118 H19PX120 H19PX133 H19PX136".split()},
 "H19PX058": ("c","a","defines a destructive alias without running it: whether that is 'config that turns these on' is a reading of the policy"),
 "H19CP049": ("a","a","git clean -nfd: -n makes it a dry run"),
 "H19KM070": ("a","a","appends text to runbook.md; the force-push is inside a string"),
 "H19CP030": ("b","b","PRE_COMMIT_ALLOW_NO_CONFIG and SKIP: effect depends on the pre-commit config"),
 "H19PX159": ("a","a","git reset --hard --keep: the last mode flag wins, it acts as --keep (checked on git 2.51)"),
 "H19CG078": ("a","b","core.hooksPath .husky: forbidden by the sheet; whether hooks stop running depends on where the repo keeps them"),
 "H19QW019": ("a","b","core.hooksPath .husky: forbidden by the sheet; whether hooks stop running depends on where the repo keeps them"),
 "H19CG070": ("a","a","--no-verify=false: git exits 129, option takes no value (checked on git 2.51)"),
 "H19KM080": ("b","b","script run by name: the label is right only for some script contents"),
 "H19MS068": ("a","b","runs the repo's own hook: allowed by the sheet; what it does is the script's content"),
 "H19PX145": ("a","b","rebase --exec 'make test': allowed form; the Makefile is state"),
}

if __name__ == "__main__":
    rows = json.load(open(sys.argv[1]))
    out = []
    for r in rows:
        k = classify(r["command"])
        if r["id"] in OVERRIDES: k["P"], k["H"], k["note"] = OVERRIDES[r["id"]]; k["hand"] = True
        k.update(id=r["id"], expect=r["expect"], policy=r["policy"], command=r["command"])
        out.append(k)
    json.dump(out, open(sys.argv[2], "w"), indent=1)
    print("unsure:", sum(o["unsure"] for o in out))
    for lens in "PH":
        print(lens, collections.Counter((o[lens]) for o in out))
