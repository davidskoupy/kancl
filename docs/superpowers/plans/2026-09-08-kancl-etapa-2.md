# Kancl · etapa 2 — Noční směna: implementační plán

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Zobrazit v Kanclu naplánované úlohy Claude a výsledky content enginů (content-engine, Dopner) jako „noční směnu" robotů v novém pásu kanceláře a v sekci panelu.

**Architecture:** Čistá logika (cron parser, český popis rozvrhu, parser `runs.md`, parser zásoby, odvození stavu) v `server/night.ts` s testy. I/O skener `server/nightScanner.ts` čte `scheduled-tasks.json`, SKILL.md frontmatter a runs/state soubory každých 60 s a publikuje `NightShift` přes SSE. Klient: mapa +3 řádky, zóna serverovny, robot sprite, sekce panelu a detail úlohy.

**Tech Stack:** stejný jako etapa 1 (Node 20, tsx, Vite, PixiJS 8, node:test). Žádná nová závislost.

Spec: `docs/superpowers/specs/2026-09-08-kancl-etapa-2-design.md`.

---

## Struktura souborů

| Soubor | Stav | Odpovědnost |
| --- | --- | --- |
| `shared/types.ts` | upravit | `Job`, `JobRun`, `Stock`, `NightShift`, `ServerMessage.night` |
| `server/night.ts` | nový | `parseCron`, `nextRun`, `scheduleHuman`, `parseRunsMd`, `parseStock`, `deriveJobState`, `readFrontmatter` |
| `server/nightScanner.ts` | nový | glob `scheduled-tasks.json`, čtení SKILL.md, runs.md, state.json, intervaly, publish |
| `server/config.ts` | upravit | `night.engines` s výchozími cestami |
| `server/index.ts` | upravit | `/api/night`, SSE `night`, snapshot |
| `client/src/net.ts` | upravit | zpráva `night`, demo noční směna |
| `client/src/game/world.ts` | upravit | `ROWS = 21`, zóna `server`, pozice robotů |
| `client/src/game/office.ts` | upravit | dlaždice `server` |
| `client/src/game/sprites.ts` | upravit | `robotSprite()` |
| `client/src/game/scene.ts` | upravit | `setNight()`, roboti, hodiny, klik |
| `client/src/ui/panel.ts` | upravit | sekce Noční směna, detail úlohy, `selectJob` |
| `client/src/style.css`, `client/index.html`, `client/src/main.ts` | upravit | styly, propojení |
| `tests/night.test.ts` | nový | testy čisté logiky |

---

### Task 1: Čistá logika `server/night.ts` + typy

**Files:** Modify `shared/types.ts`; Create `server/night.ts`, `tests/night.test.ts`

- [ ] **Step 1: Typy** (viz spec, sekce Datový model) + `ServerMessage`: snapshot `night: NightShift`, nová zpráva `{ type: 'night'; night: NightShift }`.
- [ ] **Step 2: Test** `tests/night.test.ts` (selže):

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCron, nextRun, scheduleHuman, parseRunsMd, parseStock, deriveJobState, readFrontmatter } from '../server/night.ts';

