import type { Entity } from '@/lib/entities';
import { lookupOptions } from '@/lib/lookups';
import { refOptions } from '@/lib/dt';
import { Field, Select } from './ui';
import { Cascade } from './client';

/** Renders the configurable fields of a registry entity. */
export async function EntityFields({ e, values, asOf, enterpriseId }: { e: Entity; values: Record<string, any>; asOf: string; enterpriseId: string }) {
  const yesNo = await lookupOptions('YES_NO', asOf);
  const opts: Record<string, Awaited<ReturnType<typeof lookupOptions>>> = {};
  for (const f of e.fields) {
    if (f.type === 'lookup') opts[f.name] = await lookupOptions(f.lookup!, asOf);
    if (f.type === 'ref') opts[f.name] = (await refOptions(f.ref!, enterpriseId, asOf)).filter((o) => !(f.ref === e.key && o.value === String(values.id)));
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
            input = <Select name={f.name} options={opts[f.name]} value={val} required={f.required} />;
            break;
          case 'yesno':
            input = <Select name={f.name} options={yesNo} value={val || 'Y'} empty={false} />;
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
          default:
            input = <input name={f.name} defaultValue={val} required={f.required} className="input" />;
        }
        return (
          <Field key={f.name} label={f.label + (f.required ? ' *' : '')} help={f.help}>
            {input}
            {f.parentField && <Cascade parent={f.parentField} child={f.name} />}
          </Field>
        );
      })}
    </>
  );
}
