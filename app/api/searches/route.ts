// POST /api/searches  — the dashboard calls this once per settled search (see lib/log-search-client.ts).
// GET  /api/searches?limit=50 — recent searches, newest first.
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { toRow } from '@/lib/search-log';

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = toRow(body);
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const { data, error } = await supabaseAdmin().from('counter_searches').insert(parsed.row).select('id, outcome').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}

export async function GET(req: Request) {
  const limit = Math.min(Math.max(Number(new URL(req.url).searchParams.get('limit')) || 50, 1), 500);
  const { data, error } = await supabaseAdmin().from('counter_searches')
    .select('*').order('searched_at', { ascending: false }).limit(limit);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
