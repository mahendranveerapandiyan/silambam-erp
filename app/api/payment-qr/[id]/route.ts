import { sql } from '@/lib/db';
import { getUser } from '@/lib/auth';

/** Payment QR images uploaded by incharges/admins - visible to any signed-in user. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await getUser();
  if (!u) return new Response('Forbidden', { status: 403 });
  const { id } = await params;
  const [q] = await sql`select mime, data from payment_qr where id = ${id}`;
  if (!q) return new Response('Not found', { status: 404 });
  return new Response(q.data, { headers: { 'Content-Type': q.mime, 'Cache-Control': 'private, max-age=300' } });
}
