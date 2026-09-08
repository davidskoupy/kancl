import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRemote, groupFolders, fillStatus, sortProjects, projectIdForCwd } from '../server/projects.ts';
import type { Session } from '../shared/types.ts';

test('normalizeRemote sjednotí ssh i https', () => {
  assert.deepEqual(normalizeRemote('git@gitlab.shean.dev:others/cfo-portal.git', ['gitlab.shean.dev']),
    { id: 'gitlab.shean.dev/others/cfo-portal', host: 'gitlab', name: 'cfo-portal' });
  assert.deepEqual(normalizeRemote('https://github.com/davidskoupy/deky.git', []),
    { id: 'github.com/davidskoupy/deky', host: 'github', name: 'deky' });
  assert.deepEqual(normalizeRemote('ssh://git@example.org/team/x', []),
    { id: 'example.org/team/x', host: 'none', name: 'x' });
});

test('groupFolders sloučí worktree podle remotu a nechá složky bez gitu', () => {
  const out = groupFolders([
    { path: '/c/CFO', remoteUrl: 'git@gitlab.shean.dev:others/cfo-portal.git' },
    { path: '/c/CFO-1165', remoteUrl: 'git@gitlab.shean.dev:others/cfo-portal.git' },
    { path: '/c/skroluj' },
    { path: '/c/hidden', remoteUrl: 'https://github.com/x/hidden.git' },
  ], ['github.com/x/hidden'], ['gitlab.shean.dev']);
  assert.equal(out.length, 2);
  const cfo = out.find(p => p.name === 'cfo-portal')!;
  assert.deepEqual(cfo.worktrees.map(w => w.label), ['CFO', 'CFO-1165']);
  const sk = out.find(p => p.name === 'skroluj')!;
  assert.equal(sk.host, 'none');
  assert.equal(sk.id, '/c/skroluj');
});

const sess = (cwd: string, status: Session['status'], projectId?: string): Session => ({
  id: cwd, name: 'x', colorIndex: 0, cwd, project: 'x', projectId, status, statusSince: 0, activity: 'think',
  terminal: {}, startedAt: 0, lastSeen: 500, turns: 0, toolCalls: 0, subagents: [], events: [],
});

test('fillStatus a sortProjects: dotaz, práce, klid podle aktivity', () => {
  const projects = groupFolders([
    { path: '/c/a', remoteUrl: 'https://github.com/x/a.git' },
    { path: '/c/b', remoteUrl: 'https://github.com/x/b.git' },
    { path: '/c/c', remoteUrl: 'https://github.com/x/c.git' },
    { path: '/c/d', remoteUrl: 'https://github.com/x/d.git' },
  ], [], []);
  projects[2].worktrees[0].lastCommit = { hash: 'h', message: 'm', at: 900 };
  projects[3].worktrees[0].lastCommit = { hash: 'h', message: 'm', at: 100 };
  const filled = fillStatus(projects, [
    sess('/c/a/sub', 'working', 'github.com/x/a'),
    sess('/c/b', 'permission', 'github.com/x/b'),
  ]);
  const sorted = sortProjects(filled);
  assert.deepEqual(sorted.map(p => [p.name, p.status]), [['b', 'dotaz'], ['a', 'prace'], ['c', 'klid'], ['d', 'klid']]);
});

test('projectIdForCwd najde projekt i pro podsložku', () => {
  const projects = groupFolders([{ path: '/c/a', remoteUrl: 'https://github.com/x/a.git' }], [], []);
  assert.equal(projectIdForCwd('/c/a/src/x', projects), 'github.com/x/a');
  assert.equal(projectIdForCwd('/c/ab', projects), undefined);
});
