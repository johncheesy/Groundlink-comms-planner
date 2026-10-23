/**
 * Validate the in-browser P.1812 engine (src/coverage/p1812.js) against the
 * ITU-R P.1812 validation set — the test profiles and reference results that
 * ITU-R Working Party 3M publishes with the reference implementation
 * (https://www.itu.int/en/ITU-R/study-groups/rsg3/Pages/iono-tropo-spheric.aspx,
 * mirrored in github.com/eeveetza/Py1812 → tests/).
 *
 * The validation files are NOT part of this repository. Download them once,
 * keep them outside the repo, and point the script at the folder holding
 * `validation_profiles/` and `validation_results/`:
 *
 *   node scripts/validate-p1812.mjs /path/to/Py1812/tests
 *
 * For every test case it runs our engine with the reference's own inputs
 * (frequency, time %, antenna heights, polarisation, ΔN, N0, path-centre
 * latitude, sea fraction, profile heights + clutter heights; pL = 50 %,
 * σL = 0) and compares each stage the reference logs: free space (Lbfs),
 * free space + multipath (Lb0p), median and p % diffraction (Ld50, Ldp),
 * troposcatter (Lbs) and the final basic transmission loss (Lb).
 *
 * Output: `public/validation/p1812.json` with deviations only (ours minus
 * reference, dB) plus non-identifying case descriptors (distance, frequency,
 * time %, path type, clutter yes/no, sea fraction). No coordinates, terrain
 * heights or profile points are written.
 */

import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { p1812Loss } from '../src/coverage/p1812.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dir = process.argv[2];
if (!dir) {
  console.error('usage: node scripts/validate-p1812.mjs <folder with validation_profiles/ and validation_results/>');
  process.exit(1);
}
const OUT = resolve(root, process.argv[3] ?? 'public/validation/p1812.json');

/** Profile points from a "Fryderyk" csv: { d (km), h (m), R (m), zone }. */
function readProfile(text) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => l.startsWith('{Begin of Profile}'));
  const end = lines.findIndex((l) => l.startsWith('{End of Profile}'));
  const pts = [];
  for (const line of lines.slice(start + 1, end)) {
    if (/^Number of Points/i.test(line)) continue;
    const [d, h, , R, zone] = line.split(',');
    if (d === '' || Number.isNaN(Number(d))) continue;
    pts.push({ d: Number(d), h: Number(h), R: Number(R) || 0, zone: Number(zone) || 4 });
  }
  return pts;
}

/** Log csv ("name,ref,,value,") → map of the first value per name. */
function readLog(text) {
  const out = new Map();
  for (const line of text.split(/\r?\n/)) {
    const cells = line.split(',');
    const key = cells[0]?.trim();
    const v = Number(cells[3]);
    if (key && !key.startsWith('#') && Number.isFinite(v) && !out.has(key)) out.set(key, v);
  }
  return out;
}

const round = (x, n = 2) => (Number.isFinite(x) ? Math.round(x * 10 ** n) / 10 ** n : null);

