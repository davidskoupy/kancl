import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseDesktopSession, DesktopIndex } from '../server/desktop.ts';

test('parseDesktopSession vytáhne název a id', () => {
  const out = parseDesktopSession(JSON.stringify({ sessionId: 'local_abc', cliSessionId: 'uuid-1', title: ' Fragmento šablona ', lastActivityAt: 5, isArchived: false, cwd: '/x' }));
  assert.deepEqual(out, { cliSessionId: 'uuid-1', session: { desktopId: 'local_abc', title: 'Fragmento šablona', lastActivityAt: 5, isArchived: false, cwd: '/x' } });
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
