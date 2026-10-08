import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Green Car Tires counter' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif', background: '#f6f7f5', color: '#1b1f1c' }}>{children}</body>
    </html>
  );
}
