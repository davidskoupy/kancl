import { test } from 'node:test';
import assert from 'node:assert/strict';
import { needsYou, inQueue, attentionQueue } from '../shared/attention.ts';
import type { Session } from '../shared/types.ts';

const now = 1_000_000_000_000;
const min = 60_000;
const mk = (id: string, status: Session['status'], since: number, extra: Partial<Session> = {}): Session => ({
  id, name: id, colorIndex: 0, cwd: '/', project: 'p', status, statusSince: since, activity: 'think',
  terminal: {}, startedAt: 0, lastSeen: 0, turns: 0, toolCalls: 0, subagents: [], events: [], ...extra,
});

test('chce tě jen dotaz, chyba a otázka', () => {
  assert.equal(needsYou(mk('a', 'permission', now)), true);
  assert.equal(needsYou(mk('a', 'error', now)), true);
  assert.equal(needsYou(mk('a', 'waiting', now)), true);
  assert.equal(needsYou(mk('a', 'completed', now)), false);
  assert.equal(needsYou(mk('a', 'working', now)), false);
});

test('hotové z terminálu je ve frontě 30 min, pak zmizí', () => {
  assert.equal(inQueue(mk('a', 'completed', now - 5 * min), now), true);
  assert.equal(inQueue(mk('a', 'completed', now - 31 * min), now), false);
});

test('hotové z aplikace zmizí po otevření, jinak nejdéle 12 h', () => {
  assert.equal(inQueue(mk('a', 'completed', now - 2 * 60 * min, { desktopId: 'local_x' }), now), true);
  assert.equal(inQueue(mk('a', 'completed', now - 5 * min, { desktopId: 'local_x', seen: true }), now), false);
  assert.equal(inQueue(mk('a', 'completed', now - 13 * 60 * min, { desktopId: 'local_x' }), now), false);
});

test('pořadí fronty: dotaz, chyba, otázka, hotové; uvnitř nejdéle čekající', () => {
  const q = attentionQueue([
    mk('hotovo', 'completed', now - 1 * min),
    mk('otazka-nova', 'waiting', now - 1 * min),
    mk('otazka-stara', 'waiting', now - 9 * min),
    mk('dotaz', 'permission', now - 1 * min),
    mk('prace', 'working', now - 1 * min),
    mk('videno', 'completed', now - 1 * min, { seen: true }),
  ], now);
  assert.deepEqual(q.map(s => s.id), ['dotaz', 'otazka-stara', 'otazka-nova', 'hotovo']);
});
