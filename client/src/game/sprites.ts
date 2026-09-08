import { Texture } from 'pixi.js';
import { Px, rng } from './pixel.ts';

// ---------------------------------------------------------------------------
// Looks / palettes
// ---------------------------------------------------------------------------
export interface Look {
  skin: string; skinDark: string;
  hair: string;
  shirt: string; shirtDark: string;
  pants: string; shoes: string;
  hairStyle: number;   // 0 short, 1 long, 2 spiky
  glasses?: boolean;
  headset?: boolean;
}

const SHIRTS = ['#4f9be8', '#f2544f', '#f5c542', '#4fd18b', '#b48cf2', '#ff8c42', '#3dd6d0', '#e85d9a', '#9bd14f', '#c9a06a'];
const SHIRTS_DARK = ['#2f6fb5', '#b8322e', '#c4962a', '#2f9c62', '#8a5fd0', '#c9642a', '#22a39e', '#b93a72', '#6f9b32', '#9a7548'];
const HAIRS = ['#2b1d0e', '#5b3a1e', '#c9781f', '#e8d16a', '#1a1a1a', '#8a2f1a', '#d9d9d9', '#3b2a5c', '#6b4a2a', '#b04a3a'];
const SKINS: [string, string][] = [['#f2c9a0', '#d9a878'], ['#e0ac7c', '#c48c5c'], ['#c68b5a', '#a06c42'], ['#8d5a3b', '#6b4029']];
const PANTS = ['#2e3b6e', '#3a3a3a', '#5a4638', '#2a4a3a'];

export function lookFor(colorIndex: number, seed: number): Look {
  const i = ((colorIndex % SHIRTS.length) + SHIRTS.length) % SHIRTS.length;
  const [skin, skinDark] = SKINS[(seed >>> 3) % SKINS.length];
  return {
    skin, skinDark,
    hair: HAIRS[(i * 3 + (seed >>> 7)) % HAIRS.length],
    shirt: SHIRTS[i], shirtDark: SHIRTS_DARK[i],
    pants: PANTS[(seed >>> 5) % PANTS.length],
    shoes: '#26221f',
    hairStyle: (seed >>> 9) % 3,
  };
}

export const USER_LOOK: Look = {
  skin: '#f2c9a0', skinDark: '#d9a878', hair: '#3b2a1a',
  shirt: '#2f3f5c', shirtDark: '#1f2b40', pants: '#2b2b2b', shoes: '#26221f',
  hairStyle: 0, glasses: true, headset: true,
};

export const STATUS_COLORS = {
  working: '#4f9be8', permission: '#f5c542', waiting: '#b48cf2',
  completed: '#4fd18b', error: '#f2544f', idle: '#8b93a7',
};

// ---------------------------------------------------------------------------
// Character poses
// ---------------------------------------------------------------------------
export type Dir = 'down' | 'up' | 'left' | 'right';
export type Arm = 'down' | 'fwd' | 'back' | 'up' | 'out' | 'wave';
export type Item =
  | 'axe-up' | 'axe-swing' | 'hammer-up' | 'hammer-down' | 'bar-high' | 'bar-low'
  | 'folder' | 'cup' | 'cup-up' | 'sign' | 'chips';

export interface Pose {
  legs: 'stand' | 'l' | 'r';
  bob: number;
  armL: Arm;
  armR: Arm;
  item?: Item;
  eyes?: 'open' | 'closed' | 'wide';
  mouth?: boolean;
  sweat?: boolean;
}

const P = (legs: Pose['legs'], bob: number, armL: Arm, armR: Arm, extra: Partial<Pose> = {}): Pose =>
  ({ legs, bob, armL, armR, ...extra });

export type Anim =
  | 'idle' | 'walk' | 'run' | 'chop' | 'hammer' | 'lift' | 'carry' | 'shock'
  | 'wave' | 'coffee' | 'type' | 'blink' | 'sign' | 'look' | 'hold';

