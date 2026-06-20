# E4 — Satellite Link Rain Fade Calculator

> **Status: shipped (engine only) — Jun 2026.** UI panel pending (can be surfaced in the Satcom section or the link-budget panel).

## What it does

Implements **ITU-R P.618-14** rain attenuation for GEO satellite links. Given a ground station location, elevation angle, frequency and polarisation, returns rain attenuation (dB) exceeded at 99%, 99.5%, 99.9%, and 99.99% availability.

Also includes a `satLinkBudget()` helper that combines rain fade with FSPL to give clear-sky margin and remaining fade margins.

## References

- **ITU-R P.618-14** (2022) — satellite link attenuation
- **ITU-R P.838-3** — specific attenuation coefficients (γ_R = k · R^α)
- **ITU-R P.839-4** — mean rain height (h_R = h_0 + 0.36 km)
- **ITU-R P.837** — rain rate (simplified zone table)

## Files

| File | Role |
|---|---|
| `src/analysis/rain-fade.js` | Full P.618-14 engine: `rainAttenuation()`, `satLinkBudget()`, `p838Coeffs()` |

## Accuracy

±3 dB — adequate for link-budget planning. Limitations:
- Rain rate uses a simplified latitude-zone table instead of the full ITU-R P.837 digital maps.
- Rain height uses a simplified P.839-4 approximation.

## API

```js
import { rainAttenuation, satLinkBudget } from './src/analysis/rain-fade.js';

// Rain attenuation exceeded at each availability level
const { p, A } = rainAttenuation({
  latDeg: 52.37,
  lngDeg: 4.90,
  elevDeg: 30,        // look angle to satellite
  freqGhz: 12,        // Ku-band
  polarDeg: 45,       // circular polarisation (default)
  htKm: 0,            // station altitude (default 0)
});
// p = [99, 99.5, 99.9, 99.99]
// A = [dB, dB, dB, dB]

// Full link budget
const budget = satLinkBudget({
  eirpDbw: 45, satGainDbd: 30, freqGhz: 12, elevDeg: 30,
  latDeg: 52.37, lngDeg: 4.90,
});
// budget.fadeMargin99  — dB remaining above 99% availability rain fade
// budget.recommendation — plain-text EIRP adequacy verdict
```

## Open follow-up

- Wire into the Satcom panel (M38) as a Ka-band fade margin indicator.
- Show fade margin for each GEO satellite's look angle + detected band.
