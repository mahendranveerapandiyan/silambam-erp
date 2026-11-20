import { sql } from '@/lib/db';

/** Diagnostics: is the database reachable, migrated and seeded? (no private data) */
export async function GET() {
  const out: Record<string, unknown> = { app: 'ok', time: new Date().toISOString() };
  try {
    await sql`select 1`;
    out.database = 'ok';
    try {
      out.migrations = (await sql`select name from schema_migrations order by name`).map((r) => r.name);
    } catch {
      out.migrations = 'none – run: npm run db:migrate';
    }
    try {
      const [r] = await sql`select (select count(*) from enterprise)::int enterprises, (select count(*) from user_account)::int users`;
      out.seeded = r.enterprises > 0 ? 'yes' : 'no – run: node scripts/seed.mjs --demo';
      out.users = r.users;
    } catch {
      out.seeded = 'no tables yet';
    }
  } catch (e) {
    out.database = 'NOT REACHABLE';
    out.error = (e as Error).message;
    out.hint = 'Start PostgreSQL and check DATABASE_URL in .env.local';
  }
  out.session_secret = process.env.SESSION_SECRET ? 'set' : 'MISSING – add SESSION_SECRET to .env.local';
  return Response.json(out, { status: out.database === 'ok' ? 200 : 503, headers: { 'Cache-Control': 'no-store' } });
}
