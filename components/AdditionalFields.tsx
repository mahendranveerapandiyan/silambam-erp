import { activeFields } from '@/lib/fields';
import { datedLookupOptions } from '@/lib/dt';
import { Field } from './ui';
import { DatedSelect } from './DatedSelect';

/** Inputs for the user-defined fields of a page (context). Values come from `attributes`. */
export async function AdditionalFields({ enterpriseId, context, attributes = {}, dateField }: { enterpriseId: string; context: string; attributes?: Record<string, any>; dateField: string }) {
  const fields = await activeFields(enterpriseId, context);
  if (!fields.length) return null;
  const out = [];
  for (const f of fields) {
    const v = attributes?.[f.field_code];
    const val = v === null || v === undefined ? '' : String(v);
    const req = f.required_flag === 'Y';
    let input;
    if (f.data_type === 'LOOKUP' && f.lookup_type) input = <DatedSelect name={`af_${f.field_code}`} options={await datedLookupOptions(f.lookup_type)} dateField={dateField} value={val} required={req} />;
    else if (f.data_type === 'YESNO') input = <select name={`af_${f.field_code}`} defaultValue={val} required={req} className="input"><option value="">—</option><option value="Y">Yes</option><option value="N">No</option></select>;
    else if (f.data_type === 'NUMBER') input = <input type="number" step="any" name={`af_${f.field_code}`} defaultValue={val} required={req} className="input" />;
    else if (f.data_type === 'DATE') input = <input type="date" name={`af_${f.field_code}`} defaultValue={val} required={req} className="input" />;
    else input = <input name={`af_${f.field_code}`} defaultValue={val} required={req} className="input" />;
    out.push(<Field key={f.field_code} label={`${f.label}${req ? ' *' : ''}`} help={f.help_text ?? undefined}>{input}</Field>);
  }
  return <>{out}</>;
}
