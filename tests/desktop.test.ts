import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseDesktopSession, DesktopIndex } from '../server/desktop.ts';

test('parseDesktopSession vytáhne název a id', () => {
  const out = parseDesktopSession(JSON.stringify({ sessionId: 'local_abc', cliSessionId: 'uuid-1', title: ' Fragmento šablona ', lastActivityAt: 5, isArchived: false, cwd: '/x' }));
  assert.deepEqual(out, { cliSessionId: 'uuid-1', session: { desktopId: 'local_abc', cliSessionId: 'uuid-1', title: 'Fragmento šablona', lastActivityAt: 5, lastFocusedAt: undefined, isArchived: false, cwd: '/x', scheduled: false, starred: false, error: undefined, turns: undefined } });
  assert.equal(parseDesktopSession('{nope'), undefined);
  assert.equal(parseDesktopSession(JSON.stringify({ sessionId: 'local_x' })), undefined);
});

test('DesktopIndex projde adresáře a novější aktivita vyhrává', async () => {
  const root = mkdtempSync(join(tmpdir(), 'kancl-desktop-'));
  const a = join(root, 'acc', 'dev1'); const b = join(root, 'acc', 'dev2');
  mkdirSync(a, { recursive: true }); mkdirSync(b, { recursive: true });
  writeFileSync(join(a, 'local_1.json'), JSON.stringify({ sessionId: 'local_1', cliSessionId: 'cli', title: 'Starší', lastActivityAt: 1 }));
  writeFileSync(join(b, 'local_2.json'), JSON.stringify({ sessionId: 'local_2', cliSessionId: 'cli', title: 'Novější', lastActivityAt: 2 }));
  writeFileSync(join(b, 'other.json'), '{}');
  let changes = 0;
  const idx = new DesktopIndex(root, () => changes++);
  await idx.scan();
  assert.equal(idx.lookup('cli')?.title, 'Novější');
  assert.equal(idx.lookup('cli')?.desktopId, 'local_2');
  assert.equal(changes, 1);
  await idx.scan();
  assert.equal(changes, 1, 'beze změny se neohlásí');
});

import { buildTodo } from '../server/desktop.ts';
test('buildTodo: nepřečtené, bez naplánovaných, bez běžících, s odškrtnutím', () => {
  const now = 1_000_000_000_000;
  const h = 3600_000;
  const base = { isArchived: false, scheduled: false, starred: false } as const;
  const list = [
    { ...base, desktopId: 'a', cliSessionId: 'ca', title: 'Nepřečtené', lastActivityAt: now - h, lastFocusedAt: now - 2 * h, cwd: '/c/deky' },
    { ...base, desktopId: 'b', cliSessionId: 'cb', title: 'Přečtené', lastActivityAt: now - 2 * h, lastFocusedAt: now - h, cwd: '/c/x' },
    { ...base, desktopId: 'c', cliSessionId: 'cc', title: 'Nikdy neotevřené', lastActivityAt: now - h, cwd: '/c/y', starred: true },
    { ...base, desktopId: 'd', cliSessionId: 'cd', title: 'Naplánované', lastActivityAt: now - h, scheduled: true },
    { ...base, desktopId: 'e', cliSessionId: 'ce', title: 'Běží', lastActivityAt: now - h },
    { ...base, desktopId: 'f', cliSessionId: 'cf', title: 'Odškrtnuté', lastActivityAt: now - 3 * h },
    { ...base, desktopId: 'g', cliSessionId: 'cg', title: 'Staré', lastActivityAt: now - 10 * 24 * h },
  ];
  const out = buildTodo(list, now, new Set(['ce']), { f: now - h });
  assert.deepEqual(out.map(t => t.title), ['Nikdy neotevřené', 'Nepřečtené']);
  assert.equal(out[1].project, 'deky');
});
