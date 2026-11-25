import Link from 'next/link';
import { requireUser, requirePriv, can, canAny, type SessionUser } from '@/lib/auth';
import { getAsOf } from '@/lib/asof';
import { sql } from '@/lib/db';
import { lk } from '@/lib/lookups';
import { academicYearOn } from '@/lib/people';
import { examOptions } from '@/lib/examOptions';
import { fmtDate } from '@/lib/util';
import { PageHeader, Flash, Select, Badge, Empty, type SP, s, here } from '@/components/ui';
import { AutoSubmit, ConfirmButton } from '@/components/client';
import { deleteExam } from './setupActions';

export default async function Exams({ searchParams }: { searchParams: SP }) {
  const u = await requirePriv(['CD_EXAM_SETUP_PRV', 'CD_EXAM_CANDIDATE_PRV']);
  const sp = await searchParams;
  const asOf = await getAsOf();
  const o = await examOptions(u.enterpriseId, asOf);
  const ay = s(sp.ay) ?? String((await academicYearOn(u.enterpriseId, asOf))?.id ?? o.years[0]?.value ?? '');
  const type = s(sp.type);
  const L = await lk();
  const write = can(u, 'CD_EXAM_SETUP_PRV', 'WRITE');
  const rows = await sql`select e.*, (select count(*) from exam_candidate c where c.exam_id = e.id)::int candidates,
      (select count(*) from exam_candidate c where c.exam_id = e.id and c.result_code = 'PASS')::int passed,
      (select count(*) from exam_candidate c where c.exam_id = e.id and c.published_flag = 'Y')::int published,
      (select string_agg((select name from student_grade_f g where g.id = eg.grade_id order by effective_start_date desc limit 1), ', ') from exam_grade eg where eg.exam_id = e.id) grades,
      exists (select 1 from exam_examiner x where x.exam_id = e.id and x.person_id = ${u.personId ?? 0}) examiner,
      (select name from business_unit_f b where b.id = e.business_unit_id order by effective_start_date desc limit 1) bu_name
    from exam e where e.enterprise_id = ${u.enterpriseId} and e.academic_year_id = ${ay || null} ${type ? sql`and e.exam_type_code = ${type}` : sql``}
    order by e.exam_date desc`;
  return (
    <div className="max-w-7xl">
      <PageHeader title="Exams" subtitle="Grade Exams (one per student per academic year, with promotion), Assessments (any number) and Term Exams."
        actions={<>{can(u, 'CD_EVALUATION_TEMPLATE_PRV') && <Link href="/exams/templates" className="btn">Evaluation Templates</Link>}{can(u, 'CD_EXAM_SETUP_PRV', 'WRITE') && <Link href={`/exams/new?ay=${ay}`} className="btn btn-primary">+ Create Exam</Link>}</>} />
      <Flash sp={sp} />
      <form className="card mb-4 flex flex-wrap gap-2">
        <Select name="ay" options={o.years} value={ay} empty={false} className="input max-w-xs" />
        <Select name="type" options={o.types} value={type} empty="All types" className="input max-w-xs" />
        <AutoSubmit />
      </form>
      <div className="card mb-4 overflow-x-auto">
        <table className="tbl"><thead><tr><th>Date</th><th>Code</th><th>Exam</th><th>Type</th><th>Grades</th><th>Outcome</th><th>Candidates</th><th>Passed</th><th>Status</th>{write && <th></th>}</tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}><td>{fmtDate(r.exam_date)}</td><td className="font-mono text-xs">{r.code}</td>
              <td><Link className="link" href={r.status_code === 'DRAFT' ? `/exams/${r.id}/setup?step=${Math.min(7, Number(r.setup_step) + 1)}` : `/exams/${r.id}`}>{r.name}</Link>{r.examiner && <> <Badge color="purple">You examine</Badge></>}</td>
              <td>{L('EXAM_TYPE', r.exam_type_code)}</td><td>{r.grades ?? 'Any'}</td><td className="text-xs">{r.outcome_code === 'PROMOTE' ? 'Promote' : 'Record only'}</td><td>{r.candidates}</td><td>{r.passed}</td>
              <td><Badge color={r.status_code === 'PUBLISHED' ? 'green' : r.status_code === 'CANCELLED' ? 'red' : r.status_code === 'DRAFT' ? 'amber' : 'blue'}>{L('EXAM_STATUS', r.status_code)}</Badge>
                {r.status_code === 'DRAFT' && <div className="text-[10px] text-slate-500">setup stop {Math.min(7, Number(r.setup_step) + 1)} of 7</div>}</td>
              {write && <td>{r.status_code !== 'PUBLISHED' && !r.published && (
                <form action={deleteExam.bind(null, r.id)}><input type="hidden" name="_back" value={here('/exams', sp)} />
                  <ConfirmButton className="btn btn-sm" message={`Delete the exam ${r.name}${r.candidates ? ` with its ${r.candidates} assigned student(s) and their marks? Unpaid exam fees are cancelled` : ''}? This cannot be undone.`}>Delete</ConfirmButton></form>)}</td>}</tr>))}</tbody></table>
        {!rows.length && <Empty>No exams for this academic year.</Empty>}
      </div>
    </div>
  );
}
