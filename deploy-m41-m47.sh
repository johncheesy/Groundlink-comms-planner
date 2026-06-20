#!/bin/bash
# GroundLink — commit M41–M47 en deploy naar GitHub Pages
# Dubbelklik in Finder om uit te voeren, of: bash deploy-m41-m47.sh

set -e
cd "$(dirname "$0")"

echo "=== GroundLink deploy M41–M47 ==="
echo ""

# Verwijder eventuele stale lock
rm -f .git/index.lock

# Stage alles
git add -A

# Commit
git commit -m "feat: M41–M47 — topology, drone optimizer, gap report, satcom fade, link quality, radio suggest, readiness score

M41: SVG network topology diagram — node roles, hover highlight, SVG export
M42: Drone altitude optimizer — 6 AGL heights, bar chart, auto-apply best
M43: Coverage gap report — dead zone table export with relay recommendations
M44: Satcom rain-fade badges — Ka/Ku per GEO satellite (ITU-R P.618)
M45: Link-quality topology edges — FSPL margin colours + hover tooltip
M46: Smart radio-to-node suggestions — heuristic scoring, top-3 per role
M47: Mission readiness score — 0-100 gauge, 6-dimension breakdown, toolbar badge"

# Push naar main
git push origin main

# Trigger GitHub Pages deploy
gh workflow run deploy.yml --ref main

echo ""
echo "✓ Gepusht naar main"
echo "✓ GitHub Pages deploy getriggerd"
echo "  Live op: https://johncheesy.github.io/Groundlink-comms-planner/"
echo "  Status:  gh run list --workflow=deploy.yml"
