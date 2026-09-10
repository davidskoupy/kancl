// Kancl — widget pro iPhone (aplikace Scriptable). Čte /api/widget přes Tailscale.
// 1) nainstaluj Scriptable, 2) nový skript, vlož tohle, 3) uprav BASE na adresu Macu v tailnetu,
// 4) přidej widget Scriptable na plochu (střední velikost) a vyber tento skript.
// iOS obnovuje widgety zhruba každých 15 minut; realtime jsou notifikace, ne widget.
const BASE = "http://100.x.y.z:4242";   // ← adresa Macu v Tailscale

const ICON = { permission: "❓", error: "‼️", waiting: "💬", completed: "✅" };
function ago(ms) { const m = Math.max(0, Math.round((Date.now() - ms) / 60000)); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h`; }

let data = null;
try { const r = new Request(BASE + "/api/widget"); r.timeoutInterval = 5; data = await r.loadJSON(); } catch (e) { data = null; }

const w = new ListWidget();
w.backgroundColor = new Color("#0f1218");
w.setPadding(12, 14, 12, 14);
w.url = BASE + "/?mini=1";

const head = w.addText(data ? `Kancl · ${data.sessions.total} sezení · ${data.sessions.working} pracuje` : "Kancl neběží");
head.font = Font.boldSystemFont(12); head.textColor = new Color("#e6e9f0");
w.addSpacer(6);

if (data) {
  if (!data.queue.length) { const t = w.addText("nikdo tě nepotřebuje"); t.font = Font.systemFont(12); t.textColor = new Color("#8b93a7"); }
  for (const q of data.queue.slice(0, 4)) {
    const t = w.addText(`${ICON[q.status] || "•"} ${q.name} · ${ago(q.since)}`);
    t.font = Font.systemFont(12); t.lineLimit = 1;
    t.textColor = new Color(q.status === "permission" ? "#f5c542" : q.status === "error" ? "#f2544f" : "#e6e9f0");
  }
  w.addSpacer(6);
  let night = `🌙 ${data.night.ok} ✓` + (data.night.fail ? ` · ${data.night.fail} ✗` : "") + (data.ci.length ? ` · CI ✗ ${data.ci.length}` : "");
  const n = w.addText(night); n.font = Font.systemFont(11); n.textColor = new Color(data.night.fail || data.ci.length ? "#f2544f" : "#8b93a7");
  const alarm = data.stock.filter(s => s.alarm);
  if (alarm.length) { const a = w.addText("📚 " + alarm.map(s => `${s.project} ${s.pending}`).join(", ")); a.font = Font.systemFont(11); a.textColor = new Color("#f5c542"); }
}
w.addSpacer();
const f = w.addText(data ? `aktualizace ${new Date().toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" })}` : BASE);
f.font = Font.systemFont(9); f.textColor = new Color("#6f7890");

Script.setWidget(w);
if (config.runsInApp) w.presentMedium();
Script.complete();
