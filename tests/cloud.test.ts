import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCloudSnapshot, scheduleHumanUtc } from '../server/cloud.ts';

const now = Date.parse('2026-09-08T20:00:00Z');
const snap = {
  version: 1, takenAt: now - 60_000,
  routines: [
    { id: 'a', name: 'Páteční revize', cron: '0 14 * * 5', enabled: true, nextRunAt: '2026-09-11T14:01:00Z', lastRun: { firedAt: '2026-09-08T18:00:00Z', finishedAt: '2026-09-08T18:02:00Z', status: 'ok' }, model: 'claude-opus-4-8', url: 'https://claude.ai/code/routines/a' },
    { id: 'b', name: 'Selhává', cron: '0 6 * * 1-5', enabled: true, lastRun: { firedAt: '2026-09-08T19:00:00Z', finishedAt: '2026-09-08T19:01:00Z', status: 'fail' } },
    { id: 'c', name: 'Běží', cron: '0 * * * *', enabled: true, lastRun: { firedAt: '2026-09-08T19:58:00Z', status: 'running' } },
    { id: 'd', name: 'Jednorázová', runOnceAt: '2026-08-26T07:00:00Z', enabled: false, endedReason: 'run_once_fired', lastRun: { firedAt: '2026-08-26T07:03:00Z', finishedAt: '2026-08-26T07:05:00Z', status: 'ok' } },
    { id: 'e', name: 'Dávno', cron: '0 7 1,15 * *', enabled: true, nextRunAt: '2026-09-15T07:06:00Z', lastRun: { firedAt: '2026-09-03T18:28:00Z', finishedAt: '2026-09-03T18:28:12Z', status: 'ok' } },
  ],
  sessions: [
    { id: '1', name: 'Kolečko', kind: 'cloud', status: 'idle' },
    { id: '2', name: 'Staré RC', kind: 'remote-control', status: 'offline' },
    { id: '3', name: 'Živé RC', kind: 'remote-control', status: 'idle' },
  ],
};

test('parseCloudSnapshot: stavy routin', () => {
  const out = parseCloudSnapshot(JSON.stringify(snap), now, 120);
  const by = Object.fromEntries(out.jobs.map(j => [j.id, j]));
  assert.equal(by['routine:a'].state, 'ok');
  assert.equal(by['routine:a'].scheduleHuman, 'pátek 16:00');
  assert.equal(by['routine:a'].lastResult?.resultText, '✅ uspělo (120 s)');
  assert.equal(by['routine:a'].url, 'https://claude.ai/code/routines/a');
  assert.equal(by['routine:b'].state, 'chyba');
  assert.equal(by['routine:c'].state, 'bezi');
  assert.equal(by['routine:d'].state, 'vypnuto');
  assert.equal(by['routine:d'].nextRunAt, undefined);
  assert.equal(by['routine:e'].state, 'spi');
  assert.equal(by['routine:e'].nextRunAt, Date.parse('2026-09-15T07:06:00Z'));
  assert.equal(out.takenAt, now - 60_000);
  assert.ok(out.jobs.every(j => j.source === 'routine'));
});

test('parseCloudSnapshot: filtr sezení', () => {
  const out = parseCloudSnapshot(JSON.stringify(snap), now, 120);
  assert.deepEqual(out.sessions.map(s => s.name), ['Kolečko', 'Živé RC']);
});

test('parseCloudSnapshot: chybějící a rozbitý soubor', () => {
  assert.deepEqual(parseCloudSnapshot(undefined, now), { jobs: [], sessions: [] });
  const bad = parseCloudSnapshot('{nope', now);
  assert.equal(bad.jobs.length, 0);
  assert.match(bad.error ?? '', /nedá načíst/);
  const withErr = parseCloudSnapshot(JSON.stringify({ takenAt: now, routines: [], sessions: [], error: 'RemoteTrigger selhal' }), now);
  assert.equal(withErr.error, 'RemoteTrigger selhal');
});

test('scheduleHumanUtc posune hodiny', () => {
  assert.equal(scheduleHumanUtc('0 14 * * 5', 120), 'pátek 16:00');
  assert.equal(scheduleHumanUtc('0 6 * * 1-5', 60), 'po, út, st, čt, pá 7:00');
  assert.equal(scheduleHumanUtc('0 23 * * *', 120), 'denně 1:00');
});
