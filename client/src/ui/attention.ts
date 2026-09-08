import type { Session, SessionStatus } from '../../../shared/types.ts';
import { renderPose, lookFor, type Pose } from '../game/sprites.ts';

/**
 * Everything that reaches you when the tab is not in front:
 * tab title (with a counter and blinking), favicon badge, system notifications, optional sound.
 */

const BASE_TITLE = 'Kancl';
const PRIORITY: SessionStatus[] = ['permission', 'error', 'waiting', 'completed'];
const ICON: Record<string, string> = { permission: '❓', error: '❗', waiting: '💬', completed: '✅' };
const COLOR: Record<string, string> = { permission: '#f5c542', error: '#f2544f', waiting: '#b48cf2', completed: '#4fd18b' };

export interface AttentionEvents {
  onOpen: (id: string) => void;   // user clicked a notification
}

export class Attention {
  private sessions = new Map<string, Session>();
  private prevStatus = new Map<string, SessionStatus>();
  private blinkTimer?: number;
  private blinkOn = false;
  private currentTitle = BASE_TITLE;
  private link: HTMLLinkElement;
  private baseIcon: HTMLCanvasElement;
  private lastBadge = '';
  private audio?: AudioContext;
  notify = localStorage.getItem('kancl.notify') === '1';
  sound = localStorage.getItem('kancl.sound') === '1';

