// POST /api/setup/load — { kind: 'tires'|'wheels', sheets: [{ source, cells: string[][] }], dryRun } (or one sheet as
// { source, cells }). The server cleans the cells
// (same cleaner as the Sheets sync); dryRun returns the preview, otherwise the table is replaced in one transaction.
// Needs ADMIN_PASSWORD (x-admin-password) when that is set.
import { NextResponse } from 'next/server';
import { loadSheets, MAX_SETUP_ROWS, type SheetCells } from '@/lib/setup';
import { passwordOk } from '@/lib/admin-password';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { isDemo } from '@/lib/demo';
import { explainDbError } from '@/lib/db-errors';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: Request) {
  if (!passwordOk(req)) return NextResponse.json({ error: 'password', message: 'Enter the admin password.' }, { status: 401 });
  if (isDemo()) return NextResponse.json({ error: 'Demo mode is on, so there is no database to load into. Set DEMO_MODE=0 (or remove it) once Supabase is connected.' }, { status: 409 });
  const body = await req.json().catch(() => null) as { kind?: string; source?: string; cells?: unknown; sheets?: unknown; dryRun?: boolean } | null;
  const kind = body?.kind === 'tires' || body?.kind === 'wheels' ? body.kind : null;
  const toCells = (v: unknown) => Array.isArray(v) ? (v as unknown[]).filter(Array.isArray).map(r => (r as unknown[]).slice(0, 60).map(c => String(c ?? '').slice(0, 300))) : [];
  const raw = Array.isArray(body?.sheets) ? (body!.sheets as { source?: unknown; cells?: unknown }[]).slice(0, 20) : [{ source: body?.source, cells: body?.cells }];
  const sheets: SheetCells[] = raw.map((sh, i) => ({ source: String(sh?.source || (raw.length > 1 ? `Tab ${i + 1}` : kind === 'tires' ? 'Tires' : 'Wheels')).trim().slice(0, 80), cells: toCells(sh?.cells) }))
    .filter(sh => sh.cells.length);
  if (!kind || !sheets.length) return NextResponse.json({ error: 'kind and cells are required' }, { status: 400 });
  if (sheets.reduce((n, sh) => n + sh.cells.length, 0) > MAX_SETUP_ROWS) return NextResponse.json({ error: `At most ${MAX_SETUP_ROWS} rows in all.` }, { status: 413 });
  try {
    return NextResponse.json(await loadSheets(supabaseAdmin(), kind, sheets, body?.dryRun !== false));
  } catch (e) {
    return NextResponse.json({ error: explainDbError({ message: (e as Error).message }) }, { status: 500 });
  }
}
