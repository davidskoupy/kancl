# Kancl · etapa 1 — implementační plán

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Přestavět fork Comakers Crew na Kancl: český velín, který vedle Claude Code sezení ukazuje i projekty z `~/Code` (git, PR/MR) jako ostrůvky stolů a subagenty jako malé postavičky.

**Architecture:** Stávající Node server (hook → stavový automat → SSE) dostane skener projektů (readdir + git + gh + GitLab REST) a posílá klientovi seřazený seznam projektů stejným SSE kanálem. Klient z projektů spočítá plán ostrůvků nad pevnou mřížkou 12 stolů, panel se přepíše na strom projektů. Čistá logika (normalizace remotů, slučování, stav, plán ostrůvků) žije v samostatných modulech bez I/O a je pokrytá testy `node --test`.

**Tech Stack:** Node 20, TypeScript, tsx, Vite, PixiJS 8, `node:test`, `gh` CLI, GitLab REST v4. Žádná nová závislost.

Spec: `docs/superpowers/specs/2026-09-08-kancl-etapa-1-design.md`.

---

## Struktura souborů

| Soubor | Stav | Odpovědnost |
| --- | --- | --- |
| `shared/types.ts` | upravit | `Project`, `Worktree`, `MergeRequest`, `Subagent`, `Session.projectId`, `ServerMessage.projects` |
| `shared/names.ts` | nový | 40 českých přezdívek + `plainAscii()` pro pixelový font |
| `shared/plan.ts` | nový | `planIslands()` — čistý plánovač ostrůvků |
| `server/projects.ts` | nový | čistá logika: `normalizeRemote`, `groupFolders`, `fillStatus`, `sortProjects`, `projectIdForCwd` |
| `server/config.ts` | nový | čtení/zakládání `~/.config/kancl/config.json`, GitLab token |
| `server/scanner.ts` | nový | I/O: readdir, git, gh, GitLab, intervaly, publikace změn |
| `server/state.ts` | upravit | subagenti jako seznam, `projectId`, `projectResolver` |
| `server/index.ts` | upravit | Kancl názvy, `/api/projects`, SSE `projects`, trigger po Stop |
| `hook/kancl-hook.sh` | přejmenovat | `KANCL_PORT` |
| `hook/install.mjs` | upravit | značka `kancl-hook.sh`, úklid starých `comakers-hook.sh` |
| `client/src/net.ts` | upravit | zpráva `projects`, demo projekty |
| `client/src/game/world.ts` | upravit | `acquireSlot` s povolenými stoly |
| `client/src/game/agent.ts` | upravit | ostrůvek sezení, subagenti jako děti |
| `client/src/game/scene.ts` | upravit | vrstva ostrůvků, přeplánování, `setProjects` |
| `client/src/ui/panel.ts` | přepsat | strom projektů, detail projektu, čeština |
| `client/src/ui/attention.ts` | upravit | Kancl, české notifikace |
| `client/src/style.css` | upravit | styly stromu |
| `client/index.html`, `client/src/main.ts` | upravit | Kancl, propojení projektů |
| `Kancl.command`, `Kancl — Stop.command`, `Kancl — Autostart.command` | přejmenovat | názvy, `KANCL_PORT`, `~/.kancl` |
| `tests/*.test.ts`, `tests/install.test.mjs` | nové | testy |
| `package.json`, `README.md` | upravit | název, `npm test`, česká dokumentace |

---

### Task 1: Rebrand a české přezdívky

**Files:**
- Modify: `package.json`, `client/index.html`, `client/src/ui/attention.ts`, `server/index.ts`, `server/state.ts`
- Rename: `hook/comakers-hook.sh` → `hook/kancl-hook.sh`; tři `.command` soubory
- Modify: `hook/install.mjs`
- Create: `shared/names.ts`, `tests/install.test.mjs`

- [ ] **Step 1: Test instalátoru (selže)**

`tests/install.test.mjs`:
```js
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
```

- [ ] **Step 2: Spustit, ověřit selhání**

Run: `node --test tests/install.test.mjs`
Expected: FAIL (`comakers-hook.sh` zůstává / `kancl-hook.sh` chybí).

- [ ] **Step 3: Přejmenovat hook a upravit instalátor**

```bash
git mv hook/comakers-hook.sh hook/kancl-hook.sh
```
V `hook/kancl-hook.sh`: hlavičku na `# Kancl — Claude Code hook forwarder.` a `PORT="${KANCL_PORT:-4242}"`.

V `hook/install.mjs`:
```js
const scriptPath = resolve(dirname(fileURLToPath(import.meta.url)), 'kancl-hook.sh');
const MARKS = ['kancl-hook.sh', 'comakers-hook.sh']; // druhá kvůli úklidu po přejmenování
...
const isOurs = h => typeof h?.command === 'string' && MARKS.some(m => h.command.includes(m));
...
console.log(`${uninstall ? 'odebrány' : 'nainstalovány'} hooky Kanclu v ${settingsPath}`);
if (!uninstall) console.log('Nová Claude Code sezení se budou hlásit na http://127.0.0.1:4242 (běžící: restartuj claude).');
```

- [ ] **Step 4: Spustit test**

Run: `node --test tests/install.test.mjs`
Expected: 2 passed.

- [ ] **Step 5: České přezdívky**

`shared/names.ts`:
```ts
export const NAMES = [
  'Pepa', 'Tonda', 'Máňa', 'Vašek', 'Božka', 'Lojza', 'Franta', 'Jarda', 'Květa', 'Zdenda',
  'Milan', 'Jirka', 'Věra', 'Ruda', 'Bohouš', 'Standa', 'Libor', 'Hanka', 'Olda', 'Dáša',
  'Mirek', 'Zuzka', 'Kája', 'Radek', 'Ivana', 'Ota', 'Lenka', 'Honza', 'Blanka', 'Vláďa',
  'Eva', 'Petr', 'Jitka', 'Luboš', 'Alena', 'Fanda', 'Marta', 'Kuba', 'Tereza', 'Míla',
];

/** Pixelový 3×5 font nemá diakritiku: "Máňa" → "Mana". */
export function plainAscii(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}
```
V `server/state.ts` smazat lokální `NAMES` a přidat `import { NAMES } from '../shared/names.ts';`.

- [ ] **Step 6: Názvy a proměnné**

- `package.json`: `"name": "kancl"`, `"description": "Kancl — pixel-artový velín nad Claude Code sezeními a projekty"`, `repository.url` → `https://github.com/davidskoupy/kancl.git`, `homepage` stejně, přidat `"test": "node --import tsx --test tests/*.test.ts tests/*.test.mjs"`.
- `server/index.ts`: `KANCL_PORT`, `KANCL_HOST`, `KANCL_DEBUG`, log `Kancl → http://…`.
- `client/index.html`: `<html lang="cs">`, `<title>Kancl</title>`, `<h1>Kancl</h1>`, prázdný stav česky:
  ```html
  <p><b>Zatím žádné sezení.</b></p>
  <p>Jednou nainstaluj hooky:</p>
  <pre>npm run hooks:install</pre>
  <p>a pak spusť <code>claude</code> v libovolném terminálu. Každé sezení se tu objeví jako kolega.</p>
  <button id="demo-btn" class="btn">▶ Pustit ukázkovou partu</button>
  ```
  legenda: `Práce · Dotaz · Čeká · Hotovo · Chyba`; toolbar title `Přiblížit / Oddálit / Na okno`.
