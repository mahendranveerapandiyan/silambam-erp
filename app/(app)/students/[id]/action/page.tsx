import { requireUser } from '@/lib/auth';
import { getAsOf } from '@/lib/asof';
import { ActionForm } from '@/components/people/ActionForm';
import { AccessGuard } from '@/components/people/AccessGuard';
import type { SP } from '@/components/ui';

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const u = await requireUser('INCHARGE');
  const { id } = await params;
  const asOf = await getAsOf();
  return (
    <AccessGuard u={u} kind="STUDENT" personId={id} asOf={asOf}>
      <ActionForm u={u} kind="STUDENT" personId={id} asOf={asOf} sp={await searchParams} />
    </AccessGuard>
  );
}
