import 'server-only';
import { sql } from './db';
import { refOptions } from './dt';
import { lookupOptions } from './lookups';

export async function examOptions(enterpriseId: string, asOf: string) {
  return {
    years: (await sql`select id, name from academic_year where enterprise_id = ${enterpriseId} order by start_date desc`).map((y) => ({ value: String(y.id), label: y.name })),
    types: await lookupOptions('EXAM_TYPE', asOf),
    statuses: await lookupOptions('EXAM_STATUS', asOf),
    bus: await refOptions('business-units', enterpriseId, asOf),
    classes: await refOptions('classes', enterpriseId, asOf),
    grades: await refOptions('student-grades', enterpriseId, asOf),
    subjects: await refOptions('subjects', enterpriseId, asOf),
    subjectTypes: await lookupOptions('SUBJECT_TYPE', asOf),
  };
}
