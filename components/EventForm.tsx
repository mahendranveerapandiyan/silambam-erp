import type { Row } from '@/lib/db';
import type { Opt } from '@/lib/lookups';
import { Field, Select, Back } from './ui';
import { EditableForm } from './EditMode';

export function EventForm({ action, ev = {}, back, o }: { action: (fd: FormData) => Promise<void>; ev?: Row; back: string; o: Record<string, Opt[]> }) {
  return (
    <EditableForm action={action} canEdit startEditing={!ev.id} saveLabel={ev.id ? 'Save' : 'Create Event'}>
      <Back to={back} />
      <div className="grid-form">
        <Field label="Name *"><input name="name" defaultValue={ev.name} className="input" required /></Field>
        <Field label="Type *"><Select name="event_type_code" options={o.types} value={ev.event_type_code} required /></Field>
        <Field label="Branch"><Select name="business_unit_id" options={o.bus} value={ev.business_unit_id} empty="All branches" /></Field>
        <Field label="Start Date *"><input type="date" name="start_date" defaultValue={ev.start_date} className="input" required /></Field>
        <Field label="End Date"><input type="date" name="end_date" defaultValue={ev.end_date} className="input" /></Field>
        <Field label="Venue"><input name="venue" defaultValue={ev.venue ?? ''} className="input" /></Field>
        <Field label="Participation Fee" help="0 = free. A fee line is added for each assigned student."><input name="fee_amount" type="number" step="0.01" min="0" defaultValue={ev.fee_amount ?? 0} className="input" /></Field>
        <Field label="Status"><Select name="status_code" options={o.statuses} value={ev.status_code ?? 'PLANNED'} empty={false} /></Field>
        <Field label="Description" className="sm:col-span-2 lg:col-span-3"><textarea name="description" defaultValue={ev.description ?? ''} rows={2} className="input" /></Field>
      </div>
    </EditableForm>
  );
}
