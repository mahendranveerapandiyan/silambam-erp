import { requireUser, requirePriv, can, canAny, type SessionUser } from '@/lib/auth';
import { getAsOf } from '@/lib/asof';
import { HireForm } from '@/components/people/HireForm';
import type { SP } from '@/components/ui';

export default async function Page({ searchParams }: { searchParams: SP }) {
  const u = await requirePriv('CD_STUDENT_ADMISSION_PRV', 'WRITE');
  return <HireForm u={u} kind="STUDENT" asOf={await getAsOf()} sp={await searchParams} />;
}
