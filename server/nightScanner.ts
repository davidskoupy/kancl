/**
 * Noční směna — I/O: naplánované úlohy Claude (scheduled-tasks.json), SKILL.md, runs.md a state.json
 * obsahových enginů. Jen čtení, každých 60 s, publikuje jen při změně.
 */
import { readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Config, EngineConfig } from './config.ts';
import { expandHome } from './config.ts';
import { deriveJobState, nextRun, parseRunsMd, parseStock, readFrontmatter, scheduleHuman, type RunRow } from './night.ts';
import type { Store } from './state.ts';
import type { Job, NightShift, Stock } from '../shared/types.ts';
import { parseCloudSnapshot } from './cloud.ts';

const SESSIONS_DIR = join(homedir(), 'Library', 'Application Support', 'Claude', 'claude-code-sessions');
const STALE = 7 * 24 * 3600_000;

interface RawTask {
  id: string;
  cronExpression?: string;
  fireAt?: string | number;
  enabled?: boolean;
  filePath?: string;
  lastRunAt?: string | number;
  cwd?: string;
}

async function readJson<T>(path: string): Promise<T | undefined> {
  try { return JSON.parse(await readFile(path, 'utf8')) as T; } catch { return undefined; }
}

async function readText(path: string): Promise<string | undefined> {
  try { return await readFile(path, 'utf8'); } catch { return undefined; }
}

function ms(v?: string | number): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const n = typeof v === 'number' ? v : Date.parse(v);
  return Number.isFinite(n) ? n : undefined;
}

export class NightScanner {
  night: NightShift = { jobs: [], cloudSessions: [], scannedAt: 0 };
  private lastJson = '';
  private timer?: NodeJS.Timeout;

  constructor(private cfg: Config, private store: Store, private onChange: (n: NightShift) => void) {}

  async start() {
    if (!this.cfg.night.enabled) return;
    await this.scan().catch(e => console.error('[night]', e));
    this.timer = setInterval(() => this.scan().catch(e => console.error('[night]', e)), 60_000);
    this.timer.unref();
  }

  /** Všechny scheduled-tasks.json pod claude-code-sessions/<a>/<b>/. */
  private async taskFiles(): Promise<string[]> {
    const out: string[] = [];
    let level1: string[] = [];
    try { level1 = await readdir(SESSIONS_DIR); } catch { return out; }
    for (const a of level1) {
      let level2: string[] = [];
      try { level2 = await readdir(join(SESSIONS_DIR, a)); } catch { continue; }
      for (const b of level2) out.push(join(SESSIONS_DIR, a, b, 'scheduled-tasks.json'));
    }
    return out;
  }

  private async scanTasks(now: number): Promise<Job[]> {
    const merged = new Map<string, RawTask>();
    for (const file of await this.taskFiles()) {
      const data = await readJson<{ scheduledTasks?: RawTask[] }>(file);
      for (const t of data?.scheduledTasks ?? []) {
        if (!t?.id) continue;
        const prev = merged.get(t.id);
        if (!prev || (ms(t.lastRunAt) ?? 0) >= (ms(prev.lastRunAt) ?? 0)) merged.set(t.id, t);
      }
    }
    const jobs: Job[] = [];
    for (const t of merged.values()) {
      const fm = t.filePath ? readFrontmatter((await readText(t.filePath)) ?? '') : {};
      const lastRunAt = ms(t.lastRunAt);
      const fireAt = ms(t.fireAt);
      const enabled = t.enabled !== false;
      // skrýt staré vypnuté/jednorázové, které dávno proběhly nebo nikdy nevystřelily
      const futureFire = !!fireAt && fireAt > now;
      if (!enabled && (!lastRunAt || now - lastRunAt > STALE) && !futureFire) continue;
      if (!t.cronExpression && !futureFire && !lastRunAt) continue;
      let nextRunAt: number | undefined;
      if (t.cronExpression) nextRunAt = nextRun(t.cronExpression, new Date(now))?.getTime();
      else if (fireAt && fireAt > now) nextRunAt = fireAt;
      jobs.push({
        id: t.id, source: 'claude',
        name: fm.name || t.id, description: fm.description,
        schedule: t.cronExpression ?? '', scheduleHuman: scheduleHuman(t.cronExpression, fireAt),
        enabled, cwd: t.cwd, projectId: t.cwd ? this.store.projectResolver?.(t.cwd) : undefined,
        filePath: t.filePath, fireAt, lastRunAt, nextRunAt: enabled ? nextRunAt : undefined,
        state: 'spi',
      });
    }
    return jobs;
  }

