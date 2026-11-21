import { requireUser, requirePriv, can, canAny, type SessionUser } from '@/lib/auth';
import { getAsOf } from '@/lib/asof';
import { PeopleList } from '@/components/people/PeopleList';
import type { SP } from '@/components/ui';

export default async function Page({ searchParams }: { searchParams: SP }) {
  const u = await requirePriv('CD_STAFF_DIRECTORY_PRV');
  return <PeopleList u={u} kind="STAFF" asOf={await getAsOf()} sp={await searchParams} />;
}
