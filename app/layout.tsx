import './globals.css';
import type { Metadata, Viewport } from 'next';
import { getTheme, themeStyle, enterpriseInfo } from '@/lib/theme';
import { getUser } from '@/lib/auth';

export async function generateMetadata(): Promise<Metadata> {
  const e = await enterpriseInfo();
  return { title: e?.short_name || e?.name || 'Silambam ERP', description: 'Silambam training school ERP', manifest: '/manifest.webmanifest' };
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
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
