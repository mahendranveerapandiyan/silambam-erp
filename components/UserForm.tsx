import { Field, Back } from './ui';
import type { Row } from '@/lib/db';

const ROLES: [string, string][] = [['ADMIN', 'Administrator – full access'], ['INCHARGE', 'Class Incharge – own classes only'], ['STAFF', 'Staff – own profile & attendance'], ['ACCOUNTANT', 'Accountant – fees, inventory, finance'], ['PARENT', 'Parent – portal for linked students'], ['STUDENT', 'Student – own portal']];

export function UserForm({ action, user, roles = [], students = [], back }: { action: (fd: FormData) => Promise<void>; user?: Row; roles?: string[]; students?: Row[]; back: string }) {
  return (
    <form action={action} className="card">
      <Back to={back} />
      <div className="grid-form">
        <Field label="Username *"><input name="username" defaultValue={user?.username} disabled={!!user} required className="input lowercase" /></Field>
        <Field label="Display Name *"><input name="display_name" defaultValue={user?.display_name} required className="input" /></Field>
        <Field label={user ? 'Reset Password (leave blank to keep)' : 'Temporary Password *'} help="User must change it at next login"><input name="password" type="password" required={!user} className="input" autoComplete="new-password" /></Field>
        <Field label="Linked Person (staff / student number)" help="Staff: their staff number. Student login: their student number."><input name="person_number" defaultValue={user?.linked_number ?? ''} className="input" /></Field>
        {user && <Field label="Active"><select name="active_flag" defaultValue={user.active_flag} className="input"><option value="Y">Yes</option><option value="N">No</option></select></Field>}
      </div>
      <div className="mt-4">
        <span className="label">Roles *</span>
        <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
          {ROLES.map(([r, l]) => <label key={r} className="flex items-center gap-2 text-sm"><input type="checkbox" name="roles" value={r} defaultChecked={roles.includes(r)} /> {l}</label>)}
        </div>
      </div>
      <div className="mt-4">
        <span className="label">Parent access – students this login can view</span>
        <div className="mb-2 flex flex-wrap gap-3">
          {students.map((s) => <label key={s.person_id} className="flex items-center gap-1 text-sm"><input type="checkbox" name="students" value={s.person_id} defaultChecked /> {s.label}</label>)}
        </div>
        <input name="add_students" placeholder="Add student numbers, comma separated" className="input max-w-md" />
      </div>
      <button className="btn btn-primary mt-4">{user ? 'Save' : 'Create User'}</button>
    </form>
  );
}
