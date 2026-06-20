# E3 — Quick Wins Bundle: Confidence · Model Badge · Run-All

> **Status: spec — Jun 2026.** Drie kleine Maven-geïnspireerde verbeteringen die elk op zichzelf staan maar thematisch bij elkaar horen: meer transparantie en minder klikken.

---

## Overzicht

| Feature | Bestanden | Complexiteit |
|---|---|---|
| E3a Coverage confidence overlay | `src/coverage/confidence.js` (nieuw), `styles/components.css` | Klein |
| E3b Model accuracy badge | `src/ui/badges.js` (bestaat al), `src/ui/resultcard.js` | Klein |
| E3c One-click Run All | `src/ui/toolbar.js`, `src/main.js` | Klein |

Allemaal los te bouwen en te shippenn. Geen onderlinge afhankelijkheden.

---

## E3a — Coverage Confidence Overlay

### Waarom
De RF coverage raster ziet er precies uit of het weet wat het doet — maar de nauwkeurigheid hangt sterk af van de kwaliteit van de terreindata. In vlak gebied met goede AWS Terrarium tiles is P.1812 vrij nauwkeurig. Op steile hellingen of in gebieden waar de tile-resolutie laag is, is de onzekerheid groot. Nu is dat onzichtbaar.

**E3a voegt een optionele "data kwaliteit" overlay toe op de kaart** — een heat map die laat zien hoe betrouwbaar de terreindata ter plaatse is.

### Hoe
De AWS Terrarium tiles hebben vaste resolutie (tile-afhankelijk, ~30 m per pixel op zoom 10). De kwaliteitsproxy is het lokale hoogteverschil per pixel (slope variance): hoog slope variance = kleine features die de tiles missen = lagere betrouwbaarheid.

```js
// src/coverage/confidence.js (nieuw)
export function computeConfidenceRaster(elevationGrid) {
  // Per pixel: bereken de slope variance t.o.v. de 4 buren
  // Normaliseer naar 0–1 (0 = laag vertrouwen, 1 = hoog)
  // Retourneer Float32Array van dezelfde dimensies als de coverage raster
}
```

### Map layer
Nieuwe optionele MapLibre raster-layer (type `fill` of canvas overlay, zelfde mechanisme als coverage raster):
- Kleur: amber gradient `rgba(255, 212, 121, 0)` → `rgba(255, 212, 121, 0.6)` (amber = events/alerts)
- Hoge amber-intensiteit = lage betrouwbaarheid
- Toggle in de rechter rail onder "Layers" of als checkbox in de resultcard

### UI
Checkbox in de result card (na een run): `☐ Toon data-kwaliteit overlay`
Tooltip: "Hoge amber-intensiteit = lagere terrein-datakwaliteit op dit punt."

### Bestanden
- `src/coverage/confidence.js` — nieuw, pure functie, unit-testbaar
- `src/map/map.js` — confidence layer registreren
- `src/ui/resultcard.js` — toggle checkbox toevoegen
- `styles/components.css` — geen grote wijzigingen

---

## E3b — Model Accuracy Badge

### Waarom
De propagatiemodel-selector (M20, Auto/P.1812/FSPL+Deygout/CloudRF) is verborgen in de settings. Na een run zie je wel het resultaat, maar niet welk model draaide of hoe nauwkeurig het is. Maven toont altijd "confidence in this estimate" — GroundLink moet dat ook doen.

**E3b voegt een klein badges-element toe aan de result card** dat toont: welk model, en wat de verwachte foutmarge is.

### Model accuracy schattingen

| Model | Typische foutmarge | Badge tekst |
|---|---|---|
| P.1812 (Auto) | ±6–10 dB | `P.1812 · ±8 dB` |
| FSPL + Deygout | ±10–15 dB | `FSPL+Deygout · ±12 dB` |
| CloudRF ITM | ±4–8 dB | `ITM · ±6 dB` |

Bron: ITU-R P.1812 validation studies; Deygout known overestimates diffraction loss.

### Implementatie
`src/ui/badges.js` bestaat al (M20). Toevoegen:

```js
export function modelBadge(modelName, percentileLabel) {
  const info = MODEL_ACCURACY[modelName] ?? { label: modelName, margin: '±? dB' };
  return `<span class="badge badge--model" title="${info.tooltip}">${info.label} · ${info.margin}${percentileLabel ? ' · ' + percentileLabel : ''}</span>`;
}

const MODEL_ACCURACY = {
  p1812:   { label: 'P.1812',         margin: '±8 dB',  tooltip: 'ITU-R P.1812 Delta-Bullington — validated op mediaan propagatie' },
  deygout: { label: 'FSPL+Deygout',   margin: '±12 dB', tooltip: 'Free-space path loss + Deygout diffraction — pessimistisch bij meervoudige wig-diffractie' },
  cloudrf:  { label: 'ITM/CloudRF',   margin: '±6 dB',  tooltip: 'Longley-Rice ITM via CloudRF API — nauwkeuriger maar vereist API key' },
};
```

Badge verschijnt in de result card naast "% covered":
```
87% covered  · P.1812 · ±8 dB · 50% time
```

### Bestanden
- `src/ui/badges.js` — modelBadge() toevoegen
- `src/ui/resultcard.js` — badge insluiten in `show(summary, modelInfo)`
- `src/main.js` — `modelInfo` doorgeven aan resultcard.show()

---

## E3c — One-Click Run All

### Waarom
De "comms chain" in GroundLink — AOI definiëren → coverage runnen → relay advies bekijken → PACE genereren → rapport exporteren — kost nu meerdere handmatige stappen. Maven comprimeerde de kill chain van uren naar minuten door dit te automatiseren. E3c doet hetzelfde voor de planning-chain.

**E3c voegt één "Run All" knop toe aan de toolbar** die de volledige chain uitvoert in volgorde: coverage → relay-advies → PACE update → resultcard tonen.

### Gedrag
```
[▶ Run All]  →  
  1. Coverage run starten (bestaand, coverage worker)
  2. Na completion: summarizeCoverage() → relay advies (bestaand)
  3. buildPace() aanroepen met laatste resultaten (bestaand)
  4. Resultcard tonen met model badge (E3b)
  5. Toast: "Analyse compleet — 87% covered, PACE plan bijgewerkt"
```

Knop is disabled zolang: geen AOI gezet EN geen RF objecten geplaatst, OF de coverage worker al draait.
Spinner tijdens run (bestaand busy-state patroon in toolbar).

### Toolbar positie
Nieuwe primaire actie-knop in de grouped toolbar (M20), links van de bestaande run-knop. Of vervangt die run-knop helemaal — afhankelijk van hoe de chain nu werkt in main.js.

### Bestanden
- `src/ui/toolbar.js` — Run All knop toevoegen
- `src/main.js` — `runAll()` functie implementeren (chain de bestaande handlers)
- `src/ui/toast.js` — bestaat al (M23 toast systeem)

### Undo-gedrag
Run All triggert geen undo-stap zelf — de individuele acties (coverage result, PACE result) worden als normale state-updates behandeld. Het is een convenience-wrapper, geen nieuwe transactie.

---

## Buildvolgorde

Aanbevolen: E3b → E3c → E3a

- E3b (badge) is het kleinst en levert direct zichtbaar resultaat
- E3c (run all) bouwt op E3b (toont badge in de keten)
- E3a (confidence) is iets zwaarder (nieuw raster) maar staat volledig los
