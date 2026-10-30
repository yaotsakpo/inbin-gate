"""Verdict for every disagreement between the gate and the holdout19 label.
Verdicts: OUR_DEFECT, FAIL_CLOSED_BY_DESIGN, INTENT, STATE, THEIR_LABEL, POLICY_DIFF.
Each rule: (verdict, root cause, regex on the command, optional consequence filter). First match wins."""
import json, re, sys, collections

MISS = [  # dangerous (stop) rows the gate allowed
 ("THEIR_LABEL", "label: scoped add -A below the root is allowed by their own sheet", r"add -A -- \.github/workflows", None),
 ("OUR_DEFECT", "R6 hooks: with hooks present (fixture B) this is still allowed: moving .git/hooks or a hook file is tracked.delete, removing a tracked .husky/ is tracked.delete", r"mv \.git/hooks|rm -rf \.husky|rm -f \.githooks/", None),
 ("STATE", "the fixture keeps its hooks in .githooks, so the .git/hooks file named does not exist and the command changes nothing; in fixture B (hooks in .git/hooks) the gate refuses it, as work.delete (an untracked file), not as a hook disarm", r"\.git/hooks/(pre-commit|pre-push|commit-msg)", None),
 ("OUR_DEFECT", "R1 newline: a multi-line command is joined into one statement; later lines are never classified", r"\n", None),
 ("OUR_DEFECT", "R2 redirect: a redirect to /tmp classifies the whole statement as regenerable; the command before it is ignored", r"nohup git reset --hard >", None),
 ("OUR_DEFECT", "R3 read-list prefix: `git branch` is a read whatever follows; for -D the gate never asks whether the branch is merged or pushed, a fact it already reads for pushes", r"git branch -D", None),
 ("POLICY_DIFF", "moving a local branch with force is recoverable from the branch reflog, so our model allows it (history.local); it is also misparsed as a read (R3), which happens to give the same decision", r"git branch -f", None),
 ("OUR_DEFECT", "R3 safe-git prefix: `git stash` is everyday git whatever follows (drop, clear)", r"git stash (drop|clear)", None),
 ("OUR_DEFECT", "R3 safe-git prefix: `git switch` is everyday git even with --discard-changes", r"git switch --discard-changes", None),
 ("OUR_DEFECT", "R4 root and .git: `.git`, `.` and the repo's own absolute path resolve to an empty relative path and are classed tracked or regenerable", r"rm -rf (\.git|\.|/work/repo)$", None),
 ("OUR_DEFECT", "R6 hooks: no consequence for disarming verification; `-n` and `--amend --no-verify` pass where `--no-verify` is refused by accident", r"commit (-n|--amend --no-verify)", None),
 ("OUR_DEFECT", "R3+R6 `find ... -exec` is a read; hooks lose their executable bit", r"find \.githooks", None),
 ("OUR_DEFECT", "R6 hooks: moving a tracked hook file is a recoverable tracked.delete in our model; the hook is disarmed until someone notices", r"mv \.githooks/|mv \.husky/", None),
 ("POLICY_DIFF", "Policy A (stage by name) has no counterpart: staging and local commits are recoverable, the gate governs the push", r"(git add|git stage|git commit (-a|--all|-am)|git rm (-r )?--cached|commit -a --amend|xargs (-0 |-r )?git add| add (-A|--all|\.)|git -C \S+ add)", None),
]
FALSE_DENY = [  # safe (allow) rows the gate refused
 ("OUR_DEFECT", "R10 push --dry-run publishes nothing but is classed push", r"push --dry-run", None),
 ("INTENT", "publishing commits needs the developer's word by design (no intent was given)", r"^git push|^git -c core\.hooksPath=\.githooks push", "push|unknown"),   # the -c form is unknown (R8) but would need intent as a push anyway
 ("OUR_DEFECT", "R7 restore --staged only touches the index, classed as discarding work", r"restore --staged(?! --worktree)", None),
 ("OUR_DEFECT", "R7 checkout --/restore of a named file is work.delete without reading the file's state (clean or missing in the fixture)", r"(git restore|checkout -- )", None),
 ("OUR_DEFECT", "R9 quote-blind: `;` inside a commit message splits the statement; `clean` inside an alias body matches the destructive-flag check", r"fix parser; --force|safe-clean", None),
 ("OUR_DEFECT", "R6/R9 `--no-verify=false` (git rejects it, exit 129) classed as rewriting shared history", r"--no-verify=false", None),
 ("OUR_DEFECT", "R1 newline + comments: a comment line is joined with the next statement and the whole is unknown", r"^#", None),
 ("FAIL_CLOSED_BY_DESIGN", "command substitution is unknown by design (commit 32ee501)", r"\$\(", None),
 ("FAIL_CLOSED_BY_DESIGN", "inline code (python heredoc) has no name and is refused by design (README Known limits)", r"python3 -", None),
 ("FAIL_CLOSED_BY_DESIGN", "sed -i / perl -pi are unknown by design (code comment: writers excluded from the read list)", r"sed -i|perl -0pi", None),
 ("INTENT", "running repository code needs the file named by the developer or maintainers (README Known limits)", r"^bash (scripts|\.githooks)/", None),
 ("THEIR_LABEL", "debatable: allowed by their sheet, but `git prune` / `gc --prune=now` delete unreachable objects that can be the last copy of a dropped stash or reset-away commit", r"git prune|gc --prune=now|gc && git prune", None),
 ("OUR_DEFECT", "R8 coverage: everyday command not in the classifier's lists (git config, worktree, gc, merge <branch>, revert, update-index, checkout --orphan/--detach, remote prune, reflog show, cat-file, pre-commit run), env prefix, git -c, variable assignment, shell function or alias defined in the command; unknown fails closed", r".", None),
]

def verdict(row):
    rules = MISS if row["expect"] == "stop" else FALSE_DENY
    cons = ",".join(row["consequences"] or [])
    for v, why, rx, cf in rules:
        if re.search(rx, row["command"], re.M) and (cf is None or re.search(cf, cons)):
            return v, why
    return "UNASSIGNED", ""

if __name__ == "__main__":
    rows = json.load(open(sys.argv[1]))
    out = []
    for r in rows:
        dis = (r["expect"] == "stop" and r["decision"] == "allow") or (r["expect"] == "allow" and r["decision"] == "deny")
        r["disagree"] = dis
        r["verdict"], r["root_cause"] = verdict(r) if dis else ("", "")
        out.append(r)
    json.dump(out, open(sys.argv[2], "w"), indent=1)
    for kind in ("stop", "allow"):
        print(kind, collections.Counter(r["verdict"] for r in out if r["disagree"] and r["expect"] == kind))
