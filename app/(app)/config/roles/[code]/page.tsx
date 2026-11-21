import Link from 'next/link';
import { EditableForm, EditScope } from '@/components/EditMode';
import { notFound } from 'next/navigation';
import { requirePriv, can } from '@/lib/auth';
import { sql } from '@/lib/db';
import { PageHeader, Flash, Field, Back, Badge, type SP } from '@/components/ui';
import { ConfirmButton } from '@/components/client';
import { saveRole, deleteRole } from '../../actions';

const LEVELS = [['NONE', 'None'], ['VIEW', 'View only'], ['WRITE', 'Read & Write']] as const;

export default async function RolePage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: SP }) {
  const u = await requirePriv('CD_ROLE_PRV', 'READ');
  const { code } = await params;
  const [role] = await sql`select * from app_role where code = ${code}`;
  if (!role) notFound();
  const privs = await sql`
    select p.*, rp.can_view, rp.can_read, rp.can_write from privilege p
    left join role_privilege rp on rp.privilege_code = p.code and rp.role_code = ${code}
    order by p.display_seq`;
  const users = await sql`select ua.id, ua.username, ua.display_name from user_role ur join user_account ua on ua.id = ur.user_id where ur.role_code = ${code} order by ua.username`;
  const modules = [...new Set(privs.map((p) => p.module as string))];
  const level = (p: any) => (p.can_write === 'Y' ? 'WRITE' : p.can_view === 'Y' ? 'VIEW' : 'NONE');
  const admin = code === 'ADMIN';
  const editable = can(u, 'CD_ROLE_PRV', 'WRITE') && !admin;
  const back = `/config/roles/${code}`;
  return (
    <div className="max-w-6xl">
      <PageHeader title={`Role: ${role.name}`} subtitle={<><span className="font-mono">{code}</span> {role.system_flag === 'Y' && <Badge color="gray">built-in</Badge>} · {users.length} user(s)</>}
        actions={<Link href="/config/roles" className="btn">All roles</Link>} />
      <Flash sp={await searchParams} />
      <EditableForm action={saveRole.bind(null, code)} canEdit={can(u, 'CD_ROLE_PRV', 'WRITE')} className="space-y-4" saveLabel="Save Role">
        <Back to={back} />
        <div className="card grid gap-3 sm:grid-cols-4">
          <Field label="Role Name *"><input name="name" defaultValue={role.name} className="input" required disabled={!can(u, 'CD_ROLE_PRV', 'WRITE')} /></Field>
          <Field label="Description" className="sm:col-span-2"><input name="description" defaultValue={role.description ?? ''} className="input" disabled={!can(u, 'CD_ROLE_PRV', 'WRITE')} /></Field>
          <Field label="Active"><select name="active_flag" defaultValue={role.active_flag} className="input" disabled={admin || !can(u, 'CD_ROLE_PRV', 'WRITE')}><option value="Y">Yes</option><option value="N">No</option></select></Field>
        </div>
        <div className="card">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="h2 mb-0">Privileges</h2>
            <span className="text-xs text-gray-500"><b>View only</b> = see the task, lists and records (no changes) · <b>Read &amp; Write</b> = also create, edit and delete</span>
          </div>
          {admin && <p className="mb-3 rounded bg-amber-50 p-2 text-sm">The Administrator role always has every privilege with Write access, so you can never lock yourself out.</p>}
          {modules.map((m) => (
            <div key={m} className="mb-4">
              <div className="mb-1 text-xs font-bold uppercase tracking-wider text-gray-500">{m}</div>
              <div className="divide-y divide-black/5 rounded border border-black/10">
                {privs.filter((p) => p.module === m).map((p) => (
                  <div key={p.code} className="grid items-center gap-2 px-3 py-1.5 sm:grid-cols-[1fr_auto]">
                    <div><div className="text-sm">{p.name}</div><div className="font-mono text-[11px] text-gray-500">{p.code}</div></div>
                    <div className="flex gap-1">
                      {LEVELS.map(([v, l]) => (
                        <label key={v} className="cursor-pointer">
                          <input type="radio" name={`p_${p.code}`} value={v} defaultChecked={level(p) === v} disabled={!editable} className="peer sr-only" />
                          <span className="inline-block rounded border border-black/15 px-2 py-0.5 text-xs peer-checked:border-transparent peer-checked:bg-[var(--primary-color)] peer-checked:text-white peer-disabled:opacity-60">{l}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </EditableForm>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="card">
          <h2 className="h2">Users with this role</h2>
          {users.map((x) => <div key={x.id} className="text-sm"><Link className="link" href={`/config/users/${x.id}`}>{x.username}</Link> – {x.display_name}</div>)}
          {!users.length && <p className="muted">No users yet. Assign roles from Configuration › Users.</p>}
        </div>
        {can(u, 'CD_ROLE_PRV', 'WRITE') && role.system_flag !== 'Y' && (
          <form action={deleteRole.bind(null, code)} className="card">
            <Back to={back} />
            <h2 className="h2">Delete Role</h2>
            <p className="muted mb-2">Only possible when no user has this role.</p>
            <ConfirmButton className="btn btn-danger" message={`Delete role ${code}?`}>Delete</ConfirmButton>
          </form>
        )}
      </div>
    </div>
  );
}