/** Frame lists per animation. Directions that are not listed fall back to 'down'. */
export const ANIMS: Record<Anim, { fps: number; frames: Pose[]; dirs?: Dir[]; loop?: boolean }> = {
  idle:   { fps: 1, frames: [P('stand', 0, 'down', 'down')] },
  blink:  { fps: 6, frames: [P('stand', 0, 'down', 'down', { eyes: 'closed' })] },
  walk:   { fps: 8, frames: [P('stand', 0, 'down', 'down'), P('l', -1, 'fwd', 'back'), P('stand', 0, 'down', 'down'), P('r', -1, 'back', 'fwd')] },
  run:    { fps: 14, frames: [P('stand', 0, 'fwd', 'back', { sweat: true }), P('l', -1, 'fwd', 'back'), P('stand', 0, 'back', 'fwd', { sweat: true }), P('r', -1, 'back', 'fwd')] },
  chop:   { fps: 3, frames: [P('stand', 0, 'up', 'down', { item: 'axe-up' }), P('stand', 0, 'up', 'down', { item: 'axe-up' }), P('stand', 0, 'out', 'down', { item: 'axe-swing' }), P('stand', 0, 'out', 'down', { item: 'chips' })], dirs: ['left', 'right'] },
  hammer: { fps: 4, frames: [P('stand', 0, 'out', 'up', { item: 'hammer-up' }), P('stand', 0, 'out', 'up', { item: 'hammer-up' }), P('stand', 1, 'out', 'out', { item: 'hammer-down' })], dirs: ['down', 'up'] },
  lift:   { fps: 2, frames: [P('stand', 0, 'out', 'out', { item: 'bar-low' }), P('stand', 0, 'up', 'up', { item: 'bar-high', sweat: true })], dirs: ['down'] },
  hold:   { fps: 1, frames: [P('stand', 0, 'out', 'out', { item: 'folder' })] },
  carry:  { fps: 10, frames: [P('stand', 0, 'out', 'out', { item: 'folder' }), P('l', -1, 'out', 'out', { item: 'folder' }), P('stand', 0, 'out', 'out', { item: 'folder' }), P('r', -1, 'out', 'out', { item: 'folder' })] },
  shock:  { fps: 4, frames: [P('stand', 0, 'up', 'up', { eyes: 'wide', mouth: true }), P('stand', -1, 'up', 'up', { eyes: 'wide', mouth: true })], dirs: ['down'] },
  wave:   { fps: 4, frames: [P('stand', 0, 'down', 'up'), P('stand', 0, 'down', 'wave')], dirs: ['down'] },
  coffee: { fps: 1, frames: [P('stand', 0, 'down', 'out', { item: 'cup' }), P('stand', 0, 'down', 'out', { item: 'cup' }), P('stand', 0, 'down', 'up', { item: 'cup-up', eyes: 'closed' })], dirs: ['down'] },
  type:   { fps: 6, frames: [P('stand', 0, 'out', 'out'), P('stand', 0, 'out', 'back'), P('stand', 0, 'out', 'out'), P('stand', 0, 'back', 'out')], dirs: ['down'] },
  sign:   { fps: 1, frames: [P('stand', 0, 'down', 'out', { item: 'sign' })], dirs: ['down'] },
  look:   { fps: 1, frames: [P('stand', 0, 'down', 'down')], dirs: ['up'] },
};

// ---------------------------------------------------------------------------
// Character renderer (32x32, feet at y=28, centred at x=16)
// ---------------------------------------------------------------------------
const AXE_WOOD = '#8a5a2b', METAL = '#b8c0cc', METAL_DARK = '#6e7784', FOLDER = '#3fbf6f', FOLDER_DARK = '#2a8f50';
const EYE = '#1d1a1f';

function drawHairDown(px: Px, look: Look, y: number, style: number, back: boolean) {
  const c = look.hair;
  px.rect(12, y + 8, 8, 3, c);              // top
  px.rect(13, y + 7, 6, 1, c);              // rounded top
  if (style === 2) { px.set(13, y + 6, c); px.set(15, y + 6, c); px.set(18, y + 6, c); }
  if (back) { px.rect(12, y + 11, 8, 2, c); }
  if (style === 1) { px.rect(12, y + 11, 1, 5, c); px.rect(19, y + 11, 1, 5, c); if (back) px.rect(12, y + 13, 8, 3, c); }
  else { px.set(12, y + 11, c); px.set(19, y + 11, c); }
}

