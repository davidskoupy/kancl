/**
 * Čitelná složka sezení: zkrátí domovskou složku na ~, rozpozná worktree (`.claude/worktrees/…`),
 * scratch složky aplikace Claude a dočasné scratchpady.
 */
export interface FolderInfo {
  folder: string;   // krátký popis pro UI, např. "~/Code/PPC hub › cool-hopper-ffe927"
  repo?: string;    // název repozitáře/složky projektu (pro fallback název projektu)
  scratch: boolean; // dočasná složka bez projektu
}

export function folderInfo(cwd: string, home: string): FolderInfo {
  if (!cwd) return { folder: '—', scratch: true };
  const tilde = (p: string) => (home && (p === home || p.startsWith(home + '/')) ? '~' + p.slice(home.length) : p);

  // scratch složka desktopové aplikace
  const sw = cwd.match(/\/scratch-workspaces\/(?:[^/]+\/)*scratch-([^/]+)(\/.*)?$/);
  if (sw) return { folder: `scratch ${sw[1]}${sw[2] ?? ''}`, scratch: true };

  // dočasný scratchpad sezení (/private/tmp/claude-…/…/scratchpad/…)
  const sp = cwd.match(/^\/(?:private\/)?tmp\/claude-[^/]+\/.*\/scratchpad(\/.*)?$/);
  if (sp) return { folder: `dočasná složka${sp[1] ? ' ' + sp[1].replace(/^\//, '') : ''}`, scratch: true };

  // git worktree vytvořený Claude Code
  const wt = cwd.match(/^(.*)\/\.claude\/worktrees\/([^/]+)(\/.*)?$/);
  if (wt) {
    const repoPath = wt[1];
    const repo = repoPath.split('/').pop() || repoPath;
    return { folder: `${tilde(repoPath)} › ${wt[2]}${wt[3] ?? ''}`, repo, scratch: false };
  }

  const parts = cwd.split('/').filter(Boolean);
  return { folder: tilde(cwd), repo: parts[parts.length - 1], scratch: false };
}
