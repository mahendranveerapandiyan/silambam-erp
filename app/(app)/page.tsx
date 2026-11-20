import Link from 'next/link';
import { requireUser, hasRole, isAdmin } from '@/lib/auth';
import { sql } from '@/lib/db';
import { myClasses, studentScopeSql } from '@/lib/scope';
import { academicYearOn } from '@/lib/people';
import { lk } from '@/lib/lookups';
import { fmtDate, money, todayISO, addDays } from '@/lib/util';
import { PageHeader, Stat, Badge, Empty } from '@/components/ui';

export default async function Dashboard() {
  const u = await requireUser('INCHARGE', 'ACCOUNTANT');
  const today = todayISO();
  const E = u.enterpriseId;
  const L = await lk();
  const ay = await academicYearOn(E, today);
  const scope = studentScopeSql(u, today);
  const [stu] = await sql`select count(*)::int n from assignment a
    join assignment_f af on af.id = a.id and ${today}::date between af.effective_start_date and af.effective_end_date
    join assignment_status_f st on st.id = af.assignment_status_id and ${today}::date between st.effective_start_date and st.effective_end_date
    where a.enterprise_id = ${E} and a.assignment_type = 'STUDENT' and st.system_status_code = 'ACTIVE' ${scope}`;
  const [att] = await sql`select count(*)::int marked, count(*) filter (where sa.status_code in ('P','L'))::int present from student_attendance sa
    join assignment_f af on af.id = sa.assignment_id and ${today}::date between af.effective_start_date and af.effective_end_date
    where sa.attendance_date = ${today} ${scope}`;
  const [fees] = await sql`select coalesce(sum(d.balance_amount),0) pending, coalesce(sum(d.balance_amount) filter (where d.due_date < ${today}),0) overdue
    from fee_demand_v d join assignment a on a.person_id = d.person_id and a.assignment_type = 'STUDENT'
    join assignment_f af on af.id = a.id and ${today}::date between af.effective_start_date and af.effective_end_date
    where d.enterprise_id = ${E} and d.cancelled_flag = 'N' ${scope}`;
  const [coll] = await sql`select coalesce(sum(p.amount),0) a from fee_payment p where p.enterprise_id = ${E} and p.status_code = 'ACTIVE'
    and to_char(p.payment_date, 'YYYY-MM') = ${today.slice(0, 7)} ${hasRole(u, 'ACCOUNTANT') ? sql`` : sql`and p.collected_by = ${u.username}`}`;
  const [staff] = await sql`select count(*)::int n, (select count(*)::int from staff_attendance where attendance_date = ${today} and status_code in ('P','L')) present from assignment a
    join assignment_f af on af.id = a.id and ${today}::date between af.effective_start_date and af.effective_end_date
    join assignment_status_f st on st.id = af.assignment_status_id and ${today}::date between st.effective_start_date and st.effective_end_date
    where a.enterprise_id = ${E} and a.assignment_type = 'STAFF' and st.system_status_code = 'ACTIVE'`;
  const [pendEx] = await sql`select count(*)::int n from fee_exemption where status_code = 'PENDING'`;
  const [lowStock] = await sql`select count(*)::int n from (select i.id, t.business_unit_id, sum(t.quantity) q, i.reorder_level from item i join stock_txn t on t.item_id = i.id
    where i.enterprise_id = ${E} and i.active_flag = 'Y' group by 1, 2, 4 having sum(t.quantity) <= i.reorder_level) x`;
  const exams = await sql`select id, name, exam_date, exam_type_code from exam where enterprise_id = ${E} and exam_date between ${today} and ${addDays(today, 60)} and status_code = 'SCHEDULED' order by exam_date limit 5`;
  const events = await sql`select id, name, start_date, event_type_code from event where enterprise_id = ${E} and end_date >= ${today} and status_code in ('PLANNED','OPEN') order by start_date limit 5`;
  const classes = await myClasses(u, today);
  const classAtt = classes.length > 0 && classes.length <= 20 ? await sql`select class_id, section_id, count(*)::int marked from student_attendance where attendance_date = ${today} group by 1, 2` : [];
  const markedMap = new Map(classAtt.map((r) => [`${r.class_id}:${r.section_id}`, r.marked]));

  return (
    <div className="max-w-7xl">
      <PageHeader title={`Welcome, ${u.displayName}`} subtitle={<>{fmtDate(today)} · {ay ? ay.name : <span className="text-red-700">No academic year covers today – define one</span>}</>} />
      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={isAdmin(u) || hasRole(u, 'ACCOUNTANT') ? 'Active Students' : 'My Students'} value={stu.n} href="/students" />
        <Stat label="Attendance Today" value={att.marked ? `${Math.round((att.present / att.marked) * 100)}%` : '—'} sub={`${att.present} present of ${att.marked} marked`} href="/attendance/students" />
        <Stat label="Pending Fees" value={money(fees.pending)} sub={<span className="text-red-700">{money(fees.overdue)} overdue</span>} href="/fees" />
        <Stat label={hasRole(u, 'ACCOUNTANT') ? 'Collected This Month' : 'Collected by Me This Month'} value={money(coll.a)} href="/fees/summary" />
        {isAdmin(u) && <>
          <Stat label="Active Staff" value={staff.n} sub={`${staff.present} checked in today`} href="/attendance/staff" />
          <Stat label="Exception Approvals" value={pendEx.n} sub="waiting for you" href="/fees/exemptions" />
          <Stat label="Low Stock Items" value={lowStock.n} sub="at or below reorder level" href="/inventory" />
        </>}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card">
          <h2 className="h2">{isAdmin(u) ? 'Classes' : 'My Classes'} – today&apos;s attendance</h2>
          {classes.length > 20 ? <p className="muted">{classes.length} classes. <Link className="link" href="/attendance/students">Open attendance</Link></p> : classes.map((c) => {
            const k = `${c.class_id}:${c.section_id}`;
            return (
              <div key={k} className="flex items-center justify-between border-b border-black/5 py-1.5 text-sm">
                <span>{c.label}</span>
                {markedMap.get(k) ? <Badge color="green">{markedMap.get(k)} marked</Badge> : <Link className="btn btn-sm" href={`/attendance/students?cls=${k}`}>Mark</Link>}
              </div>);
          })}
          {!classes.length && <Empty>No classes assigned.</Empty>}
        </div>
        <div className="card">
          <h2 className="h2">Upcoming Exams</h2>
          {exams.map((e) => <div key={e.id} className="flex justify-between border-b border-black/5 py-1.5 text-sm"><Link className="link" href={`/exams/${e.id}`}>{e.name}</Link><span>{fmtDate(e.exam_date)}</span></div>)}
          {!exams.length && <Empty>None in the next 60 days.</Empty>}
        </div>
        <div className="card">
          <h2 className="h2">Upcoming Events</h2>
          {events.map((e) => <div key={e.id} className="flex justify-between border-b border-black/5 py-1.5 text-sm"><Link className="link" href={`/events/${e.id}`}>{e.name}</Link><span>{L('EVENT_TYPE', e.event_type_code)} · {fmtDate(e.start_date)}</span></div>)}
          {!events.length && <Empty />}
        </div>
      </div>
    </div>
  );
}
