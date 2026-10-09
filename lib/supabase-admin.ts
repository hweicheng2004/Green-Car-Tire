// Server-only Supabase client using the service role key (bypasses RLS). Never import from client code.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// One client per server instance: warm serverless invocations reuse it instead of rebuilding it per request.
let client: SupabaseClient | null = null;
export const supabaseAdmin = (): SupabaseClient => {
  if (client) return client;
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.');
  return (client = createClient(url, key, { auth: { persistSession: false } }));
};
