// Reads an uploaded CSV/TSV or Excel file in the browser into sheets of cell text. Shared by /import and /setup.
// SheetJS loads from the CDN only when someone picks an Excel file.
import { parseDelimited, findHeaderRow, autoMap, detectKind, REQUIRED_FIELDS, FIELD_LABELS, type Kind } from '@/lib/inventory-clean';

export type Sheet = { name: string; rows: string[][] };

let xlsxLib: Promise<any> | null = null;
const loadXlsx = () => (xlsxLib ??= new Promise((resolve, reject) => {
  const s = document.createElement('script');
  s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
  s.onload = () => resolve((window as any).XLSX);
  s.onerror = () => { xlsxLib = null; reject(new Error('Could not load the Excel reader. Check the connection, or save as CSV.')); };
  document.head.appendChild(s);
}));

/** Excel: one Sheet per non-empty tab. CSV/TSV/text: one Sheet named after the file. */
export async function readSheetFile(f: File): Promise<Sheet[]> {
  const base = f.name.replace(/\.[^.]+$/, '');
  if (/\.(xlsx|xls|ods)$/i.test(f.name)) {
    const XLSX = await loadXlsx();
    const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
    return wb.SheetNames.map((n: string) => ({
      name: n, rows: (XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: false, defval: '' }) as unknown[][]).map(r => r.map(c => String(c ?? ''))),
    })).filter((s: Sheet) => s.rows.some(r => r.some(c => c.trim())));
  }
  return [{ name: base, rows: parseDelimited(await f.text()) }];
}

/** Which tabs of a workbook hold this kind of stock. Picks tabs named like it ("Used Tires", "Alloy RIMS") with the
 *  columns it needs, and leaves out reports, logs and queues, and tabs that only repeat another one's rows
 *  ("Winter packages" listing tires already on "Used Tires"). Everything stays tickable by hand. */
export type TabPick = { i: number; name: string; rows: number; on: boolean; why: string };
export function suggestTabs(sheets: Sheet[], kind: Kind): TabPick[] {
  const want = kind === 'tires' ? /tire|tyre|single/i : /wheel|rim/i;
  const notStock = /package|log\b|queue|control|rule|credit|economic|engine|benchmark|intelligence|bridge|^qb\b|report|summary|dashboard|access|issue/i;
  const ids = (s: Sheet, h: number) => new Set(s.rows.slice(h + 1).map(r => clean(r[0])).filter(v => v && !/^~+$/.test(v)));
  const out: TabPick[] = [];
  const taken: Set<string>[] = [];
  for (const [i, s] of sheets.entries()) {
    const h = findHeaderRow(s.rows), headers = s.rows[h] ?? [], body = s.rows.slice(h + 1);
    const rows = body.filter(r => r.some(c => clean(c))).length;
    const map = autoMap(headers, kind);
    const missing = REQUIRED_FIELDS[kind].filter(g => !g.some(f => map[f] !== undefined)).map(g => FIELD_LABELS[g[0]]);
    let on = false, why = '';
    if (missing.length) why = `no ${missing.join(' or ').toLowerCase()} column`;
    else if (detectKind(headers, body) !== kind) why = `looks like ${kind === 'tires' ? 'wheels' : 'tires'}`;
    else if (notStock.test(s.name)) why = 'not a stock list';
    else if (!want.test(s.name) && sheets.length > 1) why = `name doesn't say ${kind}`;
    else {
      const mine = ids(s, h), copyOf = taken.findIndex(t => mine.size > 0 && [...mine].filter(x => t.has(x)).length / mine.size >= 0.8);
      if (copyOf >= 0) why = `repeats rows from ${out.filter(o => o.on)[copyOf].name}`;
      else { on = true; taken.push(mine); }
    }
    out.push({ i, name: s.name, rows, on, why });
  }
  return out;
}
const clean = (v: unknown) => String(v ?? '').trim();