function drawFaceDown(px: Px, look: Look, y: number, pose: Pose) {
  const eyes = pose.eyes ?? 'open';
  if (eyes === 'closed') { px.set(14, y + 13, look.skinDark); px.set(17, y + 13, look.skinDark); }
  else if (eyes === 'wide') { px.rect(14, y + 12, 1, 2, EYE); px.rect(17, y + 12, 1, 2, EYE); }
  else { px.set(14, y + 13, EYE); px.set(17, y + 13, EYE); }
  if (pose.mouth) px.rect(15, y + 15, 2, 1, '#7a3a3a');
  if (look.glasses) {
    px.rect(13, y + 13, 3, 1, '#2a2a2a'); px.rect(16, y + 13, 3, 1, '#2a2a2a');
    if (eyes !== 'closed') { px.set(14, y + 13, '#9fd3ff'); px.set(17, y + 13, '#9fd3ff'); }
  }
  if (look.headset) {
    px.rect(12, y + 9, 8, 1, '#222'); px.rect(11, y + 11, 1, 3, '#222'); px.rect(20, y + 11, 1, 3, '#222');
    px.rect(11, y + 14, 3, 1, '#333');
  }
}

function drawArmFront(px: Px, look: Look, x: number, y: number, arm: Arm, side: 'L' | 'R') {
  // x is the arm column (11 or 20)
  const inner = side === 'L' ? 13 : 18; // hand position when holding in front
  switch (arm) {
    case 'down': px.rect(x, y + 16, 1, 3, look.shirtDark); px.rect(x, y + 19, 1, 2, look.skin); break;
    case 'fwd':  px.rect(x, y + 16, 1, 2, look.shirtDark); px.rect(x, y + 18, 1, 2, look.skin); break;
    case 'back': px.rect(x, y + 16, 1, 3, look.shirtDark); px.rect(x, y + 20, 1, 2, look.skin); break;
    case 'up':   px.rect(x, y + 12, 1, 4, look.shirtDark); px.rect(x, y + 8, 1, 4, look.skin); break;
    case 'wave': px.rect(x, y + 12, 1, 4, look.shirtDark); px.rect(x, y + 9, 1, 3, look.skin); px.set(x + (side === 'R' ? 1 : -1), y + 8, look.skin); break;
    case 'out':  px.rect(x, y + 16, 1, 3, look.shirtDark); px.rect(inner, y + 19, 2, 2, look.skin); break;
  }
}

function drawLegs(px: Px, look: Look, legs: Pose['legs'], view: 'front' | 'side') {
  if (view === 'front') {
    px.rect(12, 22, 8, 1, look.pants);
    const leg = (x: number, lifted: boolean) => {
      px.rect(x, 22, 3, lifted ? 3 : 4, look.pants);
      px.rect(x, lifted ? 25 : 26, 3, 2, look.shoes);
    };
    leg(12, legs === 'l');
    leg(17, legs === 'r');
  } else {
    if (legs === 'stand') {
      px.rect(14, 22, 4, 4, look.pants);
      px.rect(13, 26, 5, 2, look.shoes);
    } else {
      const frontLifted = legs === 'r';
      px.rect(12, 22, 3, frontLifted ? 3 : 4, look.pants);
      px.rect(11, frontLifted ? 25 : 26, 4, 2, look.shoes);
      px.rect(16, 22, 3, frontLifted ? 4 : 3, look.pants);
      px.rect(16, frontLifted ? 26 : 25, 3, 2, look.shoes);
    }
  }
}

