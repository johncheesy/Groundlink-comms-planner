#!/usr/bin/env bash
# Merge a stack of pull requests into main in order, close superseded ones,
# tag the release and wait for the Pages deploy. One command for the whole
# 0.10.0-beta release; reusable for later stacks.
#
#   bash scripts/release-stack.sh                 # the 0.10.0-beta defaults
#   bash scripts/release-stack.sh --dry-run       # print what would run
#   STACK="40 41" CLOSE="" TAG=v0.11.0-beta bash scripts/release-stack.sh
#
# Each PR is merged with a merge commit (never squash: each PR in a stack
# contains the one below it) after its base is pointed at main. Needs `gh`
# logged in with write access to the repository.
set -euo pipefail

REPO="${REPO:-johncheesy/Groundlink-comms-planner}"
STACK="${STACK:-32 33 34 35 38}"
CLOSE="${CLOSE:-37 36}"
TAG="${TAG:-v0.10.0-beta}"
TAG_MSG="${TAG_MSG:-GroundLink ${TAG} — Ops workspace, 3D masts, clutter worldwide, MapLibre 6}"
DRY=0
[[ "${1:-}" == "--dry-run" ]] && DRY=1

run() { if (( DRY )); then echo "+ $*"; else echo "+ $*"; "$@"; fi; }

echo "Repository: $REPO"
echo "Merge order: $STACK   Close: ${CLOSE:-none}   Tag: $TAG"
echo

for pr in $STACK; do
  state=$(gh pr view "$pr" --repo "$REPO" --json state,baseRefName --jq '"\(.state) \(.baseRefName)"')
  read -r st base <<<"$state"
  if [[ "$st" == "MERGED" ]]; then echo "#$pr already merged, skipping"; continue; fi
  if [[ "$st" != "OPEN" ]]; then echo "#$pr is $st, stopping"; exit 1; fi
  if [[ "$base" != "main" ]]; then run gh pr edit "$pr" --repo "$REPO" --base main; fi
  for i in 1 2 3 4 5 6; do
    m=$(gh pr view "$pr" --repo "$REPO" --json mergeable --jq .mergeable)
    [[ "$m" == "MERGEABLE" ]] && break
    [[ "$m" == "CONFLICTING" ]] && { echo "#$pr has conflicts with main, stopping"; exit 1; }
    sleep 5
  done
  run gh pr merge "$pr" --repo "$REPO" --merge
  sleep 3
done

for pr in $CLOSE; do
  st=$(gh pr view "$pr" --repo "$REPO" --json state --jq .state)
  [[ "$st" == "OPEN" ]] && run gh pr close "$pr" --repo "$REPO" --comment "Superseded: its change landed with the stack merged into main."
done

if [[ -n "$TAG" ]]; then
  if git ls-remote --tags origin "refs/tags/$TAG" | grep -q .; then
    echo "Tag $TAG already exists on origin"
  else
    run git fetch origin main
    run git tag -a "$TAG" -m "$TAG_MSG" origin/main
    run git push origin "$TAG"
  fi
fi

(( DRY )) && { echo; echo "Dry run — nothing changed."; exit 0; }

echo
echo "Waiting for the Pages deploy of main…"
sleep 10
rid=$(gh run list --repo "$REPO" --branch main --limit 1 --json databaseId --jq '.[0].databaseId')
gh run watch "$rid" --repo "$REPO" --exit-status && echo "Deployed." || { echo "Deploy failed — see: gh run view $rid --repo $REPO --log-failed"; exit 1; }

url=$(gh api "repos/$REPO/pages" --jq .html_url)
echo
echo "Live: $url"
sleep 15
ver=$(curl -fsSL "${url}" | grep -o 'index-[A-Za-z0-9_-]*\.js' | head -1)
[[ -n "$ver" ]] && curl -fsSL "${url}assets/${ver}" | grep -o '[0-9]\+\.[0-9]\+\.[0-9]\+-beta[^"]*' | head -1 | sed 's/^/Served build: /' || echo "Could not read the served build id"
