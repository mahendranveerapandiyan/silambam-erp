import 'server-only';
import { sql, type Row } from './db';
import { ENTITIES } from './entities';

export type AdditionalField = { field_code: string; label: string; data_type: string; lookup_type: string | null; required_flag: string; help_text: string | null };

/** Pages that can carry additional fields. */
export function fieldContexts() {
  return [
    { value: 'STUDENT', label: 'Students – personal details' },
    { value: 'STAFF', label: 'Staff – personal details' },
    ...Object.values(ENTITIES).map((e) => ({ value: `setup:${e.key}`, label: `${e.group} › ${e.plural}` })),
  ];
}

export async function activeFields(enterpriseId: string, context: string): Promise<AdditionalField[]> {
  return (await sql`select field_code, label, data_type, lookup_type, required_flag, help_text from additional_field
    where enterprise_id = ${enterpriseId} and context_code = ${context} and active_flag = 'Y' order by display_seq, label`) as unknown as AdditionalField[];
}

/** Validate submitted additional field values (inputs named af_<code>) into a JSON object. */
export async function parseAttributes(enterpriseId: string, context: string, fd: FormData, existing: Row = {}) {
  const fields = await activeFields(enterpriseId, context);
  const out: Record<string, unknown> = { ...existing };
  for (const f of fields) {
    const raw = fd.get(`af_${f.field_code}`);
    const v = typeof raw === 'string' ? raw.trim() : '';
    if (!v) {
      if (f.required_flag === 'Y') throw new Error(`${f.label} is required`);
      delete out[f.field_code];
      continue;
    }
    switch (f.data_type) {
      case 'NUMBER':
        if (Number.isNaN(Number(v))) throw new Error(`${f.label} must be a number`);
        out[f.field_code] = Number(v);
        break;
      case 'DATE':
        if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error(`${f.label} must be a date`);
        out[f.field_code] = v;
        break;
      case 'YESNO':
        out[f.field_code] = v === 'Y' ? 'Y' : 'N';
        break;
      case 'LOOKUP': {
        const [ok] = await sql`select 1 from lookup_value where lookup_type = ${f.lookup_type} and lookup_code = ${v} and enabled_flag = 'Y'`;
        if (!ok) throw new Error(`${f.label}: choose a value from the list`);
        out[f.field_code] = v;
        break;
      }
      default:
        out[f.field_code] = v.slice(0, 1000);
    }
  }
  return out;
}

/** Display value of an additional field. */
export async function fieldDisplay(fields: AdditionalField[]) {
  const types = fields.filter((f) => f.data_type === 'LOOKUP' && f.lookup_type).map((f) => f.lookup_type!);
  const meanings = types.length ? await sql`select lookup_type, lookup_code, meaning from lookup_value where lookup_type in ${sql(types)}` : [];
  const m = new Map(meanings.map((r) => [`${r.lookup_type}|${r.lookup_code}`, r.meaning as string]));
  return (f: AdditionalField, v: unknown) => {
    if (v === null || v === undefined || v === '') return '';
    if (f.data_type === 'LOOKUP') return m.get(`${f.lookup_type}|${v}`) ?? String(v);
    if (f.data_type === 'YESNO') return v === 'Y' ? 'Yes' : 'No';
    return String(v);
  };
}
