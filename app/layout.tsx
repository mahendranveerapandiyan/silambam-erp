import './globals.css';
import type { Metadata, Viewport } from 'next';
import { getTheme, themeStyle, enterpriseInfo } from '@/lib/theme';
import { getUser } from '@/lib/auth';
import { Suspense } from 'react';
import { LovSearch } from '@/components/LovSearch';
import { ActionPopups } from '@/components/ActionPopups';

export async function generateMetadata(): Promise<Metadata> {
  const e = await enterpriseInfo();
  return { title: e?.short_name ? `${e.short_name} · caMpus dAy` : 'caMpus dAy', description: 'caMpus dAy – school management', manifest: '/manifest.webmanifest' };
}
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#7a1f1f' };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const u = await getUser();
  const theme = await getTheme(u?.enterpriseId);
  return (
    <html lang="en">
      <head>
        <style dangerouslySetInnerHTML={{ __html: themeStyle(theme) }} />
      </head>
      <body className="min-h-screen antialiased">{children}<LovSearch /><Suspense fallback={null}><ActionPopups /></Suspense></body>
    </html>
  );
}
