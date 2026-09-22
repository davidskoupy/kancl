import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isCiStale } from '../shared/ci.ts';

const now = 1_000_000_000_000;
const d = 24 * 3600_000;

test('CI se ztlumí, až když padá déle než týden', () => {
  assert.equal(isCiStale({ status: 'fail', at: now - 2 * d }, now), false);
  assert.equal(isCiStale({ status: 'fail', at: now - 8 * d }, now), true);
  assert.equal(isCiStale({ status: 'ok', at: now - 8 * d }, now), false);
  assert.equal(isCiStale({ status: 'fail' }, now), false);
  assert.equal(isCiStale(undefined, now), false);
});
