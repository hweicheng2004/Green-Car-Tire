// GET /api/counter/inventory — everything the counter screen loads once: tires, wheels, fees, status line.
import { NextResponse } from 'next/server';
import { isDemo, demoInventory } from '@/lib/demo';
import { liveInventory } from '@/lib/counter-live';
import { supabaseAdmin } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json(isDemo() ? demoInventory() : await liveInventory(supabaseAdmin()));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
