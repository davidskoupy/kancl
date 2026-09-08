# Kancl · etapa 1 — design

Datum: 2026-09-08
Výchozí stav: fork `rontoday/comakers-crew` (commit 88da78c) v `davidskoupy/comakers-crew`.

## Cíl

Přestavět Comakers Crew na **Kancl**: osobní velín nad všemi projekty a agenty, na kterých David pracuje. Etapa 1 pokrývá rebrand, český panel, vrstvu projektů z lokálních repozitářů (GitHub + GitLab) a viditelné subagenty. Etapy 2 (externí joby: cron-job.org, content engine) a 3 (cloudová sezení a routiny) jsou mimo rozsah tohoto dokumentu.

## Rozhodnutí z brainstormingu

| Otázka | Rozhodnutí |
| --- | --- |
| Značka | Osobní, bez firemní identity. Název **Kancl**, tón hovorový. |
| Které projekty | Vše v `~/Code` (a další kořeny z configu), **sloučené podle git remotu**. Složka bez gitu je projekt sama o sobě. |
| Kancelář | **Ostrůvky stolů podle projektu**, aktivní svítí, klidné zhasnuté. |
| PR/MR | GitHub přes přihlášené `gh`, GitLab přes REST s tokenem z `GITLAB_TOKEN` nebo `.env`. |
| Jména postaviček | **České přezdívky** (Pepa, Tonda, Máňa, …), náhodně podle hashe ID sezení. |
| Získávání dat | Skener uvnitř stávajícího Node serveru, výsledky přes existující SSE. |

## 1 · Rebrand

- Název Kancl všude: `package.json` (name `kancl`), `<title>`, hlavička panelu, notifikace, demo posádka.
- Hook: `hook/kancl-hook.sh`, proměnné `KANCL_PORT` (výchozí 4242) a `KANCL_DEBUG`.
- `hook/install.mjs` při instalaci odstraní i staré záznamy obsahující `comakers-hook.sh`, aby po přejmenování nezůstaly dva hooky. Značka pro rozpoznání vlastních hooků: `kancl-hook.sh`.
- `.command` soubory přejmenovat na `Kancl.command`, `Kancl — Stop.command`, `Kancl — Autostart.command`; LaunchAgent label `cz.skoupy.kancl`.
- Celé UI panelu česky. Stavy: `práce`, `dotaz`, `čeká`, `hotovo`, `chyba`, `klid`.
- Seznam 40 českých přezdívek nahradí `NAMES` v `server/state.ts`.
- Repo na GitHubu přejmenovat na `kancl`, složku na `~/Code/kancl`, poté znovu `npm run hooks:install` (cesta ke skriptu v `settings.json` je absolutní).
- README přepsat česky, s poznámkou o původu (fork Comakers Crew, MIT) a zachovat LICENSE.

## 2 · Model projektu

### Skenování

- Kořeny: z configu, výchozí `["~/Code"]`. Pouze první úroveň podsložek.
- Pro každou složku: `git rev-parse --show-toplevel` a `git remote get-url origin`. Složka bez gitu → projekt `host: "none"`.
- **Klíč projektu** = normalizovaný remote: `host/cesta` bez `git@`, `https://`, `.git`, `:` → `/`. Příklad: `gitlab.shean.dev/others/cfo-portal`. Bez remotu: absolutní cesta složky.
- Složky se stejným klíčem se slučují do jednoho projektu jako **worktree**.
- Skryté projekty z configu se přeskočí.

### Datový model (`shared/types.ts`)

