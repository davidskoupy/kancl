/**
 * Index sezení desktopové aplikace Claude: `local_*.json` → název sezení a id pro deep link.
 * Jen čtení, každých 60 s.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface DesktopSession { desktopId: string; cliSessionId?: string; title?: string; lastActivityAt?: number; lastFocusedAt?: number; isArchived: boolean; cwd?: string; scheduled: boolean; starred: boolean; error?: string; turns?: number }

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
    this.timer = setInterval(() => this.scan().catch(e => console.error('[desktop]', e)), 60_000);
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

import type { Todo } from '../shared/types.ts';
import { basename } from 'node:path';

const TODO_WINDOW = 7 * 24 * 3600_000;

/**
 * „K dokončení": neaktivní, nearchivované sezení, kde se něco stalo po posledním otevření (nebo nikdy otevřené),
 * do 7 dní zpět. Naplánované úlohy a právě běžící sezení (`liveCli`) se vynechají, odškrtnutá (`dismissed`) také.
 */
export function buildTodo(sessions: DesktopSession[], now: number, liveCli: Set<string>, dismissed: Record<string, number>, projectName?: (cwd: string) => string | undefined): Todo[] {
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
      project: d.cwd ? (projectName?.(d.cwd) ?? (d.cwd.includes('/scratch-workspaces/') ? 'bez projektu' : basename(d.cwd))) : '—', cwd: d.cwd,
      lastActivityAt: d.lastActivityAt, lastFocusedAt: d.lastFocusedAt,
      starred: d.starred, error: d.error, turns: d.turns,
    });
  }
  return out.sort((a, b) => Number(b.starred) - Number(a.starred) || b.lastActivityAt - a.lastActivityAt).slice(0, 40);
}
