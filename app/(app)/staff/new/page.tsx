import { requireUser } from '@/lib/auth';
import { getAsOf } from '@/lib/asof';
import { HireForm } from '@/components/people/HireForm';
import type { SP } from '@/components/ui';

export default async function Page({ searchParams }: { searchParams: SP }) {
  const u = await requireUser('ADMIN');
  return <HireForm u={u} kind="STAFF" asOf={await getAsOf()} sp={await searchParams} />;
}
