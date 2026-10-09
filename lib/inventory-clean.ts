// Turns messy spreadsheet rows into clean tire and wheel rows.
// Used by the importer page (bundled into it) and the Google Sheets sync route. No dependencies.

export type Kind = 'tires' | 'wheels';
export type Issue = { field: string; level: 'error' | 'warn'; msg: string };

// ---------------------------------------------------------------- field definitions
export const TIRE_FIELDS = ['size', 'width', 'aspect', 'rim', 'brandModel', 'brand', 'model', 'description', 'season', 'condition', 'tread',
  'loadSpeed', 'loadIndex', 'speedRating', 'xl', 'dot', 'qty', 'price', 'cost', 'status', 'location', 'notes'] as const;
export const WHEEL_FIELDS = ['wheelSpec', 'wheelSize', 'diameter', 'width', 'offset', 'boltPattern', 'centerBore', 'type', 'condition',
  'grade', 'description', 'brand', 'finish', 'lugSeat', 'tpms', 'qty', 'price', 'cost', 'status', 'location', 'notes'] as const;
export type TireField = typeof TIRE_FIELDS[number];
export type WheelField = typeof WHEEL_FIELDS[number];

export const FIELD_LABELS: Record<string, string> = {
  size: 'Tire size', width: 'Width', aspect: 'Aspect ratio', rim: 'Rim size', brand: 'Brand', model: 'Model',
  description: 'Description', season: 'Season', condition: 'New/used', tread: 'Tread', loadSpeed: 'Load + speed',
  loadIndex: 'Load index', speedRating: 'Speed rating', xl: 'XL', dot: 'DOT', qty: 'Qty', price: 'Price',
  location: 'Location', notes: 'Notes', wheelSize: 'Wheel size', diameter: 'Diameter', offset: 'Offset',
  boltPattern: 'Bolt pattern', centerBore: 'Center bore', type: 'Steel/alloy', grade: 'Grade', finish: 'Finish',
  lugSeat: 'Lug seat', tpms: 'TPMS', brandModel: 'Brand + model', cost: 'Cost', status: 'Status',
  wheelSpec: 'Size / bolt pattern / bore', location2: 'Location', location3: 'Location',
};

/** Columns a sheet can't do without. Each group needs at least one of its fields mapped. */
export const REQUIRED_FIELDS: Record<Kind, string[][]> = {
  tires: [['size', 'description', 'width']],
  wheels: [['wheelSize', 'wheelSpec', 'diameter', 'description'], ['boltPattern', 'wheelSpec', 'description']],
};