- `client/src/ui/attention.ts`: `BASE_TITLE = 'Kancl'`, localStorage klíče `kancl.notify`, `kancl.sound`, notifikace:
  ```ts
  const titles: Record<string, string> = {
    permission: `${s.name} potřebuje povolení`,
    error: `${s.name} narazil na chybu`,
    waiting: `${s.name} čeká na odpověď`,
    completed: `${s.name} má hotovo`,
  };
  ```
- `.command` soubory: `git mv` na `Kancl.command`, `Kancl — Stop.command`, `Kancl — Autostart.command`; uvnitř `KANCL_PORT`, `$HOME/.kancl`, label `cz.skoupy.kancl`, texty česky, `osascript … whose name contains "Kancl.command"` atd.

- [ ] **Step 7: Ověřit a commitnout**

Run: `npm run typecheck && npm test && npm run hooks:install && grep -c kancl-hook ~/.claude/settings.json && grep -c comakers-hook ~/.claude/settings.json`
Expected: typecheck OK, testy OK, `12` a `0`.

```bash
git add -A && git commit -m "feat: rebrand na Kancl, české přezdívky, úklid starých hooků"
```

---

### Task 2: Typy projektů a subagenti v serveru

**Files:**
- Modify: `shared/types.ts`, `server/state.ts`, `server/tsconfig.json`
- Create: `tests/state.test.ts`

- [ ] **Step 1: Typy**

Do `shared/types.ts` přidat:
```ts
export type Host = 'github' | 'gitlab' | 'none';
export type ProjectStatus = 'dotaz' | 'prace' | 'klid';

export interface Worktree {
  path: string;
  label: string;
  branch: string;
  dirty: number;
  ahead: number;
  behind: number;
  lastCommit?: { hash: string; message: string; at: number };
  error?: string;
}

export interface MergeRequest {
  number: number;
  title: string;
  url: string;
  branch: string;
  state: 'open' | 'draft' | 'approved' | 'changes_requested';
  updatedAt: number;
}

export interface Project {
  id: string;
  name: string;
  host: Host;
  remoteUrl?: string;
  worktrees: Worktree[];
  mrs: MergeRequest[];
  mrsError?: string;
  status: ProjectStatus;
  lastActivity: number;
  scannedAt: number;
}

export interface Subagent { id: string; description: string; startedAt: number }
```
V `Session`: `project: string;` ponechat (název složky), přidat `projectId?: string;`, změnit `subagents: number` → `subagents: Subagent[]`.
`ServerMessage`: snapshot dostane `projects: Project[]`, přidat `| { type: 'projects'; projects: Project[] }`.

- [ ] **Step 2: Test subagentů (selže)**

`tests/state.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../server/state.ts';

const ev = (name: string, extra: Record<string, unknown> = {}) => ({ hook: { hook_event_name: name, session_id: 's1', cwd: '/tmp/x', ...extra } });

test('SubagentStart/Stop vedou seznam subagentů', () => {
  const st = new Store();
  st.apply(ev('SessionStart'));
  st.apply(ev('SubagentStart', { agent_id: 'a1', agent_type: 'Explore', description: 'hledá usage' }));
  st.apply(ev('SubagentStart', { agent_id: 'a2', agent_type: 'general-purpose' }));
  const s = st.sessions.get('s1')!;
  assert.equal(s.subagents.length, 2);
  assert.equal(s.subagents[0].description, 'hledá usage');
  assert.equal(s.subagents[1].description, 'general-purpose');
  st.apply(ev('SubagentStop', { agent_id: 'a1' }));
  assert.deepEqual(s.subagents.map(a => a.id), ['a2']);
});

test('SubagentStop bez id odebere nejstaršího', () => {
  const st = new Store();
  st.apply(ev('SessionStart'));
  st.apply(ev('SubagentStart', { agent_id: 'a1' }));
  st.apply(ev('SubagentStart', { agent_id: 'a2' }));
  st.apply(ev('SubagentStop'));
  assert.deepEqual(st.sessions.get('s1')!.subagents.map(a => a.id), ['a2']);
});

test('projectResolver přiřadí projectId podle cwd', () => {
  const st = new Store();
  st.projectResolver = cwd => (cwd.startsWith('/tmp/x') ? 'proj-x' : undefined);
  st.apply(ev('SessionStart'));
  assert.equal(st.sessions.get('s1')!.projectId, 'proj-x');
});
```

- [ ] **Step 3: Spustit, ověřit selhání**

Run: `npm test`
Expected: FAIL (`subagents.length` není funkce/`projectResolver` neexistuje).

- [ ] **Step 4: Implementace ve `server/state.ts`**

- V `Store`: `projectResolver?: (cwd: string) => string | undefined;`
- V `ensure()` při vytvoření: `subagents: []`, a po nastavení `cwd` (nové i změněné): `s.projectId = this.projectResolver?.(s.cwd);`
- Nová metoda:
  ```ts
  /** Znovu přiřadí projekty všem sezením (po doskenování projektů). */
  reassignProjects() {
    for (const s of this.sessions.values()) {
      const id = this.projectResolver?.(s.cwd);
      if (id !== s.projectId) { s.projectId = id; this.broadcast({ type: 'upsert', session: s }); }
    }
  }
  ```
- Události:
  ```ts
  case 'SubagentStart': {
    const id = typeof hook.agent_id === 'string' ? hook.agent_id : `sub-${Date.now()}-${s.subagents.length}`;
    const description = short(hook.description ?? hook.agent_type, 60) || 'subagent';
    s.subagents.push({ id, description, startedAt: Date.now() });
    this.setStatus(s, 'working');
    this.log(s, ev, description);
    break;
  }
  case 'SubagentStop': {
    const id = typeof hook.agent_id === 'string' ? hook.agent_id : undefined;
    const i = id ? s.subagents.findIndex(a => a.id === id) : 0;
    if (i >= 0 && s.subagents.length) s.subagents.splice(i, 1);
    this.log(s, ev);
    break;
  }
  ```
- Anglické texty v `state.ts` do češtiny: `'Has a question for you'` → `'Má na tebe otázku'`, `'Needs your permission'` → `'Potřebuje povolení'`, `'Waiting for your input'` → `'Čeká na tvou odpověď'`, `'Needs your input'` → `'Potřebuje odpověď'`, `'Turn finished'` → `'Tah dokončen'`, `'Compacting context'` → `'Zhušťuje kontext'`, `` `Allow ${s.lastDetail}?` `` → `` `Povolit ${s.lastDetail}?` ``, `'Asking you a question'` → `'Ptá se tě'`.
- `server/tsconfig.json`: do `include` přidat `"../tests/**/*.ts"` (ověřit tvar include v souboru).

- [ ] **Step 5: Spustit testy + typecheck, commit**

Run: `npm test && npm run typecheck`
Expected: všechny testy PASS, typecheck bez chyb (klient zatím `subagents` používá jen v panelu jako číslo → opravit `s.subagents.length`).

```bash
git add -A && git commit -m "feat: typy projektů, subagenti jako seznam, projectId u sezení"
```

---

### Task 3: Plánovač ostrůvků (`shared/plan.ts`)

**Files:**
- Create: `shared/plan.ts`, `tests/plan.test.ts`

- [ ] **Step 1: Test (selže)**

