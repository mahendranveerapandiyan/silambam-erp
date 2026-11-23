import Link from 'next/link';
import { requirePriv, can } from '@/lib/auth';
import { sql } from '@/lib/db';
import { PageHeader, Flash, Field, Back, Badge, Empty, type SP, s as one } from '@/components/ui';
import { ConfirmButton } from '@/components/client';
import { MultiPick } from '@/components/MultiPick';
import { saveGroup, deleteGroup } from '../../approvals/actions';

export default async function UserGroups({ searchParams }: { searchParams: SP }) {
  const u = await requirePriv('CD_USER_GROUP_PRV');
  const write = can(u, 'CD_USER_GROUP_PRV', 'WRITE');
  const sp = await searchParams;
  const groups = await sql`select g.*, (select count(*) from user_group_member m where m.group_id = g.id)::int members,
      (select string_agg(ua.display_name, ', ' order by ua.display_name) from user_group_member m join user_account ua on ua.id = m.user_id where m.group_id = g.id) names
    from user_group g where g.enterprise_id = ${u.enterpriseId} order by g.name`;
  const editing = groups.find((g) => String(g.id) === one(sp.edit));
  const memberIds = editing ? (await sql`select user_id from user_group_member where group_id = ${editing.id}`).map((m) => String(m.user_id)) : [];
  const users = (await sql`select id, display_name, username from user_account where enterprise_id = ${u.enterpriseId} and active_flag = 'Y' order by display_name`)
    .map((x) => ({ value: String(x.id), label: x.display_name, code: x.username }));
  return (
    <div className="max-w-6xl">
      <PageHeader title="User Groups" subtitle="Named groups of users – used as approvers in Approval Rules (any one or all of them approve)." />
      <Flash sp={sp} />
      <div className="card mb-4 overflow-x-auto">
        <table className="tbl">
          <thead><tr><th>Code</th><th>Name</th><th>Members</th><th>Active</th><th></th></tr></thead>
          <tbody>{groups.map((g) => (
            <tr key={g.id} className={editing && editing.id === g.id ? 'bg-sky-50' : ''}>
              <td className="font-mono text-xs">{g.code}</td><td>{g.name}{g.description && <div className="text-xs text-slate-500">{g.description}</div>}</td>
              <td className="text-sm">{g.members} {g.names && <span className="text-slate-500">– {g.names}</span>}</td>
              <td>{g.active_flag === 'Y' ? <Badge color="green">Yes</Badge> : <Badge>No</Badge>}</td>
              <td className="whitespace-nowrap"><div className="flex gap-1"><Link className="btn btn-sm" href={`?edit=${g.id}#form`}>Edit</Link>
                {write && <form action={deleteGroup.bind(null, String(g.id))}><Back to="/config/user-groups" /><ConfirmButton className="btn btn-sm btn-danger" message={`Delete the user group ${g.name}?`}>Delete</ConfirmButton></form>}</div></td>
            </tr>
          ))}</tbody>
        </table>
        {!groups.length && <Empty>No user groups yet.</Empty>}
      </div>
      {write && (
        <form id="form" key={editing?.id ?? 'new'} action={saveGroup.bind(null, editing ? String(editing.id) : null)} className="card space-y-3">
          <Back to="/config/user-groups" />
          <h2 className="h2">{editing ? `Edit: ${editing.name}` : 'New User Group'}</h2>
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="Code *">{editing ? <input value={editing.code} disabled className="input" /> : <input name="code" required className="input uppercase" />}</Field>
            <Field label="Name *"><input name="name" defaultValue={editing?.name ?? ''} required className="input" /></Field>
            <Field label="Active"><select name="active_flag" defaultValue={editing?.active_flag ?? 'Y'} className="input"><option value="Y">Yes</option><option value="N">No</option></select></Field>
            <Field label="Description"><input name="description" defaultValue={editing?.description ?? ''} className="input" /></Field>
          </div>
          <Field label="Members"><MultiPick name="members" options={users} initial={memberIds} emptyText="No members yet" /></Field>
          <div className="flex gap-2"><button className="btn btn-primary">{editing ? 'Save' : 'Create'}</button>{editing && <Link href="/config/user-groups" className="btn">Cancel</Link>}</div>
        </form>
      )}
    </div>
  );
}
