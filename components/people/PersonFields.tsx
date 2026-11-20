import { lookupOptions } from '@/lib/lookups';
import { Field, Select } from '../ui';
import { Cascade } from '../client';
import type { Row } from '@/lib/db';

export async function PersonFields({ p = {}, asOf }: { p?: Row; asOf: string }) {
  const L = async (t: string) => lookupOptions(t, asOf);
  const [titles, genders, blood, marital, nat, rel, tongue, countries, states] = await Promise.all(
    ['TITLE', 'GENDER', 'BLOOD_GROUP', 'MARITAL_STATUS', 'NATIONALITY', 'RELIGION', 'MOTHER_TONGUE', 'COUNTRY', 'STATE'].map(L),
  );
  return (
    <>
      <Field label="Title"><Select name="title_code" options={titles} value={p.title_code} /></Field>
      <Field label="First Name *"><input name="first_name" defaultValue={p.first_name ?? ''} required className="input" /></Field>
      <Field label="Middle Name"><input name="middle_name" defaultValue={p.middle_name ?? ''} className="input" /></Field>
      <Field label="Last Name / Initial"><input name="last_name" defaultValue={p.last_name ?? ''} className="input" /></Field>
      <Field label="Known As"><input name="known_as" defaultValue={p.known_as ?? ''} className="input" /></Field>
      <Field label="Date of Birth"><input type="date" name="date_of_birth" defaultValue={p.date_of_birth ?? ''} className="input" /></Field>
      <Field label="Gender"><Select name="gender_code" options={genders} value={p.gender_code} /></Field>
      <Field label="Blood Group"><Select name="blood_group_code" options={blood} value={p.blood_group_code} /></Field>
      <Field label="Marital Status"><Select name="marital_status_code" options={marital} value={p.marital_status_code} /></Field>
      <Field label="Nationality"><Select name="nationality_code" options={nat} value={p.nationality_code ?? 'IN'} /></Field>
      <Field label="Religion"><Select name="religion_code" options={rel} value={p.religion_code} /></Field>
      <Field label="Mother Tongue"><Select name="mother_tongue_code" options={tongue} value={p.mother_tongue_code} /></Field>
      <Field label="Mobile"><input name="phone" type="tel" defaultValue={p.phone ?? ''} className="input" /></Field>
      <Field label="Alternate Phone"><input name="alt_phone" type="tel" defaultValue={p.alt_phone ?? ''} className="input" /></Field>
      <Field label="Email"><input name="email" type="email" defaultValue={p.email ?? ''} className="input" /></Field>
      <Field label="Address Line 1"><input name="address_line1" defaultValue={p.address_line1 ?? ''} className="input" /></Field>
      <Field label="Address Line 2"><input name="address_line2" defaultValue={p.address_line2 ?? ''} className="input" /></Field>
      <Field label="City"><input name="city" defaultValue={p.city ?? ''} className="input" /></Field>
      <Field label="Country"><Select name="country_code" options={countries} value={p.country_code ?? 'IN'} /></Field>
      <Field label="State"><Select name="state_code" options={states} value={p.state_code ?? (p.id ? null : 'IN-TN')} /><Cascade parent="country_code" child="state_code" /></Field>
      <Field label="Postal Code"><input name="postal_code" defaultValue={p.postal_code ?? ''} className="input" /></Field>
      <Field label="Emergency Contact Name"><input name="emergency_contact_name" defaultValue={p.emergency_contact_name ?? ''} className="input" /></Field>
      <Field label="Emergency Contact Phone"><input name="emergency_contact_phone" defaultValue={p.emergency_contact_phone ?? ''} className="input" /></Field>
      <Field label="Medical Notes / Allergies"><input name="medical_notes" defaultValue={p.medical_notes ?? ''} className="input" /></Field>
    </>
  );
}
