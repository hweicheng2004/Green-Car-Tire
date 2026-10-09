// Reads an uploaded CSV/TSV or Excel file in the browser into sheets of cell text. Shared by /import and /setup.
// SheetJS loads from the CDN only when someone picks an Excel file.
import { parseDelimited } from '@/lib/inventory-clean';

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
