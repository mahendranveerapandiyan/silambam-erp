import { requireUser, requirePriv, can, canAny, type SessionUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import { getAsOf } from '@/lib/asof';
import { lookupOptions } from '@/lib/lookups';
import { PageHeader, Flash, Field, Select, type SP } from '@/components/ui';
import { saveEnterprise } from '../actions';

export default async function EnterprisePage({ searchParams }: { searchParams: SP }) {
  const u = await requirePriv('CD_ENTERPRISE_PRV');
  const asOf = await getAsOf();
  const [e] = await sql`select *, logo_data is not null has_logo from enterprise where id = ${u.enterpriseId}`;
  const [countries, currencies, zones] = [await lookupOptions('COUNTRY', asOf), await lookupOptions('CURRENCY', asOf), await lookupOptions('TIMEZONE', asOf)];
  const locked = e.code_locked_flag === 'Y';
  return (
    <div className="max-w-4xl">
      <PageHeader title="Enterprise" subtitle="Top of the enterprise structure: Enterprise → Division → Legal Employer → Business Unit → Class → Section. Academic years are defined at this level." />
      <Flash sp={await searchParams} />
      <form action={saveEnterprise} className="card">
        <div className="grid-form">
          <Field label={locked ? 'Code (locked)' : 'Code *'} help={locked ? 'Cannot be changed once saved' : 'Locked after you save'}>
            {locked ? <input value={e.code} disabled className="input" /> : <input name="code" defaultValue={e.code} required pattern="[A-Za-z0-9_-]{2,20}" className="input uppercase" />}
          </Field>
          <Field label="Name *"><input name="name" defaultValue={e.name} required className="input" /></Field>
          <Field label="Short Name (shown in header)"><input name="short_name" defaultValue={e.short_name ?? ''} className="input" /></Field>
          <Field label="Registration Number"><input name="registration_number" defaultValue={e.registration_number ?? ''} className="input" /></Field>
          <Field label="Tax Number (GST / PAN)"><input name="tax_number" defaultValue={e.tax_number ?? ''} className="input" /></Field>
          <Field label="Country"><Select name="country_code" options={countries} value={e.country_code} /></Field>
          <Field label="Default Currency"><Select name="currency_code" options={currencies} value={e.currency_code} /></Field>
          <Field label="Time Zone"><Select name="timezone" options={zones} value={e.timezone} empty={false} /></Field>
          <Field label="Phone"><input name="phone" defaultValue={e.phone ?? ''} className="input" /></Field>
          <Field label="Email"><input name="email" defaultValue={e.email ?? ''} className="input" /></Field>
          <Field label="Website"><input name="website" defaultValue={e.website ?? ''} className="input" /></Field>
          <Field label="Address" className="sm:col-span-2 lg:col-span-3"><textarea name="address" defaultValue={e.address ?? ''} className="input" rows={2} /></Field>
          <Field label="Logo (PNG/JPG, max 2 MB)"><input type="file" name="logo" accept="image/*" className="input" /></Field>
          {e.has_logo && (
            <div className="flex items-end gap-3"><img src="/api/logo" alt="logo" className="h-14 rounded border bg-white p-1" />
              <label className="flex items-center gap-1 text-sm"><input type="checkbox" name="remove_logo" value="Y" /> Remove logo</label></div>
          )}
        </div>
        <button className="btn btn-primary mt-4">Save</button>
      </form>
    </div>
  );
}
