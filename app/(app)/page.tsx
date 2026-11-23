import Link from 'next/link';
import { requireUser, requirePriv, can, canAny, type SessionUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { myClasses, studentScopeSql } from '@/lib/scope';
import { academicYearOn } from '@/lib/people';
import { lk } from '@/lib/lookups';
import { fmtDate, money, todayISO, addDays } from '@/lib/util';
import { PageHeader, Stat, Badge, Empty } from '@/components/ui';
import { GroupedBars, Donut, AreaTrend, MiniCalendar } from '@/components/charts';
import { addMonths } from '@/lib/util';

export default async function Dashboard() {
  const u = await requirePriv('CD_DASHBOARD_PRV');
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
    and to_char(p.payment_date, 'YYYY-MM') = ${today.slice(0, 7)} ${can(u, 'CD_ALL_STUDENTS_DATA_PRV') ? sql`` : sql`and p.collected_by = ${u.username}`}`;
  const [staff] = await sql`select count(*)::int n, (select count(*)::int from staff_attendance where attendance_date = ${today} and status_code in ('P','L')) present from assignment a
    join assignment_f af on af.id = a.id and ${today}::date between af.effective_start_date and af.effective_end_date
    join assignment_status_f st on st.id = af.assignment_status_id and ${today}::date between st.effective_start_date and st.effective_end_date
    where a.enterprise_id = ${E} and a.assignment_type = 'STAFF' and st.system_status_code = 'ACTIVE'`;
  const [pendEx] = await sql`select count(*)::int n from approval_task t join approval_request r on r.id = t.request_id where t.approver_user_id = ${u.id} and t.status_code = 'PENDING' and r.status_code = 'PENDING'`;
  const [lowStock] = await sql`select count(*)::int n from (select i.id, t.business_unit_id, sum(t.quantity) q, i.reorder_level from item i join stock_txn t on t.item_id = i.id
    where i.enterprise_id = ${E} and i.active_flag = 'Y' group by 1, 2, 4 having sum(t.quantity) <= i.reorder_level) x`;
  const exams = await sql`select id, name, exam_date, exam_type_code from exam where enterprise_id = ${E} and exam_date between ${today} and ${addDays(today, 60)} and status_code = 'SCHEDULED' order by exam_date limit 5`;
  const events = await sql`select id, name, start_date, event_type_code from event where enterprise_id = ${E} and end_date >= ${today} and status_code in ('PLANNED','OPEN') order by start_date limit 5`;
  const classes = await myClasses(u, today);
  const classAtt = classes.length > 0 && classes.length <= 20 ? await sql`select class_id, section_id, count(*)::int marked from student_attendance where attendance_date = ${today} group by 1, 2` : [];
  const markedMap = new Map(classAtt.map((r) => [`${r.class_id}:${r.section_id}`, r.marked]));

  // ---- charts -------------------------------------------------------------
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const firstMonth = ay ? ay.start_date.slice(0, 7) + '-01' : addMonths(today.slice(0, 7) + '-01', -5);
  const months = Array.from({ length: ay ? 12 : 6 }, (_, i) => addMonths(firstMonth, i).slice(0, 7));
  const studentFilter = sql`exists (select 1 from assignment a join assignment_f af on af.id = a.id and ${today}::date between af.effective_start_date and af.effective_end_date
    where a.person_id = x.person_id and a.assignment_type = 'STUDENT' ${scope})`;
  const paid = await sql`select to_char(payment_date, 'YYYY-MM') m, sum(amount)::float v from fee_payment x
    where enterprise_id = ${E} and status_code = 'ACTIVE' and to_char(payment_date, 'YYYY-MM') in ${sql(months)} and ${studentFilter} group by 1`;
  const due = await sql`select to_char(due_date, 'YYYY-MM') m, sum(amount)::float v from fee_demand x
    where enterprise_id = ${E} and cancelled_flag = 'N' and to_char(due_date, 'YYYY-MM') in ${sql(months)} and ${studentFilter} group by 1`;
  const feeBars = months.map((m) => ({ label: MON[+m.slice(5) - 1], a: paid.find((r) => r.m === m)?.v ?? 0, b: due.find((r) => r.m === m)?.v ?? 0 }));
  const trendFrom = addDays(today, -29);
  const trend = await sql`select sa.attendance_date d, (count(*) filter (where lv.tag = 'PRESENT') + 0.5 * count(*) filter (where lv.tag = 'HALF'))::float p,
      count(*) filter (where lv.tag is distinct from 'EXCLUDE')::int n
    from student_attendance sa join lookup_value lv on lv.lookup_type = 'ATTENDANCE_STATUS' and lv.lookup_code = sa.status_code
    join assignment_f af on af.id = sa.assignment_id and ${today}::date between af.effective_start_date and af.effective_end_date
    where sa.attendance_date between ${trendFrom} and ${today} ${scope} group by 1`;
  const trendPts = Array.from({ length: 30 }, (_, i) => { const d = addDays(trendFrom, i); const r = trend.find((x) => x.d === d);
    return { label: fmtDate(d), value: r && r.n ? (r.p / r.n) * 100 : null }; });
  const month = today.slice(0, 7);
  const monthEnd = addDays(addMonths(month + '-01', 1), -1);
  const marks: Record<string, string[]> = {};
  for (const r of await sql`select exam_date d, name from exam where enterprise_id = ${E} and to_char(exam_date, 'YYYY-MM') = ${month}`) (marks[r.d] ??= []).push(`Exam: ${r.name}`);
  for (const r of await sql`select start_date, end_date, name from event where enterprise_id = ${E} and start_date <= ${monthEnd} and end_date >= ${month + '-01'}`)
    for (let d = r.start_date; d <= r.end_date; d = addDays(d, 1)) if (d.startsWith(month)) (marks[d] ??= []).push(`Event: ${r.name}`);
  const attPct = att.marked ? (att.present / att.marked) * 100 : null;

  return (
    <div className="max-w-7xl">
      <PageHeader title="Dashboard" subtitle={<>Welcome back, {u.displayName} · {fmtDate(today)} · {ay ? ay.name : <span className="text-red-700">No academic year covers today – define one</span>}</>} />
      <div className="mb-6 grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <Stat dark icon="students" label={can(u, 'CD_ALL_STUDENTS_DATA_PRV') ? 'Active Students' : 'My Students'} value={stu.n} href="/students" />
        <Stat icon="attendance" label="Attendance Today" value={att.marked ? `${Math.round((att.present / att.marked) * 100)}%` : '—'} sub={`${att.present} present of ${att.marked} marked`} href="/attendance/students" />
        <Stat icon="wallet" label="Pending Fees" value={money(fees.pending)} sub={<span className="text-red-700">{money(fees.overdue)} overdue</span>} href="/fees" />
        <Stat icon="rupee" label={can(u, 'CD_ALL_STUDENTS_DATA_PRV') ? 'Collected This Month' : 'Collected by Me This Month'} value={money(coll.a)} href="/fees/summary" />
        {<>
          {can(u, 'CD_STAFF_ATTENDANCE_PRV') && <Stat icon="staff" label="Active Staff" value={staff.n} sub={`${staff.present} checked in today`} href="/attendance/staff" />}
          {can(u, 'CD_MY_APPROVALS_PRV') && <Stat icon="alert" label="My Approvals" value={pendEx.n} sub="waiting for you" href="/approvals" />}
          {can(u, 'CD_INVENTORY_ITEM_PRV') && <Stat icon="box" label="Low Stock Items" value={lowStock.n} sub="at or below reorder level" href="/inventory" />}
        </>}
      </div>
      <div className="mb-6 grid gap-5 xl:grid-cols-3">
        <div className="card xl:col-span-2">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="h2 mb-0">Fees by Month{ay ? ` · ${ay.name}` : ''}</h2>
            <Link href="/fees/summary" className="btn btn-sm">Fee summary</Link>
          </div>
          <GroupedBars data={feeBars} aLabel="Collected" bLabel="Due" fmt={(n) => money(n)} />
          <details className="mt-3 text-sm"><summary className="cursor-pointer text-slate-500">Table view</summary>
            <table className="tbl mt-2"><thead><tr><th>Month</th><th className="text-right">Collected</th><th className="text-right">Due</th></tr></thead>
              <tbody>{feeBars.map((r) => <tr key={r.label}><td>{r.label}</td><td className="text-right">{money(r.a)}</td><td className="text-right">{money(r.b)}</td></tr>)}</tbody></table></details>
        </div>
        <div className="card flex flex-col">
          <h2 className="h2">Attendance Today</h2>
          <Donut pct={attPct} caption={<div className="mt-2 text-sm text-slate-500">{att.present} present of {att.marked} marked</div>} />
          <div className="mt-4 space-y-2 text-sm">
            <div className="flex justify-between border-b border-slate-100 pb-2"><span className="flex items-center gap-2"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-[#0284c7]" />Present / late</span><b>{att.present}</b></div>
            <div className="flex justify-between border-b border-slate-100 pb-2"><span className="flex items-center gap-2"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-[#1e293b]" />Absent / leave</span><b>{att.marked - att.present}</b></div>
            <div className="flex justify-between"><span className="text-slate-500">Not yet marked</span><b>{Math.max(0, stu.n - att.marked)}</b></div>
          </div>
          <Link href="/attendance/students" className="btn btn-primary mt-auto self-center">Mark attendance</Link>
        </div>
        <div className="card xl:col-span-2">
          <div className="mb-2 flex items-center justify-between"><h2 className="h2 mb-0">Attendance – last 30 days</h2><span className="text-xs text-slate-500">% present per day · hover for values</span></div>
          <AreaTrend points={trendPts} />
          <div className="mt-1 flex justify-between text-[10px] uppercase text-slate-400"><span>{fmtDate(trendFrom)}</span><span>{fmtDate(today)}</span></div>
        </div>
        <div className="card">
          <h2 className="h2">{new Date(today + 'T00:00:00').toLocaleString('en-IN', { month: 'long', year: 'numeric' })}</h2>
          <MiniCalendar month={month} today={today} marks={marks} />
        </div>
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="card">
          <h2 className="h2">{can(u, 'CD_ALL_STUDENTS_DATA_PRV') ? 'Classes' : 'My Classes'} – today&apos;s attendance</h2>
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
