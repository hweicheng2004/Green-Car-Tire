// POST /api/import/claude — the /import page sends the rows the rule-based cleaner couldn't read; Claude returns
// structured rows, the server checks them against the database rules. Body: { kind, headers, rows: [{ sourceRow, cells }] }.
// Needs ANTHROPIC_API_KEY. If ADMIN_PASSWORD is set, the request must carry it (x-admin-password), so a public URL
// can't run up the Anthropic bill.
import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { cleanWithClaude, MAX_ROWS } from '@/lib/claude-import';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const passwordOk = (req: Request) => {
  const want = process.env.ADMIN_PASSWORD;
  if (!want) return true;
  const got = Buffer.from(req.headers.get('x-admin-password') ?? ''), exp = Buffer.from(want);
  return got.length === exp.length && timingSafeEqual(got, exp);
};

export async function POST(req: Request) {
  if (!passwordOk(req)) return NextResponse.json({ error: 'password', message: 'Enter the admin password.' }, { status: 401 });
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY is not set. Add it in Vercel > Settings > Environment Variables and redeploy.' }, { status: 503 });
  }
  const body = await req.json().catch(() => null) as { kind?: string; headers?: unknown; rows?: unknown } | null;
  const kind = body?.kind === 'wheels' ? 'wheels' : body?.kind === 'tires' ? 'tires' : null;
  const headers = Array.isArray(body?.headers) ? (body!.headers as unknown[]).map(h => String(h ?? '').slice(0, 80)).slice(0, 60) : null;
  const rows = Array.isArray(body?.rows) ? (body!.rows as { sourceRow?: unknown; cells?: unknown }[])
    .filter(r => Number.isInteger(r?.sourceRow) && Array.isArray(r?.cells))
    .map(r => ({ sourceRow: r.sourceRow as number, cells: (r.cells as unknown[]).slice(0, 60).map(c => String(c ?? '').slice(0, 300)) })) : null;
  if (!kind || !headers || !rows?.length) return NextResponse.json({ error: 'kind, headers and rows are required' }, { status: 400 });
  if (rows.length > MAX_ROWS) return NextResponse.json({ error: `At most ${MAX_ROWS} rows at a time.` }, { status: 413 });
  try {
    return NextResponse.json(await cleanWithClaude(kind, headers, rows));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
