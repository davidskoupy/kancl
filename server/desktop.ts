/**
 * Index sezení desktopové aplikace Claude: `local_*.json` → název sezení a id pro deep link.
 * Jen čtení, každých 60 s.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface DesktopSession { desktopId: string; cliSessionId?: string; title?: string; lastActivityAt?: number; lastFocusedAt?: number; isArchived: boolean; cwd?: string; scheduled: boolean; starred: boolean; error?: string; turns?: number; summary?: TurnSummary }

const CATEGORIES = new Set(['completed', 'blocked', 'review_ready']);

/** `postTurnSummary` z aplikace: jednořádkový výsledek posledního tahu a případně to, co se po tobě chce. */
export function parseSummary(raw: any): TurnSummary | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 200) : undefined);
  const detail = text(raw.status_detail);
  const action = text(raw.needs_action);
  if (!detail && !action) return undefined;
  const cat = typeof raw.status_category === 'string' && CATEGORIES.has(raw.status_category) ? raw.status_category : 'other';
  // aplikace do obojího často dá tu samou větu (typicky otázka u blocked) — pak stačí jednou, jako „chce tě"
  return { category: cat as TurnSummary['category'], detail: detail === action ? undefined : detail, action };
}

const SESSIONS_DIR = join(homedir(), 'Library', 'Application Support', 'Claude', 'claude-code-sessions');

/** Čistá část: z obsahu local_*.json udělá záznam (nebo undefined, když nejde o sezení s CLI id). */
export function parseDesktopSession(raw: string): { cliSessionId: string; session: DesktopSession } | undefined {
  let d: any;
  try { d = JSON.parse(raw); } catch { return undefined; }
  if (!d || typeof d.cliSessionId !== 'string' || typeof d.sessionId !== 'string') return undefined;
  return {
    cliSessionId: d.cliSessionId,
    session: {
      desktopId: d.sessionId,
      cliSessionId: d.cliSessionId,
      title: typeof d.title === 'string' && d.title.trim() ? d.title.trim() : undefined,
      lastActivityAt: typeof d.lastActivityAt === 'number' ? d.lastActivityAt : undefined,
      lastFocusedAt: typeof d.lastFocusedAt === 'number' ? d.lastFocusedAt : undefined,
      isArchived: d.isArchived === true,
      cwd: typeof d.cwd === 'string' ? d.cwd : undefined,
      scheduled: typeof d.scheduledTaskId === 'string' && d.scheduledTaskId.length > 0,
      starred: d.isStarred === true,
      error: typeof d.error === 'string' ? d.error.slice(0, 160) : undefined,
      turns: typeof d.completedTurns === 'number' ? d.completedTurns : undefined,
      summary: parseSummary(d.postTurnSummary),
    },
  };
}

export class DesktopIndex {
  private byCli = new Map<string, DesktopSession>();
  private mtimes = new Map<string, number>();
  private timer?: NodeJS.Timeout;
  private dir: string;

  constructor(dir = SESSIONS_DIR, private onChange?: () => void) { this.dir = dir; }

  lookup(cliSessionId: string): DesktopSession | undefined { return this.byCli.get(cliSessionId); }
  get size() { return this.byCli.size; }
  all(): DesktopSession[] { return [...this.byCli.values()]; }

  async start() {
    await this.scan().catch(e => console.error('[desktop]', e));
    this.timer = setInterval(() => this.scan().catch(e => console.error('[desktop]', e)), 30_000);
    this.timer.unref();
  }

  async scan() {
    let changed = false;
    let level1: string[] = [];
    try { level1 = await readdir(this.dir); } catch { return; }
    for (const a of level1) {
      let level2: string[] = [];
      try { level2 = await readdir(join(this.dir, a)); } catch { continue; }
      for (const b of level2) {
        const sub = join(this.dir, a, b);
        let files: string[] = [];
        try { files = (await readdir(sub)).filter(f => f.startsWith('local_') && f.endsWith('.json')); } catch { continue; }
        for (const f of files) {
          const path = join(sub, f);
          let mtime = 0;
          try { mtime = (await stat(path)).mtimeMs; } catch { continue; }
          if (this.mtimes.get(path) === mtime) continue;
          this.mtimes.set(path, mtime);
          let raw = '';
          try { raw = await readFile(path, 'utf8'); } catch { continue; }
          const parsed = parseDesktopSession(raw);
          if (!parsed) continue;
          const prev = this.byCli.get(parsed.cliSessionId);
          if (!prev || (parsed.session.lastActivityAt ?? 0) >= (prev.lastActivityAt ?? 0)) {
            this.byCli.set(parsed.cliSessionId, parsed.session);
            changed = true;
          }
        }
      }
    }
    if (changed) this.onChange?.();
  }
}

