import 'server-only';
import { sql } from './db';
import { hasRole, type SessionUser } from './auth';

/** Can this user see this person's photo / QR / portal data? */
export async function canViewPerson(u: SessionUser, personId: string) {
  if (hasRole(u, 'INCHARGE', 'ACCOUNTANT')) return true;
  if (u.personId && String(u.personId) === String(personId)) return true;
  const [r] = await sql`select 1 from user_student_access where user_id = ${u.id} and person_id = ${personId}`;
  return !!r;
}
