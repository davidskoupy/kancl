import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import { join, extname, resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { Store, type HookPayload } from './state.ts';
import { focusTerminal } from './focus.ts';
import { loadConfig } from './config.ts';
import { Scanner } from './scanner.ts';
import { NightScanner } from './nightScanner.ts';
import { DesktopIndex } from './desktop.ts';
import { History, digest as buildDigest } from './history.ts';
import { expandHome } from './config.ts';
import type { ServerMessage } from '../shared/types.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.KANCL_PORT ?? 4242);
const HOST = process.env.KANCL_HOST ?? '127.0.0.1';
const DIST = resolve(__dirname, '../dist');

const store = new Store();
const clients = new Set<http.ServerResponse>();

const config = loadConfig();
const desktop = new DesktopIndex(undefined, () => store.refreshDesktop());
store.desktopResolver = id => { const d = desktop.lookup(id); return d ? { desktopId: d.desktopId, title: d.title } : undefined; };
const night = new NightScanner(config, store, n => {
  const msg: ServerMessage = { type: 'night', night: n };
  const line = `data: ${JSON.stringify(msg)}\n\n`;
  for (const res of clients) res.write(line);
  for (const j of n.jobs) {
    if ((j.state === 'ok' || j.state === 'chyba') && j.lastRunAt) {
      const r = j.lastResult;
      const what = r ? `${r.project ? r.project + ' ' : ''}${r.resultText}${r.slug ? ' ' + r.slug : ''}` : j.state === 'ok' ? 'proběhlo' : 'selhalo';
      history.add({ at: j.lastRunAt, kind: j.state === 'ok' ? 'job_ok' : 'job_fail', title: `${j.name} · ${what}`.slice(0, 160), ref: `${j.id}:${j.lastRunAt}`, detail: r?.note?.slice(0, 200) }).catch(() => {});
    }
  }
  if (n.stock?.items.some(i => i.alarm)) {
    history.add({ at: n.stock.at, kind: 'stock_alarm', title: `zásoba témat: ${n.stock.items.filter(i => i.alarm).map(i => `${i.project} ${i.pending}`).join(', ')}`, ref: String(n.stock.at) }).catch(() => {});
  }
});
const history = new History(expandHome('~/.kancl/history.jsonl'));
const scanner = new Scanner(config, store, projects => {
  const msg: ServerMessage = { type: 'projects', projects };
  const line = `data: ${JSON.stringify(msg)}\n\n`;
  for (const res of clients) res.write(line);
  for (const p of projects) {
    if (p.ci?.status === 'fail' && p.ci.at) {
      history.add({ at: p.ci.at, kind: 'ci_fail', title: `${p.name} · ${p.ci.name ?? 'workflow'} selhal`, project: p.name, ref: `${p.id}:${p.ci.at}`, detail: p.ci.url }).catch(() => {});
    }
  }
});
store.onSessionEnd = (s, reason) => {
  const mins = Math.round((Date.now() - s.startedAt) / 60_000);
  history.add({
    at: Date.now(), kind: 'session_end', title: s.title ?? s.name, project: s.project, ref: s.id,
    detail: `${s.name} · ${s.turns} ${s.turns === 1 ? 'tah' : s.turns < 5 ? 'tahy' : 'tahů'} · ${s.toolCalls} nástrojů · ${mins} min${reason ? ' · ' + reason : ''}${s.message ? ' · ' + s.message.slice(0, 120) : ''}`,
  }).catch(() => {});
};

store.listeners.add((m: ServerMessage) => {
  const line = `data: ${JSON.stringify(m)}\n\n`;
  for (const res of clients) res.write(line);
  if (m.type === 'upsert' || m.type === 'remove') scanner.publish();
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
      if (ev === 'Stop' && s?.projectId) scanner.refreshRemotes(s.projectId).catch(() => {});
      if (process.env.KANCL_DEBUG) console.log(`[hook] ${ev} ${s?.name ?? ''} ${s?.status ?? 'removed'}`);
      return json(res, 200, { ok: true });
    }

    // ---- API -----------------------------------------------------------
    // otevřít SKILL.md úlohy ve výchozí aplikaci (jen soubory pod ~/.claude/scheduled-tasks)
    if (req.method === 'POST' && path === '/api/open') {
      const raw = await readBody(req);
      let body: { path?: string } = {};
      try { body = JSON.parse(raw); } catch { return json(res, 400, { error: 'bad json' }); }
      const allowed = join(homedir(), '.claude', 'scheduled-tasks') + '/';
      const target = resolve(String(body.path ?? ''));
      if (!target.startsWith(allowed) || !existsSync(target)) return json(res, 403, { error: 'cesta není povolená' });
      const { execFile } = await import('node:child_process');
      execFile('open', ['-t', target], () => {});
      return json(res, 200, { ok: true });
    }

    if (req.method === 'GET' && path === '/api/history') {
      const from = Number(url.searchParams.get('since') ?? 0) || 0;
      return json(res, 200, { events: history.events.filter(e => e.at >= from).sort((a, b) => a.at - b.at) });
    }

    if (req.method === 'GET' && path === '/api/digest') {
      const to = Number(url.searchParams.get('to') ?? Date.now()) || Date.now();
      const yesterday18 = (() => { const d = new Date(to); d.setDate(d.getDate() - 1); d.setHours(18, 0, 0, 0); return d.getTime(); })();
      const from = Number(url.searchParams.get('since') ?? yesterday18) || yesterday18;
      const d = buildDigest(history.events, from, to);
      const waiting = store.list().filter(s => s.status === 'permission' || s.status === 'waiting' || s.status === 'error').map(s => ({ id: s.id, name: s.title ?? s.name, status: s.status, since: s.statusSince, project: s.project, message: s.message }));
      const ci = scanner.projects.filter(p => p.ci?.status === 'fail').map(p => ({ project: p.name, name: p.ci!.name, at: p.ci!.at, url: p.ci!.url }));
      return json(res, 200, { ...d, waitingNow: waiting, ciFailingNow: ci, stockNow: night.night.stock, snapshotAt: night.night.snapshotAt });
    }

    // kompaktní stav pro widgety (menu bar, telefon)
    if (req.method === 'GET' && path === '/api/widget') {
      const now = Date.now();
      const all = store.list();
      const ATT: Record<string, number> = { permission: 0, error: 1, waiting: 2, completed: 3 };
      const queue = all.filter(s => s.status in ATT).sort((a, b) => ATT[a.status] - ATT[b.status] || a.statusSince - b.statusSince)
        .map(s => ({ id: s.id, name: s.title ?? s.name, nick: s.title ? s.name : null, status: s.status, since: s.statusSince, project: s.project, message: s.message ?? null }));
      const working = scanner.projects.filter(p => p.status !== 'klid').map(p => ({ name: p.name, sessions: all.filter(s => s.projectId === p.id).length }));
      const jobs = night.night.jobs;
      const upcoming = jobs.filter(j => j.nextRunAt && j.nextRunAt > now).sort((a, b) => a.nextRunAt! - b.nextRunAt!)[0];
      const body = {
        at: now,
        sessions: { total: all.length, working: all.filter(s => s.status === 'working').length, attention: queue.length },
        queue: queue.slice(0, 10),
        working,
        night: {
          ok: jobs.filter(j => j.state === 'ok').length, fail: jobs.filter(j => j.state === 'chyba').length,
          running: jobs.filter(j => j.state === 'bezi').length, sleeping: jobs.filter(j => j.state === 'spi').length,
          snapshotAt: night.night.snapshotAt ?? null, snapshotOld: !!night.night.snapshotAt && now - night.night.snapshotAt > 2 * 3600_000,
          nextName: upcoming?.name ?? null, nextAt: upcoming?.nextRunAt ?? null,
        },
        ci: scanner.projects.filter(p => p.ci?.status === 'fail').map(p => ({ project: p.name, name: p.ci!.name ?? null, url: p.ci!.url ?? null })),
        stock: night.night.stock?.items ?? [],
      };
      return json(res, 200, body);
    }

    if (req.method === 'GET' && path === '/api/night') {
      return json(res, 200, { night: night.night });
    }

    if (req.method === 'GET' && path === '/api/projects') {
      return json(res, 200, { projects: scanner.projects });
    }

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
      const snapshot: ServerMessage = { type: 'snapshot', sessions: store.list(), projects: scanner.projects, night: night.night, serverStartedAt: store.serverStartedAt };
      res.write(`data: ${JSON.stringify(snapshot)}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }

    const focusMatch = path.match(/^\/api\/sessions\/([^/]+)\/focus$/);
    if (req.method === 'POST' && focusMatch) {
      const s = store.sessions.get(decodeURIComponent(focusMatch[1]));
      if (!s) return json(res, 404, { error: 'unknown session' });
      const result = await focusTerminal(s.terminal, s.desktopId, s.title);
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
  history.load().catch(e => console.error('[history]', e));
  desktop.start().catch(e => console.error('[desktop]', e));
  scanner.start().then(() => night.start()).catch(e => console.error('[scanner]', e));
  console.log(`  hooky posílají POST http://${HOST}:${PORT}/hook`);
  if (!existsSync(join(DIST, 'index.html'))) {
    console.log('  (klient není sestavený: spusť `npm run build`, nebo `npm run dev`)');
  }
  if (process.argv.includes('--open') && process.platform === 'darwin') {
    import('node:child_process').then(({ exec }) => exec(`open http://127.0.0.1:${PORT}`));
  }
});
