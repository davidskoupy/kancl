import type { Session, SessionStatus, Project, Worktree, MergeRequest, NightShift, Job } from '../../../shared/types.ts';
import { attentionQueue } from './mini.ts';

export interface PanelEvents {
  onSelect: (id: string | null) => void;
  onFocus: (id: string) => void;
  onDismiss: (id: string) => void;
  onHover: (id: string | null) => void;
  onDemo: () => void;
  onOpenFile: (path: string) => void;
}

type Sel = { kind: 'session' | 'project' | 'job'; id: string } | null;

const ORDER: Record<SessionStatus, number> = { permission: 0, error: 1, waiting: 2, completed: 3, working: 4, idle: 5 };
const LABEL: Record<SessionStatus, string> = {
  permission: 'dotaz', error: 'chyba', waiting: 'čeká', completed: 'hotovo', working: 'práce', idle: 'klid',
};
const HOST_LABEL: Record<Project['host'], string> = { github: 'github', gitlab: 'gitlab', none: 'složka' };
const MR_LABEL: Record<MergeRequest['state'], string> = { open: 'otevřený', draft: 'draft', approved: 'schválený', changes_requested: 'změny' };
const ATTENTION: SessionStatus[] = ['permission', 'waiting', 'error', 'completed'];
const KLID_VISIBLE = 8;
const JOB_LABEL: Record<Job['state'], string> = { spi: 'spí', bezi: 'běží', ok: 'ok', chyba: 'chyba', vypnuto: 'hotovo' };
const LOOSE_ID = '__loose__';

