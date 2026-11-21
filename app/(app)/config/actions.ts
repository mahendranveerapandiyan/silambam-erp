'use server';
import { imageToPng } from '@/lib/images';
import bcrypt from 'bcryptjs';
import { sql } from '@/lib/db';
import { requireUser, requirePriv, can, canAny, type SessionUser } from '@/lib/auth';
import { act, backOf, formObj, fileToBytes } from '@/lib/util';
import { THEME_KEYS } from '@/lib/theme';
import { lookupPrivs } from '@/lib/menu';

// ---------------- Lookups ----------------
export async function createLookupType(fd: FormData) {
  const u = await requirePriv('CD_LOOKUP_PRV', 'WRITE');
  await act(backOf(fd), async () => {
    const o = formObj(fd);
    if (!o.lookup_type || !o.meaning) throw new Error('Lookup type and meaning are required');
    const t = o.lookup_type.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    await sql`insert into lookup_type (lookup_type, meaning, description, module_code, access_level, parent_lookup_type, created_by)
      values (${t}, ${o.meaning}, ${o.description}, ${o.module_code ?? 'COMMON'}, 'USER', ${o.parent_lookup_type}, ${u.username})`;
    return { to: `/config/lookups/${t}`, msg: 'Lookup type created' };
  });
}

export async function updateLookupType(type: string, fd: FormData) {
  const u = await requirePriv('CD_LOOKUP_PRV', 'WRITE');
  await act(backOf(fd), async () => {
    const o = formObj(fd);
    await sql`update lookup_type set description = ${o.description}, last_updated_by = ${u.username}, last_update_date = now() where lookup_type = ${type}`;
  });
}

async function typeAccess(type: string) {
  const [t] = await sql`select access_level from lookup_type where lookup_type = ${type}`;
  if (!t) throw new Error('Unknown lookup type');
  return t.access_level as string;
}

export async function saveLookupValue(type: string, fd: FormData) {
  const u = await requirePriv(lookupPrivs(type), 'WRITE');
  await act(backOf(fd), async () => {
    const o = formObj(fd);
    const access = await typeAccess(type);
    if (!o.lookup_code || !o.meaning) throw new Error('Code and meaning are required');
    const vals = {
      meaning: o.meaning, description: o.description, tag: o.tag, display_seq: Number(o.display_seq || 0),
      enabled_flag: o.enabled_flag === 'N' ? 'N' : 'Y', start_date: o.start_date || '1951-01-01', end_date: o.end_date || '4712-12-31',
      parent_code: o.parent_code, last_updated_by: u.username, last_update_date: new Date(),
    };
    if (o._new) {
      if (access === 'SYSTEM') throw new Error('This is a system lookup; values cannot be added.');
      const code = o.lookup_code.toUpperCase().replace(/\s+/g, '_');
      await sql`insert into lookup_value ${sql({ lookup_type: type, lookup_code: code, ...vals, created_by: u.username })}`;
      return { msg: `Value ${code} added` };
    }
    const [cur] = await sql`select system_flag from lookup_value where lookup_type = ${type} and lookup_code = ${o.lookup_code}`;
    if (cur?.system_flag === 'Y' && vals.enabled_flag === 'N') throw new Error('System values cannot be disabled (the application depends on them).');
    await sql`update lookup_value set ${sql(vals)} where lookup_type = ${type} and lookup_code = ${o.lookup_code}`;
    return { msg: `Value ${o.lookup_code} saved` };
  });
}

export async function deleteLookupValue(type: string, code: string, fd: FormData) {
  await requirePriv(lookupPrivs(type), 'WRITE');
  await act(backOf(fd), async () => {
    const [cur] = await sql`select system_flag from lookup_value where lookup_type = ${type} and lookup_code = ${code}`;
    if (cur?.system_flag === 'Y' || (await typeAccess(type)) === 'SYSTEM') throw new Error('System values cannot be deleted.');
    await sql`delete from lookup_value where lookup_type = ${type} and lookup_code = ${code}`;
    return { msg: `Value ${code} deleted` };
  });
}

