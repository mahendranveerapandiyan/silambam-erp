import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { getAsOf } from '@/lib/asof';
import { getEntity } from '@/lib/entities';
import { EntityFields } from '@/components/EntityFields';
import { PageHeader, Flash, Field, Back, type SP } from '@/components/ui';
import { createEntity } from '../../actions';

export default async function NewEntity({ params, searchParams }: { params: Promise<{ entity: string }>; searchParams: SP }) {
  const u = await requireUser('ADMIN');
  const { entity } = await params;
  const e = getEntity(entity);
  if (!e) notFound();
  const asOf = await getAsOf();
  return (
    <div className="max-w-5xl">
      <PageHeader title={`Create ${e.label}`} subtitle={e.description} actions={<Link href={`/setup/${entity}`} className="btn">Back to list</Link>} />
      <Flash sp={await searchParams} />
      <form action={createEntity.bind(null, entity)} className="card">
        <Back to={`/setup/${entity}/new`} />
        <p className="muted mb-3">Choose the effective start date first – drop-downs only offer records that exist on that date.</p>
        <div className="grid-form">
          <Field label="Effective Start Date *"><input type="date" name="effective_start_date" defaultValue={asOf} required className="input" /></Field>
          <Field label="Code *"><input name="code" required className="input uppercase" /></Field>
          <Field label="Name *"><input name="name" required className="input" /></Field>
          <EntityFields e={e} values={{}} enterpriseId={u.enterpriseId} dateField="effective_start_date" />
          <Field label="Description" className="sm:col-span-2 lg:col-span-3"><textarea name="description" className="input" rows={2} /></Field>
        </div>
        <div className="mt-4 flex gap-2"><button className="btn btn-primary">Create</button></div>
      </form>
    </div>
  );
}
