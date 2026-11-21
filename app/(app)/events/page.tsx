import Link from 'next/link';
import { requireUser, requirePriv, can, canAny, type SessionUser } from '@/lib/auth';
import { getAsOf } from '@/lib/asof';
import { sql } from '@/lib/db';
import { refOptions } from '@/lib/dt';
import { lk, lookupOptions } from '@/lib/lookups';
import { fmtDate, money } from '@/lib/util';
import { PageHeader, Flash, Badge, Empty, type SP } from '@/components/ui';
import { EventForm } from '@/components/EventForm';
import { saveEvent } from './actions';

export default async function Events({ searchParams }: { searchParams: SP }) {
  const u = await requirePriv(['CD_EVENT_SETUP_PRV', 'CD_EVENT_PARTICIPANT_PRV']);
  const asOf = await getAsOf();
  const L = await lk();
  const rows = await sql`select e.*, (select count(*) from event_participant p where p.event_id = e.id)::int n,
    (select name from business_unit_f b where b.id = e.business_unit_id order by effective_start_date desc limit 1) bu_name
    from event e where enterprise_id = ${u.enterpriseId} order by start_date desc limit 200`;
  const o = { types: await lookupOptions('EVENT_TYPE', asOf), statuses: await lookupOptions('EVENT_STATUS', asOf), bus: await refOptions('business-units', u.enterpriseId, asOf) };
  return (
    <div className="max-w-6xl">
      <PageHeader title="Events" subtitle="Tournaments, demonstrations, workshops, arangetram. Create an event, then assign students." />
      <Flash sp={await searchParams} />
      <div className="card mb-4 overflow-x-auto">
        <table className="tbl"><thead><tr><th>Date</th><th>Event</th><th>Type</th><th>Branch</th><th>Venue</th><th>Fee</th><th>Students</th><th>Status</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}><td className="whitespace-nowrap">{fmtDate(r.start_date)}{r.end_date !== r.start_date && ` – ${fmtDate(r.end_date)}`}</td>
              <td><Link className="link" href={`/events/${r.id}`}>{r.name}</Link></td><td>{L('EVENT_TYPE', r.event_type_code)}</td><td>{r.bu_name ?? 'All'}</td><td>{r.venue}</td>
              <td>{Number(r.fee_amount) ? money(r.fee_amount) : 'Free'}</td><td>{r.n}</td><td><Badge color={r.status_code === 'COMPLETED' ? 'green' : r.status_code === 'CANCELLED' ? 'red' : 'blue'}>{L('EVENT_STATUS', r.status_code)}</Badge></td></tr>))}</tbody></table>
        {!rows.length && <Empty />}
      </div>
      {can(u, 'CD_EVENT_SETUP_PRV', 'WRITE') && <><h2 className="h2">Create Event</h2><EventForm action={saveEvent.bind(null, null)} back="/events" o={o} /></>}
    </div>
  );
}
