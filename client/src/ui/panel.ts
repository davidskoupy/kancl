import type { Session, SessionStatus, Project } from '../../../shared/types.ts';

export interface PanelEvents {
  onSelect: (id: string | null) => void;
  onFocus: (id: string) => void;
  onDismiss: (id: string) => void;
  onHover: (id: string | null) => void;
  onDemo: () => void;
}

const ORDER: Record<SessionStatus, number> = { permission: 0, error: 1, waiting: 2, completed: 3, working: 4, idle: 5 };
const LABEL: Record<SessionStatus, string> = {
  permission: 'needs you', error: 'error', waiting: 'waiting', completed: 'done', working: 'working', idle: 'idle',
};

function ago(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function clock(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
}

export class Panel {
  private list = document.getElementById('session-list')!;
  private empty = document.getElementById('empty')!;
  private details = document.getElementById('details')!;
  private summary = document.getElementById('summary')!;
  private filters = document.getElementById('filters')!;
  private conn = document.getElementById('conn')!;
  private toast = document.getElementById('toast')!;
  private sessions = new Map<string, Session>();
  private selected: string | null = null;
  private filter: 'all' | 'attention' = 'all';
  private toastTimer?: number;

  constructor(private events: PanelEvents) {
    document.getElementById('demo-btn')!.addEventListener('click', () => this.events.onDemo());
    this.filters.innerHTML = `
      <button class="chip on" data-f="all">All</button>
      <button class="chip" data-f="attention">Needs you</button>
      <span class="spacer"></span>
      <button class="chip pref" id="notify-btn" title="System notifications when someone needs you">🔔</button>
      <button class="chip pref" id="sound-btn" title="Sound on permission / error">🔈</button>`;
    this.filters.querySelectorAll<HTMLButtonElement>('.chip[data-f]').forEach(b => b.addEventListener('click', () => {
      this.filter = b.dataset.f as any;
      this.filters.querySelectorAll('.chip[data-f]').forEach(c => c.classList.toggle('on', c === b));
      this.render();
    }));
    window.setInterval(() => this.renderTimes(), 1000);
  }

  /** Wire the notification / sound toggles. */
  bindPrefs(get: () => { notify: boolean; sound: boolean }, set: { notify: (on: boolean) => Promise<boolean>; sound: (on: boolean) => void }) {
    const nb = document.getElementById('notify-btn')!, sb = document.getElementById('sound-btn')!;
    const paint = () => { const p = get(); nb.classList.toggle('on', p.notify); sb.classList.toggle('on', p.sound); sb.textContent = p.sound ? '🔊' : '🔈'; };
    nb.addEventListener('click', async () => {
      const ok = await set.notify(!get().notify);
      if (!ok && !get().notify) this.showToast('Notifications are blocked in the browser settings');
      paint();
    });
    sb.addEventListener('click', () => { set.sound(!get().sound); paint(); });
    paint();
  }

  setConnection(state: string) {
    this.conn.className = `conn ${state === 'ok' || state === 'demo' ? 'ok' : state === 'error' ? 'err' : ''}`;
    this.conn.querySelector('.conn-text')!.textContent =
      state === 'ok' ? 'live' : state === 'demo' ? 'demo' : state === 'error' ? 'server offline' : 'connecting';
  }

  setProjects(_projects: Project[]) { /* Task 9 */ }

  upsert(s: Session) { this.sessions.set(s.id, s); this.render(); }
  remove(id: string) { this.sessions.delete(id); if (this.selected === id) this.selected = null; this.render(); }

  select(id: string | null) {
    this.selected = id;
    this.render();
    if (id) this.list.querySelector(`[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest' });
  }

  showToast(text: string) {
    this.toast.textContent = text;
    this.toast.hidden = false;
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => (this.toast.hidden = true), 2500);
  }

  sorted(): Session[] {
    return [...this.sessions.values()].sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.startedAt - b.startedAt);
  }

  private render() {
    const all = this.sorted();
    const shown = this.filter === 'attention' ? all.filter(s => ['permission', 'waiting', 'error', 'completed'].includes(s.status)) : all;
    this.empty.hidden = all.length > 0;
    this.list.innerHTML = shown.map((s, i) => `
      <li class="session ${s.status} ${s.id === this.selected ? 'selected' : ''}" data-id="${esc(s.id)}" title="${esc(s.cwd)}">
        <div class="bar"></div>
        <div>
          <div class="name"><span>${i < 9 ? `<kbd style="color:var(--muted);font-size:10px">${i + 1}</kbd> ` : ''}${esc(s.name)}</span><span class="proj">${esc(s.project)}</span></div>
          <div class="detail">${esc(s.status === 'working' ? (s.lastDetail ?? s.prompt ?? 'thinking…') : (s.message ?? s.lastDetail ?? s.prompt ?? ''))}</div>
        </div>
        <div>
          <div class="status ${s.status}">${LABEL[s.status]}</div>
          <div class="time" data-since="${s.statusSince}">${ago(s.statusSince)}</div>
        </div>
      </li>`).join('');
    this.list.querySelectorAll<HTMLLIElement>('.session').forEach(li => {
      const id = li.dataset.id!;
      li.addEventListener('click', () => this.events.onSelect(id));
      li.addEventListener('mouseenter', () => this.events.onHover(id));
      li.addEventListener('mouseleave', () => this.events.onHover(null));
    });
    this.renderSummary(all);
    this.renderDetails();
  }

  private renderTimes() {
    this.list.querySelectorAll<HTMLElement>('.time').forEach(el => { el.textContent = ago(Number(el.dataset.since)); });
    const d = this.details.querySelector<HTMLElement>('[data-since]');
    if (d) d.textContent = ago(Number(d.dataset.since));
  }

  private renderSummary(all: Session[]) {
    const count = (st: SessionStatus) => all.filter(s => s.status === st).length;
    const parts: string[] = [];
    const add = (st: SessionStatus, label: string) => { const n = count(st); if (n) parts.push(`<span class="${st}"><b>${n}</b> ${label}</span>`); };
    add('working', 'Working'); add('permission', 'Permission'); add('waiting', 'Waiting'); add('completed', 'Done'); add('error', 'Error'); add('idle', 'Idle');
    this.summary.innerHTML = parts.length ? parts.join('<span style="opacity:.4">·</span>') : `<span style="color:var(--muted)">no sessions — start <b>claude</b> anywhere</span>`;
  }

  private renderDetails() {
    const s = this.selected ? this.sessions.get(this.selected) : undefined;
    if (!s) { this.details.hidden = true; return; }
    this.details.hidden = false;
    const term = s.terminal.program ?? s.terminal.bundleId ?? '—';
    this.details.innerHTML = `
      <h2><span>${esc(s.name)} <span style="color:var(--muted);font-weight:400">· ${esc(s.project)}</span></span>
          <span class="status ${s.status}">${LABEL[s.status]}</span></h2>
      ${s.message ? `<div class="msg ${s.status}">${esc(s.message)}</div>` : ''}
      <div class="kv">
        <span>Status for</span><b data-since="${s.statusSince}">${ago(s.statusSince)}</b>
        <span>Task</span><b title="${esc(s.prompt ?? '')}">${esc(s.prompt ?? '—')}</b>
        <span>Last tool</span><b title="${esc(s.lastDetail ?? '')}">${esc(s.lastDetail ?? '—')}</b>
        <span>Directory</span><b title="${esc(s.cwd)}">${esc(s.cwd)}</b>
        <span>Terminal</span><b>${esc(term)}${s.terminal.tty ? ' · ' + esc(s.terminal.tty.replace('/dev/', '')) : ''}</b>
        <span>Turns / tools</span><b>${s.turns} / ${s.toolCalls}${s.subagents.length ? ` · ${s.subagents.length} subagent${s.subagents.length > 1 ? 's' : ''}` : ''}</b>
        <span>Mode</span><b>${esc(s.permissionMode ?? '—')}${s.model ? ' · ' + esc(s.model) : ''}</b>
      </div>
      <div class="actions">
        <button class="btn" data-act="focus">⌘ Open terminal</button>
        <button class="btn" data-act="dismiss" title="Remove from the yard (does not stop the session)">Dismiss</button>
      </div>
      <ul class="log">${[...s.events].reverse().slice(0, 12).map(e => `<li><span>${clock(e.at)}</span><span>${esc(e.event)}</span><span title="${esc(e.detail ?? '')}">${esc(e.detail ?? '')}</span></li>`).join('')}</ul>`;
    this.details.querySelector('[data-act="focus"]')!.addEventListener('click', () => this.events.onFocus(s.id));
    this.details.querySelector('[data-act="dismiss"]')!.addEventListener('click', () => this.events.onDismiss(s.id));
  }
}
