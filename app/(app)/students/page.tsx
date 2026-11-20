import { requireUser } from '@/lib/auth';
import { getAsOf } from '@/lib/asof';
import { PeopleList } from '@/components/people/PeopleList';
import type { SP } from '@/components/ui';

export default async function Page({ searchParams }: { searchParams: SP }) {
  const u = await requireUser('INCHARGE', 'ACCOUNTANT');
  return <PeopleList u={u} kind="STUDENT" asOf={await getAsOf()} sp={await searchParams} />;
}
