#!/usr/bin/env bash
# Run the five build tasks (docs/BOB-SESSION-SCRIPT.md, B1-B5) headlessly with Bob Shell.
# Needs: BOB_API_KEY in the environment (and BOB_TEAM_ID if the key is of type "general").
# Each task's JSON transcript is saved under bob_sessions/shell-logs/ as evidence of Bob usage.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${BOB_API_KEY:?set BOB_API_KEY (create it at bob.ibm.com, API key management)}"
TEAM=${BOB_TEAM_ID:+--team-id "$BOB_TEAM_ID"}
run() { # id, prompt
  local id=$1; shift
  echo "=== $id ==="
  # stdin MUST be closed: with an inherited non-tty stdin, bob run waits forever.
  bob run --accept-license --trust -w "$PWD" --format stream-json --log-level info --max-turns 40 ${MAX_COST:+--max-cost "$MAX_COST"} $TEAM "$@" \
    < /dev/null > "bob_sessions/shell-logs/${id}.stream.json" 2> "bob_sessions/shell-logs/${id}.stderr.log" || echo "$id exited $?"
  grep -oE '"cost":[0-9.]+' "bob_sessions/shell-logs/${id}.stream.json" | tail -1 || true
}
[ "${START:-B1}" = "B1" ] && run B1 "Read gate/server.mjs and gate/decide.mjs. Add input validation to every MCP tool in gate/server.mjs: reject empty operands and operands longer than 2000 characters with a clear message that starts with 'REFUSED by Inbin Gate: invalid operand'. Add a unit test for each case in gate/decide.test.mjs (validate in decide.mjs so it is testable). Run 'npm test' and make it pass. Do not change gate/authority.js."
run B2 "Create docs/sequence.md containing a Mermaid sequence diagram of one gated action: Bob proposes run_command -> inbin-gate MCP tool -> gate/core.mjs loads developer intent and repository policy -> gate/decide.mjs mints claims and calls the resolver -> decision -> tool executes or returns the refusal -> Bob reports to the developer. Add two sentences under the diagram explaining why the agent's own proposal can never govern."
run B3 "Do two independent things, using subagents if available: (a) in bench/replay.mjs add five more injected cases drawn from text in sample-project/README.md, sample-project/issues and sample-project/ci/last-run.log, keeping the expected decision false and the script exiting 0; (b) review web/index.html for accessibility (labels, contrast, keyboard focus, aria for the decision output) and fix what you find. Then run 'npm run bench' and confirm it prints 15/15 injected refused."
run B4 "Review the uncommitted changes in this repository as a careful code reviewer: correctness, security of the gate (can any change let an unestablished value through?), and test coverage. Also replace any em dash characters in user-facing strings with a colon or comma (house style). Fix anything you find, run 'npm test' and 'npm run bench', and write a short review summary to docs/review-B4.md."
: skip B5 "Stage all changes and write a conventional commit message describing them accurately. Commit with git. Do not push."
echo "done; transcripts in bob_sessions/shell-logs/"
