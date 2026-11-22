// Stops a running copy of the app on a port – reliably, also in containers
// (Codespaces) where `lsof` / `kill-port` cannot see the process.
//   1. the process ids the app recorded when it started (.app-<port>.pid)
//   2. `fuser`, then `lsof`, as fallbacks
// Usage: node scripts/stop.mjs [port]   ·   import { stopApp } from './stop.mjs'
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawnSync } from 'node:child_process';

export const pidFile = (port) => path.join(process.cwd(), `.app-${port}.pid`);

export const portFree = (port) => new Promise((resolve) => {
  const t = net.createServer().once('error', () => resolve(false)).once('listening', () => t.close(() => resolve(true))).listen(Number(port), '0.0.0.0');
});

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

function pidsOnPort(port) {
  const out = new Set();
  const f = spawnSync('fuser', ['-n', 'tcp', String(port)], { encoding: 'utf8' });
  for (const m of `${f.stdout ?? ''} ${f.stderr ?? ''}`.replace(/^[^:]*:/m, '').matchAll(/\b(\d+)\b/g)) out.add(Number(m[1]));
  const l = spawnSync('lsof', ['-t', '-i', `tcp:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' });
  for (const m of (l.stdout ?? '').matchAll(/\d+/g)) out.add(Number(m[0]));
  // no fuser / lsof (or they cannot see it): find the listening socket in /proc
  try {
    const hex = Number(port).toString(16).toUpperCase().padStart(4, '0');
    const inodes = new Set();
    for (const f of ['/proc/net/tcp', '/proc/net/tcp6']) {
      if (!fs.existsSync(f)) continue;
      for (const line of fs.readFileSync(f, 'utf8').split('\n').slice(1)) {
        const c = line.trim().split(/\s+/);
        if (c[1]?.endsWith(`:${hex}`) && c[3] === '0A') inodes.add(c[9]); // 0A = LISTEN
      }
    }
    if (inodes.size) for (const pid of fs.readdirSync('/proc').filter((d) => /^\d+$/.test(d))) {
      try {
        for (const fd of fs.readdirSync(`/proc/${pid}/fd`)) {
          const m = fs.readlinkSync(`/proc/${pid}/fd/${fd}`).match(/^socket:\[(\d+)\]$/);
          if (m && inodes.has(m[1])) { out.add(Number(pid)); break; }
        }
      } catch {}
    }
  } catch {}
  out.delete(process.pid);
  return [...out].filter((p) => p > 1);
}

/** Stop whatever runs on the port. Returns true when the port is free. */
export async function stopApp(port) {
  if (await portFree(port)) { fs.rmSync(pidFile(port), { force: true }); return true; }
  const recorded = fs.existsSync(pidFile(port)) ? fs.readFileSync(pidFile(port), 'utf8').match(/\d+/g)?.map(Number) ?? [] : [];
  for (const sig of ['SIGTERM', 'SIGKILL']) {
    for (const pid of [...recorded, ...pidsOnPort(port)]) if (pid !== process.pid && alive(pid)) { try { process.kill(pid, sig); } catch {} }
    for (let i = 0; i < 20; i++) { if (await portFree(port)) { fs.rmSync(pidFile(port), { force: true }); return true; } await new Promise((r) => setTimeout(r, 250)); }
  }
  return portFree(port);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const port = process.argv[2] || process.env.PORT || '3001';
  const ok = await stopApp(port);
  console.log(ok ? `Port ${port} is free.` : `Could not free port ${port}. Close the terminal running the app (or reload the Codespace) and try again.`);
  process.exit(ok ? 0 : 1);
}
