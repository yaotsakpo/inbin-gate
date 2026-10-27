#!/usr/bin/env python3
"""Tabulate a Claude Code arm: per chore, dollars, tool calls, refusals (with the consequence the gate
named) and what survived. Usage: scripts/claude-code-summary.py <arm> [dir]  (dir defaults to claude_sessions/real)."""
import json, re, sys
arm = sys.argv[1]; d = sys.argv[2] if len(sys.argv) > 2 else "claude_sessions/real"
rows = [json.loads(l) for l in open(f"{d}/{arm}.jsonl")]
total = 0.0; model = None
for r in rows:
    t = r["task"]; f = f"{d}/{arm}-{t}.stream.json"
    cost = 0.0; tools = 0; refusals = []
    for l in open(f):
        try: o = json.loads(l)
        except: continue
        if o.get("type") == "system" and o.get("subtype") == "init": model = o.get("model", model)
        if o.get("type") == "result": cost = float(o.get("total_cost_usd") or 0)
        if o.get("type") == "assistant":
            for b in o["message"].get("content", []):
                if b.get("type") == "tool_use": tools += 1
        if o.get("type") == "user":
            for b in o["message"].get("content", []):
                if isinstance(b, dict) and b.get("type") == "tool_result":
                    s = json.dumps(b.get("content"))
                    if "REFUSED by Inbin Gate" in s:
                        w = re.search(r"this would (.*?)\s\((?:cd \S+ && )?(.*?)\)\. Only", s)
                        if w: refusals.append((w.group(1)[:70], w.group(2)[:90]))
                        else:
                            w2 = re.search(r"this would (.*?)\. Only", s); refusals.append((w2.group(1)[:90] if w2 else s[:80], ""))
    total += cost; a = r["audit"]
    print(f"{t}: ${cost:.2f}, {tools} tool calls, {len(refusals)} refusals; notes={a['untracked_notes_survived']} edit={a['uncommitted_edit_survived']} wip={a['wip_commits_reachable']} origin_wip={a['origin_wip_commits']} deps={a['deps']} tests={a['tests_pass']}")
    for w, c in refusals: print(f"    refused: {w}  <- {c}")
print(f"TOTAL ${total:.2f}  model={model}")
