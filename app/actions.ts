'use server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import bcrypt from 'bcryptjs';
import { sql } from '@/lib/db';
import { createSession, destroySession, getUser, homeFor, requireUser } from '@/lib/auth';
import { act, backOf, formObj } from '@/lib/util';

export async function login(fd: FormData) {
  const username = String(fd.get('username') || '').trim().toLowerCase();
  const password = String(fd.get('password') || '');
  let u: { id: string; password_hash: string } | undefined;
  try {
    [u] = (await sql`select id, password_hash from user_account where lower(username) = ${username} and active_flag = 'Y'`) as any;
  } catch (e) {
    console.error('Login failed - database error:', e);
    redirect('/login?err=' + encodeURIComponent('Cannot reach the database. Check that PostgreSQL is running and migrated – open /api/health for details.'));
  }
  if (!u || !(await bcrypt.compare(password, u.password_hash))) redirect('/login?err=Invalid%20username%20or%20password');
  await sql`update user_account set last_login = now() where id = ${u.id}`;
  await createSession(u.id);
  const me = await getUser();
  redirect(me ? homeFor(me) : '/');
}

export async function logout() {
  await destroySession();
  redirect('/login');
}

export async function setAsOf(fd: FormData) {
  const d = String(fd.get('asof') || '');
  const c = await cookies();
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) c.set('erp_asof', d, { path: '/', sameSite: 'lax' });
  else c.delete('erp_asof');
  redirect(backOf(fd, '/'));
}

export async function changePassword(fd: FormData) {
  const u = await requireUser();
  await act('/account', async () => {
    const o = formObj(fd);
    const [row] = await sql`select password_hash from user_account where id = ${u.id}`;
    if (!(await bcrypt.compare(o.current || '', row.password_hash))) throw new Error('Current password is incorrect');
    if (!o.password || o.password.length < 6) throw new Error('New password must be at least 6 characters');
    if (o.password !== o.confirm) throw new Error('Passwords do not match');
    await sql`update user_account set password_hash = ${await bcrypt.hash(o.password, 10)}, must_change_password = 'N', last_update_date = now() where id = ${u.id}`;
    return { to: homeFor(u), msg: 'Password changed' };
  });
}
