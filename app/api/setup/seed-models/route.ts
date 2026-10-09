// POST /api/setup/seed-models — loads the make/model list from Wheel-Size (~120 lookups, once). ADMIN_PASSWORD if set.
import { NextResponse } from 'next/server';
import { seedModels } from '@/lib/seed-models';
import { passwordOk } from '@/lib/admin-password';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { isDemo } from '@/lib/demo';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(req: Request) {
  if (!passwordOk(req)) return NextResponse.json({ error: 'password', message: 'Enter the admin password.' }, { status: 401 });
  if (isDemo()) return NextResponse.json({ error: 'Demo mode is on: the demo has its own sample vehicles.' }, { status: 409 });
  if (!process.env.WHEELSIZE_API_KEY) return NextResponse.json({ error: 'WHEELSIZE_API_KEY is not set. Add it in Vercel > Settings > Environment Variables and redeploy.' }, { status: 503 });
  try {
    return NextResponse.json(await seedModels(supabaseAdmin()));
  } catch (e) {
    return NextResponse.json({ error: `Loading stopped: ${(e as Error).message}. Models loaded so far are kept; press the button again to finish.` }, { status: 502 });
  }
}
