/**
 * Noční směna — čistá logika bez I/O: cron, český popis rozvrhu, parser runs.md,
 * parser zásoby témat, odvození stavu úlohy, frontmatter SKILL.md.
 */
import type { JobState } from '../shared/types.ts';

// ---- cron -------------------------------------------------------------------

export interface CronSpec { min: number[]; hour: number[]; mday: number[]; mon: number[]; wday: number[] }

function parseField(field: string, min: number, max: number): number[] | null {
  const out = new Set<number>();
  for (const part of field.split(',')) {
    const m = part.match(/^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/);
    if (!m) return null;
    const step = m[2] ? Number(m[2]) : 1;
    if (step < 1) return null;
    let lo = min, hi = max;
    if (m[1] !== '*') {
      const [a, b] = m[1].split('-').map(Number);
      lo = a; hi = b ?? (m[2] ? max : a);
      if (lo < min || hi > max || lo > hi) return null;
    }
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return [...out].sort((a, b) => a - b);
}

export function parseCron(expr: string): CronSpec | null {
  const f = expr.trim().split(/\s+/);
  if (f.length !== 5) return null;
  const min = parseField(f[0], 0, 59), hour = parseField(f[1], 0, 23), mday = parseField(f[2], 1, 31);
  const mon = parseField(f[3], 1, 12), wday = parseField(f[4].replace(/7/g, '0'), 0, 6);
  if (!min || !hour || !mday || !mon || !wday) return null;
  return { min, hour, mday, mon, wday };
}

/** Další běh po `from` (lokální čas). Prochází nejvýš 400 dní. */
export function nextRun(expr: string, from: Date): Date | null {
  const spec = parseCron(expr);
  if (!spec) return null;
  const day = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  for (let d = 0; d < 400; d++) {
    const cur = new Date(day.getFullYear(), day.getMonth(), day.getDate() + d);
    if (!spec.mon.includes(cur.getMonth() + 1) || !spec.mday.includes(cur.getDate()) || !spec.wday.includes(cur.getDay())) continue;
    for (const h of spec.hour) for (const m of spec.min) {
      const cand = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate(), h, m);
      if (cand.getTime() > from.getTime()) return cand;
    }
  }
  return null;
}

const WDAY_LONG = ['neděle', 'pondělí', 'úterý', 'středa', 'čtvrtek', 'pátek', 'sobota'];
const WDAY_SHORT = ['ne', 'po', 'út', 'st', 'čt', 'pá', 'so'];

function hm(h: number, m: number) { return `${h}:${String(m).padStart(2, '0')}`; }

/** "denně 7:00", "pondělí 6:00", "po, st 6:00", "1. v měsíci 6:00", "každých 15 min", "jednou 10. 9. 9:00". */
export function scheduleHuman(expr?: string, fireAt?: number): string {
  if (!expr && fireAt) {
    const d = new Date(fireAt);
    return `jednou ${d.getDate()}. ${d.getMonth() + 1}. ${hm(d.getHours(), d.getMinutes())}`;
  }
  if (!expr) return '';
  const spec = parseCron(expr);
  if (!spec) return expr;
  const everyMonth = spec.mon.length === 12, everyDay = spec.mday.length === 31, everyWday = spec.wday.length === 7;
  if (spec.hour.length === 24 && everyMonth && everyDay && everyWday) {
    if (spec.min.length === 60) return 'každou minutu';
    if (spec.min.length > 1) { const step = spec.min[1] - spec.min[0]; return `každých ${step} min`; }
    return `každou hodinu v :${String(spec.min[0]).padStart(2, '0')}`;
  }
  const time = spec.hour.map(h => spec.min.map(m => hm(h, m)).join(', ')).join(', ');
  if (everyMonth && everyDay && everyWday) return `denně ${time}`;
  if (everyMonth && everyDay && !everyWday) {
    const days = spec.wday.length === 1 ? WDAY_LONG[spec.wday[0]] : spec.wday.map(w => WDAY_SHORT[w]).join(', ');
    return `${days} ${time}`;
  }
  if (everyMonth && everyWday && spec.mday.length < 31) return `${spec.mday.map(d => `${d}.`).join(', ')} v měsíci ${time}`;
  if (spec.mon.length === 1 && everyWday && spec.mday.length < 31) return `každý rok ${spec.mday.map(d => `${d}.`).join(', ')} ${spec.mon[0]}. ${time}`;
  return expr;
}

// ---- runs.md ----------------------------------------------------------------

