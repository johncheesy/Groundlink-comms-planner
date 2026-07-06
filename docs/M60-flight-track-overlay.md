# M39 — Flight Track Overlay

> **Status: spec — Jun 2026.** KML/GPX vliegroutes importeren, tonen op kaart, en RF coverage op hoogte berekenen.

---

## Waarom

Drone-relay planning vandaag: de operator weet ruwweg waar de drone gaat vliegen, maar kan dat niet in GroundLink laden. Ze moeten zelf schatten of de drone-relay op hoogte voldoende coverage geeft langs de geplande route, en of er gaten zijn op kritieke punten.

**M39 importeert een bestaande vliegroute (KML/GPX), toont hem op de kaart in azure, en berekent de RF coverage op de track-hoogte** — zodat zichtbaar wordt waar langs de route de comms werkt en waar niet.

Dit combineert drie bestaande modules op een nieuwe manier:
- `src/io/import.js` (bestaand — parseert al KML voor sites)
- `src/map/` (bestaand — MapLibre GL layers)
- `src/coverage/coverage.js` (bestaand — coverage worker, andere txHeightM)

---

## Scope

**In scope:**
- KML en GPX importeren via drag-drop of bestandskiezer (⌘K: "Import flight track")
- Track als GeoJSON LineString op de kaart in azure (`--feat-track`)
- Per-waypoint hoogte lezen (uit KML `<altitudeMode>` + `<coordinates>`, of GPX `<ele>`)
- "Coverage at track altitude" run: hergebruik coverage worker met txHeightM = track altitude
- Vergelijkende resultcard: coverage op hoogte vs. op mast-hoogte
- Altitude profile widget (extend M14 path-profile pattern)

**Buiten scope:**
- Live telemetrie (MAVLink stream) — dat is M41
- Meerdere tracks tegelijk (één actieve track per missie in M39)
- Animatie/tijdlijn — dat is M40
- SHP/DXF/andere formaten — later

---

## A. Import

### Formaten
```
KML  <LineString><coordinates>4.32,52.14,120 4.33,52.15,115 …</coordinates></LineString>
GPX  <trkpt lat="52.14" lon="4.32"><ele>120</ele></trkpt>
```

Beide produceren hetzelfde interne formaat:

```js
// Track object
{
  id: 'track-1',
  name: 'Mission Alpha',
  waypoints: [
    { lng: 4.32, lat: 52.14, altM: 120 },
    { lng: 4.33, lat: 52.15, altM: 115 },
    …
  ],
  altMode: 'absolute' | 'relativeToGround' | 'clampToGround',
  source: 'kml' | 'gpx',
}
```

### Parser (`src/io/track-import.js` — nieuw)
```js
export function parseKmlTrack(xmlText)  → Track | null
export function parseGpxTrack(xmlText)  → Track | null
export function importTrackFile(file)   → Promise<Track>  // auto-detect
```

Reuse de XML-parsing die al in `src/io/import.js` bestaat voor KML-sites.

---

## B. Map layer

### Layer in MapLibre (`src/map/tracks.js` — nieuw)
```js
export function createTrackLayer(map, { onWaypointClick } = {}) {
  // GeoJSON source: 'flight-track'
  // Layer 1: lijn — azure, 2.5px, gestippeld als altMode=clampToGround
  // Layer 2: waypoints — azure cirkels, radius 4px
  // Layer 3: start/eind markers — grotere cirkels (start = groen, eind = amber)

  return {
    setTrack(track) { /* update GeoJSON source */ },
    clear() { /* verwijder track */ },
    setHighlight(waypointIdx) { /* highlight een punt */ },
  };
}
```

Kleur: `--feat-track` (#46a6ff azure), zelfde als drone envelope. Lijn-style: solid 2.5 px.

---

## C. Coverage op track-hoogte

### Mechanisme
De bestaande coverage worker accepteert al `txHeightM`. Voor een track:
1. Bereken de **gemiddelde track-hoogte** (of gebruik de eerste waypoint als de hoogte constant is)
2. Run coverage worker met `txHeightM = track.avgAltM`
3. Toon resultaat naast de normale ground-coverage run

Dit kost precies één extra coverage-run. Geen nieuwe worker-logica nodig.

### UI: vergelijkende badge
Na de run verschijnt in de result card:

```
RF Coverage @ track altitude (avg 118 m)
▪ 94% covered   (vs 71% @ 2m mast)
▪ 0 dead zones  (vs 3 @ ground)
▪ +23% gain van de hoogte
```

---

## D. Altitude profile

### Widget (`src/ui/track-panel.js` — nieuw)
Extends het M14 path-profile patroon (`src/ui/profile-panel.js`):

```
Track altitude profile
[svg chart: hoogte (m) op Y-as, afstand (km) op X-as]
[gestippelde lijn op min. hoogte voor LOS naar AOI-centroid]
Waypoint 3: 52.16°N 4.34°E — 108 m AGL
```

Het panel opent automatisch na track-import, als slide-over aan de onderkant (zelfde positie als M14 profile panel).

---

## E. ⌘K integratie

Nieuwe palette-commando's (via M20 `src/ui/palette.js`):

```
Import flight track       → bestandskiezer openen
Clear flight track        → track verwijderen van kaart
Run coverage at altitude  → start de "track hoogte" coverage run
Show altitude profile     → track-panel tonen
```

---

## F. Missiebestand

Track wordt opgeslagen in de `.groundlink.json` (M21):

```json
{
  "flightTrack": {
    "name": "Mission Alpha",
    "waypoints": [...],
    "altMode": "absolute",
    "source": "kml"
  }
}
```

---

## G. Nieuwe en gewijzigde bestanden

| File | Type | Actie |
|---|---|---|
| `src/io/track-import.js` | nieuw | KML/GPX parser |
| `src/map/tracks.js` | nieuw | MapLibre track layer |
| `src/ui/track-panel.js` | nieuw | altitude profile widget |
| `src/io/import.js` | wijzigen | drag-drop handler uitbreiden voor KML-tracks |
| `src/ui/palette.js` | wijzigen | 4 nieuwe commands |
| `src/io/mission.js` | wijzigen | flightTrack in save/load |
| `src/main.js` | wijzigen | track-import wiring + coverage-at-altitude trigger |
| `styles/components.css` | wijzigen | `.track-panel` styling |

**Complexiteit: Groot (8 bestanden).** Spec vereist vóór build-start.

---

## H. Beslissingen voor de build

1. **Hoogte-mode.** Standaard `relativeToGround` als `<altitudeMode>` ontbreekt. Toon een waarschuwing als het `clampToGround` is (dan is er geen hoogte-data).
2. **Coverage run scope.** Run op de volledige AOI (niet alleen langs de track) — zo zie je of de drone-op-hoogte de hele missie-area dekt, niet alleen zijn eigen route.
3. **Meerdere waypoint-hoogtes.** Gebruik gemiddelde voor de coverage-run. Optioneel later: per-segment run (M40).
4. **GPX met ontbrekende hoogte.** Fall back to 0 m AGL + toon waarschuwing "hoogte ontbreekt in GPX".
