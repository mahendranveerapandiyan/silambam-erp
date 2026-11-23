import 'server-only';
import type { Tx, Row } from './db';
import { loadUserById } from './auth';
import { hireInTx } from './hire';

/** What completes / cancels each process when its approval ends. */
export type Handler = {
  onApprove: (tx: Tx, req: Row, actor: string) => Promise<{ resultRef?: string; message?: string }>;
  onReject?: (tx: Tx, req: Row, actor: string) => Promise<void>;
  onWithdraw?: (tx: Tx, req: Row, actor: string) => Promise<void>;
  /** Where to look at the finished transaction. */
  link?: (req: Row) => string | null;
};

/** Payload of a hire / admission request: the form, its extra inputs and the photo. */
export type HirePayload = { o: Record<string, string | null>; attributes: Record<string, unknown>; loginRoles: string[]; photo?: { mime: string; b64: string } | null };

const hireHandler = (kind: 'STUDENT' | 'STAFF'): Handler => ({
  async onApprove(tx, req) {
    // the admission is done as the requester (their classes, their name on the record)
    const requester = req.requested_by_user_id ? await loadUserById(String(req.requested_by_user_id)) : null;
    if (!requester) throw new Error(`The requester (${req.requested_by}) no longer has an active login, so the ${kind === 'STUDENT' ? 'admission' : 'hire'} cannot be completed. Withdraw the request instead.`);
    const p = req.payload as HirePayload;
    const r = await hireInTx(tx, requester, kind, p.o, {
      attributes: p.attributes ?? {}, loginRoles: p.loginRoles ?? [],
      photo: p.photo ? { mime: p.photo.mime, data: Buffer.from(p.photo.b64, 'base64') } : null,
    });
    return { resultRef: r.personId, message: r.msg.trim() };
  },
  link: (req) => (req.status_code === 'APPROVED' && req.result_ref ? `/${kind === 'STUDENT' ? 'students' : 'staff'}/${req.result_ref}` : null),
});

const setExemption = (status: string) => async (tx: Tx, req: Row, actor: string) => {
  await tx`update fee_exemption set status_code = ${status}, decided_by = ${actor}, decided_at = now() where id = ${req.ref_id} and status_code = 'PENDING'`;
};

export const HANDLERS: Record<string, Handler> = {
  STUDENT_ADMISSION: hireHandler('STUDENT'),
  STAFF_HIRE: hireHandler('STAFF'),
  FEE_EXCEPTION: {
    async onApprove(tx, req, actor) {
      const [e] = await tx`select e.status_code, e.amount, d.balance_amount, d.person_id from fee_exemption e join fee_demand_v d on d.id = e.demand_id where e.id = ${req.ref_id}`;
      if (!e) throw new Error('The fee line of this exception no longer exists.');
      if (e.status_code !== 'PENDING') throw new Error(`The fee exception is already ${String(e.status_code).toLowerCase()}.`);
      if (Number(e.amount) > Number(e.balance_amount) + 0.001) throw new Error('The exception now exceeds the open balance (payments were recorded since). Reject or withdraw it.');
      await setExemption('APPROVED')(tx, req, actor);
      return { resultRef: String(e.person_id), message: 'Fee exception applied' };
    },
    onReject: setExemption('REJECTED'),
    onWithdraw: setExemption('WITHDRAWN'),
    link: (req) => { const pid = req.result_ref ?? (req.payload as { personId?: string } | null)?.personId; return pid ? `/fees/students/${pid}` : null; },
  },
};
