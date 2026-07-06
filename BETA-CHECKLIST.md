# BR1 — Beta Readiness Checklist

Target version: `v0.9.0-beta`  
Status: **IN PROGRESS** (BR1 sprint, July 2026)

Legend: ✅ done · 🔄 in progress · ⏸ deferred · ❌ blocked

---

## G0 — Baseline

| # | Item | Status | Notes |
|---|------|--------|-------|
| G0.1 | `npm ci` clean | ✅ | Confirmed on Mac, Jun 2026 |
| G0.2 | `npm test` 381/381 | ✅ | All pass as of BR1 start |
| G0.3 | OPSEC decisions documented | ✅ | maps.mail.ru removed; no personal names/emails in repo |
| G0.4 | No secrets in git history | ✅ | CloudRF key = sessionStorage only; .env.* in .gitignore |

---

## Phase 1 — Security hardening

| # | Item | Status | Notes |
|---|------|--------|-------|
| 1.1 | CSP meta header with explicit allowlist | ✅ | `connect-src` enumerates all external endpoints |
| 1.2 | Inline frame-buster with SHA-256 hash | ✅ | `sha256-W2WFH2+…` in script-src |
| 1.3 | `no-referrer` meta policy | ✅ | |
| 1.4 | Remove maps.mail.ru from Overpass endpoints | ✅ | Down from 3 → 2 endpoints; test updated |
| 1.5 | Unified escape helper `src/util/esc.js` | ✅ | 15 local variants replaced in 7 files |
| 1.6 | Self-host Sora + Hanken Grotesk fonts | ⏸ | Removes Google Fonts IP leak; planned for v1.0 |
| 1.7 | `npm audit --audit-level=high` in CI | ⏸ | Add to `deploy.yml`; planned for v1.0 |
| 1.8 | Domain-neutral UI jargon sweep | ⏸ | Remove EW/jamming/SITREP/ATAK EUD from visible strings; v1.0 |

---

## Phase 2 — Documentation truth pass

| # | Item | Status | Notes |
|---|------|--------|-------|
| 2.1 | README reflects M47 reality | ✅ | Full feature table, correct stack (MapLibre not Leaflet) |
| 2.2 | `context.md` updated to M47 + E-series | ✅ | Propagation section, open decisions, status |
| 2.3 | `docs/INDEX.md` — milestone cross-reference | ✅ | Milestone→spec→dispatch→source→status table |
| 2.4 | `docs/M60-flight-track-overlay.md` renaming | ✅ | M39 collision resolved; roadmap backlog renumbered M60+ |
| 2.5 | Superseded dispatch docs marked | ✅ | `docs/parked/` with superseded suffix + banner |

---

## Phase 3 — Performance and code health

| # | Item | Status | Notes |
|---|------|--------|-------|
| 3.1 | main.js decomposition (4,223 lines) | ⏸ | Deferred to v1.0 post-beta; requires app-ctx.js architecture |
| 3.2 | Bundle deduplication — geotiff lazy in workers | ✅ | Dynamic `import('./cog.js')` in sources.js; sourcemap:false |
| 3.3 | Error toasts for network failures | ✅ | Overpass, cellular, coverage worker errors now showToast() |
| 3.4 | Vite version audit | ⏸ | Currently v6; review after beta |

---

## Phase 4 — UI/UX polish

| # | Item | Status | Notes |
|---|------|--------|-------|
| 4.1 | Aria-label on icon-only buttons | ✅ | structure-item__remove (radios.js) fixed; toolbar/panel already labelled |
| 4.2 | Focus trap in palette (⌘K) | ✅ | Scrim click closes; Esc returns focus to map canvas |
| 4.3 | ⌘K empty state | ✅ | Shows top 6 items from each section by default; "Type to search" fallback |
| 4.4 | Keyboard round-trip test | 🔄 | Manual verification needed before tag |

---

## Phase 5 — Beta packaging

| # | Item | Status | Notes |
|---|------|--------|-------|
| 5.1 | `package.json` version → `0.9.0-beta` | ✅ | |
| 5.2 | `CHANGELOG.md` written | ✅ | M1–M47 + E-series + BR1 hardening |
| 5.3 | `BETA-CHECKLIST.md` (this file) | ✅ | |
| 5.4 | Git tag `v0.9.0-beta` | 🔄 | Keith to run after final commit |
| 5.5 | Deploy to GitHub Pages | 🔄 | Keith to run `npm run deploy` after tag |

---

## Phase 6 — Verification

| # | Item | Status | Notes |
|---|------|--------|-------|
| 6.1 | `npm test` 381/381 green before tag | 🔄 | Run before tagging |
| 6.2 | Manual smoke test in browser | 🔄 | AOI draw → coverage → PACE → export flow |
| 6.3 | CSP violations check (browser console) | 🔄 | Open devtools, navigate all panels |
| 6.4 | PWA install prompt appears | 🔄 | Visit on mobile or Chrome desktop |
| 6.5 | Mission file round-trip | 🔄 | Save `.groundlink.json`, reload, load file |

---

## Deferred to v1.0

- Phase 3.1: main.js decomposition → `src/ui/app-ctx.js` shared context pattern
- Phase 1.6: Self-host fonts (removes Google Fonts IP leak)
- Phase 1.7: `npm audit` in CI
- Phase 1.8: Domain-neutral jargon sweep
- Phase 3.4: Vite upgrade (v6 → v8)
- Worker cancellation (coverage abort on re-draw)
- OpenCelliD snapshot regeneration (pipeline wired in M9, sample in place)

---

## Final release commands (Keith runs these)

```bash
cd "/Users/felix/Desktop/THE GROUNDLINK/GROUNDLINK CODE"

# Verify green
npm test

# Commit packaging
git add package.json CHANGELOG.md BETA-CHECKLIST.md src/radios/radios.js
git commit -m "chore(br1-p5): bump 0.9.0-beta, CHANGELOG, BETA-CHECKLIST

- package.json: 0.1.0 → 0.9.0-beta
- CHANGELOG.md: full M1–M47 + E-series + BR1 hardening entry
- BETA-CHECKLIST.md: BR1 phase status
- radios.js: aria-label on structure remove button (Phase 4.1)

BR1 Phase 4.1 + Phase 5"

# Tag the beta
git tag -a v0.9.0-beta -m "GroundLink v0.9.0-beta — M47 feature-complete + BR1 hardening"

# Deploy
npm run deploy
```
