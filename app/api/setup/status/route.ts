// GET /api/setup/status — what first-time setup still needs (tables, stock, keys). No secrets in the answer.
import { NextResponse } from 'next/server';
import { setupStatus } from '@/lib/setup';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { isDemo } from '@/lib/demo';

export const dynamic = 'force-dynamic';

export async function GET() {
  const db = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY ? supabaseAdmin() : null;
  try {
    return NextResponse.json({ demo: isDemo(), ...(await setupStatus(db)) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
