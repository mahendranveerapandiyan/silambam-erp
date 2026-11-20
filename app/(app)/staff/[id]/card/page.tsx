import { requireUser } from '@/lib/auth';
import { getAsOf } from '@/lib/asof';
import { IdCards } from '@/components/people/IdCards';
import { AccessGuard } from '@/components/people/AccessGuard';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const u = await requireUser('ADMIN');
  const { id } = await params;
  const asOf = await getAsOf();
  return (
    <AccessGuard u={u} kind="STAFF" personId={id} asOf={asOf}>
      <IdCards u={u} kind="STAFF" personIds={[id]} asOf={asOf} />
    </AccessGuard>
  );
}
