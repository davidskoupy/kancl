import type { Session, ServerMessage, Project } from '../../shared/types.ts';

export type ConnState = 'connecting' | 'ok' | 'error' | 'demo';

export interface ClientEvents {
  onUpsert: (s: Session) => void;
  onRemove: (id: string, reason?: string) => void;
  onState: (state: ConnState) => void;
  onProjects: (projects: Project[]) => void;
}

export class KanclClient {
  sessions = new Map<string, Session>();
  projects: Project[] = [];
  state: ConnState = 'connecting';
  private es?: EventSource;

  constructor(private events: ClientEvents) {}

  connect() {
    this.es?.close();
    const es = new EventSource('/api/events');
    this.es = es;
    es.onopen = () => this.setState('ok');
    es.onerror = () => this.setState('error');
    es.onmessage = ev => {
      let msg: ServerMessage;
      try { msg = JSON.parse(ev.data); } catch { return; }
      this.handle(msg);
    };
  }

  private setState(s: ConnState) {
    if (this.state !== s) { this.state = s; this.events.onState(s); }
  }

  handle(msg: ServerMessage) {
    switch (msg.type) {
      case 'snapshot': {
        const seen = new Set<string>();
        for (const s of msg.sessions) { seen.add(s.id); this.sessions.set(s.id, s); this.events.onUpsert(s); }
        for (const id of [...this.sessions.keys()]) if (!seen.has(id)) { this.sessions.delete(id); this.events.onRemove(id); }
        this.projects = msg.projects ?? [];
        this.events.onProjects(this.projects);
        break;
      }
      case 'projects':
        this.projects = msg.projects;
        this.events.onProjects(this.projects);
        break;
      case 'upsert':
        this.sessions.set(msg.session.id, msg.session);
        this.events.onUpsert(msg.session);
        break;
      case 'remove':
        this.sessions.delete(msg.id);
        this.events.onRemove(msg.id, msg.reason);
        break;
    }
  }

  async focus(id: string): Promise<string> {
    if (this.state === 'demo') return 'demo: tady bych otevřel terminál';
    const r = await fetch(`/api/sessions/${encodeURIComponent(id)}/focus`, { method: 'POST' });
    const j = await r.json().catch(() => ({}));
    return j.result ?? j.error ?? 'done';
  }

  async dismiss(id: string) {
    if (this.state === 'demo') { this.handle({ type: 'remove', id, reason: 'dismissed' }); return; }
    await fetch(`/api/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  // ---- demo -------------------------------------------------------------
  private demoTimer?: number;
  private demoProjects: Project[] = [];

  private publishDemoProjects() {
    const list = [...this.sessions.values()];
    const rank = { dotaz: 0, prace: 1, klid: 2 } as const;
    this.projects = this.demoProjects.map(p => {
      const mine = list.filter(s => s.projectId === p.id);
      const status: Project['status'] = mine.some(s => s.status === 'permission') ? 'dotaz' : mine.length ? 'prace' : 'klid';
      const activeSince = mine.length ? Math.min(...mine.map(s => s.startedAt)) : undefined;
      return { ...p, status, lastActivity: Math.max(p.lastActivity, ...mine.map(s => s.lastSeen)), activeSince };
    }).sort((a, b) => rank[a.status] - rank[b.status]
      || (a.activeSince !== undefined && b.activeSince !== undefined ? a.activeSince - b.activeSince : b.lastActivity - a.lastActivity));
    this.events.onProjects(this.projects);
  }

  startDemo() {
    this.es?.close();
    this.setState('demo');
    const now = Date.now();
    const names = ['Pepa', 'Tonda', 'Máňa', 'Vašek', 'Božka', 'Lojza', 'Franta', 'Jarda'];
    const proj = (id: string, name: string, host: Project['host'], extra: Partial<Project> = {}): Project => ({
      id, name, host, remoteUrl: `https://${id}`, mrs: [], status: 'klid', lastActivity: now - 86_400_000, scannedAt: now,
      worktrees: [{ path: `/Users/ty/Code/${name}`, label: name, branch: 'main', dirty: 0, ahead: 0, behind: 0, lastCommit: { hash: 'abc1234', message: 'drobné úpravy', at: Math.floor(now / 1000) - 3600 } }],
      ...extra,
    });
    this.demoProjects = [
      proj('github.com/ty/eshop', 'eshop', 'github', {
        worktrees: [{ path: '/Users/ty/Code/eshop', label: 'eshop', branch: 'feat/kosik', dirty: 4, ahead: 2, behind: 0, lastCommit: { hash: 'e1f2a3b', message: 'košík: zaokrouhlení', at: Math.floor(now / 1000) - 600 } }],
        mrs: [{ number: 31, title: 'Zaokrouhlení v košíku', url: '#', branch: 'feat/kosik', state: 'open', updatedAt: now }],
      }),
      proj('gitlab.shean.dev/others/brana', 'api-brana', 'gitlab', {
        worktrees: [
          { path: '/Users/ty/Code/brana', label: 'brana', branch: '1165', dirty: 0, ahead: 0, behind: 3, lastCommit: { hash: '9c0d1e2', message: 'obdobi: filtr', at: Math.floor(now / 1000) - 7200 } },
          { path: '/Users/ty/Code/brana-bugs', label: 'brana-bugs', branch: 'bugs', dirty: 1, ahead: 0, behind: 0 },
        ],
        mrs: [{ number: 212, title: 'PnL za období', url: '#', branch: '1165', state: 'approved', updatedAt: now }],
      }),
      proj('github.com/ty/landing', 'landing', 'github'),
      proj('github.com/ty/mobil', 'mobil', 'github'),
      proj('github.com/ty/data', 'data-pipeline', 'github'),
      proj('github.com/ty/infra', 'infra', 'github', { mrsError: 'chybí GITLAB_TOKEN' }),
      proj('/Users/ty/Code/skroluj', 'skroluj', 'none', { remoteUrl: undefined }),
      proj('github.com/ty/docs', 'docs', 'github'),
      proj('github.com/ty/fakturace', 'fakturace', 'github'),
      proj('github.com/ty/web', 'web', 'github'),
      proj('github.com/ty/blog', 'blog', 'github'),
    ];
    const dp = this.demoProjects;
    const mk = (i: number, status: Session['status'], activity: Session['activity'], extra: Partial<Session> = {}): Session => ({
      id: `demo-${i}`, name: names[i % names.length], colorIndex: i,
      cwd: dp[i].worktrees[0].path, project: dp[i].name, projectId: dp[i].id, status, statusSince: now, activity,
      terminal: { program: 'Apple_Terminal' }, startedAt: now - i * 60_000, lastSeen: now,
      turns: 1 + i, toolCalls: i * 7, subagents: [],
      events: [{ at: now, event: 'SessionStart', detail: 'startup' }], ...extra,
    });
    const seeds: Session[] = [
      mk(0, 'working', 'build', { lastTool: 'Edit', lastDetail: 'Edit src/kosik.ts', prompt: 'Oprav zaokrouhlení v košíku', subagents: [{ id: 'd-sub', description: 'Explore: hledá usage', startedAt: now }] }),
      mk(1, 'working', 'run', { lastTool: 'Bash', lastDetail: 'Bash: pnpm typecheck', prompt: 'Spusť testy a oprav, co padá' }),
      mk(2, 'permission', 'think', { message: 'Povolit Bash: rm -rf dist && npm run build?', lastDetail: 'Bash: rm -rf dist && npm run build' }),
      mk(3, 'completed', 'think', { message: 'Hotovo. Převedl jsem 12 obrazovek na nový design systém, snapshoty aktualizované.' }),
      mk(4, 'working', 'chop', { lastTool: 'Grep', lastDetail: 'Grep /TODO/', prompt: 'Najdi všechna TODO a shrň je' }),
      mk(5, 'waiting', 'think', { message: 'Do kterého regionu má jít nový cluster?' }),
    ];
    // druhé sezení na eshopu, ať je vidět ostrůvek se dvěma stoly
    seeds.push({ ...mk(6, 'working', 'chop', { lastTool: 'Read', lastDetail: 'Read README.md', prompt: 'Projdi dokumentaci košíku' }), cwd: dp[0].worktrees[0].path, project: dp[0].name, projectId: dp[0].id });
    for (const s of seeds) this.handle({ type: 'upsert', session: s });
    this.publishDemoProjects();

