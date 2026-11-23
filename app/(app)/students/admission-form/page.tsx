import { requirePriv } from '@/lib/auth';
import { getAsOf } from '@/lib/asof';
import { HireForm } from '@/components/people/HireForm';
import type { SP } from '@/components/ui';

/** Staff Admission Form: the New Admission page, sent for approval. */
export default async function Page({ searchParams }: { searchParams: SP }) {
  const u = await requirePriv('CD_ADMISSION_FORM_PRV', 'WRITE');
  return <HireForm u={u} kind="STUDENT" asOf={await getAsOf()} sp={await searchParams} request />;
}
