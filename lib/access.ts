import 'server-only';
import { sql } from './db';
import { canAny, type SessionUser } from './auth';

/** Can this user see this person's photo / QR / portal data? */
export async function canViewPerson(u: SessionUser, personId: string) {
  if (canAny(u, ['CD_STUDENT_DIRECTORY_PRV', 'CD_STAFF_DIRECTORY_PRV', 'CD_FEE_COLLECT_PRV', 'CD_STUDENT_ATTENDANCE_PRV', 'CD_QR_SCAN_PRV', 'CD_STUDENT_ID_CARD_PRV', 'CD_STAFF_ATTENDANCE_PRV'])) return true;
  if (u.personId && String(u.personId) === String(personId)) return true;
  const [r] = await sql`select 1 from user_student_access where user_id = ${u.id} and person_id = ${personId}`;
  return !!r;
}
