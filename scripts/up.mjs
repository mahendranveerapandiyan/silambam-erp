// `npm run up` – one command to (re)start the app, e.g. in GitHub Codespaces:
//   1. waits for the database   2. applies migrations   3. builds if the code changed
//   4. frees the port           5. starts the app (default port 3001)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import postgres from 'postgres';

const root = process.cwd();
for (const f of ['.env.local', '.env']) if (fs.existsSync(path.join(root, f))) process.loadEnvFile(path.join(root, f));
const PORT = process.env.PORT || '3001';
const url = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/silambam';
const step = (n, t) => console.log(`\n[${n}/5] ${t}`);
const run = (cmd, args) => spawnSync(cmd, args, { stdio: 'inherit', env: process.env }).status === 0;

step(1, 'Checking the database…');
let ok = false;
for (let i = 0; i < 30 && !ok; i++) {
  const sql = postgres(url, { connect_timeout: 3, onnotice: () => {} });
  try { await sql`select 1`; ok = true; } catch { await new Promise((r) => setTimeout(r, 1000)); }
  await sql.end({ timeout: 1 }).catch(() => {});
}
if (!ok) {
  console.error(`
  The database is not reachable (${url.replace(/:[^:@/]+@/, ':****@')}).
  In Codespaces try one of:
    • Rebuild the container:  F1 → "Codespaces: Rebuild Container"   (keeps your data)
    • Or start a database:     docker start pg   (if you created it with "docker run --name pg …")
  Then run:  npm run up`);
  process.exit(1);
}
console.log('    database OK');

step(2, 'Applying database updates…');
if (!run('node', ['scripts/migrate.mjs'])) process.exit(1);

step(3, 'Checking whether the app needs building…');
const head = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
const marker = path.join(root, '.next', '.built-commit');
const built = fs.existsSync(marker) ? fs.readFileSync(marker, 'utf8').trim() : '';
const hasBuild = fs.existsSync(path.join(root, '.next', 'standalone', 'server.js'));
if (!hasBuild || !head || built !== head) {
  console.log('    building (about a minute)…');
  if (!run('npx', ['next', 'build'])) { console.error('\n  The build failed – copy the red lines above and send them.'); process.exit(1); }
  if (head) fs.writeFileSync(marker, head);
} else console.log('    already built for the current code');

step(4, `Freeing port ${PORT}…`);
spawnSync('npx', ['--yes', 'kill-port', PORT], { stdio: 'ignore' });

step(5, `Starting the app on port ${PORT}…`);
console.log(`    In Codespaces open the PORTS tab and click the globe next to ${PORT}.\n    Keep this terminal open – closing it stops the app.\n`);
const child = spawn('node', ['scripts/start.mjs'], { stdio: 'inherit', env: { ...process.env, PORT } });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
child.on('exit', (code) => process.exit(code ?? 0));
