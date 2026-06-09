import { describe, it, expect } from 'vitest';
import {
  siteEnergyWh,
  solarPanelW,
  droneEnduranceMin,
  operatorEndurance,
  timingsToDuty,
  networkBom,
  DUTY_5_5_90,
} from './power.js';

describe('siteEnergyWh — fixed site RF energy budget', () => {
  it('5 W, 72 h, 30% duty → 108 Wh, 9 Ah @ 12 V, 4.5 Ah @ 24 V', () => {
    const r = siteEnergyWh({ txPowerW: 5 }, 72, 0.3);
    expect(r.energyWh).toBeCloseTo(108, 6);
    expect(r.batteryAh12V).toBeCloseTo(9, 6);
    expect(r.batteryAh24V).toBeCloseTo(4.5, 6);
  });

  it('derives tx power from EIRP when txPowerW is absent (−2.15 dBi)', () => {
    // 35 dBm EIRP − 2.15 dBi = 32.85 dBm ≈ 1.928 W
    const r = siteEnergyWh({ eirpDbm: 35 }, 10, 1);
    expect(r.drawW).toBeCloseTo(1.928, 2);
  });
});

describe('solarPanelW — panel sizing from energy + latitude', () => {
  it('108 Wh, lat 52 (>50 → 3 h sun), eff 0.85 → ~42.4 W → 50 W', () => {
    const r = solarPanelW(108, 52, 0.85);
    expect(r.peakSunHours).toBe(3.0);
    expect(r.panelW).toBeCloseTo(42.35, 1);
    expect(r.panelW_rounded).toBe(50);
  });

  it('uses 5.5 h of sun near the equator and 4.0 h mid-latitude', () => {
    expect(solarPanelW(100, 10).peakSunHours).toBe(5.5);
    expect(solarPanelW(100, 45).peakSunHours).toBe(4.0);
    expect(solarPanelW(100, 50).peakSunHours).toBe(4.0); // boundary inclusive
  });
});

describe('droneEnduranceMin — airborne relay', () => {
  it('370 Wh, 150 W avg, 20% reserve → 118 min; 37 batteries for 72 h', () => {
    const r = droneEnduranceMin(370, 150, 0.2);
    expect(r.enduranceMin).toBe(118);
    expect(r.batteriesNeeded).toBe(37);
  });
});

describe('operatorEndurance — handheld DC current model', () => {
  it('5 W handheld at 5-5-90 → ~15.3 h endurance; 8 h mission = 1 + 1 spare', () => {
    const dev = { txA: 1.6, rxA: 0.35, standbyA: 0.08, battery: { capacityAh: 2.6, voltageV: 7.4 } };
    const r = operatorEndurance(dev, 8, DUTY_5_5_90);
    expect(r.weightedCurrentA).toBeCloseTo(0.1695, 4);
    expect(r.enduranceHours).toBeCloseTo(15.34, 1);
    expect(r.batteries).toBe(1);
    expect(r.spare).toBe(1);
    expect(r.batteriesWithSpare).toBe(2);
    expect(r.rechargeIntervalH).toBeCloseTo(15.34, 1);
  });

  it('scales the battery count up for a long mission', () => {
    const dev = { txA: 1.6, rxA: 0.35, standbyA: 0.08, battery: { capacityAh: 2.6, voltageV: 7.4 } };
    const r = operatorEndurance(dev, 72, DUTY_5_5_90);
    expect(r.batteries).toBe(5); // ceil(72 / 15.34)
    expect(r.batteriesWithSpare).toBe(6);
  });
});

describe('timingsToDuty — schedule → effective duty cycle', () => {
  it('SITREP every 30 min × 2 min TX + 2 h continuous-on over an 8 h mission', () => {
    const d = timingsToDuty({
      missionHours: 8,
      windows: [{ everyMin: 30, txMin: 2 }],
      continuousOnHours: 2,
    });
    // 480 min: 16 SITREPs × 2 = 32 min TX; 120 min RX (continuous); 328 min standby
    expect(d.txMin).toBe(32);
    expect(d.rxMin).toBe(120);
    expect(d.standbyMin).toBe(328);
    expect(d.tx).toBeCloseTo(32 / 480, 6);
    expect(d.rx).toBeCloseTo(120 / 480, 6);
    expect(d.standby).toBeCloseTo(328 / 480, 6);
    expect(d.tx + d.rx + d.standby).toBeCloseTo(1, 9);
  });

  it('feeds a heavier duty cycle into a shorter endurance', () => {
    const dev = { txA: 1.6, rxA: 0.35, standbyA: 0.08, battery: { capacityAh: 2.6, voltageV: 7.4 } };
    const duty = timingsToDuty({ missionHours: 8, windows: [{ everyMin: 30, txMin: 2 }], continuousOnHours: 2 });
    const busy = operatorEndurance(dev, 8, { tx: duty.tx, rx: duty.rx, standby: duty.standby });
    const idle = operatorEndurance(dev, 8, DUTY_5_5_90);
    expect(busy.enduranceHours).toBeLessThan(idle.enduranceHours);
  });
});

describe('networkBom — mission bill of materials', () => {
  it('2 sites + 1 drone + 1 operator + 1 ATAK → ≥ 4 line items', () => {
    const bom = networkBom({
      sites: [{ txPowerW: 5 }, { txPowerW: 5 }],
      operators: [{ label: 'Operator', txA: 1.6, rxA: 0.35, standbyA: 0.08, battery: { capacityAh: 2.6, voltageV: 7.4 } }],
      drone: { batteryWh: 370 },
      ataks: [{ drawMa: 600, deviceMah: 5000 }],
      missionHours: 72,
      lat: 52,
    });
    expect(Array.isArray(bom)).toBe(true);
    expect(bom.length).toBeGreaterThanOrEqual(4);
    for (const line of bom) {
      expect(line).toHaveProperty('item');
      expect(line).toHaveProperty('qty');
      expect(line).toHaveProperty('unitSpec');
      expect(line).toHaveProperty('rationale');
      expect(typeof line.item).toBe('string');
      expect(Number.isFinite(line.qty)).toBe(true);
    }
    // every node class is represented
    const items = bom.map((l) => l.item).join(' | ');
    expect(items).toMatch(/Solar panel/);
    expect(items).toMatch(/Drone/);
    expect(items).toMatch(/batteries/i);
    expect(items).toMatch(/powerbank/i);
  });

  it('returns an empty BOM when no nodes are supplied', () => {
    expect(networkBom({ missionHours: 8 })).toEqual([]);
  });
});
