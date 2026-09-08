import { Texture } from 'pixi.js';
import { Px, rng } from './pixel.ts';
import type { ObjectSprite } from './sprites.ts';
import type { Activity } from '../../../shared/types.ts';

// ---------------------------------------------------------------------------
// Floor / wall tiles (16x16)
// ---------------------------------------------------------------------------
export type TileKind =
  | 'carpet' | 'wood' | 'kitchenTile' | 'corridor' | 'glass' | 'doorway'
  | 'wallH' | 'wallTop' | 'wallBottom' | 'wallSide' | 'wallLow' | 'entrance';

const WALL = '#5a6070', WALL_D = '#3a3f4d', WALL_L = '#6f7789', BASE = '#2a2e3a';
const tileCache = new Map<string, Texture>();

export function tileTexture(kind: TileKind, variant = 0): Texture {
  const key = `${kind}/${variant}`;
  const hit = tileCache.get(key); if (hit) return hit;
  const px = new Px(16, 16);
  const r = rng(variant * 131 + kind.length * 17 + 3);
  switch (kind) {
    case 'carpet': {
      px.clear('#5b6378');
      for (let y = 0; y < 16; y += 4) for (let x = (y / 4) % 2 ? 2 : 0; x < 16; x += 4) px.set(x, y, '#66708a');
      for (let i = 0; i < 3; i++) px.set((r() * 16) | 0, (r() * 16) | 0, '#525a6e');
      break;
    }
    case 'wood': {
      px.clear('#b58a5a');
      px.hline(0, 0, 16, '#8f6a42'); px.hline(0, 8, 16, '#8f6a42');
      px.vline(11, 0, 8, '#8f6a42'); px.vline(4, 8, 8, '#8f6a42');
      px.set(3 + ((r() * 8) | 0), 3, '#9c7448'); px.set(2 + ((r() * 10) | 0), 12, '#9c7448');
      break;
    }
    case 'kitchenTile': {
      px.clear('#d8dce6');
      px.rect(0, 0, 8, 8, '#c4c9d6'); px.rect(8, 8, 8, 8, '#c4c9d6');
      px.hline(0, 0, 16, '#b3b9c8'); px.vline(0, 0, 16, '#b3b9c8');
      break;
    }
    case 'corridor': {
      px.clear('#8e95a8');
      px.frame(0, 0, 16, 16, '#7d8497');
      for (let i = 0; i < 3; i++) px.set((r() * 16) | 0, (r() * 16) | 0, '#9aa1b3');
      break;
    }
    case 'glass': {
      px.clear('#8e95a8'); px.frame(0, 0, 16, 16, '#7d8497');
      px.rect(6, 0, 4, 16, '#bfe6ff'); px.rect(7, 0, 2, 16, '#d9f2ff'); px.vline(5, 0, 16, WALL_D); px.vline(10, 0, 16, WALL_D);
      break;
    }
    case 'doorway': {
      px.clear('#8e95a8'); px.frame(0, 0, 16, 16, '#7d8497');
      px.rect(5, 0, 6, 16, '#7d8497');
      break;
    }
    case 'wallH': {
      px.clear(WALL); px.rect(0, 0, 16, 5, WALL_L); px.rect(0, 13, 16, 3, BASE); px.hline(0, 12, 16, WALL_D);
      break;
    }
    case 'wallTop': {
      px.clear(WALL); px.rect(0, 0, 16, 3, WALL_L);
      for (let i = 0; i < 2; i++) px.set((r() * 16) | 0, 4 + ((r() * 10) | 0), WALL_L);
      break;
    }
    case 'wallBottom': {
      px.clear(WALL); px.rect(0, 12, 16, 4, BASE); px.hline(0, 11, 16, WALL_D);
      break;
    }
    case 'wallSide': {
      px.clear(WALL_D); px.rect(4, 0, 8, 16, WALL); px.rect(6, 0, 4, 16, WALL_L);
      break;
    }
    case 'wallLow': {
      px.clear(WALL_D); px.rect(0, 0, 16, 6, WALL); px.rect(0, 0, 16, 2, WALL_L);
      break;
    }
    case 'entrance': {
      px.clear('#8e95a8'); px.rect(0, 0, 3, 16, WALL_D); px.rect(13, 0, 3, 16, WALL_D);
      px.rect(3, 12, 10, 4, '#c8a25a'); px.hline(3, 12, 10, '#e2bd73');
      break;
    }
  }
  const t = px.texture(); tileCache.set(key, t); return t;
}

