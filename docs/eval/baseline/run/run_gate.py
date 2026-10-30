"""Feed each benchmark row to inbin-gate's gate/hook.mjs as Claude Code would. Executes nothing.
usage: run_gate.py ROWS.json FIXTURE OUT.json [--verbatim]"""
import json, os, re, subprocess, sys, tempfile, shutil
rows_path, fixture, out_path = sys.argv[1:4]
verbatim = "--verbatim" in sys.argv
HOOK = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "../../../../gate/hook.mjs"))
homes = tempfile.mkdtemp(prefix="gatehomes-", dir=os.path.dirname(out_path))
rows = json.load(open(rows_path))
out = []
for i, r in enumerate(rows):
    cmd = r["command"]
    if not verbatim:
        # the writer sheet says every command runs at the root of a repo at /work/repo; our fixture is that repo
        cmd = re.sub(r"/work/repo(?=$|[/\s\"'.;&|)])", fixture, cmd)
    home = os.path.join(homes, f"h{i}")   # a fresh gate home per row: no intent, no approvals, no Telegram, no refusal memory
    env = {k: v for k, v in os.environ.items() if not k.startswith(("INBIN_GATE", "TELEGRAM"))}
    env.update(INBIN_GATE_HOME=home, INBIN_GATE_REPO=fixture, INBIN_GATE_WORKSPACE=fixture)
    payload = {"session_id": "agb-eval", "transcript_path": "/dev/null", "cwd": fixture, "permission_mode": "bypassPermissions",
               "hook_event_name": "PreToolUse", "tool_name": "Bash", "tool_input": {"command": cmd, "description": "benchmark row"}}
    p = subprocess.run(["node", HOOK], input=json.dumps(payload), capture_output=True, text=True, cwd=fixture, env=env, timeout=120)
    cons, est = None, None
    try:
        last = [json.loads(l) for l in open(os.path.join(home, "decisions.jsonl"))][-1]
        op = (last.get("operands") or [{}])[0]
        cons, est = op.get("consequences"), op.get("establishedBy")
    except Exception:
        pass
    asked = os.path.exists(os.path.join(home, "telegram.json"))
    out.append({"id": r["id"], "expect": r["expect"], "policy": r["policy"], "class": r["class"], "command": r["command"], "fed": cmd,
                "exit": p.returncode, "decision": "allow" if p.returncode == 0 else "deny" if p.returncode == 2 else f"other:{p.returncode}",
                "consequences": cons, "establishedBy": est, "reason": p.stderr.strip()[:600], "asked": asked})
    if i % 100 == 0: print(i, file=sys.stderr)
json.dump(out, open(out_path, "w"), indent=1)
shutil.rmtree(homes)
print("done", len(out))
