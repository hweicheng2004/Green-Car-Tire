// GET /api/counter/catalog — every make and its models, for the make/model suggestions. Changes about once a year
// (scripts/seed-models.ts), so it's cached at the edge for a day.
import { NextResponse } from 'next/server';
import { isDemo, demoCatalog } from '@/lib/demo';
import { modelCatalog } from '@/lib/vehicle-lookup';
import { supabaseAdmin } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const makes = isDemo() ? demoCatalog() : await modelCatalog(supabaseAdmin());
    return NextResponse.json({ makes }, { headers: { 'cache-control': 'public, s-maxage=86400, stale-while-revalidate=604800' } });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
