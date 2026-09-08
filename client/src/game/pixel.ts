import { Texture, TextureSource } from 'pixi.js';

TextureSource.defaultOptions.scaleMode = 'nearest';

/** A tiny pixel canvas: draw with integer rects, then turn into a nearest-neighbour texture. */
export class Px {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;

  constructor(public w: number, public h: number) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = w;
    this.canvas.height = h;
    this.ctx = this.canvas.getContext('2d')!;
    this.ctx.imageSmoothingEnabled = false;
  }

  clear(color?: string) {
    this.ctx.clearRect(0, 0, this.w, this.h);
    if (color) this.rect(0, 0, this.w, this.h, color);
  }

  set(x: number, y: number, color: string) {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(x, y, 1, 1);
  }

  rect(x: number, y: number, w: number, h: number, color: string) {
    if (w <= 0 || h <= 0) return;
    this.ctx.fillStyle = color;
    this.ctx.fillRect(x, y, w, h);
  }

  hline(x: number, y: number, w: number, color: string) { this.rect(x, y, w, 1, color); }
  vline(x: number, y: number, h: number, color: string) { this.rect(x, y, 1, h, color); }

  /** outline of a rect */
  frame(x: number, y: number, w: number, h: number, color: string) {
    this.hline(x, y, w, color); this.hline(x, y + h - 1, w, color);
    this.vline(x, y, h, color); this.vline(x + w - 1, y, h, color);
  }

  /** filled circle-ish blob (good for tree canopies / bushes) */
  blob(cx: number, cy: number, r: number, color: string) {
    for (let y = -r; y <= r; y++) {
      for (let x = -r; x <= r; x++) {
        if (x * x + y * y <= r * r + r * 0.5) this.set(cx + x, cy + y, color);
      }
    }
  }

  /** draw pixel rows from a string picture; map char -> color; '.' = transparent */
  pic(x: number, y: number, rows: string[], map: Record<string, string>) {
    rows.forEach((row, j) => {
      for (let i = 0; i < row.length; i++) {
        const c = row[i];
        if (c === '.' || c === ' ') continue;
        const color = map[c];
        if (color) this.set(x + i, y + j, color);
      }
    });
  }

  draw(other: Px, x: number, y: number) {
    this.ctx.drawImage(other.canvas, x, y);
  }

  texture(): Texture {
    const t = Texture.from(this.canvas);
    t.source.scaleMode = 'nearest';
    return t;
  }
}

/** Deterministic pseudo random (mulberry32) for stable decoration. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}

// ---------------------------------------------------------------------------
// 3x5 pixel font
// ---------------------------------------------------------------------------
const GLYPHS: Record<string, string[]> = {
  A: ['.#.', '#.#', '###', '#.#', '#.#'],
  B: ['##.', '#.#', '##.', '#.#', '##.'],
  C: ['.##', '#..', '#..', '#..', '.##'],
  D: ['##.', '#.#', '#.#', '#.#', '##.'],
  E: ['###', '#..', '##.', '#..', '###'],
  F: ['###', '#..', '##.', '#..', '#..'],
  G: ['.##', '#..', '#.#', '#.#', '.##'],
  H: ['#.#', '#.#', '###', '#.#', '#.#'],
  I: ['###', '.#.', '.#.', '.#.', '###'],
  J: ['..#', '..#', '..#', '#.#', '.#.'],
  K: ['#.#', '#.#', '##.', '#.#', '#.#'],
  L: ['#..', '#..', '#..', '#..', '###'],
  M: ['#.#', '###', '###', '#.#', '#.#'],
  N: ['##.', '#.#', '#.#', '#.#', '#.#'],
  O: ['.#.', '#.#', '#.#', '#.#', '.#.'],
  P: ['##.', '#.#', '##.', '#..', '#..'],
  Q: ['.#.', '#.#', '#.#', '.#.', '..#'],
  R: ['##.', '#.#', '##.', '#.#', '#.#'],
  S: ['.##', '#..', '.#.', '..#', '##.'],
  T: ['###', '.#.', '.#.', '.#.', '.#.'],
  U: ['#.#', '#.#', '#.#', '#.#', '.##'],
  V: ['#.#', '#.#', '#.#', '.#.', '.#.'],
  W: ['#.#', '#.#', '###', '###', '#.#'],
  X: ['#.#', '#.#', '.#.', '#.#', '#.#'],
  Y: ['#.#', '#.#', '.#.', '.#.', '.#.'],
  Z: ['###', '..#', '.#.', '#..', '###'],
  '0': ['.#.', '#.#', '#.#', '#.#', '.#.'],
  '1': ['.#.', '##.', '.#.', '.#.', '###'],
  '2': ['##.', '..#', '.#.', '#..', '###'],
  '3': ['##.', '..#', '.#.', '..#', '##.'],
  '4': ['#.#', '#.#', '###', '..#', '..#'],
  '5': ['###', '#..', '##.', '..#', '##.'],
  '6': ['.##', '#..', '##.', '#.#', '.#.'],
  '7': ['###', '..#', '.#.', '.#.', '.#.'],
  '8': ['.#.', '#.#', '.#.', '#.#', '.#.'],
  '9': ['.#.', '#.#', '.##', '..#', '##.'],
  ' ': ['...', '...', '...', '...', '...'],
  '.': ['...', '...', '...', '...', '.#.'],
  ':': ['...', '.#.', '...', '.#.', '...'],
  '-': ['...', '...', '###', '...', '...'],
  '?': ['##.', '..#', '.#.', '...', '.#.'],
  '!': ['.#.', '.#.', '.#.', '...', '.#.'],
  '/': ['..#', '..#', '.#.', '#..', '#..'],
  '_': ['...', '...', '...', '...', '###'],
  '+': ['...', '.#.', '###', '.#.', '...'],
  '#': ['#.#', '###', '#.#', '###', '#.#'],
  '(': ['.#.', '#..', '#..', '#..', '.#.'],
  ')': ['.#.', '..#', '..#', '..#', '.#.'],
  "'": ['.#.', '.#.', '...', '...', '...'],
  '>': ['#..', '.#.', '..#', '.#.', '#..'],
  '<': ['..#', '.#.', '#..', '.#.', '..#'],
  ',': ['...', '...', '...', '.#.', '#..'],
};

export function textWidth(s: string): number {
  return s.length * 4 - 1;
}

/** Draw a string in the 3x5 font. Returns width. */
export function drawText(px: Px, x: number, y: number, s: string, color: string): number {
  const up = s.toUpperCase();
  let cx = x;
  for (const ch of up) {
    const g = GLYPHS[ch] ?? GLYPHS['?'];
    px.pic(cx, y, g, { '#': color });
    cx += 4;
  }
  return cx - x - 1;
}

const textCache = new Map<string, Texture>();

/** A cached label texture: text on a dark rounded box (or bare). */
export function labelTexture(s: string, opts: { color?: string; bg?: string | null; pad?: number } = {}): Texture {
  const color = opts.color ?? '#ffffff';
  const bg = opts.bg === undefined ? 'rgba(10,12,18,0.75)' : opts.bg;
  const pad = opts.pad ?? 2;
  const key = `${s}|${color}|${bg}|${pad}`;
  const hit = textCache.get(key);
  if (hit) return hit;
  const w = textWidth(s) + pad * 2;
  const h = 5 + pad * 2;
  const px = new Px(w, h);
  if (bg) {
    px.rect(1, 0, w - 2, h, bg);
    px.rect(0, 1, w, h - 2, bg);
  }
  drawText(px, pad, pad, s, color);
  const t = px.texture();
  textCache.set(key, t);
  return t;
}