test('parseCron + nextRun: denně 7:00', () => {
  const from = new Date(2026, 8, 8, 12, 0);            // út 8. 9. 2026 12:00
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
  assert.equal(scheduleHuman(undefined, Date.UTC(2026, 8, 10, 7, 0)), 'jednou 10. 9. 9:00');
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
```

- [ ] **Step 3: Implementace** `server/night.ts` (viz kód v commitu; klíčové signatury):

```ts
export interface CronSpec { min: number[]; hour: number[]; mday: number[]; mon: number[]; wday: number[] }
export function parseCron(expr: string): CronSpec | null;
export function nextRun(expr: string, from: Date): Date | null;       // prochází dny (max 400) a seřazené hodiny/minuty
export function scheduleHuman(expr?: string, fireAt?: number): string; // lokální čas
export interface RunRow { kind: 'run' | 'alarm'; at: number; project?: string; slug?: string; result: 'ok' | 'fail' | 'skip'; resultText: string; note?: string }
export function parseRunsMd(text: string): RunRow[];
export function parseStock(note: string): { project: string; pending: number; alarm: boolean }[];
export function deriveJobState(j: { enabled: boolean; lastRunAt?: number; lastResultAt?: number; lastResult?: 'ok' | 'fail' | 'skip' }, now: number): JobState;
export function readFrontmatter(md: string): Record<string, string>;
```

- [ ] **Step 4:** `npm test` zelené, `npm run typecheck`, commit `feat: čistá logika noční směny`.

### Task 2: Skener a server

**Files:** Create `server/nightScanner.ts`; Modify `server/config.ts`, `server/index.ts`

- [ ] Config: `night: { enabled: true, engines: [{ id: 'content-engine', runsFile: '~/Code/content-engine/runs.md', stateFile: '~/Code/content-engine/state.json', taskId: 'daily-content' }, { id: 'dopner', runsFile: '~/Code/Dopner/content-runs.md', taskId: 'dopner-tydenni-clanek' }] }`.
- [ ] `NightScanner`: `start()` čte hned a každých 60 s; `scanTasks()` projde `~/Library/Application Support/Claude/claude-code-sessions/*/*/scheduled-tasks.json` (readdir 2 úrovně, try/catch), sloučí podle `id` (novější `lastRunAt` vyhrává), načte frontmatter SKILL.md, spočítá `nextRunAt`, `scheduleHuman`, `projectId` přes `store.projectResolver`; `scanEngines()` parsuje runs.md → poslední řádek `run` + poslední `alarm` → `lastResult` u spárované úlohy a `stock`; `publish()` s JSON diffem → `onChange(night)`.
- [ ] `index.ts`: `GET /api/night`, snapshot `night`, SSE `night`, start po listen. Když `night.enabled === false`, skener se nespustí a `night` je prázdný.
- [ ] Smoke: `KANCL_PORT=4243`, `curl /api/night` → 8 úloh, daily-content s `lastResult.project === 'deky'`, stock s `zahradni-domky 3 alarm`. Commit.

### Task 3: Kancelář — pás Noční směna a roboti

**Files:** Modify `client/src/game/world.ts`, `office.ts`, `sprites.ts`, `scene.ts`

- [ ] `world.ts`: `ROWS = 21`; `SPAWN.y = 350`, `EXIT.y = 354`, `ENTRANCE_SPINE.y = 324`; `groundMap`: řádky 18–19, sloupce 12–28 → `'server'`; export `NIGHT = { x: 192, y: 288, w: 272, h: 32 }` a `robotSlot(i)` → `{ x: 208 + i * 32, y: 316 }` (max 8).
- [ ] `office.ts`: `TileKind` + `'server'`: tmavá `#1d2233`, modrý rastr `#2a3350`, občas svítící dioda `#3fb8b8`.
- [ ] `sprites.ts`: `robotSprite(colorIndex, anim: 'sleep' | 'work')`: 14×18 px, hranaté tělo v barvě `PALETTE[colorIndex]`, hlava s anténou, oči (zavřené `-` při spánku, blikají při práci), `fps` 2. Memo podle klíče.
- [ ] `scene.ts`: `setNight(n: NightShift)`; kontejner `robots`; pro každou úlohu se `state !== 'vypnuto'` (max 8) sprite + hodiny (`labelTexture(shortSchedule)`), bublina podle stavu (`zz`/`dots`/`check`/`bang`), `eventMode static` + `pointertap` → `events.onJob(id)`; `drawText(px, 196, 296, 'NOCNI SMENA', …)` do ground. Změna stavu → jen přepnout textury (bez přestavby).
- [ ] Vizuální kontrola na `?demo=1` (demo: 4 roboti) a reálná data. Commit.

### Task 4: Panel — sekce a detail

**Files:** Modify `client/src/ui/panel.ts`, `style.css`, `index.html`, `main.ts`, `net.ts`

- [ ] `net.ts`: `onNight`, zpráva `night`, demo `NightShift` (daily-content ok dnes, outreach ok, dopner spí, kayla jednou; stock s alarmem).
- [ ] `panel.ts`: `setNight(n)`, `selectJob(id)`; `Sel` + `{ kind: 'job' }`; sekce `<li class="nhead">Noční směna</li>` + `<li class="job {state}">` (název, `scheduleHuman`, řádek `poslední: dnes 07:04 · deky ✓ tvrda-vs-mekka-matrace` nebo `další: zítra 7:00`); za daily-content řádek `stock` (žlutý při alarmu); detail úlohy (popis, cron + lidsky, projekt, poslední/další běh, poznámka do 200 znaků, tlačítko `Otevřít SKILL.md` → `POST /api/open` s `{ path }`, server `open <path>` jen pro cesty pod `~/.claude/scheduled-tasks`). Souhrn: `· N úloh dnes ✓` / `N chyba`.
- [ ] `main.ts`: `onNight: n => { scene.setNight(n); panel.setNight(n); }`, scéna `onJob: id => panel.selectJob(id)`.
- [ ] Styly `.nhead`, `.job`, `.stock`, stavové barvy (`spi` fialová, `bezi` modrá, `ok` zelená, `chyba` červená, `vypnuto` šedá).
- [ ] Browser test 3 šířky, commit.

### Task 5: Dokumentace a nasazení

- [ ] README: sekce „Noční směna" (zdroje, config `night.engines`, co Kancl nedělá).
- [ ] `npm run typecheck && npm test && npm run build`, restart serveru na 4242, `curl /api/night`, push.

## Self-review

Spec pokrytí: zdroje A/C/D → Task 2; model → Task 1; kancelář → Task 3; panel → Task 4; chyby (chybějící soubory tiše, neznámý cron → surový text) → Task 1–2; testy → Task 1 + Task 4 browser. Signatury `deriveJobState`, `parseRunsMd`, `scheduleHuman` shodné mezi testem a implementací.
