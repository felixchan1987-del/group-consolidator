import type { Holding, Project } from '../types';
import { fractionFrom, fractionTo, inPeriod, openingDate } from './periods';

export type Method = 'parent' | 'full' | 'disposed' | 'equity' | 'investment' | 'none';

export const METHOD_LABELS: Record<Method, string> = {
  parent: 'Parent',
  full: 'Subsidiary — full consolidation',
  disposed: 'Subsidiary disposed in the period — results to disposal date, gain on disposal',
  equity: 'Associate — equity method',
  investment: 'Investment — cost / fair value',
  none: 'Not in group',
};

export const METHOD_SHORT: Record<Method, string> = {
  parent: 'Parent',
  full: 'Subsidiary',
  disposed: 'Disposed',
  equity: 'Associate',
  investment: 'Investment',
  none: 'Outside group',
};

export interface StructureInfo {
  method: Record<string, Method>;
  /** effective economic interest of the group (0..1); for disposed subsidiaries: just before disposal */
  effective: Record<string, number>;
  /** sum of direct holdings by parent + subsidiaries (0..1) — drives control / influence */
  groupVotes: Record<string, number>;
  /** depth from the parent for layout */
  level: Record<string, number>;
  /** share of the period's results that belongs to the group's ownership period (1 unless acquired / disposed in the period) */
  fraction: Record<string, number>;
  /** date control was obtained (acquired in period) or lost (disposed in period) */
  changeDate: Record<string, string>;
  warnings: string[];
}

/** Holding is owned on `date` (acquired on or before, not yet disposed). */
export const heldOn = (h: Holding, date: string) => (!h.acqDate || h.acqDate <= date) && (!h.disposalDate || h.disposalDate > date);

interface Snapshot {
  controlled: Set<string>;
  votes: Record<string, number>;
  effective: Record<string, number>;
}

/** Control, votes and effective interest as at one date. */
function snapshot(p: Project, date: string, parent: string | null, holdingsAll: Holding[]): Snapshot {
  const ids = p.entities.map((e) => e.id);
  const ent = new Map(p.entities.map((e) => [e.id, e]));
  const ctrl = p.settings.controlThreshold / 100;
  const holdings = holdingsAll.filter((h) => heldOn(h, date));
  const controlled = new Set<string>(parent ? [parent] : []);
  const votesInto = (id: string) => holdings.filter((h) => h.investeeId === id && controlled.has(h.holderId)).reduce((s, h) => s + h.pct / 100, 0);
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
  const votes: Record<string, number> = {};
  const effective: Record<string, number> = {};
  for (const id of ids) {
    votes[id] = id === parent ? 1 : votesInto(id);
    effective[id] = id === parent ? 1 : 0;
  }
  // Effective interest through controlled holders (fixed point iteration handles chains and cross-holdings).
  for (let iter = 0; iter < 200; iter++) {
    let delta = 0;
    for (const id of ids) {
      if (id === parent) continue;
      const g = holdings.filter((h) => h.investeeId === id && controlled.has(h.holderId)).reduce((s, h) => s + effective[h.holderId] * (h.pct / 100), 0);
      delta = Math.max(delta, Math.abs(g - effective[id]));
      effective[id] = g;
    }
    if (delta < 1e-12) break;
  }
  return { controlled, votes, effective };
}

export function analyseStructure(p: Project): StructureInfo {
  const ids = p.entities.map((e) => e.id);
  const method: Record<string, Method> = {};
  const level: Record<string, number> = {};
  const fraction: Record<string, number> = {};
  const changeDate: Record<string, string> = {};
  const warnings: string[] = [];
  const parent = p.parentId && ids.includes(p.parentId) ? p.parentId : null;
  const infl = p.settings.influenceThreshold / 100;
  const end = p.periodEnd;
  const opening = openingDate(end, p.periodStart);
  const holdings = p.holdings.filter((h) => ids.includes(h.holderId) && ids.includes(h.investeeId) && h.holderId !== h.investeeId && h.investeeId !== parent);
  if (parent && p.holdings.some((h) => h.investeeId === parent)) warnings.push('Holdings in the parent entity (e.g. reciprocal / treasury shares) are ignored.');
  if (!parent && p.entities.length) warnings.push('No parent entity selected — choose the ultimate parent on the Group Structure page.');

  for (const e of p.entities) {
    const total = holdings.filter((h) => h.investeeId === e.id && heldOn(h, end)).reduce((s, h) => s + h.pct, 0);
    if (total > 100.0001) warnings.push(`${e.name}: total shareholdings held at ${end} are ${total.toFixed(2)}% (more than 100%).`);
  }
  for (const h of holdings) if (h.disposalDate && h.acqDate && h.disposalDate <= h.acqDate) warnings.push('A shareholding has a disposal date on or before its acquisition date.');

  const atEnd = snapshot(p, end, parent, holdings);
  const atStart = snapshot(p, opening, parent, holdings);
  const effective = { ...atEnd.effective };
  const groupVotes = { ...atEnd.votes };

  // Dates inside the period when ownership changed, in order
  const changes = [...new Set(holdings.flatMap((h) => [h.acqDate, h.disposalDate]).filter((d): d is string => inPeriod(d, end, opening)))].sort();

  for (const id of ids) {
    const e = p.entities.find((x) => x.id === id)!;
    const v = atEnd.votes[id];
    fraction[id] = 1;
    if (id === parent) method[id] = 'parent';
    else if (atEnd.controlled.has(id)) {
      method[id] = 'full';
      if (!atStart.controlled.has(id)) {
        // control obtained during the period: first change date at which the entity is controlled
        const d = changes.find((c) => snapshot(p, c, parent, holdings).controlled.has(id));
        if (d) {
          changeDate[id] = d;
          fraction[id] = fractionFrom(d, end, opening);
        }
      }
    } else if (atStart.controlled.has(id) && e.method !== 'exclude') {
      // control lost during the period: first change date at which it is no longer controlled
      const d = changes.find((c) => !snapshot(p, c, parent, holdings).controlled.has(id)) ?? end;
      method[id] = 'disposed';
      changeDate[id] = d;
      fraction[id] = fractionTo(d, end, opening);
      // ownership just before control was lost
      effective[id] = atStart.effective[id];
      groupVotes[id] = atStart.votes[id];
      if (v > 0) warnings.push(`${e.name}: the group keeps ${(v * 100).toFixed(2)}% after losing control. Remeasuring the retained interest to fair value is not automated — record it with a manual journal.`);
    } else if (e.method === 'exclude' || v === 0) method[id] = 'none';
    else if (e.method === 'equity') method[id] = 'equity';
    else if (e.method === 'investment') method[id] = 'investment';
    else method[id] = v >= infl ? 'equity' : 'investment';
  }

  // Levels (longest path from parent through holdings relevant to the period) for the org chart
  const relevant = holdings.filter((h) => heldOn(h, end) || heldOn(h, opening) || inPeriod(h.acqDate, end, opening));
  for (const id of ids) level[id] = id === parent ? 0 : -1;
  for (let iter = 0; iter < ids.length + 1; iter++) {
    for (const h of relevant) {
      if (level[h.holderId] >= 0 && level[h.investeeId] < level[h.holderId] + 1 && level[h.holderId] + 1 <= ids.length) level[h.investeeId] = level[h.holderId] + 1;
    }
  }

  return { method, effective, groupVotes, level, fraction, changeDate, warnings };
}
