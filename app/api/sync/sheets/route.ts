// POST /api/sync/sheets[?force=1] — reads the inventory tabs from Google Sheets and replaces tires and wheels.
//   Needs "Authorization: Bearer <CRON_SECRET>". Called every 5 minutes by Supabase pg_cron (supabase/cron-sync.sql).
//   Skips the database when the sheet hasn't changed. force=1 also skips the big-drop guard.
// GET  /api/sync/sheets — latest sync per tab kind, for the counter's "synced 3 min ago" line.
// The "Sync now" button on /sync calls the same code directly, without the secret.
import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { syncSheetsFromEnv, syncStatus } from '@/lib/inventory-sync-store';
import { SheetsError } from '@/lib/google-sheets';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const authorized = (req: Request) => {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const got = Buffer.from(req.headers.get('authorization') ?? ''), want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
};

export async function POST(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const force = new URL(req.url).searchParams.get('force') === '1';
  try {
    const report = await syncSheetsFromEnv('cron', force);
    const bad = report.kinds.some(k => k.status === 'blocked' || k.status === 'error');
    return NextResponse.json(report, { status: bad ? 422 : 200 });
  } catch (e) {
    const status = e instanceof SheetsError ? e.status : 500;
    return NextResponse.json({ error: (e as Error).message }, { status: status >= 400 ? status : 500 });
  }
}

export async function GET() {
  try {
    return NextResponse.json(await syncStatus());
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
