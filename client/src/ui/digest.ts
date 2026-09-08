/** Ranní přehled (?digest=1): co se stalo od včerejška — z /api/digest. Čte se, neovládá. */

interface Ev { at: number; kind: string; title: string; project?: string; detail?: string }
interface DigestData {
  from: number; to: number;
  sessions: Ev[]; jobsOk: Ev[]; jobsFail: Ev[]; ciFail: Ev[]; stock: Ev[];
  counts: { sessions: number; jobsOk: number; jobsFail: number; ciFail: number };
  waitingNow: { id: string; name: string; status: string; since: number; project: string; message?: string }[];
  ciFailingNow: { project: string; name?: string; at?: number; url?: string }[];
  stockNow?: { at: number; items: { project: string; pending: number; alarm: boolean }[] };
  snapshotAt?: number;
}

function esc(s: string): string { return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!)); }
function clock(ts: number): string { const d = new Date(ts); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; }
function dayClock(ts: number): string {
  const d = new Date(ts), now = new Date();
  const same = d.toDateString() === now.toDateString();
  const y = new Date(now); y.setDate(now.getDate() - 1);
  return `${same ? 'dnes' : d.toDateString() === y.toDateString() ? 'včera' : `${d.getDate()}. ${d.getMonth() + 1}.`} ${clock(ts)}`;
}
function ago(ts: number): string { const m = Math.max(0, Math.round((Date.now() - ts) / 60_000)); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`; }
const STATUS: Record<string, string> = { permission: 'čeká na povolení', waiting: 'čeká na odpověď', error: 'skončilo chybou' };

export class DigestView {
  private since: number;
  constructor(private host: HTMLElement, private onFocus: (id: string) => void) {
    const d = new Date(); d.setDate(d.getDate() - 1); d.setHours(18, 0, 0, 0);
    this.since = d.getTime();
  }

  async load() {
    this.host.innerHTML = '<p class="dmuted">Načítám…</p>';
    let data: DigestData;
    try { data = await (await fetch(`/api/digest?since=${this.since}`)).json(); }
    catch { this.host.innerHTML = '<p class="dmuted">Server neodpovídá.</p>'; return; }
    this.render(data);
  }

  private section(title: string, items: string[], empty: string): string {
    return `<section><h2>${title}</h2>${items.length ? `<ul>${items.join('')}</ul>` : `<p class="dmuted">${empty}</p>`}</section>`;
  }

  private render(d: DigestData) {
    const li = (e: Ev, cls = '') => `<li class="${cls}"><span class="dt">${dayClock(e.at)}</span><span><b>${esc(e.title)}</b>${e.project ? ` <span class="dmuted">· ${esc(e.project)}</span>` : ''}${e.detail ? `<div class="dmuted small">${esc(e.detail)}</div>` : ''}</span></li>`;
    const waiting = d.waitingNow.map(w => `<li class="${w.status}" data-id="${esc(w.id)}"><span class="dt">${ago(w.since)}</span><span><b>${esc(w.name)}</b> <span class="dmuted">· ${esc(w.project)} · ${STATUS[w.status] ?? w.status}</span>${w.message ? `<div class="dmuted small">${esc(w.message)}</div>` : ''}</span></li>`);
    const ci = d.ciFailingNow.map(c => `<li class="error"><span class="dt">${c.at ? dayClock(c.at) : ''}</span><span><b>${esc(c.project)}</b> <span class="dmuted">· ${esc(c.name ?? 'workflow')} selhal</span>${c.url ? ` <a href="${esc(c.url)}" target="_blank" rel="noopener">otevřít</a>` : ''}</span></li>`);
    const stock = d.stockNow ? `<p class="${d.stockNow.items.some(i => i.alarm) ? 'alarm' : 'dmuted'}">Zásoba témat: ${d.stockNow.items.map(i => `${esc(i.project)} <b>${i.pending}</b>`).join(' · ')}</p>` : '';
    const snap = d.snapshotAt ? `<p class="dmuted small">Snímek cloudu ${dayClock(d.snapshotAt)}${Date.now() - d.snapshotAt > 2 * 3600_000 ? ' (starý, aplikace Claude asi neběžela)' : ''}</p>` : '';
    this.host.innerHTML = `
      <header>
        <h1>Co se stalo</h1>
        <p class="dmuted">od ${dayClock(d.from)} do ${dayClock(d.to)} ·
          <button data-since="18">od včera 18:00</button> <button data-since="24">24 h</button> <button data-since="168">7 dní</button>
          · <a href="/">zpět do Kanclu</a></p>
        <p class="dsum">${d.counts.sessions} sezení skončilo · ${d.counts.jobsOk} úloh ✓ · ${d.counts.jobsFail} úloh ✗ · ${d.counts.ciFail} CI selhání · ${d.waitingNow.length} čeká na tebe</p>
      </header>
      ${this.section('Čeká na tebe teď', waiting, 'nikdo, hezké ráno')}
      ${this.section('Nasazení, která teď padají', ci, 'všechno prošlo')}
      ${this.section('Noční směna: selhalo', d.jobsFail.map(e => li(e, 'error')), 'žádná úloha neselhala')}
      ${this.section('Noční směna: proběhlo', d.jobsOk.map(e => li(e, 'ok')), 'nic neproběhlo')}
      ${stock}
      ${this.section('Sezení, která skončila', d.sessions.map(e => li(e)), 'žádné')}
      ${snap}`;
    this.host.querySelectorAll<HTMLButtonElement>('[data-since]').forEach(b => b.addEventListener('click', () => {
      const h = Number(b.dataset.since);
      if (h === 18) { const x = new Date(); x.setDate(x.getDate() - 1); x.setHours(18, 0, 0, 0); this.since = x.getTime(); }
      else this.since = Date.now() - h * 3600_000;
      this.load();
    }));
    this.host.querySelectorAll<HTMLElement>('[data-id]').forEach(li => li.addEventListener('click', () => this.onFocus(li.dataset.id!)));
  }
}
