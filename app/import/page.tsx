import type { Metadata } from 'next';
import ImportDashboard from '@/components/import/ImportDashboard';

export const metadata: Metadata = { title: 'Inventory Import' };
export const dynamic = 'force-dynamic';

export default function ImportPage() {
  return <ImportDashboard claudeReady={!!process.env.ANTHROPIC_API_KEY} needsPassword={!!process.env.ADMIN_PASSWORD} />;
}
