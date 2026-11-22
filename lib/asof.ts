import 'server-only';
import { todayISO } from './util';

/**
 * The date every date-tracked screen is evaluated on. The header date picker
 * was removed, so this is always today; past and future versions are seen and
 * corrected through each record's history.
 */
export async function getAsOf(): Promise<string> {
  return todayISO();
}
