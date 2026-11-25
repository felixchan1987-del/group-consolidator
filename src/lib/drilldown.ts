import { UNMAPPED, type ConsolidationResult, type LineDetail } from './consolidate';

export interface DrillEntity {
  entityId: string;
  entityName: string;
  currency: string;
  lines: LineDetail[];
  /** translation difference posted by the engine (FCTR account only) */
  cta: number;
  total: number;
}

export interface DrillJournal {
  id: string;
  description: string;
  column: string;
  amount: number;
}

export interface Drill {
  account: string;
  accountName: string;
  entities: DrillEntity[];
  journals: DrillJournal[];
  /** debit-positive; equals the worksheet cell */
  total: number;
}

/**
 * Everything that makes up one worksheet cell: the source trial balance lines (with translation) of the consolidated
 * entities, and the consolidation journals posted to the account.
 * column: an entity id, an adjustment column key ('assoc' | 'ic' | 'invest' | 'manual') or 'total' (default).
 */
export function drill(r: ConsolidationResult, account: string, column = 'total', entityNames: Record<string, { name: string; currency: string }> = {}): Drill {
  const acc = r.accounts.find((a) => a.code === account);
  const fctr = r.accounts.find((a) => a.role === 'fctr')?.code;
  const entities: DrillEntity[] = [];
  const ids = column === 'total' ? r.consolidatedIds : r.consolidatedIds.includes(column) ? [column] : [];
  for (const id of ids) {
    const t = r.translation[id];
    const lines = t.details.filter((d) => d.account === account);
    const cta = account === fctr ? t.cta : 0;
    if (!lines.length && !cta) continue;
    entities.push({
      entityId: id,
      entityName: entityNames[id]?.name ?? id,
      currency: entityNames[id]?.currency ?? '',
      lines,
      cta,
      total: lines.reduce((s, l) => s + l.translated, 0) + cta,
    });
  }
  const journals: DrillJournal[] = [];
  for (const j of r.journals) {
    if (column !== 'total' && j.column !== column) continue;
    const amount = j.postings.filter((p) => p.account === account).reduce((s, p) => s + p.amount, 0);
    if (Math.abs(amount) > 1e-9) journals.push({ id: j.id, description: j.description, column: j.column, amount });
  }
  const total = entities.reduce((s, e) => s + e.total, 0) + journals.reduce((s, j) => s + j.amount, 0);
  return { account, accountName: account === UNMAPPED ? 'Unmapped balances' : acc?.name ?? account, entities, journals, total };
}
