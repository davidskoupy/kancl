/**
 * Index sezení desktopové aplikace Claude: `local_*.json` → název sezení a id pro deep link.
 * Jen čtení, každých 60 s.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface DesktopSession { desktopId: string; title?: string; lastActivityAt?: number; isArchived: boolean; cwd?: string }

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
      title: typeof d.title === 'string' && d.title.trim() ? d.title.trim() : undefined,
      lastActivityAt: typeof d.lastActivityAt === 'number' ? d.lastActivityAt : undefined,
      isArchived: d.isArchived === true,
      cwd: typeof d.cwd === 'string' ? d.cwd : undefined,
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
