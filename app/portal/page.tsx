import Link from 'next/link';
import { requirePriv } from '@/lib/auth';
import { sql } from '@/lib/db';
import { assignmentFor, personDetail } from '@/lib/people';
import { lk } from '@/lib/lookups';
import { paymentQrsFor, totals } from '@/lib/fees';
import { fmtDate, money, todayISO } from '@/lib/util';
import { Badge, Empty, Flash, STATUS_COLOR, type SP, s } from '@/components/ui';

export default async function Portal({ searchParams }: { searchParams: SP }) {
  const u = await requirePriv('CD_PORTAL_PRV');
  const sp = await searchParams;
  const today = todayISO();
  const ids = [
    ...(u.roles.includes('STUDENT') && u.personId ? [String(u.personId)] : []),
    ...(await sql`select person_id from user_student_access where user_id = ${u.id}`).map((r) => String(r.person_id)),
  ];
  const kids = [];
  for (const id of [...new Set(ids)]) kids.push({ id, p: await personDetail(id, today) });
  if (!kids.length) return <div className="card">No students are linked to this login yet. Please contact the school office.</div>;
  const sel = kids.find((k) => k.id === s(sp.s)) ?? kids[0];
  const id = sel.id;
  const [a, L] = [await assignmentFor(id, 'STUDENT', today), await lk()];
  const month = today.slice(0, 7);
  const att = await sql`select sa.*, lv.tag from student_attendance sa left join lookup_value lv on lv.lookup_type = 'ATTENDANCE_STATUS' and lv.lookup_code = sa.status_code
    where person_id = ${id} and attendance_date >= ${a?.academic_year_id ? sql`(select start_date from academic_year where id = ${a.academic_year_id})` : sql`${today}::date - 365`} order by attendance_date desc`;
  const thisMonth = att.filter((r) => r.attendance_date.startsWith(month));
  const pct = (rows: any[]) => { const t = rows.filter((r) => r.tag !== 'EXCLUDE').length; return t ? Math.round((rows.filter((r) => r.tag === 'PRESENT').length + rows.filter((r) => r.tag === 'HALF').length / 2) / t * 100) : null; };
  const demands = await sql`select * from fee_demand_v where person_id = ${id} and cancelled_flag = 'N' order by due_date`;
  const t = totals(demands);
  const overdue = demands.filter((d) => Number(d.balance_amount) > 0 && d.due_date < today).reduce((x, d) => x + Number(d.balance_amount), 0);
  const payments = await sql`select * from fee_payment where person_id = ${id} and status_code = 'ACTIVE' order by payment_date desc limit 20`;
  const qrs = await paymentQrsFor(id, today);
  const exams = await sql`select c.*, e.name, e.exam_date, e.exam_type_code, e.status_code exam_status from exam_candidate c join exam e on e.id = c.exam_id where c.person_id = ${id} order by e.exam_date desc`;
  const events = await sql`select ep.*, e.name, e.start_date, e.venue, e.event_type_code from event_participant ep join event e on e.id = ep.event_id where ep.person_id = ${id} order by e.start_date desc`;

  return (
    <div className="space-y-4">
      <Flash sp={sp} />
      {kids.length > 1 && <div className="flex flex-wrap gap-2">{kids.map((k) => <Link key={k.id} href={`/portal?s=${k.id}`} className={`btn ${k.id === id ? 'btn-primary' : ''}`}>{k.p?.full_name}</Link>)}</div>}
      <div className="card flex flex-wrap items-center gap-4">
        {sel.p?.has_photo ? <img src={`/api/photo/${id}`} alt="" className="h-24 w-20 rounded object-cover" /> : <div className="h-24 w-20 rounded bg-black/10" />}
        <div className="flex-1">
          <h1 className="text-xl font-bold">{sel.p?.full_name}</h1>
          <div className="text-sm">{a?.assignment_number} · {a?.bu_name} · {a?.class_name} {a?.section_name && `› ${a.section_name}`}</div>
          <div className="text-sm">Grade: <b>{a?.grade_name ?? '—'}</b> · Fee plan: {L('FEE_FREQUENCY', a?.fee_frequency_code)} · {a?.status_name && <Badge color={STATUS_COLOR[a.system_status_code]}>{a.status_name}</Badge>}</div>
        </div>
        <img src={`/api/qr/${id}`} alt="Attendance QR" className="h-24 w-24" title="Attendance QR" />
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="card"><div className="text-xs font-semibold uppercase text-gray-500">Attendance this month</div><div className="text-xl font-bold">{pct(thisMonth) ?? '—'}{pct(thisMonth) !== null && '%'}</div><div className="muted">{thisMonth.length} day(s) recorded</div></div>
        <div className="card"><div className="text-xs font-semibold uppercase text-gray-500">Attendance this year</div><div className="text-xl font-bold">{pct(att) ?? '—'}{pct(att) !== null && '%'}</div></div>
        <div className="card"><div className="text-xs font-semibold uppercase text-gray-500">Fees Pending</div><div className={`text-xl font-bold ${t.balance > 0 ? 'text-red-700' : ''}`}>{money(t.balance)}</div><div className="muted">{money(overdue)} overdue</div></div>
        <div className="card"><div className="text-xs font-semibold uppercase text-gray-500">Fees Paid</div><div className="text-xl font-bold text-green-700">{money(t.paid)}</div><div className="muted">{money(t.exempted)} exception</div></div>
      </div>
      <div className="grid gap-4 md:grid-cols-[1fr_16rem]">
        <div className="card overflow-x-auto">
          <h2 className="h2">Fees</h2>
          <table className="tbl"><thead><tr><th>Due</th><th>Fee</th><th>Period</th><th className="text-right">Amount</th><th className="text-right">Balance</th><th>Status</th></tr></thead>
            <tbody>{demands.map((d) => <tr key={d.id} className={Number(d.balance_amount) > 0 && d.due_date < today ? "bg-red-50" : ""}><td className="whitespace-nowrap">{fmtDate(d.due_date)}</td><td>{d.description}</td><td>{d.period_label}</td><td className="text-right">{money(d.amount)}</td><td className="text-right">{money(d.balance_amount)}</td><td><Badge color={STATUS_COLOR[d.payment_status]}>{L('FEE_PAYMENT_STATUS', d.payment_status)}</Badge></td></tr>)}</tbody></table>
          {!demands.length && <Empty />}
          {payments.length > 0 && <><h3 className="mb-1 mt-4 text-sm font-semibold">Payments</h3>
            <table className="tbl"><tbody>{payments.map((p) => <tr key={p.id}><td>{fmtDate(p.payment_date)}</td><td>{p.receipt_number}</td><td>{L('PAYMENT_MODE', p.payment_mode_code)}</td><td className="text-right">{money(p.amount)}</td></tr>)}</tbody></table></>}
        </div>
        <div className="card text-center">
          <h2 className="h2">Pay by UPI</h2>
          {qrs.map((q) => <div key={q.id} className="mb-3"><img src={`/api/payment-qr/${q.id}`} alt="" className="mx-auto max-h-52" /><div className="text-sm font-semibold">{q.label}</div><div className="font-mono text-xs">{q.upi_id}</div></div>)}
          {!qrs.length && <p className="muted">Please pay at the branch.</p>}
          <p className="mt-2 text-xs text-gray-500">After paying, share the UTR/reference with the class incharge so the payment can be recorded.</p>
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="card"><h2 className="h2">Exams</h2>
          <table className="tbl"><tbody>{exams.map((e) => <tr key={e.id}><td>{fmtDate(e.exam_date)}</td><td>{e.name}<div className="text-xs">{L('EXAM_TYPE', e.exam_type_code)}</div></td>
            <td>{e.exam_status === 'PUBLISHED' ? <><Badge color={STATUS_COLOR[e.result_code]}>{L('EXAM_RESULT', e.result_code)}</Badge> {e.percentage !== null && `${e.percentage}%`}</> : <Badge>Scheduled</Badge>}</td></tr>)}</tbody></table>
          {!exams.length && <Empty />}</div>
        <div className="card"><h2 className="h2">Events</h2>
          <table className="tbl"><tbody>{events.map((e) => <tr key={e.id}><td>{fmtDate(e.start_date)}</td><td>{e.name}<div className="text-xs">{e.venue}</div></td><td>{e.achievement}</td></tr>)}</tbody></table>
          {!events.length && <Empty />}</div>
      </div>
      <div className="card"><h2 className="h2">Recent Attendance</h2>
        <div className="flex flex-wrap gap-1">{att.slice(0, 40).map((r) => <span key={r.id} title={`${fmtDate(r.attendance_date)} – ${L('ATTENDANCE_STATUS', r.status_code)}`}><Badge color={STATUS_COLOR[r.status_code]}>{r.attendance_date.slice(8)}/{r.attendance_date.slice(5, 7)} {r.status_code}</Badge></span>)}</div>
        {!att.length && <Empty />}</div>
    </div>
  );
}