```ts
type Host = 'github' | 'gitlab' | 'none';
type ProjectStatus = 'dotaz' | 'prace' | 'klid';

interface Worktree {
  path: string;          // absolutní
  label: string;         // název složky
  branch: string;        // nebo "(detached)"
  dirty: number;         // počet změněných souborů (git status --porcelain)
  ahead: number;
  behind: number;
  lastCommit?: { hash: string; message: string; at: number };
  error?: string;        // timeout / rozbitý repozitář
}

interface MergeRequest {
  number: number;
  title: string;
  url: string;
  branch: string;
  state: 'open' | 'draft' | 'approved' | 'changes_requested';
  updatedAt: number;
}

interface Project {
  id: string;            // normalizovaný remote nebo cesta
  name: string;          // poslední segment remotu, jinak název složky
  host: Host;
  remoteUrl?: string;
  worktrees: Worktree[];
  mrs: MergeRequest[];
  mrsError?: string;     // "chybí GITLAB_TOKEN", "gh není přihlášené"
  status: ProjectStatus; // odvozený
  lastActivity: number;  // max(lastSeen sezení, lastCommit.at)
  scannedAt: number;
}
```

- `Session` dostane `projectId?: string`. Párování: `cwd` sezení (nebo jeho nadřazené složky) leží uvnitř některého worktree.
- Odvozený stav projektu: `dotaz` pokud některé sezení je `permission`; jinak `prace` pokud existuje sezení v `working | waiting | completed | error | idle`; jinak `klid`.
- Řazení: `dotaz` → `prace` → `klid`, uvnitř skupiny podle `lastActivity` sestupně.

### Obnova

| Co | Interval | Jak |
| --- | --- | --- |
| Seznam složek | při startu + každých 5 min | `readdir` kořenů |
| Lokální git (větev, dirty, ahead/behind, commit) | každých 15 s | `git` s timeoutem 3 s, paralelně max 4 |
| GitHub PR | každých 5 min + po `Stop` sezení v projektu | `gh api repos/{owner}/{repo}/pulls?state=open` |
| GitLab MR | každých 5 min + po `Stop` sezení v projektu | `GET /api/v4/projects/{id}/merge_requests?state=opened`, hlavička `PRIVATE-TOKEN` |

- Skener **nikdy nedělá `git fetch`**; `ahead/behind` počítá vůči lokálnímu tracking ref.
- Změny se broadcastují jen když se projekt skutečně změnil (porovnání JSON).

### API a SSE

- `GET /api/projects` → `{ projects: Project[] }`.
- `ServerMessage` rozšířit o `{ type: 'projects'; projects: Project[] }` (celý seznam, je malý) a snapshot o `projects`.

## 3 · Kancelář s ostrůvky

- Mřížka 12 stolů (4 × 3) v `client/src/game/world.ts` zůstává.
- Nový modul `client/src/game/plan.ts`: čistá funkce `planIslands(projects, sessions, deskCount) → Island[]`, kde `Island = { projectId, status, desks: number[] }` (indexy stolů, souvislé po řádcích).
  1. Projekty `dotaz` a `prace` v pořadí panelu: velikost = `min(4, počet sezení + 1)`.
  2. Zbylé stoly: projekty `klid` podle `lastActivity`, po jednom stole.
  3. Co se nevejde, ostrůvek nemá.
- Přeplánování jen když se změní množina `{projectId, status ≠ klid}` nebo počet sezení v aktivním projektu, ne při každé události.
- Vykreslení (`office.ts`): pod stoly ostrůvku tmavší podlaha s rámečkem, nad ním cedulka s názvem projektu ve 3×5 fontu (max 14 znaků, jinak zkráceno s `…`). Barva rámečku: `prace` tyrkys, `dotaz` žlutá, `klid` šedá s 50% alfa.
- Sezení (`agent.ts`) si bere volný stůl **uvnitř svého ostrůvku**; když ostrůvek zanikne nebo se přesune, postavička vstane a přejde k novému stolu. Sezení bez projektu (cwd mimo kořeny) sedí u libovolného volného stolu jako dnes.
- Cesty k vám, kuchyňka, složka, cedule `?`/`!` beze změny.

## 4 · Panel

