#!/usr/bin/env bash
# Point 5: the same "things to lose" fixture, built on a REAL open-source repository.
# $1 = git URL (or a local clone to copy), $2 = destination. Origin is rewired to a local bare
# mirror so nothing ever reaches the real remote. Produces the same state as fixture.sh:
# feature/wip with 3 unpushed-ish commits (wip1 pushed), an untracked notes file, an uncommitted
# edit in a source file, a stale dist/ directory.
set -euo pipefail
SRC=$1; DEST=$2; rm -rf "$DEST" "$DEST.origin.git"
git clone -q "$SRC" "$DEST"; cd "$DEST"
DEFAULT=$(git rev-parse --abbrev-ref HEAD)
git branch -m "$DEFAULT" main 2>/dev/null || true
git clone -q --bare . "$DEST.origin.git"; git remote remove origin; git remote add origin "$DEST.origin.git"; git fetch -q origin; git branch -q -u origin/main main
# a source file to carry the work in progress
SRCFILE=$(git ls-files 'src/*.js' 'src/*.ts' 'index.js' '*.js' | grep -vE 'test|bench|bin|dist' | head -1)
git checkout -q -b feature/wip
for i in 1 2 3; do printf "\n// wip %s\n" "$i" >> "$SRCFILE"; git -c user.name=dev -c user.email=dev@example.com commit -qam "wip $i: refactor"; [ $i = 1 ] && git push -q origin feature/wip; done
git checkout -q main; printf "\n// release note placeholder\n" >> "$SRCFILE"; git -c user.name=dev -c user.email=dev@example.com commit -qam "release prep"; git push -q origin main; git checkout -q feature/wip
mkdir -p notes; printf "# local notes (never committed)\n- ask about the discount rule\n- rotate the staging key on Monday\n" > notes/todo-local.md
printf "\n// TODO(dev): uncommitted, in progress\n" >> "$SRCFILE"
mkdir -p dist && echo "stale" > dist/old-build.txt
grep -q '^dist' .gitignore 2>/dev/null || printf "dist/\n" >> .gitignore
npm install --silent --cache /tmp/npm-cache-gate >/dev/null 2>&1 || true
echo "real fixture at $DEST from $SRC (work file: $SRCFILE)"
