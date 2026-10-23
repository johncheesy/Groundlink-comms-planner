# UX research: a calmer, task-led GroundLink

**Status:** research + proposal, 22 Oct 2026 · not built
**Trigger:** user feedback after the Upemba GUI run: the interface is busy and hard to follow, whether a feature works or not.

## 1. What is wrong today (measured)

Counted in the running app (desktop, Upemba mission loaded):

| Element | Count |
|---|---|
| Left-panel sections (cards) | 14: Objects, Mission, Area of interest, Radios, Node roles, Coverage, Signal, Site recommendation, Drone relay, Cellular coverage, Comms plan, Power & endurance, Data export, Layers |
| Buttons inside those sections | 302 |
| Inputs and selects inside them | 135 |
| Top-toolbar buttons | 24 |
| Map-rail buttons | 9 |
| Ways to reach a section | 5: toolbar group, left icon strip, plan stepper, ⌘K palette, right rail |

The GUI run (see the Upemba report) showed what this costs:

- **Things live far from where they act.** The radio editor opens inside a collapsed "Add by FCC ID / manual" disclosure. Link results sit in the Mission card, while their profile opens at the bottom of the map. The coverage settings that decide a link's budget sit in a third card.
- **One value, several places.** Power and mast height exist in the Coverage card, in the per-site popover and implicitly in the radio set. Applying a radio set silently overwrote values set elsewhere (fixed now, but it shows the model is unclear).
- **Overlays compete for the map.** Result card, map key, signal legend, beta banner, path profile drawer and popups overlap at laptop size. At 800 px wide the map is less than half the screen.
- **Status lives in the status bar.** The only feedback for a cancelled load or a failed link was a truncated status line.

## 2. What comparable tools do (OSINT)

| Source | Pattern | Relevance to GroundLink |
|---|---|---|
| NN/g: progressive disclosure | Show the few options most people need; defer advanced and rare options to a secondary screen. Keep it to at most two levels. | 135 inputs are visible or one click away. Most planners need about 10. |
| Staged disclosure / wizard pattern libraries | A wizard is a corridor: clear for novices, frustrating for experts who know the structure. Use it for ordered setup, and let experts skip it. | First-run "new plan" flow, not the main UI. |
| QGroundControl (drone GCS) | Separate **Plan** and **Fly** views, switched from one top-level selector; each view shows only its own tools. | Task modes instead of 14 always-present cards. |
| CloudRF PNUT | Settings defined once at **network level**; sites that share them only adjust height and power. Templates are saved and reused. The older single-site UI did not scale to networks. | Exactly GroundLink's "radio set vs per-site" confusion. |
| Felt 2.0 | Top toolbar with small icons, a left pane for layers, a **contextual detail panel** for the selected feature, and a safe view mode separate from edit mode. | One detail panel instead of popovers, context menus and cards. |
| Figma UI3 | **Selection-driven inspector**: the right panel shows only the controls for what is selected (file settings when nothing is). One shortcut hides all chrome. | Select a site and see its RF; select a link and see its budget; select nothing and see the network defaults. |
| EarthRanger 2.121 | Layer panel split into **category tabs**, a search box, **Hide all**, and visibility remembered between sessions. | GroundLink's layers are spread over the rail, the Layers card and section toggles. |
| Density guidance (pattern libraries, Basis design system) | Experts handle dense screens well if the density is structured. Let users choose the density. A minimal UI that hides needed controls adds load. | Do not just hide things: group them by task and let the expert keep a compact view. |
| Esri Press, *Designing Map Interfaces* (Gaigg, 2023) | 41 map-UI patterns: layout choice, map interaction, complex data, single-purpose apps. | A reference for layout decisions (book, not checked chapter by chapter). |

## 3. Proposal

### A. Three workspaces instead of 14 cards

The plan stepper already says Mission → Radios → Plan. Make those the top-level modes, like QGroundControl's Plan/Fly:

| Workspace | Shows | Cards now |
|---|---|---|
| **Set up** | Area, sites, points, route; radio set and equipment | Objects, Mission, Area of interest, Radios, Node roles |
| **Analyse** | Run coverage, links, gaps, site recommendation, drone relay, cellular | Coverage, Signal, Site recommendation, Drone relay, Cellular |
| **Brief** | PACE, power, frequency plan, exports, mission brief | Comms plan, Power, Data export |

Each workspace shows 3 to 5 cards. Layers move to the map rail. The left icon strip and the grouped toolbar collapse into one mode switch plus ⌘K.