function ago(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d`;
}

function clock(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
}

/** "dnes 07:04", "včera 07:04", "8. 9. 07:04" */
function dayClock(ts: number): string {
  const d = new Date(ts), now = new Date();
  const same = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const y = new Date(now); y.setDate(now.getDate() - 1);
  const t = new Date(now); t.setDate(now.getDate() + 1);
  const time = clock(ts);
  if (same(d, now)) return `dnes ${time}`;
  if (same(d, y)) return `včera ${time}`;
  if (same(d, t)) return `zítra ${time}`;
  return `${d.getDate()}. ${d.getMonth() + 1}. ${time}`;
}

function plural(n: number, one: string, few: string, many: string): string {
  return n === 1 ? one : n >= 2 && n <= 4 ? few : many;
}

interface Group { project: Project | null; sessions: Session[] }

export class Panel {
  private list = document.getElementById('tree')!;
  private empty = document.getElementById('empty')!;
  private details = document.getElementById('details')!;
  private summary = document.getElementById('summary')!;
  private filters = document.getElementById('filters')!;
  private conn = document.getElementById('conn')!;
  private toast = document.getElementById('toast')!;
  private sessions = new Map<string, Session>();
  private projects: Project[] = [];
  private night: NightShift = { jobs: [], cloudSessions: [], scannedAt: 0 };
  private sel: Sel = null;
  private filter: 'all' | 'attention' = 'all';
  private showAllKlid = false;
  private toastTimer?: number;

  constructor(private events: PanelEvents) {
    document.getElementById('demo-btn')!.addEventListener('click', () => this.events.onDemo());
    this.filters.innerHTML = `
      <button class="chip on" data-f="all">Vše</button>
      <button class="chip" data-f="attention">Chce mě</button>
      <span class="spacer"></span>
      <button class="chip pref" id="notify-btn" title="Systémové notifikace, když tě někdo potřebuje">🔔</button>
      <button class="chip pref" id="sound-btn" title="Pípnutí při dotazu / chybě">🔈</button>`;
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
      if (!ok && !get().notify) this.showToast('Notifikace jsou v prohlížeči zablokované');
      paint();
    });
    sb.addEventListener('click', () => { set.sound(!get().sound); paint(); });
    paint();
  }

  setConnection(state: string) {
    this.conn.className = `conn ${state === 'ok' || state === 'demo' ? 'ok' : state === 'error' ? 'err' : ''}`;
    this.conn.querySelector('.conn-text')!.textContent =
      state === 'ok' ? 'živě' : state === 'demo' ? 'ukázka' : state === 'error' ? 'server neběží' : 'připojuji';
  }

  setProjects(projects: Project[]) { this.projects = projects; this.render(); }
  setNight(n: NightShift) { this.night = n; this.render(); }
  selectJob(id: string) {
    this.events.onSelect(null);
    this.sel = { kind: 'job', id };
    this.render();
    this.list.querySelector(`[data-jid="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest' });
  }
  upsert(s: Session) { this.sessions.set(s.id, s); this.render(); }
  remove(id: string) {
    this.sessions.delete(id);
    if (this.sel?.kind === 'session' && this.sel.id === id) this.sel = null;
    this.render();
  }

  select(id: string | null) {
    this.sel = id ? { kind: 'session', id } : null;
    this.render();
    if (id) this.list.querySelector(`[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest' });
  }

  showToast(text: string) {
    this.toast.textContent = text;
    this.toast.hidden = false;
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => (this.toast.hidden = true), 2500);
  }

  // ---- data ---------------------------------------------------------------
  private groups(): Group[] {
    const byProject = new Map<string, Session[]>();
    const loose: Session[] = [];
    for (const s of this.sessions.values()) {
      if (s.projectId && this.projects.some(p => p.id === s.projectId)) byProject.set(s.projectId, [...(byProject.get(s.projectId) ?? []), s]);
      else loose.push(s);
    }
    const sortS = (l: Session[]) => l.sort((a, b) => ORDER[a.status] - ORDER[b.status] || (ATTENTION.includes(a.status) ? a.statusSince - b.statusSince : a.startedAt - b.startedAt));
    const out: Group[] = this.projects.map(p => ({ project: p, sessions: sortS(byProject.get(p.id) ?? []) }));
    if (loose.length) out.unshift({ project: null, sessions: sortS(loose) });
    return out;
  }

  /** Fronta „chce mě" podle délky čekání (Tab). */
  queue(): Session[] { return attentionQueue(this.sessions.values()); }

  /** Sezení v pořadí panelu (klávesy 1–9). */
  sorted(): Session[] {
    return this.groups().flatMap(g => g.sessions);
  }

  // ---- render -------------------------------------------------------------
  private render() {
    const all = [...this.sessions.values()];
    this.empty.hidden = all.length > 0 || this.projects.length > 0;

    let groups = this.groups();
    if (this.filter === 'attention') groups = groups.filter(g => g.sessions.some(s => ATTENTION.includes(s.status)));

    let n = 0;                          // číslování sezení
    let klidShown = 0, klidHidden = 0;
    const html: string[] = [];
    for (const g of groups) {
      const p = g.project;
      const status = p ? p.status : 'prace';
      const isKlid = status === 'klid';
      if (isKlid && !this.showAllKlid && klidShown >= KLID_VISIBLE) { klidHidden++; continue; }
      if (isKlid) klidShown++;
      const id = p?.id ?? LOOSE_ID;
      const open = !isKlid || (this.sel?.kind === 'project' && this.sel.id === id);
      const selected = this.sel?.kind === 'project' && this.sel.id === id;
      const sessionsHtml = g.sessions.map(s => {
        const idx = n++;
        const subs = s.subagents.map(a => `<li class="sub" title="${esc(a.description)}">└ ${esc(a.description)}</li>`).join('');
        return `
          <li class="session ${s.status} ${this.sel?.kind === 'session' && this.sel.id === s.id ? 'selected' : ''}" data-id="${esc(s.id)}" title="${esc(s.cwd)}">
            <div class="bar"></div>
            <div>
              <div class="name"><span>${idx < 9 ? `<kbd>${idx + 1}</kbd> ` : ''}${esc(s.title ?? s.name)}</span><span class="proj">${s.title ? esc(s.name) + (p ? '' : ' · ' + esc(s.project)) : (p ? '' : esc(s.project))}</span></div>
              <div class="detail">${esc(s.status === 'working' ? (s.lastDetail ?? s.prompt ?? 'přemýšlí…') : (s.message ?? s.lastDetail ?? s.prompt ?? ''))}</div>
            </div>
            <div>
              <div class="status ${s.status}">${LABEL[s.status]}</div>
              <div class="time" data-since="${s.statusSince}">${ago(s.statusSince)}</div>
            </div>
          </li>${subs}`;
      }).join('');
      html.push(`
        <li class="proj ${status} ${open ? 'open' : ''} ${selected ? 'selected' : ''}" data-pid="${esc(id)}">
          <div class="proj-row">
            <i class="pdot"></i>
            <span class="pname">${p ? esc(p.name) : 'mimo projekty'}</span>
            <span class="phost">${p ? HOST_LABEL[p.host] : ''}</span>
            <span class="pmeta">${p ? this.projectMeta(p) : `${g.sessions.length} ${plural(g.sessions.length, 'sezení', 'sezení', 'sezení')}`}</span>
          </div>
          <ul class="sessions">${sessionsHtml}</ul>
        </li>`);
    }
    if (klidHidden) html.push(`<li class="more" data-more="1">+ ${klidHidden} ${plural(klidHidden, 'další', 'další', 'dalších')}</li>`);
    else if (this.showAllKlid && klidShown > KLID_VISIBLE) html.push(`<li class="more" data-more="0">sbalit</li>`);
    html.push(this.renderNight());
    this.list.innerHTML = html.join('');
    this.list.querySelectorAll<HTMLElement>('.job').forEach(li => li.addEventListener('click', () => this.selectJob(li.dataset.jid!)));

    this.list.querySelectorAll<HTMLLIElement>('.session').forEach(li => {
      const id = li.dataset.id!;
      li.addEventListener('click', e => { e.stopPropagation(); this.events.onSelect(id); });
      li.addEventListener('mouseenter', () => this.events.onHover(id));
      li.addEventListener('mouseleave', () => this.events.onHover(null));
    });
    this.list.querySelectorAll<HTMLElement>('.proj-row').forEach(row => {
      const id = (row.parentElement as HTMLElement).dataset.pid!;
      row.addEventListener('click', () => {
        const next: Sel = this.sel?.kind === 'project' && this.sel.id === id ? null : { kind: 'project', id };
        this.events.onSelect(null);   // scéna zavolá zpět select(null) → nastavit až potom
        this.sel = next;
        this.render();
      });
    });
    this.list.querySelector<HTMLElement>('.more')?.addEventListener('click', e => {
      this.showAllKlid = (e.currentTarget as HTMLElement).dataset.more === '1';
      this.render();
    });

    this.renderSummary(all);
    this.renderDetails();
  }

  private renderNight(): string {
    const jobs = this.filter === 'attention' ? this.night.jobs.filter(j => j.state === 'chyba') : this.night.jobs;
    if (!jobs.length && !this.night.stock) return '';
    const stock = this.night.stock;
    const stockHtml = stock ? `
      <li class="stock ${stock.items.some(i => i.alarm) ? 'alarm' : ''}" title="zásoba témat content enginu (${dayClock(stock.at)})">
        <span class="k">zásoba témat</span>
        ${stock.items.map(i => `<span class="${i.alarm ? 'al' : ''}">${esc(i.project)} <b>${i.pending}</b></span>`).join('<i>·</i>')}
      </li>` : '';
    const rows = jobs.map(j => {
      const r = j.lastResult;
      let line: string;
      if (j.lastRunAt && (j.state === 'ok' || j.state === 'chyba' || j.state === 'bezi' || r)) {
        const what = r ? `${r.project ? esc(r.project) + ' ' : ''}${r.result === 'ok' ? '✓' : r.result === 'skip' ? '⏭' : '✗'}${r.slug ? ' ' + esc(r.slug) : ''}` : j.state === 'bezi' ? 'běží…' : 'proběhlo';
        line = `poslední: ${dayClock(j.lastRunAt)} · ${what}`;
      } else if (j.nextRunAt) line = `další: ${dayClock(j.nextRunAt)}`;
      else if (j.lastRunAt) line = `proběhlo ${dayClock(j.lastRunAt)}`;
      else line = '';
      const sel = this.sel?.kind === 'job' && this.sel.id === j.id ? 'selected' : '';
      return `
        <li class="job ${j.state} ${sel}" data-jid="${esc(j.id)}" title="${esc(j.description ?? '')}">
          <i class="jdot"></i>
          <div>
            <div class="name"><span>${esc(j.name)}</span>${j.source === 'routine' ? '<span class="cloudtag">cloud</span>' : ''}<span class="proj">${esc(j.scheduleHuman)}</span></div>
            <div class="detail">${line}</div>
          </div>
          <div class="jstate ${j.state}">${JOB_LABEL[j.state]}</div>
        </li>${j.id === stock?.engine || (stock && j.id === 'daily-content') ? stockHtml : ''}`;
    }).join('');
    const stockOrphan = stock && !jobs.some(j => j.id === 'daily-content' || j.id === stock.engine) ? stockHtml : '';
    const n = this.night;
    let snap = '';
    if (n.snapshotError) snap = `<span class="snap err" title="${esc(n.snapshotError)}">cloud: chyba snímku</span>`;
    else if (n.snapshotAt) {
      const old = Date.now() - n.snapshotAt > 2 * 3600_000;
      snap = `<span class="snap ${old ? 'old' : ''}" title="${old ? 'Snímek cloudu je starý, aplikace Claude asi neběžela' : 'snímek cloudu z úlohy kancl-cloud-snapshot'}">cloud ${old ? 'z ' : ''}${dayClock(n.snapshotAt)}</span>`;
    }
    const cloudRows = n.cloudSessions.map(c => `
      <li class="csess ${c.status}" title="${esc(c.kind === 'cloud' ? 'cloudové sezení' : 'Remote Control')}">
        <i class="cdot"></i><span class="cname">${esc(c.name)}</span><span class="cst">${c.status === 'working' ? 'pracuje' : c.status === 'idle' ? 'čeká' : 'offline'}${c.kind === 'remote-control' ? ' · RC' : ''}</span>
      </li>`).join('');
    const cloudSection = n.cloudSessions.length ? `<li class="nhead"><span>V cloudu</span><span class="muted">${n.cloudSessions.length} ${plural(n.cloudSessions.length, 'sezení', 'sezení', 'sezení')}</span></li>${cloudRows}` : '';
    return `<li class="nhead"><span>Noční směna</span><span class="muted">${jobs.length} ${plural(jobs.length, 'úloha', 'úlohy', 'úloh')}${snap ? ' · ' + snap : ''}</span></li>${rows}${stockOrphan}${cloudSection}`;
  }

  private jobDetails(j: Job): string {
    const proj = this.projects.find(p => p.id === j.projectId);
    const r = j.lastResult;
    return `
      <h2><span>${esc(j.name)} <span style="color:var(--muted);font-weight:400">· ${j.source === 'routine' ? 'cloud' : 'noční směna'}</span></span>
          <span class="jstate ${j.state}">${JOB_LABEL[j.state]}</span></h2>
      ${j.description ? `<div class="msg">${esc(j.description)}</div>` : ''}
      ${r ? `<div class="msg ${r.result === 'fail' ? 'error' : r.result === 'ok' ? 'completed' : ''}"><b>${esc(r.resultText)}</b>${r.project || r.slug ? ` · ${esc([r.project, r.slug].filter(Boolean).join(' / '))}` : ''}${r.note ? `<br><span class="muted">${esc(r.note)}</span>` : ''}</div>` : ''}
      <div class="kv">
        <span>Rozvrh</span><b>${esc(j.scheduleHuman)}${j.schedule ? ` <span class="muted">(${esc(j.schedule)})</span>` : ''}</b>
        <span>Poslední běh</span><b>${j.lastRunAt ? dayClock(j.lastRunAt) : '—'}</b>
        <span>Další běh</span><b>${j.nextRunAt ? dayClock(j.nextRunAt) : j.enabled ? '—' : 'vypnuto'}</b>
        <span>Projekt</span><b title="${esc(j.cwd ?? '')}">${esc(proj?.name ?? j.cwd ?? '—')}</b>
        <span>Zdroj</span><b>${j.source === 'claude' ? 'naplánovaná úloha Claude' : j.source === 'routine' ? `cloudová routina${j.model ? ' · ' + esc(j.model) : ''}` : 'cron-job.org'}</b>
      </div>
      <div class="actions">
        ${j.url ? `<a class="btn" href="${esc(j.url)}" target="_blank" rel="noopener">Otevřít na claude.ai</a>` : ''}
        ${j.filePath ? `<button class="btn" data-act="open">Otevřít SKILL.md</button>` : ''}
        ${proj ? `<button class="btn" data-act="proj">Projekt ${esc(proj.name)}</button>` : ''}
      </div>`;
  }

  private projectMeta(p: Project): string {
    const parts: string[] = [];
    if (p.worktrees.length > 1) parts.push(`${p.worktrees.length} worktree`);
    else if (p.worktrees[0]?.branch) parts.push(esc(p.worktrees[0].branch));
    const dirty = p.worktrees.reduce((a, w) => a + w.dirty, 0);
    if (dirty) parts.push(`<b>${dirty} ${plural(dirty, 'změna', 'změny', 'změn')}</b>`);
    if (p.mrs.length) parts.push(`${p.mrs.length} PR/MR`);
    if (p.ci?.status === 'fail') parts.push(`<b class="ci fail">CI ✗</b>`);
    else if (p.ci?.status === 'running') parts.push(`<span class="ci run">CI …</span>`);
    const oldest = Math.min(...p.worktrees.map(w => w.dirtyOldest ?? Infinity));
    if (dirty && Number.isFinite(oldest) && Date.now() - oldest > 3 * 86_400_000) parts.push(`nejstarší ${Math.floor((Date.now() - oldest) / 86_400_000)} d`);
    if (p.worktrees.some(w => w.stale)) parts.push('<span class="stale">zastaralé worktree</span>');
    if (p.worktrees.some(w => w.error)) parts.push('<b>git neodpovídá</b>');
    return parts.join(' · ');
  }

  private renderTimes() {
    this.list.querySelectorAll<HTMLElement>('.time').forEach(el => { el.textContent = ago(Number(el.dataset.since)); });
    this.details.querySelectorAll<HTMLElement>('[data-since]').forEach(d => { d.textContent = ago(Number(d.dataset.since)); });
  }

  private renderSummary(all: Session[]) {
    if (!all.length && !this.night.jobs.length) {
      this.summary.innerHTML = `<span style="color:var(--muted)">žádné sezení — spusť <b>claude</b> kdekoli</span>`;
      return;
    }
    const prace = this.projects.filter(p => p.status === 'prace').length + this.projects.filter(p => p.status === 'dotaz').length;
    const dotaz = all.filter(s => s.status === 'permission').length;
    const parts = [`<span class="working"><b>${all.length}</b> ${plural(all.length, 'sezení', 'sezení', 'sezení')}</span>`];
    const q = attentionQueue(all);
    if (q.length) parts.push(`<span class="${q[0].status}">nejdéle čeká <b>${esc(q[0].title ?? q[0].name)}</b> ${ago(q[0].statusSince)}</span>`);
    if (prace) parts.push(`<span class="completed"><b>${prace}</b> ${plural(prace, 'projekt', 'projekty', 'projektů')} v práci</span>`);
    if (dotaz) parts.push(`<span class="permission"><b>${dotaz}</b> ${plural(dotaz, 'dotaz', 'dotazy', 'dotazů')}</span>`);
    const err = all.filter(s => s.status === 'error').length;
    if (err) parts.push(`<span class="error"><b>${err}</b> ${plural(err, 'chyba', 'chyby', 'chyb')}</span>`);
    const todayOk = this.night.jobs.filter(j => j.state === 'ok').length;
    const jobErr = this.night.jobs.filter(j => j.state === 'chyba').length;
    if (todayOk) parts.push(`<span class="completed"><b>${todayOk}</b> ${plural(todayOk, 'úloha', 'úlohy', 'úloh')} ✓</span>`);
    if (jobErr) parts.push(`<span class="error"><b>${jobErr}</b> ${plural(jobErr, 'úloha', 'úlohy', 'úloh')} ✗</span>`);
    this.summary.innerHTML = parts.join('<span style="opacity:.4">·</span>');
  }

  private renderDetails() {
    if (!this.sel) { this.details.hidden = true; return; }
    if (this.sel.kind === 'job') {
      const j = this.night.jobs.find(x => x.id === this.sel!.id);
      if (!j) { this.details.hidden = true; return; }
      this.details.hidden = false;
      this.details.innerHTML = this.jobDetails(j);
      this.details.querySelector('[data-act="open"]')?.addEventListener('click', () => this.events.onOpenFile(j.filePath!));
      this.details.querySelector('[data-act="proj"]')?.addEventListener('click', () => { this.sel = { kind: 'project', id: j.projectId! }; this.render(); });
      return;
    }
    if (this.sel.kind === 'project') {
      const p = this.projects.find(x => x.id === this.sel!.id);
      if (!p) { this.details.hidden = true; return; }
      this.details.hidden = false;
      this.details.innerHTML = this.projectDetails(p);
      this.details.querySelectorAll<HTMLElement>('[data-sid]').forEach(el => el.addEventListener('click', () => this.events.onSelect(el.dataset.sid!)));
      this.details.querySelectorAll<HTMLElement>('[data-jid]').forEach(el => el.addEventListener('click', () => this.selectJob(el.dataset.jid!)));
      this.details.querySelectorAll<HTMLElement>('[data-rm]').forEach(el => el.addEventListener('click', e => {
        e.stopPropagation();
        const cmd = `git worktree remove "${el.dataset.rm}"`;
        navigator.clipboard?.writeText(cmd).then(() => this.showToast('Příkaz je ve schránce, Kancl nic nemaže'), () => this.showToast(cmd));
      }));
      return;
    }
    const s = this.sessions.get(this.sel.id);
    if (!s) { this.details.hidden = true; return; }
    this.details.hidden = false;
    this.details.innerHTML = this.sessionDetails(s);
    this.details.querySelector('[data-act="focus"]')!.addEventListener('click', () => this.events.onFocus(s.id));
    this.details.querySelector('[data-act="dismiss"]')!.addEventListener('click', () => this.events.onDismiss(s.id));
  }

  private projectDetails(p: Project): string {
    const wt = (w: Worktree) => `
      <tr>
        <td title="${esc(w.path)}">${esc(w.label)}</td>
        <td>${esc(w.branch || '—')}</td>
        <td>${w.error ? `<span class="status error">${esc(w.error)}</span>` : `${w.dirty ? `<b>${w.dirty} ${plural(w.dirty, 'změna', 'změny', 'změn')}</b>${w.dirtyOldest && Date.now() - w.dirtyOldest > 86_400_000 ? ` <span class="muted">(${Math.floor((Date.now() - w.dirtyOldest) / 86_400_000)} d)</span>` : ''}` : 'čisté'}${w.ahead ? ` ↑${w.ahead}` : ''}${w.behind ? ` ↓${w.behind}` : ''}${w.stale ? ` <span class="stale" title="větev je sloučená a worktree se 14 dní nehnul">zastaralé</span> <button class="btn xs" data-rm="${esc(w.path)}" title="zkopíruje příkaz do schránky">kopírovat git worktree remove</button>` : w.merged && p.worktrees.length > 1 ? ' <span class="muted">sloučené</span>' : ''}`}</td>
        <td title="${esc(w.lastCommit?.message ?? '')}">${w.lastCommit ? `${esc(w.lastCommit.hash)} ${esc(w.lastCommit.message)} · <span data-since="${w.lastCommit.at * 1000}">${ago(w.lastCommit.at * 1000)}</span>` : ''}</td>
      </tr>`;
    const mr = (m: MergeRequest) => `
      <li class="mr"><a href="${esc(m.url)}" target="_blank" rel="noopener">${p.host === 'gitlab' ? '!' : '#'}${m.number}</a>
        <span title="${esc(m.title)}">${esc(m.title)}</span> <span class="status ${m.state === 'approved' ? 'completed' : m.state === 'changes_requested' ? 'error' : 'idle'}">${MR_LABEL[m.state]}</span>
        <span class="muted">${esc(m.branch)}</span></li>`;
    const jobsHere = this.night.jobs.filter(j => j.projectId === p.id);
    const jobsHtml = jobsHere.map(j => `<li class="mini" data-jid="${esc(j.id)}"><b>🤖 ${esc(j.name)}</b> <span class="jstate ${j.state}">${JOB_LABEL[j.state]}</span> <span class="muted">${esc(j.scheduleHuman)}</span></li>`).join('');
    const mine = [...this.sessions.values()].filter(s => s.projectId === p.id);
    const sess = mine.map(s => `<li class="mini ${s.status}" data-sid="${esc(s.id)}"><b>${esc(s.name)}</b> <span class="status ${s.status}">${LABEL[s.status]}</span> <span class="muted">${esc(s.lastDetail ?? s.message ?? '')}</span></li>`).join('');
    return `
      <h2><span>${esc(p.name)} <span style="color:var(--muted);font-weight:400">· ${HOST_LABEL[p.host]}</span></span>
          <span class="status ${p.status === 'dotaz' ? 'permission' : p.status === 'prace' ? 'working' : 'idle'}">${p.status === 'prace' ? 'práce' : p.status}</span></h2>
      ${p.mrsError ? `<div class="msg error">PR/MR nedostupné: ${esc(p.mrsError)}</div>` : ''}
      ${p.ci && p.ci.status !== 'none' ? `<div class="label">GitHub Actions</div><ul class="mrs">${p.ci.runs.map(r => `<li class="mr"><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.name)}</a> <span class="status ${r.status === 'ok' ? 'completed' : r.status === 'fail' ? 'error' : 'working'}">${r.status === 'ok' ? 'prošel' : r.status === 'fail' ? 'selhal' : 'běží'}</span> <span class="muted" title="${esc(r.title ?? '')}">${dayClock(r.at)}${r.title ? ' · ' + esc(r.title) : ''}</span></li>`).join('')}</ul>` : ''}
      <div class="tbl"><table>${p.worktrees.map(wt).join('')}</table></div>
      ${p.mrs.length ? `<div class="label">${p.host === 'gitlab' ? 'Merge requesty' : 'Pull requesty'}</div><ul class="mrs">${p.mrs.map(mr).join('')}</ul>` : p.host !== 'none' && !p.mrsError ? `<div class="muted">žádné otevřené PR/MR</div>` : ''}
      ${sess ? `<div class="label">Sezení</div><ul class="mrs">${sess}</ul>` : ''}
      ${jobsHtml ? `<div class="label">Noční směna</div><ul class="mrs">${jobsHtml}</ul>` : ''}
      ${p.remoteUrl && !p.remoteUrl.startsWith('file://') ? `<div class="muted" style="margin-top:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(p.remoteUrl)}">${esc(p.remoteUrl)}</div>` : ''}`;
  }

  private sessionDetails(s: Session): string {
    const term = s.terminal.program ?? s.terminal.bundleId ?? '—';
    const proj = this.projects.find(p => p.id === s.projectId);
    return `
      <h2><span>${esc(s.title ?? s.name)} <span style="color:var(--muted);font-weight:400">· ${s.title ? esc(s.name) + ' · ' : ''}${esc(proj?.name ?? s.project)}</span></span>
          <span class="status ${s.status}">${LABEL[s.status]}</span></h2>
      ${s.message ? `<div class="msg ${s.status}">${esc(s.message)}</div>` : ''}
      <div class="kv">
        <span>Stav už</span><b data-since="${s.statusSince}">${ago(s.statusSince)}</b>
        <span>Úkol</span><b title="${esc(s.prompt ?? '')}">${esc(s.prompt ?? '—')}</b>
        <span>Nástroj</span><b title="${esc(s.lastDetail ?? '')}">${esc(s.lastDetail ?? '—')}</b>
        <span>Složka</span><b title="${esc(s.cwd)}">${esc(s.cwd)}</b>
        <span>Terminál</span><b>${esc(term)}${s.terminal.tty ? ' · ' + esc(s.terminal.tty.replace('/dev/', '')) : ''}</b>
        <span>Tahy / nástroje</span><b>${s.turns} / ${s.toolCalls}</b>
        <span>Subagenti</span><b>${s.subagents.length ? s.subagents.map(a => esc(a.description)).join(', ') : '—'}</b>
        <span>Režim</span><b>${esc(s.permissionMode ?? '—')}${s.model ? ' · ' + esc(s.model) : ''}</b>
      </div>
      <div class="actions">
        <button class="btn" data-act="focus">${s.desktopId ? '⌘ Otevřít v aplikaci Claude' : '⌘ Otevřít terminál'}</button>
        <button class="btn" data-act="dismiss" title="Skryje z kanceláře (sezení nezastaví)">Skrýt</button>
      </div>
      <ul class="log">${[...s.events].reverse().slice(0, 12).map(e => `<li><span>${clock(e.at)}</span><span>${esc(e.event)}</span><span title="${esc(e.detail ?? '')}">${esc(e.detail ?? '')}</span></li>`).join('')}</ul>`;
  }
}
