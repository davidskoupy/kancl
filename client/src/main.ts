import { Scene } from './game/scene.ts';
import { CrewClient } from './net.ts';
import { Panel } from './ui/panel.ts';
import { Attention } from './ui/attention.ts';

async function boot() {
  const host = document.getElementById('canvas-host')!;
  const stage = document.getElementById('stage')!;

  let scene: Scene;
  let client: CrewClient;

  const panel = new Panel({
    onSelect: id => scene.select(id),
    onFocus: id => focus(id),
    onDismiss: id => client.dismiss(id),
    onHover: id => scene.hover(id),
    onDemo: () => client.startDemo(),
  });

  scene = new Scene(host, {
    onSelect: s => panel.select(s?.id ?? null),
    onActivate: s => focus(s.id),
    onHover: () => {},
  });
  await scene.init();

  const attention = new Attention({ onOpen: id => { scene.select(id); focus(id); } });
  panel.bindPrefs(
    () => ({ notify: attention.notify, sound: attention.sound }),
    { notify: on => attention.setNotify(on), sound: on => attention.setSound(on) },
  );

  client = new CrewClient({
    onUpsert: s => { scene.upsert(s); panel.upsert(s); attention.upsert(s); },
    onRemove: (id, reason) => { scene.remove(id); panel.remove(id); attention.remove(id); if (reason) panel.showToast(`Session ended (${reason})`); },
    onState: st => panel.setConnection(st),
  });

  async function focus(id: string) {
    const s = client.sessions.get(id);
    if (!s) return;
    panel.showToast(`Opening ${s.name}'s terminal…`);
    try {
      const r = await client.focus(id);
      panel.showToast(r);
    } catch (e) {
      panel.showToast('Could not reach the server');
    }
  }

  // zoom controls
  const zoomLabel = document.getElementById('zoom-label')!;
  let manualScale: number | null = null;
  const fit = () => {
    const r = stage.getBoundingClientRect();
    if (manualScale) scene.setScale(manualScale);
    else scene.fitToHost(r.width - 24, r.height - 70);
    zoomLabel.textContent = `×${scene.scale}`;
  };
  document.getElementById('zoom-in')!.addEventListener('click', () => { manualScale = scene.scale + 1; fit(); });
  document.getElementById('zoom-out')!.addEventListener('click', () => { manualScale = Math.max(1, scene.scale - 1); fit(); });
  document.getElementById('zoom-fit')!.addEventListener('click', () => { manualScale = null; fit(); });
  window.addEventListener('resize', fit);
  fit();

  // keyboard: 1-9 focus the n-th session in the list, Esc deselects
  window.addEventListener('keydown', e => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'Escape') { scene.select(null); return; }
    if (e.key === 'Enter' && scene.selectedId) { focus(scene.selectedId); return; }
    const n = Number(e.key);
    if (n >= 1 && n <= 9) {
      const s = panel.sorted()[n - 1];
      if (s) scene.select(s.id);
    }
  });

  (window as any).__crew = { client, scene, panel, attention };

  const params = new URLSearchParams(location.search);
  if (params.has('demo')) client.startDemo();
  else client.connect();
}

boot().catch(err => {
  console.error(err);
  document.body.innerHTML = `<pre style="color:#f2544f;padding:20px">${String(err?.stack ?? err)}</pre>`;
});
