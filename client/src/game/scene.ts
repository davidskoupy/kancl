import { Application, Container, Graphics, Sprite, Texture } from 'pixi.js';
import type { Session, Project } from '../../../shared/types.ts';
import { Px, labelTexture, drawText } from './pixel.ts';
import { deskSprite, coffeeMachineSprite, plantSprite, USER_LOOK, type ObjectSprite } from './sprites.ts';
import {
  tileTexture, workstationSprite, officeChairSprite, screenSprite, windowSprite, bookshelfSprite, executiveChairSprite,
  waterCoolerSprite, fridgeSprite, sofaSprite, roundTableSprite, printerSprite, clockSprite, posterSprite, cabinetSprite,
  nameplateSprite, type ScreenKind,
} from './office.ts';
import { W, H, TILE, COLS, ROWS, groundMap, USER_POS, workstations, ZONES, deskCell, type Slot } from './world.ts';
import { Actor, Agent } from './agent.ts';
import { planIslands, planKey, type Island } from '../../../shared/plan.ts';
import { plainAscii } from '../../../shared/names.ts';

interface AnimatedObject { sprite: Sprite; frames: Texture[]; fps: number; t: number; i: number }

export interface SceneEvents {
  onSelect: (session: Session | null) => void;
  onActivate: (session: Session) => void;
  onHover: (session: Session | null) => void;
}

export class Scene {
  app = new Application();
  world = new Container();
  ground = new Container();
  islands = new Container();
  objects = new Container();
  private projects: Project[] = [];
  private lastPlanKey = '__none__';
  private islandPlan: Island[] = [];
  agents = new Map<string, Agent>();
  animated: AnimatedObject[] = [];
  screens = new Map<string, { sprite: Sprite; kind: ScreenKind; anim: AnimatedObject }>();
  user!: Actor;
  scale = 2;
  selectedId: string | null = null;
  hoveredId: string | null = null;

  constructor(private host: HTMLElement, private events: SceneEvents) {}

  async init() {
    await this.app.init({
      width: W * this.scale, height: H * this.scale,
      background: '#0f1218', antialias: false, resolution: 1, autoDensity: false,
      roundPixels: true, preference: 'webgl',
    });
    this.host.appendChild(this.app.canvas);
    this.app.stage.addChild(this.world);
    this.world.addChild(this.ground, this.islands, this.objects);
    this.objects.sortableChildren = true;

    this.buildGround();
    this.buildObjects();
    this.buildUser();
    this.setScale(this.scale);

    this.app.stage.eventMode = 'static';
    this.app.stage.hitArea = this.app.screen;
    this.app.stage.on('pointertap', e => { if (e.target === this.app.stage) this.select(null); });

    // Drive the simulation from real elapsed time. Browsers pause requestAnimationFrame in
    // background tabs, so a coarse interval keeps the crew moving while you are elsewhere.
    this.app.ticker.add(() => this.step());
    window.setInterval(() => { if (document.hidden) this.step(); }, 500);
  }

  private lastStep = performance.now();
  private step() {
    const now = performance.now();
    const dt = Math.min((now - this.lastStep) / 1000, document.hidden ? 2 : 0.1);
    this.lastStep = now;
    this.update(dt);
  }

  setScale(s: number) {
    this.scale = Math.max(1, Math.min(6, Math.round(s)));
    this.world.scale.set(this.scale);
    this.app.renderer.resize(W * this.scale, H * this.scale);
    this.app.stage.hitArea = this.app.screen;
  }

  fitToHost(availW: number, availH: number) {
    this.setScale(Math.max(1, Math.floor(Math.min(availW / W, availH / H))));
  }

