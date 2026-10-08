// Server-only Supabase client using the service role key (bypasses RLS). Never import from client code.
import { createClient } from '@supabase/supabase-js';

export const supabaseAdmin = () => {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.');
  return createClient(url, key, { auth: { persistSession: false } });
};
