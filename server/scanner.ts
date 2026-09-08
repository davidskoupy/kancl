import { readdir, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import type { Config } from './config.ts';
import { expandHome, gitlabToken } from './config.ts';
import { groupFolders, fillStatus, sortProjects, projectIdForCwd, type FolderInfo } from './projects.ts';
import type { Store } from './state.ts';
import type { MergeRequest, Project, Worktree } from '../shared/types.ts';

const run = promisify(execFile);
const GIT_TIMEOUT = 3000;

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await run('git', args, { cwd, timeout: GIT_TIMEOUT, maxBuffer: 1 << 20 });
  return stdout.trim();
}

/** Jednoduchá fronta: nejvýš `n` úloh naráz. */
async function mapLimit<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
  }));
  return out;
}

async function readWorktree(w: Worktree): Promise<Worktree> {
  try {
    const [branch, status, log] = await Promise.all([
      git(w.path, ['rev-parse', '--abbrev-ref', 'HEAD']),
      git(w.path, ['status', '--porcelain']),
      git(w.path, ['log', '-1', '--format=%H%x1f%s%x1f%ct']).catch(() => ''),
    ]);
    let ahead = 0, behind = 0;
    try {
      const lr = await git(w.path, ['rev-list', '--left-right', '--count', '@{upstream}...HEAD']);
      const [b, a] = lr.split(/\s+/).map(Number);
      behind = b || 0; ahead = a || 0;
    } catch { /* bez upstreamu */ }
    const [hash, message, ct] = log.split('\x1f');
    return {
      ...w, branch: branch === 'HEAD' ? '(detached)' : branch,
      dirty: status ? status.split('\n').length : 0, ahead, behind,
      lastCommit: hash ? { hash: hash.slice(0, 7), message, at: Number(ct) } : undefined,
      error: undefined,
    };
  } catch (e: any) {
    return { ...w, error: e?.killed ? 'git neodpovídá' : 'git selhal' };
  }
}

