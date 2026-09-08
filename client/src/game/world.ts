import type { Anim, Dir } from './sprites.ts';
import type { TileKind } from './office.ts';

export const TILE = 16;
export const COLS = 30;
export const ROWS = 22;            // 18 řádků kanceláře + 4 řádky noční směny
export const W = COLS * TILE; // 480
export const H = ROWS * TILE; // 352

export interface Pt { x: number; y: number }

export type ZoneId = 'desks' | 'office' | 'kitchen';

/**
 * A place an agent can occupy. `toSpine` is the walking path from the slot out to the
 * corridor (the "spine", x = SPINE_X); routes are toSpine(from) + corridor + reverse(toSpine(to)).
 */
export interface Slot {
  id: string;
  zone: ZoneId;
  x: number; y: number;      // feet position
  dir: Dir;
  anim: Anim;
  toSpine: Pt[];
  takenBy?: string;
  screen?: Pt;               // workstation only: where the monitor overlay goes
}

export interface Zone { id: ZoneId; slots: Slot[] }

export const SPINE_X = 184;
export const SPAWN: Pt = { x: SPINE_X, y: 366 };
export const EXIT: Pt = { x: SPINE_X, y: 370 };
const ENTRANCE_SPINE: Pt = { x: SPINE_X, y: 340 };

// ---- noční směna (serverovna) ----------------------------------------------
export const NIGHT = { x: 12 * TILE, y: 18 * TILE, w: 17 * TILE, h: 3 * TILE };
export const ROBOT_MAX = 16;
/** Pozice nohou i-tého robota v serverovně: dvě řady, střídavě, s posunem o půl rozestupu. */
export function robotSlot(i: number): Pt {
  const row = i % 2, col = Math.floor(i / 2);
  return { x: NIGHT.x + 20 + col * 32 + row * 16, y: NIGHT.y + 20 + row * 26 };
}

// ---- your office -----------------------------------------------------------
export const OFFICE = { x: 16, y: 32, w: 144, h: 112, doorY: 88, lane: 140 };
export const USER_POS: Pt = { x: 64, y: 100 };

function officeSlot(i: number, x: number, y: number): Slot {
  return {
    id: `office-${i}`, zone: 'office', x, y, dir: 'up', anim: 'idle',
    toSpine: [{ x: OFFICE.lane, y }, { x: OFFICE.lane, y: OFFICE.doorY }, { x: 168, y: OFFICE.doorY }, { x: SPINE_X, y: OFFICE.doorY }],
  };
}

// ---- kitchen ---------------------------------------------------------------
export const KITCHEN = { x: 16, y: 160, w: 144, h: 112, doorY: 216, lane: 140 };

function kitchenSlot(i: number, x: number, y: number, anim: Anim = 'coffee'): Slot {
  return {
    id: `kitchen-${i}`, zone: 'kitchen', x, y, dir: 'down', anim,
    toSpine: [{ x: KITCHEN.lane, y }, { x: KITCHEN.lane, y: KITCHEN.doorY }, { x: 168, y: KITCHEN.doorY }, { x: SPINE_X, y: KITCHEN.doorY }],
  };
}

// ---- open space workstations ----------------------------------------------
export interface Workstation { x: number; top: number; aisle: number; seat: Pt; deskBottom: Pt; chair: Pt; screen: Pt }

export const DESK_COLS = [200, 264, 328, 392];
export const DESK_ROWS = [36, 116, 196];

export function workstations(): Workstation[] {
  const out: Workstation[] = [];
  for (const top of DESK_ROWS) {
    for (const x of DESK_COLS) {
      out.push({
        x, top, aisle: top + 52,
        seat: { x: x + 16, y: top + 30 },
        deskBottom: { x, y: top + 44 },
        chair: { x: x + 8, y: top + 18 },
        screen: { x: x + 27, y: top + 13 },
      });
    }
  }
  return out;
}

function deskSlot(i: number, ws: Workstation): Slot {
  return {
    id: `desk-${i}`, zone: 'desks', x: ws.seat.x, y: ws.seat.y, dir: 'down', anim: 'type', screen: ws.screen,
    toSpine: [{ x: ws.x + 50, y: ws.seat.y }, { x: ws.x + 50, y: ws.aisle }, { x: SPINE_X, y: ws.aisle }],
  };
}

export const ZONES: Record<ZoneId, Zone> = {
  desks: { id: 'desks', slots: workstations().map((ws, i) => deskSlot(i, ws)) },
  office: {
    id: 'office',
    slots: [[60, 140], [84, 140], [108, 140], [36, 140], [126, 140]].map(([x, y], i) => officeSlot(i, x, y)),
  },
  kitchen: {
    id: 'kitchen',
    slots: [
      kitchenSlot(0, 36, 212), kitchenSlot(1, 62, 212), kitchenSlot(2, 112, 212),
      kitchenSlot(3, 96, 262, 'idle'), kitchenSlot(4, 122, 262, 'idle'), kitchenSlot(5, 84, 236, 'idle'),
    ],
  },
};

