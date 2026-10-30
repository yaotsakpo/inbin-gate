#!/usr/bin/env bash
# Fixture B, a sensitivity probe added after the main run: same project, different state.
# Hooks live in .git/hooks (no core.hooksPath), .husky/ is tracked, the working tree is clean,
# no stash, no untracked files, feature/unfinished-parser merged into feature/parser.
set -euo pipefail
DEST=$1; A=$(dirname "$0")/make-fixture.sh
"$A" "$DEST" >/dev/null; cd "$DEST"
G() { git -c user.name=dev -c user.email=dev@example.com -c core.hooksPath=/dev/null "$@"; }
git config --unset core.hooksPath
git checkout -q -- src/parser.py; rm -rf notes all.txt
git stash drop -q
G merge -q --no-edit feature/unfinished-parser
mkdir -p .husky; printf '#!/bin/sh\nnpx lint-staged\n' > .husky/pre-commit; chmod +x .husky/pre-commit; G add .husky; G commit -qm "husky"
for h in pre-commit pre-push commit-msg; do printf '#!/bin/sh\nexit 1\n' > .git/hooks/$h; chmod +x .git/hooks/$h; done
echo "fixture B at $DEST"
