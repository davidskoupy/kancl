import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assignGroups, matchGlob } from '../server/projects.ts';
import type { Project } from '../shared/types.ts';

const p = (id: string, name: string): Project => ({ id, name, host: 'github', worktrees: [], mrs: [], status: 'klid', lastActivity: 0, scannedAt: 0 });

test('matchGlob: hvězdička, bez ohledu na velikost', () => {
  assert.ok(matchGlob('gitlab.shean.dev/others/cfo-portal', 'gitlab.shean.dev/*'));
  assert.ok(matchGlob('github.com/davidskoupy/Dopner', '*/dopner'));
  assert.ok(!matchGlob('github.com/davidskoupy/deky', 'gitlab.*'));
});

test('assignGroups: první shoda vyhrává, jinak bez skupiny', () => {
  const groups = [
    { name: 'Shean', match: ['gitlab.shean.dev/*'] },
    { name: 'Klienti', match: ['*/dopner*', 'github.com/behavera-com/*'] },
  ];
  const out = assignGroups([p('gitlab.shean.dev/others/ppchub', 'ppchub'), p('github.com/davidskoupy/Dopner', 'Dopner'), p('github.com/davidskoupy/deky', 'deky')], groups);
  assert.deepEqual(out.map(x => x.group), ['Shean', 'Klienti', undefined]);
});
