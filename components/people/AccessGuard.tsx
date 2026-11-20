import type { ReactNode } from 'react';
import type { SessionUser } from '@/lib/auth';
import { assertStudentAccess } from '@/lib/scope';
import type { PersonKind } from '@/lib/people';

/** Blocks incharges from opening students outside their classes. */
export async function AccessGuard({ u, kind, personId, asOf, children }: { u: SessionUser; kind: PersonKind; personId: string; asOf: string; children: ReactNode }) {
  if (kind === 'STUDENT') {
    try {
      await assertStudentAccess(u, personId, asOf);
    } catch (e) {
      return <div className="card max-w-lg border-red-300 bg-red-50 text-sm text-red-800">{(e as Error).message}</div>;
    }
  }
  return <>{children}</>;
}
