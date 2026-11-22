import { requirePriv, can } from '@/lib/auth';
import { getAsOf } from '@/lib/asof';
import { lookupOptions } from '@/lib/lookups';
import { userNameRule, nameUsername } from '@/lib/usernames';
import { EditableForm } from '@/components/EditMode';
import { ShowFor } from '@/components/client';
import { PageHeader, Flash, Field, Select, type SP } from '@/components/ui';
import { saveUserNameRule } from '../actions';

export default async function UserNameRules({ searchParams }: { searchParams: SP }) {
  const u = await requirePriv('CD_USER_NAME_RULE_PRV');
  const write = can(u, 'CD_USER_NAME_RULE_PRV', 'WRITE');
  const asOf = await getAsOf();
  const methods = await lookupOptions('USER_NAME_METHOD', asOf);
  const staffMethods = methods.filter((m) => ['STAFF_NUMBER', 'FIRST_LAST', 'EMAIL'].includes(m.value));
  const staff = await userNameRule(u.enterpriseId, 'STAFF');
  const seps = [{ value: '.', label: 'Dot – ravi.kumar' }, { value: '_', label: 'Underscore – ravi_kumar' }, { value: '-', label: 'Hyphen – ravi-kumar' }, { value: '', label: 'None – ravikumar' }];
  const example: Record<string, string> = {
    STAFF_NUMBER: 'EMP-0013', FIRST_LAST: nameUsername('Ravi', 'Kumar', staff.separator), EMAIL: 'ravi.kumar@example.com',
  };
  return (
    <div className="max-w-4xl">
      <PageHeader title="User Name Rules" subtitle="How the user name of a new login is formed. It is filled in automatically when a login is created for a staff member or student." />
      <Flash sp={await searchParams} />
      <div className="space-y-4">
        <EditableForm action={saveUserNameRule} canEdit={write}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="h2 mb-0">Staff</h2>
            <div className="text-sm">Example: <code className="rounded bg-sky-50 px-2 py-0.5 font-semibold text-sky-800">{example[staff.method_code] ?? '—'}</code></div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="User Name From *" help="Staff number, first + last name, or the staff member's email id">
              <Select name="method_code" options={staffMethods} value={staff.method_code} empty={false} />
            </Field>
            <div data-show-for-method_code="FIRST_LAST">
              <Field label="Separator between first and last name" help="If the name is already used, a number is added: ravi.kumar2">
                <Select name="separator" options={seps} value={staff.separator} empty={false} />
              </Field>
            </div>
          </div>
          <ShowFor select="method_code" />
          <ul className="muted mt-3 list-disc space-y-0.5 pl-5">
            <li><b>Staff Number</b> – the number from Number Generation, e.g. EMP-0013.</li>
            <li><b>First and Last Name</b> – lower case letters and digits only; duplicates get a number added.</li>
            <li><b>Email ID</b> – the email on the staff member&apos;s personal details; it must be filled in to create the login.</li>
          </ul>
        </EditableForm>
        <div className="card">
          <h2 className="h2">Students</h2>
          <p className="text-sm">User name = <b>student number</b> (e.g. STU-BR1-2026-0017). Fixed – not configurable.</p>
        </div>
        <div className="card">
          <h2 className="h2">Parents</h2>
          <p className="text-sm">User name and login are <b>created manually</b> – typed on the admission form or under Configuration › Users (e.g. the parent&apos;s mobile number).</p>
        </div>
      </div>
    </div>
  );
}