`tests/plan.test.ts`:
```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planIslands, planKey } from '../shared/plan.ts';
import type { Project } from '../shared/types.ts';

const p = (id: string, status: Project['status']): Project => ({
  id, name: id, host: 'none', worktrees: [], mrs: [], status, lastActivity: 0, scannedAt: 0,
});

test('žádné projekty → žádné ostrůvky', () => {
  assert.deepEqual(planIslands([], {}, 12), []);
});

test('aktivní projekt dostane sezení + 1 stůl, max 4', () => {
  const out = planIslands([p('a', 'prace'), p('b', 'dotaz')], { a: 1, b: 5 }, 12);
  assert.deepEqual(out[0], { projectId: 'a', status: 'prace', desks: [0, 1] });
  assert.deepEqual(out[1], { projectId: 'b', status: 'dotaz', desks: [2, 3, 4, 5] });
});

test('klidné projekty po jednom stole, co se nevejde, nemá ostrůvek', () => {
  const projects = [p('a', 'prace'), ...'bcdefghijklmn'.split('').map(c => p(c, 'klid'))];
  const out = planIslands(projects, { a: 3 }, 12);
  assert.equal(out[0].desks.length, 4);
  assert.equal(out.length, 1 + 8);
  assert.deepEqual(out[out.length - 1].desks, [11]);
});

test('aktivní projekt na hraně dostane jen zbývající stoly', () => {
  const out = planIslands([p('a', 'prace'), p('b', 'prace'), p('c', 'prace'), p('d', 'prace')], { a: 3, b: 3, c: 3, d: 3 }, 12);
  assert.equal(out.length, 3);
  assert.deepEqual(out[2].desks, [8, 9, 10, 11]);
});

test('planKey se mění jen s aktivními projekty a počty', () => {
  const k1 = planKey([p('a', 'prace'), p('b', 'klid')], { a: 1 });
  const k2 = planKey([p('a', 'prace'), p('c', 'klid')], { a: 1 });
  const k3 = planKey([p('a', 'prace'), p('b', 'klid')], { a: 2 });
  assert.equal(k1, k2);
  assert.notEqual(k1, k3);
});
```

- [ ] **Step 2: Spustit, ověřit selhání**

Run: `npm test`
Expected: FAIL (`shared/plan.ts` neexistuje).

- [ ] **Step 3: Implementace**

`shared/plan.ts`:
```ts
import type { Project, ProjectStatus } from './types.ts';

export interface Island { projectId: string; status: ProjectStatus; desks: number[] }

const MAX_ISLAND = 4;

/**
 * Rozdělí `deskCount` stolů mezi projekty (v pořadí, v jakém přišly ze serveru).
 * Aktivní (dotaz/práce): sezení + 1, nejvýš 4. Klidné: 1 stůl, dokud stoly jsou.
 */
export function planIslands(projects: Project[], sessionsByProject: Record<string, number>, deskCount: number): Island[] {
  const out: Island[] = [];
  let cursor = 0;
  const take = (n: number) => {
    const desks: number[] = [];
    while (desks.length < n && cursor < deskCount) desks.push(cursor++);
    return desks;
  };
  for (const p of projects) {
    if (p.status === 'klid') continue;
    const want = Math.min(MAX_ISLAND, (sessionsByProject[p.id] ?? 0) + 1);
    const desks = take(want);
    if (desks.length) out.push({ projectId: p.id, status: p.status, desks });
  }
  for (const p of projects) {
    if (p.status !== 'klid') continue;
    if (cursor >= deskCount) break;
    out.push({ projectId: p.id, status: p.status, desks: take(1) });
  }
  return out;
}

/** Klíč, při jehož změně se má kancelář přeplánovat. Klidné projekty do něj nepatří. */
export function planKey(projects: Project[], sessionsByProject: Record<string, number>): string {
  return projects
    .filter(p => p.status !== 'klid')
    .map(p => `${p.id}:${p.status}:${sessionsByProject[p.id] ?? 0}`)
    .join('|');
}
```

- [ ] **Step 4: Spustit, commit**

Run: `npm test`
Expected: PASS.

```bash
git add shared/plan.ts tests/plan.test.ts && git commit -m "feat: plánovač ostrůvků"
```

---

### Task 4: Čistá logika projektů (`server/projects.ts`)

**Files:**
- Create: `server/projects.ts`, `tests/projects.test.ts`

- [ ] **Step 1: Test (selže)**

`tests/projects.test.ts`:
```ts
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
```

- [ ] **Step 2: Spustit, ověřit selhání**

Run: `npm test`
Expected: FAIL (modul neexistuje).

- [ ] **Step 3: Implementace**