// ---------------- Enterprise ----------------
export async function saveEnterprise(fd: FormData) {
  const u = await requirePriv('CD_ENTERPRISE_PRV', 'WRITE');
  await act('/config/enterprise', async () => {
    const o = formObj(fd);
    if (!o.name) throw new Error('Name is required');
    const logo = await imageToPng(fd.get('logo'), 400);
    const [cur] = await sql`select code, code_locked_flag from enterprise where id = ${u.enterpriseId}`;
    let code = cur.code;
    if (cur.code_locked_flag !== 'Y') {
      if (!o.code) throw new Error('Enterprise code is required');
      code = o.code.toUpperCase();
      if (!/^[A-Z0-9_-]{2,20}$/.test(code)) throw new Error('Code: 2-20 letters, numbers, - or _');
    }
    if (o.timezone) {
      const [tz] = await sql`select 1 from lookup_value where lookup_type = 'TIMEZONE' and lookup_code = ${o.timezone} and enabled_flag = 'Y'`;
      if (!tz) throw new Error('Choose a time zone from the list');
    }
    await sql`update enterprise set code = ${code}, code_locked_flag = 'Y', name = ${o.name}, short_name = ${o.short_name},
      registration_number = ${o.registration_number}, tax_number = ${o.tax_number},
      country_code = ${o.country_code}, currency_code = ${o.currency_code}, timezone = ${o.timezone ?? 'Asia/Kolkata'},
      address = ${o.address}, phone = ${o.phone}, email = ${o.email}, website = ${o.website},
      last_updated_by = ${u.username}, last_update_date = now(), object_version_number = object_version_number + 1 where id = ${u.enterpriseId}`;
    if (logo) await sql`update enterprise set logo_mime = ${logo.mime}, logo_data = ${logo.data} where id = ${u.enterpriseId}`;
    if (o.remove_logo === 'Y') await sql`update enterprise set logo_mime = null, logo_data = null where id = ${u.enterpriseId}`;
    return { msg: cur.code_locked_flag === 'Y' ? 'Enterprise saved' : `Enterprise saved – code ${code} is now locked` };
  });
}

// ---------------- Number generation ----------------
export async function saveNumberRule(id: string, fd: FormData) {
  const u = await requirePriv('CD_NUMBERING_PRV', 'WRITE');
  await act('/config/numbering', async () => {
    const o = formObj(fd);
    const padding = Number(o.padding || 4);
    if (padding < 1 || padding > 12) throw new Error('Padding must be between 1 and 12');
    const [old] = await sql`select scope_code, reset_yearly_flag from number_rule where id = ${id}`;
    await sql`update number_rule set method_code = ${o.method_code ?? 'AUTO'}, scope_code = ${o.scope_code ?? 'ENTERPRISE'}, prefix = ${o.prefix}, suffix = ${o.suffix},
      separator = ${o.separator ?? ''}, include_scope_code_flag = ${o.include_scope_code_flag ?? 'N'}, include_year_flag = ${o.include_year_flag ?? 'N'},
      reset_yearly_flag = ${o.reset_yearly_flag ?? 'N'}, padding = ${padding}, start_number = ${Number(o.start_number || 1)},
      last_updated_by = ${u.username}, last_update_date = now(), object_version_number = object_version_number + 1 where id = ${id} and enterprise_id = ${u.enterpriseId}`;
    if (old && (old.scope_code !== o.scope_code || old.reset_yearly_flag !== o.reset_yearly_flag))
      return { msg: 'Rule saved. Level/reset changed: numbering restarts from the start number for the new level.' };
    return { msg: 'Number generation rule saved' };
  });
}

