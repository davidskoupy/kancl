import { test } from 'node:test';
import assert from 'node:assert/strict';
import { folderInfo } from '../shared/folder.ts';

const HOME = '/Users/david';

test('běžná složka pod domovem', () => {
  assert.deepEqual(folderInfo('/Users/david/Code/baliky', HOME), { folder: '~/Code/baliky', repo: 'baliky', scratch: false });
});

test('worktree Claude Code', () => {
  assert.deepEqual(folderInfo('/Users/david/Code/PPC hub/.claude/worktrees/cool-hopper-ffe927', HOME),
    { folder: '~/Code/PPC hub › cool-hopper-ffe927', repo: 'PPC hub', scratch: false });
  assert.deepEqual(folderInfo('/Users/david/Code/PetriEDU/petri-edu-care/.claude/worktrees/registration-admin-72d70e/dist', HOME),
    { folder: '~/Code/PetriEDU/petri-edu-care › registration-admin-72d70e/dist', repo: 'petri-edu-care', scratch: false });
});

test('scratch složky', () => {
  assert.deepEqual(folderInfo('/Users/david/Library/Application Support/Claude/scratch-workspaces/a/b/scratch-2026-09-08-f768ce', HOME),
    { folder: 'scratch 2026-09-08-f768ce', scratch: true });
  assert.deepEqual(folderInfo('/private/tmp/claude-501/-Users-david-Code-x/ce85/scratchpad/petri', HOME),
    { folder: 'dočasná složka petri', scratch: true });
});

test('mimo domov a prázdné', () => {
  assert.deepEqual(folderInfo('/opt/app', HOME), { folder: '/opt/app', repo: 'app', scratch: false });
  assert.deepEqual(folderInfo('', HOME), { folder: '—', scratch: true });
});