export interface RunRow {
  kind: 'run' | 'alarm';
  at: number;               // ms, půlnoc lokálního dne
  project?: string;
  slug?: string;
  result: 'ok' | 'fail' | 'skip';
  resultText: string;
  note?: string;
}

function cells(line: string): string[] {
  return line.replace(/^\|/, '').replace(/\|\s*$/, '').split('|').map(c => c.trim());
}

function resultOf(text: string): RunRow['result'] {
  if (/^(✅|koncept|published|ok)/i.test(text)) return 'ok';
  if (text.startsWith('⏭')) return 'skip';
  return 'fail';
}

/** Indexy sloupců (0 = datum). Výchozí = content engine `| datum | web | téma | výsledek | poznámka |`. */
export interface RunsColumns { project?: number; slug?: number; result: number; note?: number }
export const CONTENT_ENGINE_COLUMNS: RunsColumns = { project: 1, slug: 2, result: 3, note: 4 };

/** Tabulka s datem v prvním sloupci; řádky bez data (alarmy) dědí datum předchozího. */
export function parseRunsMd(text: string, cols: RunsColumns = CONTENT_ENGINE_COLUMNS): RunRow[] {
  const out: RunRow[] = [];
  let lastAt = 0;
  for (const line of text.split('\n')) {
    if (!line.startsWith('|')) continue;
    const c = cells(line);
    if (c.length <= cols.result || /^-+$/.test(c[0]) || c[0] === 'datum') continue;
    const dateM = c[0].match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (dateM) lastAt = new Date(Number(dateM[1]), Number(dateM[2]) - 1, Number(dateM[3])).getTime();
    else if (!lastAt) continue;
    const resultText = c[cols.result] ?? '';
    if (!dateM && !resultText) continue;
    const isAlarm = !dateM || /alarm zásoby|🟠/.test(resultText);
    const clean = (s?: string) => (s && s !== '—' && s !== '-' ? s : undefined);
    const note = cols.note !== undefined ? c[cols.note] : undefined;
    out.push({
      kind: isAlarm ? 'alarm' : 'run',
      at: lastAt,
      project: cols.project !== undefined ? clean(c[cols.project]) : undefined,
      slug: cols.slug !== undefined ? clean(c[cols.slug]) : undefined,
      result: resultOf(resultText), resultText,
      note: note ? note.slice(0, 400) : undefined,
    });
  }
  return out;
}

/** Z poznámky alarmu: "zásoba … — deky 28 · **zahradni-domky 3** (…)" → seznam webů; `**web N**` = alarm. */
export function parseStock(note: string): { project: string; pending: number; alarm: boolean }[] {
  const i = note.search(/z[áa]soba/i);
  if (i < 0) return [];
  let seg = note.slice(i);
  const end = seg.search(/\.\s+(?=[A-ZÁ-Ž])|\n/);
  if (end > 0) seg = seg.slice(0, end);
  seg = seg.replace(/\([^)]*\)/g, ' ').replace(/`[^`]*`/g, ' ');
  const out: { project: string; pending: number; alarm: boolean }[] = [];
  const re = /(\*\*)?([a-z][a-z0-9-]{2,})\s+(\d+)(\*\*)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(seg))) {
    if (['zhruba', 'pending', 'krok'].includes(m[2])) continue;
    out.push({ project: m[2], pending: Number(m[3]), alarm: !!m[1] || !!m[4] });
  }
  return out;
}

// ---- stav úlohy -------------------------------------------------------------

const RUNNING_WINDOW = 20 * 60_000;
const RESULT_WINDOW = 3 * 3600_000;
const STALE = 7 * 24 * 3600_000;

export function deriveJobState(
  j: { enabled: boolean; lastRunAt?: number; lastResultAt?: number; lastResult?: 'ok' | 'fail' | 'skip' },
  now: number,
): JobState {
  const since = j.lastRunAt ? now - j.lastRunAt : Infinity;
  if (!j.enabled && since > STALE) return 'vypnuto';
  const hasFreshResult = j.lastResultAt !== undefined && j.lastRunAt !== undefined && j.lastResultAt >= j.lastRunAt - 24 * 3600_000 && j.lastResult;
  if (since < RESULT_WINDOW && hasFreshResult) return j.lastResult === 'fail' ? 'chyba' : 'ok';
  if (since < RUNNING_WINDOW) return 'bezi';
  if (since < RESULT_WINDOW) return 'ok';
  return 'spi';
}

// ---- frontmatter ------------------------------------------------------------

export function readFrontmatter(md: string): Record<string, string> {
  const m = md.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const out: Record<string, string> = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([\w-]+):\s*(.*)$/);
    if (kv) out[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}