    const acts: Session['activity'][] = ['build', 'chop', 'run', 'lift', 'think'];
    const tools: Record<string, [string, string]> = {
      build: ['Edit', 'Edit src/components/Button.tsx'], chop: ['Read', 'Read README.md'], run: ['Bash', 'Bash: npm run lint'],
      lift: ['Agent', 'Agent: prozkoumat kód'], think: ['', 'Přemýšlí…'],
    };
    let step = 0;
    this.demoTimer = window.setInterval(() => {
      step++;
      const list = [...this.sessions.values()];
      if (!list.length) return;
      const s = { ...list[step % list.length] };
      const roll = Math.random();
      const set = (status: Session['status'], patch: Partial<Session> = {}) => { s.status = status; s.statusSince = Date.now(); Object.assign(s, patch); };
      if (s.status === 'working') {
        if (roll < 0.55) { const a = acts[(Math.random() * acts.length) | 0]; s.activity = a; const [t, d] = tools[a]; s.lastTool = t || undefined; s.lastDetail = d; s.toolCalls++; }
        else if (roll < 0.7) set('completed', { message: 'Hotovo: ' + (s.prompt ?? 'úkol') });
        else if (roll < 0.82) set('permission', { message: 'Povolit Bash: git push origin main?' });
        else if (roll < 0.9) set('error', { message: 'Bash selhal: exit code 1' });
      } else if (s.status === 'error') { if (roll < 0.7) set('working'); }
      else if (roll < 0.35) { set('working', { activity: 'think', prompt: 'Další úkol prosím', message: undefined }); s.turns++; }
      s.lastSeen = Date.now();
      s.events = [...s.events.slice(-20), { at: Date.now(), event: s.status === 'working' ? 'PreToolUse' : 'Notification', detail: s.lastDetail ?? s.message }];
      this.handle({ type: 'upsert', session: s });
      if (step % 25 === 0 && list.length < 8) {
        const i = list.length;
        this.handle({ type: 'upsert', session: mk(i % dp.length, 'idle', 'think') });
      }
      if (step % 40 === 0 && list.length > 4) this.handle({ type: 'remove', id: list[list.length - 1].id, reason: 'skončilo' });
      this.publishDemoProjects();
    }, 2500);
  }

  stopDemo() {
    if (this.demoTimer) window.clearInterval(this.demoTimer);
    for (const id of [...this.sessions.keys()]) this.handle({ type: 'remove', id });
    this.connect();
  }
}
