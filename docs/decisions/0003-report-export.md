# 0003 — Comms-plan report export: client-side, zero dependency (M6)

*Status: accepted · 2026-06-08*

## Context

M6 produces an exportable comms-plan report. `CLAUDE.md` names the deliverable as
"exportable report (PDF/Word)"; the user asked for **PDF, Word and Excel**,
selectable independently (checkboxes, any combination).

Two standing constraints shape the choice:

1. **Web-first, no backend** (GitHub Pages, public-safe build). There is no
   server to render a PDF/DOCX/XLSX, so everything must run in the browser.
2. **Dependency-light — justify every dependency** (`CLAUDE.md`). True OOXML
   `.docx`/`.xlsx` generation needs libraries (e.g. `docx`, SheetJS). A real
   client-side PDF needs `jsPDF`/`pdf-lib`.

## Decision

Ship all three formats with **no new dependency**, from one HTML report core:

- **PDF** — open a print-optimised report in a new tab and trigger the browser's
  print dialog (*Save as PDF*). This is the standard web-first route to a
  high-fidelity PDF and adds nothing to the bundle. Pop-up blocked → fall back to
  a downloadable standalone `.html`.
- **Word** — a Blob with `type: application/msword` and a `.doc` extension whose
  body is the report HTML. Word opens and edits it.
- **Excel** — a Blob with `type: application/vnd.ms-excel` and a `.xls`
  extension whose body is the plan as HTML `<table>`s. Excel opens it.

All three are generated and downloaded in the browser — consistent with OPSEC
(no upload, no committed coordinates).

## Consequences

- **+** Zero bundle cost, no supply-chain surface, ships today, honours the
  dependency rule.
- **+** One source of truth (the HTML report) drives all three outputs.
- **−** The Word/Excel files are HTML-backed, not true OOXML. Modern Office may
  show a one-time "file format and extension don't match" prompt before opening,
  and very advanced formatting is limited.
- **−** PDF goes through the print dialog rather than a one-click download.

## Later (if the warning or fidelity matters)

Add true OOXML behind the same `exportReport()` API: SheetJS for `.xlsx`, the
`docx` library for `.docx`, and optionally `jsPDF`/`pdf-lib` for a one-click
`.pdf`. Each is a justified dependency *iff* the HTML-backed route proves
insufficient in review — the export call site does not change.