// ---------------- Theme ----------------
export async function saveTheme(fd: FormData) {
  const u = await requirePriv('CD_THEME_PRV', 'WRITE');
  await act('/config/theme', async () => {
    const o = formObj(fd);
    if (o._reset) {
      const defaults: Record<string, string> = { header_bg: '#7a1f1f', header_text: '#ffffff', sidebar_bg: '#1f2933', sidebar_text: '#e4e7eb', body_bg: '#f5f3ef', card_bg: '#ffffff', text_color: '#1f2933', primary_color: '#b45309', font_size: '14', font_family: 'Inter, system-ui, sans-serif' };
      Object.assign(o, defaults);
    }
    for (const [k, , type] of THEME_KEYS) {
      let v = o[k];
      if (!v) continue;
      if (type === 'color' && !/^#[0-9a-fA-F]{6}$/.test(v)) throw new Error(`Invalid colour for ${k}`);
      if (type === 'number') v = String(Math.min(22, Math.max(11, Number(v) || 14)));
      await sql`insert into ui_setting (enterprise_id, setting_key, setting_value, last_updated_by) values (${u.enterpriseId}, ${k}, ${v}, ${u.username})
        on conflict (enterprise_id, setting_key) do update set setting_value = excluded.setting_value, last_updated_by = excluded.last_updated_by, last_update_date = now()`;
    }
    return { msg: o._reset ? 'Theme reset to defaults' : 'Theme saved' };
  });
}

// ---------------- Users ----------------

export async function saveUser(id: string | null, fd: FormData) {
  const u = await requirePriv('CD_USER_PRV', 'WRITE');
  await act(backOf(fd, '/config/users'), async () => {
    const o = formObj(fd);
    const valid = new Set((await sql`select code from app_role`).map((r) => r.code as string));
    const roles = fd.getAll('roles').map(String).filter((r) => valid.has(r));
    const students = fd.getAll('students').map(String).filter(Boolean);
    if (!o.display_name) throw new Error('Display name is required');
    const resolve = async (num: string) => {
      const [r] = await sql`select p.id from person p left join assignment a on a.person_id = p.id
        where p.enterprise_id = ${u.enterpriseId} and (upper(p.person_number) = upper(${num}) or upper(a.assignment_number) = upper(${num})) limit 1`;
      if (!r) throw new Error(`No person found with number ${num}`);
      return String(r.id);
    };
    o.person_id = o.person_number ? await resolve(o.person_number) : null;
    for (const n of (o.add_students ?? '').split(/[\s,]+/).filter(Boolean)) students.push(await resolve(n));
    if (!roles.length) throw new Error('Select at least one role');
    let uid = id;
    await sql.begin(async (tx) => {
      if (!uid) {
        if (!o.username || !o.password) throw new Error('Username and password are required');
        if (o.password.length < 6) throw new Error('Password must be at least 6 characters');
        const [n] = await tx`insert into user_account (enterprise_id, username, password_hash, display_name, person_id, must_change_password, created_by)
          values (${u.enterpriseId}, ${o.username.toLowerCase()}, ${await bcrypt.hash(o.password, 10)}, ${o.display_name}, ${o.person_id}, 'Y', ${u.username}) returning id`;
        uid = n.id;
      } else {
        await tx`update user_account set display_name = ${o.display_name}, person_id = ${o.person_id}, active_flag = ${o.active_flag === 'N' ? 'N' : 'Y'},
          last_updated_by = ${u.username}, last_update_date = now() where id = ${uid}`;
        if (o.password) {
          if (o.password.length < 6) throw new Error('Password must be at least 6 characters');
          await tx`update user_account set password_hash = ${await bcrypt.hash(o.password, 10)}, must_change_password = 'Y' where id = ${uid}`;
        }
        if (uid === u.id && !roles.includes('ADMIN')) throw new Error('You cannot remove your own Administrator role.');
      }
      await tx`delete from user_role where user_id = ${uid}`;
      for (const r of roles) await tx`insert into user_role values (${uid}, ${r})`;
      await tx`delete from user_student_access where user_id = ${uid}`;
      for (const p of students) await tx`insert into user_student_access values (${uid}, ${p}) on conflict do nothing`;
    });
    return { to: `/config/users/${uid}`, msg: id ? 'User saved' : 'User created' };
  });
}

// ---------------- Roles & privileges ----------------
export async function saveRole(code: string | null, fd: FormData) {
  const u = await requirePriv('CD_ROLE_PRV', 'WRITE');
  await act(backOf(fd, '/config/roles'), async () => {
    const o = formObj(fd);
    if (!o.name) throw new Error('Role name is required');
    let rc = code;
    await sql.begin(async (tx) => {
      if (!rc) {
        if (!o.code) throw new Error('Role code is required');
        rc = o.code.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
        await tx`insert into app_role (code, name, description, created_by) values (${rc}, ${o.name}, ${o.description}, ${u.username})`;
      } else {
        await tx`update app_role set name = ${o.name}, description = ${o.description}, active_flag = ${rc === 'ADMIN' ? 'Y' : o.active_flag === 'N' ? 'N' : 'Y'},
          last_updated_by = ${u.username}, last_update_date = now() where code = ${rc}`;
      }
      if (rc === 'ADMIN') return; // Administrator always keeps every privilege
      await tx`delete from role_privilege where role_code = ${rc}`;
      for (const p of await tx`select code from privilege`) {
        const lvl = fd.get(`p_${p.code}`);
        if (!lvl || lvl === 'NONE') continue;
        await tx`insert into role_privilege values (${rc}, ${p.code}, 'Y', 'Y', ${lvl === 'WRITE' ? 'Y' : 'N'})`;
      }
    });
    return { to: `/config/roles/${rc}`, msg: code ? 'Role saved' : 'Role created' };
  });
}

export async function deleteRole(code: string, fd: FormData) {
  await requirePriv('CD_ROLE_PRV', 'WRITE');
  await act(backOf(fd, '/config/roles'), async () => {
    const [r] = await sql`select system_flag from app_role where code = ${code}`;
    if (r?.system_flag === 'Y') throw new Error('Built-in roles cannot be deleted (you can change their privileges or deactivate them).');
    const [n] = await sql`select count(*)::int n from user_role where role_code = ${code}`;
    if (n.n > 0) throw new Error(`This role is assigned to ${n.n} user(s); remove it from them first.`);
    await sql`delete from app_role where code = ${code}`;
    return { to: '/config/roles', msg: 'Role deleted' };
  });
}

// ---------------- Additional fields ----------------
export async function saveField(id: string | null, fd: FormData) {
  const u = await requirePriv('CD_ADDITIONAL_FIELD_PRV', 'WRITE');
  const o = formObj(fd);
  await act(backOf(fd, '/config/fields'), async () => {
    if (!o.label) throw new Error('Label is required');
    const v = {
      label: o.label, required_flag: o.required_flag === 'Y' ? 'Y' : 'N', active_flag: o.active_flag === 'N' ? 'N' : 'Y',
      display_seq: Number(o.display_seq || 0), help_text: o.help_text, last_updated_by: u.username, last_update_date: new Date(),
    };
    if (id) {
      await sql`update additional_field set ${sql(v)} where id = ${id} and enterprise_id = ${u.enterpriseId}`;
      return { msg: 'Field saved' };
    }
    if (!o.context_code || !o.field_code || !o.data_type) throw new Error('Page, field code and data type are required');
    if (o.data_type === 'LOOKUP' && !o.lookup_type) throw new Error('Choose the lookup that supplies the values');
    const code = o.field_code.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    await sql`insert into additional_field ${sql({ ...v, enterprise_id: u.enterpriseId, context_code: o.context_code, field_code: code, data_type: o.data_type,
      lookup_type: o.data_type === 'LOOKUP' ? o.lookup_type : null, created_by: u.username })}`;
    return { to: `/config/fields?context=${encodeURIComponent(o.context_code)}`, msg: `Field ${code} added` };
  });
}
