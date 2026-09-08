import type { Session, ServerMessage } from '../../shared/types.ts';

export type ConnState = 'connecting' | 'ok' | 'error' | 'demo';

export interface ClientEvents {
  onUpsert: (s: Session) => void;
  onRemove: (id: string, reason?: string) => void;
  onState: (state: ConnState) => void;
}

export class CrewClient {
  sessions = new Map<string, Session>();
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
        break;
      }
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
    if (this.state === 'demo') return 'demo mode: would focus the terminal';
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

  startDemo() {
    this.es?.close();
    this.setState('demo');
    const now = Date.now();
    const mk = (i: number, project: string, status: Session['status'], activity: Session['activity'], extra: Partial<Session> = {}): Session => ({
      id: `demo-${i}`, name: ['Ada', 'Bit', 'Cody', 'Nova', 'Pip', 'Rex', 'Wren', 'Zed'][i], colorIndex: i,
      cwd: `/Users/you/${project}`, project, status, statusSince: now, activity,
      terminal: { program: 'Apple_Terminal' }, startedAt: now - i * 60_000, lastSeen: now,
      turns: 1 + i, toolCalls: i * 7, subagents: [],
      events: [{ at: now, event: 'SessionStart', detail: 'startup' }], ...extra,
    });
    const seeds: Session[] = [
      mk(0, 'webshop', 'working', 'build', { lastTool: 'Edit', lastDetail: 'Edit src/checkout.ts', prompt: 'Fix the checkout total rounding bug' }),
      mk(1, 'api-gateway', 'working', 'run', { lastTool: 'Bash', lastDetail: 'Bash: npm test', prompt: 'Run the test suite and fix failures' }),
      mk(2, 'landing', 'permission', 'think', { message: 'Allow Bash: rm -rf dist && npm run build?', lastDetail: 'Bash: rm -rf dist && npm run build' }),
      mk(3, 'mobile-app', 'completed', 'think', { message: 'Done. Migrated 12 screens to the new design system, all snapshots updated.' }),
      mk(4, 'data-pipeline', 'working', 'chop', { lastTool: 'Grep', lastDetail: 'Grep /TODO/', prompt: 'Find all TODOs and summarise them' }),
      mk(5, 'infra', 'waiting', 'think', { message: 'Which region should the new cluster go to?' }),
    ];
    for (const s of seeds) this.handle({ type: 'upsert', session: s });

    const acts: Session['activity'][] = ['build', 'chop', 'run', 'lift', 'think'];
    const tools: Record<string, [string, string]> = {
      build: ['Edit', 'Edit src/components/Button.tsx'], chop: ['Read', 'Read README.md'], run: ['Bash', 'Bash: npm run lint'],
      lift: ['Agent', 'Agent: explore codebase'], think: ['', 'Thinking…'],
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
        else if (roll < 0.7) set('completed', { message: 'Finished: ' + (s.prompt ?? 'task') });
        else if (roll < 0.82) set('permission', { message: 'Allow Bash: git push origin main?' });
        else if (roll < 0.9) set('error', { message: 'Bash failed: exit code 1' });
      } else if (s.status === 'error') { if (roll < 0.7) set('working'); }
      else if (roll < 0.35) { set('working', { activity: 'think', prompt: 'Next task please', message: undefined }); s.turns++; }
      s.lastSeen = Date.now();
      s.events = [...s.events.slice(-20), { at: Date.now(), event: s.status === 'working' ? 'PreToolUse' : 'Notification', detail: s.lastDetail ?? s.message }];
      this.handle({ type: 'upsert', session: s });
      if (step % 25 === 0 && list.length < 8) {
        const i = list.length;
        this.handle({ type: 'upsert', session: mk(i, ['docs', 'billing'][i % 2], 'idle', 'think') });
      }
      if (step % 40 === 0 && list.length > 4) this.handle({ type: 'remove', id: list[list.length - 1].id, reason: 'ended' });
    }, 2500);
  }

  stopDemo() {
    if (this.demoTimer) window.clearInterval(this.demoTimer);
    for (const id of [...this.sessions.keys()]) this.handle({ type: 'remove', id });
    this.connect();
  }
}
