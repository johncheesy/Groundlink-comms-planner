# M41 — Network Topology View

## Goal
SVG-based interactive diagram of the comms network structure — which nodes talk to which, mapped to the five operational node roles and PACE tiers.

## Files
- `src/ui/topology.js` — panel widget + SVG builder
- `styles/components.css` — `.topo-*` + `.section__details` styles
- `index.html` — `<details id="topologyDetails">` in the Comms Plan section, after the freq plan button
- `src/main.js` — import + wiring (PACE build, role assign, lazy-open toggle)

## How it works

### Data sources
- **Nodes**: `assignRoles(radios.getArsenal(), gatherRoleContext())` — the five operational roles (HQ, Rebro static, Rebro mobile, Mobile CP, Operator), each with the best-fit radio from the arsenal.
- **Edges**: hardcoded comms chain (HQ → Rebro static/mobile → Mobile CP → Operator), pruned to nodes that actually exist.
- **PACE legs**: available via `getLastPlan()` for future overlay (tier badges not yet rendered; follow-up task).

### Layout
Nodes placed on a 440×210 SVG canvas in four vertical tiers (0=top=HQ, 3=bottom=Operator). Multiple nodes in the same tier are distributed horizontally.

### Colour coding
| Colour | Roles |
|--------|-------|
| Teal (`--accent`) | HQ (base station) |
| Azure (`--accent2`) | Mobile CP, Operator (handheld/mobile) |
| Amber (`--feat-event`) | Rebro static, Rebro mobile (repeater) |

### Interactivity
- Hover / focus on any node: dims unconnected edges and other nodes; highlights connected edges in teal.
- Keyboard navigable (tabindex, focus/blur events).

### Export
"Export SVG" button serialises the SVG via `XMLSerializer` to a blob download.

## UI placement
Inside a `<details class="section__details">` in `#paceResults`, so it only renders after the PACE plan is built and the user explicitly opens it. Lazy first-render via the `toggle` event.

## Update triggers
- First open of the `<details>` element.
- After "Assign roles" button click.
- After "Build comms plan" button click.

## Follow-up
- Add PACE tier badges as node labels (P/A/C/E pill on the edge or node).
- Show which PACE tier each link operates on.
- Coverage-mode tab: shade edges by signal quality.
