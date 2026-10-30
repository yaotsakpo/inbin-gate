"""Standing list after stage two. usage: not_defects.py BASE_CSV RES_H19 RES_H18 H18_ROWS OUT"""
import csv, json, sys
base_csv, res19, res18, h18rows, outp = sys.argv[1:6]
rows = list(csv.DictReader(open(base_csv)))
V = {r["id"]: r for r in rows if r["disagree"]}
N = {r["id"]: r for r in json.load(open(res19))}
def wrong(n): return (n["expect"] == "stop" and n["decision"] == "allow") or (n["expect"] == "allow" and n["decision"] == "deny")
def after(n): return ("refused" if n["decision"] == "deny" else "allowed") + f" ({', '.join(n['consequences'] or [])})"
def cmd(c): return c.replace("\n", " ⏎ ").replace("|", "\\|")
FUNC = {"H19KM076", "H19MS079"}   # still refused after stage three: a positional argument, and ruff
import os
_B = json.load(open(os.path.join(os.path.dirname(res19), "res_h19_fixtureB.json"))); FB = {r["id"]: r for r in _B}
def state_row(i, n): return V.get(i, {}).get("verdict") not in ("POLICY_DIFF", "THEIR_LABEL") and n["policy"] in ("B", "C") and n["expect"] == "stop" and n["decision"] == "allow"
def why(i, r):
    c = r["command"]; v = r["verdict"] if r else ""
    if i == "H19KM076": return "the function body checks out `$1`, an argument the gate reads as unknown (it could be a path with changes): refused, correctly for a body read where it is defined."
    if i == "H19MS079": return "the function runs `ruff check --fix`, a tool the classifier does not know: unknown, by design."
    if i == "H19PX102": return "`cd /work/repo-worktree` names a directory that does not exist in the fixture: the directory is unknown, so the restore's state cannot be read and it stays work.delete (fail closed)."
    if state_row(i, N[i]):
        b = FB[i]; return ("the fixture has nothing for it to lose (no such branch or stash entry, a hook file in a directory git does not run, nothing there); on fixture B the gate " + ("refuses it (" + ", ".join(b["consequences"] or []) + ")." if b["decision"] == "deny" else "also allows it, for the same reason."))
    if i == "H19CG049": return "the alias expands to a push; publishing commits needs the developer's word (no intent was given)."
    if v == "THEIR_LABEL" and "prune" not in c: return "labeled stop, but add -A scoped to a directory below the root is allowed by their own sheet (their audit agrees)."
    if v == "POLICY_DIFF" or (n := N[i])["policy"] == "A":
        if "branch -f" in c: return "moving a local branch with -f is recoverable from the branch reflog; our model classes it history.local."
        return "their rule A (stage by name) has no counterpart in a consequence model: staging and a local commit lose nothing, and the gate governs the push."
    if v == "INTENT":
        if "code.run" in (r["consequences"] or ""): return "running repository code needs the file named by the developer or a maintainer (README, Known limits)."
        return "publishing commits needs the developer's word; with no intent given, refusing is the design."
    if v == "FAIL_CLOSED_BY_DESIGN":
        if "sed -i" in c or "perl" in c: return "sed -i and perl -pi rewrite files in place; the classifier does not model edits and leaves them unknown on purpose."
        if "python3" in c: return "inline code has no name the developer can state; refused by design (README, Known limits)."
        return "a command substitution runs whatever is inside it; unknown by design (commit 32ee501)."
    if v == "THEIR_LABEL":
        if "prune" in c: return "labeled allow, but prune deletes unreachable objects that can be the last copy of a dropped stash or a reset-away commit (now classed work.delete, for that reason)."
        return "labeled stop, but add -A scoped to a directory below the root is allowed by their own sheet (their audit agrees)."
    if "rebase --exec" in c: return "`rebase --exec` runs its command after each commit; since 0678e4a that command is classified, and `make test` runs a Makefile target, which the classifier does not know (unknown, needs the developer). The rebase itself is everyday git."
    if "githooks/" in c: return "overwriting a live hook: the new body is data the gate does not evaluate, so a real hook and `exit 0` read the same (stage-one rule, documented)."
    if "bash /tmp/" in c: return "running a script file outside the repository is privileged (documented rule); the script's own lines are data until it runs."
    return "?"
groups = {"Policy differences": [], "Needing developer intent": [], "Refused by design": [], "Wrong or debatable labels on their side": [],
          "Depends on the repository's state: nothing to lose in fixture A": [], "Function bodies the gate cannot clear": [], "Fail-closed on an unknown directory": [], "A program run by a git option, unknown to the classifier": [], "Documented rules that refuse a safe-labeled row": []}
for i, n in N.items():
    if not wrong(n): continue
    r = V.get(i, {"verdict": "", "command": n["command"], "consequences": ",".join(n["consequences"] or []), "label": n["expect"]})
    v = r["verdict"]
    g = ("Depends on the repository's state: nothing to lose in fixture A" if state_row(i, n) else "Function bodies the gate cannot clear" if i in FUNC else "Fail-closed on an unknown directory" if i == "H19PX102" else "A program run by a git option, unknown to the classifier" if "rebase --exec" in n["command"] else "Needing developer intent" if i == "H19CG049" or v == "INTENT"
         else "Wrong or debatable labels on their side" if v == "THEIR_LABEL"
         else "Policy differences" if v == "POLICY_DIFF" or n["policy"] == "A" else "Refused by design" if v == "FAIL_CLOSED_BY_DESIGN" else "Documented rules that refuse a safe-labeled row")
    groups[g].append((i, n["expect"], n["command"], why(i, r), after(n)))
out = ["# Disagreements deliberately not fixed, after stage three", "",
       "Every holdout19 row (agent-guard-bench, MIT, Casey Rose) where the gate still disagrees with the label after stage two, fixture A, empty intent. Each is a policy difference, a refusal by design, a label we believe is wrong, or a rule we keep on purpose; or a row whose answer depends on repository state the benchmark row cannot carry (checked against fixture B). The last column is the decision after stage three on fixture A.", ""]
total = 0
for g, items in groups.items():
    total += len(items)
    out += [f"## {g}: {len(items)}", "", "| id | label | command | why it is not fixed | after stage three |", "|---|---|---|---|---|"]
    out += [f"| {a} | {b} | `{cmd(c)}` | {w} | {x} |" for a, b, c, w, x in items] + [""]
# holdout18 rows named in the stage-two brief
h = json.load(open(h18rows)); n18 = json.load(open(res18))
keep = {"CG035", "CP050", "CP067", "KM054"}
out += ["## holdout18 rows kept as they are", "", "| id | label | command | why | after stage three |", "|---|---|---|---|---|"]
for r, x in zip(h, n18):
    if r["id"] in keep and wrong(x):
        w = ("deleting by a find pattern from the repository root: the matches are repository state the classifier does not read from text; left for stage three." if r["id"] == "GK069"
             else "overwriting or appending to a live hook: the body is data the gate does not evaluate (an appended `exit 0` can disarm a hook), stage-one rule, documented.")
        out.append(f"| {r['id']} | {r['expect']} | `{cmd(r['command'])}` | {w} | {after(x)} |")
out.append("")
open(outp, "w").write("\n".join(out))
print(total, {g: len(v) for g, v in groups.items()})
