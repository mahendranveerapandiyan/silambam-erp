// Applies db/migrations/*.sql in order. `--reset` drops everything first.
import postgres from 'postgres';
import fs from 'node:fs';
import path from 'node:path';

const url = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/silambam';
const sql = postgres(url, { onnotice: () => {} });
const dir = path.join(process.cwd(), 'db', 'migrations');

/**
 * Keeps the privilege list in the database equal to db/privileges.json.
 * New privileges get their default role mappings once; ADMIN always has every
 * privilege with full access. Mappings changed by users are never overwritten.
 */
async function syncPrivileges() {
  const list = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'db', 'privileges.json'), 'utf8'));
  const lvl = { V: ['Y', 'Y', 'N'], R: ['Y', 'Y', 'N'], W: ['Y', 'Y', 'Y'] }; // View only = view + read
  let added = 0;
  await sql.begin(async (tx) => {
    for (const p of list) {
      const [r] = await tx`insert into privilege (code, name, module, display_seq) values (${p.code}, ${p.name}, ${p.module}, ${p.seq})
        on conflict (code) do update set name = excluded.name, module = excluded.module, display_seq = excluded.display_seq
        returning (xmax = 0) as inserted`;
      if (r.inserted) {
        added++;
        for (const [role, l] of Object.entries(p.defaults ?? {})) {
          const [v, rd, w] = lvl[l];
          await tx`insert into role_privilege values (${role}, ${p.code}, ${v}, ${rd}, ${w}) on conflict do nothing`;
        }
      }
      await tx`insert into role_privilege values ('ADMIN', ${p.code}, 'Y', 'Y', 'Y')
        on conflict (role_code, privilege_code) do update set can_view = 'Y', can_read = 'Y', can_write = 'Y'`;
    }
    await tx`delete from privilege where code <> all(${list.map((p) => p.code)})`;
  });
  if (added) console.log(`Privileges: ${added} added`);
}

try {
  if (process.argv.includes('--reset')) {
    await sql.unsafe('drop schema public cascade; create schema public;');
    console.log('Schema reset.');
  }
  await sql`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`;
  const done = new Set((await sql`select name from schema_migrations`).map((r) => r.name));
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    if (done.has(f)) continue;
    await sql.begin(async (tx) => {
      await tx.unsafe(fs.readFileSync(path.join(dir, f), 'utf8'));
      await tx`insert into schema_migrations(name) values (${f})`;
    });
    console.log('Applied', f);
  }
  await syncPrivileges();
} finally {
  await sql.end();
}
