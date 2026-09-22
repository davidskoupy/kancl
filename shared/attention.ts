/**
 * Kdo tě potřebuje. Jediné místo s pravidly pro frontu, počítadla, kancelář i widgety.
 *
 * - „Chce tě" (počítadla, ikona, titulek): jen dotaz na povolení, chyba a skutečná otázka (čeká).
 * - Hotové sezení se ve frontě jen ukáže, dokud ho neotevřeš v aplikaci Claude (seen),
 *   nejdéle 30 min u terminálu a 12 h u sezení z aplikace. Do počítadel se nepočítá.
 */
import type { Session, SessionStatus } from './types.ts';

export const NEEDS_YOU: SessionStatus[] = ['permission', 'error', 'waiting'];
/** Dokončené sezení zmizí z fronty po hodině, i když ses na něj nepodíval. */
export const COMPLETED_VISIBLE_MS = 60 * 60_000;

const RANK: Record<SessionStatus, number> = { permission: 0, error: 1, waiting: 2, completed: 3, working: 4, idle: 5 };

export function needsYou(s: Session): boolean {
  return NEEDS_YOU.includes(s.status);
}

/** Do kdy se dokončené sezení ještě ukazuje (nastavuje se při Stop). */
function hideAt(s: Session): number {
  return s.autoHideAt ?? s.statusSince + COMPLETED_VISIBLE_MS;
}

/** Patří sezení do fronty (seznam „chce tě" + čerstvě hotové)? */
export function inQueue(s: Session, now = Date.now()): boolean {
  if (s.status === 'completed') return !s.seen && now < hideAt(s);
  if (!needsYou(s)) return false;
  // „čeká" vzniklé eskalací z hotového má také svůj čas vypršení; skutečná otázka ne
  if (s.status === 'waiting' && s.autoHideAt !== undefined) return now < s.autoHideAt;
  return true;
}

/** Fronta: nejdřív dotazy, chyby a otázky, pak neviděné hotové; uvnitř nejdéle čekající první. */
export function attentionQueue(sessions: Iterable<Session>, now = Date.now()): Session[] {
  return [...sessions].filter(s => inQueue(s, now)).sort((a, b) => RANK[a.status] - RANK[b.status] || a.statusSince - b.statusSince);
}
