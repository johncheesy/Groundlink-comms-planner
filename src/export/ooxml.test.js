import { describe, it, expect } from 'vitest';
import { xmlEsc, colName, sheetName, buildDocx, buildXlsx } from './ooxml.js';

const text = (bytes) => new TextDecoder().decode(bytes);

describe('ooxml helpers', () => {
  it('escapes XML and drops control characters', () => {
    expect(xmlEsc('a<b & "c">')).toBe('a&lt;b &amp; &quot;c&quot;&gt;');
    expect(xmlEsc('ok\u0007bell')).toBe('okbell');
    expect(xmlEsc(null)).toBe('');
  });

  it('names spreadsheet columns', () => {
    expect(colName(0)).toBe('A');
    expect(colName(25)).toBe('Z');
    expect(colName(26)).toBe('AA');
    expect(colName(701)).toBe('ZZ');
    expect(colName(702)).toBe('AAA');
  });

  it('makes legal, unique sheet names', () => {
    const used = new Set();
    expect(sheetName('PACE / tiers [v1]', used)).toBe('PACE   tiers  v1');
    expect(sheetName('Sites', used)).toBe('Sites');
    expect(sheetName('sites', used)).toBe('sites 2');
    expect(sheetName('x'.repeat(40), used)).toHaveLength(31);
  });
});

describe('buildDocx', () => {
  it('packs the required parts with headings, tables and coloured cells', () => {
    const zip = text(buildDocx([
      { type: 'title', text: 'Plan' },
      { type: 'h1', text: 'PACE & more' },
      { type: 'table', header: ['Tier', 'Bearer'], rows: [[{ text: 'Primary', fill: '#1d9e75', color: '#fff', bold: true }, 'VHF']] },
    ]));
    for (const part of ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/styles.xml', 'word/_rels/document.xml.rels']) {
      expect(zip).toContain(part);
    }
    expect(zip).toContain('<w:pStyle w:val="Heading1"/>');
    expect(zip).toContain('PACE &amp; more');
    expect(zip).toContain('w:fill="1D9E75"');
    expect(zip).toContain('<w:tblHeader/>');
  });
});

describe('buildXlsx', () => {
  it('writes numbers as numbers, text inline, a frozen header and one part per sheet', () => {
    const zip = text(buildXlsx([
      { name: 'Sites', header: ['#', 'Name', 'Lat'], rows: [[1, 'Mast <A>', 52.12345]] },
      { name: 'Notes', rows: [['free text']] },
    ]));
    expect(zip).toContain('xl/worksheets/sheet1.xml');
    expect(zip).toContain('xl/worksheets/sheet2.xml');
    expect(zip).toContain('<sheet name="Sites" sheetId="1" r:id="rId1"/>');
    expect(zip).toContain('<c r="C2"><v>52.12345</v></c>');
    expect(zip).toContain('<c r="B2" t="inlineStr"><is><t xml:space="preserve">Mast &lt;A&gt;</t></is></c>');
    expect(zip).toContain('state="frozen"');
    expect(zip).toContain('<c r="A1" t="inlineStr" s="1">'); // header style
  });
});
