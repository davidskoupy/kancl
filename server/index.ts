import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import { join, extname, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store, type HookPayload } from './state.ts';
import { focusTerminal } from './focus.ts';
import type { ServerMessage } from '../shared/types.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.KANCL_PORT ?? 4242);
const HOST = process.env.KANCL_HOST ?? '127.0.0.1';
const DIST = resolve(__dirname, '../dist');

const store = new Store();
const clients = new Set<http.ServerResponse>();

store.listeners.add((m: ServerMessage) => {
  const line = `data: ${JSON.stringify(m)}\n\n`;
  for (const res of clients) res.write(line);
});

setInterval(() => {
  store.tick(pid => {
    try { process.kill(pid, 0); return true; } catch (e: any) { return e?.code === 'EPERM'; }
  });
  for (const res of clients) res.write(': keepalive\n\n');
}, 5000).unref();

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function json(res: http.ServerResponse, code: number, body: unknown) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(body));
}

async function readBody(req: http.IncomingMessage, limit = 1_000_000): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    let data = '';
    req.on('data', c => {
      data += c;
      if (data.length > limit) { reject(new Error('body too large')); req.destroy(); }
    });
    req.on('end', () => resolvePromise(data));
    req.on('error', reject);
  });
}

async function serveStatic(res: http.ServerResponse, urlPath: string) {
  let file = join(DIST, urlPath === '/' ? 'index.html' : urlPath);
  if (!file.startsWith(DIST)) { res.writeHead(403); return res.end(); }
  try {
    const st = await stat(file);
    if (st.isDirectory()) file = join(file, 'index.html');
  } catch {
    file = join(DIST, 'index.html'); // SPA fallback
  }
  if (!existsSync(file)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('Klient není sestavený. Spusť `npm run build` (nebo `npm run dev` pro Vite dev server).');
  }
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const path = url.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }

  try {
    // ---- Hook ingestion ------------------------------------------------
    if (req.method === 'POST' && path === '/hook') {
      const raw = await readBody(req);
      let payload: HookPayload;
      try { payload = JSON.parse(raw); } catch { return json(res, 400, { error: 'bad json' }); }
      if (!payload.hook) payload = { hook: payload as any };
      const ev = payload.hook.hook_event_name;
      const s = store.apply(payload);
      if (process.env.KANCL_DEBUG) console.log(`[hook] ${ev} ${s?.name ?? ''} ${s?.status ?? 'removed'}`);
      return json(res, 200, { ok: true });
    }

    // ---- API -----------------------------------------------------------
    if (req.method === 'GET' && path === '/api/sessions') {
      return json(res, 200, { sessions: store.list(), serverStartedAt: store.serverStartedAt });
    }

    if (req.method === 'GET' && path === '/api/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      });
      res.write('retry: 2000\n\n');
      const snapshot: ServerMessage = { type: 'snapshot', sessions: store.list(), projects: [], serverStartedAt: store.serverStartedAt };
      res.write(`data: ${JSON.stringify(snapshot)}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }

    const focusMatch = path.match(/^\/api\/sessions\/([^/]+)\/focus$/);
    if (req.method === 'POST' && focusMatch) {
      const s = store.sessions.get(decodeURIComponent(focusMatch[1]));
      if (!s) return json(res, 404, { error: 'unknown session' });
      const result = await focusTerminal(s.terminal);
      return json(res, 200, { ok: true, result });
    }

    const delMatch = path.match(/^\/api\/sessions\/([^/]+)$/);
    if (req.method === 'DELETE' && delMatch) {
      store.remove(decodeURIComponent(delMatch[1]));
      return json(res, 200, { ok: true });
    }

    if (req.method === 'GET' && path === '/api/health') {
      return json(res, 200, { ok: true, sessions: store.sessions.size, uptime: process.uptime() });
    }

    // ---- Static client -------------------------------------------------
    if (req.method === 'GET') return serveStatic(res, path);

    res.writeHead(405); res.end();
  } catch (e: any) {
    console.error(e);
    json(res, 500, { error: String(e?.message ?? e) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Kancl → http://${HOST}:${PORT}`);
  console.log(`  hooky posílají POST http://${HOST}:${PORT}/hook`);
  if (!existsSync(join(DIST, 'index.html'))) {
    console.log('  (klient není sestavený: spusť `npm run build`, nebo `npm run dev`)');
  }
  if (process.argv.includes('--open') && process.platform === 'darwin') {
    import('node:child_process').then(({ exec }) => exec(`open http://127.0.0.1:${PORT}`));
  }
});
