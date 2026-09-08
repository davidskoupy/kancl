import { Container, Sprite, Graphics } from 'pixi.js';
import type { Session } from '../../../shared/types.ts';
import { hashStr, labelTexture } from './pixel.ts';
import { plainAscii } from '../../../shared/names.ts';
import {
  buildCharacter, bubbleTexture, shadowTexture, lookFor, signSprite, STATUS_COLORS,
  type Anim, type BubbleKind, type CharacterFrames, type Dir, type Look,
} from './sprites.ts';
import {
  ZONES, acquireSlot, releaseSlot, buildRoute, ENTRANCE, EXIT_SLOT, SPINE_X,
  type Pt, type Slot, type ZoneId,
} from './world.ts';

const WALK_SPEED = 40;
const RUN_SPEED = 72;

/** A sprite with the character animation system. Position = feet. */
export class Actor extends Container {
  sprite = new Sprite();
  shadow = new Sprite(shadowTexture());
  frames: CharacterFrames;
  anim: Anim = 'idle';
  dir: Dir = 'down';
  private frameIdx = 0;
  private frameTime = 0;
  animSpeed = 1;

  constructor(public look: Look) {
    super();
    this.frames = buildCharacter(look);
    this.shadow.anchor.set(0.5, 0.5);
    this.sprite.anchor.set(0.5, 28 / 32);
    this.addChild(this.shadow, this.sprite);
    this.refreshFrame();
  }

  play(anim: Anim, dir?: Dir) {
    if (dir && dir !== this.dir) { this.dir = dir; this.frameIdx = 0; }
    if (anim !== this.anim) { this.anim = anim; this.frameIdx = 0; this.frameTime = 0; }
    this.refreshFrame();
  }

  private refreshFrame() {
    const list = this.frames.get(this.anim, this.dir);
    this.sprite.texture = list[this.frameIdx % list.length];
  }

  tick(dt: number) {
    const fps = this.frames.fps(this.anim) * this.animSpeed;
    const list = this.frames.get(this.anim, this.dir);
    if (list.length <= 1) return;
    this.frameTime += dt;
    const step = 1 / fps;
    if (this.frameTime >= step) {
      this.frameTime -= step;
      this.frameIdx = (this.frameIdx + 1) % list.length;
      this.refreshFrame();
    }
  }
}

export interface AgentEvents {
  onTap: (agent: Agent) => void;
  onHover: (agent: Agent | null) => void;
}

export class Agent extends Actor {
  session: Session;
  nameTag = new Sprite();
  bubble = new Sprite();
  sign = new Sprite(signSprite().frames[0]);
  ring = new Graphics();
  /** the slot we are at (or heading to) */
  slot?: Slot;
  private fromSlot: Slot = ENTRANCE;
  private fullPath: Pt[] = [];
  private idx = 0;
  private spineIdx = 0;
  private leaving = false;
  private blinkTimer = 2 + Math.random() * 3;
  private waveTimer = 4 + Math.random() * 6;
  private bubbleBob = Math.random() * Math.PI * 2;
  private lastReconsider = 0;
  removed = false;
  seed: number;
  /** Stoly, u kterých smí sedět (ostrůvek projektu). null = kdekoli. */
  island: number[] | null = null;
  private subs = new Map<string, Actor>();

  constructor(session: Session, private events: AgentEvents) {
    const seed = hashStr(session.id);
    super(lookFor(session.colorIndex, seed));
    this.seed = seed;
    this.session = session;
    this.position.set(ENTRANCE.x, ENTRANCE.y);

    this.nameTag.anchor.set(0.5, 1); this.nameTag.y = -24;
    this.bubble.anchor.set(0.5, 1); this.bubble.y = -36; this.bubble.visible = false;
    this.sign.anchor.set(0, 1); this.sign.position.set(7, 1); this.sign.visible = false;
    this.ring.visible = false;
    this.addChildAt(this.ring, 0);
    this.addChild(this.sign, this.nameTag, this.bubble);

    this.eventMode = 'static';
    this.cursor = 'pointer';
    this.hitArea = { contains: (x: number, y: number) => x >= -9 && x <= 9 && y >= -30 && y <= 3 } as any;
    this.on('pointertap', () => this.events.onTap(this));
    this.on('pointerover', () => this.events.onHover(this));
    this.on('pointerout', () => this.events.onHover(null));

    this.setLabel();
    this.apply(session);
  }

