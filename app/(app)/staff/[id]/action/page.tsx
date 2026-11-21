import { requireUser, requirePriv, can, canAny, type SessionUser } from '@/lib/auth';
import { getAsOf } from '@/lib/asof';
import { ActionForm } from '@/components/people/ActionForm';
import { AccessGuard } from '@/components/people/AccessGuard';
import type { SP } from '@/components/ui';

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const u = await requirePriv('CD_STAFF_ACTION_PRV', 'WRITE');
  const { id } = await params;
  const asOf = await getAsOf();
  return (
    <AccessGuard u={u} kind="STAFF" personId={id} asOf={asOf}>
      <ActionForm u={u} kind="STAFF" personId={id} asOf={asOf} sp={await searchParams} />
    </AccessGuard>
  );
}
