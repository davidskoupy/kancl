import type { Project, ProjectStatus } from './types.ts';

export interface Island { projectId: string; status: ProjectStatus; desks: number[] }

const MAX_ISLAND = 4;

/**
 * Rozdělí `deskCount` stolů mezi projekty (v pořadí, v jakém přišly ze serveru).
 * Aktivní (dotaz/práce): sezení + 1, nejvýš 4. Klidné: 1 stůl, dokud stoly jsou.
 */
export function planIslands(projects: Project[], sessionsByProject: Record<string, number>, deskCount: number): Island[] {
  const out: Island[] = [];
  let cursor = 0;
  const take = (n: number) => {
    const desks: number[] = [];
    while (desks.length < n && cursor < deskCount) desks.push(cursor++);
    return desks;
  };
  for (const p of projects) {
    if (p.status === 'klid') continue;
    const want = Math.min(MAX_ISLAND, (sessionsByProject[p.id] ?? 0) + 1);
    const desks = take(want);
    if (desks.length) out.push({ projectId: p.id, status: p.status, desks });
  }
  for (const p of projects) {
    if (p.status !== 'klid') continue;
    if (cursor >= deskCount) break;
    out.push({ projectId: p.id, status: p.status, desks: take(1) });
  }
  return out;
}

/**
 * Klíč, při jehož změně se mají postavičky přesadit: pořadí aktivních projektů a počty sezení.
 * Stav (dotaz/práce) do něj záměrně nepatří, aby se při každém dotazu nepřesazovalo.
 */
export function planKey(projects: Project[], sessionsByProject: Record<string, number>): string {
  return projects
    .filter(p => p.status !== 'klid')
    .map(p => `${p.id}:${sessionsByProject[p.id] ?? 0}`)
    .join('|');
}
