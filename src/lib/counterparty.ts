import type { Entity, Project } from '../types';
import { lineKey } from './util';

/** Account roles whose balances are matched company-by-company. */
export const IC_ROLES = ['ic_rec', 'ic_pay', 'ic_rev', 'ic_exp'] as const;

const STOP = new Set(['ltd', 'limited', 'inc', 'llc', 'gmbh', 'plc', 'pte', 'pty', 'bv', 'sa', 'ag', 'co', 'corp', 'company', 'group', 'holdings', 'holding', 'trading', 'the', 'and', 'of', 'international', 'services']);

const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter(Boolean);

/** Suggests which group company an intercompany account line refers to, from its name (e.g. "Due to Apex Holdings"). */
export function suggestCounterparty(lineName: string, entities: Entity[], selfId: string): string | null {
  const w = new Set(words(lineName));
  let best: { id: string; score: number } | null = null;
  let tie = false;
  for (const e of entities) {
    if (e.id === selfId) continue;
    const keys = words(e.name).filter((x) => x.length >= 3 && !STOP.has(x));
    let score = keys.filter((k) => w.has(k)).length;
    if (e.code && e.code.length >= 2 && w.has(e.code.toLowerCase())) score += 1;
    if (!score) continue;
    if (!best || score > best.score) {
      best = { id: e.id, score };
      tie = false;
    } else if (score === best.score) tie = true;
  }
  return best && !tie ? best.id : null;
}

/** Fills in missing counterparties for lines mapped to intercompany accounts. Mutates the project. */
export function autoTagCounterparties(p: Project, overwrite = false): void {
  const icCodes = new Set(p.accounts.filter((a) => a.role && (IC_ROLES as readonly string[]).includes(a.role)).map((a) => a.code));
  for (const e of p.entities) {
    e.counterparty = e.counterparty ?? {};
    for (const l of e.lines) {
      const k = lineKey(l);
      if (!icCodes.has(e.mapping[k]) || (e.counterparty[k] && !overwrite)) continue;
      const cp = suggestCounterparty(l.name, p.entities, e.id);
      if (cp) e.counterparty[k] = cp;
    }
  }
}