  constructor(private events: AttentionEvents) {
    this.link = document.querySelector('link[rel="icon"]') ?? document.createElement('link');
    this.link.rel = 'icon';
    document.head.appendChild(this.link);
    const pose: Pose = { legs: 'stand', bob: 0, armL: 'down', armR: 'down' };
    this.baseIcon = renderPose(lookFor(0, 12345), 'down', pose).canvas;
    this.drawFavicon(null, 0);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.stopBlink(); this.apply(); });
  }

  // ---- toggles ----------------------------------------------------------
  async setNotify(on: boolean): Promise<boolean> {
    if (on && 'Notification' in window && Notification.permission !== 'granted') {
      const res = await Notification.requestPermission();
      if (res !== 'granted') on = false;
    }
    if (!('Notification' in window)) on = false;
    this.notify = on;
    localStorage.setItem('kancl.notify', on ? '1' : '0');
    return on;
  }

  setSound(on: boolean) {
    this.sound = on;
    localStorage.setItem('kancl.sound', on ? '1' : '0');
    if (on) this.beep('permission'); // audible confirmation, also unlocks the AudioContext
  }

  // ---- state ------------------------------------------------------------
  upsert(s: Session) {
    const prev = this.prevStatus.get(s.id);
    this.sessions.set(s.id, s);
    this.prevStatus.set(s.id, s.status);
    if (prev !== s.status && (s.status === 'permission' || s.status === 'error' || s.status === 'waiting' || s.status === 'completed')) {
      this.alert(s);
    }
    this.apply();
  }

  remove(id: string) {
    this.sessions.delete(id);
    this.prevStatus.delete(id);
    this.apply();
  }

  // ---- title + favicon --------------------------------------------------
  private groups() {
    const g: Record<string, Session[]> = { permission: [], error: [], waiting: [], completed: [] };
    for (const s of this.sessions.values()) if (g[s.status]) g[s.status].push(s);
    return g;
  }

  private apply() {
    const g = this.groups();
    const total = PRIORITY.reduce((n, k) => n + g[k].length, 0);
    const top = PRIORITY.find(k => g[k].length > 0) ?? null;

    if (!top) {
      this.currentTitle = BASE_TITLE;
      this.stopBlink();
      this.setTitle(this.currentTitle);
      this.drawFavicon(null, 0);
      return;
    }

    const kinds = PRIORITY.filter(k => g[k].length > 0);
    let body: string;
    if (kinds.length === 1) {
      const list = g[top];
      if (list.length === 1) {
        const s = list[0];
        const detail = s.message ?? (s.status === 'completed' ? 'finished' : '');
        body = `${ICON[top]} ${s.name}${detail ? ' · ' + short(detail, 40) : ''}`;
      } else {
        const names = list.slice(0, 2).map(s => s.name).join(', ');
        const more = list.length > 2 ? ` +${list.length - 2}` : '';
        body = `${ICON[top]} ${names}${more} · ${BASE_TITLE}`;
      }
    } else {
      body = kinds.map(k => `${ICON[k]}${g[k].length}`).join(' ') + ` · ${BASE_TITLE}`;
    }
    this.currentTitle = `(${total}) ${body}`;
    this.setTitle(this.currentTitle);
    this.drawFavicon(top, total);

    if (top === 'permission' && document.hidden) this.startBlink();
    else this.stopBlink();
  }

  private setTitle(t: string) { if (document.title !== t) document.title = t; }

  private startBlink() {
    if (this.blinkTimer) return;
    this.blinkTimer = window.setInterval(() => {
      this.blinkOn = !this.blinkOn;
      this.setTitle(this.blinkOn ? `❓ ${BASE_TITLE}` : this.currentTitle);
    }, 1500);
  }

  private stopBlink() {
    if (this.blinkTimer) { window.clearInterval(this.blinkTimer); this.blinkTimer = undefined; }
    this.blinkOn = false;
    this.setTitle(this.currentTitle);
  }

  private drawFavicon(kind: string | null, count: number) {
    const key = `${kind}/${count}`;
    if (key === this.lastBadge) return;
    this.lastBadge = key;
    const c = document.createElement('canvas');
    c.width = 64; c.height = 64;
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    // character (32x32 sprite, feet at y=28) scaled x2, slightly left so the badge has room
    ctx.drawImage(this.baseIcon, 0, 0, 32, 32, -4, 4, 64, 64);
    if (kind) {
      ctx.fillStyle = COLOR[kind];
      ctx.beginPath(); ctx.arc(46, 18, 16, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = 3; ctx.strokeStyle = '#0f1218'; ctx.stroke();
      ctx.fillStyle = kind === 'permission' || kind === 'completed' ? '#1d1a1f' : '#ffffff';
      ctx.font = 'bold 22px Menlo, monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(count > 9 ? '9+' : String(count), 46, 19);
    }
    this.link.href = c.toDataURL('image/png');
  }

  // ---- notifications + sound -------------------------------------------
  private alert(s: Session) {
    if (this.sound && (s.status === 'permission' || s.status === 'error')) this.beep(s.status);
    if (!this.notify || !('Notification' in window) || Notification.permission !== 'granted') return;
    const titles: Record<string, string> = {
      permission: `${s.name} potřebuje povolení`,
      error: `${s.name} narazil na chybu`,
      waiting: `${s.name} čeká na odpověď`,
      completed: `${s.name} má hotovo`,
    };
    const n = new Notification(titles[s.status], {
      body: `${s.project}${s.message ? ' — ' + short(s.message, 120) : ''}`,
      tag: `kancl-${s.id}`,        // replaces the previous notification for the same session
      silent: true,
    });
    n.onclick = () => { window.focus(); this.events.onOpen(s.id); n.close(); };
  }

  private beep(kind: 'permission' | 'error') {
    try {
      this.audio ??= new AudioContext();
      const ctx = this.audio;
      const notes = kind === 'permission' ? [660, 880] : [440, 330];
      notes.forEach((f, i) => {
        const o = ctx.createOscillator(); const g = ctx.createGain();
        o.type = 'square'; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.12);
        g.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + i * 0.12 + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.12 + 0.11);
        o.connect(g).connect(ctx.destination);
        o.start(ctx.currentTime + i * 0.12); o.stop(ctx.currentTime + i * 0.12 + 0.12);
      });
    } catch { /* no audio available */ }
  }
}

function short(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