// ---------------------------------------------------------------------------
// Furniture
// ---------------------------------------------------------------------------
const objCache = new Map<string, ObjectSprite>();
function memo(key: string, make: () => ObjectSprite): ObjectSprite {
  const hit = objCache.get(key); if (hit) return hit;
  const o = make(); objCache.set(key, o); return o;
}

const DESK = '#e6e1d6', DESK_D = '#bdb5a5', DESK_EDGE = '#9e9686', LEG = '#4a5060', BEZEL = '#2a2e3a';

/** Workstation: desk 40 wide with a monitor on the right. 40x34, anchored bottom-left. */
export function workstationSprite(): ObjectSprite {
  return memo('workstation', () => {
    const px = new Px(40, 34);
    // monitor (screen area filled by the overlay sprite at 27..37 x 3..10)
    px.rect(25, 0, 14, 12, BEZEL); px.rect(26, 1, 12, 10, '#1a1d26');
    px.rect(30, 12, 4, 2, BEZEL); px.rect(28, 14, 8, 1, BEZEL);
    // desk top
    px.rect(0, 14, 40, 10, DESK); px.rect(0, 14, 40, 1, '#f4f1ea'); px.rect(0, 23, 40, 2, DESK_D); px.rect(0, 25, 40, 1, DESK_EDGE);
    // keyboard, mouse, mug, papers
    px.rect(9, 17, 12, 4, '#cfd3dc'); px.rect(10, 18, 10, 2, '#9aa1b3');
    px.rect(23, 18, 2, 3, '#cfd3dc');
    px.rect(2, 16, 4, 4, '#4f9be8'); px.rect(2, 16, 4, 1, '#6b3f23'); px.set(6, 17, '#4f9be8');
    px.rect(33, 17, 5, 4, '#f4f1ea'); px.rect(34, 18, 3, 1, '#b8b8c8');
    // legs
    px.rect(2, 26, 3, 8, LEG); px.rect(35, 26, 3, 8, LEG);
    return { frames: [px.texture()], w: 40, h: 34 };
  });
}

/** Office chair 16x16, anchored bottom-left. */
export function officeChairSprite(): ObjectSprite {
  return memo('officeChair', () => {
    const px = new Px(16, 16);
    px.rect(3, 0, 10, 7, '#3a3f4d'); px.rect(4, 1, 8, 5, '#4a5060'); px.rect(5, 7, 6, 5, '#3a3f4d');
    px.rect(2, 12, 12, 2, '#2a2e3a'); px.rect(7, 14, 2, 2, '#2a2e3a'); px.set(3, 15, '#2a2e3a'); px.set(12, 15, '#2a2e3a');
    return { frames: [px.texture()], w: 16, h: 16 };
  });
}

export type ScreenKind = Activity | 'off' | 'error' | 'idle';

/** What is on an agent's monitor. 12x10, two frames. */
export function screenSprite(kind: ScreenKind): ObjectSprite {
  return memo(`screen-${kind}`, () => {
    const frames: Texture[] = [];
    for (let f = 0; f < 2; f++) {
      const px = new Px(12, 10);
      switch (kind) {
        case 'off':
          px.clear('#1a1d26'); break;
        case 'idle':
          px.clear('#1f2a3a'); px.rect(3, 4, 6, 2, '#2f3f5c'); if (f) px.set(5 + f, 5, '#4f9be8'); break;
        case 'build': // code editor
          px.clear('#1b2330'); px.rect(1, 1, 5, 1, '#4fd18b'); px.rect(2, 3, 7, 1, '#f5c542'); px.rect(2, 5, 4, 1, '#8fd3ff');
          px.rect(1, 7, 6 + f * 2, 1, '#4fd18b'); if (f) px.set(9, 7, '#ffffff'); break;
        case 'run': // terminal
          px.clear('#0e1117'); px.rect(1, 1, 1, 1, '#4fd18b'); px.rect(3, 1, 6, 1, '#d8d8e0'); px.rect(1, 3, 8, 1, '#8b93a7');
          px.rect(1, 5, 5, 1, '#8b93a7'); px.rect(1, 7, 1 + f, 1, '#ffffff'); break;
        case 'chop': // browser / document
          px.clear('#f4f1ea'); px.rect(0, 0, 12, 2, '#cfd3dc'); px.rect(1, 3, 10, 1, '#2f3f5c'); px.rect(1, 5, 7, 1, '#8b93a7');
          px.rect(1, 7, 9, 1, '#8b93a7'); if (f) px.rect(8, 5, 3, 1, '#4f9be8'); break;
        case 'lift': // agents / graph
          px.clear('#1f1a2e'); px.rect(2, 2, 3, 2, '#b48cf2'); px.rect(7, 2, 3, 2, '#b48cf2'); px.rect(4, 6, 4, 2, '#b48cf2');
          px.set(5 + f, 4, '#ffffff'); px.set(7 - f, 5, '#ffffff'); break;
        case 'think': // spinner
          px.clear('#1b2330'); px.rect(3, 4, 6, 2, '#2f3f5c');
          px.set(f ? 5 : 3, f ? 4 : 5, '#4f9be8'); px.set(f ? 8 : 6, f ? 5 : 4, '#4f9be8'); break;
        case 'error':
          px.clear(f ? '#3a1414' : '#4a1818'); px.rect(5, 2, 2, 4, '#f2544f'); px.rect(5, 7, 2, 1, '#f2544f'); break;
      }
      frames.push(px.texture());
    }
    return { frames, w: 12, h: 10, fps: kind === 'run' || kind === 'build' ? 3 : 1.5 };
  });
}

