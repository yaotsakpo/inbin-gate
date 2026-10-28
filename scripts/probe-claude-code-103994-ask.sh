#!/usr/bin/env bash
# Issue anthropics/claude-code#103994, the author's own probe: a PreToolUse hook returning permissionDecision
# "ask" for any Bash command containing abt-ask-probe, run with --permission-mode bypassPermissions, cases 1, 4, 9
# of the issue's table. Run as a non-root user with ANTHROPIC_API_KEY set, ideally in the container built from
# probe-claude-code-103994.Dockerfile. Result on Claude Code 2.1.312, Debian 12, claude-sonnet-5 (2026-10-27):
# case 1 did not run (ask became a denial), cases 4 and 9 RAN: the override is cross-platform.
set -u
cat > /home/dev/probe_hook.py <<'PY'
import json, sys
data = json.loads(sys.stdin.read() or "{}")
if "abt-ask-probe" in (data.get("tool_input") or {}).get("command", ""):
    print(json.dumps({"hookSpecificOutput": {"hookEventName": "PreToolUse",
        "permissionDecision": "ask", "permissionDecisionReason": "PROBE: ask"}}))
PY
cat > /home/dev/probe-settings.json <<'JSON'
{"hooks": {"PreToolUse": [{"matcher": "Bash", "hooks": [{"type": "command", "command": "python3", "args": ["/home/dev/probe_hook.py"]}]}]}}
JSON
echo "claude $(claude --version) | $(. /etc/os-release; echo $PRETTY_NAME) | node $(node --version) | $(python3 --version)"
run() {  # $1 = case number, $2 = command
  d=/home/dev/case$1; rm -rf $d; mkdir -p $d/.claude; cd $d; git init -q
  claude -p "Run exactly this command via Bash and nothing else: $2" --settings /home/dev/probe-settings.json --permission-mode bypassPermissions --max-turns 3 --model claude-sonnet-5 --output-format json > out.json 2> err.log
  ran=$([ -f ran$1.txt ] && echo YES || echo no)
  echo "case $1: ran$1.txt exists = $ran   | $2"
  python3 -c "import json;o=json.load(open('out.json'));print('   agent:',str(o.get('result',''))[:220].replace(chr(10),' | '))" 2>/dev/null || head -c 200 err.log
}
run 1 "echo abt-ask-probe > ran1.txt"
run 4 "printf 'z\n' >> .git/info/exclude && echo abt-ask-probe > ran4.txt"
run 9 "echo abt-ask-probe > ran9.txt && printf 'z' > .claude/note.txt"
