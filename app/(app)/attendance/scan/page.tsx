import { requireUser, requirePriv, can, canAny, type SessionUser } from '@/lib/auth';
import { Scanner } from '@/components/Scanner';
import { PageHeader } from '@/components/ui';
import { scanAttendance } from '../actions';
import { todayISO, fmtDate } from '@/lib/util';

export default async function ScanPage() {
  const u = await requirePriv('CD_QR_SCAN_PRV', 'WRITE');
  return (
    <div className="max-w-6xl">
      <PageHeader title="QR Attendance Scan" subtitle={`Scan student or staff ID cards to mark attendance for today (${fmtDate(todayISO())}). Staff: first scan = check-in, second = check-out.`} />
      <Scanner onScan={scanAttendance} canStaff={can(u, 'CD_STAFF_ATTENDANCE_PRV', 'WRITE')} />
    </div>
  );
}
