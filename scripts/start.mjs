// `npm start`: runs the production build (Next.js "standalone" output).
// Copies static assets next to the server, loads .env.local if present, then starts it.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import net from 'node:net';

const root = process.cwd();
const sa = path.join(root, '.next', 'standalone');
if (!fs.existsSync(path.join(sa, 'server.js'))) {
  console.error('No production build found. Run: npm run build');
  process.exit(1);
}
fs.cpSync(path.join(root, '.next', 'static'), path.join(sa, '.next', 'static'), { recursive: true });
if (fs.existsSync(path.join(root, 'public'))) fs.cpSync(path.join(root, 'public'), path.join(sa, 'public'), { recursive: true });
for (const f of ['.env.local', '.env']) if (fs.existsSync(path.join(root, f))) process.loadEnvFile(path.join(root, f));

const port = Number(process.env.PORT || 3000);
const free = await new Promise((resolve) => {
  const t = net.createServer().once('error', () => resolve(false)).once('listening', () => t.close(() => resolve(true))).listen(port, '0.0.0.0');
});
if (!free) {
  console.error(`\nPort ${port} is already in use - another copy of the app (or "npm run dev") is still running.`);
  console.error(`Stop it with:   npx --yes kill-port ${port}`);
  console.error('Then run:       npm start\n');
  process.exit(1);
}

const env = { ...process.env, NODE_ENV: 'production', PORT: process.env.PORT || '3000', HOSTNAME: process.env.HOSTNAME_BIND || '0.0.0.0' };
console.log(`Starting Silambam ERP on http://localhost:${env.PORT}`);
const child = spawn(process.execPath, [path.join(sa, 'server.js')], { env, stdio: 'inherit', cwd: sa });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
child.on('exit', (code) => process.exit(code ?? 0));
