import { describe, it, expect } from 'vitest';
import {
  parseCoordinate,
  formatCoordinate,
  latLngToUtm,
  utmToLatLng,
  utmBand,
} from './coords.js';

// A loose closeness check — planning-grade, and grid forms round to whole metres
// or cell centres, so a couple of decimal places of agreement is the bar.
const near = (a, b, tol = 1e-4) => Math.abs(a - b) <= tol;

describe('decimal lat/long', () => {
  it('parses comma and space separated pairs', () => {
    expect(parseCoordinate('52.3676, 4.9041')).toMatchObject({ fmt: 'latlng' });
    const a = parseCoordinate('52.3676 4.9041');
    expect(a.lat).toBeCloseTo(52.3676, 4);
    expect(a.lng).toBeCloseTo(4.9041, 4);
  });

  it('handles negatives and hemisphere suffixes', () => {
    expect(parseCoordinate('-1.95 30.06')).toMatchObject({ lat: -1.95, lng: 30.06 });
    const s = parseCoordinate('33.9249S 18.4241E'); // Cape Town
    expect(s.lat).toBeCloseTo(-33.9249, 4);
    expect(s.lng).toBeCloseTo(18.4241, 4);
  });

  it('rejects out-of-range values', () => {
    expect(parseCoordinate('200, 4')).toBeNull();
    expect(parseCoordinate('hello world')).toBeNull();
    expect(parseCoordinate('')).toBeNull();
  });
});

describe('DMS', () => {
  it('parses the °\'" form', () => {
    const r = parseCoordinate(`52°22'03"N 4°54'15"E`);
    expect(r.fmt).toBe('dms');
    expect(r.lat).toBeCloseTo(52.3675, 3);
    expect(r.lng).toBeCloseTo(4.9041, 3);
  });

  it('parses the space-separated form', () => {
    const r = parseCoordinate('52 22 03 N 4 54 15 E');
    expect(r.fmt).toBe('dms');
    expect(r.lat).toBeCloseTo(52.3675, 3);
  });

  it('handles southern / western hemispheres and reordered axes', () => {
    const r = parseCoordinate(`33°55'30"S 18°25'27"E`);
    expect(r.lat).toBeCloseTo(-33.925, 2);
    expect(r.lng).toBeCloseTo(18.4242, 2);
  });
});

describe('MGRS', () => {
  it('parses with and without spaces', () => {
    const spaced = parseCoordinate('31UFU 91733 09227');
    const tight = parseCoordinate('31UFU9173309227');
    expect(spaced.fmt).toBe('mgrs');
    expect(near(spaced.lat, tight.lat, 1e-6)).toBe(true);
    // Lands in the Netherlands (Amsterdam / Arnhem area).
    expect(spaced.lat).toBeGreaterThan(51.5);
    expect(spaced.lat).toBeLessThan(53);
    expect(spaced.lng).toBeGreaterThan(4);
    expect(spaced.lng).toBeLessThan(7);
  });

  it('parses lower precision (2–4 digit) cells', () => {
    expect(parseCoordinate('31U FU 917 092')).toMatchObject({ fmt: 'mgrs' });
    expect(parseCoordinate('31UFU9109')).toMatchObject({ fmt: 'mgrs' });
  });

  it('rejects odd-length digit runs', () => {
    expect(parseCoordinate('31UFU 9173 0922 7')).toBeNull();
  });
});

describe('UTM', () => {
  it('parses zone + band + easting + northing', () => {
    const r = parseCoordinate('31U 629133 5803437');
    expect(r.fmt).toBe('utm');
    expect(r.lat).toBeCloseTo(52.36, 1);
    expect(r.lng).toBeCloseTo(4.90, 1);
  });

  it('uses the band letter for the hemisphere (southern)', () => {
    // 34H — H is a southern band — near Cape Town.
    const r = parseCoordinate('34H 261877 6243185');
    expect(r.lat).toBeLessThan(0);
  });
});

describe('UTM conversion round-trips', () => {
  const samples = [
    { lat: 52.3676, lng: 4.9041 }, // Amsterdam
    { lat: -33.9249, lng: 18.4241 }, // Cape Town (south)
    { lat: -1.2921, lng: 36.8219 }, // Nairobi (near equator, south)
    { lat: 64.135, lng: -21.895 }, // Reykjavik (high north, west)
  ];

  for (const p of samples) {
    it(`round-trips ${p.lat},${p.lng}`, () => {
      const u = latLngToUtm(p.lat, p.lng);
      const back = utmToLatLng(u.zone, u.easting, u.northing, p.lat >= 0);
      expect(near(back.lat, p.lat, 1e-6)).toBe(true);
      expect(near(back.lng, p.lng, 1e-6)).toBe(true);
    });
  }

  it('assigns correct hemisphere bands', () => {
    expect(utmBand(52.37)).toBe('U');
    expect(utmBand(-33.92)).toBe('H');
    expect(latLngToUtm(-33.92, 18.42).hemisphere).toBe('S');
  });
});

