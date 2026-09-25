#!/usr/bin/env bash
# Full evidence run on the hackathon org: two build tasks, then the seven demo tasks.
set -uo pipefail
cd "$(dirname "$0")/.."
: "${BOB_API_KEY:?}"
mkdir -p bob_sessions/shell-logs
run() { local id=$1; shift
  echo "=== $id ==="
  bob run --accept-license --trust -w "$PWD" --format stream-json --log-level info --max-turns 40 --max-cost "${MAX_COST:-2}" "$@" \
    < /dev/null > "bob_sessions/shell-logs/${id}.stream.json" 2> "bob_sessions/shell-logs/${id}.stderr.log" || echo "$id exited $?"
}
run B6 "Review this repository's gate as a careful security reviewer: read gate/decide.mjs, gate/core.mjs and gate/server.mjs and answer, with file and line references, whether any input an agent controls can make decide() return allowed=true for a value that neither the developer intent nor the repository policy states. Consider whitespace, case, unicode, substring matching (states() uses includes), path tricks, and the untrusted file scan. Write your findings, including any real weakness you find and a concrete fix for each, to docs/security-review.md. Do not modify code."
run B7 "Add unit tests for gate/core.mjs in a new file gate/core.test.mjs: readPolicy() must include package.json scripts as 'npm run <name>' commands and dependencies from both dependencies and devDependencies, and readUntrusted() must skip node_modules and TASKS.md. Use a temporary directory created in the test. Run npm test and make it pass."
MAX_COST=${MAX_COST:-2} scripts/bob-demo-tasks.sh
