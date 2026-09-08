#!/usr/bin/env node
// Installs (or removes) the Comakers Crew hooks in ~/.claude/settings.json.
// Existing hooks are preserved; a timestamped backup is written first.
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const uninstall = process.argv.includes('--uninstall');
const settingsPath = process.env.CLAUDE_SETTINGS ?? join(homedir(), '.claude', 'settings.json');
const scriptPath = resolve(dirname(fileURLToPath(import.meta.url)), 'comakers-hook.sh');
const MARK = 'comakers-hook.sh';

const EVENTS = [
  'SessionStart', 'SessionEnd', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse',
  'PostToolUseFailure', 'PermissionRequest', 'Notification', 'Stop',
  'SubagentStart', 'SubagentStop', 'PreCompact',
];

let settings = {};
if (existsSync(settingsPath)) {
  const raw = readFileSync(settingsPath, 'utf8');
  settings = raw.trim() ? JSON.parse(raw) : {};
  const backup = `${settingsPath}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  copyFileSync(settingsPath, backup);
  console.log(`backup → ${backup}`);
}

settings.hooks ??= {};
const isOurs = h => typeof h?.command === 'string' && h.command.includes(MARK);

// remove ours everywhere first (idempotent re-install)
for (const ev of Object.keys(settings.hooks)) {
  const groups = Array.isArray(settings.hooks[ev]) ? settings.hooks[ev] : [];
  const kept = groups
    .map(g => ({ ...g, hooks: (g.hooks ?? []).filter(h => !isOurs(h)) }))
    .filter(g => g.hooks.length > 0);
  if (kept.length) settings.hooks[ev] = kept; else delete settings.hooks[ev];
}

if (!uninstall) {
  for (const ev of EVENTS) {
    settings.hooks[ev] ??= [];
    settings.hooks[ev].push({
      matcher: '*',
      hooks: [{ type: 'command', command: `bash "${scriptPath}"`, timeout: 5 }],
    });
  }
}
if (Object.keys(settings.hooks).length === 0) delete settings.hooks;

writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
console.log(`${uninstall ? 'removed' : 'installed'} Comakers Crew hooks in ${settingsPath}`);
if (!uninstall) console.log('New Claude Code sessions will report to http://127.0.0.1:4242 (running ones: restart claude).');
