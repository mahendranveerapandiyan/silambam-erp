import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { lk } from '@/lib/lookups';
import { fmtDateTime } from '@/lib/util';
import { PageHeader, Flash, Badge, type SP, s } from '@/components/ui';

export default async function Users({ searchParams }: { searchParams: SP }) {
  const u = await requireUser('ADMIN');
  const sp = await searchParams;
  const q = s(sp.q), role = s(sp.role);
  const L = await lk();
  const rows = await sql`
    select u.*, array_agg(r.role_code order by r.role_code) filter (where r.role_code is not null) roles, p.person_number
    from user_account u left join user_role r on r.user_id = u.id left join person p on p.id = u.person_id
    where u.enterprise_id = ${u.enterpriseId}
      and (${q}::text is null or u.username ilike ${'%' + (q ?? '') + '%'} or u.display_name ilike ${'%' + (q ?? '') + '%'})
    group by u.id, p.person_number
    having ${role}::text is null or ${role} = any(array_agg(r.role_code))
    order by u.username limit 500`;
  return (
    <div>
      <PageHeader title="Users & Roles" subtitle="Logins for administrators, incharges, staff, accountants, parents and students." actions={<Link href="/config/users/new" className="btn btn-primary">+ New User</Link>} />
      <Flash sp={sp} />
      <div className="card overflow-x-auto">
        <form className="mb-3 flex gap-2">
          <input name="q" defaultValue={q ?? ''} placeholder="Search username or name" className="input max-w-xs" />
          <select name="role" defaultValue={role ?? ''} className="input max-w-[12rem]"><option value="">All roles</option>{['ADMIN', 'INCHARGE', 'STAFF', 'ACCOUNTANT', 'PARENT', 'STUDENT'].map((r) => <option key={r} value={r}>{L('ROLE', r)}</option>)}</select>
          <button className="btn">Filter</button>
        </form>
        <table className="tbl">
          <thead><tr><th>Username</th><th>Name</th><th>Roles</th><th>Person</th><th>Active</th><th>Last Login</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}>
              <td><Link className="link" href={`/config/users/${r.id}`}>{r.username}</Link></td>
              <td>{r.display_name}</td>
              <td className="space-x-1">{(r.roles ?? []).map((x: string) => <Badge key={x} color={x === 'ADMIN' ? 'red' : 'blue'}>{L('ROLE', x)}</Badge>)}</td>
              <td>{r.person_number}</td>
              <td>{r.active_flag === 'Y' ? <Badge color="green">Yes</Badge> : <Badge color="red">No</Badge>}</td>
              <td className="text-xs">{fmtDateTime(r.last_login)}</td>
            </tr>))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
