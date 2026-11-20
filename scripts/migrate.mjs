// Applies db/migrations/*.sql in order. `--reset` drops everything first.
import postgres from 'postgres';
import fs from 'node:fs';
import path from 'node:path';

const url = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/silambam';
const sql = postgres(url, { onnotice: () => {} });
const dir = path.join(process.cwd(), 'db', 'migrations');

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
} finally {
  await sql.end();
}
