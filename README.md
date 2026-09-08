<p align="center">
  <img src="docs/hero.png" alt="Kancl — pixel-artová kancelář, kde každé Claude Code sezení je kolega" width="900">
</p>

<h1 align="center">Kancl</h1>

<p align="center">
  <b>Osobní velín nad Claude Code sezeními a projekty.</b><br>
  Každé běžící <code>claude</code> je kolega u stolu. Každý projekt z <code>~/Code</code> má svůj ostrůvek stolů.
  Když někdo něco potřebuje, přijde k tobě.
</p>

---

## Co to je

Když běží víc Claude Code sezení naráz, přepínáš mezi taby a hledáš, které z nich stojí na potvrzení příkazu.
Kancl to ukáže v jednom okně prohlížeče jako 32×32 pixel‑artovou kancelář:

- **Ty** sedíš v prosklené kanceláři vlevo.
- **Každý projekt** (složka v `~/Code`, sloučená podle git remotu) má ostrůvek stolů s cedulkou.
  Projekt, ve kterém běží sezení, svítí. Projekt s dotazem zežloutne. Klidné projekty jsou zhasnuté vzadu.
- **Každé sezení** sedí u stolu svého projektu. Monitor ukazuje, co dělá (editor, terminál, dokument, agenti, přemýšlení).
- **Subagenti** jsou malé postavičky vedle rodiče.
- Když sezení **potřebuje tebe**, postavička přijde do tvé kanceláře. Klik na ni a **Enter** vytáhne dopředu její terminál.

Levý panel je strom projektů: větev, počet změn, otevřené PR (GitHub) a MR (GitLab), pod tím sezení.
Klik na projekt otevře detail s worktree, commity a odkazy na PR/MR.

Žádný cloud, žádné účty, žádná telemetrie. Server poslouchá jen na `127.0.0.1`.

## Stavy sezení

| Stav | V kanceláři |
| --- | --- |
| **práce** | Píše u stolu. Monitor: editor (Edit/Write), terminál (Bash), dokument (Read/Grep/Web), graf agentů (Agent), spinner (přemýšlí) |
| **dotaz** | Přiběhne do tvé kanceláře a drží žlutou ceduli **?** |
| **čeká** | Přijde ke stolu a mává. Po dvou minutách odejde do kuchyňky na kafe |
| **hotovo** | Přinese zelenou složku s ✓ |
| **chyba** | Červený **!**, ruce nahoře, monitor zčervená, pak zpátky k práci |

Klávesy: `1`–`9` vybere sezení v pořadí panelu, `Enter` otevře jeho terminál, `Esc` zruší výběr.
Když jsi v jiném tabu, titulek a favicon nesou počítadlo; 🔔 zapne macOS notifikace, 🔈 pípnutí při dotazu a chybě.

## Rychlý start

Požadavky: **macOS** (přepínání terminálu jde přes AppleScript; kancelář sama běží kdekoli), **Node.js 20+**, **Claude Code 2.1+**.

```bash
git clone https://github.com/davidskoupy/kancl.git ~/Code/kancl
cd ~/Code/kancl
npm install
npm run hooks:install   # zapíše hooky do ~/.claude/settings.json (předtím udělá zálohu)
npm start               # sestaví klienta, spustí server, otevře http://127.0.0.1:4242
```

Pak spusť `claude` v libovolném terminálu. Už běžící sezení je potřeba restartovat, aby si načetla hooky.

Bez sezení stiskni v panelu **Pustit ukázkovou partu**, nebo otevři `http://127.0.0.1:4242/?demo=1`.

Cesta k hook skriptu je v `settings.json` absolutní. Když repo přesuneš, spusť `npm run hooks:install` znovu.

### Bez terminálu

| Soubor | Co dělá |
| --- | --- |
| `Kancl.command` | Spustí server na pozadí a otevře prohlížeč |
| `Kancl — Stop.command` | Zastaví server |
| `Kancl — Autostart.command` | Zapne/vypne start po přihlášení (macOS LaunchAgent) |

### Odinstalace

```bash
npm run hooks:uninstall
```

## Projekty, GitHub, GitLab

Kancl při startu projde `~/Code` (a další kořeny z configu), sloučí složky se stejným git remotem do jednoho projektu
(worktree) a každých 15 s čte lokální stav gitu: větev, počet změn, ahead/behind, poslední commit.
**Nikdy nedělá `git fetch`.**

