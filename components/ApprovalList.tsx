import Link from 'next/link';
import type { Row } from '@/lib/db';
import { fmtDateTime } from '@/lib/util';
import { Badge, Empty } from './ui';

export const REQ_COLOR: Record<string, string> = { PENDING: 'amber', APPROVED: 'green', REJECTED: 'red', WITHDRAWN: 'gray' };

/** Table of approval requests (My Requests, Transaction Console). */
export function RequestTable({ rows, L, showRequester = true }: { rows: Row[]; L: (t: string, c: string) => string; showRequester?: boolean }) {
  if (!rows.length) return <Empty>No requests.</Empty>;
  return (
    <div className="overflow-x-auto">
      <table className="tbl">
        <thead><tr><th>#</th><th>Process</th><th>Request</th>{showRequester && <th>Requested By</th>}<th>Submitted</th><th>Status</th><th>Waiting On</th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.id}>
            <td><Link className="link" href={`/approvals/requests/${r.id}`}>{r.id}</Link></td>
            <td className="text-sm">{L('APPROVAL_PROCESS', r.process_code)}</td>
            <td><Link className="link" href={`/approvals/requests/${r.id}`}>{r.title}</Link>{r.summary && <div className="text-xs text-slate-500">{r.summary}</div>}</td>
            {showRequester && <td className="text-sm">{r.requester_name ?? r.requested_by}</td>}
            <td className="whitespace-nowrap text-xs">{fmtDateTime(r.created_at)}</td>
            <td><Badge color={REQ_COLOR[r.status_code]}>{L('APPROVAL_STATUS', r.status_code)}</Badge></td>
            <td className="text-xs">{r.status_code === 'PENDING' ? r.waiting_on ?? '—' : ''}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}
