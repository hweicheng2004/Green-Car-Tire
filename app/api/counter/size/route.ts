// GET /api/counter/size?size=225/65R17 — vehicles that came on this size, for the size search's "OE on" list.
import { NextResponse } from 'next/server';
import { isDemo, demoOeOn } from '@/lib/demo';
import { liveOeOn } from '@/lib/counter-live';
import { supabaseAdmin } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const size = (new URL(req.url).searchParams.get('size') ?? '').toUpperCase().replace(/\s/g, '');
  if (!/^\d{3}\/\d{2}R\d{2}$/.test(size)) return NextResponse.json({ error: 'size like 225/65R17 is required' }, { status: 400 });
  try {
    const vehicles = isDemo() ? demoOeOn(size) : await liveOeOn(supabaseAdmin(), size);
    return NextResponse.json({ size, vehicles }, { headers: { 'cache-control': 'public, s-maxage=300, stale-while-revalidate=3600' } });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
