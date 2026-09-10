/**
 * Kdo tě potřebuje. Jediné místo s pravidly pro frontu, počítadla, kancelář i widgety.
 *
 * - „Chce tě" (počítadla, ikona, titulek): jen dotaz na povolení, chyba a skutečná otázka (čeká).
 * - Hotové sezení se ve frontě jen ukáže, dokud ho neotevřeš v aplikaci Claude (seen),
 *   nejdéle 30 min u terminálu a 12 h u sezení z aplikace. Do počítadel se nepočítá.
 */
import type { Session, SessionStatus } from './types.ts';

export const NEEDS_YOU: SessionStatus[] = ['permission', 'error', 'waiting'];
export const COMPLETED_VISIBLE_MS = 30 * 60_000;
export const COMPLETED_VISIBLE_DESKTOP_MS = 12 * 3600_000;

const RANK: Record<SessionStatus, number> = { permission: 0, error: 1, waiting: 2, completed: 3, working: 4, idle: 5 };

export function needsYou(s: Session): boolean {
  return NEEDS_YOU.includes(s.status);
}

/** Patří sezení do fronty (seznam „chce tě" + neviděné hotové)? */
export function inQueue(s: Session, now = Date.now()): boolean {
  if (needsYou(s)) return true;
  if (s.status !== 'completed' || s.seen) return false;
  const limit = s.desktopId ? COMPLETED_VISIBLE_DESKTOP_MS : COMPLETED_VISIBLE_MS;
  return now - s.statusSince < limit;
}

/** Fronta: nejdřív dotazy, chyby a otázky, pak neviděné hotové; uvnitř nejdéle čekající první. */
export function attentionQueue(sessions: Iterable<Session>, now = Date.now()): Session[] {
  return [...sessions].filter(s => inQueue(s, now)).sort((a, b) => RANK[a.status] - RANK[b.status] || a.statusSince - b.statusSince);
}
