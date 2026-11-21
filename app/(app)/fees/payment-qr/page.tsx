import { requireUser, requirePriv, can, canAny, type SessionUser } from '@/lib/auth';
import { getAsOf } from '@/lib/asof';
import { sql } from '@/lib/db';
import { refOptions } from '@/lib/dt';
import { PageHeader, Flash, Field, Select, Badge, Empty, type SP } from '@/components/ui';
import { ConfirmButton } from '@/components/client';
import { uploadPaymentQr, togglePaymentQr } from '../actions';

export default async function PaymentQr({ searchParams }: { searchParams: SP }) {
  const u = await requirePriv('CD_PAYMENT_QR_PRV');
  const asOf = await getAsOf();
  const admin = can(u, 'CD_ALL_STUDENTS_DATA_PRV');
  const rows = await sql`select q.id, q.label, q.upi_id, q.active_flag, q.person_id, q.business_unit_id, q.created_by,
      (select name from business_unit_f b where b.id = q.business_unit_id order by effective_start_date desc limit 1) bu_name
    from payment_qr q where ${admin} or q.person_id = ${u.personId ?? '0'} order by q.id desc`;
  const bus = await refOptions('business-units', u.enterpriseId, asOf);
  return (
    <div className="max-w-5xl">
      <PageHeader title="Payment QR Codes" subtitle="Upload a UPI QR picture. It appears on the fee page and parent portal of the students in your classes (or the whole branch for branch-level QRs)." />
      <Flash sp={await searchParams} />
      <form action={uploadPaymentQr} className="card mb-4 grid items-end gap-3 sm:grid-cols-4">
        <Field label="QR Image *"><input type="file" name="image" accept="image/*" required className="input" /></Field>
        <Field label="Label *"><input name="label" placeholder="GPay – Coach name" required className="input" /></Field>
        <Field label="UPI ID"><input name="upi_id" placeholder="name@bank" className="input" /></Field>
        {admin && <Field label="Branch-level (admin)"><Select name="business_unit_id" options={bus} empty="No – my own QR" /></Field>}
        <button className="btn btn-primary">Upload</button>
      </form>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((q) => (
          <div key={q.id} className="card text-center">
            <img src={`/api/payment-qr/${q.id}`} alt="" className={`mx-auto max-h-48 ${q.active_flag === 'N' ? 'opacity-30' : ''}`} />
            <div className="mt-2 font-semibold">{q.label}</div>
            <div className="text-xs">{q.upi_id} {q.bu_name ? <Badge color="blue">Branch: {q.bu_name}</Badge> : <Badge>{q.created_by}</Badge>}</div>
            <div className="mt-2 flex justify-center gap-2">
              <form action={togglePaymentQr.bind(null, q.id)}><button className="btn btn-sm">{q.active_flag === 'Y' ? 'Disable' : 'Enable'}</button></form>
              <form action={togglePaymentQr.bind(null, q.id)}><input type="hidden" name="_delete" value="1" /><ConfirmButton className="btn btn-sm" message="Delete this QR?">Delete</ConfirmButton></form>
            </div>
          </div>
        ))}
      </div>
      {!rows.length && <div className="card"><Empty>No QR codes uploaded yet.</Empty></div>}
    </div>
  );
}
