/**
 * Sedmidenní historie: append-only `~/.kancl/history.jsonl`, rotace při startu a jednou denně.
 * Čistá část (filtr, rotace, digest) je bez I/O a testovaná.
 */
import { appendFile, readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export type HistoryKind = 'session_end' | 'job_ok' | 'job_fail' | 'ci_fail' | 'stock_alarm';

export interface HistoryEvent {
  at: number;
  kind: HistoryKind;
  title: string;          // co se stalo, lidsky
  project?: string;       // název projektu
  detail?: string;        // krátká poznámka (do 200 znaků)
  ref?: string;           // id sezení / úlohy / workflow
}

export const KEEP_MS = 7 * 24 * 3600_000;

export function parseHistory(text: string): HistoryEvent[] {
  const out: HistoryEvent[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line);
      if (typeof e?.at === 'number' && typeof e?.kind === 'string' && typeof e?.title === 'string') out.push(e);
    } catch { /* poškozený řádek se přeskočí */ }
  }
  return out;
}

export function rotate(events: HistoryEvent[], now: number, keepMs = KEEP_MS): HistoryEvent[] {
  return events.filter(e => now - e.at <= keepMs);
}

export function since(events: HistoryEvent[], from: number): HistoryEvent[] {
  return events.filter(e => e.at >= from).sort((a, b) => a.at - b.at);
}

export interface Digest {
  from: number; to: number;
  sessions: HistoryEvent[];
  jobsOk: HistoryEvent[];
  jobsFail: HistoryEvent[];
  ciFail: HistoryEvent[];
  stock: HistoryEvent[];
  counts: { sessions: number; jobsOk: number; jobsFail: number; ciFail: number };
}

export function digest(events: HistoryEvent[], from: number, to: number): Digest {
  const win = events.filter(e => e.at >= from && e.at <= to).sort((a, b) => a.at - b.at);
  const pick = (k: HistoryKind) => win.filter(e => e.kind === k);
  const sessions = pick('session_end'), jobsOk = pick('job_ok'), jobsFail = pick('job_fail'), ciFail = pick('ci_fail'), stock = pick('stock_alarm');
  return { from, to, sessions, jobsOk, jobsFail, ciFail, stock, counts: { sessions: sessions.length, jobsOk: jobsOk.length, jobsFail: jobsFail.length, ciFail: ciFail.length } };
}

export class History {
  events: HistoryEvent[] = [];
  private seen = new Set<string>();
  private lastRotate = 0;

  constructor(private path: string) {}

  async load(now = Date.now()) {
    try { this.events = rotate(parseHistory(await readFile(this.path, 'utf8')), now); } catch { this.events = []; }
    for (const e of this.events) if (e.ref) this.seen.add(`${e.kind}:${e.ref}`);
    await this.flush();
    this.lastRotate = now;
  }

  /** Zapíše událost; když má `ref`, stejná dvojice kind+ref se podruhé nezapíše. */
  async add(e: HistoryEvent): Promise<boolean> {
    if (e.ref) {
      const key = `${e.kind}:${e.ref}`;
      if (this.seen.has(key)) return false;
      this.seen.add(key);
    }
    this.events.push(e);
    try {
      await mkdir(dirname(this.path), { recursive: true });
      await appendFile(this.path, JSON.stringify(e) + '\n');
    } catch (err) { console.error('[history]', err); }
    if (Date.now() - this.lastRotate > 24 * 3600_000) { this.events = rotate(this.events, Date.now()); this.lastRotate = Date.now(); await this.flush(); }
    return true;
  }

  private async flush() {
    try {
      await mkdir(dirname(this.path), { recursive: true });
      await writeFile(this.path, this.events.map(e => JSON.stringify(e)).join('\n') + (this.events.length ? '\n' : ''));
    } catch (err) { console.error('[history]', err); }
  }
}
