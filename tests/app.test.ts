import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAppSessions, parseSummary } from '../server/desktop.ts';

const base = { isArchived: false, scheduled: false, starred: false } as const;
const now = 1_000_000_000_000;
const h = 3600_000;

test('buildAppSessions: nedávná sezení z aplikace po projektech, bez naplánovaných', () => {
  const list = [
    { ...base, desktopId: 'a', cliSessionId: 'ca', title: 'Běží teď', lastActivityAt: now - 60_000, cwd: '/c/deky' },
    { ...base, desktopId: 'b', cliSessionId: 'cb', title: 'Dojelo ráno', lastActivityAt: now - 5 * h, cwd: '/c/deky' },
    { ...base, desktopId: 'c', cliSessionId: 'cc', title: 'K dokončení', lastActivityAt: now - 2 * h, cwd: '/c/kayla' },
    { ...base, desktopId: 'd', cliSessionId: 'cd', title: 'Naplánovaná úloha', lastActivityAt: now - h, scheduled: true, cwd: '/c/deky' },
    { ...base, desktopId: 'e', cliSessionId: 'ce', title: 'Archivované', lastActivityAt: now - h, isArchived: true, cwd: '/c/deky' },
    { ...base, desktopId: 'f', cliSessionId: 'cf', title: 'Včerejší', lastActivityAt: now - 30 * h, cwd: '/c/deky' },
    { ...base, desktopId: 'g', cliSessionId: 'cg', title: '', lastActivityAt: now - h, cwd: '/c/deky' },
  ];
  const out = buildAppSessions(list, now, {
    hours: 12,
    liveCli: new Set(['ca']),
    todoIds: new Set(['c']),
    projectName: cwd => (cwd.includes('deky') ? 'deky' : undefined),
    projectId: cwd => (cwd.includes('deky') ? 'github.com/ja/deky' : undefined),
  });
  assert.deepEqual(out.map(a => a.desktopId), ['a', 'c', 'b'], 'živé první, pak podle času');
  assert.equal(out[0].live, true);
  assert.equal(out[0].project, 'deky');
  assert.equal(out[0].projectId, 'github.com/ja/deky');
  assert.equal(out[1].todo, true);
  assert.equal(out[2].live, false);
  assert.equal(out[2].todo, false);
  assert.equal(out.find(a => a.title === 'Naplánovaná úloha'), undefined, 'naplánované patří do noční směny');
  assert.equal(out.find(a => a.title === 'Archivované'), undefined);
  assert.equal(out.find(a => a.title === 'Včerejší'), undefined, 'mimo okno');
  assert.equal(out.length, 3, 'sezení bez názvu se nepočítá');
});

test('buildAppSessions: bez projektu, folder a limit', () => {
  const list = [
    { ...base, desktopId: 's', cliSessionId: 'cs', title: 'Scratch', lastActivityAt: now, cwd: '/Users/x/Library/Application Support/Claude/scratch-workspaces/a/b/scratch-2026-09-08-f768ce' },
  ];
  const out = buildAppSessions(list, now, { hours: 12 });
  assert.equal(out.length, 1);
  assert.equal(out[0].project, 'bez projektu');
  assert.equal(out[0].projectId, undefined);
  assert.match(out[0].folder ?? '', /scratch/);

  const many = Array.from({ length: 50 }, (_, i) => ({ ...base, desktopId: `m${i}`, cliSessionId: `cm${i}`, title: `Sezení ${i}`, lastActivityAt: now - i * 60_000, cwd: '/c/x' }));
  assert.equal(buildAppSessions(many, now, { hours: 12 }).length, 40);
  assert.equal(buildAppSessions(many, now, { hours: 12, limit: 5 }).length, 5);
});

test('buildAppSessions: okno se dá nastavit, výchozí jsou 4 h', () => {
  const list = [{ ...base, desktopId: 'a', cliSessionId: 'ca', title: 'Před 10 h', lastActivityAt: now - 10 * h, cwd: '/c/x' }];
  assert.equal(buildAppSessions(list, now, { hours: 12 }).length, 1);
  assert.equal(buildAppSessions(list, now, { hours: 4 }).length, 0);
  assert.equal(buildAppSessions(list, now).length, 0, 'bez nastavení platí 4 h');
  const fresh = [{ ...base, desktopId: 'b', cliSessionId: 'cb', title: 'Před 3 h', lastActivityAt: now - 3 * h, cwd: '/c/x' }];
  assert.equal(buildAppSessions(fresh, now).length, 1);
});

test('parseSummary: z postTurnSummary vezme, co se udělalo a co se po mně chce', () => {
  const done = parseSummary({ status_category: 'completed', status_detail: 'deleted 138 merged claude/ branches', needs_action: '' });
  assert.deepEqual(done, { category: 'completed', detail: 'deleted 138 merged claude/ branches', action: undefined });

  const blocked = parseSummary({ status_category: 'blocked', status_detail: 'password page built', needs_action: 'Add line KURZ_HESLO=…' });
  assert.equal(blocked?.category, 'blocked');
  assert.equal(blocked?.action, 'Add line KURZ_HESLO=…');

  assert.equal(parseSummary(undefined), undefined, 'bez shrnutí nic');
  assert.equal(parseSummary({ status_category: 'completed', status_detail: '   ', needs_action: '' }), undefined, 'prázdné shrnutí se zahodí');
  assert.equal(parseSummary({ status_detail: 'něco' })?.category, 'other', 'neznámá kategorie → other');
  assert.equal(parseSummary({ status_category: 'vymyšlená', status_detail: 'něco' })?.category, 'other');
  assert.equal(parseSummary({ status_detail: 'x'.repeat(500) })?.detail?.length, 200, 'dlouhý text se zkrátí');

  const same = parseSummary({ status_category: 'blocked', status_detail: 'Mám jich dát 5?', needs_action: 'Mám jich dát 5?' });
  assert.deepEqual(same, { category: 'blocked', detail: undefined, action: 'Mám jich dát 5?' }, 'stejná věta v obojím se neopakuje');
});

test('buildAppSessions: sezení, které na mě čeká, je hned za živými', () => {
  const ask = { category: 'blocked' as const, detail: 'hotovo z poloviny', action: 'dej mi heslo' };
  const list = [
    { ...base, desktopId: 'a', title: 'Živé', lastActivityAt: now - 10_000, cliSessionId: 'ca', cwd: '/c/deky' },
    { ...base, desktopId: 'b', title: 'Novější, nic nechce', lastActivityAt: now - 60_000, cwd: '/c/deky' },
    { ...base, desktopId: 'c', title: 'Starší, ale čeká na mě', lastActivityAt: now - 2 * h, cwd: '/c/deky', summary: ask },
  ];
  const out = buildAppSessions(list, now, { liveCli: new Set(['ca']) });
  assert.deepEqual(out.map(a => a.desktopId), ['a', 'c', 'b']);
  assert.equal(out[1].summary?.action, 'dej mi heslo', 'shrnutí se propíše do seznamu');
});
