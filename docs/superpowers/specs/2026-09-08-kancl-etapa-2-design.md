# Kancl · etapa 2 — Noční směna (design)

Datum: 2026-09-08. Navazuje na etapu 1 (`2026-09-08-kancl-etapa-1-design.md`).

## Cíl

Ukázat v Kanclu i to, co běží samo bez sezení: naplánované úlohy Claude a výsledky obsahových enginů.
Zdroje etapy 2 (rozhodnuto): **A** naplánované úlohy Claude, **C** content engine (`runs.md`, `state.json`), **D** Dopner (`content-runs.md`).
cron-job.org (B) je mimo rozsah, protože klíč není k dispozici; datový model s ním počítá (`source: 'cronjob'`), aby šel doplnit bez změny UI.

## Rozhodnutí

| Otázka | Rozhodnutí |
| --- | --- |
| Kde v kanceláři | **Vlastní pás „Noční směna"** pod open space: mapa se prodlouží o 3 řádky dlaždic (ROWS 18 → 21), pás je serverovna s roboty. |
| Co je robot | Jedna naplánovaná úloha. Spí (bublina `zz`) do času běhu, během běhu píše, po běhu drží `✓` nebo `!` po dobu 3 h, pak zase spí. |
| Panel | Nová sekce **Noční směna** pod projekty: řádek na úlohu (název, rozvrh česky, poslední běh, výsledek), žlutý řádek **alarm zásoby** z content enginu. Klik na úlohu → detail. |
| Přiřazení k projektu | Úloha má `cwd` → `projectId` přes stejný resolver jako sezení. V detailu projektu se úlohy vypíší; v kanceláři sedí vždy v pásu. |

## Zdroje dat

### A · Naplánované úlohy Claude

- Soubor `~/Library/Application Support/Claude/claude-code-sessions/*/*/scheduled-tasks.json` (glob, sloučit všechny nalezené; duplicitní `id` vyhrává záznam s novějším `lastRunAt`).
- Pole: `id`, `cronExpression` nebo `fireAt`, `enabled`, `filePath` (SKILL.md), `lastRunAt`, `lastScheduledFor`, `cwd`.
- `description` a lidský název z frontmatteru SKILL.md (`name`, `description`).
- Další běh: spočítat z cronu (vlastní minimalistický parser pro 5 polí s `*`, čísly, seznamy `1,2`, rozsahy `1-5`, kroky `*/15`; timezone lokální) nebo `fireAt`.
- Zobrazit: `enabled` úlohy + zakázané/jednorázové, které běžely za posledních 7 dní. Ostatní skrýt.
- Obnova: soubor číst každých 60 s (fs.watch není spolehlivý na iCloud/AppSupport, polling stačí).

### C · Content engine

- `~/Code/content-engine/state.json`: `posledni_projekt`, `posledni_beh`, `poradi` → „dnes/zítra na řadě".
- `~/Code/content-engine/runs.md`: poslední řádek s datem `| YYYY-MM-DD | web | slug | výsledek | poznámka |`. Parsovat jen sloupce datum, web, slug, výsledek (poznámku zkrátit na 200 znaků). Výsledek: `ok` když začíná `✅`, `skip` když `⏭`, jinak `fail`.
- Alarm zásoby: poslední řádek, jehož výsledek obsahuje `alarm zásoby` nebo `🟠`; z poznámky vytáhnout dvojice `web N` regexem `([\w-]+)\s+(\d+)` po „zásoba" a tučné `**web N**` jako alarmové. Zobrazit jako řádek `zásoba témat: zahradni-domky 3 · deky 28 · …` se žlutou barvou, když některé ≤ 5.
- Cesty konfigurovatelné v configu: `engines: [{ id: 'content-engine', runsFile, stateFile, taskId: 'daily-content' }, { id: 'dopner', runsFile, taskId: 'dopner-tydenni-clanek' }]`. `taskId` spáruje výsledek s robotem.

### D · Dopner

- `~/Code/Dopner/content-runs.md`, stejný parser řádků jako C (formát je tabulka `| datum | … |`; sloupce, které chybí, zůstanou prázdné). Bez state.json a bez alarmu zásoby.

## Datový model (`shared/types.ts`)

```ts
export type JobSource = 'claude' | 'cronjob';
export type JobState = 'spi' | 'bezi' | 'ok' | 'chyba' | 'vypnuto';

export interface JobRun { at: number; result: 'ok' | 'fail' | 'skip'; project?: string; slug?: string; note?: string }

export interface Job {
  id: string;             // task id
  source: JobSource;
  name: string;           // z frontmatteru SKILL.md, jinak id
  description?: string;
  schedule: string;       // cron nebo "1× 10. 9. 9:00"
  scheduleHuman: string;  // "denně 7:00", "pondělí 6:00", "jednou 10. 9. 9:00"
  enabled: boolean;
  cwd?: string;
  projectId?: string;
  filePath?: string;
  lastRunAt?: number;
  nextRunAt?: number;
  lastResult?: JobRun;    // z runs.md, pokud je engine spárovaný
  state: JobState;        // odvozený
}

export interface Stock { engine: string; at: number; items: { project: string; pending: number; alarm: boolean }[] }

export interface NightShift { jobs: Job[]; stock?: Stock; scannedAt: number }
```

