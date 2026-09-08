# Kancl · etapa 3 — Cloud přes most (design)

Datum: 2026-09-08. Navazuje na etapu 2 (noční směna).

## Cíl

Ukázat v Kanclu cloudové routiny (claude.ai/code/routines) a cloudová sezení, aniž by Kancl držel přihlašovací token.

## Rozhodnutí ze spiku

- Cloudová data nejsou na disku; jdou jen přes claude.ai API s OAuth tokenem z Keychainu („Claude Code-credentials").
- **Varianta B (schváleno):** most přes Claude. Naplánovaná lokální úloha `kancl-cloud-snapshot` (každou hodinu) vypíše routiny a sezení nástroji, které má sezení Claude k dispozici (`RemoteTrigger list`, `ListAgents`), a zapíše ořezaný snímek do `~/.kancl/cloud.json`. Kancl soubor jen čte.
- Do snímku se **neukládají prompty routin ani obsah sezení**, jen názvy, rozvrhy, stavy a odkazy.
- Snímek starší než 2 h se v panelu označí („snímek z 14:00", oranžově), protože úloha běží jen s otevřenou aplikací Claude.

## Snímek `~/.kancl/cloud.json`

```json
{
  "version": 1,
  "takenAt": 1788900000000,
  "routines": [
    {
      "id": "trig_01…", "name": "Páteční revize vláken",
      "cron": "0 14 * * 5", "runOnceAt": null, "enabled": true,
      "nextRunAt": "2026-09-11T14:01:00Z",
      "lastRun": { "firedAt": "2026-09-04T14:17:11Z", "finishedAt": "2026-09-04T14:19:04Z", "status": "ok", "sessionId": "cse_…" },
      "model": "claude-opus-4-8", "endedReason": null,
      "url": "https://claude.ai/code/routines/trig_01…"
    }
  ],
  "sessions": [
    { "id": "55738d", "name": "Kolečko varianty barvy", "kind": "cloud", "status": "idle" },
    { "id": "859814", "name": "Dispatch background conversation", "kind": "remote-control", "status": "idle" }
  ]
}
```

- `lastRun.status`: `ok` (SUCCEEDED), `fail` (FAILED / CANCELLED / TIMED_OUT), `running` (RUNNING / QUEUED), jinak `unknown`.
- Cron routin je **v UTC**; Kancl při popisu rozvrhu posune hodiny do lokálního času. Pro „další běh" bere `nextRunAt` z API, ne vlastní výpočet.

## Naplánovaná úloha `kancl-cloud-snapshot`

- Rozvrh: každou hodinu v :20 (`20 * * * *`), cwd `~/Code/kancl`.
- Postup (v SKILL.md): 1) `RemoteTrigger` `list`, 2) `ListAgents`, 3) sestavit JSON podle schématu výše, 4) zapsat `~/.kancl/cloud.json` (přepsat), 5) nic jiného nedělat, nic nespouštět, žádné prompty do souboru. Když výpis selže, zapsat snímek s prázdným polem a `error: "…"`, aby Kancl ukázal důvod.
- Úloha se sama objeví v noční směně jako robot (zdroj lokální úloha), takže je vidět, jestli most funguje.

## Datový model (`shared/types.ts`)

- `JobSource` rozšířit o `'routine'`.
- `Job` doplnit `url?: string`, `model?: string`.
- `CloudSession { id; name; kind: 'cloud' | 'remote-control'; status: 'idle' | 'working' | 'offline'; url?: string }`.
- `NightShift` doplnit `cloudSessions: CloudSession[]`, `snapshotAt?: number`, `snapshotError?: string`.

## Server

- `server/cloud.ts` (čistá logika): `parseCloudSnapshot(json, now)` → `{ jobs: Job[]; sessions: CloudSession[]; takenAt; error? }`. Stav routiny: `vypnuto` když `!enabled` nebo `endedReason`; `bezi` když `lastRun.status === 'running'`; `ok`/`chyba` když `finishedAt` < 3 h; jinak `spi`. `scheduleHumanUtc(cron)`: posune hodiny o lokální offset a použije `scheduleHuman`.
- `nightScanner.ts`: čte `~/.kancl/cloud.json` v každém cyklu (60 s), sloučí routiny do `night.jobs` (za lokální úlohy), sezení do `night.cloudSessions`, vyplní `snapshotAt`/`snapshotError`. Chybějící soubor = prázdné, bez chyby.
- Cesta snímku v configu: `night.cloudSnapshot` (výchozí `~/.kancl/cloud.json`).

## Kancelář

- Serverovna se zvýší na 3 řádky dlaždic (ROWS 22, H 352) a roboti stojí ve dvou řadách střídavě (kapacita 16). Routiny mají světle modré tělo a bílou anténu, lokální úlohy zůstávají jako dnes.
- Řazení robotů: nejdřív `bezi`/`chyba`, pak podle `nextRunAt`. Vypnuté se nekreslí.

## Panel

- V sekci Noční směna: řádek routiny má štítek `cloud` a v detailu odkaz „Otevřít na claude.ai" (`url`), model, čas posledního běhu i délku.
- Hlavička sekce: `Noční směna · 12 úloh · snímek 14:20`; starší než 2 h oranžově `snímek z 11:20 (aplikace Claude asi neběží)`; `snapshotError` červeně.
- Nová sekce **V cloudu** pod noční směnou: cloudová sezení (jen `kind: cloud` a Remote Control se stavem jiným než `offline`), řádek = název + stav, bez detailu a bez postaviček.

## Testy

- `cloud.test.ts`: parse snímku (routina ok, fail, running, run_once_fired → vypnuto), UTC posun rozvrhu (`0 14 * * 5` → `pátek 16:00` v Europe/Prague v září; test s pevným offsetem), filtr sezení (offline Remote Control pryč), chybějící/rozbitý soubor → prázdné + error.
- Typecheck, build, prohlížeč (3 šířky), reálný snímek: 8 routin, 7 cloudových sezení.

## Mimo rozsah

Spouštění a úprava routin z Kanclu, čtení logů běhů, cron-job.org (chybí klíč).
