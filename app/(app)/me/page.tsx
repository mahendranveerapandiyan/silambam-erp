import Link from 'next/link';
import { requirePriv } from '@/lib/auth';
import { sql } from '@/lib/db';
import { assignmentFor, personDetail } from '@/lib/people';
import { lk } from '@/lib/lookups';
import { fmtDate, fmtDateTime, todayISO } from '@/lib/util';
import { PageHeader, Badge, Empty, STATUS_COLOR } from '@/components/ui';

export default async function Me() {
  const u = await requirePriv('CD_MY_PROFILE_PRV');
  if (!u.personId) return <div className="card max-w-lg">Your login is not linked to a staff record. Ask an administrator to link it (Configuration › Users).</div>;
  const today = todayISO();
  const [p, a, L] = [await personDetail(u.personId, today), await assignmentFor(u.personId, 'STAFF', today), await lk()];
  const att = await sql`select * from staff_attendance where person_id = ${u.personId} order by attendance_date desc limit 31`;
  const classes = await sql`select ci.*, (select name from class_f where id = ci.class_id order by effective_start_date desc limit 1) class_name from class_incharge ci where person_id = ${u.personId} and ${today}::date between start_date and end_date`;
  return (
    <div className="max-w-5xl">
      <PageHeader title={p?.full_name ?? u.displayName} subtitle={<>{a?.assignment_number} · {a?.job_name} · {a?.bu_name}</>} actions={<Link href="/account" className="btn">Change password</Link>} />
      <div className="grid gap-4 md:grid-cols-[16rem_1fr]">
        <div className="card text-center">
          <img src={`/api/qr/${u.personId}`} alt="My QR" className="mx-auto h-52 w-52" />
          <p className="muted mt-2">Show this QR at the branch to check in / out.</p>
          {classes.length > 0 && <div className="mt-3 text-left text-sm"><b>My classes:</b> {classes.map((c) => c.class_name).join(', ')}</div>}
        </div>
        <div className="card overflow-x-auto">
          <h2 className="h2">My Attendance</h2>
          <table className="tbl"><thead><tr><th>Date</th><th>Status</th><th>In</th><th>Out</th></tr></thead>
            <tbody>{att.map((r) => <tr key={r.id}><td>{fmtDate(r.attendance_date)}</td><td><Badge color={STATUS_COLOR[r.status_code]}>{L('ATTENDANCE_STATUS', r.status_code)}</Badge></td><td className="text-xs">{fmtDateTime(r.check_in_time)}</td><td className="text-xs">{fmtDateTime(r.check_out_time)}</td></tr>)}</tbody></table>
          {!att.length && <Empty />}
        </div>
      </div>
    </div>
  );
}
