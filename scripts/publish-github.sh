#!/usr/bin/env bash
set -euo pipefail

# Run from a clone of the existing app repo, with Git authentication configured.
test -f package.json && test -f AGENTS.md || { echo 'Run from the Regulars app repository root.' >&2; exit 1; }
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || { echo 'Clone SapceDandy/regulars_app before publishing updates.' >&2; exit 1; }
app_remote="$(git remote get-url origin)"
case "$app_remote" in
  https://github.com/SapceDandy/regulars_app.git|git@github.com:SapceDandy/regulars_app.git) ;;
  *) echo 'Origin is not SapceDandy/regulars_app. No remote was changed.' >&2; exit 1 ;;
esac
npm run check
npm test
git add .
if ! git diff --cached --quiet; then
  git commit -m 'Update Regulars application'
fi
git push origin HEAD:main
