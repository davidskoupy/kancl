import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planIslands, planKey } from '../shared/plan.ts';
import type { Project } from '../shared/types.ts';

const p = (id: string, status: Project['status']): Project => ({
  id, name: id, host: 'none', worktrees: [], mrs: [], status, lastActivity: 0, scannedAt: 0,
});

test('žádné projekty → žádné ostrůvky', () => {
  assert.deepEqual(planIslands([], {}, 12), []);
});

test('aktivní projekt dostane sezení + 1 stůl, max 4', () => {
  const out = planIslands([p('a', 'prace'), p('b', 'dotaz')], { a: 1, b: 5 }, 12);
  assert.deepEqual(out[0], { projectId: 'a', status: 'prace', desks: [0, 1] });
  assert.deepEqual(out[1], { projectId: 'b', status: 'dotaz', desks: [2, 3, 4, 5] });
});

test('klidné projekty po jednom stole, co se nevejde, nemá ostrůvek', () => {
  const projects = [p('a', 'prace'), ...'bcdefghijklmn'.split('').map(c => p(c, 'klid'))];
  const out = planIslands(projects, { a: 3 }, 12);
  assert.equal(out[0].desks.length, 4);
  assert.equal(out.length, 1 + 8);
  assert.deepEqual(out[out.length - 1].desks, [11]);
});

test('aktivní projekt na hraně dostane jen zbývající stoly', () => {
  const out = planIslands([p('a', 'prace'), p('b', 'prace'), p('c', 'prace'), p('d', 'prace')], { a: 3, b: 3, c: 3, d: 3 }, 12);
  assert.equal(out.length, 3);
  assert.deepEqual(out[2].desks, [8, 9, 10, 11]);
});

test('planKey se mění jen s aktivními projekty a počty', () => {
  const k1 = planKey([p('a', 'prace'), p('b', 'klid')], { a: 1 });
  const k2 = planKey([p('a', 'prace'), p('c', 'klid')], { a: 1 });
  const k3 = planKey([p('a', 'prace'), p('b', 'klid')], { a: 2 });
  assert.equal(k1, k2);
  assert.notEqual(k1, k3);
});
