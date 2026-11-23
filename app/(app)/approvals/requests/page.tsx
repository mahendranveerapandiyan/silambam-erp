import Link from 'next/link';
import { requirePriv } from '@/lib/auth';
import { lk } from '@/lib/lookups';
import { listRequests } from '@/lib/approvalQueries';
import { PageHeader, Flash, type SP } from '@/components/ui';
import { RequestTable } from '@/components/ApprovalList';

export default async function MyRequests({ searchParams }: { searchParams: SP }) {
  const u = await requirePriv('CD_MY_APPROVALS_PRV');
  const L = await lk();
  const rows = await listRequests(u.enterpriseId, { requesterId: u.id, status: 'ALL' }, 300);
  return (
    <div className="max-w-6xl">
      <PageHeader title="My Requests" subtitle="Requests you submitted and where they stand. A pending request can be withdrawn from its page." actions={<Link href="/approvals" className="btn">My Approvals</Link>} />
      <Flash sp={await searchParams} />
      <div className="card"><RequestTable rows={rows} L={L} showRequester={false} /></div>
    </div>
  );
}