/** Window on the top wall, 32x24. */
export function windowSprite(): ObjectSprite {
  return memo('window', () => {
    const frames: Texture[] = [];
    for (let f = 0; f < 2; f++) {
      const px = new Px(32, 24);
      px.rect(0, 0, 32, 24, '#d8dce6'); px.rect(2, 2, 28, 20, '#8fd3ff'); px.rect(2, 12, 28, 10, '#6fb7e8');
      px.rect(4 + f * 2, 4, 6, 2, '#ffffff'); px.rect(18 - f, 7, 8, 2, '#ffffff');
      px.rect(15, 2, 2, 20, '#d8dce6'); px.rect(2, 11, 28, 2, '#d8dce6');
      px.rect(0, 22, 32, 2, '#c4c9d6');
      frames.push(px.texture());
    }
    return { frames, w: 32, h: 24, fps: 0.3 };
  });
}

export function bookshelfSprite(): ObjectSprite {
  return memo('bookshelf', () => {
    const px = new Px(32, 28);
    px.rect(0, 0, 32, 28, '#6b4a2a'); px.rect(2, 2, 28, 24, '#8a5a2b');
    const rows = [3, 11, 19];
    const cols = ['#f2544f', '#4f9be8', '#f5c542', '#4fd18b', '#b48cf2', '#ff8c42', '#3dd6d0', '#e85d9a'];
    rows.forEach((y, ri) => {
      px.rect(2, y + 7, 28, 1, '#5e3c1c');
      let x = 3;
      for (let i = 0; x < 28; i++) { const w = 2 + ((i + ri) % 3); px.rect(x, y + 1 + ((i * ri) % 2), w, 6 - ((i * ri) % 2), cols[(i + ri * 3) % cols.length]); x += w + 1; }
    });
    return { frames: [px.texture()], w: 32, h: 28 };
  });
}

export function executiveChairSprite(): ObjectSprite {
  return memo('execChair', () => {
    const px = new Px(20, 18);
    px.rect(3, 0, 14, 9, '#2a2e3a'); px.rect(4, 1, 12, 7, '#3a3f4d'); px.rect(6, 9, 8, 5, '#2a2e3a');
    px.rect(2, 14, 16, 2, '#1e2230'); px.rect(9, 16, 2, 2, '#1e2230');
    return { frames: [px.texture()], w: 20, h: 18 };
  });
}

export function waterCoolerSprite(): ObjectSprite {
  return memo('cooler', () => {
    const frames: Texture[] = [];
    for (let f = 0; f < 2; f++) {
      const px = new Px(12, 28);
      px.rect(3, 12, 6, 16, '#d8dce6'); px.rect(2, 26, 8, 2, '#9aa1b3');
      px.rect(2, 0, 8, 12, '#8fd3ff'); px.rect(3, 1, 3, 10, '#bfe6ff'); px.rect(2, 11, 8, 1, '#6fb7e8');
      if (f) px.set(5, 4, '#ffffff'); else px.set(6, 7, '#ffffff');
      px.rect(4, 16, 2, 2, '#4f9be8'); px.rect(7, 16, 2, 2, '#f2544f');
      frames.push(px.texture());
    }
    return { frames, w: 12, h: 28, fps: 0.7 };
  });
}

export function fridgeSprite(): ObjectSprite {
  return memo('fridge', () => {
    const px = new Px(16, 30);
    px.rect(1, 0, 14, 30, '#d8dce6'); px.rect(2, 1, 12, 28, '#e8ebf2'); px.rect(2, 11, 12, 1, '#b3b9c8');
    px.rect(11, 4, 1, 5, '#8e95a8'); px.rect(11, 14, 1, 8, '#8e95a8'); px.rect(3, 3, 3, 2, '#f5c542'); px.rect(3, 6, 4, 1, '#4f9be8');
    return { frames: [px.texture()], w: 16, h: 30 };
  });
}

