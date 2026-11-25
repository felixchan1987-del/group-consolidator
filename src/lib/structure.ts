import type { Project } from '../types';

export type Method = 'parent' | 'full' | 'equity' | 'investment' | 'none';

export const METHOD_LABELS: Record<Method, string> = {
  parent: 'Parent',
  full: 'Subsidiary — full consolidation',
  equity: 'Associate — equity method',
  investment: 'Investment — cost / fair value',
  none: 'Not in group',
};

export const METHOD_SHORT: Record<Method, string> = {
  parent: 'Parent',
  full: 'Subsidiary',
  equity: 'Associate',
  investment: 'Investment',
  none: 'Outside group',
};

export interface StructureInfo {
  method: Record<string, Method>;
  /** effective economic interest of the group (0..1) */
  effective: Record<string, number>;
  /** sum of direct holdings by parent + subsidiaries (0..1) — drives control / influence */
  groupVotes: Record<string, number>;
  /** depth from the parent for layout */
  level: Record<string, number>;
  warnings: string[];
}

export function analyseStructure(p: Project): StructureInfo {
  const ids = p.entities.map((e) => e.id);
  const method: Record<string, Method> = {};
  const effective: Record<string, number> = {};
  const groupVotes: Record<string, number> = {};
  const level: Record<string, number> = {};
  const warnings: string[] = [];
  const parent = p.parentId && ids.includes(p.parentId) ? p.parentId : null;
  const ctrl = p.settings.controlThreshold / 100;
  const infl = p.settings.influenceThreshold / 100;
  const holdings = p.holdings.filter(
    (h) => ids.includes(h.holderId) && ids.includes(h.investeeId) && h.holderId !== h.investeeId && h.investeeId !== parent,
  );
  if (p.holdings.some((h) => h.investeeId === parent && parent)) warnings.push('Holdings in the parent entity (e.g. reciprocal / treasury shares) are ignored.');

  for (const e of p.entities) {
    const total = holdings.filter((h) => h.investeeId === e.id).reduce((s, h) => s + h.pct, 0);
    if (total > 100.0001) warnings.push(`${e.name}: total recorded shareholdings are ${total.toFixed(2)}% (more than 100%).`);
  }

  const controlled = new Set<string>();
  if (parent) controlled.add(parent);
  else if (p.entities.length) warnings.push('No parent entity selected — choose the ultimate parent on the Group Structure page.');

  const ent = new Map(p.entities.map((e) => [e.id, e]));
  const votesInto = (id: string) =>
    holdings.filter((h) => h.investeeId === id && controlled.has(h.holderId)).reduce((s, h) => s + h.pct / 100, 0);

  let changed = true;
  while (changed) {
    changed = false;
    for (const id of ids) {
      if (controlled.has(id)) continue;
      const e = ent.get(id)!;
      if (e.method === 'exclude' || e.method === 'equity' || e.method === 'investment') continue;
      const v = votesInto(id);
      if (e.method === 'full' ? v > 0 : v > ctrl) {
        controlled.add(id);
        changed = true;
      }
    }
  }

  for (const id of ids) {
    const e = ent.get(id)!;
    const v = votesInto(id);
    groupVotes[id] = id === parent ? 1 : v;
    if (id === parent) method[id] = 'parent';
    else if (controlled.has(id)) method[id] = 'full';
    else if (e.method === 'exclude' || v === 0) method[id] = 'none';
    else if (e.method === 'equity') method[id] = 'equity';
    else if (e.method === 'investment') method[id] = 'investment';
    else method[id] = v >= infl ? 'equity' : 'investment';
  }

  // Effective interest through controlled holders (fixed point iteration handles chains and cross-holdings).
  for (const id of ids) effective[id] = id === parent ? 1 : 0;
  for (let iter = 0; iter < 200; iter++) {
    let delta = 0;
    for (const id of ids) {
      if (id === parent) continue;
      const g = holdings
        .filter((h) => h.investeeId === id && controlled.has(h.holderId))
        .reduce((s, h) => s + effective[h.holderId] * (h.pct / 100), 0);
      delta = Math.max(delta, Math.abs(g - effective[id]));
      effective[id] = g;
    }
    if (delta < 1e-12) break;
  }

  // Levels (longest path from parent through any holding) for the org chart
  for (const id of ids) level[id] = id === parent ? 0 : -1;
  for (let iter = 0; iter < ids.length + 1; iter++) {
    for (const h of holdings) {
      if (level[h.holderId] >= 0 && level[h.investeeId] < level[h.holderId] + 1 && level[h.holderId] + 1 <= ids.length)
        level[h.investeeId] = level[h.holderId] + 1;
    }
  }

  return { method, effective, groupVotes, level, warnings };
}
