import { requirePriv } from '@/lib/auth';
import { sql } from '@/lib/db';
import { lk, lookupOptions } from '@/lib/lookups';
import { getAsOf } from '@/lib/asof';
import { listRequests } from '@/lib/approvalQueries';
import { PageHeader, Flash, Select, type SP, s as one } from '@/components/ui';
import { AutoSubmit } from '@/components/client';
import { RequestTable } from '@/components/ApprovalList';

export default async function TransactionConsole({ searchParams }: { searchParams: SP }) {
  const u = await requirePriv('CD_TRANSACTION_CONSOLE_PRV');
  const sp = await searchParams;
  const L = await lk();
  const asOf = await getAsOf();
  const f = { status: one(sp.status) ?? 'PENDING', process: one(sp.process), q: one(sp.q), from: one(sp.from), to: one(sp.to) };
  const rows = await listRequests(u.enterpriseId, f);
  const counts = Object.fromEntries((await sql`select status_code, count(*)::int n from approval_request where enterprise_id = ${u.enterpriseId} group by 1`).map((r) => [r.status_code, r.n]));
  const statuses = [{ value: 'PENDING', label: `Pending (${counts.PENDING ?? 0})` }, { value: 'APPROVED', label: `Approved (${counts.APPROVED ?? 0})` },
    { value: 'REJECTED', label: `Rejected (${counts.REJECTED ?? 0})` }, { value: 'WITHDRAWN', label: `Withdrawn (${counts.WITHDRAWN ?? 0})` }, { value: 'ALL', label: 'All statuses' }];
  return (
    <div className="max-w-7xl">
      <PageHeader title="Transaction Console" subtitle="Every approval request across the application. Open a request to approve it outright, reject, withdraw (cancel the transaction), reassign or skip an approver." />
      <Flash sp={sp} />
      <form className="card mb-4 grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Select name="status" options={statuses} value={f.status} empty={false} />
        <Select name="process" options={await lookupOptions('APPROVAL_PROCESS', asOf)} value={f.process} empty="All processes" />
        <input name="q" defaultValue={f.q ?? ''} placeholder="Request #, title, requester…" className="input lg:col-span-2" />
        <input type="date" name="from" defaultValue={f.from ?? ''} className="input" title="Submitted from" />
        <input type="date" name="to" defaultValue={f.to ?? ''} className="input" title="Submitted to" />
        <AutoSubmit />
      </form>
      <div className="card"><RequestTable rows={rows} L={L} /></div>
    </div>
  );
}
