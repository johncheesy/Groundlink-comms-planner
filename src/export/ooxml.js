/**
 * Minimal Office Open XML writers — real .docx and .xlsx, no dependency.
 *
 * Both formats are ZIP packages of XML parts; `makeZip` (zip.js, already used
 * for KMZ) packs them. Only what the comms-plan report needs is supported:
 *
 *   buildDocx(blocks)  blocks: { type: 'title'|'h1'|'h2'|'p'|'note'|'bullet', text }
 *                              { type: 'table', header: [..], rows: [[cell..]..] }
 *   buildXlsx(sheets)  sheets: [{ name, header?: [..], rows: [[cell..]..], widths?: [..] }]
 *
 * A cell is a string/number, or { text, fill?: '#rrggbb', color?, bold? } for
 * the coloured PACE tier chips. Numbers stay numbers in Excel.
 *
 * Pure (returns bytes); see docs/decisions/0003-report-export.md.
 */

import { makeZip } from './zip.js';

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/** Escape text for XML element content / attributes; drops invalid control chars. */
export function xmlEsc(s) {
  return String(s ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const cellText = (c) => (c != null && typeof c === 'object' ? c.text : c);
// Only object cells carry formatting ('x'.bold is a String method, not a flag).
const isBold = (c) => c != null && typeof c === 'object' && c.bold === true;
const hex = (c) => String(c || '').replace('#', '').toUpperCase();

// ── Word (.docx) ─────────────────────────────────────────────────────────────

const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

const DOCX_STYLES = `${XML_HEAD}<w:styles ${W_NS}>
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="20"/><w:szCs w:val="20"/><w:lang w:val="en-GB"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="80" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="40"/></w:pPr><w:rPr><w:b/><w:sz w:val="40"/><w:szCs w:val="40"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="320" w:after="100"/><w:pBdr><w:bottom w:val="single" w:sz="4" w:space="2" w:color="D9DEDC"/></w:pBdr><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:color w:val="44504B"/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="60"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Note"><w:name w:val="Note"/><w:basedOn w:val="Normal"/><w:rPr><w:color w:val="6B736F"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="ListBullet"><w:name w:val="List Bullet"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="360" w:hanging="220"/></w:pPr></w:style>
<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>
<w:style w:type="table" w:styleId="PlanTable"><w:name w:val="Plan Table"/><w:basedOn w:val="TableNormal"/><w:pPr><w:spacing w:after="0"/></w:pPr><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:color="D9DEDC"/><w:left w:val="single" w:sz="4" w:color="D9DEDC"/><w:bottom w:val="single" w:sz="4" w:color="D9DEDC"/><w:right w:val="single" w:sz="4" w:color="D9DEDC"/><w:insideH w:val="single" w:sz="4" w:color="D9DEDC"/><w:insideV w:val="single" w:sz="4" w:color="D9DEDC"/></w:tblBorders><w:tblCellMar><w:top w:w="40" w:type="dxa"/><w:bottom w:w="40" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>
</w:styles>`;

function wRun(text, { bold = false, color = null } = {}) {
  const rPr = bold || color ? `<w:rPr>${bold ? '<w:b/>' : ''}${color ? `<w:color w:val="${hex(color)}"/>` : ''}</w:rPr>` : '';
  return `<w:r>${rPr}<w:t xml:space="preserve">${xmlEsc(text)}</w:t></w:r>`;
}

function wPara(text, style, runOpts) {
  const pPr = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : '';
  return `<w:p>${pPr}${wRun(text, runOpts)}</w:p>`;
}

function wCell(c, { header = false, widthPct }) {
  const obj = c != null && typeof c === 'object' ? c : null;
  const fill = obj?.fill ? hex(obj.fill) : header ? 'EEF2F0' : null;
  const tcPr = `<w:tcPr><w:tcW w:w="${widthPct}" w:type="pct"/>${fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>` : ''}</w:tcPr>`;
  const run = { bold: header || isBold(c), color: obj?.color ?? null };
  return `<w:tc>${tcPr}<w:p><w:pPr><w:spacing w:after="0"/></w:pPr>${wRun(cellText(c), run)}</w:p></w:tc>`;
}

function wTable({ header = [], rows = [] }) {
  const n = Math.max(header.length, ...rows.map((r) => r.length), 1);
  const widthPct = Math.floor(5000 / n); // fiftieths of a percent
  const grid = `<w:tblGrid>${'<w:gridCol w:w="2000"/>'.repeat(n)}</w:tblGrid>`;
  const tr = (cells, isHeader) =>
    `<w:tr>${isHeader ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}` +
    Array.from({ length: n }, (_, i) => wCell(cells[i] ?? '', { header: isHeader, widthPct })).join('') +
    '</w:tr>';
  return `<w:tbl><w:tblPr><w:tblStyle w:val="PlanTable"/><w:tblW w:w="5000" w:type="pct"/><w:tblLayout w:type="autofit"/></w:tblPr>${grid}` +
    (header.length ? tr(header, true) : '') + rows.map((r) => tr(r, false)).join('') +
    // Word needs a paragraph between consecutive tables and before the section end.
    '</w:tbl><w:p><w:pPr><w:spacing w:after="0"/></w:pPr></w:p>';
}

function docxBody(blocks) {
  return blocks.map((b) => {
    switch (b.type) {
      case 'title': return wPara(b.text, 'Title');
      case 'h1': return wPara(b.text, 'Heading1');
      case 'h2': return wPara(b.text, 'Heading2');
      case 'note': return wPara(b.text, 'Note');
      case 'bullet': return wPara(`•\t${b.text}`, 'ListBullet');
      case 'table': return wTable(b);
      default: return wPara(b.text ?? '');
    }
  }).join('');
}

/** Blocks → .docx bytes (A4, 2 cm margins). */
export function buildDocx(blocks, { title = 'GroundLink' } = {}) {
  const document = `${XML_HEAD}<w:document ${W_NS}><w:body>${docxBody(blocks)}` +
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr>' +
    '</w:body></w:document>';
  return makeZip([
    { name: '[Content_Types].xml', data: `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
      '</Types>' },
    { name: '_rels/.rels', data: `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
      '</Relationships>' },
    { name: 'docProps/core.xml', data: coreProps(title) },
    { name: 'word/_rels/document.xml.rels', data: `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '</Relationships>' },
    { name: 'word/styles.xml', data: DOCX_STYLES },
    { name: 'word/document.xml', data: document },
  ]);
}

