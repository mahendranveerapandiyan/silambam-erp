import type { Entity } from '@/lib/entities';
import { datedLookupOptions, datedRefOptions, type DatedOpt } from '@/lib/dt';
import { Field } from './ui';
import { DatedSelect } from './DatedSelect';
import { AdditionalFields } from './AdditionalFields';
import { ShowFor } from './client';

/**
 * Renders the configurable fields of a registry entity. Lookup and reference
 * drop-downs are date-aware: they follow the date input named `dateField`, so
 * only values effective on that date are offered, with their names on that date.
 */
export async function EntityFields({ e, values, enterpriseId, dateField }: { e: Entity; values: Record<string, any>; asOf?: string; enterpriseId: string; dateField: string }) {
  const yesNo = await datedLookupOptions('YES_NO');
  const opts: Record<string, DatedOpt[]> = {};
  for (const f of e.fields) {
    if (f.type === 'lookup' || f.type === 'multilookup') opts[f.name] = await datedLookupOptions(f.lookup!);
    if (f.type === 'ref') opts[f.name] = (await datedRefOptions(f.ref!, enterpriseId)).filter((o) => !(f.ref === e.key && o.value === String(values.id)));
  }
  return (
    <>
      {e.fields.map((f) => {
        const v = values[f.name] ?? (values.id ? null : f.default ?? null);
        const val = v === null || v === undefined ? '' : String(v);
        let input;
        switch (f.type) {
          case 'lookup':
          case 'ref':
            input = <DatedSelect name={f.name} options={opts[f.name]} dateField={dateField} value={val} required={f.required} parentField={f.parentField} />;
            break;
          case 'multilookup': {
            const chosen = new Set(val.split(',').filter(Boolean));
            input = (
              <div className="flex flex-wrap gap-x-3 gap-y-1 rounded-md border border-black/20 bg-white px-2.5 py-1.5">
                {opts[f.name].map((o) => (
                  <label key={o.value} className="flex items-center gap-1 text-sm">
                    <input type="checkbox" name={f.name} value={o.value} defaultChecked={chosen.has(o.value)} /> {o.label}
                  </label>
                ))}
              </div>
            );
            break;
          }
          case 'yesno':
            input = <DatedSelect name={f.name} options={yesNo} dateField={dateField} value={val || 'Y'} empty={false} />;
            break;
          case 'textarea':
            input = <textarea name={f.name} defaultValue={val} className="input" rows={3} />;
            break;
          case 'color':
            input = <input type="color" name={f.name} defaultValue={val || '#888888'} className="h-9 w-20 rounded border" />;
            break;
          case 'number':
            input = <input type="number" step="any" name={f.name} defaultValue={val} required={f.required} className="input" />;
            break;
          case 'time':
            input = <input type="time" name={f.name} defaultValue={val.slice(0, 5)} required={f.required} className="input" />;
            break;
          default:
            input = <input name={f.name} defaultValue={val} required={f.required} className="input" />;
        }
        const field = (
          <Field key={f.name} label={f.label + (f.required ? ' *' : '')} help={f.help} className={f.type === 'multilookup' ? 'sm:col-span-2' : ''}>
            {input}
          </Field>
        );
        return f.showWhen
          ? <div key={f.name} {...{ [`data-show-for-${f.showWhen.field}`]: f.showWhen.values.join(',') }}>{field}</div>
          : field;
      })}
      {[...new Set(e.fields.filter((f) => f.showWhen).map((f) => f.showWhen!.field))].map((c) => <ShowFor key={c} select={c} />)}
      <AdditionalFields enterpriseId={enterpriseId} context={`setup:${e.key}`} attributes={values.attributes} dateField={dateField} />
    </>
  );
}
