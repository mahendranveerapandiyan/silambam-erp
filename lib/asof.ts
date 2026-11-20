import 'server-only';
import { cookies } from 'next/headers';
import { todayISO } from './util';

/** The session "As-of date" every date-tracked screen is evaluated on. */
export async function getAsOf(): Promise<string> {
  const v = (await cookies()).get('erp_asof')?.value;
  return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : todayISO();
}