function coreProps(title) {
  return `${XML_HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ` +
    'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" ' +
    'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
    `<dc:title>${xmlEsc(title)}</dc:title><dc:creator>GroundLink</dc:creator></cp:coreProperties>`;
}

// ── Excel (.xlsx) ────────────────────────────────────────────────────────────

/** 0-based column index → letters (0 → A, 25 → Z, 26 → AA). */
export function colName(i) {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** Excel sheet names: ≤ 31 chars, none of []:*?/\ , unique. */
export function sheetName(name, used = new Set()) {
  const base = String(name || 'Sheet').replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 31) || 'Sheet';
  let out = base;
  for (let i = 2; used.has(out.toLowerCase()); i++) out = `${base.slice(0, 28)} ${i}`;
  used.add(out.toLowerCase());
  return out;
}

// Style indexes into XLSX_STYLES cellXfs.
const XF = { normal: 0, header: 1, bold: 2, wrap: 3 };

const XLSX_STYLES = `${XML_HEAD}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEEF2F0"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

function xCell(ref, c, style) {
  const v = cellText(c);
  if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"${style ? ` s="${style}"` : ''}><v>${v}</v></c>`;
  if (v == null || v === '') return '';
  const s = style || (String(v).length > 60 ? XF.wrap : 0);
  return `<c r="${ref}" t="inlineStr"${s ? ` s="${s}"` : ''}><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`;
}

function sheetXml({ header = [], rows = [], widths = [] }) {
  const all = header.length ? [header, ...rows] : rows;
  const n = Math.max(...all.map((r) => r.length), 1);
  const cols = Array.from({ length: n }, (_, i) => {
    const w = widths[i] ?? Math.min(60, Math.max(8, ...all.map((r) => String(cellText(r[i]) ?? '').length + 2)));
    return `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`;
  }).join('');
  const freeze = header.length
    ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
    : '<sheetViews><sheetView workbookViewId="0"/></sheetViews>';
  const rowXml = all.map((r, ri) => {
    const isHeader = header.length && ri === 0;
    const cells = r.map((c, ci) => xCell(`${colName(ci)}${ri + 1}`, c, isHeader ? XF.header : isBold(c) ? XF.bold : 0)).join('');
    return `<row r="${ri + 1}">${cells}</row>`;
  }).join('');
  return `${XML_HEAD}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `${freeze}<cols>${cols}</cols><sheetData>${rowXml}</sheetData></worksheet>`;
}

/** Sheets → .xlsx bytes. */
export function buildXlsx(sheets, { title = 'GroundLink' } = {}) {
  const used = new Set();
  const named = sheets.map((s) => ({ ...s, name: sheetName(s.name, used) }));
  const n = named.length;
  return makeZip([
    { name: '[Content_Types].xml', data: `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
      named.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
      '</Types>' },
    { name: '_rels/.rels', data: `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
      '</Relationships>' },
    { name: 'docProps/core.xml', data: coreProps(title) },
    { name: 'xl/workbook.xml', data: `${XML_HEAD}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>` +
      named.map((s, i) => `<sheet name="${xmlEsc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
      '</sheets></workbook>' },
    { name: 'xl/_rels/workbook.xml.rels', data: `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      named.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
      `<Relationship Id="rId${n + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
      '</Relationships>' },
    { name: 'xl/styles.xml', data: XLSX_STYLES },
    ...named.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s) })),
  ]);
}