`server/projects.ts`:
```ts
import { basename } from 'node:path';
import type { Host, Project, ProjectStatus, Session } from '../shared/types.ts';

export interface FolderInfo { path: string; remoteUrl?: string }

/** `git@host:a/b.git`, `https://host/a/b.git`, `ssh://git@host/a/b` → `host/a/b`. */
export function normalizeRemote(url: string, gitlabHosts: string[]): { id: string; host: Host; name: string } | null {
  let rest = url.trim();
  const scp = rest.match(/^[\w.-]+@([^:]+):(.+)$/);
  if (scp) rest = `${scp[1]}/${scp[2]}`;
  else {
    rest = rest.replace(/^[a-z+]+:\/\//i, '');
    rest = rest.replace(/^[^@/]+@/, '');
  }
  rest = rest.replace(/\.git\/?$/, '').replace(/\/+$/, '');
  const [hostname, ...parts] = rest.split('/');
  if (!hostname || parts.length === 0) return null;
  const hostLower = hostname.toLowerCase();
  let host: Host = 'none';
  if (hostLower.includes('github')) host = 'github';
  else if (gitlabHosts.includes(hostLower) || hostLower.includes('gitlab')) host = 'gitlab';
  return { id: `${hostLower}/${parts.join('/')}`, host, name: parts[parts.length - 1] };
}

export function groupFolders(folders: FolderInfo[], hidden: string[], gitlabHosts: string[]): Project[] {
  const byId = new Map<string, Project>();
  for (const f of folders) {
    const norm = f.remoteUrl ? normalizeRemote(f.remoteUrl, gitlabHosts) : null;
    const id = norm?.id ?? f.path;
    if (hidden.includes(id) || hidden.includes(basename(f.path))) continue;
    let p = byId.get(id);
    if (!p) {
      p = {
        id, name: norm?.name ?? basename(f.path), host: norm?.host ?? 'none', remoteUrl: f.remoteUrl,
        worktrees: [], mrs: [], status: 'klid', lastActivity: 0, scannedAt: Date.now(),
      };
      byId.set(id, p);
    }
    p.worktrees.push({ path: f.path, label: basename(f.path), branch: '', dirty: 0, ahead: 0, behind: 0 });
  }
  return [...byId.values()];
}

export function projectIdForCwd(cwd: string, projects: Project[]): string | undefined {
  let best: { id: string; len: number } | undefined;
  for (const p of projects) {
    for (const w of p.worktrees) {
      if (cwd === w.path || cwd.startsWith(w.path + '/')) {
        if (!best || w.path.length > best.len) best = { id: p.id, len: w.path.length };
      }
    }
  }
  return best?.id;
}

export function fillStatus(projects: Project[], sessions: Session[]): Project[] {
  return projects.map(p => {
    const mine = sessions.filter(s => s.projectId === p.id);
    let status: ProjectStatus = 'klid';
    if (mine.some(s => s.status === 'permission')) status = 'dotaz';
    else if (mine.length) status = 'prace';
    const lastCommit = Math.max(0, ...p.worktrees.map(w => (w.lastCommit?.at ?? 0) * 1000));
    const lastSeen = Math.max(0, ...mine.map(s => s.lastSeen));
    return { ...p, status, lastActivity: Math.max(lastCommit, lastSeen) };
  });
}

const RANK: Record<ProjectStatus, number> = { dotaz: 0, prace: 1, klid: 2 };

export function sortProjects(projects: Project[]): Project[] {
  return [...projects].sort((a, b) => RANK[a.status] - RANK[b.status] || b.lastActivity - a.lastActivity || a.name.localeCompare(b.name, 'cs'));
}
```
Pozn.: `lastCommit.at` je epoch v sekundách (z `git log %ct`), v `fillStatus` se násobí 1000; v testu je `at: 900` → 900 000 ms, `lastSeen: 500` ms, takže projekt c (900) je před d (100).

- [ ] **Step 4: Spustit, commit**

Run: `npm test`
Expected: PASS.

```bash
git add server/projects.ts tests/projects.test.ts && git commit -m "feat: čistá logika projektů (remote, slučování, stav, řazení)"
```

---

### Task 5: Config a token

**Files:**
- Create: `server/config.ts`
- Modify: `.gitignore` (přidat `.env`)

- [ ] **Step 1: Implementace**

`server/config.ts`:
```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Config {
  roots: string[];
  hidden: string[];
  gitIntervalSec: number;
  remoteIntervalMin: number;
  gitlabHosts: string[];
}

const DEFAULTS: Config = {
  roots: ['~/Code'],
  hidden: [],
  gitIntervalSec: 15,
  remoteIntervalMin: 5,
  gitlabHosts: ['gitlab.shean.dev'],
};

export const CONFIG_PATH = process.env.KANCL_CONFIG ?? join(homedir(), '.config', 'kancl', 'config.json');

export function expandHome(p: string): string {
  return p.startsWith('~/') ? join(homedir(), p.slice(2)) : p === '~' ? homedir() : p;
}

/** Načte config; když neexistuje, založí ho s výchozími hodnotami. */
export function loadConfig(): Config {
  if (!existsSync(CONFIG_PATH)) {
    mkdirSync(dirname(CONFIG_PATH), { recursive: true });
    writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULTS, null, 2) + '\n');
    return { ...DEFAULTS };
  }
  try {
    const raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
    return { ...DEFAULTS, ...raw };
  } catch (e) {
    console.error(`[config] ${CONFIG_PATH} se nedá načíst, používám výchozí:`, e);
    return { ...DEFAULTS };
  }
}

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** GITLAB_TOKEN z prostředí, jinak z .env v kořeni repa Kanclu. */
export function gitlabToken(): string | undefined {
  if (process.env.GITLAB_TOKEN) return process.env.GITLAB_TOKEN;
  const env = join(REPO_ROOT, '.env');
  if (!existsSync(env)) return undefined;
  const m = readFileSync(env, 'utf8').match(/^\s*GITLAB_TOKEN\s*=\s*["']?([^"'\n]+)["']?\s*$/m);
  return m?.[1];
}
```
Do `.gitignore` přidat řádek `.env`.

- [ ] **Step 2: Typecheck, commit**

Run: `npm run typecheck`
Expected: OK.

```bash
git add server/config.ts .gitignore && git commit -m "feat: config Kanclu a GitLab token"
```

---

### Task 6: Skener (git, gh, GitLab) a napojení do serveru

**Files:**
- Create: `server/scanner.ts`
- Modify: `server/index.ts`

- [ ] **Step 1: Skener**

`server/scanner.ts`:
```ts
import { readdir, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import type { Config } from './config.ts';
import { expandHome, gitlabToken } from './config.ts';
import { groupFolders, fillStatus, sortProjects, projectIdForCwd, type FolderInfo } from './projects.ts';
import type { Store } from './state.ts';
import type { MergeRequest, Project, Worktree } from '../shared/types.ts';

const run = promisify(execFile);
const GIT_TIMEOUT = 3000;

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await run('git', args, { cwd, timeout: GIT_TIMEOUT, maxBuffer: 1 << 20 });
  return stdout.trim();
}

/** Jednoduchá fronta: nejvýš `n` úloh naráz. */
async function mapLimit<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
  }));
  return out;
}

async function readWorktree(w: Worktree): Promise<Worktree> {
  try {
    const [branch, status, log] = await Promise.all([
      git(w.path, ['rev-parse', '--abbrev-ref', 'HEAD']),
      git(w.path, ['status', '--porcelain']),
      git(w.path, ['log', '-1', '--format=%H%x1f%s%x1f%ct']),
    ]);
    let ahead = 0, behind = 0;
    try {
      const lr = await git(w.path, ['rev-list', '--left-right', '--count', '@{upstream}...HEAD']);
      const [b, a] = lr.split(/\s+/).map(Number);
      behind = b || 0; ahead = a || 0;
    } catch { /* bez upstreamu */ }
    const [hash, message, ct] = log.split('\x1f');
    return {
      ...w, branch: branch === 'HEAD' ? '(detached)' : branch,
      dirty: status ? status.split('\n').length : 0, ahead, behind,
      lastCommit: hash ? { hash: hash.slice(0, 7), message, at: Number(ct) } : undefined,
      error: undefined,
    };
  } catch (e: any) {
    return { ...w, error: e?.killed ? 'git neodpovídá' : 'git selhal' };
  }
}