  private setLabel() {
    this.nameTag.texture = labelTexture(plainAscii(this.session.name), { color: '#ffffff' });
  }

  setHighlight(on: boolean) {
    this.ring.visible = on;
    if (on) {
      const c = STATUS_COLORS[this.session.status] ?? STATUS_COLORS.idle;
      this.ring.clear().ellipse(0, 0, 9, 4).stroke({ color: c, width: 1, alpha: 0.9 });
    }
  }

  get moving() { return this.idx < this.fullPath.length; }
  /** seated / standing at the slot, not walking */
  get arrived() { return !this.moving && !!this.slot; }

  private zoneForSession(s: Session): ZoneId {
    switch (s.status) {
      case 'permission':
      case 'completed':
        return 'office';
      case 'waiting':
        return Date.now() - s.statusSince > 2 * 60_000 ? 'kitchen' : 'office';
      default:
        return 'desks';
    }
  }

  /** Called whenever the session changes. */
  apply(s: Session) {
    const prev = this.session;
    this.session = s;
    if (prev.name !== s.name) this.setLabel();
    const zone = this.zoneForSession(s);
    if (!this.slot || this.slot.zone !== zone) {
      this.goTo(acquireSlot(ZONES[zone], s.id, this.seed, zone === 'desks' ? this.island ?? undefined : undefined), this.slot);
    }
    this.refreshBubble();
    this.syncSubagents(s);
  }

  setIsland(desks: number[] | null) {
    const same = (a: number[] | null, b: number[] | null) => a === b || (!!a && !!b && a.length === b.length && a.every((v, i) => v === b[i]));
    if (same(this.island, desks)) return;
    this.island = desks;
    if (this.slot?.zone === 'desks' && desks && !desks.includes(ZONES.desks.slots.indexOf(this.slot))) {
      this.goTo(acquireSlot(ZONES.desks, this.session.id, this.seed, desks), this.slot);
    }
  }

  /** Subagenti = malé postavičky vedle rodiče (děti kontejneru, chodí s ním). */
  private syncSubagents(s: Session) {
    const ids = new Set(s.subagents.map(a => a.id));
    for (const [id, actor] of this.subs) {
      if (!ids.has(id)) { this.removeChild(actor); actor.destroy({ children: true }); this.subs.delete(id); }
    }
    let i = 0;
    for (const sub of s.subagents) {
      let actor = this.subs.get(sub.id);
      if (!actor) {
        actor = new Actor(this.look);
        actor.scale.set(0.5);
        actor.play('type', 'down');
        this.subs.set(sub.id, actor);
        this.addChildAt(actor, 1);
      }
      actor.position.set(12 + i * 8, 2);
      i++;
    }
  }

  /** Time based transitions (waiting long enough → kitchen). */
  reconsider() {
    const zone = this.zoneForSession(this.session);
    if (this.slot && this.slot.zone !== zone && Date.now() - this.lastReconsider > 5000) {
      this.lastReconsider = Date.now();
      this.apply(this.session);
    }
  }

  leave() {
    this.leaving = true;
    this.goTo(EXIT_SLOT, this.slot);
    this.bubble.visible = false;
    this.sign.visible = false;
    this.eventMode = 'none';
  }