const profDir = resolve(dir, 'validation_profiles');
const resDir = resolve(dir, 'validation_results');
const cases = [];
for (const file of readdirSync(profDir).filter((f) => f.endsWith('.csv')).sort()) {
  const name = file.replace(/\.csv$/, '');
  const pts = readProfile(readFileSync(resolve(profDir, file), 'utf8'));
  const logs = readdirSync(resDir).filter((f) => f.startsWith(`${name}_`) && /^\d+_log\.csv$/.test(f.slice(name.length + 1))).sort();
  for (const logFile of logs) {
    const L = readLog(readFileSync(resolve(resDir, logFile), 'utf8'));
    const get = (k) => L.get(k);
    const fGHz = get('f (GHz)');
    const p = get('p (%)');
    const pol = get('pol') === 2 ? 'v' : 'h';
    const run = (profile) => p1812Loss({
      freqMHz: fGHz * 1000,
      p,
      pL: 50,
      sigmaL: 0,
      txHeightM: get('htg (m)'),
      rxHeightM: get('hrg (m)'),
      profile,
      polarisation: pol,
      latDeg: get('phi (deg)'),
      N0: get('N0'),
      deltaN: get('DN'),
      seaFrac: get('w'),
      dtmKm: get('dtm (km)'),
      dlmKm: get('dlm (km)'),
    });
    const profile = pts.map((q) => ({ distM: q.d * 1000, terrainM: q.h, clutterM: q.R }));
    const res = run(profile);
    // Same path without our terminal clutter loss (P.1812-6 §4.7, which -8
    // dropped): clutter at the two end points only, not along the path.
    const bare = run(profile.map((q, i) => (i === 0 || i === profile.length - 1 ? { ...q, clutterM: 0 } : q)));
    const c = res.components;
    const ours = {
      Lbfs: c.fsplDb,
      Lb0p: c.fsplDb + c.multipathDb,
      Ld50: c.diffraction50Db,
      Ldp: c.diffractionDb,
      Lbs: c.troposcatterDb,
      Lb: res.lossDb,
    };
    const ref = {
      Lbfs: get('Lbfs'),
      Lb0p: get('Lb0p'),
      Ld50: get('Ld50 (dB)'),
      Ldp: get('Ldp (dB)'),
      Lbs: get('Lbs (dB)'),
      Lb: get('Lb (dB)'),
    };
    const dev = Object.fromEntries(Object.keys(ref).map((k) => [k, round(ours[k] - ref[k], 3)]));
    cases.push({
      id: `${name}#${logFile.slice(name.length + 1, -8)}`,
      profile: name,
      dKm: round(get('d (km)'), 1),
      fMHz: round(fGHz * 1000, 1),
      p,
      pol,
      seaFrac: round(get('w'), 2),
      clutter: pts.some((q) => q.R > 0),
      terminalClutter: pts[0].R > 0 || pts[pts.length - 1].R > 0,
      // Line of sight in the reference geometry: horizon angle θ below 0.
      los: get('th (mrad)') < 0,
      // Ducting / layer reflection (omitted here) beats diffraction in the reference.
      ductingMatters: get('Lba (dB)') < get('Lbd (dB)'),
      dev,
      // Lb deviation once our terminal clutter loss is left out.
      devLbNoTerminalClutter: round(bare.lossDb - ref.Lb, 3),
      ourClutterDb: round(c.clutterTxDb + c.clutterRxDb),
      devTheta: round(c.thetaMrad - get('th (mrad)'), 3),
      devBeta0: round(c.beta0 - get('b0 (%)'), 3),
    });
  }
}

const mean = (xs) => xs.reduce((s, v) => s + v, 0) / (xs.length || 1);
const pick = (k) => (x) => (k === 'LbNoTerminalClutter' ? x.devLbNoTerminalClutter : x.dev[k]);
const summary = Object.fromEntries(['Lbfs', 'Lb0p', 'Ld50', 'Ldp', 'Lbs', 'Lb', 'LbNoTerminalClutter'].map((k) => {
  const v = cases.map(pick(k)).filter(Number.isFinite);
  return [k, {
    mean: round(mean(v)),
    rms: round(Math.sqrt(mean(v.map((x) => x * x)))),
    maxAbs: round(Math.max(...v.map(Math.abs)), 3),
    within01: v.filter((x) => Math.abs(x) <= 0.1).length,
  }];
}));

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify({
  generated: new Date().toISOString().slice(0, 10),
  engine: 'GroundLink P.1812 (src/coverage/p1812.js): P.1812-6 core, path geometry per P.1812-8, no ducting, -6 terminal clutter loss',
  reference: 'ITU-R P.1812-8 validation set, ITU-R WP 3M (reference implementation logs)',
  settings: { pL: 50, sigmaL: 0 },
  count: cases.length,
  summary,
  cases,
}, null, 1)}\n`);

console.log(`${cases.length} cases → ${OUT}`);
console.table(summary);