  private buildGround() {
    const map = groundMap();
    const px = new Px(W, H);
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const tex = tileTexture(map[r][c], (r * 31 + c * 17) % 4);
        px.ctx.drawImage(tex.source.resource as HTMLCanvasElement, c * TILE, r * TILE);
      }
    }
    drawText(px, 20, 134, 'TVUJ KANCL', 'rgba(0,0,0,0.25)');
    drawText(px, 20, 262, 'KUCHYNKA', 'rgba(0,0,0,0.2)');
    this.ground.addChild(new Sprite(px.texture()));
  }

  private place(obj: ObjectSprite, x: number, bottomY: number, zBias = 0) {
    const sp = new Sprite(obj.frames[0]);
    sp.anchor.set(0, 1);
    sp.position.set(x, bottomY);
    sp.zIndex = bottomY + zBias;
    this.objects.addChild(sp);
    let anim: AnimatedObject | undefined;
    if (obj.frames.length > 1) {
      anim = { sprite: sp, frames: obj.frames, fps: obj.fps ?? 4, t: Math.random(), i: 0 };
      this.animated.push(anim);
    }
    return { sprite: sp, anim };
  }

  private buildObjects() {
    // top wall decorations
    for (const x of [40, 96]) this.place(windowSprite(), x, 30, -100);
    for (const x of [208, 272, 336, 400]) this.place(windowSprite(), x, 30, -100);
    this.place(posterSprite(0), 248, 28, -100); this.place(posterSprite(1), 312, 28, -100); this.place(posterSprite(2), 376, 28, -100);
    this.place(clockSprite(), 444, 26, -100);
    this.place(nameplateSprite(), 22, 42, -100);

    // your office
    this.place(bookshelfSprite(), 112, 60); this.place(cabinetSprite(), 20, 58); this.place(plantSprite(1), 146, 58);
    this.place(executiveChairSprite(), 54, 92, -20);
    this.place(deskSprite(), 48, 112);
    this.place(plantSprite(0), 20, 140);

    // kitchen
    this.place(coffeeMachineSprite(), 24, 200); this.place(waterCoolerSprite(), 52, 200); this.place(fridgeSprite(), 100, 200);
    this.place(plantSprite(1), 146, 178);
    this.place(sofaSprite(), 22, 266); this.place(roundTableSprite(), 66, 258);

    // open space
    for (const ws of workstations()) {
      this.place(officeChairSprite(), ws.chair.x, ws.chair.y);
      this.place(workstationSprite(), ws.deskBottom.x, ws.deskBottom.y);
    }
    for (const slot of ZONES.desks.slots) {
      const scr = this.place(screenSprite('off'), slot.screen!.x, slot.screen!.y + 10, 200);
      this.screens.set(slot.id, { sprite: scr.sprite, kind: 'off', anim: scr.anim ?? { sprite: scr.sprite, frames: screenSprite('off').frames, fps: 1, t: 0, i: 0 } });
    }
    this.place(printerSprite(), 408, 270); this.place(plantSprite(0), 446, 270); this.place(plantSprite(1), 196, 270);

  }

  private buildUser() {
    this.user = new Actor(USER_LOOK);
    this.user.position.set(USER_POS.x, USER_POS.y);
    this.user.zIndex = USER_POS.y;
    this.user.play('type', 'down');
    const label = new Sprite(labelTexture('TY', { color: '#f5c542' }));
    label.anchor.set(0.5, 1); label.y = -26;
    this.user.addChild(label);
    this.objects.addChild(this.user);
  }

  // ---- projekty / ostrůvky ---------------------------------------------
  setProjects(projects: Project[]) { this.projects = projects; this.replan(); }

  private sessionsByProject(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const a of this.agents.values()) {
      const id = a.session.projectId;
      if (id) out[id] = (out[id] ?? 0) + 1;
    }
    return out;
  }

  /** Aktivní projekty v pořadí, v jakém „přišly do práce" — ostrůvky se tak nepřeskládávají při každém dotazu. */
  private activeOrder: string[] = [];
  private orderedProjects(): Project[] {
    const byId = new Map(this.projects.map(p => [p.id, p]));
    const active = new Set(this.projects.filter(p => p.status !== 'klid').map(p => p.id));
    this.activeOrder = this.activeOrder.filter(id => active.has(id));
    for (const p of this.projects) if (active.has(p.id) && !this.activeOrder.includes(p.id)) this.activeOrder.push(p.id);
    return [...this.activeOrder.map(id => byId.get(id)!), ...this.projects.filter(p => p.status === 'klid')];
  }

  private lastDrawKey = '';
  private replan() {
    const counts = this.sessionsByProject();
    const ordered = this.orderedProjects();
    const key = planKey(ordered, counts);
    const klidIds = ordered.filter(p => p.status === 'klid').map(p => p.id).join(',');
    const drawKey = `${key}#${klidIds}#${ordered.map(p => p.status).join(',')}#${ordered.map(p => p.name).join(',')}`;
    if (drawKey === this.lastDrawKey) return;
    this.lastDrawKey = drawKey;
    this.islandPlan = planIslands(ordered, counts, ZONES.desks.slots.length);
    this.drawIslands();
    if (key === this.lastPlanKey) return;
    this.lastPlanKey = key;
    const byProject = new Map(this.islandPlan.map(i => [i.projectId, i.desks]));
    for (const a of this.agents.values()) a.setIsland(a.session.projectId ? byProject.get(a.session.projectId) ?? null : null);
  }

  private drawIslands() {
    for (const c of this.islands.removeChildren()) c.destroy({ children: true });
    const COLORS = { prace: 0x3fb8b8, dotaz: 0xf5c542, klid: 0x6f7890 } as const;
    const names = new Map(this.projects.map(p => [p.id, p.name]));
    for (const isl of this.islandPlan) {
      const color = COLORS[isl.status];
      const alpha = isl.status === 'klid' ? 0.35 : 1;
      const g = new Graphics();
      const rows = new Map<number, number[]>();
      for (const d of isl.desks) { const r = Math.floor(d / 4); rows.set(r, [...(rows.get(r) ?? []), d]); }
      let first: { x: number; y: number } | undefined;
      for (const desks of rows.values()) {
        const a = deskCell(desks[0]), b = deskCell(desks[desks.length - 1]);
        const x = a.x, y = a.y, w = b.x + b.w - a.x, h = a.h;
        g.rect(x, y, w, h).fill({ color, alpha: 0.12 * alpha }).stroke({ color, width: 1, alpha: 0.8 * alpha });
        if (!first) first = { x, y };
      }
      this.islands.addChild(g);
      const hex = `#${color.toString(16).padStart(6, '0')}`;
      const label = new Sprite(labelTexture(plainAscii(names.get(isl.projectId) ?? isl.projectId).slice(0, 14), { color: hex }));
      label.anchor.set(0, 0);
      label.position.set(first!.x + 2, first!.y + 1);   // uvnitř rámečku, aby ji nezakryla zeď s okny
      label.alpha = alpha;
      this.islands.addChild(label);
    }
  }

  // ---- sessions ----------------------------------------------------------
  upsert(session: Session) {
    let a = this.agents.get(session.id);
    if (!a) {
      a = new Agent(session, {
        onTap: ag => this.select(ag.session.id),
        onHover: ag => { this.hover(ag?.session.id ?? null); },
      });
      const agent = a;
      this.agents.set(session.id, agent);
      this.objects.addChild(agent);
      this.replan();
      const pid = agent.session.projectId;
      if (pid) agent.setIsland(this.islandPlan.find(i => i.projectId === pid)?.desks ?? null);
    } else {
      a.apply(session);
      this.replan();
    }
    if (this.selectedId === session.id || this.hoveredId === session.id) a.setHighlight(true);
  }

  remove(id: string) {
    const a = this.agents.get(id);
    if (!a) return;
    a.leave();
    this.agents.delete(id);
    this.replan();
    if (this.selectedId === id) this.select(null);
  }

  select(id: string | null) {
    if (this.selectedId && this.selectedId !== this.hoveredId) this.agents.get(this.selectedId)?.setHighlight(false);
    this.selectedId = id;
    if (id) this.agents.get(id)?.setHighlight(true);
    this.events.onSelect(id ? this.agents.get(id)?.session ?? null : null);
  }

  hover(id: string | null) {
    if (this.hoveredId && this.hoveredId !== this.selectedId) this.agents.get(this.hoveredId)?.setHighlight(false);
    this.hoveredId = id;
    if (id) this.agents.get(id)?.setHighlight(true);
    this.events.onHover(id ? this.agents.get(id)?.session ?? null : null);
  }

  private screenKindFor(slot: Slot): ScreenKind {
    const owner = slot.takenBy ? [...this.agents.values()].find(a => a.session.id === slot.takenBy) : undefined;
    if (!owner || owner.slot !== slot || !owner.arrived) return 'off';
    const s = owner.session;
    if (s.status === 'error') return 'error';
    if (s.status === 'working') return s.activity;
    return 'idle';
  }

  private updateScreens() {
    for (const slot of ZONES.desks.slots) {
      const scr = this.screens.get(slot.id)!;
      const kind = this.screenKindFor(slot);
      if (kind !== scr.kind) {
        scr.kind = kind;
        const obj = screenSprite(kind);
        scr.anim.frames = obj.frames; scr.anim.fps = obj.fps ?? 1; scr.anim.i = 0; scr.anim.t = 0;
        scr.sprite.texture = obj.frames[0];
        if (!this.animated.includes(scr.anim)) this.animated.push(scr.anim);
      }
    }
  }

  private reconsiderTimer = 0;
  private screenTimer = 0;

  private update(dt: number) {
    for (const o of this.animated) {
      o.t += dt;
      if (o.t >= 1 / o.fps) { o.t = 0; o.i = (o.i + 1) % o.frames.length; o.sprite.texture = o.frames[o.i]; }
    }
    this.user.tick(dt);
    this.reconsiderTimer += dt;
    const reconsider = this.reconsiderTimer > 5;
    if (reconsider) this.reconsiderTimer = 0;
    for (const child of [...this.objects.children]) {
      if (child instanceof Agent) {
        child.tick(dt);
        if (reconsider && !child.removed) child.reconsider();
        if (child.removed) { this.objects.removeChild(child); child.destroy({ children: true }); }
      }
    }
    this.screenTimer += dt;
    if (this.screenTimer > 0.25) { this.screenTimer = 0; this.updateScreens(); }
  }
}