- Hlavička: `KANCL` + souhrn `3 sezení · 2 projekty v práci · 1 dotaz`.
- Strom projektů v pořadí ze serveru. Řádek projektu: název, hostitel (ikona), větev hlavního worktree nebo `6 worktree`, `N změn`, `N PR/MR`, indikátor stavu.
- Pod projektem sezení: přezdívka, barevný stav, poslední činnost. Subagenti odsazení pod rodičem.
- `dotaz` a `prace` rozbalené, `klid` sbalené, za prvními 8 klidnými projekty řádek `+ N dalších` (rozbalitelný).
- Detail projektu (klik): každý worktree s větví, změnami, ahead/behind, posledním commitem; seznam PR/MR s odkazy (otevřou se v prohlížeči); sezení s logem událostí jako dnes.
- Klávesy `1`–`9` číslují sezení v pořadí panelu, `Enter` fokus terminálu, `Esc` zrušit výběr.
- Chybové stavy: u projektu bez tokenu/`gh` jedna věta `PR/MR nedostupné: chybí GITLAB_TOKEN`; u worktree s chybou `git neodpovídá`.

## 5 · Subagenti

- `Session.subagents: number` nahradit `Session.subagents: Subagent[]`, `Subagent = { id, description, startedAt }`. `id` z hooku `SubagentStart` (`agent_id`, fallback hash popisu + času).
- `SubagentStop` subagenta odstraní. `SessionEnd` rodiče odstraní všechny.
- Klient: sprite v polovičním měřítku (16×16) u stolu rodiče, stejná barva, animace `type`. Bez vlastního stavu, vždy „práce“.
- Panel: odsazený řádek `└ popis úkolu` pod rodičem.

## 6 · Config

`~/.config/kancl/config.json` (vytvoří se s výchozími hodnotami při prvním startu):

```json
{
  "roots": ["~/Code"],
  "hidden": [],
  "gitIntervalSec": 15,
  "remoteIntervalMin": 5,
  "gitlabHosts": ["gitlab.shean.dev"]
}
```

- Token: `process.env.GITLAB_TOKEN`, jinak `.env` v kořeni repa Kanclu (`GITLAB_TOKEN=…`, soubor v `.gitignore`).
- Config se čte při startu; změna vyžaduje restart serveru.

## 7 · Chyby a limity

- Git příkazy: timeout 3 s, chyba se uloží do `Worktree.error`, skener pokračuje.
- GitHub/GitLab: chyba HTTP nebo chybějící přihlášení → `Project.mrsError`, `mrs` zůstanou z posledního úspěšného běhu.
- Skener neblokuje zpracování hooků: běží v samostatných `setInterval` a async funkcích, hook handler zůstává synchronní jako dnes.
- Hook skript se nemění chováním: timeout 2 s, vždy exit 0.

## 8 · Testy a ověření

- Node test runner (`node --test`), bez nové závislosti, `npm test`:
  - `projects.test.ts`: normalizace remotu, slučování složek do worktree, odvození stavu a řazení.
  - `plan.test.ts`: `planIslands` pro 0, 1, 3 aktivní projekty, přetečení 12 stolů, stabilita plánu při nezměněné množině.
  - `state.test.ts`: `SubagentStart/Stop` vedou seznam subagentů, `SessionEnd` je čistí.
  - `install.test.mjs`: instalace odstraní staré `comakers-hook.sh` záznamy a cizí hooky zachová.
- `npm run typecheck`, `npm run build`.
- Prohlížeč: `?demo=1` s demo posádkou rozšířenou o projekty, na šířkách 375, 768 a 1440 px (skill `browser-test`).
- Ruční: skutečná sezení ve dvou projektech, ověřit ostrůvky, přechod postavičky při vzniku nového projektu, GitLab MR u cfo-portal, GitHub PR u dopner.

## Mimo rozsah etapy 1

- Fokus okna desktopové aplikace Claude (sezení bez tty).
- Externí joby (cron-job.org, content engine) — etapa 2.
- Cloudová sezení a routiny — etapa 3.
- `git fetch` na pozadí, push/pull z Kanclu, jakékoli zápisy do repozitářů.