export function sofaSprite(): ObjectSprite {
  return memo('sofa', () => {
    const px = new Px(40, 18);
    px.rect(2, 0, 36, 8, '#3f6fb0'); px.rect(3, 1, 34, 6, '#4f80c8');
    px.rect(0, 6, 40, 8, '#3f6fb0'); px.rect(2, 8, 17, 5, '#4f80c8'); px.rect(21, 8, 17, 5, '#4f80c8');
    px.rect(0, 14, 40, 2, '#2f5488'); px.rect(2, 16, 3, 2, '#2a2e3a'); px.rect(35, 16, 3, 2, '#2a2e3a');
    return { frames: [px.texture()], w: 40, h: 18 };
  });
}

export function roundTableSprite(): ObjectSprite {
  return memo('roundTable', () => {
    const px = new Px(24, 18);
    px.blob(12, 6, 10, '#c9a06a'); px.blob(12, 5, 9, '#d9b57e'); px.rect(11, 12, 2, 5, '#8a5a2b'); px.rect(8, 16, 8, 2, '#8a5a2b');
    px.rect(9, 3, 3, 3, '#f4f1ea'); px.rect(9, 3, 3, 1, '#6b3f23');
    return { frames: [px.texture()], w: 24, h: 18 };
  });
}

export function printerSprite(): ObjectSprite {
  return memo('printer', () => {
    const frames: Texture[] = [];
    for (let f = 0; f < 2; f++) {
      const px = new Px(22, 18);
      px.rect(1, 6, 20, 10, '#cfd3dc'); px.rect(2, 7, 18, 8, '#e0e3ea'); px.rect(4, 2, 14, 5, '#cfd3dc'); px.rect(6, 0, 10, 3, '#f4f1ea');
      px.rect(3, 12, 6, 2, '#2a2e3a'); px.set(16, 9, f ? '#4fd18b' : '#2a2e3a'); px.rect(0, 16, 22, 2, '#9aa1b3');
      if (f) px.rect(7, 14, 8, 3, '#ffffff');
      frames.push(px.texture());
    }
    return { frames, w: 22, h: 18, fps: 0.5 };
  });
}

export function clockSprite(): ObjectSprite {
  return memo('clock', () => {
    const px = new Px(12, 12);
    px.blob(6, 6, 5, '#f4f1ea'); px.frame(1, 1, 10, 10, '#2a2e3a'); px.set(1, 1, 'transparent');
    px.rect(6, 3, 1, 4, '#2a2e3a'); px.rect(6, 6, 3, 1, '#2a2e3a'); px.set(6, 6, '#f2544f');
    return { frames: [px.texture()], w: 12, h: 12 };
  });
}

export function posterSprite(variant = 0): ObjectSprite {
  return memo(`poster${variant}`, () => {
    const px = new Px(14, 18);
    px.rect(0, 0, 14, 18, '#2a2e3a');
    const bg = ['#f5c542', '#4f9be8', '#f2544f'][variant % 3];
    px.rect(1, 1, 12, 16, bg); px.rect(3, 3, 8, 6, '#f4f1ea'); px.rect(3, 11, 8, 1, '#2a2e3a'); px.rect(3, 13, 5, 1, '#2a2e3a');
    return { frames: [px.texture()], w: 14, h: 18 };
  });
}

export function cabinetSprite(): ObjectSprite {
  return memo('cabinet', () => {
    const px = new Px(24, 26);
    px.rect(0, 0, 24, 26, '#8e95a8'); px.rect(1, 1, 22, 24, '#b3b9c8'); px.rect(1, 9, 22, 1, '#8e95a8'); px.rect(1, 17, 22, 1, '#8e95a8');
    for (const y of [4, 12, 20]) px.rect(10, y, 4, 2, '#5a6070');
    return { frames: [px.texture()], w: 24, h: 26 };
  });
}

/** Little "YOUR OFFICE" style nameplate on the glass, 28x8. */
export function nameplateSprite(): ObjectSprite {
  return memo('nameplate', () => {
    const px = new Px(30, 9);
    px.rect(0, 0, 30, 9, '#2a2e3a'); px.rect(1, 1, 28, 7, '#f4f1ea');
    px.pic(3, 2, ['#.#.###.#.#.###', '#.#.#.#.#.#.#..', '###.#.#.#.#.##.', '..#.#.#.#.#.#..', '..#.###.###.###'], { '#': '#2a2e3a' });
    return { frames: [px.texture()], w: 30, h: 9 };
  });
}
