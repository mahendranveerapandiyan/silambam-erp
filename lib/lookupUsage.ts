import 'server-only';
import { sql } from './db';
import { ENTITIES } from './entities';

/**
 * Where lookup codes are stored. `from`/`to` are the columns giving the period
 * a row uses the code (date-tracked rows: effective dates; transactions: their
 * date). Rows without dates count as "in use" but do not limit the dates.
 */
type Use = { type: string; table: string; col: string; label: string; from?: string; to?: string; csv?: boolean; where?: string };

const DT = { from: 'effective_start_date', to: 'effective_end_date' };
const STATIC: Use[] = [
  ...['title_code:TITLE', 'gender_code:GENDER', 'blood_group_code:BLOOD_GROUP', 'marital_status_code:MARITAL_STATUS', 'nationality_code:NATIONALITY',
    'religion_code:RELIGION', 'mother_tongue_code:MOTHER_TONGUE', 'state_code:STATE', 'country_code:COUNTRY']
    .map((x) => ({ type: x.split(':')[1], table: 'person_f', col: x.split(':')[0], label: 'Student / staff personal details', ...DT })),
  ...['action_reason_code:ACTION_REASON', 'fee_frequency_code:FEE_FREQUENCY', 'employment_type_code:EMPLOYMENT_TYPE', 'employment_category_code:EMPLOYMENT_CATEGORY', 'payroll_status_code:PAYROLL_STATUS', 'competition_category_code:COMPETITION_CATEGORY']
    .map((x) => ({ type: x.split(':')[1], table: 'assignment_f', col: x.split(':')[0], label: 'Student / staff assignments', ...DT })),
  { type: 'RELATIONSHIP', table: 'person_contact', col: 'relationship_code', label: 'Parents / contacts' },
  { type: 'COUNTRY', table: 'enterprise', col: 'country_code', label: 'Enterprise' },
  { type: 'CURRENCY', table: 'enterprise', col: 'currency_code', label: 'Enterprise' },
  { type: 'TIMEZONE', table: 'enterprise', col: 'timezone', label: 'Enterprise' },
  { type: 'ACADEMIC_YEAR_STATUS', table: 'academic_year', col: 'status_code', label: 'Academic years', from: 'start_date', to: 'end_date' },
  { type: 'ATTENDANCE_STATUS', table: 'student_attendance', col: 'status_code', label: 'Student attendance', from: 'attendance_date', to: 'attendance_date' },
  { type: 'ATTENDANCE_STATUS', table: 'staff_attendance', col: 'status_code', label: 'Staff attendance', from: 'attendance_date', to: 'attendance_date' },
  { type: 'ATTENDANCE_SOURCE', table: 'student_attendance', col: 'source_code', label: 'Student attendance', from: 'attendance_date', to: 'attendance_date' },
  { type: 'ATTENDANCE_SOURCE', table: 'staff_attendance', col: 'source_code', label: 'Staff attendance', from: 'attendance_date', to: 'attendance_date' },
  { type: 'FEE_TYPE', table: 'fee_structure', col: 'fee_type_code', label: 'Fee structures' },
  { type: 'FEE_TYPE', table: 'fee_demand', col: 'fee_type_code', label: 'Fee lines', from: 'due_date', to: 'due_date' },
  { type: 'FEE_FREQUENCY', table: 'fee_structure_amount', col: 'frequency_code', label: 'Fee structure amounts' },
  { type: 'FEE_FREQUENCY', table: 'fee_demand', col: 'frequency_code', label: 'Fee lines', from: 'due_date', to: 'due_date' },
  { type: 'PAYMENT_MODE', table: 'fee_payment', col: 'payment_mode_code', label: 'Fee payments', from: 'payment_date', to: 'payment_date' },
  { type: 'PAYMENT_MODE', table: 'finance_txn', col: 'payment_mode_code', label: 'Income / expenses', from: 'txn_date', to: 'txn_date' },
  { type: 'EXEMPTION_REASON', table: 'fee_exemption', col: 'reason_code', label: 'Fee exceptions' },
  { type: 'EXAM_TYPE', table: 'exam', col: 'exam_type_code', label: 'Exams', from: 'exam_date', to: 'exam_date' },
  { type: 'EXAM_TYPE', table: 'exam_fee', col: 'exam_type_code', label: 'Exam fees' },
  { type: 'EXAM_STATUS', table: 'exam', col: 'status_code', label: 'Exams', from: 'exam_date', to: 'exam_date' },
  { type: 'SUBJECT_TYPE', table: 'exam_subject', col: 'subject_type_code', label: 'Exam subjects' },
  { type: 'EXAM_RESULT', table: 'exam_candidate', col: 'result_code', label: 'Exam results' },
  { type: 'EVENT_TYPE', table: 'event', col: 'event_type_code', label: 'Events', from: 'start_date', to: 'end_date' },
  { type: 'EVENT_STATUS', table: 'event', col: 'status_code', label: 'Events', from: 'start_date', to: 'end_date' },
  { type: 'PARTICIPATION', table: 'event_participant', col: 'participation_code', label: 'Event participants' },
  { type: 'ITEM_CATEGORY', table: 'item', col: 'category_code', label: 'Inventory items' },
  { type: 'UOM', table: 'item', col: 'uom_code', label: 'Inventory items' },
  { type: 'STOCK_TXN_TYPE', table: 'stock_txn', col: 'txn_type_code', label: 'Stock transactions', from: 'txn_date', to: 'txn_date' },
  { type: 'INCOME_CATEGORY', table: 'finance_txn', col: 'category_code', label: 'Income entries', from: 'txn_date', to: 'txn_date', where: "txn_kind = 'INCOME'" },
  { type: 'EXPENSE_CATEGORY', table: 'finance_txn', col: 'category_code', label: 'Expense entries', from: 'txn_date', to: 'txn_date', where: "txn_kind = 'EXPENSE'" },
  { type: 'ROLE', table: 'user_role', col: 'role_code', label: 'User roles' },
  { type: 'IDENTIFICATION_TYPE', table: 'person_identifier', col: 'id_type_code', label: 'Identification documents' },
  { type: 'COUNTRY', table: 'person_identifier', col: 'issuing_country_code', label: 'Identification documents' },
];