- **GitHub PR** bere přes přihlášené `gh` (`gh auth login`).
- **GitLab MR** potřebují personal access token s právem `read_api`. Ulož ho do `.env` v kořeni repa Kanclu:

  ```
  GITLAB_TOKEN=glpat-...
  ```

  nebo do proměnné prostředí `GITLAB_TOKEN`. Bez tokenu se u GitLab projektů zobrazí jen lokální stav gitu a poznámka.

PR/MR se obnovují každých 5 minut a 10 s po skončení tahu sezení v daném projektu.

## Config

`~/.config/kancl/config.json` vznikne při prvním startu:

```json
{
  "roots": ["~/Code"],
  "hidden": [],
  "gitIntervalSec": 15,
  "remoteIntervalMin": 5,
  "gitlabHosts": ["gitlab.shean.dev"]
}
```

- `roots` — složky, ve kterých se hledají projekty (jen první úroveň).
- `hidden` — id projektů (`github.com/user/repo`) nebo názvy složek, které se nemají ukazovat.
- `gitlabHosts` — hostitelé, které se mají brát jako GitLab (kromě těch, co mají „gitlab" v názvu).

Změna configu vyžaduje restart serveru.

## Jak to funguje

```
claude ──hook──▶ hook/kancl-hook.sh ──POST /hook──▶ server (Node, :4242) ──SSE──▶ prohlížeč (PixiJS)
                                                        │      ▲
                                                        │      └── skener: readdir ~/Code, git, gh, GitLab REST
                                                        └── POST /api/sessions/:id/focus ──▶ osascript (iTerm2 / Terminal.app / tmux)
```

- **`hook/kancl-hook.sh`** je registrovaný na `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`,
  `PostToolUseFailure`, `PermissionRequest`, `Notification`, `Stop`, `SubagentStart/Stop`, `PreCompact` a `SessionEnd`.
  Pošle JSON hooku plus identitu terminálu s timeoutem 2 s a **vždy skončí s 0**, takže Claude nikdy nezablokuje.
- **`server/state.ts`** převádí hooky na stavový automat sezení, **`server/scanner.ts`** skenuje projekty,
  **`server/projects.ts`** je čistá logika (normalizace remotů, slučování, stav, řazení).
- **`shared/plan.ts`** rozděluje 12 stolů mezi projekty: aktivní dostanou počet sezení + 1 (nejvýš 4), klidné po jednom.
- **`client/`** vykresluje kancelář v PixiJS. Všechny sprity se generují v kódu, žádné obrázky.

## Skripty

| Příkaz | Co dělá |
| --- | --- |
| `npm start` | Sestaví klienta a spustí server (otevře prohlížeč) |
| `npm run dev` | Server s reloadem + Vite dev server na `http://localhost:5173` |
| `npm test` | Unit testy (`node --test`) |
| `npm run typecheck` | Typová kontrola klienta i serveru |
| `npm run hooks:install` / `hooks:uninstall` | Zapsat / odebrat hooky v `~/.claude/settings.json` |

Prostředí: `KANCL_PORT` (výchozí `4242`) respektuje server i hook; `KANCL_DEBUG=1` loguje každou událost;
`KANCL_CONFIG` přesměruje config.

## Rozvržení repa

```
hook/      kancl-hook.sh, install.mjs
server/    index.ts (HTTP + SSE), state.ts (sezení), scanner.ts (projekty, I/O), projects.ts (čistá logika), config.ts, focus.ts
shared/    types.ts, plan.ts (ostrůvky), names.ts (přezdívky)
client/    Vite + PixiJS
  src/game/  pixel.ts, sprites.ts, office.ts, world.ts, agent.ts, scene.ts
  src/ui/    panel.ts (strom projektů), attention.ts (titulek, favicon, notifikace)
tests/     node --test
docs/      superpowers/specs, superpowers/plans
```

## Původ a licence

Kancl je fork projektu [Comakers Crew](https://github.com/rontoday/comakers-crew) od rontoday (MIT).
Přidává vrstvu projektů z gitu, GitHub/GitLab, subagenty, české UI a nový název. Licence zůstává [MIT](LICENSE).
