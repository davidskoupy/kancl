import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const INSTALL = new URL('../hook/install.mjs', import.meta.url).pathname;

function run(settings, ...args) {
  const dir = mkdtempSync(join(tmpdir(), 'kancl-'));
  const file = join(dir, 'settings.json');
  writeFileSync(file, JSON.stringify(settings));
  execFileSync('node', [INSTALL, ...args], { env: { ...process.env, CLAUDE_SETTINGS: file }, stdio: 'pipe' });
  return JSON.parse(readFileSync(file, 'utf8'));
}

test('instalace odstraní staré comakers hooky a cizí zachová', () => {
  const out = run({
    hooks: {
      Stop: [
        { hooks: [{ type: 'command', command: 'bash /x/verify.sh' }] },
        { matcher: '*', hooks: [{ type: 'command', command: 'bash "/old/hook/comakers-hook.sh"', timeout: 5 }] },
      ],
    },
  });
  const cmds = out.hooks.Stop.flatMap(g => g.hooks.map(h => h.command));
  assert.ok(cmds.some(c => c.includes('/x/verify.sh')));
  assert.ok(!cmds.some(c => c.includes('comakers-hook.sh')));
  assert.equal(cmds.filter(c => c.includes('kancl-hook.sh')).length, 1);
  assert.ok(out.hooks.SubagentStart, 'registruje SubagentStart');
});

test('odinstalace nechá jen cizí hooky', () => {
  const out = run({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'bash /x/verify.sh' }] }] } }, '--uninstall');
  assert.equal(out.hooks.Stop.length, 1);
  assert.equal(out.hooks.SessionStart, undefined);
});
