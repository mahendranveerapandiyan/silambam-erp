import Link from 'next/link';
import type { SessionUser } from '@/lib/auth';
import { can } from '@/lib/auth';
import { seesAllStudents } from '@/lib/scope';
import { peopleList, type PersonKind } from '@/lib/people';
import { refOptions } from '@/lib/dt';
import { lk } from '@/lib/lookups';
import { fmtDate } from '@/lib/util';
import { PageHeader, Flash, Badge, Empty, Select, STATUS_COLOR, s } from '../ui';
import { AutoSubmit } from '../client';

export async function PeopleList({ u, kind, asOf, sp }: { u: SessionUser; kind: PersonKind; asOf: string; sp: Record<string, any> }) {
  const f = { q: s(sp.q), bu: s(sp.bu), branch: s(sp.branch), cls: s(sp.cls), grade: s(sp.grade), status: s(sp.status) };
  const page = Math.max(1, Number(s(sp.page)) || 1);
  const rows = await peopleList(u, kind, asOf, f, page);
  const total = Number(rows[0]?.total_count ?? 0);
  const pages = Math.max(1, Math.ceil(total / 100));
  const pageHref = (n: number) => '?' + new URLSearchParams({ ...Object.fromEntries(Object.entries(f).filter(([, v]) => v)) as Record<string, string>, page: String(n) }).toString();
  const [bus, branches, classes, grades, L] = [await refOptions('business-units', u.enterpriseId, asOf), await refOptions('branches', u.enterpriseId, asOf), await refOptions('classes', u.enterpriseId, asOf), await refOptions('student-grades', u.enterpriseId, asOf), await lk()];
  const stu = kind === 'STUDENT';
  const base = stu ? '/students' : '/staff';
  return (
    <div>
      <PageHeader title={stu ? 'Student Directory' : 'Staff Directory'} subtitle={`${total} record(s) as of ${fmtDate(asOf)}${stu && !seesAllStudents(u) ? ' · your classes only' : ''}`}
        actions={can(u, stu ? 'CD_STUDENT_ADMISSION_PRV' : 'CD_STAFF_HIRE_PRV', 'WRITE')
          ? <Link href={`${base}/new`} className="btn btn-primary">{stu ? '+ Add New Student' : '+ Hire Staff'}</Link>
          : stu && can(u, 'CD_ADMISSION_FORM_PRV', 'WRITE') ? <Link href="/students/admission-form" className="btn btn-primary">+ Admission Form</Link> : null} />
      <Flash sp={sp} />
      <div className="card">
        <form className="mb-3 grid gap-2 sm:grid-cols-3 lg:grid-cols-7">
          <input name="q" defaultValue={f.q ?? ''} placeholder="Name, number, phone or ID number" className="input lg:col-span-2" />
          <Select name="bu" options={bus} value={f.bu} empty="All business units" />
          <Select name="branch" options={branches.filter((b) => !f.bu || String(b.parent) === f.bu)} value={f.branch} empty="All branches" />
          {stu && <Select name="cls" options={classes} value={f.cls} empty="All classes" />}
          {stu && <Select name="grade" options={grades} value={f.grade} empty="All grades" />}
          <select name="status" defaultValue={f.status ?? 'ACTIVE'} className="input">
            <option value="ACTIVE">Active</option><option value="SUSPENDED">Suspended</option><option value="INACTIVE">Inactive</option><option value="ALL">All statuses</option>
          </select>
          <AutoSubmit />
        </form>
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead>
              <tr><th></th><th>{stu ? 'Student No.' : 'Staff No.'}</th><th>Name</th><th>Phone</th><th>Branch</th>
                {stu ? <><th>Class › Section</th><th>Grade</th><th>Fee Freq.</th></> : <><th>Job</th><th>Department</th><th>Type</th></>}
                <th>Status</th><th>Since</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.assignment_id}>
                  <td className="w-10">{r.has_photo ? <img src={`/api/photo/${r.person_id}`} alt="" loading="lazy" className="h-8 w-8 rounded-full object-cover" /> : <div className="flex h-8 w-8 items-center justify-center rounded-full bg-black/10 text-xs font-bold">{r.full_name?.[0]}</div>}</td>
                  <td><Link className="link" href={`${base}/${r.person_id}`}>{r.assignment_number}</Link></td>
                  <td>{r.full_name}</td>
                  <td>{r.phone}</td>
                  <td>{r.branch_name ?? r.bu_name}</td>
                  {stu ? <><td>{r.class_name}{r.section_name && ` › ${r.section_name}`}</td><td>{r.grade_name}</td><td>{L('FEE_FREQUENCY', r.fee_frequency_code)}</td></>
                    : <><td>{r.job_name}</td><td>{r.department_name}</td><td>{L('EMPLOYMENT_TYPE', r.employment_type_code)}</td></>}
                  <td><Badge color={STATUS_COLOR[r.system_status_code]}>{r.status_name}</Badge></td>
                  <td className="whitespace-nowrap">{fmtDate(r.original_start_date)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && <Empty />}
        </div>
        {pages > 1 && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <span className="muted">Page {page} of {pages}</span>
            {page > 1 && <Link className="btn btn-sm" href={pageHref(page - 1)}>‹ Previous</Link>}
            {page < pages && <Link className="btn btn-sm" href={pageHref(page + 1)}>Next ›</Link>}
          </div>
        )}
      </div>
    </div>
  );
}