describe('parse → format round-trips', () => {
  it('formats decimal, dms, mgrs and utm back to a parseable string', () => {
    const p = { lat: 52.3676, lng: 4.9041 };
    for (const fmt of ['latlng', 'dms', 'mgrs', 'utm']) {
      const text = formatCoordinate(p, fmt);
      const reparsed = parseCoordinate(text);
      expect(reparsed, `${fmt} → "${text}"`).not.toBeNull();
      expect(near(reparsed.lat, p.lat, 2e-3)).toBe(true);
      expect(near(reparsed.lng, p.lng, 2e-3)).toBe(true);
    }
  });

  it('round-trips a southern-hemisphere point through every format', () => {
    const p = { lat: -33.9249, lng: 18.4241 };
    for (const fmt of ['latlng', 'dms', 'mgrs', 'utm']) {
      const reparsed = parseCoordinate(formatCoordinate(p, fmt));
      expect(reparsed, fmt).not.toBeNull();
      expect(near(reparsed.lat, p.lat, 2e-3)).toBe(true);
      expect(near(reparsed.lng, p.lng, 2e-3)).toBe(true);
    }
  });

  // Regression: band letters that look like hemisphere flags. Band S is
  // 32–40°N — Athens used to come back as −52° because "S" was parsed as
  // the southern hemisphere.
  const bandCases = [
    { name: 'band S (Athens, 37.97N)', lat: 37.9715, lng: 23.7257 },
    { name: 'band N (near-equator north, ~2N)', lat: 2.0, lng: 10.0 },
    { name: 'band M (near-equator south, ~-5)', lat: -5.0, lng: 10.0 },
  ];

  for (const c of bandCases) {
    it(`round-trips UTM ${c.name}`, () => {
      const text = formatCoordinate({ lat: c.lat, lng: c.lng }, 'utm');
      const reparsed = parseCoordinate(text);
      expect(reparsed, `utm → "${text}"`).not.toBeNull();
      expect(near(reparsed.lat, c.lat, 2e-3)).toBe(true);
      expect(near(reparsed.lng, c.lng, 2e-3)).toBe(true);
    });
  }
});

describe('parseCoordinate — pasted forms (review F11)', () => {
  const near = (r, lat, lng) => {
    expect(r).not.toBeNull();
    expect(r.lat).toBeCloseTo(lat, 4);
    expect(r.lng).toBeCloseTo(lng, 4);
  };

  it('reads a decimal comma with space, semicolon or ", " between', () => {
    near(parseCoordinate('52,3676 4,9041'), 52.3676, 4.9041);
    near(parseCoordinate('52,3676; 4,9041'), 52.3676, 4.9041);
    near(parseCoordinate('52,3676, 4,9041'), 52.3676, 4.9041);
    near(parseCoordinate('-1,2921 36,8219'), -1.2921, 36.8219);
  });

  it('keeps "52,5" as a lat,lng pair', () => {
    near(parseCoordinate('52,5'), 52, 5);
    near(parseCoordinate('52.1,4.3'), 52.1, 4.3);
  });

  it('reads hemisphere prefixes', () => {
    near(parseCoordinate('N52.5 E4.5'), 52.5, 4.5);
    near(parseCoordinate('S 1.3, E 36.8'), -1.3, 36.8);
    near(parseCoordinate('N 40.7, W 74.0'), 40.7, -74);
  });

  it('strips brackets, leading plus, semicolons and unicode minus', () => {
    near(parseCoordinate('(52.37, 4.90)'), 52.37, 4.9);
    near(parseCoordinate('[−1.29, 36.82]'), -1.29, 36.82);
    near(parseCoordinate('+52.37 +4.90'), 52.37, 4.9);
    near(parseCoordinate('52.37;4.90'), 52.37, 4.9);
    near(parseCoordinate('−33.86 151.21'), -33.86, 151.21);
  });

  it('reads geo: URIs', () => {
    near(parseCoordinate('geo:52.37,4.90'), 52.37, 4.9);
    near(parseCoordinate('geo:-1.29,36.82,1700;u=35'), -1.29, 36.82);
  });

  it('reads map links', () => {
    near(parseCoordinate('https://www.google.com/maps/@52.3676,4.9041,14z'), 52.3676, 4.9041);
    near(parseCoordinate('https://www.google.com/maps/place/Dam/@52.37,4.89,17z/data=!3m1!4b1!4m6!3m5!3d52.3731!4d4.8926'), 52.3731, 4.8926);
    near(parseCoordinate('https://maps.google.com/?q=-1.2921,36.8219'), -1.2921, 36.8219);
    near(parseCoordinate('https://www.openstreetmap.org/#map=15/52.3700/4.8900'), 52.37, 4.89);
    near(parseCoordinate('https://www.openstreetmap.org/?mlat=52.37&mlon=4.89#map=15/52.37/4.89'), 52.37, 4.89);
    near(parseCoordinate('https://maps.apple.com/?ll=52.37,4.89&q=Pin'), 52.37, 4.89);
  });

  it('still rejects junk and out-of-range values', () => {
    expect(parseCoordinate('https://example.com/nothing')).toBeNull();
    expect(parseCoordinate('https://www.google.com/maps/@52.3,4.9,14z Mast')).toBeNull(); // bulk add splits the name off
    expect(parseCoordinate('52,5,4,5')).toBeNull();
    expect(parseCoordinate('N95 E4')).toBeNull();
  });
});
