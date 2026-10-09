// Turns the raw Supabase error you get before the migrations have run into steps a person can follow.
export const MISSING_TABLES_HELP =
  'Supabase is connected, but the counter tables aren\'t there yet. Open /setup on this site: it copies the setup SQL ' +
  'for you to run in Supabase. To show the demo instead, set DEMO_MODE=1 in Vercel and redeploy.';

/** PostgREST says "Could not find the table 'public.x' in the schema cache" (PGRST205); Postgres says 42P01. */
export function isMissingTable(e: { code?: string; message?: string } | null | undefined) {
  return !!e && (e.code === 'PGRST205' || e.code === '42P01' || /schema cache|does not exist/i.test(e.message ?? ''));
}

export function explainDbError(e: { code?: string; message?: string }) {
  return isMissingTable(e) ? MISSING_TABLES_HELP : e.message ?? 'Database error';
}
