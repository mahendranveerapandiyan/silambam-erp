import { requireUser, requirePriv, can, canAny, type SessionUser } from '@/lib/auth';
import { getAsOf } from '@/lib/asof';
import { sql } from '@/lib/db';
import { myClasses, studentScopeSql } from '@/lib/scope';
import { IdCards } from '@/components/people/IdCards';
import { PageHeader, Select, type SP, s } from '@/components/ui';
import { AutoSubmit } from '@/components/client';

export default async function Cards({ searchParams }: { searchParams: SP }) {
  const u = await requirePriv('CD_STUDENT_ID_CARD_PRV');
  const asOf = await getAsOf();
  const cls = s((await searchParams).cls);
  const classes = await myClasses(u, asOf);
  let ids: string[] = [];
  if (cls) {
    const [c, sec] = cls.split(':');
    ids = (await sql`select a.person_id from assignment a join assignment_f af on af.id = a.id and ${asOf}::date between af.effective_start_date and af.effective_end_date
      join assignment_status_f st on st.id = af.assignment_status_id and ${asOf}::date between st.effective_start_date and st.effective_end_date
      where a.assignment_type = 'STUDENT' and af.class_id = ${c} and af.section_id = ${sec} and st.system_status_code = 'ACTIVE' ${studentScopeSql(u, asOf)}`).map((r) => String(r.person_id));
  }
  return (
    <div>
      <div className="no-print">
        <PageHeader title="QR ID Cards" subtitle="Print student ID cards with QR codes for attendance scanning." />
        <form className="card mb-4 flex gap-2"><Select name="cls" options={classes.map((c) => ({ value: `${c.class_id}:${c.section_id}`, label: c.label }))} value={cls} empty="Select class / section" /><AutoSubmit /></form>
      </div>
      {cls && <IdCards u={u} kind="STUDENT" personIds={ids} asOf={asOf} />}
    </div>
  );
}
