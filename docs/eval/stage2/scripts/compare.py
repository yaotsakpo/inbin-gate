"""Compare stage-one results with the baseline. usage: compare.py BASE_RES NEW_RES BASE_CSV OUT_PREFIX"""
import json, csv, sys, collections
base_res, new_res, base_csv, outp = sys.argv[1:5]
B = {f"{k}:{r['id']}": r for k, r in enumerate(json.load(open(base_res)))}
N = {f"{k}:{r['id']}": r for k, r in enumerate(json.load(open(new_res)))}
V = {}
if base_csv != "-":
    for r in csv.DictReader(open(base_csv)):
        if r.get("disagree"): V[r["id"]] = (r["verdict"], r["root_cause"])
def wrong(r): return (r["expect"] == "stop" and r["decision"] == "allow") or (r["expect"] == "allow" and r["decision"] == "deny")
def counts(R):
    st = [r for r in R.values() if r["expect"] == "stop"]; al = [r for r in R.values() if r["expect"] == "allow"]
    return dict(rows=len(R), stop=len(st), allow=len(al), stop_refused=sum(r["decision"] == "deny" for r in st),
                allow_refused=sum(r["decision"] == "deny" for r in al), other=sum(r["decision"] not in ("allow", "deny") for r in R.values()))
cb, cn = counts(B), counts(N)
changed = []
for i, b in B.items():
    n = N[i]
    if b["decision"] != n["decision"] or sorted(b["consequences"] or []) != sorted(n["consequences"] or []):
        kind = "decision" if b["decision"] != n["decision"] else "classes only"
        if b["decision"] != n["decision"]:
            kind = "fixed (was wrong, now agrees)" if wrong(b) and not wrong(n) else "REGRESSION (agreed, now wrong)" if not wrong(b) and wrong(n) else "changed"
        changed.append(dict(id=i.split(":",1)[1], label=b["expect"], policy=b["policy"], before=b["decision"], after=n["decision"],
                            cons_before=",".join(b["consequences"] or []), cons_after=",".join(n["consequences"] or []),
                            kind=kind, verdict=V.get(i.split(":",1)[1], ("", ""))[0], root=V.get(i.split(":",1)[1], ("", ""))[1], command=b["command"].replace("\n", " ⏎ ")))
tab_b = collections.Counter(); tab_n = collections.Counter()
for i in B:
    if wrong(B[i]): tab_b[(V.get(i.split(":",1)[1], ("?",))[0], "miss" if B[i]["expect"] == "stop" else "false deny")] += 1
    if wrong(N[i]): tab_n[(V.get(i.split(":",1)[1], ("NEW: was agreeing",))[0] if wrong(B[i]) else "NEW: was agreeing", "miss" if N[i]["expect"] == "stop" else "false deny")] += 1
json.dump(dict(before=cb, after=cn, verdicts_before={f"{k[0]}|{k[1]}": v for k, v in tab_b.items()}, verdicts_after={f"{k[0]}|{k[1]}": v for k, v in tab_n.items()}, changed=changed), open(outp + ".json", "w"), indent=1)
with open(outp + "-changed.csv", "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=list(changed[0].keys()) if changed else ["id"]); w.writeheader(); [w.writerow(c) for c in changed]
print("before", cb); print("after ", cn)
print("decision changes:", collections.Counter(c["kind"] for c in changed))
for k in sorted(set(tab_b) | set(tab_n)): print(f"  {k[0]:<22} {k[1]:<10} before {tab_b.get(k,0):>3}  after {tab_n.get(k,0):>3}")