/** Setup fields that store lookup codes (from the entity registry). */
function entityUses(): Use[] {
  return Object.values(ENTITIES).flatMap((e) =>
    e.fields.filter((f) => (f.type === 'lookup' || f.type === 'multilookup') && f.lookup)
      .map((f) => ({ type: f.lookup!, table: `${e.table}_f`, col: f.name, label: e.plural, csv: f.type === 'multilookup', ...DT })),
  );
}

export type CodeUsage = { count: number; where: Record<string, number>; first: string | null; last: string | null };

/** Usage of every code of a lookup type, in one pass per storing column. */
export async function lookupUsage(type: string): Promise<Map<string, CodeUsage>> {
  const out = new Map<string, CodeUsage>();
  const add = (code: string, label: string, n: number, first: string | null, last: string | null) => {
    const u = out.get(code) ?? { count: 0, where: {}, first: null, last: null };
    u.count += n;
    u.where[label] = (u.where[label] ?? 0) + n;
    if (first && (!u.first || first < u.first)) u.first = first;
    if (last && (!u.last || last > u.last)) u.last = last;
    out.set(code, u);
  };
  for (const x of [...STATIC, ...entityUses()].filter((x) => x.type === type)) {
    const codeExpr = x.csv ? sql`unnest(string_to_array(${sql(x.col)}, ','))` : sql`${sql(x.col)}`;
    const rows = await sql`
      select code, count(*)::int n, min(f)::date first, max(t)::date last from (
        select ${codeExpr} code, ${x.from ? sql`${sql(x.from)}` : sql`null::date`} f, ${x.to ? sql`${sql(x.to)}` : sql`null::date`} t
        from ${sql(x.table)} ${x.where ? sql.unsafe(`where ${x.where}`) : sql``}) z
      where code is not null group by code`;
    for (const r of rows) add(r.code, x.label, r.n, r.first, r.last);
  }
  // additional fields that use this lookup
  const fields = await sql`select context_code, field_code, label from additional_field where lookup_type = ${type}`;
  for (const f of fields) {
    const table = f.context_code === 'STUDENT' || f.context_code === 'STAFF' ? 'person_f' : `${ENTITIES[f.context_code.replace('setup:', '')]?.table}_f`;
    if (table === 'undefined_f') continue;
    const rows = await sql`select attributes->>${f.field_code} code, count(*)::int n, min(effective_start_date) first, max(effective_end_date) last
      from ${sql(table)} where attributes ? ${f.field_code} group by 1`;
    for (const r of rows) add(r.code, `Additional field "${f.label}"`, r.n, r.first, r.last);
  }
  // values of dependent lookups (e.g. States under a Country)
  const kids = await sql`select v.parent_code code, count(*)::int n from lookup_value v join lookup_type t on t.lookup_type = v.lookup_type
    where t.parent_lookup_type = ${type} and v.parent_code is not null group by 1`;
  for (const r of kids) add(r.code, 'Dependent lookup values', r.n, null, null);
  return out;
}

export function describeUsage(u: CodeUsage) {
  return Object.entries(u.where).map(([l, n]) => `${l} (${n})`).join(', ');
}
