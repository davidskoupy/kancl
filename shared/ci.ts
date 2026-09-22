import type { CiState } from './types.ts';

/** Nasazení, které padá déle než týden, už není novinka — Kancl ho ztlumí, ať varování něco znamená. */
export const CI_STALE_MS = 7 * 24 * 3600_000;

export function isCiStale(ci: Pick<CiState, 'status' | 'at'> | undefined, now = Date.now()): boolean {
  if (!ci || ci.status !== 'fail' || !ci.at) return false;
  return now - ci.at > CI_STALE_MS;
}
