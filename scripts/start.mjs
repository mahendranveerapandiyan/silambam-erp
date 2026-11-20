// `npm start`: runs the production build (Next.js "standalone" output).
// Copies static assets next to the server, loads .env.local if present, then starts it.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const root = process.cwd();
const sa = path.join(root, '.next', 'standalone');
if (!fs.existsSync(path.join(sa, 'server.js'))) {
  console.error('No production build found. Run: npm run build');
  process.exit(1);
}
fs.cpSync(path.join(root, '.next', 'static'), path.join(sa, '.next', 'static'), { recursive: true });
if (fs.existsSync(path.join(root, 'public'))) fs.cpSync(path.join(root, 'public'), path.join(sa, 'public'), { recursive: true });
for (const f of ['.env.local', '.env']) if (fs.existsSync(path.join(root, f))) process.loadEnvFile(path.join(root, f));

const env = { ...process.env, NODE_ENV: 'production', PORT: process.env.PORT || '3000', HOSTNAME: process.env.HOSTNAME_BIND || '0.0.0.0' };
console.log(`Starting Silambam ERP on http://localhost:${env.PORT}`);
const child = spawn(process.execPath, [path.join(sa, 'server.js')], { env, stdio: 'inherit', cwd: sa });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
child.on('exit', (code) => process.exit(code ?? 0));
