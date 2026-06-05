# Design tokens — GroundLink Comms Coverage Planner

Codifies the look from `../../groundlink_moodboard_v6.html`. Drop the CSS block below into `styles/tokens.css` and use the variables everywhere. Light is the default; dark via `:root[data-theme="dark"]`. The **map canvas stays dark in both themes**.

## Principles

- One functional accent (**deep teal**). Colour = meaning, not decoration: **teal** action/signal, **azure** assets/tracks, **amber** events. Coverage = vivid aqua→rose spectrum, shown on the dark map.
- Type: **Sora** (display) + **Hanken Grotesk** (body). Tabular figures for all data. Never Inter/Roboto/Arial.
- Calm surfaces, hairline borders, soft shadows. No gradient headlines, glow/aurora backgrounds, glassmorphism, shiny buttons, or sparkle icons.

## Type

- Display: `Sora`, weights 600/700, tight tracking (`letter-spacing:-.02em`).
- Body/UI: `Hanken Grotesk`, 400/500/600.
- Data/numbers: Hanken with `font-variant-numeric: tabular-nums`.
- Google Fonts: `Sora:wght@400;500;600;700` + `Hanken+Grotesk:wght@400;500;600;700`.

## Coverage signal scale (on the dark map; constant across jobs)

|Class    |Colour   |Threshold (VHF default, editable)|
|---------|---------|---------------------------------|
|Excellent|`#34e6c2`|≥ -85 dBm                        |
|Good     |`#86e6a0`|≥ -95 dBm                        |
|Marginal |`#ffd479`|≥ -103 dBm                       |
|Poor     |`#ff9f7a`|(transition)                     |
|None     |`#ff6b8a`|< -110 dBm                       |

## Map feature colours (typed, EarthRanger-style)

- Site / recommended mast: `#34e6c2` (teal)
- Subject / tracked unit / route: `#46a6ff` (azure)
- Event / alert: `#ffd479` (amber)
- AOI boundary: dashed azure
- Map canvas background: `#0b1018`

## Tokens (copy into styles/tokens.css)

```css
:root{
  /* light (default) */
  --bg:#f4f6f9; --bg2:#edf0f4;
  --surface:#ffffff; --surface2:#fafbfd; --raise:#f0f3f7;
  --hair:#e5e8ef; --hair2:#d6dce5;
  --ink:#0f141b; --dim:#586273; --faint:#929cac;
  --accent:#0a8475;          /* deep teal: text, lines, primary action */
  --accent-bright:#19c4ad;   /* vivid teal: fills/tints on light */
  --accent2:#2a7fe0;         /* azure: assets / tracks */
  --accent-ink:#ffffff;      /* text on accent button */
  --warn:#cf8a16; --bad:#dd4f68; --ok:#0a8475;

  /* map canvas + on-map feature colours (theme-independent) */
  --mapbg:#0b1018; --mapink:#cfe7e2;
  --feat-site:#34e6c2; --feat-track:#46a6ff; --feat-event:#ffd479;

  /* coverage spectrum (on the dark map) */
  --s1:#34e6c2; --s2:#86e6a0; --s3:#ffd479; --s4:#ff9f7a; --s5:#ff6b8a;

  /* type, shape, depth */
  --disp:'Sora',sans-serif;
  --ui:'Hanken Grotesk',system-ui,sans-serif;
  --r:18px;
  --shadow:0 1px 2px rgba(16,24,40,.05), 0 12px 30px -16px rgba(16,24,40,.18);
}

:root[data-theme="dark"]{
  --bg:#0b0d12; --bg2:#0c0f15;
  --surface:#13161e; --surface2:#171b24; --raise:#1c212c;
  --hair:rgba(255,255,255,.08); --hair2:rgba(255,255,255,.15);
  --ink:#eef0f5; --dim:#a6adbe; --faint:#6c7490;
  --accent:#34e6c2;          /* bright teal reads on dark */
  --accent-bright:#34e6c2;
  --accent2:#46b6ff;
  --accent-ink:#03201b;      /* dark text on bright accent */
  --warn:#ffd479; --bad:#ff6b8a; --ok:#34e6c2;
  --shadow:0 22px 48px -22px rgba(0,0,0,.7), 0 1px 0 rgba(255,255,255,.04) inset;
  /* --mapbg / feature / coverage tokens are intentionally shared with light */
}
```

## Component notes

- **Buttons:** primary = solid `--accent` with `--accent-ink` text (no glow); secondary = `--surface` with hairline. Radius ~11px.
- **Segmented controls:** pill container; active tab = subtle accent tint + accent text.
- **Inputs:** `--surface` fill, hairline border, tabular figures for coordinates/specs.
- **Cards/panels:** `--surface`, 1px `--hair`, radius `--r`, soft `--shadow`.
- **Badges:** soft tinted pill per semantic colour (ok/warn/bad) + a neutral azure for "reference".
- **Map markers:** filled dot + soft same-colour halo; AOI dashed; tracks with direction arrows.
- **Theme toggle:** flips `document.documentElement.dataset.theme` between `''` and `dark`. In-memory only inside embedded previews; persist only on the hosted origin.
