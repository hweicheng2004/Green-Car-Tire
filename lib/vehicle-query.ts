// Parses counter shorthand like "18 outback", "2019 honda civic", "f150 17" into a year and search text.

export type VehicleQuery = { year: number | null; text: string; makeHint: string | null };

const thisYear = () => new Date().getFullYear();

export function parseVehicleQuery(q: string): VehicleQuery | null {
  let t = q.toLowerCase().trim().replace(/\s+/g, ' ');
  if (!t) return null;
  let year: number | null = null, m: RegExpMatchArray | null;
  if ((m = t.match(/^(\d{4}|\d{2})\s+(.+)$/))) { year = +m[1]; t = m[2]; }
  else if ((m = t.match(/^(.+?)\s+(\d{4}|\d{2})$/))) { year = +m[2]; t = m[1]; }
  if (year !== null && year < 100) year = year <= (thisYear() % 100) + 1 ? 2000 + year : 1900 + year;
  if (year !== null && (year < 1950 || year > thisYear() + 2)) return null;
  const words = t.split(' ');
  // first word may be a make ("honda civic"); the route checks it against the makes table
  return { year, text: words.join(' '), makeHint: words.length > 1 ? words[0] : null };
}

export const compact = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** "18" -> 2018, "99" -> 1999, "2018" -> 2018. null if it isn't a plausible model year. */
export function parseYear(v: string | number | null | undefined): number | null {
  const t = String(v ?? '').trim();
  if (!/^\d{2}$|^\d{4}$/.test(t)) return null;
  let y = Number(t);
  if (y < 100) y = y <= (thisYear() % 100) + 1 ? 2000 + y : 1900 + y;
  return y >= 1950 && y <= thisYear() + 2 ? y : null;
}
