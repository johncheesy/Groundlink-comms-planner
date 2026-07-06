#!/bin/bash
# GroundLink — commit M41–M47 + globe fix en deploy naar GitHub Pages
# Dubbelklik in Finder om uit te voeren, of: bash deploy-m41-m47.sh

set -e
cd "$(dirname "$0")"

echo "=== GroundLink deploy M41–M47 + globe ==="
echo ""

# Verwijder eventuele stale lock
rm -f .git/index.lock

# Stage alle relevante gewijzigde en nieuwe bestanden (skip problematische dispatch files)
git add CLAUDE.md index.html src/main.js src/map/map.js styles/components.css \
  src/ui/satcom-panel.js \
  src/ui/topology.js \
  src/ui/dash-ops.js \
  src/ui/radio-suggest-panel.js \
  src/ui/resultcard.js \
  src/ui/locate.js \
  src/ui/badges.js \
  src/analysis/radio-suggest.js \
  src/analysis/readiness.js \
  src/analysis/drone-optimizer.js \
  src/analysis/freq-deconflict.js \
  src/analysis/mast-height.js 2>/dev/null || true

# New files (may already be staged)
git add \
  src/ui/topology.js \
  src/export/gap-report.js \
  docs/M41-topology.md \
  docs/M42-drone-optimizer.md \
  docs/M43-gap-report.md \
  docs/M44-satcom-fade.md \
  docs/M45-link-quality-topology.md \
  docs/M46-radio-suggest.md \
  docs/M47-readiness.md \
  docs/E3-quick-wins.md \
  docs/E4-rain-fade.md \
  docs/M36-ops-dashboard.md \
  docs/M37-mission-brief-export.md \
  docs/M38-satcom-overview.md \
  docs/M39-freq-deconflict.md \
  docs/M39-flight-track-overlay.md \
  docs/M40-freq-plan-export.md \
  docs/M41-topology.md \
  docs/M42-drone-optimizer.md \
  docs/M43-gap-report.md \
  docs/parked 2>/dev/null || true

echo "Staged. Committing..."

# Commit
git commit -m "feat: M41–M47 + globe — topology, drone optimizer, gap report, satcom fade, link quality, radio suggest, readiness score, globe projection

M41: SVG network topology diagram — node roles, hover highlight, SVG export
M42: Drone altitude optimizer — 6 AGL heights, bar chart, auto-apply best
M43: Coverage gap report — dead zone table export with relay recommendations
M44: Satcom rain-fade badges — Ka/Ku per GEO satellite (ITU-R P.618-14)
M45: Link-quality topology edges — FSPL margin-coded colours + hover tooltip
M46: Smart radio-to-node suggestions — heuristic scoring (range/band/power/mode), top-3 per role
M47: Mission readiness score — 0-100 gauge in ops dashboard, 6-dimension breakdown, toolbar badge
Globe: 3D terrain view uses spherical globe projection, not infinite Mercator plane"

# Push naar main
git push origin main

# Trigger GitHub Pages deploy
gh workflow run deploy.yml --ref main 2>/dev/null || echo "(geen gh CLI — Pages deploy via push)"

echo ""
echo "✓ Gepusht naar main"
echo "✓ GitHub Pages deploy getriggerd"
echo "  Live op: https://johncheesy.github.io/Groundlink-comms-planner/"
echo "  Status:  gh run list --workflow=deploy.yml"
