import Link from 'next/link';
import { requireUser, requirePriv, can, canAny, type SessionUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { myClasses, studentScopeSql } from '@/lib/scope';
import { fullName, personAsOf } from '@/lib/people';
import { todayISO, addDays, addMonths } from '@/lib/util';
import { PageHeader, Select, Empty, type SP, s } from '@/components/ui';
import { AutoSubmit, PrintButton } from '@/components/client';

const COLORS: Record<string, string> = { P: 'bg-green-500', L: 'bg-amber-400', A: 'bg-red-500', LV: 'bg-blue-400', HD: 'bg-yellow-300', H: 'bg-gray-300' };

import { attendanceWeights, trainingDays, dayCode } from '@/lib/attendance';
export default async function Report({ searchParams }: { searchParams: SP }) {
  const u = await requirePriv('CD_ATTENDANCE_REPORT_PRV');
  const sp = await searchParams;
  const month = s(sp.month) ?? todayISO().slice(0, 7);
  const start = `${month}-01`;
  const end = addDays(addMonths(start, 1), -1);
  const classes = await myClasses(u, end);
  const cls = s(sp.cls);
  const days: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) days.push(d);
  let students: any[] = [];
  const marks = new Map<string, string>();
  if (cls) {
    const [c, sec] = cls.split(':');
    students = await sql`
      select distinct a.person_id, a.assignment_number, ${fullName()} full_name from assignment a
      join assignment_f af on af.id = a.id and af.effective_start_date <= ${end} and af.effective_end_date >= ${start}
      join person p on p.id = a.person_id ${personAsOf(end)}
      where a.assignment_type = 'STUDENT' and af.class_id = ${c} and af.section_id = ${sec} ${studentScopeSql(u, end)}
      order by full_name`;
    const att = await sql`select person_id, attendance_date, status_code from student_attendance where class_id = ${c} and section_id = ${sec} and attendance_date between ${start} and ${end}`;
    for (const r of att) marks.set(`${r.person_id}|${r.attendance_date}`, r.status_code);
  }
  // counting follows Attendance Settings (what each status counts as, half-day value)
  const { tags, half } = await attendanceWeights(u.enterpriseId);
  const training = cls ? await trainingDays(cls.split(':')[0], end) : null;
  const isTraining = (d: string) => !training || !training.codes.length || training.codes.includes(dayCode(d));
  return (
    <div>
      <PageHeader title="Attendance Report" subtitle="Monthly class register" actions={<PrintButton />} />
      <form className="card mb-4 flex flex-wrap gap-2 no-print">
        <input type="month" name="month" defaultValue={month} className="input w-44" />
        <Select name="cls" options={classes.map((c) => ({ value: `${c.class_id}:${c.section_id}`, label: c.label }))} value={cls} empty="Select class / section" className="input max-w-md" />
        <AutoSubmit />
      </form>
      {cls && (
        <div className="card overflow-x-auto">
          <table className="tbl text-xs">
            <thead><tr><th>Student</th>{days.map((d) => <th key={d} className={`!px-1 text-center ${isTraining(d) ? '' : 'bg-slate-100 text-slate-400'}`} title={isTraining(d) ? undefined : 'Not a training day'}>{+d.slice(8)}</th>)}<th>P</th><th>A</th><th>%</th></tr></thead>
            <tbody>{students.map((st) => {
              let p = 0, a = 0, h = 0;
              return (
                <tr key={st.person_id}>
                  <td className="whitespace-nowrap"><Link className="link" href={`/students/${st.person_id}?tab=attendance`}>{st.full_name}</Link></td>
                  {days.map((d) => {
                    const m = marks.get(`${st.person_id}|${d}`);
                    if (m) { const t = tags[m]; if (t === 'PRESENT') p++; else if (t === 'ABSENT') a++; else if (t === 'HALF') h++; }
                    return <td key={d} className={`!px-0.5 text-center ${isTraining(d) ? '' : 'bg-slate-100'}`} title={m}>{m && <span className={`inline-block h-4 w-4 rounded-sm text-[9px] leading-4 text-white ${COLORS[m] ?? 'bg-gray-400'}`}>{m[0]}</span>}</td>;
                  })}
                  <td>{p + h * half}</td><td>{a + h * (1 - half)}</td><td className="font-semibold">{p + a + h ? Math.round(((p + h * half) / (p + a + h)) * 100) : '–'}%</td>
                </tr>);
            })}</tbody>
          </table>
          {!students.length && <Empty />}
        </div>
      )}
    </div>
  );
}
