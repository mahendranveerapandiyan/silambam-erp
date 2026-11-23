import 'server-only';
import { sql } from './db';

export type RequestFilter = { status?: string | null; process?: string | null; q?: string | null; from?: string | null; to?: string | null; requesterId?: string | null };

/** Approval requests with requester name and who is still to approve. */
export async function listRequests(enterpriseId: string, f: RequestFilter, limit = 500) {
  const like = f.q ? `%${f.q.trim()}%` : null;
  return sql`
    select r.*, (select display_name from user_account x where x.id = r.requested_by_user_id) requester_name,
      (select string_agg(ua.display_name, ', ' order by ua.display_name) from approval_task t join user_account ua on ua.id = t.approver_user_id
        where t.request_id = r.id and t.status_code = 'PENDING') waiting_on
    from approval_request r
    where r.enterprise_id = ${enterpriseId}
      ${f.requesterId ? sql`and r.requested_by_user_id = ${f.requesterId}` : sql``}
      ${f.status && f.status !== 'ALL' ? sql`and r.status_code = ${f.status}` : sql``}
      ${f.process ? sql`and r.process_code = ${f.process}` : sql``}
      ${like ? sql`and (r.title ilike ${like} or r.summary ilike ${like} or r.requested_by ilike ${like} or r.id::text = ${f.q!.trim()})` : sql``}
      ${f.from ? sql`and r.created_at >= ${f.from}::date` : sql``}
      ${f.to ? sql`and r.created_at < ${f.to}::date + 1` : sql``}
    order by r.created_at desc limit ${limit}`;
}