/** A place to stand for agents that found no free slot in a zone. */
export function overflowSlot(zone: ZoneId, agentId: string, seed: number): Slot {
  const n = seed % 5;
  if (zone === 'desks') {
    const aisle = DESK_ROWS[n % 3] + 52;
    const x = 216 + (n * 47) % 220;
    return { id: `desks-ovf-${agentId}`, zone, x, y: aisle, dir: 'down', anim: 'idle', toSpine: [{ x: SPINE_X, y: aisle }], takenBy: agentId };
  }
  if (zone === 'office') {
    const s = officeSlot(99, 48 + n * 18, 140); s.id = `office-ovf-${agentId}`; s.takenBy = agentId; return s;
  }
  const s = kitchenSlot(99, 40 + n * 18, 250, 'idle'); s.id = `kitchen-ovf-${agentId}`; s.takenBy = agentId; return s;
}

/** `allowed` = indexy stolů (ostrůvek projektu); když jsou všechny obsazené, vezme se libovolný volný. */
export function acquireSlot(zone: Zone, agentId: string, seed: number, allowed?: number[]): Slot {
  const mine = zone.slots.find(s => s.takenBy === agentId);
  const ok = (s: Slot) => !allowed || allowed.includes(zone.slots.indexOf(s));
  if (mine && ok(mine)) return mine;
  if (mine) releaseSlot(mine, agentId);
  const free = zone.slots.find(s => !s.takenBy && ok(s)) ?? (allowed ? zone.slots.find(s => !s.takenBy) : undefined);
  if (free) { free.takenBy = agentId; return free; }
  return overflowSlot(zone.id, agentId, seed);
}

/** Obdélník podlahy kolem stolu `i` (pro rámeček ostrůvku). */
export function deskCell(i: number): { x: number; y: number; w: number; h: number } {
  const ws = workstations()[i];
  return { x: ws.x - 4, y: ws.top - 6, w: 58, h: 62 };
}

export function releaseSlot(slot: Slot | undefined, agentId: string) {
  if (slot && slot.takenBy === agentId && !slot.id.includes('-ovf-')) slot.takenBy = undefined;
}

export const ENTRANCE: Slot = { id: 'entrance', zone: 'desks', x: SPAWN.x, y: SPAWN.y, dir: 'up', anim: 'idle', toSpine: [ENTRANCE_SPINE] };
export const EXIT_SLOT: Slot = { id: 'exit', zone: 'desks', x: EXIT.x, y: EXIT.y, dir: 'down', anim: 'idle', toSpine: [ENTRANCE_SPINE] };

/**
 * Walking path: out of `from` to the corridor, along it, into `to`.
 * `spineIdx` is the index of the last corridor point (used when re-routing mid-walk).
 */
export function buildRoute(from: Slot, to: Slot): { path: Pt[]; spineIdx: number } {
  const out: Pt[] = [...from.toSpine];
  const a = from.toSpine[from.toSpine.length - 1];
  const b = to.toSpine[to.toSpine.length - 1];
  if (Math.abs(a.y - b.y) > 0.5) out.push({ x: SPINE_X, y: b.y });
  const spineIdx = out.length - 1;
  out.push(...[...to.toSpine].reverse().slice(1), { x: to.x, y: to.y });
  return { path: out, spineIdx };
}

// ---------------------------------------------------------------------------
// Ground map
// ---------------------------------------------------------------------------
export function groundMap(): TileKind[][] {
  const map: TileKind[][] = [];
  for (let r = 0; r < ROWS; r++) {
    const row: TileKind[] = [];
    for (let c = 0; c < COLS; c++) {
      const inRect = (x: number, y: number, w: number, h: number) => c >= x && c < x + w && r >= y && r < y + h;
      let k: TileKind = 'carpet';
      if (inRect(1, 2, 9, 7)) k = 'wood';          // your office
      if (inRect(1, 10, 9, 7)) k = 'kitchenTile';  // kitchen
      if (c === 11) k = 'corridor';                // corridor
      if (c === 10) k = 'glass';                   // glass partition
      if (c === 10 && (r === 5 || r === 13)) k = 'doorway';
      if (inRect(1, 9, 9, 1)) k = 'wallH';         // wall between office and kitchen
      if (r >= 18 && r <= 20 && c >= 12 && c <= COLS - 2) k = 'server';  // noční směna
      if (r === 0) k = 'wallTop';
      if (r === 1) k = 'wallBottom';
      if (c === 0 || c === COLS - 1) k = 'wallSide';
      if (r === ROWS - 1) k = c === 11 ? 'entrance' : 'wallLow';
      row.push(k);
    }
    map.push(row);
  }
  return map;
}
