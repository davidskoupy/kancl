import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseHistory, rotate, since, digest, History, type HistoryEvent } from '../server/history.ts';

const d = 24 * 3600_000;
const now = Date.parse('2026-09-09T06:00:00Z');
const ev = (at: number, kind: HistoryEvent['kind'], title: string, ref?: string): HistoryEvent => ({ at, kind, title, ref });

test('parseHistory přeskočí poškozené řádky', () => {
  const text = JSON.stringify(ev(1, 'job_ok', 'a')) + '\n{broken\n' + JSON.stringify(ev(2, 'session_end', 'b')) + '\n';
  assert.equal(parseHistory(text).length, 2);
});

test('rotate a since', () => {
  const events = [ev(now - 8 * d, 'job_ok', 'stará'), ev(now - 2 * d, 'job_ok', 'nová'), ev(now - 1 * d, 'ci_fail', 'ci')];
  assert.deepEqual(rotate(events, now).map(e => e.title), ['nová', 'ci']);
  assert.deepEqual(since(events, now - 1.5 * d).map(e => e.title), ['ci']);
});

test('digest rozdělí události podle druhu', () => {
  const events = [
    ev(now - 10 * 3600_000, 'session_end', 'Fragmento šablona'),
    ev(now - 9 * 3600_000, 'job_ok', 'daily-content · deky ✓'),
    ev(now - 8 * 3600_000, 'job_fail', 'sberne-dvory'),
    ev(now - 7 * 3600_000, 'ci_fail', 'baliky · Nightly build'),
    ev(now - 30 * 3600_000, 'job_ok', 'mimo okno'),
  ];
  const g = digest(events, now - 12 * 3600_000, now);
  assert.deepEqual(g.counts, { sessions: 1, jobsOk: 1, jobsFail: 1, ciFail: 1 });
  assert.equal(g.jobsOk[0].title, 'daily-content · deky ✓');
});

test('History: append, dedup podle ref, načtení s rotací', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'kancl-hist-')), 'history.jsonl');
  const h = new History(path);
  await h.load(now);
  assert.equal(await h.add(ev(now - 9 * d, 'job_ok', 'stará', 'j1')), true);
  assert.equal(await h.add(ev(now - 1 * d, 'job_fail', 'nová', 'j2')), true);
  assert.equal(await h.add(ev(now - 1 * d, 'job_fail', 'duplikát', 'j2')), false);
  const h2 = new History(path);
  await h2.load(now);
  assert.deepEqual(h2.events.map(e => e.title), ['nová']);
  assert.equal(await h2.add(ev(now, 'job_fail', 'stále duplikát', 'j2')), false);
});
