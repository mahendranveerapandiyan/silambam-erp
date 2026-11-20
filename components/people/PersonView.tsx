import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { SessionUser } from '@/lib/auth';
import { isAdmin } from '@/lib/auth';
import { sql } from '@/lib/db';
import { assignmentBase, assignmentFor, personDetail, type PersonKind } from '@/lib/people';
import { datedRefOptions, nameOn } from '@/lib/dt';
import { lk, lookupOptions } from '@/lib/lookups';
import { fmtDate, fmtDateTime, money, ageOn } from '@/lib/util';
import { totals } from '@/lib/fees';
import { PageHeader, Flash, Field, Badge, Back, Tabs, Empty, Select, STATUS_COLOR, here } from '../ui';
import { ConfirmButton } from '../client';
import { PhotoInput } from '../PhotoInput';
import { PersonFields } from './PersonFields';
import { updatePerson, uploadPhoto, regenerateQr, saveContact, undoAssignment } from '@/app/(app)/people/actions';

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</div>
      <div className="text-sm">{children || <span className="text-gray-400">—</span>}</div>
    </div>
  );
}

export async function PersonView({ u, kind, personId, asOf, sp }: { u: SessionUser; kind: PersonKind; personId: string; asOf: string; sp: Record<string, any> }) {
  const p = await personDetail(personId, asOf);
  const ab = await assignmentBase(personId, kind);
  if (!p || !ab) notFound();
  const a = await assignmentFor(personId, kind, asOf);
  const L = await lk();
  const stu = kind === 'STUDENT';
  const base = stu ? '/students' : '/staff';
  const tab = typeof sp.tab === 'string' ? sp.tab : 'overview';
  const back = here(`${base}/${personId}`, sp);
  const tabs: [string, string][] = stu
    ? [['overview', 'Overview'], ['assignment', 'Assignment History'], ['personal', 'Personal Details'], ['contacts', 'Parents / Contacts'], ['attendance', 'Attendance'], ['fees', 'Fees'], ['exams', 'Exams'], ['events', 'Events']]
    : [['overview', 'Overview'], ['assignment', 'Assignment History'], ['personal', 'Personal Details'], ['contacts', 'Contacts'], ['attendance', 'Attendance'], ['classes', 'Classes (Incharge)']];
  const contacts = await sql`select * from person_contact where person_id = ${personId} order by primary_flag desc, id`;
  const canEdit = stu || isAdmin(u);

  return (
    <div className="max-w-7xl">
      <PageHeader
        title={p.full_name}
        subtitle={<>{stu ? 'Student' : 'Staff'} No. <b>{ab.assignment_number}</b> · Person No. {p.person_number} · {a ? <Badge color={STATUS_COLOR[a.system_status_code]}>{a.status_name}</Badge> : <Badge color="gray">No assignment on {fmtDate(asOf)}</Badge>}</>}
        actions={<>
          {canEdit && <Link href={`${base}/${personId}/action`} className="btn btn-primary">Actions ▸</Link>}
          {stu && <Link href={`/fees/students/${personId}`} className="btn">Fees</Link>}
          <Link href={`${base}/${personId}/card`} className="btn">ID Card</Link>
          <Link href={base} className="btn">Back</Link>
        </>}
      />
      <Flash sp={sp} />
      <Tabs tabs={tabs} active={tab} base={`${base}/${personId}`} />

      {tab === 'overview' && <Overview />}
      {tab === 'assignment' && <AssignmentHistory />}
      {tab === 'personal' && <Personal />}
      {tab === 'contacts' && <Contacts />}
      {tab === 'attendance' && <Attendance />}
      {tab === 'fees' && <Fees />}
      {tab === 'exams' && <Exams />}
      {tab === 'events' && <Events />}
      {tab === 'classes' && <Classes />}
    </div>
  );

  async function Overview() {
    let feeBox = null;
    if (stu) {
      const d = await sql`select * from fee_demand_v where person_id = ${personId}`;
      const t = totals(d);
      const overdue = d.filter((r) => r.cancelled_flag === 'N' && Number(r.balance_amount) > 0 && r.due_date < asOf).reduce((s, r) => s + Number(r.balance_amount), 0);
      feeBox = (
        <div className="card">
          <h2 className="h2">Fees</h2>
          <div className="grid grid-cols-2 gap-3">
            <Info label="Total Due">{money(t.due)}</Info><Info label="Paid">{money(t.paid)}</Info>
            <Info label="Exception">{money(t.exempted)}</Info><Info label="Pending"><span className={t.balance > 0 ? 'font-bold text-red-700' : ''}>{money(t.balance)}</span></Info>
            <Info label="Overdue (carried forward)"><span className={overdue > 0 ? 'font-bold text-red-700' : ''}>{money(overdue)}</span></Info>
          </div>
          <Link href={`/fees/students/${personId}`} className="btn btn-sm mt-3">Open fee page</Link>
        </div>
      );
    }
    return (
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card space-y-3">
          <div className="flex gap-4">
            {p.has_photo ? <img src={`/api/photo/${personId}`} alt="" className="h-28 w-24 rounded object-cover" /> : <div className="flex h-28 w-24 items-center justify-center rounded bg-black/10 text-3xl font-bold">{p.first_name?.[0]}</div>}
            <img src={`/api/qr/${personId}`} alt="QR" className="h-28 w-28" />
          </div>
          {canEdit && (
            <form action={uploadPhoto.bind(null, kind, personId)} className="flex gap-2">
              <Back to={back} /><PhotoInput required /><button className="btn btn-sm">Upload</button>
            </form>
          )}
          {isAdmin(u) && (
            <form action={regenerateQr.bind(null, kind, personId)}><Back to={back} />
              <ConfirmButton className="btn btn-sm" message="Issue a new QR code? Printed ID cards will stop working.">Re-issue QR code</ConfirmButton></form>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Info label="Date of Birth">{fmtDate(p.date_of_birth)}{p.date_of_birth && ` (${ageOn(p.date_of_birth, asOf)} yrs)`}</Info>
            <Info label="Gender">{L('GENDER', p.gender_code)}</Info>
            <Info label="Blood Group">{L('BLOOD_GROUP', p.blood_group_code)}</Info>
            <Info label="Mobile">{p.phone}</Info>
            <Info label="Email">{p.email}</Info>
            <Info label="City">{p.city}</Info>
            <Info label="Emergency">{p.emergency_contact_name} {p.emergency_contact_phone}</Info>
            <Info label="Medical">{p.medical_notes}</Info>
          </div>
        </div>
        <div className="card">
          <h2 className="h2">Assignment as of {fmtDate(asOf)}</h2>
          {!a ? <Empty>No assignment effective on this date.</Empty> : (
            <div className="grid grid-cols-2 gap-3">
              <Info label={stu ? 'Admission Date' : 'Hire Date'}>{fmtDate(ab!.original_start_date)}</Info>
              <Info label="Last Action">{a.action_name} ({fmtDate(a.effective_start_date)})</Info>
              <Info label="Legal Employer">{a.le_name}</Info>
              <Info label="Branch">{a.bu_name}</Info>
              {stu ? <>
                <Info label="Class › Section">{a.class_name}{a.section_name && ` › ${a.section_name}`}</Info>
                <Info label="Grade">{a.grade_name}</Info>
                <Info label="Academic Year">{a.academic_year_name}</Info>
                <Info label="Fee Frequency">{L('FEE_FREQUENCY', a.fee_frequency_code)}</Info>
                <Info label="House">{a.house_name}</Info>
                <Info label="Club">{a.club_name}</Info>
                <Info label="Community">{a.community_name}</Info>
              </> : <>
                <Info label="Job">{a.job_name}</Info>
                <Info label="Position">{a.position_name}</Info>
                <Info label="Department">{a.department_name}</Info>
                <Info label="Grade">{a.staff_grade_name}</Info>
                <Info label="Employment Type">{L('EMPLOYMENT_TYPE', a.employment_type_code)}</Info>
                <Info label="Category">{L('EMPLOYMENT_CATEGORY', a.employment_category_code)}</Info>
                <Info label="Payroll Status">{L('PAYROLL_STATUS', a.payroll_status_code)}</Info>
              </>}
              <Info label="Person Type">{a.person_type_name}</Info>
            </div>
          )}
        </div>
        <div className="space-y-4">
          {feeBox}
          <div className="card">
            <h2 className="h2">{stu ? 'Parents / Guardian' : 'Contacts'}</h2>
            {contacts.length ? contacts.map((c) => (
              <div key={c.id} className="mb-2 text-sm"><b>{L('RELATIONSHIP', c.relationship_code)}</b>: {c.name} {c.phone && `· ${c.phone}`} {c.primary_flag === 'Y' && <Badge color="blue">Primary</Badge>}</div>
            )) : <Empty>No contacts</Empty>}
          </div>
        </div>
      </div>
    );
  }

  async function AssignmentHistory() {
    const rows = await sql`select * from assignment_f where id = ${ab!.id} order by effective_start_date desc`;
    const E = u.enterpriseId;
    const V = async (k: string) => datedRefOptions(k, E);
    const o = {
      action: await V(stu ? 'student-actions' : 'staff-actions'), status: await V(stu ? 'student-statuses' : 'staff-statuses'),
      bu: await V('business-units'), cls: await V('classes'), sec: await V('sections'), grade: await V('student-grades'),
      job: await V('jobs'), dept: await V('departments'), sgrade: await V('staff-grades'), pos: await V('positions'),
    };
    // names as they were on each row's start date
    const at = (k: keyof typeof o, id: any, d: string) => (id ? nameOn(o[k], id, d).split(' › ').at(-1) : '');
    return (
      <div className="card overflow-x-auto">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="h2 mb-0">Assignment History (date-effective)</h2>
          {isAdmin(u) && rows.length > 1 && (
            <form action={undoAssignment.bind(null, kind, personId)}><Back to={back} /><ConfirmButton className="btn btn-sm" message="Remove the latest assignment change?">Undo latest change</ConfirmButton></form>
          )}
        </div>
        <table className="tbl">
          <thead><tr><th>From</th><th>To</th><th>Action</th><th>Reason</th><th>Status</th><th>Branch</th>
            {stu ? <><th>Class › Section</th><th>Grade</th><th>Fee Freq.</th></> : <><th>Job</th><th>Position</th><th>Department</th><th>Grade</th><th>Payroll</th></>}
            <th>Comments</th><th>By</th></tr></thead>
          <tbody>{rows.map((r) => {
            const d = r.effective_start_date;
            return (
            <tr key={d} className={asOf >= r.effective_start_date && asOf <= r.effective_end_date ? 'bg-amber-50' : ''}>
              <td className="whitespace-nowrap">{fmtDate(r.effective_start_date)}</td><td className="whitespace-nowrap">{fmtDate(r.effective_end_date)}</td>
              <td>{at('action', r.action_id, d)}</td><td>{L('ACTION_REASON', r.action_reason_code)}</td><td>{at('status', r.assignment_status_id, d)}</td><td>{at('bu', r.business_unit_id, d)}</td>
              {stu ? <><td>{at('cls', r.class_id, d)}{r.section_id && ` › ${at('sec', r.section_id, d)}`}</td><td>{at('grade', r.student_grade_id, d)}</td><td>{L('FEE_FREQUENCY', r.fee_frequency_code)}</td></>
                : <><td>{at('job', r.job_id, d)}</td><td>{at('pos', r.position_id, d)}</td><td>{at('dept', r.department_id, d)}</td><td>{at('sgrade', r.staff_grade_id, d)}</td><td>{L('PAYROLL_STATUS', r.payroll_status_code)}</td></>}
              <td>{r.comments}</td><td className="text-xs text-gray-500">{r.last_updated_by}<br />{fmtDateTime(r.last_update_date)}</td>
            </tr>);
          })}
          </tbody>
        </table>
      </div>
    );
  }

  async function Personal() {
    const hist = await sql`select * from person_f where id = ${personId} order by effective_start_date desc`;
    return (
      <div className="space-y-4">
        {canEdit && (
          <form action={updatePerson.bind(null, kind, personId)} className="card">
            <Back to={back} />
            <div className="mb-3 flex flex-wrap items-end gap-3 rounded-md bg-black/[0.03] p-3">
              <Field label="Change Mode"><select name="mode" className="input"><option value="UPDATE">Update – new version from date</option><option value="CORRECT">Correct – fix current version</option></select></Field>
              <Field label="Effective Date"><input type="date" name="effective_date" defaultValue={asOf} required className="input" /></Field>
              <span className="muted pb-2">Current version: {fmtDate(p.effective_start_date)} → {fmtDate(p.effective_end_date)}</span>
            </div>
            <div className="grid-form"><PersonFields p={p} asOf={asOf} /></div>
            <button className="btn btn-primary mt-4">Save</button>
          </form>
        )}
        <div className="card overflow-x-auto">
          <h2 className="h2">History</h2>
          <table className="tbl"><thead><tr><th>From</th><th>To</th><th>Name</th><th>Mobile</th><th>Email</th><th>Address</th><th>Marital Status</th><th>By</th></tr></thead>
            <tbody>{hist.map((h) => (
              <tr key={h.effective_start_date}><td>{fmtDate(h.effective_start_date)}</td><td>{fmtDate(h.effective_end_date)}</td>
                <td>{[h.first_name, h.middle_name, h.last_name].filter(Boolean).join(' ')}</td><td>{h.phone}</td><td>{h.email}</td>
                <td>{[h.address_line1, h.city, L('STATE', h.state_code)].filter(Boolean).join(', ')}</td><td>{L('MARITAL_STATUS', h.marital_status_code)}</td>
                <td className="text-xs text-gray-500">{h.last_updated_by}</td></tr>))}
            </tbody></table>
        </div>
      </div>
    );
  }

  async function Contacts() {
    const rels = await lookupOptions('RELATIONSHIP', asOf);
    const row = (c: any) => (
      <form key={c?.id ?? 'new'} action={saveContact.bind(null, kind, personId, c?.id ?? null)} className={`grid items-end gap-2 sm:grid-cols-7 ${c ? '' : 'rounded bg-green-50 p-2'}`}>
        <Back to={back} />
        <Select name="relationship_code" options={rels} value={c?.relationship_code} required />
        <input name="name" defaultValue={c?.name} placeholder="Name" className="input" required />
        <input name="phone" defaultValue={c?.phone ?? ''} placeholder="Phone" className="input" />
        <input name="email" defaultValue={c?.email ?? ''} placeholder="Email" className="input" />
        <input name="occupation" defaultValue={c?.occupation ?? ''} placeholder="Occupation" className="input" />
        <label className="flex items-center gap-1 text-sm"><input type="checkbox" name="primary_flag" value="Y" defaultChecked={c?.primary_flag === 'Y'} /> Primary</label>
        {canEdit && <div className="flex gap-1"><button className="btn btn-sm">{c ? 'Save' : 'Add'}</button>{c && <button name="_delete" value="1" className="btn btn-sm">✕</button>}</div>}
      </form>
    );
    return <div className="card space-y-2">{contacts.map(row)}{canEdit && row(null)}</div>;
  }

  async function Attendance() {
    const table = stu ? 'student_attendance' : 'staff_attendance';
    const months = await sql`
      select to_char(attendance_date, 'YYYY-MM') m,
        count(*) filter (where lv.tag = 'PRESENT')::int present, count(*) filter (where lv.tag = 'HALF')::int half,
        count(*) filter (where lv.tag = 'ABSENT')::int absent, count(*) filter (where lv.tag is distinct from 'EXCLUDE')::int total
      from ${sql(table)} t left join lookup_value lv on lv.lookup_type = 'ATTENDANCE_STATUS' and lv.lookup_code = t.status_code
      where person_id = ${personId} group by 1 order by 1 desc limit 12`;
    const recent = await sql`select * from ${sql(table)} where person_id = ${personId} order by attendance_date desc limit 30`;
    return (
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card"><h2 className="h2">Monthly Summary</h2>
          <table className="tbl"><thead><tr><th>Month</th><th>Present</th><th>Half Day</th><th>Absent</th><th>%</th></tr></thead>
            <tbody>{months.map((m) => <tr key={m.m}><td>{m.m}</td><td>{m.present}</td><td>{m.half}</td><td>{m.absent}</td><td>{m.total ? Math.round(((m.present + m.half / 2) / m.total) * 100) : 0}%</td></tr>)}</tbody></table>
          {!months.length && <Empty />}
        </div>
        <div className="card"><h2 className="h2">Recent</h2>
          <table className="tbl"><thead><tr><th>Date</th><th>Status</th><th>Source</th><th>Time</th><th>By</th></tr></thead>
            <tbody>{recent.map((r) => <tr key={r.id}><td>{fmtDate(r.attendance_date)}</td><td><Badge color={STATUS_COLOR[r.status_code]}>{L('ATTENDANCE_STATUS', r.status_code)}</Badge></td><td>{L('ATTENDANCE_SOURCE', r.source_code)}</td><td className="text-xs">{fmtDateTime(r.check_in_time)}{r.check_out_time && ` → ${fmtDateTime(r.check_out_time)}`}</td><td className="text-xs">{r.marked_by}</td></tr>)}</tbody></table>
          {!recent.length && <Empty />}
        </div>
      </div>
    );
  }

  async function Fees() {
    const rows = await sql`select d.*, y.name ay_name from fee_demand_v d left join academic_year y on y.id = d.academic_year_id where person_id = ${personId} and cancelled_flag = 'N' order by due_date`;
    const t = totals(rows);
    return (
      <div className="card overflow-x-auto">
        <div className="mb-3 flex flex-wrap items-center gap-4 text-sm">
          <span>Due <b>{money(t.due)}</b></span><span>Paid <b>{money(t.paid)}</b></span><span>Exception <b>{money(t.exempted)}</b></span><span>Pending <b className="text-red-700">{money(t.balance)}</b></span>
          <Link href={`/fees/students/${personId}`} className="btn btn-primary btn-sm ml-auto">Collect / manage fees</Link>
        </div>
        <table className="tbl"><thead><tr><th>Due</th><th>Fee</th><th>Period</th><th>Amount</th><th>Paid</th><th>Exception</th><th>Balance</th><th>Status</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.id}><td>{fmtDate(r.due_date)}</td><td>{r.description}</td><td>{r.period_label}</td><td>{money(r.amount)}</td><td>{money(r.paid_amount)}</td><td>{money(r.exempted_amount)}</td><td>{money(r.balance_amount)}</td><td><Badge color={STATUS_COLOR[r.payment_status]}>{L('FEE_PAYMENT_STATUS', r.payment_status)}</Badge></td></tr>)}</tbody></table>
        {!rows.length && <Empty />}
      </div>
    );
  }

  async function Exams() {
    const rows = await sql`select c.*, e.name, e.exam_date, e.exam_type_code, y.name ay_name from exam_candidate c join exam e on e.id = c.exam_id join academic_year y on y.id = c.academic_year_id where c.person_id = ${personId} order by e.exam_date desc`;
    return (
      <div className="card"><table className="tbl"><thead><tr><th>Date</th><th>Exam</th><th>Type</th><th>Academic Year</th><th>Marks</th><th>%</th><th>Result</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.id}><td>{fmtDate(r.exam_date)}</td><td><Link className="link" href={`/exams/${r.exam_id}`}>{r.name}</Link></td><td>{L('EXAM_TYPE', r.exam_type_code)}</td><td>{r.ay_name}</td><td>{r.total_marks}</td><td>{r.percentage}</td><td><Badge color={STATUS_COLOR[r.result_code]}>{L('EXAM_RESULT', r.result_code)}</Badge>{r.promoted_flag === 'Y' && <Badge color="purple">Promoted</Badge>}</td></tr>)}</tbody></table>
        {!rows.length && <Empty />}</div>
    );
  }

  async function Events() {
    const rows = await sql`select ep.*, e.name, e.start_date, e.event_type_code from event_participant ep join event e on e.id = ep.event_id where ep.person_id = ${personId} order by e.start_date desc`;
    return (
      <div className="card"><table className="tbl"><thead><tr><th>Date</th><th>Event</th><th>Type</th><th>Role</th><th>Achievement</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.id}><td>{fmtDate(r.start_date)}</td><td><Link className="link" href={`/events/${r.event_id}`}>{r.name}</Link></td><td>{L('EVENT_TYPE', r.event_type_code)}</td><td>{L('PARTICIPATION', r.participation_code)}</td><td>{r.achievement}</td></tr>)}</tbody></table>
        {!rows.length && <Empty />}</div>
    );
  }

  async function Classes() {
    const rows = await sql`select ci.*, (select name from class_f where id = ci.class_id order by effective_start_date desc limit 1) class_name,
      (select name from section_f where id = ci.section_id order by effective_start_date desc limit 1) section_name from class_incharge ci where person_id = ${personId} order by start_date desc`;
    return (
      <div className="card"><div className="mb-2 flex justify-between"><h2 className="h2">Classes this staff member is in charge of</h2><Link href="/staff/incharges" className="btn btn-sm">Manage</Link></div>
        <table className="tbl"><thead><tr><th>Class</th><th>Section</th><th>From</th><th>To</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.id}><td>{r.class_name}</td><td>{r.section_name ?? 'All sections'}</td><td>{fmtDate(r.start_date)}</td><td>{fmtDate(r.end_date)}</td></tr>)}</tbody></table>
        {!rows.length && <Empty />}</div>
    );
  }
}
