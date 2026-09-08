# Kancl · etapy 4–6 — design

Datum: 2026-09-09 (noční běh). Zadání: artefakt „Kancl: co dál" schválený Davidem („jdi do toho"). Tři etapy, každá samostatně nasaditelná.

## Etapa 4 · sezení

**Cíl:** Kancl má fungovat s desktopovou aplikací Claude stejně dobře jako s terminálem.

- **Názvy sezení z aplikace.** `server/desktop.ts` indexuje `~/Library/Application Support/Claude/claude-code-sessions/*/*/local_*.json` (každých 60 s): `cliSessionId → { desktopId: sessionId, title, lastActivityAt, isArchived }`. `Session` dostane `title?` a `desktopId?`. Panel ukazuje `title` (fallback přezdívka), přezdívka zůstává jmenovkou v kanceláři a malým textem v panelu.
- **Skok do aplikace.** Ověřeno v bundlu aplikace: `claude://code/continue?session=<local_id>` (regex `^local_[A-Za-z0-9-]{1,64}$`) otevře sezení; `claude://resume?session=<uuid>` importuje CLI sezení. `focusTerminal` dostane `desktopId`: když existuje, `open "claude://code/continue?session=…"` a aktivace aplikace; jinak dosavadní cesta (iTerm, Terminal, tmux).
- **Fronta podle čekání.** Sezení ve stavech dotaz/chyba/čeká/hotovo se řadí podle `statusSince` vzestupně (nejdéle čekající první) uvnitř skupiny stavů. Souhrn ukáže „nejdéle čeká Lojza 18 min".
- **Tab.** Přeskočí na další sezení ve frontě „chce mě" (cyklicky), Shift+Tab zpět. Enter otevře.
- **Mini režim.** `?mini=1` vykreslí jen pruh: souhrn, fronta „chce mě" (jméno, název sezení, stav, čekání), stav noční směny (počet ok/chyba, stáří snímku). Bez PixiJS scény (šetří CPU). Klik na řádek = focus.

## Etapa 5 · zdraví

- **Workflow runs.** U GitHub projektů `gh run list --repo … --limit 3 --json name,status,conclusion,createdAt,url,displayTitle` spolu s PR (každých 5 min). `Project.ci?: { status: 'ok' | 'fail' | 'running' | 'none'; name; at; url; runs: CiRun[] }`. Panel: v meta řádku `CI ✗` červeně / `CI ✓`; v detailu poslední 3 běhy s odkazy. Nic se nezakládá, jen se čte.
- **Notifikace noční směny.** `attention.ts` sleduje i `NightShift`: úloha přejde do `chyba` (klíč `id+lastRunAt`), snímek cloudu starší než 2 h (jednou, dokud se neobnoví), nový alarm zásoby (klíč `stock.at`). Stejné kanály: titulek, favicon, macOS notifikace, zvuk (zvuk jen u chyby).
- **Stárnutí.** `Worktree.dirtyOldest?` (ms; nejstarší mtime mezi změněnými soubory, max 50 souborů), `Worktree.merged?` (`git merge-base --is-ancestor HEAD <main>`; main = `origin/HEAD` nebo `main`/`master`). `Worktree.stale` = merged && poslední commit > 14 dní && projekt má > 1 worktree. Panel: „26 změn · nejstarší 9 d" a štítek `zastaralé`; v detailu tlačítko, které zkopíruje `git worktree remove <cesta>` do schránky. Kancl nic nemaže.
- **Historie 7 dní.** `server/history.ts` zapisuje `~/.kancl/history.jsonl`: `session_end` (jméno, název, projekt, tahy, nástroje, trvání), `job_ok` / `job_fail` (úloha, výsledek), `ci_fail` (projekt, workflow), `stock_alarm`. Při startu a jednou denně odstraní záznamy starší než 7 dní. `GET /api/history?since=<ms>`.

## Etapa 6 · přehled

- **Hledání.** Pole nahoře v panelu filtruje projekty, sezení (jméno i název), úlohy a cloudová sezení. Esc vyprázdní.
- **Skupiny.** Config `groups: [{ name: 'Shean', match: ['gitlab.shean.dev/*'] }, …]` (glob na `Project.id` nebo `name`). Panel: záhlaví skupin v pořadí z configu, nezařazené na konci jako „ostatní". Řazení uvnitř skupiny beze změny. Kancelář se nemění.
- **Připnutí.** Špendlík u projektu (localStorage `kancl.pinned`); připnuté projekty jsou nahoře ve své skupině i v klidu.
- **Pamatování.** Rozbalení klidných projektů, filtr, zoom, hledání → localStorage.
- **Ranní digest.** `GET /api/digest?since=<ms>` sestaví z historie + aktuálního stavu: sezení skončená od `since`, úlohy ok/chyba, CI selhání, alarm zásoby, dotazy čekající teď. Stránka `?digest=1` to vykreslí jako čitelný český přehled s časem od–do; výchozí `since` = včera 18:00. Skill `/morning` může číst JSON.
- **Tailscale, klíče.** Jen dokumentace: `KANCL_HOST=<tailnet IP>` (nikdy `0.0.0.0`), `GITLAB_TOKEN`, `CRONJOB_API_KEY`.

## Hranice

Kancl nic nespouští, nemaže, neposílá. Deep link jen otevírá okno aplikace. Schránka jen na výslovný klik.

## Testy

- `desktop.test.ts`: parsování `local_*.json` (title, cliSessionId, archivované se přeskočí).
- `projects.test.ts`: `ci` z JSON `gh run list`, stale worktree.
- `history.test.ts`: rotace, `since` filtr, digest z historie.
- `groups.test.ts`: glob přiřazení.
- Typecheck, build, prohlížeč 3 šířky včetně `?mini=1` a `?digest=1`.
