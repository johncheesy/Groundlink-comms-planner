#!/usr/bin/env node
/**
 * M9 data-prep — build a compact, keyless cell-tower snapshot for the app.
 *
 * OpenCelliD (https://opencellid.org, CC BY-SA 4.0) is the open successor to the
 * Mozilla Location Service. Its bulk export is gated behind a FREE API key — we
 * use that key HERE, at data-prep time only, and NEVER commit it or ship it in
 * the bundle. The output is a small filtered JSON the app fetches client-side.
 *
 * ── Usage ───────────────────────────────────────────────────────────────────
 *   OPENCELLID_KEY=xxxx node scripts/fetch-opencellid.mjs \
 *       --region nl --mcc 204 \
 *       --bbox 3.2,50.7,7.3,53.6     # west,south,east,north
 *
 *   Flags:
 *     --region <name>   output file public/cells/<name>.json (default: nl)
 *     --mcc <code>      mobile country code to filter (NL = 204)
 *     --bbox w,s,e,n    bounding box (decimal degrees)
 *     --max <n>         cap the number of towers written (default 4000)
 *
 * The key is read from the OPENCELLID_KEY environment variable. If it is unset
 * the script prints instructions and exits without writing — it never invents
 * data and never commits a key.
 *
 * ── Regenerating / adding a region ──────────────────────────────────────────
 *   1. Get a free key at https://opencellid.org/ (Register → API access).
 *   2. Export OPENCELLID_KEY in your LOCAL shell (do not add it to the repo).
 *   3. Run the command above with the region's MCC + bbox.
 *   4. Commit only the resulting public/cells/<region>.json (public data,
 *      OPSEC-fine) — attribute OpenCelliD (CC BY-SA 4.0) in the app, which the
 *      controller already does from the file's `attribution` field.
 *
 * OpenCelliD CSV columns (for reference):
 *   radio,mcc,net,area,cell,unit,lon,lat,range,samples,changeable,created,updated,averageSignal
 * We keep only: { lat, lon, radio, mcc, net, range, samples }.
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');

function parseArgs(argv) {
  const out = { region: 'nl', mcc: null, bbox: null, max: 4000 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--region') out.region = argv[++i];
    else if (a === '--mcc') out.mcc = Number(argv[++i]);
    else if (a === '--bbox') out.bbox = argv[++i].split(',').map(Number);
    else if (a === '--max') out.max = Number(argv[++i]);
  }
  return out;
}

const RADIO_SET = new Set(['GSM', 'UMTS', 'LTE', 'NR']);

async function main() {
  const args = parseArgs(process.argv);
  const key = process.env.OPENCELLID_KEY;

  if (!key) {
    console.error(
      [
        'OPENCELLID_KEY is not set.',
        '',
        'This script never embeds or commits a key. To regenerate a snapshot:',
        '  1. Get a free key at https://opencellid.org/',
        '  2. export OPENCELLID_KEY=xxxx   (local shell only)',
        '  3. node scripts/fetch-opencellid.mjs --region nl --mcc 204 --bbox 3.2,50.7,7.3,53.6',
        '',
        'No file was written.',
      ].join('\n'),
    );
    process.exit(1);
  }

  if (!args.bbox || args.bbox.length !== 4 || args.bbox.some(Number.isNaN)) {
    console.error('Provide --bbox west,south,east,north (decimal degrees).');
    process.exit(1);
  }

  const [west, south, east, north] = args.bbox;

  // OpenCelliD bbox cell export. The endpoint returns CSV.
  const url =
    `https://opencellid.org/cell/getInArea?key=${encodeURIComponent(key)}` +
    `&BBOX=${south},${west},${north},${east}&format=csv` +
    (args.mcc ? `&mcc=${args.mcc}` : '');

  console.error(`Fetching towers for bbox ${args.bbox.join(',')}${args.mcc ? ` (MCC ${args.mcc})` : ''} …`);
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`OpenCelliD request failed: ${res.status} ${res.statusText}`);
    process.exit(1);
  }
  const csv = await res.text();

  const lines = csv.trim().split(/\r?\n/);
  const header = lines.shift()?.split(',') ?? [];
  const idx = (name) => header.indexOf(name);
  const iRadio = idx('radio');
  const iMcc = idx('mcc');
  const iNet = idx('net');
  const iLon = idx('lon');
  const iLat = idx('lat');
  const iRange = idx('range');
  const iSamples = idx('samples');

  const cells = [];
  for (const line of lines) {
    const f = line.split(',');
    const radio = f[iRadio];
    if (!RADIO_SET.has(radio)) continue;
    const lat = Number(f[iLat]);
    const lon = Number(f[iLon]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    cells.push({
      lat: round(lat, 5),
      lon: round(lon, 5),
      radio,
      mcc: Number(f[iMcc]) || null,
      net: Number(f[iNet]) || null,
      range: Number(f[iRange]) || null,
      samples: Number(f[iSamples]) || null,
    });
    if (cells.length >= args.max) break;
  }

  const snapshot = {
    region: args.region.toUpperCase(),
    generated: new Date().toISOString(),
    attribution: 'Cell data © OpenCelliD contributors (CC BY-SA 4.0)',
    bbox: { west, south, east, north },
    cells,
  };

  const outPath = resolve(REPO, 'public', 'cells', `${args.region}.json`);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(snapshot));
  console.error(`Wrote ${cells.length} towers → ${outPath}`);
}

function round(n, d) {
  const p = 10 ** d;
  return Math.round(n * p) / p;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
