import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SignJWT, jwtVerify } from 'jose';
import { cache } from 'react';
import { sql } from './db';

const COOKIE = 'erp_session';
const secret = () => {
  const s = process.env.SESSION_SECRET;
  if (!s && process.env.NODE_ENV === 'production') throw new Error('SESSION_SECRET is not set');
  return new TextEncoder().encode(s || 'dev-only-secret-change-me-please-0123456789');
};

export type Role = string;
export type Level = 'VIEW' | 'READ' | 'WRITE';
const LEVEL: Record<Level, number> = { VIEW: 1, READ: 2, WRITE: 3 };
export type SessionUser = {
  /** privilege code -> highest level granted by any active role (1 view, 2 read, 3 write) */
  privs: Record<string, number>;
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
      from user_account u
      left join user_role r on r.user_id = u.id and exists (select 1 from app_role ar where ar.code = r.role_code and ar.active_flag = 'Y')
      where u.id = ${String(payload.uid)} and u.active_flag = 'Y'
      group by u.id`;
    if (!u) return null;
    const pr = await sql`
      select rp.privilege_code, max(case when rp.can_write = 'Y' then 3 when rp.can_read = 'Y' then 2 when rp.can_view = 'Y' then 1 else 0 end)::int lvl
      from user_role ur join app_role ar on ar.code = ur.role_code and ar.active_flag = 'Y'
      join role_privilege rp on rp.role_code = ur.role_code
      where ur.user_id = ${u.id} group by 1`;
    return {
      privs: Object.fromEntries(pr.filter((r) => r.lvl > 0).map((r) => [r.privilege_code, r.lvl])),
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

/** Does the user hold this privilege at (at least) this level? */
export function can(u: SessionUser, code: string, level: Level = 'VIEW') {
  return (u.privs[code] ?? 0) >= LEVEL[level];
}
export function canAny(u: SessionUser, codes: string[], level: Level = 'VIEW') {
  return codes.some((c) => can(u, c, level));
}

/** Require a signed-in user. */
export async function requireUser(): Promise<SessionUser> {
  const u = await getUser();
  if (!u) redirect('/login');
  return u;
}

/** Require a privilege (any of several) at a level; otherwise "Access denied". */
export async function requirePriv(codes: string | string[], level: Level = 'VIEW'): Promise<SessionUser> {
  const u = await requireUser();
  if (!canAny(u, Array.isArray(codes) ? codes : [codes], level)) redirect('/forbidden');
  return u;
}

/** Same check for server actions: throws a readable error instead of redirecting. */
export function assertPriv(u: SessionUser, codes: string | string[], level: Level = 'WRITE') {
  if (!canAny(u, Array.isArray(codes) ? codes : [codes], level)) throw new Error('You do not have permission for this action.');
}

/** Where a user lands after login. */
export function homeFor(u: SessionUser) {
  if (can(u, 'CD_DASHBOARD_PRV')) return '/';
  if (can(u, 'CD_PORTAL_PRV')) return '/portal';
  if (can(u, 'CD_MY_PROFILE_PRV')) return '/me';
  const first = Object.keys(u.privs)[0];
  return first ? '/' : '/forbidden';
}