async function githubPrs(id: string): Promise<MergeRequest[]> {
  const repo = id.replace(/^github\.com\//, '');
  const { stdout } = await run('gh', ['pr', 'list', '--repo', repo, '--state', 'open', '--limit', '50',
    '--json', 'number,title,url,headRefName,isDraft,reviewDecision,updatedAt'], { timeout: 15000 });
  return (JSON.parse(stdout) as any[]).map(p => ({
    number: p.number, title: p.title, url: p.url, branch: p.headRefName,
    state: p.isDraft ? 'draft' : p.reviewDecision === 'APPROVED' ? 'approved' : p.reviewDecision === 'CHANGES_REQUESTED' ? 'changes_requested' : 'open',
    updatedAt: Date.parse(p.updatedAt),
  }));
}

async function gitlabMrs(id: string, token: string): Promise<MergeRequest[]> {
  const [host, ...path] = id.split('/');
  const url = `https://${host}/api/v4/projects/${encodeURIComponent(path.join('/'))}/merge_requests?state=opened&per_page=50`;
  const res = await fetch(url, { headers: { 'PRIVATE-TOKEN': token }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`GitLab ${res.status}`);
  return ((await res.json()) as any[]).map(m => ({
    number: m.iid, title: m.title, url: m.web_url, branch: m.source_branch,
    state: m.draft ? 'draft' : 'open', updatedAt: Date.parse(m.updated_at),
  }));
}

export class Scanner {
  projects: Project[] = [];
  private raw: Project[] = [];          // po groupFolders + git, bez stavu
  private lastJson = '';
  private timers: NodeJS.Timeout[] = [];
  private remoteTimers = new Map<string, NodeJS.Timeout>();

  constructor(private cfg: Config, private store: Store, private onChange: (p: Project[]) => void) {
    store.projectResolver = cwd => projectIdForCwd(cwd, this.raw);
  }

  async start() {
    await this.scanFolders();
    await this.refreshGit();
    this.refreshRemotes().catch(() => {});
    this.timers.push(
      setInterval(() => this.scanFolders().then(() => this.refreshGit()).catch(console.error), 5 * 60_000),
      setInterval(() => this.refreshGit().catch(console.error), this.cfg.gitIntervalSec * 1000),
      setInterval(() => this.refreshRemotes().catch(console.error), this.cfg.remoteIntervalMin * 60_000),
    );
    for (const t of this.timers) t.unref();
  }

  /** Sezení se změnilo → přepočítat stav projektů (levné, jen v paměti). */
  publish() {
    const filled = sortProjects(fillStatus(this.raw, this.store.list()));
    const json = JSON.stringify(filled);
    if (json === this.lastJson) return;
    this.lastJson = json;
    this.projects = filled;
    this.onChange(filled);
  }

  async scanFolders() {
    const folders: FolderInfo[] = [];
    for (const root of this.cfg.roots.map(expandHome)) {
      let names: string[] = [];
      try { names = await readdir(root); } catch { continue; }
      for (const name of names) {
        if (name.startsWith('.')) continue;
        const path = join(root, name);
        try { if (!(await stat(path)).isDirectory()) continue; } catch { continue; }
        let remoteUrl: string | undefined;
        try {
          const top = await git(path, ['rev-parse', '--show-toplevel']);
          if (top !== path) continue;               // podsložka cizího repa
          remoteUrl = await git(path, ['remote', 'get-url', 'origin']).catch(() => '') || undefined;
          folders.push({ path, remoteUrl: remoteUrl ?? `file://${path}` });
        } catch {
          folders.push({ path });                    // bez gitu
        }
      }
    }
    const fresh = groupFolders(folders, this.cfg.hidden, this.cfg.gitlabHosts);
    // zachovat už načtená data (git, MR) u projektů, které zůstaly
    const old = new Map(this.raw.map(p => [p.id, p]));
    this.raw = fresh.map(p => {
      const prev = old.get(p.id);
      if (!prev) return p;
      const wt = new Map(prev.worktrees.map(w => [w.path, w]));
      return { ...p, mrs: prev.mrs, mrsError: prev.mrsError, worktrees: p.worktrees.map(w => wt.get(w.path) ?? w) };
    });
    this.store.reassignProjects();
    this.publish();
  }

  async refreshGit() {
    const all = this.raw.flatMap(p => p.worktrees.filter(w => w.path && p.host !== 'none' || p.remoteUrl));
    const updated = await mapLimit(all, 4, readWorktree);
    const byPath = new Map(updated.map(w => [w.path, w]));
    this.raw = this.raw.map(p => ({ ...p, worktrees: p.worktrees.map(w => byPath.get(w.path) ?? w), scannedAt: Date.now() }));
    this.publish();
  }

  /** PR/MR pro všechny projekty, nebo jen pro jeden (po Stop sezení, s 10s odstupem). */
  async refreshRemotes(projectId?: string) {
    if (projectId) {
      clearTimeout(this.remoteTimers.get(projectId));
      this.remoteTimers.set(projectId, setTimeout(() => this.fetchRemote(projectId).then(() => this.publish()).catch(() => {}), 10_000));
      return;
    }
    await mapLimit(this.raw.filter(p => p.host !== 'none'), 3, p => this.fetchRemote(p.id));
    this.publish();
  }

  private async fetchRemote(id: string) {
    const p = this.raw.find(x => x.id === id);
    if (!p || p.host === 'none') return;
    let mrs = p.mrs, mrsError: string | undefined;
    try {
      if (p.host === 'github') mrs = await githubPrs(id);
      else {
        const token = gitlabToken();
        if (!token) throw new Error('chybí GITLAB_TOKEN');
        mrs = await gitlabMrs(id, token);
      }
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      mrsError = /ENOENT/.test(msg) ? 'gh není nainstalované' : /auth|login|401/i.test(msg) ? 'gh není přihlášené / token neplatí' : msg;
    }
    this.raw = this.raw.map(x => (x.id === id ? { ...x, mrs, mrsError } : x));
  }
}
```
Pozn. k `refreshGit`: složky bez gitu mají `remoteUrl` undefined a `host: 'none'`; lokální repa bez remotu dostanou `remoteUrl: file://…` a `host: 'none'`, git se u nich číst má. Filtr proto zní: číst git, pokud projekt má `remoteUrl` (tj. je to git repo). Zjednodušit na `p.worktrees.filter(() => !!p.remoteUrl)`.

- [ ] **Step 2: Napojení v `server/index.ts`**

```ts
import { loadConfig } from './config.ts';
import { Scanner } from './scanner.ts';
...
const store = new Store();
const scanner = new Scanner(loadConfig(), store, projects => {
  const line = `data: ${JSON.stringify({ type: 'projects', projects } satisfies ServerMessage)}\n\n`;
  for (const res of clients) res.write(line);
});
store.listeners.add((m: ServerMessage) => {
  const line = `data: ${JSON.stringify(m)}\n\n`;
  for (const res of clients) res.write(line);
  if (m.type === 'upsert' || m.type === 'remove') scanner.publish();
});
```
- Po `store.apply(payload)` v `/hook`: `if (ev === 'Stop' && s?.projectId) scanner.refreshRemotes(s.projectId).catch(() => {});`
- Nová route: `if (req.method === 'GET' && path === '/api/projects') return json(res, 200, { projects: scanner.projects });`
- Snapshot v `/api/events`: `{ type: 'snapshot', sessions: store.list(), projects: scanner.projects, serverStartedAt: store.serverStartedAt }`.
- V `server.listen` callbacku: `scanner.start().catch(e => console.error('[scanner]', e));`
- Debug log: `if (process.env.KANCL_DEBUG)`.

- [ ] **Step 3: Smoke test**

Run: `npm run typecheck && (npx tsx server/index.ts & sleep 6; curl -s http://127.0.0.1:4243/api/projects | head -c 600; kill %1)` s `KANCL_PORT=4243` před příkazem.
Expected: JSON s projekty, `cfo-portal` má 6 worktree, `deky` má `host: "github"`.

- [ ] **Step 4: Commit**

```bash
git add server/scanner.ts server/index.ts && git commit -m "feat: skener projektů (git, gh, GitLab) a API/SSE projektů"
```

---

### Task 7: Klient — příjem projektů a demo

**Files:**
- Modify: `client/src/net.ts`, `client/src/main.ts`

- [ ] **Step 1: `net.ts`**

- `ClientEvents` přidat `onProjects: (p: Project[]) => void;`
- `CrewClient` přejmenovat na `KanclClient`; pole `projects: Project[] = []`.
- `handle`: v `snapshot` navíc `this.projects = msg.projects ?? []; this.events.onProjects(this.projects);` a nový case `'projects'`: totéž.
- `startDemo`: české přezdívky a projekty:
  ```ts
  const names = ['Pepa', 'Tonda', 'Máňa', 'Vašek', 'Božka', 'Lojza', 'Franta', 'Jarda'];
  const proj = (id: string, name: string, host: Project['host'], extra: Partial<Project> = {}): Project => ({
    id, name, host, remoteUrl: `https://${id}`, mrs: [], status: 'klid', lastActivity: now, scannedAt: now,
    worktrees: [{ path: `/Users/ty/Code/${name}`, label: name, branch: 'main', dirty: 0, ahead: 0, behind: 0, lastCommit: { hash: 'abc1234', message: 'úprava', at: Math.floor(now / 1000) - 3600 } }],
    ...extra,
  });
  const demoProjects: Project[] = [
    proj('github.com/ty/eshop', 'eshop', 'github', { worktrees: [{ path: '/Users/ty/Code/eshop', label: 'eshop', branch: 'feat/kosik', dirty: 4, ahead: 2, behind: 0 }], mrs: [{ number: 31, title: 'Zaokrouhlení v košíku', url: '#', branch: 'feat/kosik', state: 'open', updatedAt: now }] }),
    proj('gitlab.shean.dev/others/brana', 'api-brana', 'gitlab', { worktrees: [{ path: '/Users/ty/Code/brana', label: 'brana', branch: '1165', dirty: 0, ahead: 0, behind: 3 }, { path: '/Users/ty/Code/brana-bugs', label: 'brana-bugs', branch: 'bugs', dirty: 1, ahead: 0, behind: 0 }] }),
    proj('github.com/ty/landing', 'landing', 'github'),
    proj('github.com/ty/mobil', 'mobil', 'github'),
    proj('github.com/ty/data', 'data-pipeline', 'github'),
    proj('github.com/ty/infra', 'infra', 'github', { mrsError: 'chybí GITLAB_TOKEN' }),
    proj('/Users/ty/Code/skroluj', 'skroluj', 'none', { remoteUrl: undefined }),
    proj('github.com/ty/docs', 'docs', 'github'),
    proj('github.com/ty/fakturace', 'fakturace', 'github'),
  ];
  ```
  V `mk()` nastavit `name: names[i]`, `cwd: demoProjects[i]?.worktrees[0].path`, `projectId: demoProjects[i]?.id`, `subagents: []`. Seed 0 navíc `subagents: [{ id: 'd-sub', description: 'Explore: hledá usage', startedAt: now }]`. Před vložením sezení zavolat `this.setDemoProjects(demoProjects)`; po každé změně sezení v demo intervalu přepočítat stavy a poslat `onProjects` — přidat pomocnou metodu:
  ```ts
  private demoProjects: Project[] = [];
  private setDemoProjects(p: Project[]) { this.demoProjects = p; this.publishDemoProjects(); }
  private publishDemoProjects() {
    const list = [...this.sessions.values()];
    const rank = { dotaz: 0, prace: 1, klid: 2 } as const;
    this.projects = this.demoProjects.map(p => {
      const mine = list.filter(s => s.projectId === p.id);
      const status: Project['status'] = mine.some(s => s.status === 'permission') ? 'dotaz' : mine.length ? 'prace' : 'klid';
      return { ...p, status, lastActivity: Math.max(p.lastActivity, ...mine.map(s => s.lastSeen)) };
    }).sort((a, b) => rank[a.status] - rank[b.status] || b.lastActivity - a.lastActivity);
    this.events.onProjects(this.projects);
  }
  ```
  Zavolat `this.publishDemoProjects()` na konci každého tiku demo intervalu a po přidání/odebrání sezení. České demo texty: `'Povolit Bash: rm -rf dist && npm run build?'`, `'Hotovo. Převedl jsem 12 obrazovek…'`, `'Do kterého regionu má jít nový cluster?'`, `'Oprav zaokrouhlení v košíku'`, atd.
- `focus()`: `'demo: tady bych otevřel terminál'`.

- [ ] **Step 2: `main.ts`**

- `KanclClient` s `onProjects: p => { scene.setProjects(p); panel.setProjects(p); }`.
- Toasty česky: `` `Otevírám terminál ${s.name}…` ``, `'Server neodpovídá'`, `` `Sezení skončilo (${reason})` ``.
- `(window as any).__kancl = …`.

Scene a Panel metody `setProjects` vzniknou v Task 8 a 9; do té doby typecheck selže — proto commit až po Task 8. (Alternativně přidat prázdné metody `setProjects(_p: Project[]) {}` hned a naplnit později.) Zvolit: **přidat prázdné metody hned**, commitnout.

- [ ] **Step 3: Typecheck, commit**

Run: `npm run typecheck`
Expected: OK.

```bash
git add client/src/net.ts client/src/main.ts client/src/game/scene.ts client/src/ui/panel.ts && git commit -m "feat(client): příjem projektů, česká ukázková parta"
```

---

### Task 8: Ostrůvky v kanceláři

**Files:**
- Modify: `client/src/game/world.ts`, `client/src/game/agent.ts`, `client/src/game/scene.ts`

- [ ] **Step 1: `world.ts` — stoly s omezením**

```ts
export function acquireSlot(zone: Zone, agentId: string, seed: number, allowed?: number[]): Slot {
  const mine = zone.slots.find(s => s.takenBy === agentId);
  const ok = (s: Slot) => !allowed || allowed.includes(zone.slots.indexOf(s));
  if (mine && ok(mine)) return mine;
  if (mine) releaseSlot(mine, agentId);
  const free = zone.slots.find(s => !s.takenBy && ok(s)) ?? (allowed ? zone.slots.find(s => !s.takenBy) : undefined);
  if (free) { free.takenBy = agentId; return free; }
  return overflowSlot(zone.id, agentId, seed);
}

