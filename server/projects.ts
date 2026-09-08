import { basename } from 'node:path';
import type { Host, Project, ProjectStatus, Session } from '../shared/types.ts';

export interface FolderInfo { path: string; remoteUrl?: string }

/** `git@host:a/b.git`, `https://host/a/b.git`, `ssh://git@host/a/b` → `host/a/b`. */
export function normalizeRemote(url: string, gitlabHosts: string[]): { id: string; host: Host; name: string } | null {
  let rest = url.trim();
  const scp = rest.match(/^[\w.-]+@([^:/]+):(.+)$/);
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
    const activeSince = mine.length ? Math.min(...mine.map(s => s.startedAt)) : undefined;
    return { ...p, status, lastActivity: Math.max(lastCommit, lastSeen), activeSince };
  });
}

const RANK: Record<ProjectStatus, number> = { dotaz: 0, prace: 1, klid: 2 };

/** dotaz → práce → klid; aktivní podle toho, kdo přišel do práce dřív; klidné podle poslední aktivity. */
export function sortProjects(projects: Project[]): Project[] {
  return [...projects].sort((a, b) =>
    RANK[a.status] - RANK[b.status]
    || (a.activeSince !== undefined && b.activeSince !== undefined ? a.activeSince - b.activeSince : b.lastActivity - a.lastActivity)
    || a.name.localeCompare(b.name, 'cs'));
}

// ---- skupiny --------------------------------------------------------------
export interface GroupConfig { name: string; match: string[] }

/** Jednoduchý glob: `*` = cokoliv, bez ohledu na velikost písmen. */
export function matchGlob(value: string, glob: string): boolean {
  const re = new RegExp('^' + glob.split('*').map(x => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$', 'i');
  return re.test(value);
}

export function assignGroups(projects: Project[], groups: GroupConfig[]): Project[] {
  return projects.map(p => {
    const g = groups.find(gr => gr.match.some(m => matchGlob(p.id, m) || matchGlob(p.name, m)));
    return { ...p, group: g?.name };
  });
}
