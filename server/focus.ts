import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { TerminalInfo } from '../shared/types.ts';

const run = promisify(execFile);

async function osa(script: string): Promise<string> {
  const { stdout } = await run('osascript', ['-e', script], { timeout: 4000 });
  return stdout.trim();
}

function esc(s: string) {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Bring the terminal that hosts a Claude session to the front (macOS).
 * Strategy, most specific first:
 *   tmux pane  -> switch tmux client to the pane, then activate the terminal app
 *   iTerm2     -> find the session by tty, select tab + window, activate
 *   Terminal   -> find the tab by tty, select it, bring window to front
 *   otherwise  -> activate the app by bundle id / TERM_PROGRAM
 * Returns a short description of what it did.
 */
export async function focusTerminal(t: TerminalInfo, desktopId?: string): Promise<string> {
  // Desktopová aplikace Claude: deep link na konkrétní sezení (ověřeno v bundlu: claude://code/continue?session=local_…)
  if (desktopId && /^local_[A-Za-z0-9-]{1,64}$/.test(desktopId)) {
    await run('open', [`claude://code/continue?session=${desktopId}`], { timeout: 3000 }).catch(() => {});
    await run('open', ['-b', 'com.anthropic.claudefordesktop'], { timeout: 3000 }).catch(() => {});
    return 'aplikace Claude: sezení otevřeno';
  }
  const program = t.program ?? '';
  const bundle = t.bundleId ?? '';
  const tty = t.tty ?? '';
  const notes: string[] = [];

  if (t.tmuxPane) {
    try {
      await run('tmux', ['switch-client', '-t', t.tmuxPane], { timeout: 2000 }).catch(() => {});
      await run('tmux', ['select-window', '-t', t.tmuxPane], { timeout: 2000 });
      await run('tmux', ['select-pane', '-t', t.tmuxPane], { timeout: 2000 });
      notes.push(`tmux pane ${t.tmuxPane}`);
    } catch (e) {
      notes.push('tmux select failed');
    }
  }

  const isITerm = /iTerm/i.test(program) || /iterm2/i.test(bundle);
  const isTerminal = /Apple_Terminal/i.test(program) || bundle === 'com.apple.Terminal';

  if (isITerm && tty) {
    const found = await osa(`
      tell application "iTerm2"
        repeat with w in windows
          repeat with t in tabs of w
            repeat with s in sessions of t
              if tty of s is "${esc(tty)}" then
                select s
                select t
                set index of w to 1
                activate
                return "ok"
              end if
            end repeat
          end repeat
        end repeat
        activate
        return "app"
      end tell`).catch(() => 'err');
    notes.push(found === 'ok' ? `iTerm2 tab ${tty}` : 'iTerm2 (tab not found)');
    return notes.join(', ');
  }

  if (isTerminal && tty) {
    const found = await osa(`
      tell application "Terminal"
        repeat with w in windows
          repeat with t in tabs of w
            if tty of t is "${esc(tty)}" then
              set selected tab of w to t
              set frontmost of w to true
              set index of w to 1
              activate
              return "ok"
            end if
          end repeat
        end repeat
        activate
        return "app"
      end tell`).catch(() => 'err');
    notes.push(found === 'ok' ? `Terminal tab ${tty}` : 'Terminal (tab not found)');
    return notes.join(', ');
  }

  if (/WezTerm/i.test(program) && t.weztermPane) {
    await run('wezterm', ['cli', 'activate-pane', '--pane-id', t.weztermPane], { timeout: 2000 }).catch(() => {});
  }

  if (bundle) {
    await run('open', ['-b', bundle], { timeout: 3000 }).catch(() => {});
    notes.push(`activated ${bundle}`);
    return notes.join(', ');
  }

  const appByProgram: Record<string, string> = {
    vscode: 'Visual Studio Code',
    'iTerm.app': 'iTerm2',
    Apple_Terminal: 'Terminal',
    WezTerm: 'WezTerm',
    ghostty: 'Ghostty',
    kitty: 'kitty',
    Hyper: 'Hyper',
    Alacritty: 'Alacritty',
    WarpTerminal: 'Warp',
  };
  const app = appByProgram[program];
  if (app) {
    await run('open', ['-a', app], { timeout: 3000 }).catch(() => {});
    notes.push(`activated ${app}`);
    return notes.join(', ');
  }

  notes.push('no terminal info for this session');
  return notes.join(', ');
}