function drawItemFront(px: Px, look: Look, y: number, item: Item | undefined) {
  switch (item) {
    case 'hammer-up':
      px.rect(20, y + 4, 1, 4, AXE_WOOD); px.rect(18, y + 2, 5, 2, METAL_DARK); px.rect(18, y + 2, 5, 1, METAL); break;
    case 'hammer-down':
      px.rect(20, y + 21, 1, 3, AXE_WOOD); px.rect(18, y + 24, 5, 2, METAL_DARK); px.rect(18, y + 24, 5, 1, METAL); break;
    case 'bar-high':
      px.rect(9, y + 7, 14, 1, METAL); px.rect(7, y + 5, 3, 5, METAL_DARK); px.rect(22, y + 5, 3, 5, METAL_DARK);
      px.rect(11, y + 8, 1, 1, look.skin); px.rect(20, y + 8, 1, 1, look.skin); break;
    case 'bar-low':
      px.rect(9, y + 18, 14, 1, METAL); px.rect(7, y + 16, 3, 5, METAL_DARK); px.rect(22, y + 16, 3, 5, METAL_DARK); break;
    case 'folder':
      px.rect(12, y + 16, 4, 1, FOLDER_DARK); px.rect(12, y + 17, 8, 6, FOLDER); px.rect(13, y + 19, 6, 1, FOLDER_DARK);
      px.rect(14, y + 18, 4, 1, '#ffffff'); px.rect(12, y + 21, 2, 2, look.skin); px.rect(18, y + 21, 2, 2, look.skin); break;
    case 'cup':
      px.rect(18, y + 17, 3, 3, '#f4f1ea'); px.rect(18, y + 17, 3, 1, '#6b3f23'); px.set(21, y + 18, '#f4f1ea'); break;
    case 'cup-up':
      px.rect(20, y + 11, 3, 3, '#f4f1ea'); px.rect(20, y + 11, 3, 1, '#6b3f23'); px.set(23, y + 12, '#f4f1ea');
      px.rect(20, y + 14, 1, 2, look.skin); break;
    case 'sign':
      px.rect(23, y + 12, 1, 12, AXE_WOOD); px.rect(20, y + 5, 8, 7, '#f5c542'); px.frame(20, y + 5, 8, 7, '#8a6a1a');
      px.pic(22, y + 6, ['###.', '..#.', '.#..', '....', '.#..'], { '#': '#2b1d0e' }); px.rect(19, y + 21, 2, 2, look.skin); break;
  }
}

function drawSideItem(px: Px, look: Look, y: number, item: Item | undefined) {
  // facing LEFT
  switch (item) {
    case 'axe-up':
      px.rect(14, y + 2, 1, 7, AXE_WOOD); px.rect(11, y + 2, 3, 3, METAL); px.rect(11, y + 4, 3, 1, METAL_DARK); px.set(11, y + 5, METAL_DARK); break;
    case 'axe-swing':
      px.rect(5, y + 18, 5, 1, AXE_WOOD); px.rect(3, y + 16, 2, 5, METAL); px.rect(3, y + 20, 2, 1, METAL_DARK); break;
    case 'chips':
      px.rect(5, y + 18, 5, 1, AXE_WOOD); px.rect(3, y + 16, 2, 5, METAL); px.rect(3, y + 20, 2, 1, METAL_DARK);
      px.set(1, y + 14, '#d9b07c'); px.set(2, y + 22, '#d9b07c'); px.set(0, y + 19, '#d9b07c'); break;
  }
}

function renderFront(px: Px, look: Look, pose: Pose, dir: 'down' | 'up') {
  const y = pose.bob;
  // back arm poses that go above the body get drawn first (behind head)
  drawLegs(px, look, pose.legs, 'front');
  // body
  px.rect(12, y + 16, 8, 6, look.shirt);
  px.rect(12, y + 21, 8, 1, look.shirtDark);
  // head
  px.rect(12, y + 8, 8, 8, look.skin);
  px.rect(14, y + 16, 4, 1, look.skinDark); // neck shadow
  if (dir === 'down') {
    drawHairDown(px, look, y, look.hairStyle, false);
    drawFaceDown(px, look, y, pose);
  } else {
    drawHairDown(px, look, y, look.hairStyle, true);
    if (look.headset) px.rect(12, y + 9, 8, 1, '#222');
  }
  drawArmFront(px, look, 11, y, pose.armL, 'L');
  drawArmFront(px, look, 20, y, pose.armR, 'R');
  drawItemFront(px, look, y, pose.item);
  if (pose.sweat) { px.set(21, y + 10, '#8fd3ff'); px.set(21, y + 11, '#8fd3ff'); }
}

