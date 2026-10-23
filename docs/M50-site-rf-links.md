# M50 — Feeder loss, per-site height and power, radio links

**Status:** built 22 Oct 2026 · backlog from a real multi-site mission import
(three gaps the mission files could not express)

## Problem

1. Coverage ignored the antenna gain of the chosen radio and had no cable,
   connector or duplexer loss. A planner had to raise the power (e.g. 16 W
   instead of 25 W) to fake the right EIRP.
2. Every site used the panel's mast height and power. A network with a tall
   repeater and a few low relays could not be planned in one run.
3. A mission file could hold sites but not the radio links between them
   (point-to-point hops, backhaul to a repeater).

## What it does

### 1. Feeder loss and antenna gain from the radio set

- **Coverage panel (advanced):** *Cable/duplexer loss* (0–30 dB) next to
  *Rx antenna gain*, and an *EIRP* readout: power + antenna gain − loss, in
  dBm and W.
- **One EIRP everywhere** (`txEirpDbm()` in `main.js`): coverage, team runs,
  calibration per radio, the path profile, the mast wizard and CloudRF
  (`txl`) all use it.
- **Radio set → panel:** the radio model has `feederLossDb` (default 0) and
  the radio editor has *Ant dBi* and *Loss dB*. Applying a set copies the
  transmit radio's loss, and its antenna gain when the panel antenna is omni:
  the preset of that gain and shape if there is one (6 dBi → collinear),
  otherwise *Custom* (`withGain()` in `antenna.js`). A directional antenna
  the planner picked keeps its own gain; the radio's figure is for its stock
  antenna.
- **Shown** in the result card's assumptions line ("loss 3 dB") and saved in
  the mission file (`coverage.txLossDb`).

### 2. Mast height and power per site

- **Right-click a site → Mast height and power…** opens a small popover at
  the site. Empty fields follow the Coverage panel (its values are the
  placeholders); *Use panel values* clears both. Clamped to the panel's
  ranges (1–300 m, 0.01–100 W); a decimal comma works. Undo with ⌘Z.
- The site label shows its own values: `Ridge · 25 m · 10 W`.
- **Coverage:** `siteTx()` passes the site's height and EIRP
  (`txEirpDbm(site W)` + the run's calibration offset). Both engines are
  linear in EIRP, so the per-cell step adds `t.eirpDbm − params.eirpDbm`
  (`src/coverage/cell.js`); calibration prediction does the same. The
  compute window is sized by the strongest site.
- **Mast wizard:** *Apply* on a fixed site sets that site's height (not the
  panel's), and its link budget uses the site's power.
- **Mission file:** `sites[].txHeightM`, `sites[].powerW` (optional).

### 3. Radio links

- **Model** (`src/mission/mission.js`): `links: [{ id, a, b, label, freqMHz? }]`
  between two sites. No self-links, no duplicate pair (either direction), at
  most `LIMITS.links` (600). Removing a site removes its links.
- **Add:** right-click a site → *Add radio link…*, then click the other site
  (or the map within 30 px of it). Esc cancels. Undo with ⌘Z.
- **Map** (`src/map/radio-links.js`): a line per link over a dark casing.
  Dashed neutral until checked; then teal (margin ≥ 10 dB), amber (under
  10 dB, or Fresnel zone blocked), rose (does not close). Click a line for
  its name (editable), length, margin, *Path profile* and *Remove*.
- **Mission panel:** a *Radio links* row (count, Clear) and a list with
  length, margin badge (`+32 dB, blocked`), *Profile* and ×. *Check all
  links* profiles every link in turn.
- **Link check:** the M14 path profile between the two sites
  (`profileTool.showBetween()`), with tx height/EIRP from site A, rx height
  from site B (a mast, not a handheld), the link's own band when the file
  has one, rx gain = panel antenna gain − feeder loss, and margin over the
  receiver sensitivity (*No coverage* threshold). A check is kept only while
  its inputs are unchanged; moving a site or changing power turns the line
  dashed again.
- **Mission file:** `links: [{ a, b, label, freqMHz? }]`, `a`/`b` are
  indexes into `sites`. When a bad site is skipped on load, the links are
  re-indexed so they stay on the right sites; links to a missing site,
  self-links and duplicates are dropped and reported.

## Assumptions and limits

- Link budgets assume both antennas face each other (peak gain at both
  ends). A sector pointed elsewhere would do worse.
- Link checks use the M14 profile: terrain only, Deygout diffraction, FSPL,
  4/3 earth. No clutter, no P.1812, no rain fade (relevant above ~10 GHz).
- The feeder loss and EIRP readout sit in the advanced controls, like the
  antenna gain.

## Tests

`src/coverage/site-rf.test.js`, `src/mission/site-rf-links.test.js`,
`src/io/mission-links.test.js` — 24 tests: preset matching, radio loss to
coverage, per-site EIRP in the cell step and calibration, link status and
features, popover parsing, the link model, and the file round-trip
including re-indexing after a dropped site.