import type { AppSession, AppState, Todo, TurnSummary } from '../shared/types.ts';
import { folderInfo } from '../shared/folder.ts';

const DAY = 24 * 3600_000;

/**
 * „K dokončení": neaktivní, nearchivované sezení, kde se něco stalo po posledním otevření (nebo nikdy otevřené),
 * do 7 dní zpět. Naplánované úlohy a právě běžící sezení (`liveCli`) se vynechají, odškrtnutá (`dismissed`) také.
 */
export function buildTodo(sessions: DesktopSession[], now: number, liveCli: Set<string>, dismissed: Record<string, number>, projectName?: (cwd: string) => string | undefined, windowDays = 3): Todo[] {
  const TODO_WINDOW = windowDays * DAY;
  const out: Todo[] = [];
  for (const d of sessions) {
    if (d.isArchived || d.scheduled || !d.title || !d.lastActivityAt) continue;
    if (now - d.lastActivityAt > TODO_WINDOW) continue;
    if (d.cliSessionId && liveCli.has(d.cliSessionId)) continue;
    const unread = !d.lastFocusedAt || d.lastActivityAt > d.lastFocusedAt + 1000;
    if (!unread && !d.error) continue;
    const dis = dismissed[d.desktopId];
    if (dis && dis >= d.lastActivityAt) continue;
    out.push({
      desktopId: d.desktopId, cliSessionId: d.cliSessionId, title: d.title,
      ...(() => { if (!d.cwd) return { project: '—', folder: '—' }; const f = folderInfo(d.cwd, homedir()); return { project: projectName?.(d.cwd) ?? (f.scratch ? 'bez projektu' : (f.repo ?? '—')), folder: f.folder }; })(), cwd: d.cwd,
      lastActivityAt: d.lastActivityAt, lastFocusedAt: d.lastFocusedAt,
      starred: d.starred, error: d.error, turns: d.turns, summary: d.summary,
    });
  }
  return out.sort((a, b) =>
    Number(b.starred) - Number(a.starred)
    || Number(!!b.summary?.action) - Number(!!a.summary?.action)
    || b.lastActivityAt - a.lastActivityAt,
  ).slice(0, 40);
}

/**
 * „V projektech": sezení z desktopové aplikace, která nedávno (`hours`) něco dělala, ať už o nich
 * hook ví nebo ne. Naplánované úlohy se vynechávají — ty patří do noční směny. Živá a rozpracovaná
 * sezení zůstávají v seznamu označená (`live`, `todo`), ať je po projektech vidět celý den práce.
 */
export function buildAppSessions(
  sessions: DesktopSession[],
  now: number,
  opts: {
    hours?: number;
    liveCli?: Set<string>;
    todoIds?: Set<string>;
    projectName?: (cwd: string) => string | undefined;
    projectId?: (cwd: string) => string | undefined;
    limit?: number;
  } = {},
): AppSession[] {
  const window = (opts.hours ?? 4) * 3600_000;
  const out: AppSession[] = [];
  for (const d of sessions) {
    if (d.isArchived || d.scheduled || !d.title || !d.lastActivityAt) continue;
    if (now - d.lastActivityAt > window) continue;
    const f = d.cwd ? folderInfo(d.cwd, homedir()) : undefined;
    const live = !!(d.cliSessionId && opts.liveCli?.has(d.cliSessionId));
    // „čeká" = samo od sebe se nehne: buď si řeklo o odpověď, nebo chce, abych se podíval
    const waits = !!d.summary?.action || d.summary?.category === 'blocked' || d.summary?.category === 'review_ready';
    out.push({
      desktopId: d.desktopId,
      cliSessionId: d.cliSessionId,
      title: d.title,
      project: (d.cwd ? opts.projectName?.(d.cwd) : undefined) ?? (f ? (f.scratch ? 'bez projektu' : (f.repo ?? '—')) : '—'),
      projectId: d.cwd ? opts.projectId?.(d.cwd) : undefined,
      folder: f?.folder,
      cwd: d.cwd,
      lastActivityAt: d.lastActivityAt,
      lastFocusedAt: d.lastFocusedAt,
      starred: d.starred,
      turns: d.turns,
      summary: d.summary,
      live,
      todo: !!opts.todoIds?.has(d.desktopId),
      state: live ? 'bezi' : waits ? 'ceka' : 'stoji',
    });
  }
  const rank: Record<AppState, number> = { bezi: 0, ceka: 1, stoji: 2 };
  return out
    .sort((a, b) => rank[a.state] - rank[b.state] || b.lastActivityAt - a.lastActivityAt)
    .slice(0, opts.limit ?? 40);
}
