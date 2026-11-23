import { sql } from '@/lib/db';
import { lookupOptions } from '@/lib/lookups';
import type { PersonKind } from '@/lib/people';
import { Field, Select } from '../ui';

/** Optional Area of Responsibility rows on the hire / admission form (aor1_…, aor2_…). */
export async function AorFields({ kind, enterpriseId, asOf, rows = 2 }: { kind: PersonKind; enterpriseId: string; asOf: string; rows?: number }) {
  const stu = kind === 'STUDENT';
  const types = await lookupOptions(stu ? 'STUDENT_AOR' : 'STAFF_AOR', asOf);
  const years = stu ? (await sql`select id, name from academic_year where enterprise_id = ${enterpriseId} order by start_date desc`).map((y) => ({ value: String(y.id), label: y.name })) : [];
  const [cur] = stu ? await sql`select id from academic_year where enterprise_id = ${enterpriseId} and ${asOf}::date between start_date and end_date` : [];
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }, (_, k) => k + 1).map((i) => (
        <div key={i} className={`grid gap-2 ${stu ? 'sm:grid-cols-5' : 'sm:grid-cols-4'}`}>
          <Field label={`Responsibility ${i}`}><Select name={`aor${i}_type`} options={types} empty="— None —" /></Field>
          {stu && <Field label="Academic Year"><Select name={`aor${i}_ay`} options={years} value={cur?.id ? String(cur.id) : null} empty="— Choose —" /></Field>}
          <Field label="From" help={stu ? 'Empty = admission date / year start' : 'Empty = hire date'}><input type="date" name={`aor${i}_start`} className="input" /></Field>
          <Field label="To" help={stu ? 'Empty = end of the academic year' : 'Empty = open-ended'}><input type="date" name={`aor${i}_end`} className="input" /></Field>
          <Field label="Remarks"><input name={`aor${i}_remarks`} className="input" /></Field>
        </div>
      ))}
    </div>
  );
}