function renderSide(px: Px, look: Look, pose: Pose) {
  // faces LEFT; 'right' is produced by mirroring the texture
  const y = pose.bob;
  drawLegs(px, look, pose.legs, 'side');
  px.rect(13, y + 16, 6, 6, look.shirt);
  px.rect(13, y + 21, 6, 1, look.shirtDark);
  // head
  px.rect(13, y + 8, 6, 8, look.skin);
  const c = look.hair;
  px.rect(13, y + 8, 6, 3, c); px.rect(14, y + 7, 4, 1, c);
  px.rect(17, y + 11, 2, look.hairStyle === 1 ? 5 : 3, c);
  if (look.hairStyle === 2) { px.set(14, y + 6, c); px.set(17, y + 6, c); }
  // face
  if ((pose.eyes ?? 'open') === 'closed') px.set(14, y + 13, look.skinDark);
  else px.set(14, y + 13, EYE);
  px.set(13, y + 14, look.skinDark); // nose
  if (look.glasses) { px.rect(13, y + 13, 3, 1, '#2a2a2a'); px.set(14, y + 13, '#9fd3ff'); }
  // arm (near side)
  switch (pose.armL) {
    case 'down': px.rect(14, y + 16, 2, 3, look.shirtDark); px.rect(14, y + 19, 2, 2, look.skin); break;
    case 'fwd':  px.rect(12, y + 16, 2, 3, look.shirtDark); px.rect(12, y + 19, 2, 2, look.skin); break;
    case 'back': px.rect(16, y + 16, 2, 3, look.shirtDark); px.rect(16, y + 19, 2, 2, look.skin); break;
    case 'up':   px.rect(14, y + 12, 2, 4, look.shirtDark); px.rect(14, y + 8, 2, 4, look.skin); break;
    case 'wave': px.rect(14, y + 12, 2, 4, look.shirtDark); px.rect(14, y + 9, 2, 3, look.skin); break;
    case 'out':  px.rect(14, y + 16, 2, 2, look.shirtDark); px.rect(10, y + 18, 5, 1, look.shirtDark); px.rect(9, y + 18, 2, 2, look.skin); break;
  }
  drawSideItem(px, look, y, pose.item);
  if (pose.sweat) { px.set(12, y + 10, '#8fd3ff'); }
}

export function renderPose(look: Look, dir: Dir, pose: Pose): Px {
  const px = new Px(32, 32);
  if (dir === 'down' || dir === 'up') renderFront(px, look, pose, dir);
  else {
    renderSide(px, look, pose);
    if (dir === 'right') {
      const m = new Px(32, 32);
      m.ctx.translate(32, 0); m.ctx.scale(-1, 1); m.ctx.drawImage(px.canvas, 0, 0);
      return m;
    }
  }
  return px;
}

export interface CharacterFrames {
  get(anim: Anim, dir: Dir): Texture[];
  fps(anim: Anim): number;
}

export function buildCharacter(look: Look): CharacterFrames {
  const cache = new Map<string, Texture[]>();
  return {
    fps: anim => ANIMS[anim].fps,
    get(anim, dir) {
      const def = ANIMS[anim];
      const d: Dir = def.dirs && !def.dirs.includes(dir) ? def.dirs[0] : dir;
      const key = `${anim}/${d}`;
      let t = cache.get(key);
      if (!t) {
        t = def.frames.map(p => renderPose(look, d, p).texture());
        cache.set(key, t);
      }
      return t;
    },
  };
}

// ---------------------------------------------------------------------------
// Props: bubble, shadow, sign
// ---------------------------------------------------------------------------
export type BubbleKind = 'q' | 'bang' | 'check' | 'zz' | 'dots' | 'heart';

