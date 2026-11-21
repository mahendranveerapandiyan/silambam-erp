import Link from 'next/link';
import { requirePriv, can } from '@/lib/auth';
import { sql } from '@/lib/db';
import { PageHeader, Flash, Field, Back, Badge, type SP } from '@/components/ui';
import { saveRole } from '../actions';

export default async function Roles({ searchParams }: { searchParams: SP }) {
  const u = await requirePriv('CD_ROLE_PRV');
  const roles = await sql`
    select r.*, (select count(*) from role_privilege p where p.role_code = r.code)::int privs,
      (select count(*) from user_role ur where ur.role_code = r.code)::int users
    from app_role r order by r.system_flag desc, r.name`;
  return (
    <div className="max-w-6xl">
      <PageHeader title="Roles & Privileges" subtitle="Each task has one privilege (CD_…_PRV). A role bundles privileges with View / Read / Write access; users can have several roles and a role can be given to many users." />
      <Flash sp={await searchParams} />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card overflow-x-auto lg:col-span-2">
          <table className="tbl">
            <thead><tr><th>Code</th><th>Role</th><th>Privileges</th><th>Users</th><th>Status</th></tr></thead>
            <tbody>{roles.map((r) => (
              <tr key={r.code}>
                <td><Link className="link font-mono text-xs" href={`/config/roles/${r.code}`}>{r.code}</Link></td>
                <td>{r.name}{r.system_flag === 'Y' && <> <Badge color="gray">built-in</Badge></>}<div className="text-xs text-gray-500">{r.description}</div></td>
                <td>{r.privs}</td><td>{r.users}</td>
                <td>{r.active_flag === 'Y' ? <Badge color="green">Active</Badge> : <Badge color="red">Inactive</Badge>}</td>
              </tr>))}</tbody>
          </table>
        </div>
        {can(u, 'CD_ROLE_PRV', 'WRITE') && (
          <form action={saveRole.bind(null, null)} className="card h-fit space-y-3">
            <Back to="/config/roles" />
            <h2 className="h2">New Role</h2>
            <Field label="Role Code *"><input name="code" className="input uppercase" placeholder="e.g. BRANCH_MANAGER" required /></Field>
            <Field label="Role Name *"><input name="name" className="input" required /></Field>
            <Field label="Description"><textarea name="description" rows={2} className="input" /></Field>
            <button className="btn btn-primary">Create &amp; choose privileges</button>
          </form>
        )}
      </div>
    </div>
  );
}
