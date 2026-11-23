import Link from 'next/link';
import { requirePriv } from '@/lib/auth';
import { sql } from '@/lib/db';
import { lk } from '@/lib/lookups';
import { fmtDateTime } from '@/lib/util';
import { PageHeader, Flash, Back, Empty, type SP } from '@/components/ui';
import { decide } from './actions';

export default async function MyApprovals({ searchParams }: { searchParams: SP }) {
  const u = await requirePriv('CD_MY_APPROVALS_PRV');
  const L = await lk();
  const tasks = await sql`select t.id task_id, t.step_no, t.step_label, t.approval_mode, r.id, r.title, r.summary, r.process_code, r.created_at,
      (select display_name from user_account x where x.id = r.requested_by_user_id) requester_name, r.requested_by
    from approval_task t join approval_request r on r.id = t.request_id
    where t.approver_user_id = ${u.id} and t.status_code = 'PENDING' and r.status_code = 'PENDING' order by r.created_at`;
  return (
    <div className="max-w-6xl">
      <PageHeader title="My Approvals" subtitle="Requests waiting for your decision. Open a request to see everything that was submitted." actions={<Link href="/approvals/requests" className="btn">My Requests</Link>} />
      <Flash sp={await searchParams} />
      <div className="space-y-3">
        {tasks.map((t) => (
          <div key={t.task_id} className="card">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-xs text-slate-500">#{t.id} · {L('APPROVAL_PROCESS', t.process_code)} · step {t.step_no}: {t.step_label}</div>
                <Link className="link text-base font-semibold" href={`/approvals/requests/${t.id}`}>{t.title}</Link>
                {t.summary && <div className="text-sm text-slate-600">{t.summary}</div>}
                <div className="text-xs text-slate-500">Requested by {t.requester_name ?? t.requested_by} · {fmtDateTime(t.created_at)}</div>
              </div>
              <form className="flex flex-wrap items-center gap-2" action={decide.bind(null, String(t.task_id), 'APPROVE')}>
                <Back to="/approvals" />
                <input name="comments" placeholder="Comments (optional)" className="input w-56" />
                <button className="btn btn-primary">Approve</button>
                <button className="btn btn-danger" formAction={decide.bind(null, String(t.task_id), 'REJECT')} data-confirm={`Reject "${t.title}"? The request will be closed.`}>Reject</button>
              </form>
            </div>
          </div>
        ))}
        {!tasks.length && <div className="card"><Empty>Nothing is waiting for your approval.</Empty></div>}
      </div>
    </div>
  );
}