const bubbleCache = new Map<string, Texture>();
export function bubbleTexture(kind: BubbleKind): Texture {
  const hit = bubbleCache.get(kind); if (hit) return hit;
  const px = new Px(16, 14);
  const bg = '#ffffff', ol = '#2a2a2a';
  px.rect(1, 0, 14, 11, bg); px.rect(0, 1, 16, 9, bg);
  px.hline(1, 0, 14, ol); px.hline(1, 10, 14, ol); px.vline(0, 1, 9, ol); px.vline(15, 1, 9, ol);
  px.set(0, 0, 'transparent'); // corners left transparent by construction
  px.rect(6, 11, 2, 1, bg); px.set(6, 12, bg); px.set(5, 11, ol); px.set(8, 11, ol); px.set(7, 12, ol); px.set(6, 13, ol); px.set(5, 12, ol);
  const glyph = (rows: string[], color: string, x = 5, y = 2) => px.pic(x, y, rows, { '#': color });
  switch (kind) {
    case 'q': glyph(['.###.', '#...#', '....#', '...#.', '..#..', '.....', '..#..'], '#f5c542', 5, 2); break;
    case 'bang': glyph(['.#.', '.#.', '.#.', '.#.', '...', '.#.'], '#f2544f', 6, 2); break;
    case 'check': glyph(['......#', '.....#.', '#...#..', '.#.#...', '..#....'], '#2fa862', 4, 3); break;
    case 'zz': glyph(['###....', '.#.....', '#..###.', '....#..', '...###.'], '#8a7fc7', 4, 3); break;
    case 'dots': glyph(['#.#.#'], '#6f7890', 5, 5); break;
    case 'heart': glyph(['.#.#.', '#####', '#####', '.###.', '..#..'], '#f2544f', 5, 3); break;
  }
  const t = px.texture(); bubbleCache.set(kind, t); return t;
}

let shadowTex: Texture | undefined;
export function shadowTexture(): Texture {
  if (shadowTex) return shadowTex;
  const px = new Px(12, 4);
  px.rect(2, 0, 8, 4, 'rgba(0,0,0,0.28)'); px.rect(0, 1, 12, 2, 'rgba(0,0,0,0.28)');
  return (shadowTex = px.texture());
}

// ---------------------------------------------------------------------------
// Tiles (16x16)
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Furniture / objects. Each returns textures (frames) and its size.
// Anchor: bottom-left of the object footprint.
// ---------------------------------------------------------------------------
export interface ObjectSprite { frames: Texture[]; w: number; h: number; fps?: number }
const objCache = new Map<string, ObjectSprite>();

function memo(key: string, make: () => ObjectSprite): ObjectSprite {
  const hit = objCache.get(key); if (hit) return hit;
  const o = make(); objCache.set(key, o); return o;
}

const WOOD = '#8a5a2b', WOOD_D = '#5e3c1c', WOOD_L = '#b07a3e';

export function deskSprite(): ObjectSprite {
  return memo('desk', () => {
    const frames: Texture[] = [];
    for (let f = 0; f < 2; f++) {
      const px = new Px(64, 30);
      px.rect(2, 14, 60, 10, '#7a5230'); px.rect(2, 14, 60, 2, '#a8763f'); px.rect(2, 22, 60, 2, '#5b3a1e');
      px.rect(4, 24, 4, 6, '#5b3a1e'); px.rect(56, 24, 4, 6, '#5b3a1e');
      // monitor
      px.rect(26, 0, 18, 14, '#2a2e3a'); px.rect(28, 2, 14, 9, f ? '#1f8fd6' : '#1c7cc0');
      px.rect(29, 3, 7, 1, '#9fe0ff'); px.rect(29, 5, 10, 1, '#9fe0ff'); px.rect(29, 7, 5, 1, '#9fe0ff');
      if (f) px.rect(29, 9, 3, 1, '#9fe0ff');
      px.rect(33, 14, 4, 2, '#2a2e3a');
      // keyboard, mug, papers
      px.rect(24, 17, 16, 4, '#d8d8e0'); px.rect(25, 18, 14, 2, '#a8a8b8');
      px.rect(48, 16, 5, 5, '#f4f1ea'); px.rect(53, 17, 1, 2, '#f4f1ea'); px.rect(48, 16, 5, 1, '#6b3f23');
      px.rect(8, 16, 10, 6, '#f4f1ea'); px.rect(9, 17, 6, 1, '#b8b8c8'); px.rect(9, 19, 8, 1, '#b8b8c8');
      frames.push(px.texture());
    }
    return { frames, w: 64, h: 30, fps: 2 };
  });
}