  private async scanEngine(e: EngineConfig): Promise<{ lastRun?: RunRow; alarm?: RunRow; next?: string }> {
    const text = await readText(expandHome(e.runsFile));
    if (!text) return {};
    const rows = parseRunsMd(text, e.columns);
    const runs = rows.filter(r => r.kind === 'run');
    const alarms = rows.filter(r => r.kind === 'alarm');
    let next: string | undefined;
    if (e.stateFile) {
      const st = await readJson<{ posledni_projekt?: string; poradi?: string[] }>(expandHome(e.stateFile));
      if (st?.poradi?.length) {
        const i = st.poradi.indexOf(st.posledni_projekt ?? '');
        next = st.poradi[(i + 1) % st.poradi.length];
      }
    }
    return { lastRun: runs[runs.length - 1], alarm: alarms[alarms.length - 1], next };
  }

  async scan() {
    const now = Date.now();
    const jobs = await this.scanTasks(now);
    let stock: Stock | undefined;
    for (const e of this.cfg.night.engines) {
      const { lastRun, alarm, next } = await this.scanEngine(e);
      const job = jobs.find(j => j.id === e.taskId);
      if (job && lastRun) {
        job.lastResult = {
          at: lastRun.at, result: lastRun.result, resultText: lastRun.resultText,
          project: lastRun.project, slug: lastRun.slug, note: lastRun.note?.slice(0, 200),
        };
        if (next && !job.description?.includes('zítra')) job.description = `${job.description ?? ''}${job.description ? ' · ' : ''}zítra na řadě: ${next}`;
      }
      if (alarm?.note && !stock) {
        const items = parseStock(alarm.note);
        if (items.length) stock = { engine: e.id, at: alarm.at, items };
      }
    }
    for (const j of jobs) {
      j.state = deriveJobState({ enabled: j.enabled, lastRunAt: j.lastRunAt, lastResultAt: j.lastResult?.at, lastResult: j.lastResult?.result }, now);
      // jednorázová úloha, která už proběhla a je vypnutá = hotovo (šedě), ne „spí"
      if (!j.enabled && j.state === 'spi') j.state = 'vypnuto';
    }
    // cloud přes most: snímek z naplánované úlohy kancl-cloud-snapshot
    const cloud = parseCloudSnapshot(await readText(expandHome(this.cfg.night.cloudSnapshot)), now);
    jobs.push(...cloud.jobs);
    const rank = (j: Job) => (j.state === 'bezi' ? 0 : j.state === 'chyba' ? 1 : j.state === 'vypnuto' ? 3 : 2);
    jobs.sort((a, b) => rank(a) - rank(b) || (b.lastRunAt ?? 0) - (a.lastRunAt ?? 0) || (a.nextRunAt ?? Infinity) - (b.nextRunAt ?? Infinity));
    const night: NightShift = { jobs, stock, cloudSessions: cloud.sessions, snapshotAt: cloud.takenAt, snapshotError: cloud.error, scannedAt: now };
    const json = JSON.stringify({ ...night, scannedAt: 0 });
    if (json === this.lastJson) return;
    this.lastJson = json;
    this.night = night;
    this.onChange(night);
  }
}
