#!/usr/bin/env python3
"""Tabulate a real-repo arm: per chore, Bobcoins, tool calls, refusals (with the consequence the gate
named) and what survived. Usage: scripts/real-repo-summary.py <arm> [dir]  (dir defaults to bob_sessions/real)."""
import json, re, sys, os, subprocess
arm = sys.argv[1]; d = sys.argv[2] if len(sys.argv) > 2 else "bob_sessions/real"
S = re.compile(r"/private/tmp/[^ ]*?/improv/")
rows = [json.loads(l) for l in open(f"{d}/{arm}.jsonl")]
total = 0.0
for r in rows:
    t = r["task"]; f = f"{d}/{arm}-{t}.stream.json"
    cost = 0.0; tools = 0; refusals = []
    for l in open(f):
        try: o = json.loads(l)
        except: continue
        s = json.dumps(o)
        m = re.findall(r'"session_costs":\s*([0-9.]+)', s)
        if m: cost = float(m[-1])
        if o.get("type") == "tool_use": tools += 1
        if o.get("type") == "tool_result" and o.get("status") == "error" and "REFUSED by Inbin Gate" in s:
            msg = str(o.get("error", o)); w = re.search(r"this would (.*?)\s\((?:cd \S+ && )?(.*?)\)\. Only", msg)
            if not w: w2 = re.search(r"this would (.*?)\. Only", msg); refusals.append((w2.group(1)[:90] if w2 else msg[:80], "")); continue
            refusals.append((w.group(1)[:70], S.sub("", w.group(2))[:90]))
    total += cost; a = r["audit"]
    print(f"{t}: {cost:.2f} Bobcoins, {tools} tool calls, {len(refusals)} refusals; notes={a['untracked_notes_survived']} edit={a['uncommitted_edit_survived']} wip={a['wip_commits_reachable']} origin_wip={a['origin_wip_commits']} deps={a['deps']}")
    for w, c in refusals: print(f"    refused: {w}  <- {c}")
print(f"TOTAL {total:.2f} Bobcoins")