export function chairSprite(): ObjectSprite {
  return memo('chair', () => {
    const px = new Px(16, 18);
    px.rect(3, 0, 10, 8, '#3a3f4d'); px.rect(4, 1, 8, 6, '#4a5060'); px.rect(5, 8, 6, 6, '#3a3f4d'); px.rect(2, 14, 12, 2, '#2a2e3a'); px.rect(7, 16, 2, 2, '#2a2e3a');
    return { frames: [px.texture()], w: 16, h: 18 };
  });
}

export function whiteboardSprite(): ObjectSprite {
  return memo('whiteboard', () => {
    const px = new Px(56, 30);
    px.rect(2, 2, 52, 24, '#3a3f4d'); px.rect(4, 4, 48, 20, '#f4f1ea');
    px.rect(7, 7, 20, 2, '#f2544f'); px.rect(7, 11, 30, 1, '#2a2e3a'); px.rect(7, 14, 24, 1, '#2a2e3a'); px.rect(7, 17, 28, 1, '#2a2e3a');
    px.rect(38, 8, 10, 8, '#4f9be8'); px.rect(40, 10, 6, 4, '#f4f1ea'); px.rect(40, 18, 8, 1, '#4fd18b');
    px.rect(6, 26, 2, 4, '#2a2e3a'); px.rect(48, 26, 2, 4, '#2a2e3a');
    return { frames: [px.texture()], w: 56, h: 30 };
  });
}

export function coffeeMachineSprite(): ObjectSprite {
  return memo('coffee', () => {
    const frames: Texture[] = [];
    for (let f = 0; f < 2; f++) {
      const px = new Px(18, 26);
      px.rect(2, 2, 14, 22, '#5a6070'); px.rect(3, 3, 12, 6, '#2a2e3a'); px.rect(5, 5, 3, 2, f ? '#4fd18b' : '#f2544f');
      px.rect(4, 12, 10, 4, '#2a2e3a'); px.rect(6, 16, 4, 4, '#f4f1ea'); px.rect(6, 16, 4, 1, '#6b3f23');
      px.rect(1, 24, 16, 2, '#3a3f4d');
      if (f) { px.set(8, 13, '#d8d8e0'); px.set(9, 11, '#d8d8e0'); }
      frames.push(px.texture());
    }
    return { frames, w: 18, h: 26, fps: 1.5 };
  });
}

export function plantSprite(variant = 0): ObjectSprite {
  return memo(`plant${variant}`, () => {
    const px = new Px(14, 22);
    px.rect(4, 15, 6, 7, '#b5651d'); px.rect(3, 14, 8, 2, '#d9823a');
    const g = variant ? '#3fbf6f' : '#2fa862';
    px.rect(6, 4, 2, 11, '#2f7a2c'); px.blob(4, 8, 3, g); px.blob(9, 6, 3, g); px.blob(7, 3, 2, '#7ccc63'); px.blob(6, 11, 2, g);
    return { frames: [px.texture()], w: 14, h: 22 };
  });
}

export function lampSprite(): ObjectSprite {
  return memo('lamp', () => {
    const frames: Texture[] = [];
    for (let f = 0; f < 2; f++) {
      const px = new Px(10, 30);
      px.rect(4, 6, 2, 22, '#3a3f4d'); px.rect(2, 28, 6, 2, '#2a2e3a'); px.rect(1, 0, 8, 6, '#5a6070'); px.rect(2, 4, 6, 2, f ? '#fff3b0' : '#f5c542');
      frames.push(px.texture());
    }
    return { frames, w: 10, h: 30, fps: 3 };
  });
}

export function signSprite(): ObjectSprite {
  return memo('sign', () => {
    const px = new Px(14, 22);
    px.rect(6, 10, 2, 12, WOOD); px.rect(1, 1, 12, 9, '#f5c542'); px.frame(1, 1, 12, 9, '#8a6a1a');
    px.pic(4, 2, ['####.', '...#.', '..#..', '.#...', '.....', '.#...', '.....'], { '#': '#2b1d0e' });
    return { frames: [px.texture()], w: 14, h: 22 };
  });
}