  private goTo(target: Slot, previous?: Slot) {
    if (previous && previous !== target) releaseSlot(previous, this.session.id);
    if (!this.moving) {
      const r = buildRoute(this.slot ?? this.fromSlot, target);
      this.fullPath = r.path; this.spineIdx = r.spineIdx;
    } else {
      // re-route mid-walk: go (back) to the corridor point we were using, then on to the new target
      const keep = this.idx <= this.spineIdx
        ? this.fullPath.slice(this.idx, this.spineIdx + 1)
        : this.fullPath.slice(this.spineIdx, this.idx).reverse();
      const spine = keep[keep.length - 1] ?? { x: SPINE_X, y: this.y };
      const targetSpine = target.toSpine[target.toSpine.length - 1];
      const rest: Pt[] = [];
      if (Math.abs(spine.y - targetSpine.y) > 0.5) rest.push({ x: SPINE_X, y: targetSpine.y });
      rest.push(...[...target.toSpine].reverse().slice(1), { x: target.x, y: target.y });
      this.fullPath = [...keep, ...rest];
      this.spineIdx = keep.length - 1 + (rest.length > target.toSpine.length ? 1 : 0);
    }
    this.idx = 0;
    this.fromSlot = this.slot ?? this.fromSlot;
    this.slot = target;
  }

  private refreshBubble() {
    const s = this.session;
    let kind: BubbleKind | null = null;
    switch (s.status) {
      case 'permission': kind = 'q'; break;
      case 'error': kind = 'bang'; break;
      case 'completed': kind = 'check'; break;
      case 'waiting': kind = Date.now() - s.statusSince > 90_000 ? 'zz' : 'dots'; break;
    }
    if (kind) { this.bubble.texture = bubbleTexture(kind); this.bubble.visible = true; }
    else this.bubble.visible = false;
  }

  tick(dt: number) {
    const s = this.session;

    if (this.moving) {
      const target = this.fullPath[this.idx];
      const dx = target.x - this.x, dy = target.y - this.y;
      const dist = Math.hypot(dx, dy);
      const urgent = s.status === 'permission' || s.status === 'error' || this.leaving;
      const speed = urgent ? RUN_SPEED : WALK_SPEED;
      const step = speed * dt;
      if (dist <= step) { this.position.set(target.x, target.y); this.idx++; }
      else { this.x += (dx / dist) * step; this.y += (dy / dist) * step; }
      const dir: Dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
      const anim: Anim = s.status === 'completed' ? 'carry' : urgent ? 'run' : 'walk';
      this.animSpeed = 1;
      this.play(anim, dir);
      this.sign.visible = false;
      if (!this.moving && this.leaving) this.removed = true;
    } else if (this.slot) {
      this.standingBehaviour(dt);
    }

    super.tick(dt);
    for (const a of this.subs.values()) { a.visible = !this.moving; a.tick(dt); }
    this.zIndex = this.y;

    this.bubbleBob += dt * 3;
    this.bubble.y = -36 + Math.round(Math.sin(this.bubbleBob));
    this.bubble.x = this.sign.visible ? -6 : 0;
  }

  private standingBehaviour(dt: number) {
    const s = this.session;
    const slot = this.slot!;
    this.animSpeed = 1;
    this.sign.visible = false;

    if (slot.zone === 'desks') {
      switch (s.status) {
        case 'working':
          if (s.activity === 'think') this.idleWithBlink(dt, 'down');
          else { this.play('type', 'down'); this.animSpeed = s.activity === 'run' ? 1.4 : 1; }
          break;
        case 'error': this.play('shock', 'down'); break;
        default: this.idleWithBlink(dt, 'down');
      }
      return;
    }

    if (slot.zone === 'kitchen') { this.play(slot.anim, 'down'); return; }

    // office
    switch (s.status) {
      case 'permission': this.play('sign', 'down'); this.sign.visible = true; break;
      case 'completed': this.play('hold', 'down'); break;
      case 'waiting':
        this.waveTimer -= dt;
        if (this.waveTimer < 0) {
          this.play('wave', 'down');
          if (this.waveTimer < -1.6) this.waveTimer = 5 + Math.random() * 8;
        } else this.idleWithBlink(dt, 'up');
        break;
      default: this.idleWithBlink(dt, slot.dir);
    }
  }

  private idleWithBlink(dt: number, dir: Dir) {
    this.blinkTimer -= dt;
    if (this.blinkTimer < 0) {
      this.play('blink', dir);
      if (this.blinkTimer < -0.15) this.blinkTimer = 2 + Math.random() * 4;
    } else this.play(dir === 'up' ? 'look' : 'idle', dir);
  }
}
