import { sql } from '@/lib/db';
import { lookupOptions } from '@/lib/lookups';
import { Field, Select } from '../ui';
import { IdTypeSelect, type EmployerWatch } from '../IdTypeSelect';

/**
 * Identification document inputs named <prefix>_type, _number, _country, _issue, _expiry.
 * The types offered follow the legal employer's country: `employerCountry` (profile)
 * or `watch` (hire page: follows the chosen legal employer / branch).
 */
export async function IdentificationFields({ prefix, asOf, required, value = {}, employerCountry, watch }: {
  prefix: string; asOf: string; required?: boolean; value?: Record<string, any>; employerCountry?: string | null; watch?: EmployerWatch;
}) {
  const types = (await sql`select lookup_code, meaning, tag from lookup_value where lookup_type = 'IDENTIFICATION_TYPE' and enabled_flag = 'Y'
    and ${asOf}::date between start_date and end_date order by display_seq, meaning`).map((r) => ({ value: r.lookup_code as string, label: r.meaning as string, rule: r.tag as string | null }));
  const countries = await lookupOptions('COUNTRY', asOf);
  const names = Object.fromEntries(countries.map((c) => [c.value, c.label]));
  return (
    <>
      <Field label={`Identification Type${required ? ' *' : ''}`}>
        <IdTypeSelect name={`${prefix}_type`} options={types} value={value.id_type_code} required={required} fixedCountry={employerCountry} watch={watch} countryNames={names} />
      </Field>
      <Field label={`Identification Number${required ? ' *' : ''}`}><input name={`${prefix}_number`} defaultValue={value.id_number ?? ''} required={required} className="input uppercase" autoComplete="off" /></Field>
      <Field label="Issuing Country"><Select name={`${prefix}_country`} options={countries} value={value.issuing_country_code ?? (value.id ? null : employerCountry ?? 'IN')} /></Field>
      <Field label="Issue Date"><input type="date" name={`${prefix}_issue`} defaultValue={value.issue_date ?? ''} className="input" /></Field>
      <Field label="Expiry Date"><input type="date" name={`${prefix}_expiry`} defaultValue={value.expiry_date ?? ''} className="input" /></Field>
    </>
  );
}

/** Legal employer → country and business unit → country maps (as of a date) for the hire page. */
export async function employerWatch(enterpriseId: string, asOf: string, withLe: boolean): Promise<EmployerWatch> {
  const les = await sql`select b.id, f.country_code from legal_employer b
    join lateral (select * from legal_employer_f x where x.id = b.id order by (${asOf}::date between x.effective_start_date and x.effective_end_date) desc, x.effective_start_date desc limit 1) f on true
    where b.enterprise_id = ${enterpriseId}`;
  const leCountry = Object.fromEntries(les.map((r) => [String(r.id), r.country_code ?? '']));
  const bus = await sql`select b.id, f.legal_employer_id from business_unit b
    join lateral (select * from business_unit_f x where x.id = b.id order by (${asOf}::date between x.effective_start_date and x.effective_end_date) desc, x.effective_start_date desc limit 1) f on true
    where b.enterprise_id = ${enterpriseId}`;
  const buCountry = Object.fromEntries(bus.map((r) => [String(r.id), leCountry[String(r.legal_employer_id)] ?? '']));
  return { leField: withLe ? 'legal_employer_id' : undefined, buField: 'business_unit_id', leCountry, buCountry };
}
