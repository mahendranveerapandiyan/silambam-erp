import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SignJWT, jwtVerify } from 'jose';
import { cache } from 'react';
import { sql } from './db';

const COOKIE = 'erp_session';
const secret = () => new TextEncoder().encode(process.env.SESSION_SECRET || 'dev-only-secret-change-me-please-0123456789');

export type Role = 'ADMIN' | 'INCHARGE' | 'STAFF' | 'ACCOUNTANT' | 'PARENT' | 'STUDENT';
export type SessionUser = {
  id: string;
  username: string;
  displayName: string;
  enterpriseId: string;
  personId: string | null;
  roles: Role[];
  mustChangePassword: boolean;
};

export async function createSession(userId: string) {
  const token = await new SignJWT({ uid: userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('12h')
    .sign(secret());
  (await cookies()).set(COOKIE, token, { httpOnly: true, sameSite: 'lax', path: '/', secure: process.env.NODE_ENV === 'production', maxAge: 12 * 3600 });
}

export async function destroySession() {
  (await cookies()).delete(COOKIE);
}

export const getUser = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    const [u] = await sql`
      select u.id, u.username, u.display_name, u.enterprise_id, u.person_id, u.must_change_password,
             coalesce(array_agg(r.role_code) filter (where r.role_code is not null), '{}') roles
      from user_account u left join user_role r on r.user_id = u.id
      where u.id = ${String(payload.uid)} and u.active_flag = 'Y'
      group by u.id`;
    if (!u) return null;
    return {
      id: u.id,
      username: u.username,
      displayName: u.display_name,
      enterpriseId: u.enterprise_id,
      personId: u.person_id,
      roles: u.roles,
      mustChangePassword: u.must_change_password === 'Y',
    };
  } catch {
    return null;
  }
});

export function hasRole(u: SessionUser, ...roles: Role[]) {
  return u.roles.includes('ADMIN') || roles.some((r) => u.roles.includes(r));
}

export const isAdmin = (u: SessionUser) => u.roles.includes('ADMIN');

/** Require a signed-in user; optionally one of the given roles (ADMIN always passes). */
export async function requireUser(...roles: Role[]): Promise<SessionUser> {
  const u = await getUser();
  if (!u) redirect('/login');
  if (roles.length && !hasRole(u, ...roles)) redirect('/forbidden');
  return u;
}

/** Where a user lands after login. */
export function homeFor(u: SessionUser) {
  if (hasRole(u, 'ADMIN', 'ACCOUNTANT', 'INCHARGE')) return '/';
  if (u.roles.includes('STAFF')) return '/me';
  return '/portal';
}
