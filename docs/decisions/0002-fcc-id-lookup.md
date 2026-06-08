# 0002 — FCC ID lookup: best-effort, no backend (M5)

*Status: accepted · 2026-06-07*

## Context

M5 lets users import the radios they carry so the specs drive the coverage
model. The richest open source is the **FCC OET / Equipment Authorization**
database, reachable via the **EAS Web API** (KDB 953436: `getFCCIDList`,
`getGrantsByFCCID`, etc. on `apps.fcc.gov`). A grant yields frequency range,
max output power and emission designators.

GroundLink is **web-first with no backend** (GitHub Pages, public-safe build).
Two hard limits:

1. **CORS.** `apps.fcc.gov` does not advertise permissive CORS headers, so a
   direct browser `fetch` is expected to be blocked in most browsers. This is
   unverified per-endpoint and may change, so we *try* it but never depend on it.
2. **Coverage of the data itself.** A grant is not a channel plan or antenna
   limit; SDoC devices and most Part-97 (amateur) gear are absent entirely.

## Decision

Three tiers, all landing in the same editable `radio` model:

1. **Curated library** (`library.json`) — instant, offline, indicative.
2. **FCC ID lookup, best-effort** — try the EAS Web API from the browser; on the
   expected CORS/network failure, **degrade gracefully**: surface an external
   "Open FCC record" / "fccid.io" link (new tab) plus a compact 4-field manual
   form (freq range, power, sensitivity). No scraping, no third-party fetch
   fallback, no console error spam.
3. **Manual entry** — always available; every field editable.

If a response *does* come through, map grant frequency range + output power into
the model, leave sensitivity/gain at role defaults, set `source: 'fcc'`.

## Deferred — a tiny proxy (Phase B)

A minimal same-origin proxy (or a build-time snapshot of common FCC IDs) would
make tier 2 reliable by sidestepping CORS. Explicitly **out of scope for M5** —
it needs a backend/build step we don't have yet. Options when we revisit:

- A serverless function (Cloudflare Worker / Netlify function) that proxies the
  EAS Web API with permissive CORS and light caching.
- A build-time fetch that snapshots a curated set of FCC IDs into static JSON
  shipped with the app (no runtime backend, but stale and limited).

Either is a later decision; M5 ships tiers 1 + 3 as the reliable path and tier 2
as a bonus when the browser allows it.
