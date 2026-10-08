// GET /api/vehicles?q=18 outback
// Resolves counter shorthand to make/model slugs from the local vehicle_models table. Costs zero API hits.
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { findModels } from '@/lib/vehicle-lookup';

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get('q') ?? '';
  try {
    return NextResponse.json(await findModels(supabaseAdmin(), q));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
