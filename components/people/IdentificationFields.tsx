import { lookupOptions } from '@/lib/lookups';
import { Field, Select } from '../ui';

/** Identification document inputs named <prefix>_type, _number, _country, _issue, _expiry. */
export async function IdentificationFields({ prefix, asOf, required, value = {} }: { prefix: string; asOf: string; required?: boolean; value?: Record<string, any> }) {
  const [types, countries] = [await lookupOptions('IDENTIFICATION_TYPE', asOf), await lookupOptions('COUNTRY', asOf)];
  return (
    <>
      <Field label={`Identification Type${required ? ' *' : ''}`}><Select name={`${prefix}_type`} options={types} value={value.id_type_code} required={required} /></Field>
      <Field label={`Identification Number${required ? ' *' : ''}`}><input name={`${prefix}_number`} defaultValue={value.id_number ?? ''} required={required} className="input uppercase" autoComplete="off" /></Field>
      <Field label="Issuing Country"><Select name={`${prefix}_country`} options={countries} value={value.issuing_country_code ?? (value.id ? null : 'IN')} /></Field>
      <Field label="Issue Date"><input type="date" name={`${prefix}_issue`} defaultValue={value.issue_date ?? ''} className="input" /></Field>
      <Field label="Expiry Date"><input type="date" name={`${prefix}_expiry`} defaultValue={value.expiry_date ?? ''} className="input" /></Field>
    </>
  );
}
