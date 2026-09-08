# Kancl · etapa 3 — Cloud přes most: implementační plán

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cloudové routiny a sezení v Kanclu bez tokenu: naplánovaná úloha Claude zapisuje snímek `~/.kancl/cloud.json`, Kancl ho čte, routiny jsou roboti v noční směně, sezení sekce „V cloudu".

**Architecture:** Čistý parser snímku `server/cloud.ts` (stav routiny, UTC → lokální rozvrh, filtr sezení) s testy; `nightScanner` snímek sloučí do `NightShift`. Klient: serverovna 3 řádky, dvě řady robotů, cloud barva, štítek a odkaz v panelu, sekce V cloudu, stáří snímku. Most = SKILL.md úlohy `kancl-cloud-snapshot` (každou hodinu).

**Tech Stack:** beze změny (Node 20, tsx, Vite, PixiJS 8, node:test).

Spec: `docs/superpowers/specs/2026-09-08-kancl-etapa-3-design.md`.

---

### Task 1: Typy a čistý parser snímku
**Files:** Modify `shared/types.ts`; Create `server/cloud.ts`, `tests/cloud.test.ts`
- [ ] Typy: `JobSource` + `'routine'`; `Job.url?`, `Job.model?`; `CloudSession`; `NightShift.cloudSessions`, `snapshotAt?`, `snapshotError?`.
- [ ] Test (selže): parse ok/fail/running/run_once_fired, `scheduleHumanUtc('0 14 * * 5', 120) === 'pátek 16:00'`, filtr sezení, rozbitý JSON → error.
- [ ] Implementace `parseCloudSnapshot(text: string | undefined, now: number, offsetMin = -new Date().getTimezoneOffset())`, `scheduleHumanUtc(cron, offsetMin)`.
- [ ] `npm test`, `npm run typecheck` (klient dočasně `cloudSessions: []` v demu), commit.

### Task 2: Scanner + config
**Files:** Modify `server/nightScanner.ts`, `server/config.ts`
- [ ] Config `night.cloudSnapshot: '~/.kancl/cloud.json'`.
- [ ] `scan()`: po lokálních úlohách načíst snímek, `jobs.push(...cloud.jobs)`, `cloudSessions`, `snapshotAt`, `snapshotError`; řazení: `bezi`/`chyba` první, pak `nextRunAt`.
- [ ] Smoke `curl /api/night` po Task 4 (snímek existuje). Commit.

### Task 3: Klient — kancelář a panel
**Files:** Modify `client/src/game/world.ts` (ROWS 22, NIGHT.h 48, `robotSlot` dvě řady), `sprites.ts` (`robotSprite(colorIndex, anim, cloud)`), `scene.ts` (16 robotů, cloud vzhled), `panel.ts` (štítek cloud, detail s odkazem a modelem, hlavička se snímkem, sekce V cloudu), `style.css`, `net.ts` (demo: 2 routiny, 3 cloud sezení, snapshotAt).
- [ ] Build, `?demo=1`, reálná data, 3 šířky. Commit.

### Task 4: Most — naplánovaná úloha a první snímek
- [ ] Vytvořit lokální úlohu `kancl-cloud-snapshot` (`20 * * * *`, cwd `~/Code/kancl`) se SKILL.md podle spec.
- [ ] První snímek vyrobit hned (stejný postup ručně), ověřit `/api/night`: routiny s `source: 'routine'`, `cloudSessions` neprázdné.
- [ ] README sekce „Cloud přes most". Restart serveru, push.

## Self-review
Spec → Task: snímek + parser (1), scanner (2), kancelář/panel (3), most (4). Signatury `parseCloudSnapshot` a `scheduleHumanUtc` shodné v testu i implementaci.
