import { sql } from '@/lib/db';
import { getUser } from '@/lib/auth';
import { canViewPerson } from '@/lib/access';

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await getUser();
  const { id } = await params;
  if (!u || !(await canViewPerson(u, id))) return new Response('Forbidden', { status: 403 });
  const [p] = await sql`select mime, data from person_photo where person_id = ${id}`;
  if (!p) return new Response('Not found', { status: 404 });
  return new Response(p.data, { headers: { 'Content-Type': p.mime, 'Cache-Control': 'private, max-age=60' } });
}