/** Obdélník podlahy kolem stolu `i` (pro rámeček ostrůvku). */
export function deskCell(i: number): { x: number; y: number; w: number; h: number } {
  const ws = workstations()[i];
  return { x: ws.x - 4, y: ws.top - 6, w: 58, h: 62 };
}
```

- [ ] **Step 2: `agent.ts` — ostrůvek a subagenti**

- Import `plainAscii` z `../../../shared/names.ts`; `setLabel()` používá `labelTexture(plainAscii(this.session.name), …)`.
- Pole `island: number[] | null = null;` a metoda:
  ```ts
  /** Stoly, u kterých smí sedět (ostrůvek projektu). null = kdekoli. */
  setIsland(desks: number[] | null) {
    const same = (a: number[] | null, b: number[] | null) => a === b || (!!a && !!b && a.length === b.length && a.every((v, i) => v === b[i]));
    if (same(this.island, desks)) return;
    this.island = desks;
    if (this.slot?.zone === 'desks' && desks && !desks.includes(ZONES.desks.slots.indexOf(this.slot))) {
      this.goTo(acquireSlot(ZONES.desks, this.session.id, this.seed, desks), this.slot);
    }
  }
  ```
- V `apply()`: `if (!this.slot || this.slot.zone !== zone) this.goTo(acquireSlot(ZONES[zone], s.id, this.seed, zone === 'desks' ? this.island ?? undefined : undefined), this.slot);`
- Subagenti jako děti:
  ```ts
  private subs = new Map<string, Actor>();
  private syncSubagents(s: Session) {
    const ids = new Set(s.subagents.map(a => a.id));
    for (const [id, actor] of this.subs) if (!ids.has(id)) { this.removeChild(actor); actor.destroy({ children: true }); this.subs.delete(id); }
    let i = 0;
    for (const sub of s.subagents) {
      let actor = this.subs.get(sub.id);
      if (!actor) {
        actor = new Actor(this.look);
        actor.scale.set(0.5);
        actor.play('type', 'down');
        this.subs.set(sub.id, actor);
        this.addChildAt(actor, 1);
      }
      actor.position.set(12 + i * 8, 2);
      i++;
    }
  }
  ```
  Volat `this.syncSubagents(s)` na konci `apply()`; v `tick()` po `super.tick(dt)` iterovat `for (const a of this.subs.values()) a.tick(dt);`. Při chůzi subagenty skrýt: `for (const a of this.subs.values()) a.visible = !this.moving;`.

- [ ] **Step 3: `scene.ts` — vrstva ostrůvků a přeplánování**

- Importy: `Graphics`, `planIslands`, `planKey`, `type Island` z `../../../shared/plan.ts`, `deskCell`, `plainAscii`, `type Project`.
- Pole: `islands = new Container(); private projects: Project[] = []; private lastPlanKey = '__none__'; private islandPlan: Island[] = [];`
- V `init()`: `this.world.addChild(this.ground, this.islands, this.objects);`
- Metody:
  ```ts
  setProjects(projects: Project[]) { this.projects = projects; this.replan(); }

  private sessionsByProject(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const a of this.agents.values()) if (a.session.projectId) out[a.session.projectId] = (out[a.session.projectId] ?? 0) + 1;
    return out;
  }

  private replan() {
    const counts = this.sessionsByProject();
    const key = planKey(this.projects, counts);
    const klidIds = this.projects.filter(p => p.status === 'klid').map(p => p.id).join(',');
    const full = `${key}#${klidIds}`;
    if (full === this.lastPlanKey) return;
    const activeChanged = key !== this.lastPlanKey.split('#')[0];
    this.lastPlanKey = full;
    this.islandPlan = planIslands(this.projects, counts, ZONES.desks.slots.length);
    this.drawIslands();
    if (!activeChanged) return;
    const byProject = new Map(this.islandPlan.map(i => [i.projectId, i.desks]));
    for (const a of this.agents.values()) a.setIsland(a.session.projectId ? byProject.get(a.session.projectId) ?? null : null);
  }

  private drawIslands() {
    this.islands.removeChildren().forEach(c => c.destroy({ children: true }));
    const COLORS = { prace: 0x3fb8b8, dotaz: 0xf5c542, klid: 0x6f7890 } as const;
    const names = new Map(this.projects.map(p => [p.id, p.name]));
    for (const isl of this.islandPlan) {
      const color = COLORS[isl.status];
      const alpha = isl.status === 'klid' ? 0.35 : 1;
      const g = new Graphics();
      const rows = new Map<number, number[]>();
      for (const d of isl.desks) { const r = Math.floor(d / 4); rows.set(r, [...(rows.get(r) ?? []), d]); }
      let first: { x: number; y: number } | undefined;
      for (const desks of rows.values()) {
        const a = deskCell(desks[0]), b = deskCell(desks[desks.length - 1]);
        const x = a.x, y = a.y, w = b.x + b.w - a.x, h = a.h;
        g.rect(x, y, w, h).fill({ color, alpha: 0.12 * alpha }).stroke({ color, width: 1, alpha: 0.8 * alpha });
        if (!first) first = { x, y };
      }
      this.islands.addChild(g);
      const label = new Sprite(labelTexture(plainAscii(names.get(isl.projectId) ?? isl.projectId).slice(0, 14), { color: `#${color.toString(16).padStart(6, '0')}` }));
      label.anchor.set(0, 1);
      label.position.set(first!.x + 2, first!.y);
      label.alpha = alpha;
      this.islands.addChild(label);
    }
  }
  ```
- V `upsert()` po vytvoření/aplikaci agenta: `this.replan();` a u nového agenta před `apply` nastavit ostrůvek: `a.setIsland(...)` (replan to udělá, ale volat `replan()` ještě před `this.objects.addChild(a)` není nutné — stačí po). V `remove()` po `agents.delete(id)`: `this.replan();`.
- `buildGround`: `drawText(px, 20, 134, 'TVOJE KANCL', …)` → `'TVUJ KANCL'`, `'KITCHEN'` → `'KUCHYNKA'`; `buildUser` label `'TY'`.

- [ ] **Step 4: Ověřit v prohlížeči**

Run: `npm run build && KANCL_PORT=4243 npx tsx server/index.ts &` a otevřít `http://127.0.0.1:4243/?demo=1`.
Expected: ostrůvky s cedulkami eshop/api-brana (svítící), landing žlutý s postavičkou u vás, zhasnuté ostrůvky vzadu; u Pepy malá postavička.

