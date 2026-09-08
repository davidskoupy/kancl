import { Scene } from './game/scene.ts';
import { KanclClient } from './net.ts';
import { Panel } from './ui/panel.ts';
import { Attention } from './ui/attention.ts';
import { Mini } from './ui/mini.ts';
import { DigestView } from './ui/digest.ts';

async function bootMini() {
  document.body.classList.add('mini');
  const host = document.getElementById('mini')!;
  host.hidden = false;
  let client: KanclClient;
  const mini = new Mini(host, async id => { try { await client.focus(id); } catch { /* server neodpovídá */ } });
  client = new KanclClient({
    onUpsert: s => mini.upsert(s),
    onRemove: id => mini.remove(id),
    onState: () => {},
    onProjects: () => {},
    onNight: n => mini.setNight(n),
  });
  const attention = new Attention({ onOpen: id => client.focus(id) });
  client.events.onNight = n => { mini.setNight(n); attention.setNight(n); };
  client.events.onUpsert = s => { mini.upsert(s); attention.upsert(s); };
  client.events.onRemove = id => { mini.remove(id); attention.remove(id); };
  const params = new URLSearchParams(location.search);
  if (params.has('demo')) client.startDemo(); else client.connect();
}

async function bootDigest() {
  document.body.classList.add('digest');
  const host = document.getElementById('digest')!;
  host.hidden = false;
  const view = new DigestView(host, async id => { await fetch(`/api/sessions/${encodeURIComponent(id)}/focus`, { method: 'POST' }).catch(() => {}); });
  await view.load();
}

async function boot() {
  const params0 = new URLSearchParams(location.search);
  if (params0.has('mini')) return bootMini();
  if (params0.has('digest')) return bootDigest();
  const host = document.getElementById('canvas-host')!;
  const stage = document.getElementById('stage')!;

  let scene: Scene;
  let client: KanclClient;

  const panel = new Panel({
    onSelect: id => scene.select(id),
    onFocus: id => focus(id),
    onDismiss: id => client.dismiss(id),
    onHover: id => scene.hover(id),
    onDemo: () => client.startDemo(),
    onOpenFile: async path => panel.showToast(await client.openFile(path).catch(() => 'Server neodpovídá')),
  });

  scene = new Scene(host, {
    onSelect: s => panel.select(s?.id ?? null),
    onActivate: s => focus(s.id),
    onHover: () => {},
    onJob: id => panel.selectJob(id),
  });
  await scene.init();

  const attention = new Attention({ onOpen: id => { scene.select(id); focus(id); } });
  panel.bindPrefs(
    () => ({ notify: attention.notify, sound: attention.sound }),
    { notify: on => attention.setNotify(on), sound: on => attention.setSound(on) },
  );

  client = new KanclClient({
    onUpsert: s => { scene.upsert(s); panel.upsert(s); attention.upsert(s); },
    onRemove: (id, reason) => { scene.remove(id); panel.remove(id); attention.remove(id); if (reason) panel.showToast(`Sezení skončilo (${reason})`); },
    onState: st => panel.setConnection(st),
    onProjects: p => { scene.setProjects(p); panel.setProjects(p); },
    onNight: n => { scene.setNight(n); panel.setNight(n); attention.setNight(n); },
  });

  async function focus(id: string) {
    const s = client.sessions.get(id);
    if (!s) return;
    panel.showToast(s.desktopId ? `Otevírám ${s.title ?? s.name} v aplikaci Claude…` : `Otevírám terminál ${s.name}…`);
    try {
      const r = await client.focus(id);
      panel.showToast(r);
    } catch (e) {
      panel.showToast('Server neodpovídá');
    }
  }

  // zoom controls
  const zoomLabel = document.getElementById('zoom-label')!;
  let manualScale: number | null = Number(localStorage.getItem('kancl.zoom')) || null;
  const fit = () => {
    const r = stage.getBoundingClientRect();
    if (manualScale) scene.setScale(manualScale);
    else scene.fitToHost(r.width - 24, r.height - 70);
    zoomLabel.textContent = `×${scene.scale}`;
    localStorage.setItem('kancl.zoom', manualScale ? String(manualScale) : '');
  };
  document.getElementById('zoom-in')!.addEventListener('click', () => { manualScale = scene.scale + 1; fit(); });
  document.getElementById('zoom-out')!.addEventListener('click', () => { manualScale = Math.max(1, scene.scale - 1); fit(); });
  document.getElementById('zoom-fit')!.addEventListener('click', () => { manualScale = null; fit(); });
  window.addEventListener('resize', fit);
  fit();

  // keyboard: 1-9 focus the n-th session in the list, Esc deselects
  window.addEventListener('keydown', e => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
    if (e.key === 'Escape') { scene.select(null); return; }
    if (e.key === 'Enter' && scene.selectedId) { focus(scene.selectedId); return; }
    if (e.key === 'Tab') {
      const q = panel.queue();
      if (!q.length) return;
      e.preventDefault();
      const i = q.findIndex(s => s.id === scene.selectedId);
      const next = e.shiftKey ? (i <= 0 ? q.length - 1 : i - 1) : (i + 1) % q.length;
      scene.select(q[next].id);
      return;
    }
    const n = Number(e.key);
    if (n >= 1 && n <= 9) {
      const s = panel.sorted()[n - 1];
      if (s) scene.select(s.id);
    }
  });

  (window as any).__kancl = { client, scene, panel, attention };

  const params = new URLSearchParams(location.search);
  if (params.has('demo')) client.startDemo();
  else client.connect();
}

boot().catch(err => {
  console.error(err);
  document.body.innerHTML = `<pre style="color:#f2544f;padding:20px">${String(err?.stack ?? err)}</pre>`;
});
