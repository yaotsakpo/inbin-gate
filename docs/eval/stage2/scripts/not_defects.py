"""Standing list after stage two. usage: not_defects.py BASE_CSV RES_H19 RES_H18 H18_ROWS OUT"""
import csv, json, sys
base_csv, res19, res18, h18rows, outp = sys.argv[1:6]
rows = list(csv.DictReader(open(base_csv)))
V = {r["id"]: r for r in rows if r["disagree"]}
N = {r["id"]: r for r in json.load(open(res19))}
def wrong(n): return (n["expect"] == "stop" and n["decision"] == "allow") or (n["expect"] == "allow" and n["decision"] == "deny")
def after(n): return ("refused" if n["decision"] == "deny" else "allowed") + f" ({', '.join(n['consequences'] or [])})"
def cmd(c): return c.replace("\n", " ⏎ ").replace("|", "\\|")
FUNC = {"H19CP067", "H19CP068", "H19DS080", "H19GK071", "H19KM076", "H19MS079"}
def why(i, r):
    c = r["command"]; v = r["verdict"] if r else ""
    if i in FUNC: return "a shell function or alias defined in the command: reading it soundly needs every call path (a function can shadow git or rm, be called from another function or a trap), so it stays unknown and needs the developer."
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
    if "githooks/" in c: return "overwriting a live hook: the new body is data the gate does not evaluate, so a real hook and `exit 0` read the same (stage-one rule, documented)."
    if "bash /tmp/" in c: return "running a script file outside the repository is privileged (documented rule); the script's own lines are data until it runs."
    return "?"
groups = {"Policy differences": [], "Needing developer intent": [], "Refused by design": [], "Wrong or debatable labels on their side": [],
          "Shell functions and aliases defined in the command (left fail-closed)": [], "Documented rules that refuse a safe-labeled row": []}
for i, n in N.items():
    if not wrong(n): continue
    r = V.get(i, {"verdict": "", "command": n["command"], "consequences": ",".join(n["consequences"] or []), "label": n["expect"]})
    v = r["verdict"]
    g = ("Shell functions and aliases defined in the command (left fail-closed)" if i in FUNC else "Needing developer intent" if i == "H19CG049" or v == "INTENT"
         else "Wrong or debatable labels on their side" if v == "THEIR_LABEL"
         else "Policy differences" if v == "POLICY_DIFF" or n["policy"] == "A" else "Refused by design" if v == "FAIL_CLOSED_BY_DESIGN" else "Documented rules that refuse a safe-labeled row")
    groups[g].append((i, n["expect"], n["command"], why(i, r), after(n)))
out = ["# Disagreements deliberately not fixed, after stage two", "",
       "Every holdout19 row (agent-guard-bench, MIT, Casey Rose) where the gate still disagrees with the label after stage two, fixture A, empty intent. Each is a policy difference, a refusal by design, a label we believe is wrong, or a rule we keep on purpose; none is an open classifier defect except the shell-function group, which is left fail-closed by decision. The last column is the decision after stage two.", ""]
total = 0
for g, items in groups.items():
    total += len(items)
    out += [f"## {g}: {len(items)}", "", "| id | label | command | why it is not fixed | after stage two |", "|---|---|---|---|---|"]
    out += [f"| {a} | {b} | `{cmd(c)}` | {w} | {x} |" for a, b, c, w, x in items] + [""]
# holdout18 rows named in the stage-two brief
h = json.load(open(h18rows)); n18 = json.load(open(res18))
keep = {"CG035", "CP050", "CP067", "KM054", "GK069"}
out += ["## holdout18 rows kept as they are", "", "| id | label | command | why | after stage two |", "|---|---|---|---|---|"]
for r, x in zip(h, n18):
    if r["id"] in keep and wrong(x):
        w = ("deleting by a find pattern from the repository root: the matches are repository state the classifier does not read from text; left for stage three." if r["id"] == "GK069"
             else "overwriting or appending to a live hook: the body is data the gate does not evaluate (an appended `exit 0` can disarm a hook), stage-one rule, documented.")
        out.append(f"| {r['id']} | {r['expect']} | `{cmd(r['command'])}` | {w} | {after(x)} |")
out.append("")
open(outp, "w").write("\n".join(out))
print(total, {g: len(v) for g, v in groups.items()})