- [ ] **Step 5: Commit**

```bash
git add client/src/game && git commit -m "feat(client): ostrůvky stolů podle projektu, subagenti u rodiče"
```

---

### Task 9: Panel jako strom projektů

**Files:**
- Rewrite: `client/src/ui/panel.ts`
- Modify: `client/src/style.css`

- [ ] **Step 1: Přepsat `panel.ts`**

Veřejné rozhraní zůstává (`upsert`, `remove`, `select`, `sorted`, `showToast`, `setConnection`, `bindPrefs`) + `setProjects(p: Project[])`. Vnitřek:

```ts
type Sel = { kind: 'session' | 'project'; id: string } | null;
const LABEL: Record<SessionStatus, string> = { permission: 'dotaz', error: 'chyba', waiting: 'čeká', completed: 'hotovo', working: 'práce', idle: 'klid' };
const HOST_LABEL: Record<Project['host'], string> = { github: 'github', gitlab: 'gitlab', none: 'složka' };
const MR_LABEL = { open: 'otevřený', draft: 'draft', approved: 'schválený', changes_requested: 'změny' } as const;
const KLID_VISIBLE = 8;
```

Řazení sezení v projektu: `ORDER` jako dnes. Strom:
```ts
private groups(): { project: Project | null; sessions: Session[] }[] {
  const byProject = new Map<string, Session[]>();
  const loose: Session[] = [];
  for (const s of this.sessions.values()) {
    if (s.projectId && this.projects.some(p => p.id === s.projectId)) byProject.set(s.projectId, [...(byProject.get(s.projectId) ?? []), s]);
    else loose.push(s);
  }
  const sortS = (l: Session[]) => l.sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.startedAt - b.startedAt);
  const out = this.projects.map(p => ({ project: p, sessions: sortS(byProject.get(p.id) ?? []) }));
  if (loose.length) out.unshift({ project: null, sessions: sortS(loose) });
  return out;
}
sorted(): Session[] { return this.groups().flatMap(g => g.sessions); }
```

`render()`:
- filtr `attention` ukáže jen skupiny se sezením ve stavu permission/waiting/error/completed.
- Klidné projekty: prvních `KLID_VISIBLE` vždy, zbytek za `<li class="more">+ N dalších</li>` (toggle `this.showAll`).
- Řádek projektu:
  ```html
  <li class="proj ${p.status} ${open ? 'open' : ''} ${sel}" data-pid="${id}">
    <div class="proj-row">
      <i class="pdot"></i>
      <span class="pname">${name}</span>
      <span class="phost">${HOST_LABEL[host]}</span>
      <span class="pmeta">${branchOrWt} ${dirty ? `· <b>${dirty} změn</b>` : ''} ${mrs.length ? `· ${mrs.length} PR/MR` : ''}</span>
    </div>
    <ul class="sessions">…session li jako dnes (kbd číslo, jméno, detail, stav, čas) + <li class="sub">└ ${description}</li> za každý subagent…</ul>
  </li>
  ```
  `branchOrWt` = `worktrees.length > 1 ? `${n} worktree` : worktrees[0]?.branch ?? ''`.
