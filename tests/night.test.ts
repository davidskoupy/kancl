import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCron, nextRun, scheduleHuman, parseRunsMd, parseStock, deriveJobState, readFrontmatter } from '../server/night.ts';

test('parseCron + nextRun: denně 7:00', () => {
  const from = new Date(2026, 8, 8, 12, 0);
  assert.equal(nextRun('0 7 * * *', from)?.getTime(), new Date(2026, 8, 9, 7, 0).getTime());
});
test('nextRun: pondělí 6:00', () => {
  const from = new Date(2026, 8, 8, 12, 0);
  assert.equal(nextRun('0 6 * * 1', from)?.getTime(), new Date(2026, 8, 14, 6, 0).getTime());
});
test('nextRun: každých 15 min a seznam', () => {
  const from = new Date(2026, 8, 8, 12, 3);
  assert.equal(nextRun('*/15 * * * *', from)?.getTime(), new Date(2026, 8, 8, 12, 15).getTime());
  assert.equal(nextRun('30 5,17 * * *', from)?.getTime(), new Date(2026, 8, 8, 17, 30).getTime());
  assert.equal(parseCron('rozbité'), null);
});
test('scheduleHuman česky', () => {
  assert.equal(scheduleHuman('0 7 * * *'), 'denně 7:00');
  assert.equal(scheduleHuman('30 5 * * *'), 'denně 5:30');
  assert.equal(scheduleHuman('0 6 * * 1'), 'pondělí 6:00');
  assert.equal(scheduleHuman('0 6 * * 1,3'), 'po, st 6:00');
  assert.equal(scheduleHuman('0 6 1 * *'), '1. v měsíci 6:00');
  assert.equal(scheduleHuman('*/15 * * * *'), 'každých 15 min');
  assert.equal(scheduleHuman('0 7 1,15 * *'), '1., 15. v měsíci 7:00');
  assert.equal(scheduleHuman('0 8 1 2 *'), 'každý rok 1. 2. 8:00');
  assert.equal(scheduleHuman(undefined, new Date(2026, 8, 10, 9, 0).getTime()), 'jednou 10. 9. 9:00');
});
const RUNS = `# Log
| datum | web | téma | výsledek | poznámka |
|---|---|---|---|---|
| 2026-09-06 | baliky | dobirka-do-zahranici | ⚠️ deploy fail (fakturace) | Rotace: ... |
| | | | 🟠 alarm zásoby | Krok 10: zásoba pending po běhu — deky 29 · katalogodpadu 37 · baliky 15 (+1 drafted) · **zahradni-domky 4** (≤5 → varování). PushNotification odeslána. |
| 2026-09-07 | zahradni-domky | udrzba-pergoly | ✅ published + deploy (živě HTTP 200) | Rotace ... |
| 2026-09-08 | — | — | ⏭ skip (dnes už proběhlo) | guard |
`;
test('parseRunsMd: výsledky, skip, alarm dědí datum', () => {
  const rows = parseRunsMd(RUNS);
  assert.equal(rows.length, 4);
  assert.equal(rows[0].result, 'fail'); assert.equal(rows[0].project, 'baliky');
  assert.equal(rows[1].kind, 'alarm'); assert.equal(rows[1].at, rows[0].at);
  assert.equal(rows[2].result, 'ok'); assert.equal(rows[2].slug, 'udrzba-pergoly');
  assert.equal(rows[3].result, 'skip'); assert.equal(rows[3].project, undefined);
});
test('parseStock vytáhne weby a alarm', () => {
  const note = 'Krok 10: zásoba pending po běhu — deky 28 · katalogodpadu 33 (z `main`, autoritativní) · baliky 15 (+1 `drafted`) · **zahradni-domky 3** (≤5 → varování). Doplň content-plan.md; při rotaci po 4 webech vydrží zhruba 12 dní.';
  assert.deepEqual(parseStock(note), [
    { project: 'deky', pending: 28, alarm: false }, { project: 'katalogodpadu', pending: 33, alarm: false },
    { project: 'baliky', pending: 15, alarm: false }, { project: 'zahradni-domky', pending: 3, alarm: true },
  ]);
});
test('deriveJobState', () => {
  const now = Date.parse('2026-09-08T08:00:00Z');
  const h = 3600_000;
  assert.equal(deriveJobState({ enabled: false, lastRunAt: now - 10 * 24 * h }, now), 'vypnuto');
  assert.equal(deriveJobState({ enabled: true, lastRunAt: now - 5 * 60_000 }, now), 'bezi');
  assert.equal(deriveJobState({ enabled: true, lastRunAt: now - 5 * 60_000, lastResultAt: now - 4 * 60_000, lastResult: 'ok' }, now), 'ok');
  assert.equal(deriveJobState({ enabled: true, lastRunAt: now - h, lastResultAt: now - h, lastResult: 'fail' }, now), 'chyba');
  assert.equal(deriveJobState({ enabled: true, lastRunAt: now - 5 * h }, now), 'spi');
  assert.equal(deriveJobState({ enabled: true }, now), 'spi');
});
test('readFrontmatter', () => {
  assert.deepEqual(readFrontmatter('---\nname: daily-content\ndescription: Denní běh (7:00)\n---\ntext'), { name: 'daily-content', description: 'Denní běh (7:00)' });
  assert.deepEqual(readFrontmatter('bez frontmatteru'), {});
});