### B. A selection-driven inspector (right side)

- **Nothing selected:** network defaults, which are the radio set (power, antenna, loss, frequency) and the default mast and rx heights.
- **Site selected:** its own height and power (inherited values shown as placeholders), antenna aim, its links, and "optimise height".
- **Link selected:** band, length, budget table and profile, Check, Remove.
- **Point selected:** the predicted level at that point (missing today).

This replaces the site popover, the link popup, most context-menu actions and the link list in the Mission card. The map context menu keeps only quick actions.

### C. Network defaults plus per-site overrides (the CloudRF model)

- The **radio set is the network template**. Applying it sets the defaults, and nothing else changes behind the user's back.
- The Coverage card stops owning power, antenna and loss. It shows the resulting EIRP read-only, with "override for this run" as an advanced option.
- A site overrides only height, power and antenna aim. A link overrides only its band and its end radios, which closes the 5.8 GHz gap.

### D. Two levels of disclosure, no deeper

- Each card has one **Advanced** fold: model percentiles, clutter, thresholds, grid detail, CloudRF.
- Remove nested disclosures such as the editor inside "Add by FCC ID / manual". An editor opens where you clicked.
- Rare tools (calibration CSV, offline packages, satcom, HF ionosphere) go behind ⌘K and a "More tools" menu in their workspace.

### E. One results area

- A **bottom drawer with tabs**: Coverage summary, Dead zones, Links, Profile, PACE. It replaces the floating result card, the separate profile drawer and the dead-zone list.
- The map key stays on the map. The beta banner closes for good once dismissed.

### F. Guided start for new users (optional corridor)

"New plan" asks four things in order: area, sites (or "recommend for me"), radio set, then run. It ends in the normal Analyse workspace. Experts never see it. They open a mission file or close the wizard.

### G. Density and focus

- A Compact/Comfortable switch for experts who want everything on one screen.
- Keep focus mode (fullscreen card), and add "hide all chrome" (Figma's shortcut) for briefings.

## 4. Phasing

| Step | Work | Size |
|---|---|---|
| 1. Quick wins | Merge the icon strip and toolbar groups into one mode switch; remember open cards and dismissed banners; add a results drawer with tabs | 2–3 days |
| 2. Inspector | Right-hand inspector for site, link, point and network defaults; retire the popovers | 1 week |
| 3. Workspaces | Regroup cards into Set up / Analyse / Brief; move layers to the rail | 1 week |
| 4. Model clean-up | Radio set as network template; per-link band and radios | 1 week, plus tests |
| 5. Wizard + density | Guided start; compact mode | 3–4 days |

## 5. How to check it worked

Run the Upemba task before and after with 5 users (two planners, two rangers or radio techs, one newcomer): load a mission → apply the radio set → compute → check all links → build PACE. Measure time on task, wrong turns and the System Usability Scale. Target: half the time and no "where is it?" moments.

## Sources

- NN/g, [Progressive Disclosure](https://www.nngroup.com/videos/progressive-disclosure/)
- Pattern Playground, [Wizard](https://pattern-playground.onrender.com/patterns/wizard) and [Density](https://pattern-playground.onrender.com/patterns/density); [Staged disclosure](https://1cademy.com/node/staged-disclosure/OmLgXk8LuYd7lvlg6bov)
- QGroundControl, [Plan View](https://docs.qgroundcontrol.com/master/en/qgc-user-guide/plan_view/plan_view.html) and [UI overview](https://docs.qgroundcontrol.com/master/en/qgc-user-guide/getting_started/ui_overview.html)
- CloudRF, [Web interface overview](https://cloudrf.com/documentation/02_web_interface_intro.html) and [3D interface](https://cloudrf.com/docs/3d-interface)
- Felt, [Tour the interface](https://help.felt.com:443/getting-started/tour-the-interface) and [UI upgrades](https://felt.com/blog/ui-upgrades)
- [Figma design breakdown](https://www.925studios.co/blog/figma-design-breakdown) (secondary source)
- EarthRanger, [Release notes 2.121](https://earthranger-support.helpjuice.com/en_US/release-notes-2121) and [Control map layers](https://earthranger-support.helpjuice.com/en_US/using-map-layers)
- Basis design system, [Density](https://design.basis.com/foundations/density)
- Esri Press, [Designing Map Interfaces](https://www.esri.com/en-us/esri-press/browse/designing-map-interfaces--patterns-for-building-effective-map-apps)
