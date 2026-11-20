import { sql } from '@/lib/db';
export async function GET() {
  const [e] = await sql`select logo_mime, logo_data from enterprise where logo_data is not null order by id limit 1`;
  if (!e) return new Response('Not found', { status: 404 });
  return new Response(e.logo_data, { headers: { 'Content-Type': e.logo_mime, 'Cache-Control': 'no-cache' } });
}
