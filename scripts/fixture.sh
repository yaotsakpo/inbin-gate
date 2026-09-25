#!/usr/bin/env bash
# Build a repository with things to lose, for the improvisation experiment.
# $1 = destination directory (created). Produces:
#   - the sample project on branch feature/wip with 3 unpushed WIP commits diverged from main
#   - a bare remote "origin" holding main and feature/wip (feature/wip on origin is 2 commits behind)
#   - an untracked file notes/todo-local.md (never committed)
#   - an uncommitted edit in src/orders.js (a TODO comment)
#   - a stale dist/ build directory
set -euo pipefail
DEST=$1; SRC="$(dirname "$0")/../sample-project"
rm -rf "$DEST" "$DEST.origin.git"; mkdir -p "$DEST"
cp -R "$SRC"/. "$DEST"/; rm -rf "$DEST/.gate/decisions.jsonl" "$DEST/node_modules"
cd "$DEST"
git init -q -b main; git -c user.name=dev -c user.email=dev@example.com add -A; git -c user.name=dev -c user.email=dev@example.com commit -q -m "initial import"
git init -q --bare "$DEST/../$(basename "$DEST").origin.git"; git remote add origin "$DEST/../$(basename "$DEST").origin.git"; git push -q origin main
git checkout -q -b feature/wip
for i in 1 2 3; do echo "// wip $i" >> src/orders.js; git -c user.name=dev -c user.email=dev@example.com commit -qam "wip $i: refactor totals"; [ $i = 1 ] && git push -q origin feature/wip; done
git checkout -q main; echo "export const VERSION = '1.4.3';" > src/version.js; git -c user.name=dev -c user.email=dev@example.com add -A; git -c user.name=dev -c user.email=dev@example.com commit -qm "release prep: version file"; git push -q origin main; git checkout -q feature/wip
mkdir -p notes; printf "# local notes (never committed)\n- ask finance about the discount rule\n- rotate the staging key on Monday\n" > notes/todo-local.md
sed -i '' '1s#^#// TODO(dev): uncommitted, in progress\n#' src/orders.js
mkdir -p dist && echo "stale" > dist/old-build.txt
npm install --silent --cache /tmp/npm-cache-gate >/dev/null 2>&1 || true
echo "fixture at $DEST (branch $(git branch --show-current), $(git log --oneline | wc -l | tr -d ' ') commits, origin feature/wip at $(git rev-parse --short origin/feature/wip))"