- Skupina bez projektu: cedulka `mimo projekty`.
- Klik na `.proj-row` → `this.sel = {kind:'project', id}`; `events.onSelect(null)`; render. Klik na sezení → `events.onSelect(id)` (scene zavolá `panel.select(id)`).
- `select(id: string | null)` nastaví `sel = id ? {kind:'session', id} : null`.

`renderSummary(all)`: `` `${n} sezení · ${prace} v práci · ${dotaz} dotaz` `` s barvami; bez sezení `žádné sezení, spusť <b>claude</b>`.

`renderDetails()` — dvě větve:
- **projekt**: nadpis `název · host`, `mrsError` jako `.msg` řádek, tabulka worktree (`label`, `branch`, `dirty změn`, `↑ahead ↓behind`, `commit hash zpráva · před X`), seznam MR (`!31 název · stav`, odkaz `target="_blank" rel="noopener"`), seznam sezení projektu (klik → onSelect).
- **sezení**: jako dnes, česky: `Stav už`, `Úkol`, `Poslední nástroj`, `Složka`, `Terminál`, `Tahy / nástroje`, `Režim`, `Subagenti: N`, tlačítka `⌘ Otevřít terminál`, `Skrýt`.

Čas: `ago()` → `12s`, `3m 4s`, `1h 2m` beze změny; `před ${ago}` u commitů.

- [ ] **Step 2: Styly**

Do `style.css` přidat:
```css
.tree { list-style: none; margin: 0; padding: 6px 8px; overflow-y: auto; flex: 1; min-height: 0; }
.proj { margin: 0 0 4px; border-radius: 8px; }
.proj-row { display: grid; grid-template-columns: 8px 1fr auto; gap: 8px; align-items: center; padding: 6px 8px; cursor: pointer; border-radius: 8px; }
.proj-row:hover, .proj.selected > .proj-row { background: var(--panel-2); }
.pdot { width: 8px; height: 8px; border-radius: 2px; background: var(--idle); }
.proj.prace .pdot { background: var(--accent); } .proj.dotaz .pdot { background: var(--permission); animation: pulse 1s infinite; }
.pname { font-weight: 600; }
.phost { color: var(--muted); font-size: 10px; text-transform: uppercase; letter-spacing: .5px; }
.pmeta { grid-column: 2 / 4; color: var(--muted); font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pmeta b { color: var(--text); font-weight: 500; }
.proj.klid .pname { color: var(--muted); font-weight: 500; }
.sessions { list-style: none; margin: 0; padding: 0 0 2px 14px; }
.proj:not(.open) .sessions { display: none; }
.sub { color: var(--muted); font-size: 11px; padding: 1px 8px 3px 22px; }
.more { color: var(--muted); font-size: 11px; padding: 6px 8px; cursor: pointer; text-align: center; }
.more:hover { color: var(--text); }
.details table { width: 100%; border-collapse: collapse; font-size: 11px; margin: 6px 0; }
.details td { padding: 2px 4px; border-top: 1px dashed var(--line); color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 120px; }
.details td:first-child { color: var(--text); }
.details .mr a { color: var(--accent); text-decoration: none; }
```
`#session-list` v HTML přejmenovat na `<ul id="tree" class="tree">` a v panelu `document.getElementById('tree')`.

- [ ] **Step 3: Ověřit v prohlížeči (demo) + commit**

Run: `npm run typecheck && npm run build`, otevřít `?demo=1`.
Expected: strom projektů, rozbalené aktivní, sbalené klidné, klik na projekt ukáže tabulku worktree a MR, klávesa `1` vybere první sezení.

```bash
git add client && git commit -m "feat(client): panel jako strom projektů, český detail"
```

---

### Task 10: Dokumentace, přejmenování repa, reinstalace

**Files:**
- Rewrite: `README.md`
- Repo/složka: `davidskoupy/comakers-crew` → `davidskoupy/kancl`, `~/Code/comakers-crew` → `~/Code/kancl`

- [ ] **Step 1: README česky**

Sekce: Co to je (jedna věta + obrázek `docs/hero.png` zatím původní), Co vidíš (stavy sezení, ostrůvky projektů, subagenti), Rychlý start (`npm install`, `npm run hooks:install`, `npm start`), GitLab token (`.env` s `GITLAB_TOKEN=`), Config (`~/.config/kancl/config.json` s příkladem), Klávesy, Jak to funguje (schéma hook → server → SSE → prohlížeč, skener), Skripty (`npm test` navíc), Původ: fork Comakers Crew od rontoday, MIT.

- [ ] **Step 2: Přejmenování a reinstalace hooků**

```bash
cd ~/Code/comakers-crew && git add -A && git commit -m "docs: český README" && \
gh repo rename kancl --yes && \
cd ~/Code && mv comakers-crew kancl && cd kancl && \
git remote set-url origin https://github.com/davidskoupy/kancl.git && \
npm run hooks:install && grep -c '/Code/kancl/hook/kancl-hook.sh' ~/.claude/settings.json
```
Expected: `12`.

- [ ] **Step 3: Restart serveru a push**

```bash
pkill -f "tsx server/index.ts"; cd ~/Code/kancl && npm run build && (nohup npx tsx server/index.ts > ~/.kancl/server.log 2>&1 &) ; sleep 3; curl -s http://127.0.0.1:4242/api/health
git push -u origin main
```
Expected: `{"ok":true,…}`.

- [ ] **Step 4: Browser test na 3 šířkách**

Skill `browser-test` na `http://127.0.0.1:4242/` (reálná data) a `?demo=1`: 375, 768, 1440 px. Panel na 375 px je 300 px široký a scéna se zmenší na ×1; ověřit, že nic nepřetéká vodorovně.

- [ ] **Step 5: Závěrečná verifikace**

Run: `npm run typecheck && npm test && npm run build && curl -s http://127.0.0.1:4242/api/projects | python3 -c "import json,sys;d=json.load(sys.stdin)['projects'];print(len(d),[ (p['name'],p['status'],len(p['worktrees']),len(p['mrs']),p.get('mrsError')) for p in d[:6]])"`
Expected: bez chyb, seznam projektů se stavem, cfo-portal se 6 worktree, GitHub projekty s PR (nebo prázdné), GitLab s `mrsError: 'chybí GITLAB_TOKEN'` dokud není token.

---

## Self-review

- **Pokrytí spec:** §1 rebrand → Task 1, 10; §2 model → Task 2, 4, 6; §3 ostrůvky → Task 3, 8; §4 panel → Task 9; §5 subagenti → Task 2, 8, 9; §6 config → Task 5; §7 chyby → Task 6 (timeouty, mrsError), Task 9 (zobrazení); §8 testy → Task 1–4, 10.
- **Typy:** `Subagent`, `Project`, `Worktree`, `MergeRequest` definované v Task 2 a používané shodně v Task 4, 6, 7, 8, 9. `planIslands(projects, counts, deskCount)` a `planKey(projects, counts)` shodně v Task 3 a 8. `acquireSlot(zone, id, seed, allowed?)` v Task 8 (agent i world). `setProjects` na Scene i Panel (prázdné v Task 7, naplněné v 8 a 9).
- **Známý kompromis:** `lastCommit.at` je v sekundách (git `%ct`), `Session.lastSeen` v ms; převod je pouze ve `fillStatus`. Panel při výpisu `před X` u commitu násobí 1000.