async function githubPrs(id: string): Promise<MergeRequest[]> {
  const repo = id.replace(/^github\.com\//, '');
  const { stdout } = await run('gh', ['pr', 'list', '--repo', repo, '--state', 'open', '--limit', '50',
    '--json', 'number,title,url,headRefName,isDraft,reviewDecision,updatedAt'], { timeout: 15000 });
  return (JSON.parse(stdout) as any[]).map(p => ({
    number: p.number, title: p.title, url: p.url, branch: p.headRefName,
    state: p.isDraft ? 'draft' : p.reviewDecision === 'APPROVED' ? 'approved' : p.reviewDecision === 'CHANGES_REQUESTED' ? 'changes_requested' : 'open',
    updatedAt: Date.parse(p.updatedAt),
  }));
}

async function gitlabMrs(id: string, token: string): Promise<MergeRequest[]> {
  const [host, ...path] = id.split('/');
  const url = `https://${host}/api/v4/projects/${encodeURIComponent(path.join('/'))}/merge_requests?state=opened&per_page=50`;
  const res = await fetch(url, { headers: { 'PRIVATE-TOKEN': token }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`GitLab ${res.status}`);
  return ((await res.json()) as any[]).map(m => ({
    number: m.iid, title: m.title, url: m.web_url, branch: m.source_branch,
    state: m.draft ? 'draft' : 'open', updatedAt: Date.parse(m.updated_at),
  }));
}

/**
 * Skener projektů: readdir kořenů → sloučení podle remotu → lokální git → PR/MR.
 * Nikdy nedělá `git fetch`. Změny hlásí přes `onChange`, jen když se něco změnilo.
 */
export class Scanner {
  projects: Project[] = [];
  private raw: Project[] = [];          // po groupFolders + git, bez stavu
  private lastJson = '';
  private timers: NodeJS.Timeout[] = [];
  private remoteTimers = new Map<string, NodeJS.Timeout>();

  constructor(private cfg: Config, private store: Store, private onChange: (p: Project[]) => void) {
    store.projectResolver = cwd => projectIdForCwd(cwd, this.raw);
  }

  async start() {
    await this.scanFolders();
    await this.refreshGit();
    this.refreshRemotes().catch(() => {});
    this.timers.push(
      setInterval(() => this.scanFolders().then(() => this.refreshGit()).catch(console.error), 5 * 60_000),
      setInterval(() => this.refreshGit().catch(console.error), this.cfg.gitIntervalSec * 1000),
      setInterval(() => this.refreshRemotes().catch(console.error), this.cfg.remoteIntervalMin * 60_000),
    );
    for (const t of this.timers) t.unref();
  }

  /** Sezení se změnilo → přepočítat stav projektů (levné, jen v paměti). */
  publish() {
    const filled = sortProjects(fillStatus(this.raw, this.store.list()));
    const json = JSON.stringify(filled);
    if (json === this.lastJson) return;
    this.lastJson = json;
    this.projects = filled;
    this.onChange(filled);
  }

  async scanFolders() {
    const folders: FolderInfo[] = [];
    for (const root of this.cfg.roots.map(expandHome)) {
      let names: string[] = [];
      try { names = await readdir(root); } catch { continue; }
      for (const name of names) {
        if (name.startsWith('.')) continue;
        const path = join(root, name);
        try { if (!(await stat(path)).isDirectory()) continue; } catch { continue; }
        try {
          const top = await git(path, ['rev-parse', '--show-toplevel']);
          if (top !== path) continue;               // podsložka cizího repa
          const remoteUrl = await git(path, ['remote', 'get-url', 'origin']).catch(() => '');
          folders.push({ path, remoteUrl: remoteUrl || `file://${path}` });
        } catch {
          folders.push({ path });                    // bez gitu
        }
      }
    }
    const fresh = groupFolders(folders, this.cfg.hidden, this.cfg.gitlabHosts);
    // zachovat už načtená data (git, MR) u projektů, které zůstaly
    const old = new Map(this.raw.map(p => [p.id, p]));
    this.raw = fresh.map(p => {
      const prev = old.get(p.id);
      if (!prev) return p;
      const wt = new Map(prev.worktrees.map(w => [w.path, w]));
      return { ...p, mrs: prev.mrs, mrsError: prev.mrsError, worktrees: p.worktrees.map(w => wt.get(w.path) ?? w) };
    });
    this.store.reassignProjects();
    this.publish();
  }

  async refreshGit() {
    const all = this.raw.filter(p => !!p.remoteUrl).flatMap(p => p.worktrees);
    const updated = await mapLimit(all, 4, readWorktree);
    const byPath = new Map(updated.map(w => [w.path, w]));
    this.raw = this.raw.map(p => ({ ...p, worktrees: p.worktrees.map(w => byPath.get(w.path) ?? w), scannedAt: Date.now() }));
    this.publish();
  }

  /** PR/MR pro všechny projekty, nebo jen pro jeden (po Stop sezení, s 10s odstupem). */
  async refreshRemotes(projectId?: string) {
    if (projectId) {
      clearTimeout(this.remoteTimers.get(projectId));
      this.remoteTimers.set(projectId, setTimeout(() => this.fetchRemote(projectId).then(() => this.publish()).catch(() => {}), 10_000));
      return;
    }
    await mapLimit(this.raw.filter(p => p.host !== 'none'), 3, p => this.fetchRemote(p.id));
    this.publish();
  }

  private async fetchRemote(id: string) {
    const p = this.raw.find(x => x.id === id);
    if (!p || p.host === 'none') return;
    let mrs = p.mrs, mrsError: string | undefined;
    try {
      if (p.host === 'github') mrs = await githubPrs(id);
      else {
        const token = gitlabToken();
        if (!token) throw new Error('chybí GITLAB_TOKEN');
        mrs = await gitlabMrs(id, token);
      }
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      mrsError = /ENOENT/.test(msg) ? 'gh není nainstalované' : /auth|login|401/i.test(msg) ? 'gh není přihlášené / token neplatí' : msg.split('\n')[0].slice(0, 120);
    }
    this.raw = this.raw.map(x => (x.id === id ? { ...x, mrs, mrsError } : x));
  }
}
