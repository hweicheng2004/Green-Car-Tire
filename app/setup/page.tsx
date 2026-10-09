import type { Metadata } from 'next';
import SetupWizard from '@/components/setup/SetupWizard';
import { setupStatus } from '@/lib/setup';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { isDemo } from '@/lib/demo';

export const metadata: Metadata = { title: 'Inventory Setup' };
export const dynamic = 'force-dynamic';

export default async function SetupPage() {
  const db = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY ? supabaseAdmin() : null;
  const status = await setupStatus(db).catch(e => ({ supabase: !!db, missingTables: [], error: (e as Error).message,
    tires: 0, wheels: 0, models: 0, googleSheet: false, wheelSize: false, anthropic: false, password: false }));
  return <SetupWizard initial={{ demo: isDemo(), ...status }} />;
}
