import QRCode from 'qrcode';
import { sql } from '@/lib/db';
import { getUser } from '@/lib/auth';
import { canViewPerson } from '@/lib/access';

/** Person QR code (used on ID cards and scanned for attendance). */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await getUser();
  const { id } = await params;
  if (!u || !(await canViewPerson(u, id))) return new Response('Forbidden', { status: 403 });
  const [p] = await sql`select qr_token from person where id = ${id}`;
  if (!p) return new Response('Not found', { status: 404 });
  const png = await QRCode.toBuffer(`SILAMBAM:${p.qr_token}`, { width: 320, margin: 1, errorCorrectionLevel: 'M' });
  return new Response(new Uint8Array(png), { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=60' } });
}
