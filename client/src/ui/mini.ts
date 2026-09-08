import type { Session, NightShift, SessionStatus } from '../../../shared/types.ts';

/** Mini režim (?mini=1): pruh do rohu obrazovky — souhrn, fronta „chce mě", noční směna. */
const LABEL: Record<SessionStatus, string> = { permission: 'dotaz', error: 'chyba', waiting: 'čeká', completed: 'hotovo', working: 'práce', idle: 'klid' };
const ATTENTION: SessionStatus[] = ['permission', 'error', 'waiting', 'completed'];
const RANK: Record<SessionStatus, number> = { permission: 0, error: 1, waiting: 2, completed: 3, working: 4, idle: 5 };

function ago(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}
function esc(s: string): string { return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!)); }

/** Fronta „chce mě": podle stavu, uvnitř podle délky čekání (nejdéle první). */
export function attentionQueue(sessions: Iterable<Session>): Session[] {
  return [...sessions].filter(s => ATTENTION.includes(s.status)).sort((a, b) => RANK[a.status] - RANK[b.status] || a.statusSince - b.statusSince);
}

export class Mini {
  private root: HTMLElement;
  private sessions = new Map<string, Session>();
  private night: NightShift = { jobs: [], cloudSessions: [], scannedAt: 0 };

  constructor(host: HTMLElement, private onFocus: (id: string) => void) {
    this.root = host;
    window.setInterval(() => this.render(), 1000);
  }

  upsert(s: Session) { this.sessions.set(s.id, s); this.render(); }
  remove(id: string) { this.sessions.delete(id); this.render(); }
  setNight(n: NightShift) { this.night = n; this.render(); }

  private render() {
    const all = [...this.sessions.values()];
    const queue = attentionQueue(all);
    const working = all.filter(s => s.status === 'working').length;
    const jobsOk = this.night.jobs.filter(j => j.state === 'ok').length;
    const jobsErr = this.night.jobs.filter(j => j.state === 'chyba').length;
    const snapOld = this.night.snapshotAt ? Date.now() - this.night.snapshotAt > 2 * 3600_000 : false;
    const rows = queue.slice(0, 6).map(s => `
      <li class="mrow ${s.status}" data-id="${esc(s.id)}">
        <i></i>
        <span class="mname">${esc(s.title ?? s.name)}${s.title ? `<small>${esc(s.name)}</small>` : ''}</span>
        <span class="mst">${LABEL[s.status]}</span>
        <span class="mago">${ago(s.statusSince)}</span>
      </li>`).join('');
    this.root.innerHTML = `
      <div class="mhead">
        <b>Kancl</b>
        <span>${all.length} sezení · ${working} pracuje${queue.length ? ` · <em>${queue.length} chce tě</em>` : ''}</span>
      </div>
      <ul class="mlist">${rows || '<li class="mempty">nikdo tě nepotřebuje</li>'}</ul>
      <div class="mfoot ${jobsErr ? 'err' : ''}">
        noční směna: ${jobsOk} ✓${jobsErr ? ` · <b>${jobsErr} ✗</b>` : ''}${snapOld ? ' · <span class="old">cloud zastaralý</span>' : ''}
      </div>`;
    this.root.querySelectorAll<HTMLElement>('.mrow').forEach(li => li.addEventListener('click', () => this.onFocus(li.dataset.id!)));
  }
}
