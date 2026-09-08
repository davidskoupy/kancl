/**
 * Cloud přes most — čistý parser snímku `~/.kancl/cloud.json`, který zapisuje naplánovaná úloha Claude.
 * Žádné I/O, žádný token.
 */
import type { CloudSession, Job, JobState } from '../shared/types.ts';
import { parseCron, scheduleHuman } from './night.ts';

export interface SnapshotRoutine {
  id: string; name: string;
  cron?: string | null; runOnceAt?: string | null; enabled?: boolean;
  nextRunAt?: string | null;
  lastRun?: { firedAt?: string | null; finishedAt?: string | null; status?: string | null; sessionId?: string | null } | null;
  model?: string | null; endedReason?: string | null; url?: string | null;
}
export interface SnapshotSession { id: string; name: string; kind: string; status?: string; url?: string }
export interface CloudSnapshot { version?: number; takenAt?: number | string; routines?: SnapshotRoutine[]; sessions?: SnapshotSession[]; error?: string }

export interface ParsedCloud { jobs: Job[]; sessions: CloudSession[]; takenAt?: number; error?: string }

const RESULT_WINDOW = 3 * 3600_000;

function ms(v?: string | number | null): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const n = typeof v === 'number' ? v : Date.parse(v);
  return Number.isFinite(n) ? n : undefined;
}

/** Cron routin je v UTC → posunout hodiny o `offsetMin` (např. +120 pro CEST) a popsat česky. */
export function scheduleHumanUtc(cron: string, offsetMin: number): string {
  const spec = parseCron(cron);
  if (!spec) return cron;
  const shift = Math.round(offsetMin / 60);
  const f = cron.trim().split(/\s+/);
  const hours = spec.hour.map(h => (((h + shift) % 24) + 24) % 24).sort((a, b) => a - b);
  // posun přes půlnoc by měnil den; pro rozvrhy s konkrétním dnem to zanedbáme (dny se v Praze ráno nemění)
  const shifted = [f[0], hours.join(','), f[2], f[3], f[4]].join(' ');
  return scheduleHuman(shifted);
}

function routineState(r: SnapshotRoutine, now: number): JobState {
  if (r.enabled === false || r.endedReason) return 'vypnuto';
  const st = (r.lastRun?.status ?? '').toLowerCase();
  if (st === 'running') return 'bezi';
  const finished = ms(r.lastRun?.finishedAt) ?? ms(r.lastRun?.firedAt);
  if (finished !== undefined && now - finished < RESULT_WINDOW) return st === 'fail' ? 'chyba' : st === 'ok' ? 'ok' : 'spi';
  return 'spi';
}

export function parseCloudSnapshot(text: string | undefined, now: number, offsetMin = -new Date().getTimezoneOffset()): ParsedCloud {
  if (!text) return { jobs: [], sessions: [] };
  let snap: CloudSnapshot;
  try { snap = JSON.parse(text); } catch { return { jobs: [], sessions: [], error: 'cloud.json se nedá načíst' }; }
  const takenAt = ms(snap.takenAt);
  const jobs: Job[] = (snap.routines ?? []).map(r => {
    const cron = r.cron || undefined;
    const fireAt = ms(r.runOnceAt);
    const lastRunAt = ms(r.lastRun?.firedAt);
    const finishedAt = ms(r.lastRun?.finishedAt);
    const st = (r.lastRun?.status ?? '').toLowerCase();
    const job: Job = {
      id: `routine:${r.id}`, source: 'routine',
      name: r.name, description: r.model ? `cloudová routina · ${r.model}` : 'cloudová routina',
      schedule: cron ?? '', scheduleHuman: cron ? scheduleHumanUtc(cron, offsetMin) : scheduleHuman(undefined, fireAt),
      enabled: r.enabled !== false && !r.endedReason,
      fireAt, lastRunAt, nextRunAt: r.enabled === false || r.endedReason ? undefined : ms(r.nextRunAt),
      url: r.url ?? undefined, model: r.model ?? undefined,
      state: routineState(r, now),
    };
    if (lastRunAt && (st === 'ok' || st === 'fail' || st === 'running')) {
      const dur = finishedAt && lastRunAt ? Math.round((finishedAt - lastRunAt) / 1000) : undefined;
      job.lastResult = {
        at: lastRunAt, result: st === 'fail' ? 'fail' : 'ok',
        resultText: st === 'running' ? 'běží' : st === 'ok' ? `✅ uspělo${dur !== undefined ? ` (${dur} s)` : ''}` : `⚠️ selhalo${dur !== undefined ? ` (${dur} s)` : ''}`,
      };
    }
    return job;
  });
  const sessions: CloudSession[] = (snap.sessions ?? [])
    .map(s => ({
      id: s.id, name: s.name,
      kind: (s.kind === 'remote-control' ? 'remote-control' : 'cloud') as CloudSession['kind'],
      status: (s.status === 'working' || s.status === 'offline' ? s.status : 'idle') as CloudSession['status'],
      url: s.url,
    }))
    .filter(s => s.kind === 'cloud' || s.status !== 'offline');
  return { jobs, sessions, takenAt, error: snap.error };
}