// Header words that point to each field. Checked against lowercased headers with punctuation removed.
const SYN: Record<string, RegExp> = {
  size: /^(tire\s*)?size$|^tyre\s*size$|^size\b|dimension/,
  width: /^(section\s*)?width$|^w$/, aspect: /^(aspect|profile|ratio|series)/, rim: /^(rim|wheel)(\s*(size|dia(meter)?))?$|^r$/,
  brandModel: /^brand\s*(\/|and)?\s*model$/,
  brand: /^(brand|make|manufacturer|mfr)$/, model: /^(model|pattern|tread\s*(name|pattern)|line)$/,
  description: /^(desc(ription)?|item|product|name|tire|tyre|wheel|rim|brand\s*\/?\s*style|style)$/,
  season: /^(season|type|category|kind)$/, condition: /^(new\s*\/?\s*used|n\s*\/\s*u|condition|cond|new|used)$/,
  status: /^(stock\s*)?status$/,
  tread: /tread|depth|32nds|^mm$/, loadSpeed: /load\s*\/?\s*speed|service|^li\s*\/?\s*sr$/,
  loadIndex: /^(load(\s*index)?|li)$/, speedRating: /^(speed(\s*(rating|index|symbol))?|sr)$/,
  xl: /^(xl|extra\s*load|reinforced|rf)$/, dot: /^(dot|year|age|mfg)/,
  qty: /^(qty|quantity|count|on\s*hand|stock|units|pcs|#)$/, price: /price|sell|retail|each|\bea\b|\$|cost/, cost: /cost|price\s*per\s*unit|unit\s*price/,
  location: /loc|rack|bin|shelf|where|spot|bay|aisle|container|^area$|^zone$/, notes: /note|comment|remark/,
  wheelSpec: /(size|dia).*(bolt|pcd)|(bolt|pcd).*(size|dia)/,
  wheelSize: /^(wheel|rim)\s*size$|^size$/, diameter: /^(dia(meter)?|rim(\s*size)?|inch|in)$/, offset: /^(offset|et)$/,
  boltPattern: /bolt|pcd|lug\s*pattern|pattern/, centerBore: /bore|^cb$|hub/,
  type: /^(type|material|steel\s*\/?\s*alloy|alloy\s*\/?\s*steel)$/, grade: /^(grade|cosmetic|quality)$/,
  finish: /^(finish|colou?r)$/, lugSeat: /seat/, tpms: /tpms|sensor/,
};

/** Guesses which column holds which field. Returns field -> column index. */
export function autoMap(headers: string[], kind: Kind): Record<string, number> {
  const fields: readonly string[] = kind === 'tires' ? TIRE_FIELDS : WHEEL_FIELDS;
  const norm = headers.map(h => String(h ?? '').toLowerCase().replace(/[^a-z0-9$#/\s]/g, ' ').replace(/\s+/g, ' ').trim());
  const map: Record<string, number> = {};
  const used = new Set<number>();
  const take = (f: string, i: number) => { map[f] = i; used.add(i); };
  // A column named exactly after a field wins first, so "Season" beats "Type" for the season and "Condition" beats
  // "Status" for new/used, wherever they sit in the sheet.
  for (const f of fields) {
    const i = norm.findIndex((h, idx) => !used.has(idx) && (EXACT[f] ?? []).includes(h));
    if (i >= 0) take(f, i);
  }
  // Then by header words. Specific fields first, so "Load/Speed" isn't taken by "speed" and "Wheel size" by "wheel".
  const order = [...fields].sort((a, b) => priority(a) - priority(b));
  for (const f of order) {
    const re = SYN[f]; if (!re || map[f] !== undefined || f === 'cost') continue;
    const i = norm.findIndex((h, idx) => !used.has(idx) && h && re.test(h));
    if (i >= 0) take(f, i);
  }
  // "Price" columns: prefer one that says sell/retail over cost
  if (map.price !== undefined && /cost/.test(norm[map.price])) {
    const better = norm.findIndex((h, idx) => !used.has(idx) && /price|sell|retail/.test(h));
    if (better >= 0) { used.delete(map.price); map.price = better; used.add(better); }
  }
  // A purchasing sheet (supplier, PO, invoice) with a plain "Price Per Unit" or "Cost" column: that's what the shop
  // paid, not what it charges. It goes in the notes, never on a quote.
  const buying = norm.some(h => /supplier|vendor|invoice|^po\b|purchase/.test(h));
  if (map.price !== undefined && (buying || /cost/.test(norm[map.price])) && !/sell|retail/.test(norm[map.price])) { map.cost = map.price; delete map.price; }
  // Where a tire sits is often split over columns (container, area, shelf): keep up to three, left to right.
  const locs = norm.map((h, i) => [h, i] as const).filter(([h, i]) => (!used.has(i) || map.location === i) && h && SYN.location.test(h)).map(([, i]) => i);
  locs.slice(0, 3).forEach((i, n) => { map[n ? `location${n + 1}` : 'location'] = i; used.add(i); });
  return map;
}
const EXACT: Record<string, string[]> = {
  season: ['season'], condition: ['condition', 'new/used', 'new used', 'n/u', 'cond'], status: ['status'], brand: ['brand'],
  size: ['size', 'tire size', 'tyre size'], qty: ['qty', 'quantity'], dot: ['dot', 'dot year', 'dot code'], notes: ['notes', 'note'],
  type: ['type'], brandModel: ['brand model', 'brand/model', 'brand and model'], description: ['description', 'brand/style'],
};
const priority = (f: string) => ['wheelSpec', 'brandModel', 'loadSpeed', 'wheelSize', 'boltPattern', 'centerBore', 'size', 'tread', 'dot', 'xl', 'lugSeat', 'tpms']
  .includes(f) ? 0 : ['description'].includes(f) ? 2 : 1;

/** Tires or wheels? Looks at headers first, then at what the cells contain. */
export function detectKind(headers: string[], rows: string[][]): Kind {
  const h = headers.join(' ').toLowerCase();
  let w = /bolt|pcd|offset|\bet\b|bore|steel|alloy|rim\b/.test(h) ? 2 : 0;
  let t = /tread|load|speed|dot|season|tire|tyre/.test(h) ? 2 : 0;
  for (const r of rows.slice(0, 30)) {
    const line = r.join(' ');
    if (parseTireSize(line)) t++;
    if (/\d\s*[x×]\s*\d{3}(\.\d)?\b|\bET\s*-?\d/i.test(line)) w++;
  }
  return w > t ? 'wheels' : 'tires';
}

// ---------------------------------------------------------------- value parsers
const clean = (v: unknown) => String(v ?? '').replace(/ /g, ' ').trim();

export type TireSize = { size: string; width: number; aspect: number; rim: number; isLt: boolean;
  loadIndex?: number; loadIndexDual?: number; speedRating?: string; xl?: boolean };

/** "225/65R17", "225 65 17", "2256517", "P225/65ZR17", "LT245/75R16 120/116S", "225-65-17 102H XL" */
export function parseTireSize(v: unknown): TireSize | null {
  const s = clean(v).toUpperCase();
  const m = s.match(/(?:^|[^\d])(P|LT|ST)?\s*(\d{3})\s*[\/\s\-.,:]?\s*(\d{2})\s*[\/\s\-]?\s*(Z?R|D|B|-|\/|\s)?\s*(\d{2})(?!\d)/);
  if (!m) return null;
  const width = +m[2], aspect = +m[3], rim = +m[5];
  if (width < 125 || width > 395 || width % 5 !== 0 || aspect < 25 || aspect > 85 || aspect % 5 !== 0 || rim < 12 || rim > 26) return null;
  const out: TireSize = { size: `${width}/${aspect}R${rim}`, width, aspect, rim, isLt: m[1] === 'LT' };
  const rest = s.slice((m.index ?? 0) + m[0].length);
  const ls = parseLoadSpeed(rest);
  if (ls.loadIndex) Object.assign(out, ls);
  if (/\bXL\b|EXTRA\s*LOAD|\bRF\b|REINF/.test(rest)) out.xl = true;
  return out;
}

/** "102H", "102 H", "120/116S", "LI 102 SR H" */
export function parseLoadSpeed(v: unknown): { loadIndex?: number; loadIndexDual?: number; speedRating?: string } {
  const s = clean(v).toUpperCase();
  const m = s.match(/\b(\d{2,3})(?:\s*\/\s*(\d{2,3}))?\s*([A-HJ-NP-Z])\b/);
  if (m && +m[1] >= 60 && +m[1] <= 160) return { loadIndex: +m[1], loadIndexDual: m[2] ? +m[2] : undefined, speedRating: m[3] };
  const li = s.match(/\b(\d{2,3})\b/);
  return li && +li[1] >= 60 && +li[1] <= 160 ? { loadIndex: +li[1] } : {};
}

const SEASON_WORDS: [RegExp, 'W' | 'AW' | 'AS' | 'S'][] = [
  [/all[\s-]*weather|\baw\b|4[\s-]*season|four[\s-]*season|cross\s*climate|weatherready|celsius|quatrac|weather\s*pro|wintercontact\s*ts|solus\s*4s|weatherpeak|ultraweather|weatherflex|weathergrip|tracsaver|eurotraxx|g\s*fit\s*4s|securecontact\s*aw|altimax\s*365/i, 'AW'],
  [/winter|snow|ice|\bw\b|blizzak|x-?ice|hakka|observe|winterforce|wintermaxx|arctic|studd|ws\d|i\*?pike|alpin|frost|nordic|iceguard|winter\s*claw|viking|wintrac|i\*?\s*cept|winguard|ultra\s*grip|polar/i, 'W'],
  [/all[\s-]*season|\ba\/?s\b|\bm\+?s\b|touring|defender|assurance|turanza|alenza|latitude|ecsta\s*pa|pure\s*contact|crosscontact|kinergy|primacy|truecontact|extremecontact|cinturato|scorpion|sincera|extensa|procontact|dynapro|kumho\s*ht|\bh\/?t\b/i, 'AS'],
  [/summer|\bs\b|performance|pilot\s*sport\s*[45](?!\s*all)|potenza|p\s*zero(?!.*all)|eagle\s*f1/i, 'S'],
];
export function parseSeason(v: unknown): 'W' | 'AW' | 'AS' | 'S' | null {
  const s = clean(v); if (!s) return null;
  for (const [re, code] of SEASON_WORDS) if (re.test(s)) return code;
  return null;
}

/** "7/32", "7", "7/32\"", "6mm" (converted), "new" -> 0 */
export function parseTread(v: unknown): number | null {
  const s = clean(v).toLowerCase(); if (!s) return null;
  if (/^new$/.test(s)) return 0;
  const mm = s.match(/([\d.]+)\s*mm/); if (mm) return Math.round(+mm[1] / 0.79375);
  const n = s.match(/(\d{1,2})(?:\s*\/\s*32)?/); return n && +n[1] <= 32 ? +n[1] : null;
}

/** DOT date code to year: "2523" (week 25 of 2023), "2023", "23", "DOT 4521" */
export function parseDotYear(v: unknown, now = new Date().getFullYear()): number | null {
  const s = clean(v).replace(/[^\d]/g, ' ').trim(); if (!s) return null;
  const last = s.split(/\s+/).pop()!;
  let y: number | null = null;
  if (/^\d{4}$/.test(last)) {
    const n = +last;
    y = n >= 1990 && n <= now + 1 ? n : 2000 + (n % 100);   // a real year, else WWYY
    if (+last.slice(0, 2) > 53 && !(n >= 1990 && n <= now + 1)) return null;  // not a valid week
  } else if (/^\d{2}$/.test(last)) y = 2000 + +last;
  return y && y >= 1990 && y <= now + 1 ? y : null;
}

/** "4", "4 pcs", "set" = 4, "pair" = 2, "" = 0 */
export function parseQty(v: unknown): { qty: number; ok: boolean } {
  const s = clean(v).toLowerCase();
  if (!s) return { qty: 0, ok: true };
  if (/^(set|set of 4)$/.test(s)) return { qty: 4, ok: true };
  if (/^pair$/.test(s)) return { qty: 2, ok: true };
  if (/^\d{1,4}[\/-]\d{1,2}[\/-]\d{1,4}/.test(s)) return { qty: 0, ok: false };   // a date: Excel turned "1/2" into one
  if (/^\d+\s*\+\s*\d+/.test(s)) return { qty: (s.match(/\d+/g) ?? []).reduce((a, b) => a + +b, 0), ok: true };   // "2 + 2"
  const m = s.match(/-?\d+/); if (!m) return { qty: 0, ok: false };
  const n = +m[0]; return n < 0 || n > 9999 ? { qty: 0, ok: false } : { qty: n, ok: true };
}

/** "$229.00", "229", "229 ea", "$800/set" (per tire = 200) */
export function parsePrice(v: unknown): { price: number | null; perSet: boolean } {
  const s = clean(v).toLowerCase(); if (!s) return { price: null, perSet: false };
  const m = s.replace(/,(?=\d{3}\b)/g, '').match(/\d+(?:\.\d+)?/); if (!m) return { price: null, perSet: false };
  const perSet = /\/\s*set|per\s*set|\bset\b|for\s*4|\/\s*4\b/.test(s);
  const n = +m[0]; return { price: Math.round((perSet ? n / 4 : n) * 100) / 100, perSet };
}

export function parseBool(v: unknown): boolean | null {
  const s = clean(v).toLowerCase(); if (!s) return null;
  if (/^(y|yes|true|1|x|✓|✔|xl|rf|extra load|tpms)$/.test(s)) return true;
  if (/^(n|no|false|0|-)$/.test(s)) return false;
  return null;
}

/** "new", "N", "used", "U", "takeoff" (used, near new). Falls back on tread. */
export function parseCondition(v: unknown, tread: number | null): 'new' | 'used' | null {
  const s = clean(v).toLowerCase();
  if (/^(n|new|brand new|bnew|nos|new old stock)$/.test(s)) return 'new';
  if (/^(u|used|take[\s-]?off|takeoff|tof|pre[\s-]?owned|2nd|second)/.test(s)) return 'used';
  if (tread !== null) return tread > 0 ? 'used' : 'new';
  return null;
}

const BRANDS = ['BFGoodrich', 'Bridgestone', 'Continental', 'Cooper', 'Dunlop', 'Falken', 'Firestone', 'General', 'Gislaved',
  'Goodyear', 'GT Radial', 'Hankook', 'Kelly', 'Kumho', 'Laufenn', 'Maxxis', 'Michelin', 'Motomaster', 'Nexen', 'Nitto', 'Nokian',
  'Pirelli', 'Sailun', 'Sumitomo', 'Toyo', 'Uniroyal', 'Vredestein', 'Westlake', 'Yokohama', 'Mastercraft', 'Federal', 'Achilles',
  'Arctic Claw', 'Hercules', 'Ironman', 'Landsail', 'Lionhart', 'Linglong', 'Triangle', 'Goodride', 'Firemax', 'Delinte',
  'Rotalla', 'Nankang', 'Fierce', 'Ohtsu', 'Fuzion', 'Kenda', 'Mazzini', 'Zeetex', 'Minerva', 'Petlas', 'Bearway'];
const BRAND_RE = new RegExp(`\\b(${BRANDS.map(b => b.replace(/ /g, '\\s*')).join('|')})\\b`, 'i');
export function findBrand(v: unknown): string | null {
  const m = clean(v).match(BRAND_RE); if (!m) return null;
  return BRANDS.find(b => b.toLowerCase().replace(/\s/g, '') === m[1].toLowerCase().replace(/\s/g, '')) ?? m[1];
}

// ---- wheels
/** "17x7", "17 x 7.5", "7Jx17", "7.5J x 18", "17\"" (diameter only) */
export function parseWheelSize(v: unknown): { diameter: number; width: number | null } | null {
  const s = clean(v).toUpperCase().replace(/["”″]/g, '');
  let m = s.match(/([\d.]+)\s*J\s*[X×]\s*(\d{2}(?:\.\d)?)/);
  if (m) return ok(+m[2], +m[1]);
  m = s.match(/(\d{2}(?:\.\d)?)\s*[X×]\s*([\d.]+)(?!\s*[\d.]*\s*mm)/);
  if (m && !/^\d{1,2}$/.test(m[2]) || (m && +m[2] <= 14)) {
    // avoid reading a bolt pattern "5x114.3" as a size: diameter must be 12-26 and width 3-14
    if (m && +m[1] >= 12 && +m[1] <= 26 && +m[2] >= 3 && +m[2] <= 14) return ok(+m[1], +m[2]);
  }
  m = s.match(/^\s*(\d{2}(?:\.\d)?)\s*(IN|INCH)?\s*$/);
  if (m && +m[1] >= 12 && +m[1] <= 26) return ok(+m[1], null);
  return null;
  function ok(d: number, w: number | null) { return d >= 12 && d <= 26 && (w === null || (w >= 3 && w <= 14)) ? { diameter: d, width: w } : null; }
}

/** "ET45", "+45", "45mm", "-12", "offset 40" */
export function parseOffset(v: unknown): number | null {
  const s = clean(v).toUpperCase();
  const m = s.match(/ET\s*(-?\+?\d{1,3})|^\s*([+-]?\d{1,3})\s*(MM)?\s*$/);
  if (!m) return null;
  const n = parseInt((m[1] ?? m[2]).replace('+', ''), 10);
  return n >= -80 && n <= 80 ? n : null;
}

const INCH_PCD: Record<string, number> = { '4': 101.6, '4.25': 108, '4.5': 114.3, '4.75': 120.7, '5': 127, '5.5': 139.7, '6.5': 165.1, '8': 203.2 };
/** "5x114.3", "5-114.3", "5/114.3", "5x4.5" (inches), "5x100/5x114.3" (dual-drilled) -> ["5x114.3", ...] */
export function parseBoltPatterns(v: unknown): string[] {
  const s = clean(v).toLowerCase();
  const out: string[] = [];
  for (const m of s.matchAll(/(\d{1,2})\s*(?:x|×|-|\/|\*|on)\s*(\d{1,3}(?:\.\d{1,2})?)/g)) {
    const lugs = +m[1]; let pcd = +m[2];
    if (lugs < 3 || lugs > 10) continue;
    if (pcd < 10) { const mm = INCH_PCD[String(pcd)]; if (!mm) continue; pcd = mm; }   // inches
    if (pcd < 90 || pcd > 210) continue;
    const p = `${lugs}x${Number.isInteger(pcd) ? pcd : pcd.toFixed(1).replace(/\.0$/, '')}`;
    if (!out.includes(p)) out.push(p);
  }
  return out;
}

export function parseCenterBore(v: unknown): number | null {
  const m = clean(v).match(/(\d{2,3}(?:\.\d{1,2})?)/);
  if (!m) return null;
  const n = +m[1]; return n >= 40 && n <= 180 ? Math.round(n * 10) / 10 : null;
}

export function parseWheelType(v: unknown): 'alloy' | 'steel' | null {
  const s = clean(v).toLowerCase();
  if (/steel|stl\b|black\s*steel|stamped/.test(s)) return 'steel';
  if (/alloy|alum|aluminum|aluminium|mag\b|forged|cast|chrome|oem\s*rim|5[\s-]*spoke|split[\s-]*spoke|mesh/.test(s)) return 'alloy';
  return null;
}
export function parseGrade(v: unknown): 'A' | 'B' | 'C' | null {
  const m = clean(v).toUpperCase().match(/^(?:GRADE\s*)?([ABC])\b/); return m ? (m[1] as 'A' | 'B' | 'C') : null;
}
export function parseLugSeat(v: unknown): 'conical' | 'ball' | 'flat' | null {
  const s = clean(v).toLowerCase();
  if (/con|60|taper|acorn/.test(s)) return 'conical';
  if (/ball|radius|round/.test(s)) return 'ball';
  if (/flat|mag|shank/.test(s)) return 'flat';
  return null;
}

/** Rows that aren't stock any more. Left out quietly (they show as skipped, with the reason). */
export const GONE_STATUS = /^(sold|scrapped|returned|waiting\s*(to|for)\s*return|marked\s*for\s*return|can'?t\s*find|missing|lost|abandoned|written\s*off)\b/i;

// Brands as people type them, and models typed without their brand.
const BRAND_ALIAS: [RegExp, string, string?][] = [
  [/^bf\s*goodrich\b/i, 'BFGoodrich'], [/^good\s*year\b/i, 'Goodyear'], [/^michell?in\b/i, 'Michelin'], [/^pir+ell?[il]i?9?\b|^pireli\b/i, 'Pirelli'],
  [/^gt\s*radial\b/i, 'GT Radial'], [/^i-?link\b/i, 'iLink'], [/^iron\s*man\b/i, 'Ironman'], [/^general(\s+tire)?\b/i, 'General'],
  [/^yok?l?oh[oa]ma\b/i, 'Yokohama'], [/^laufenn?\b/i, 'Laufenn'], [/^moto\s*master\b/i, 'MotoMaster'], [/^ver?ed?stein\b/i, 'Vredestein'],
  [/^trac?k?max\b/i, 'Tracmax'], [/^west\s*lake\b/i, 'Westlake'], [/^(hitech\s+)?double\s*st(ar)?\b|^doublest\b/i, 'Doublestar'],
  [/^v-?i?tour\b/i, 'Vitour'], [/^nexen\b/i, 'Nexen'], [/^mazz?ini\b/i, 'Mazzini'], [/^continental\b/i, 'Continental'],
  [/^dueler\b/i, 'Bridgestone', 'Dueler'], [/^fire\s*hawk\b/i, 'Firestone', 'Firehawk'], [/^n'?fera\b|^nefra\b/i, 'Nexen', "N'Fera"],
  [/^solus\b/i, 'Kumho', 'Solus'], [/^prxes\b|^proxes\b/i, 'Toyo', 'Proxes'], [/^sottozero\b/i, 'Pirelli', 'Sottozero'],
  [/^sincera\b/i, 'Falken', 'Sincera'], [/^privilo\b/i, 'Tracmax', 'Privilo'], [/^tiger\s*paw\b/i, 'Uniroyal', 'Tiger Paw'],
];
const NOT_A_BRAND = /^(n\/?a|none|unknown|chinese|staggered|generic|-+|\?+)$/i;
const tidy = (s: string) => (s.length > 3 && (s === s.toLowerCase() || (s === s.toUpperCase() && !/\d/.test(s))) ? s.toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase()) : s);
/** "Bridgestone Blizzak Icepeak" -> Bridgestone / Blizzak Icepeak. "Pireli pZero" -> Pirelli / Pzero. Unknown brands: first word. */
export function splitBrandModel(text: string): { brand: string | null; model: string | null } {
  const s = clean(text).replace(/\*?run\s*-?flat\*?|\(all weather\)/ig, '').replace(/\s+/g, ' ').trim();
  if (!s || NOT_A_BRAND.test(s)) return { brand: null, model: null };
  for (const [re, brand, model] of BRAND_ALIAS) {
    const m = s.match(re);
    if (m) { const rest = tidy(s.slice(m[0].length).trim()); return { brand, model: [model, rest].filter(Boolean).join(' ') || null }; }
  }
  const known = findBrand(s);
  if (known && s.toLowerCase().replace(/\s/g, '').startsWith(known.toLowerCase().replace(/\s/g, ''))) {
    const rest = s.replace(new RegExp(`^${known.replace(/\s/g, '\\s*')}`, 'i'), '').trim();
    return { brand: known, model: rest ? tidy(rest) : null };
  }
  const [first, ...rest] = s.split(' ');
  return { brand: tidy(first), model: rest.length ? tidy(rest.join(' ')) : null };
}

/** One cell holding the whole wheel: "18/5x112/66.6", "16/4x107x68 cb", "18/5x108/114.3/72.62" (dual drilled),
 *  "17/5/120x67", "18x9 8x180 124.2", "18/7x5/112x62" (18x7, 5x112). */
export function parseWheelSpec(v: unknown): { diameter: number; width: number | null; bolts: string[]; cb: number | null } | null {
  const s = clean(v).toLowerCase().replace(/cb|mm|mlt/g, ' ').replace(/["”″]/g, '/').replace(/([+-])\s+(\d)/g, '$1$2').trim()
    .replace(/\s*\/\s*|\s+/g, '/')
    .replace(/\/(?:et[+-]?\d{1,2}|[+-]\d{1,2})$/, '')
    .replace(/^(\d{2})\/(\d)\/(\d{3})/, '$1/$2x$3')
    .replace(/^(\d{2})\/(\d{1,2}(?:\.\d)?)x(\d)\/(\d{3})/, '$1x$2/$3x$4')
    .replace(/\/+$/, '');
  const m = s.match(/^(\d{2}(?:\.\d)?)(?:x(\d{1,2}(?:\.\d)?))?[\/x](\d{1,2})x(\d{2,3}(?:\.\d+)?)(.*)$/);
  if (!m) return null;
  const diameter = +m[1], width = m[2] && +m[2] >= 3 && +m[2] <= 14 ? +m[2] : null, lugs = +m[3];
  if (diameter < 12 || diameter > 26) return null;
  const r1 = (x: number) => Math.round(x * 10) / 10;
  const bolts = parseBoltPatterns(`${lugs}x${m[4]}`);
  if (!bolts.length) return null;
  const nums = [...m[5].replace(/^x/, '/').matchAll(/\d+(?:\.\d+)?/g)].map(x => +x[0]);
  let cb: number | null = null;
  nums.forEach((x, i) => {
    if (i < nums.length - 1 && x >= 98 && x <= 140) { const alt = parseBoltPatterns(`${lugs}x${x}`)[0]; if (alt && !bolts.includes(alt)) bolts.push(alt); }
    else if (i === nums.length - 1 && x >= 40 && x <= 180) cb = r1(x);
  });
  return { diameter, width, bolts, cb };
}

/** Hints from the tab name: a "Used Tires" tab is used stock, "Steel rims" are steel, and so on. */
export type TabHint = { condition?: 'new' | 'used'; wheelType?: 'alloy' | 'steel' };
export function tabHint(name: string): TabHint {
  const s = name.toLowerCase();
  return {
    condition: /\bused\b|single|take[\s-]?off/.test(s) ? 'used' : /\bnew\b/.test(s) ? 'new' : undefined,
    wheelType: /steel/.test(s) ? 'steel' : /alloy/.test(s) ? 'alloy' : undefined,
  };
}

// ---------------------------------------------------------------- row cleaning
export type TireRow = { tire_size: string; section_width: number; aspect_ratio: number; rim_diameter: number; is_lt: boolean;
  brand: string | null; model: string | null; season: string | null; condition: 'new' | 'used'; tread_32nds: number | null;
  load_index: number | null; load_index_dual: number | null; speed_rating: string | null; is_xl: boolean; dot_year: number | null;
  qty: number; price: number | null; location: string | null; notes: string | null };
export type WheelRow = { wheel_type: 'alloy' | 'steel'; condition: 'new' | 'used'; grade: string | null; diameter: number;
  width: number | null; bolt_pattern: string; bolt_pattern_alt: string | null; center_bore: number | null; wheel_offset: number | null;
  description: string | null; finish: string | null; lug_seat: string | null; has_tpms: boolean | null; qty: number;
  price: number | null; location: string | null; notes: string | null };
export type Cleaned<T> = { sourceRow: number; raw: Record<string, string>; row: T | null; issues: Issue[]; skipped?: boolean };

const get = (cells: string[], map: Record<string, number>, f: string) => (map[f] !== undefined ? clean(cells[map[f]]) : '');
const nz = (s: string) => s || null;
const isBlank = (cells: string[]) => cells.every(c => !clean(c));

export function cleanTire(cells: string[], map: Record<string, number>, sourceRow: number, headers: string[], hint: TabHint = {}): Cleaned<TireRow> {
  const raw = Object.fromEntries(headers.map((h, i) => [h || `col${i + 1}`, clean(cells[i])]).filter(([, v]) => v));
  const issues: Issue[] = [];
  if (isBlank(cells)) return { sourceRow, raw, row: null, issues, skipped: true };
  const g = (f: string) => get(cells, map, f);
  const status = g('status');
  if (GONE_STATUS.test(status)) return { sourceRow, raw, row: null, issues: [{ field: 'status', level: 'warn', msg: `${status}: left out` }], skipped: true };
  const desc = g('description');
  const bm = g('brandModel') ? splitBrandModel(g('brandModel')) : null;
  let sizeCell = g('size');
  // Brand and size typed in each other's column
  if (!parseTireSize(sizeCell) && bm && parseTireSize(g('brandModel'))) sizeCell = g('brandModel');
  const allText = [sizeCell, g('brand'), g('model'), g('brandModel'), desc].join(' ');

  // size: own column, else width/aspect/rim columns, else anywhere in the description
  let ts = parseTireSize(sizeCell);
  if (!ts && g('width') && g('aspect') && g('rim')) ts = parseTireSize(`${g('width')}/${g('aspect')}R${g('rim').replace(/\D/g, '')}`);
  if (!ts && desc) { ts = parseTireSize(desc); if (ts) issues.push({ field: 'size', level: 'warn', msg: `Size read from description` }); }
  if (!ts) {
    // a header row repeated mid-sheet, a section title, or a total line: skip quietly
    const looksLikeLabel = !/\d{3}/.test(allText) && !g('qty') && !g('price');
    if (looksLikeLabel) return { sourceRow, raw, row: null, issues, skipped: true };
    return { sourceRow, raw, row: null, issues: [{ field: 'size', level: 'error', msg: `Can't read a tire size from "${g('size') || desc || allText.trim()}"` }] };
  }

  const ls = { ...pick(ts), ...parseLoadSpeed(g('loadSpeed')) };
  const li = g('loadIndex') ? parseLoadSpeed(g('loadIndex')).loadIndex : undefined;
  const sr = g('speedRating').toUpperCase().match(/^[A-Z]$/)?.[0];
  const loadIndex = li ?? ls.loadIndex ?? null, speedRating = sr ?? ls.speedRating ?? null;
  if (loadIndex === null) issues.push({ field: 'loadIndex', level: 'warn', msg: 'No load index. The counter can\'t check it against OE.' });

  const tread = parseTread(g('tread'));
  let condition = parseCondition(g('condition'), tread) ?? hint.condition ?? null;
  if (!condition) { condition = 'new'; if (g('condition')) issues.push({ field: 'condition', level: 'warn', msg: `"${g('condition')}" read as new` }); }
  if (condition === 'used' && tread === null) issues.push({ field: 'tread', level: 'warn', msg: 'Used tire with no tread depth' });
  if (condition === 'used' && tread !== null && tread <= 4) issues.push({ field: 'tread', level: 'warn', msg: `${tread}/32" is at or below the 4/32" winter minimum` });

  const named = g('brand') ? splitBrandModel(`${g('brand')} ${g('model')}`) : null;
  let brand = named ? named.brand : bm ? bm.brand : findBrand(allText);
  let model = named ? named.model : bm ? bm.model : null;
  if (!model && desc) {
    // "Michelin X-Ice Snow SUV 225/65R17 102T" -> "X-Ice Snow SUV"
    model = desc.replace(BRAND_RE, '').replace(/(P|LT)?\s*\d{3}\s*[\/\s-]?\s*\d{2}\s*[\/\s-]?\s*Z?R?\s*\d{2}.*$/i, '').replace(/\s{2,}/g, ' ').trim() || null;
  }
  let season = parseSeason(g('season'));
  if (!season) { season = parseSeason(`${model ?? ''} ${desc}`) ?? parseSeason(g('notes')); if (season && g('season')) issues.push({ field: 'season', level: 'warn', msg: `"${g('season')}" not understood; guessed from the model` }); }
  if (!season && /\bwinter\b/i.test([g('location'), g('location2'), g('location3')].join(' '))) season = 'W';   // kept on the winter rack
  if (!season) issues.push({ field: 'season', level: 'warn', msg: 'Season unknown' });

  const q = parseQty(g('qty'));
  if (!q.ok) issues.push({ field: 'qty', level: 'error', msg: `Qty "${g('qty')}" isn't a number` });
  const p = parsePrice(g('price'));
  if (p.perSet) issues.push({ field: 'price', level: 'warn', msg: `"${g('price')}" read as a set price: ${p.price} per tire` });
  if (p.price === null && q.qty > 0) issues.push({ field: 'price', level: 'warn', msg: 'No price' });

  const dotYear = parseDotYear(g('dot'));
  if (g('dot') && dotYear === null) issues.push({ field: 'dot', level: 'warn', msg: `DOT "${g('dot')}" not understood` });
  if (dotYear !== null && new Date().getFullYear() - dotYear >= 6) issues.push({ field: 'dot', level: 'warn', msg: `Tire is ${new Date().getFullYear() - dotYear} years old` });

  const xl = parseBool(g('xl')) ?? ts.xl ?? /\bXL\b|extra\s*load|\bRF\b|reinforced/i.test(`${g('loadSpeed')} ${g('loadIndex')} ${desc} ${g('model')}`);
  const notes = extraNotes(g, status);
  return {
    sourceRow, raw, issues: q.ok ? issues : issues,
    row: q.ok ? {
      tire_size: ts.size, section_width: ts.width, aspect_ratio: ts.aspect, rim_diameter: ts.rim, is_lt: ts.isLt,
      brand, model, season, condition, tread_32nds: condition === 'new' ? 0 : tread,
      load_index: loadIndex, load_index_dual: ls.loadIndexDual ?? null, speed_rating: speedRating, is_xl: xl,
      dot_year: dotYear, qty: q.qty, price: p.price, location: place(g), notes,
    } : null,
  };
}
/** Location over up to three columns ("NYK3", "Left", "Left Front"), repeats dropped. */
function place(g: (f: string) => string): string | null {
  const out: string[] = [];
  for (const v of [g('location'), g('location2'), g('location3')]) if (v && !out.some(o => o.toLowerCase() === v.toLowerCase())) out.push(v);
  return out.join(' · ') || null;
}
/** Notes, plus a status worth knowing ("Reserved") and the cost when the sheet has one. */
function extraNotes(g: (f: string) => string, status: string): string | null {
  const c = parsePrice(g('cost')).price;
  const parts = [g('notes'), status && !/^(available|in\s*stock|ok)$/i.test(status) ? status : '', c ? `Cost $${c.toFixed(2)}` : ''].filter(Boolean);
  return parts.join('; ') || null;
}
const pick = (t: TireSize) => ({ loadIndex: t.loadIndex, loadIndexDual: t.loadIndexDual, speedRating: t.speedRating });

export function cleanWheel(cells: string[], map: Record<string, number>, sourceRow: number, headers: string[], hint: TabHint = {}): Cleaned<WheelRow> {
  const raw = Object.fromEntries(headers.map((h, i) => [h || `col${i + 1}`, clean(cells[i])]).filter(([, v]) => v));
  const issues: Issue[] = [];
  if (isBlank(cells)) return { sourceRow, raw, row: null, issues, skipped: true };
  const g = (f: string) => get(cells, map, f);
  const status = g('status');
  if (GONE_STATUS.test(status)) return { sourceRow, raw, row: null, issues: [{ field: 'status', level: 'warn', msg: `${status}: left out` }], skipped: true };
  const spec = g('wheelSpec') ? parseWheelSpec(g('wheelSpec')) : null;
  const desc = g('description');
  const allText = [g('wheelSize'), g('diameter'), g('width'), g('offset'), g('boltPattern'), g('type'), desc, g('brand')].join(' ');

  let sz = spec ? { diameter: spec.diameter, width: spec.width } : parseWheelSize(g('wheelSize'));
  if (!sz && g('diameter')) {
    const d = parseFloat(g('diameter').replace(/[^\d.]/g, '')); const w = parseFloat(g('width').replace(/[^\d.]/g, ''));
    if (d >= 12 && d <= 26) sz = { diameter: d, width: w >= 3 && w <= 14 ? w : null };
  }
  if (!sz) { sz = parseWheelSize(allText.replace(/\d{1,2}\s*[x×-]\s*\d{3}(\.\d)?/g, ' ')); if (sz) issues.push({ field: 'wheelSize', level: 'warn', msg: 'Size read from description' }); }

  const bolts = spec ? spec.bolts : parseBoltPatterns(g('boltPattern') || allText.replace(/\d{2}\s*[x×]\s*\d{1,2}(\.\d)?(?!\d)/g, ' '));
  if (!sz && !bolts.length) {
    const looksLikeLabel = !g('qty') && !g('price') && !/\d/.test(allText);
    if (looksLikeLabel) return { sourceRow, raw, row: null, issues, skipped: true };
  }
  if (!sz && g('wheelSpec') && !spec) { issues.push({ field: 'wheelSpec', level: 'error', msg: `Can't read "${g('wheelSpec')}" as size / bolt pattern / bore` }); return { sourceRow, raw, row: null, issues }; }
  if (!sz) issues.push({ field: 'wheelSize', level: 'error', msg: `Can't read a wheel diameter from "${g('wheelSize') || g('diameter') || desc}"` });
  if (!bolts.length) issues.push({ field: 'boltPattern', level: 'error', msg: `Can't read a bolt pattern from "${g('boltPattern') || desc}"` });
  if (sz && sz.width === null) issues.push({ field: 'width', level: 'warn', msg: 'No rim width' });

  const offset = parseOffset(g('offset')) ?? parseOffset((allText.match(/ET\s*-?\+?\d{1,3}/i) || [''])[0]);
  if (offset === null) issues.push({ field: 'offset', level: 'warn', msg: 'No offset. Fit check will be rougher.' });
  const cb = spec ? spec.cb : parseCenterBore(g('centerBore'));
  if (cb === null) issues.push({ field: 'centerBore', level: 'warn', msg: 'No center bore. Measure it, the counter needs it to rule out bad fits.' });

  let type = parseWheelType(g('type')) ?? parseWheelType(desc) ?? hint.wheelType ?? null;
  if (!type) { type = 'alloy'; issues.push({ field: 'type', level: 'warn', msg: 'Steel or alloy unknown; set to alloy' }); }
  const grade = parseGrade(g('grade'));
  let condition = parseCondition(g('condition'), null) ?? (/\bnew\b/i.test(`${g('type')} ${g('notes')}`) ? 'new' : null) ?? hint.condition ?? null;
  if (!condition) condition = grade ? 'used' : /oem|used|take[\s-]?off/i.test(desc) ? 'used' : 'new';

  const q = parseQty(g('qty'));
  if (!q.ok) issues.push({ field: 'qty', level: 'error', msg: `Qty "${g('qty')}" isn't a number` });
  const p = parsePrice(g('price'));
  if (p.perSet) issues.push({ field: 'price', level: 'warn', msg: `"${g('price')}" read as a set price: ${p.price} per wheel` });

  const fatal = !sz || !bolts.length || !q.ok;
  return {
    sourceRow, raw, issues,
    row: fatal ? null : {
      wheel_type: type, condition, grade, diameter: sz!.diameter, width: sz!.width,
      bolt_pattern: bolts[0], bolt_pattern_alt: bolts[1] ?? null, center_bore: cb, wheel_offset: offset,
      description: nz(desc) ?? nz([g('brand'), g('model')].filter(Boolean).join(' ')), finish: nz(g('finish')),
      lug_seat: parseLugSeat(g('lugSeat')), has_tpms: parseBool(g('tpms')), qty: q.qty, price: p.price,
      location: place(g), notes: extraNotes(g, status),
    },
  };
}

export function cleanAll(kind: Kind, headers: string[], rows: string[][], map: Record<string, number>, hint: TabHint = {}) {
  const fn = kind === 'tires' ? cleanTire : cleanWheel;
  // Wheels: when the type column marks the new ones ("New Alloy Rim") and nothing gives a condition, the rest are used.
  if (kind === 'wheels' && map.type !== undefined && map.condition === undefined && !hint.condition
    && rows.some(r => /\bnew\b/i.test(clean(r[map.type])))) hint = { ...hint, condition: 'used' };
  // sheet rows are 1-based and the header is row 1
  return rows.map((cells, i) => (fn as typeof cleanTire)(cells, map, i + 2, headers, hint) as Cleaned<TireRow | WheelRow>);
}

// ---------------------------------------------------------------- SQL output
const lit = (v: unknown): string => {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'null';
  return `'${String(v).replace(/'/g, "''")}'`;
};

/** One transaction: remove the old rows from this source, insert the new ones. Safe to run again. */
export function toSql(kind: Kind, source: string, cleaned: Cleaned<TireRow | WheelRow>[], opts: { includeRaw?: boolean } = {}): string {
  const good = cleaned.filter(c => c.row);
  const table = kind;
  const cols = kind === 'tires'
    ? ['tire_size', 'section_width', 'aspect_ratio', 'rim_diameter', 'is_lt', 'brand', 'model', 'season', 'condition', 'tread_32nds',
       'load_index', 'load_index_dual', 'speed_rating', 'is_xl', 'dot_year', 'qty', 'price', 'location', 'notes']
    : ['wheel_type', 'condition', 'grade', 'diameter', 'width', 'bolt_pattern', 'bolt_pattern_alt', 'center_bore', 'wheel_offset',
       'description', 'finish', 'lug_seat', 'has_tpms', 'qty', 'price', 'location', 'notes'];
  const all = [...cols, 'source', 'source_row', ...(opts.includeRaw !== false ? ['raw'] : [])];
  const lines = good.map(c => {
    const r = c.row as Record<string, unknown>;
    const vals = [...cols.map(k => lit(r[k])), lit(source), lit(c.sourceRow)];
    if (opts.includeRaw !== false) vals.push(`${lit(JSON.stringify(c.raw))}::jsonb`);
    return `  (${vals.join(', ')})`;
  });
  const qty = good.reduce((n, c) => n + ((c.row as { qty: number }).qty || 0), 0);
  return [
    `-- ${good.length} ${kind} rows (${qty} on hand) from "${source}", generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
    `-- Replaces every row previously imported from this source. Paste into the Supabase SQL editor and run.`,
    'begin;',
    `delete from ${table} where source = ${lit(source)};`,
    lines.length ? `insert into ${table} (${all.join(', ')}) values\n${lines.join(',\n')};` : '-- nothing to insert',
    'commit;',
    '',
  ].join('\n');
}

// ---------------------------------------------------------------- input parsing
/** Parses pasted Google Sheets cells (tab-separated) or CSV text into rows. Handles quotes and newlines in cells. */
export function parseDelimited(text: string): string[][] {
  const t = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '');
  // Look at several lines: sheets often start with a title row that has no separators at all.
  const head = t.split('\n').slice(0, 15).join('\n');
  const count = (re: RegExp) => head.match(re)?.length ?? 0;
  const delim = count(/\t/g) > 0 ? '\t' : count(/;/g) > count(/,/g) ? ';' : ',';
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let q = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) {
      if (ch === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"' && cell === '') q = true;
    else if (ch === delim) { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  row.push(cell); rows.push(row);
  return rows;
}

/** Finds the header row: the first of the top 10 rows with the most text-like cells that match known headers. */
export function findHeaderRow(rows: string[][]): number {
  let best = 0, bestScore = -1;
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const score = rows[i].reduce((n, c) => {
      const h = clean(c).toLowerCase();
      return n + (h && Object.values(SYN).some(re => re.test(h.replace(/[^a-z0-9$#/\s]/g, ' ').trim())) ? 2 : 0) - (parseTireSize(h) ? 3 : 0);
    }, 0);
    if (score > bestScore) { best = i; bestScore = score; }
  }
  return best;
}