- `ServerMessage`: snapshot dostane `night: NightShift`, nová zpráva `{ type: 'night'; night: NightShift }`. `GET /api/night`.
- Odvození `state`: `vypnuto` když `!enabled` a nebyl běh za 7 dní; `bezi` když `now - lastRunAt < 20 min` a pro dnešek ještě není řádek v runs.md (nebo engine nespárovaný); `ok`/`chyba` když `lastRunAt` je < 3 h a `lastResult` (nebo bez enginu: `ok`); jinak `spi`.

## Kancelář

- `world.ts`: `ROWS = 21`, `H = 336`. Vstup/spawn se posune na nový spodní okraj (`SPAWN.y`, `EXIT.y`, `ENTRANCE_SPINE.y` +48). Kuchyňka a tvá kancelář zůstávají.
- Nová zóna `night` v `groundMap()`: řádky 18–19 sloupce 12–28 dlaždice `server` (tmavá podlaha s modrým rastrem, nová `TileKind`), řádek 17 zůstává chodba/koberec. Nápis `NOCNI SMENA` v 3×5 fontu.
- Roboti: nový sprite `robotSprite(colorIndex)` v `sprites.ts` (16×20 px, hranatá hlava s anténou, dvě animace: `sleep` 2 snímky s bublinou `zz`, `work` 3 snímky blikající oči). Kreslený stejným způsobem jako postavy (procedurálně, žádné obrázky).
- Rozmístění: až 8 robotů v pásu vedle sebe (x od 208 po 32 px), pod každým hodiny `labelTexture` s `scheduleHuman` zkráceným (`7:00`, `po 6:00`, `10.9.`) a barvou podle stavu. Klik na robota → `panel.selectJob(id)`.
- Bubliny: `zz` (spí), `dots` (běží), `check` (ok), `bang` (chyba). Vypnuté úlohy se nezobrazují v kanceláři, jen v panelu (šedě).

## Panel

- Sekce `NOČNÍ SMĚNA` za projekty. Řádek: fialová tečka, název, `scheduleHuman`; druhý řádek `poslední: dnes 07:04 · deky ✓ tvrda-vs-mekka-matrace`, nebo `další: zítra 07:00`. Stav barvou: ok zelená, chyba červená, běží modrá, spí fialová, vypnuto šedá.
- Řádek `zásoba témat` (žlutý, když alarm) hned pod `daily-content`.
- Detail úlohy: název, popis, rozvrh (cron i lidsky), složka/projekt, poslední běh, další běh, poslední výsledek s poznámkou (do 200 znaků), tlačítko `Otevřít SKILL.md` (přes `POST /api/open` → `open -R`? ne — jen `open <path>` v editoru = `open -t`). Zůstat u `open` s výchozí aplikací.
- Souhrn dole: `… · 2 úlohy dnes ✓` (a `1 chyba` červeně, když je).

## Server

- `server/night.ts`: čistá logika — `parseCron`, `nextRun(cron, from)`, `scheduleHuman`, `parseRunsMd(text)`, `parseStock(note)`, `deriveJobState`. Bez I/O, s testy.
- `server/nightScanner.ts`: I/O — glob souborů, čtení SKILL.md frontmatteru, runs.md/state.json, každých 60 s, publikace jen při změně (JSON diff), `projectResolver` ze `Store`.
- Config: `night: { enabled: true, engines: [...] }` s výchozími cestami výše. Chybějící soubor = engine se tiše přeskočí a v panelu se u něj nic neukáže.

## Chyby a limity

- Vše čtení, nic se nespouští. Kancl neumí úlohu pustit ani vypnout (to zůstává v aplikaci Claude).
- Když runs.md nemá řádek pro dnešek a `lastRunAt` je > 20 min, robot ukáže `ok` jen podle `lastRunAt` (bez výsledku), s poznámkou „bez záznamu v runs.md".
- Cron parser podporuje jen to, co je uvedeno; neznámý výraz → `nextRunAt` prázdný, `scheduleHuman` = surový cron.

## Testy

- `night.test.ts`: parseCron/nextRun (denně 7:00, pondělí 6:00, `*/15`, seznam), scheduleHuman česky, parseRunsMd na 3 reálných řádcích (✅, ⚠️, ⏭ a řádek alarmu), parseStock, deriveJobState pro 5 kombinací.
- Typecheck, build, test v prohlížeči (3 šířky), reálná data: 8 úloh, daily-content s výsledkem `deky ✓ tvrda-vs-mekka-matrace`, alarm `zahradni-domky 3`.

## Mimo rozsah

cron-job.org (chybí klíč), spouštění úloh z Kanclu, historie běhů delší než poslední řádek, etapa 3 (cloudová sezení).
