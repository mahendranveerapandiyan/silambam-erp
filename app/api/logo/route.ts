import { sql } from '@/lib/db';

/**
 * The enterprise logo. Pages link to /api/logo?e=<enterprise>&v=<fingerprint>;
 * the fingerprint changes whenever a new logo is uploaded, so the new logo
 * shows at once everywhere while an unchanged one can be cached by the browser.
 */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const id = q.get('e');
  const [e] = id && /^\d+$/.test(id)
    ? await sql`select logo_mime, logo_data from enterprise where id = ${id} and logo_data is not null`
    : await sql`select logo_mime, logo_data from enterprise where logo_data is not null order by id limit 1`;
  if (!e) return new Response('Not found', { status: 404 });
  return new Response(e.logo_data, {
    headers: { 'Content-Type': e.logo_mime, 'Cache-Control': q.get('v') ? 'public, max-age=31536000, immutable' : 'no-cache' },
  });
}
