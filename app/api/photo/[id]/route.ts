import { sql } from '@/lib/db';
import { getUser } from '@/lib/auth';
import { canViewPerson } from '@/lib/access';

/** Person photo. ETag lets browsers re-use their cached copy (304) until the photo changes. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await getUser();
  const { id } = await params;
  if (!u || !(await canViewPerson(u, id))) return new Response('Forbidden', { status: 403 });
  const [meta] = await sql`select extract(epoch from last_update_date)::bigint v, length(data) n from person_photo where person_id = ${id}`;
  if (!meta) return new Response('Not found', { status: 404 });
  const etag = `"p${id}-${meta.v}-${meta.n}"`;
  const headers = { ETag: etag, 'Cache-Control': 'private, max-age=300, must-revalidate' };
  if (req.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers });
  const [p] = await sql`select mime, data from person_photo where person_id = ${id}`;
  return new Response(p.data, { headers: { ...headers, 'Content-Type': p.mime } });
}
