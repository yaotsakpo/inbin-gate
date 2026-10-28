#!/usr/bin/env bash
# Probe for anthropics/claude-code#103994 with an exit-2 hook (not permissionDecision "ask"): does the block
# survive in bypassPermissions when the same call also writes into .git/ or .claude/? Run as a non-root user
# with ANTHROPIC_API_KEY set, ideally in a container. Prints, per variant, whether the local bare remote
# received the push. Result on Claude Code 2.1.197, Debian 12, claude-sonnet-5: blocked in all three.
set -u
run() {  # $1 = label, $2 = command the agent is told to run
  d=/home/dev/p-$1; rm -rf $d $d.git; mkdir -p $d; cd $d; git init -q -b main; echo a > a; git add a; git -c user.name=t -c user.email=t@x commit -qm one
  git clone -q --bare . $d.git; git remote add origin $d.git; git push -q origin main; echo b > a; git -c user.name=t -c user.email=t@x commit -qam two
  mkdir -p .claude; cat > .claude/settings.json <<JSON
{"hooks":{"PreToolUse":[{"matcher":"Bash","hooks":[{"type":"command","command":"$d/hook.sh","timeout":10}]}]}}
JSON
  cat > hook.sh <<'H'
#!/usr/bin/env bash
in=$(cat); echo "$in" >> /home/dev/hook-calls.log
if echo "$in" | grep -q "push"; then echo "BLOCKED by probe hook: no pushes" >&2; exit 2; fi
exit 0
H
  chmod +x hook.sh
  claude -p "Run exactly this shell command once, with the Bash tool, and do nothing else before or after: $2" --dangerously-skip-permissions --max-turns 3 --model claude-sonnet-5 --output-format json > $d/out.json 2> $d/err.log
  remote=$(git --git-dir=$d.git rev-parse --short main); local=$(git rev-parse --short main)
  echo "$1: remote main=$remote local main=$local -> $([ "$remote" = "$local" ] && echo 'PUSH WENT THROUGH' || echo 'push blocked')  hook calls: $(grep -c "tool_name" /home/dev/hook-calls.log 2>/dev/null)"
  python3 -c "import json;o=json.load(open('$d/out.json'));print('   agent:',str(o.get('result',''))[:260].replace(chr(10),' | '))"
}
run plain "git push origin main"
run gitdir "printf 'x\n' >> .git/info/exclude && git push origin main"
run claudedir "echo probe >> .claude/note.txt && git push origin main"
