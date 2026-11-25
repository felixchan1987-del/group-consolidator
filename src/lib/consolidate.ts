import type { Entity, GroupAccount, Project } from '../types';
import { accountByRole, sortAccounts } from './coa';
import { analyseStructure, type Method, type StructureInfo } from './structure';
import { lineKey } from './util';

/** Balances are always debit-positive internally. */
export type Balances = Record<string, number>;

export const UNMAPPED = '__unmapped';

export type AdjColumn = 'assoc' | 'ic' | 'invest' | 'manual';

export const ADJ_LABELS: Record<AdjColumn, string> = {
  assoc: 'Equity accounting',
  ic: 'Intercompany elim.',
  invest: 'Investment elim. & NCI',
  manual: 'Manual journals',
};

export interface Posting {
  account: string;
  amount: number;
}

export interface Journal {
  id: string;
  column: AdjColumn;
  description: string;
  postings: Posting[];
}

export interface Check {
  level: 'ok' | 'warn' | 'error';
  message: string;
}

export interface TranslationInfo {
  entityId: string;
  localSum: number;
  cta: number;
  unmappedCount: number;
  local: Balances;
  translated: Balances;
}

export interface SubSchedule {
  entityId: string;
  name: string;
  effective: number;
  nciPct: number;
  equityExFx: number;
  fctr: number;
  profit: number;
  holdings: { holderId: string; holderName: string; pct: number; holderEffective: number; cost: number; acqEquity: number; goodwill: number }[];
  goodwill: number;
  bargain: number;
  nciOpening: number;
  nciProfit: number;
  nciClosing: number;
  postAcqToGroup: number;
}

export interface AssocSchedule {
  entityId: string;
  name: string;
  groupVotes: number;
  equity: number;
  profit: number;
  pickups: { holderId: string; holderName: string; pct: number; cost: number; acqEquity: number; reserves: number; profit: number }[];
}

export interface ConsolidationResult {
  structure: StructureInfo;
  accounts: GroupAccount[];
  consolidatedIds: string[];
  translation: Record<string, TranslationInfo>;
  journals: Journal[];
  columns: { key: string; label: string; kind: 'entity' | 'adj' | 'total' }[];
  rows: { code: string; name: string; type: string; values: Record<string, number> }[];
  consolidated: Balances;
  subsidiaries: SubSchedule[];
  associates: AssocSchedule[];
  profit: { total: number; nci: number; owners: number };
  nciTotal: number;
  checks: Check[];
}

const EPS = 0.5;

function add(b: Balances, acc: string, amt: number) {
  if (!amt) return;
  b[acc] = (b[acc] ?? 0) + amt;
}

export function signedAmount(amount: number, sign: 'dr' | 'cr' | 'natural', type?: string): number {
  if (sign === 'dr') return amount;
  if (sign === 'cr') return -amount;
  return type === 'asset' || type === 'expense' || !type ? amount : -amount;
}

export function translateEntity(e: Entity, accounts: GroupAccount[], presentation: string): TranslationInfo {
  const accMap = new Map(accounts.map((a) => [a.code, a]));
  const fx = e.currency === presentation ? { closing: 1, average: 1, historical: 1 } : e.rates;
  const local: Balances = {};
  const translated: Balances = {};
  let localSum = 0;
  let translatedSum = 0;
  let unmappedCount = 0;
  for (const l of e.lines) {
    const code = e.mapping[lineKey(l)];
    const acc = code ? accMap.get(code) : undefined;
    const key = acc ? acc.code : UNMAPPED;
    if (!acc) unmappedCount++;
    const amt = signedAmount(l.amount, l.sign, acc?.type);
    const rate = !acc || acc.type === 'asset' || acc.type === 'liability' ? fx.closing : acc.type === 'equity' ? fx.historical : fx.average;
    add(local, key, amt);
    add(translated, key, amt * rate);
    localSum += amt;
    translatedSum += amt * rate;
  }
  // Translation difference goes to FCTR. Any imbalance in the local TB is left visible (translated at closing rate).
  const cta = -(translatedSum - localSum * fx.closing);
  const fctr = accountByRole(accounts, 'fctr');
  if (fctr && Math.abs(cta) > 1e-9) add(translated, fctr.code, cta);
  return { entityId: e.id, localSum, cta, unmappedCount, local, translated };
}

/** Equity (credit positive) split: equity excl. FCTR & NCI, FCTR, and profit for the period. */
function equityParts(b: Balances, accounts: GroupAccount[]) {
  let equityExFx = 0,
    fctr = 0,
    profit = 0;
  for (const a of accounts) {
    const v = b[a.code] ?? 0;
    if (a.type === 'equity') {
      if (a.role === 'fctr') fctr -= v;
      else if (a.role !== 'nci') equityExFx -= v;
    } else if (a.type === 'revenue' || a.type === 'expense') profit -= v;
  }
  return { equityExFx, fctr, profit };
}

export function consolidate(p: Project): ConsolidationResult {
  const accounts = sortAccounts(p.accounts);
  const structure = analyseStructure(p);
  const checks: Check[] = structure.warnings.map((m) => ({ level: 'warn' as const, message: m }));
  const ent = new Map(p.entities.map((e) => [e.id, e]));
  const name = (id: string) => ent.get(id)?.name ?? '?';
  const role = (r: Parameters<typeof accountByRole>[1]) => accountByRole(accounts, r)?.code;
  const required = ['goodwill', 'inv_sub', 'inv_assoc', 'retained', 'fctr', 'nci', 'share_assoc'] as const;
  for (const r of required) if (!role(r)) checks.push({ level: 'error', message: `Group chart of accounts has no account with role "${r}".` });

  const m = structure.method;
  const consolidatedIds = p.entities
    .filter((e) => m[e.id] === 'parent' || m[e.id] === 'full')
    .sort((a, b) => (structure.level[a.id] ?? 99) - (structure.level[b.id] ?? 99))
    .map((e) => e.id);
  const isCons = (id: string) => consolidatedIds.includes(id);

  // 1. Translate every entity
  const translation: Record<string, TranslationInfo> = {};
  for (const e of p.entities) {
    translation[e.id] = translateEntity(e, accounts, p.presentationCurrency);
    const t = translation[e.id];
    const relevant = m[e.id] !== 'none' && m[e.id] !== 'investment';
    if (!relevant) continue;
    if (!e.lines.length) checks.push({ level: m[e.id] === 'equity' ? 'warn' : 'error', message: `${e.name}: no trial balance imported.` });
    else if (Math.abs(t.localSum) > EPS)
      checks.push({ level: 'error', message: `${e.name}: trial balance does not balance (difference ${t.localSum.toFixed(2)} ${e.currency}).` });
    if (t.unmappedCount) checks.push({ level: 'error', message: `${e.name}: ${t.unmappedCount} account line(s) not mapped to the group chart of accounts.` });
    if (e.currency !== p.presentationCurrency && e.rates.closing === 1 && e.rates.average === 1)
      checks.push({ level: 'warn', message: `${e.name}: ${e.currency} → ${p.presentationCurrency} exchange rates are still 1.0.` });
  }

  const journals: Journal[] = [];
  // Working balances per consolidated entity (translated + equity-accounting pickups) used for NCI calcs
  const working: Record<string, Balances> = {};
  for (const id of consolidatedIds) working[id] = { ...translation[id].translated };

  // 2. Equity accounting for associates (posted at holder level so the holder's NCI shares in it)
  const associates: AssocSchedule[] = [];
  for (const e of p.entities.filter((x) => m[x.id] === 'equity')) {
    const parts = equityParts(translation[e.id].translated, accounts);
    const sched: AssocSchedule = { entityId: e.id, name: e.name, groupVotes: structure.groupVotes[e.id], equity: parts.equityExFx + parts.fctr, profit: parts.profit, pickups: [] };
    for (const h of p.holdings.filter((x) => x.investeeId === e.id && isCons(x.holderId))) {
      const f = h.pct / 100;
      const acq = h.acqEquity ?? sched.equity;
      const reserves = f * (sched.equity - acq);
      const profit = f * parts.profit;
      sched.pickups.push({ holderId: h.holderId, holderName: name(h.holderId), pct: f, cost: h.cost, acqEquity: acq, reserves, profit });
      const postings: Posting[] = [
        { account: role('inv_assoc')!, amount: reserves + profit },
        { account: role('retained')!, amount: -reserves },
        { account: role('share_assoc')!, amount: -profit },
      ].filter((x) => x.account && Math.abs(x.amount) > 1e-9);
      if (postings.length) {
        journals.push({ id: `assoc_${h.id}`, column: 'assoc', description: `Equity accounting: ${name(h.holderId)}'s ${(f * 100).toFixed(2)}% share of ${e.name}`, postings });
        for (const ps of postings) add(working[h.holderId], ps.account, ps.amount);
      }
    }
    associates.push(sched);
  }

  // 3. Elimination of investments in subsidiaries, goodwill and NCI (effective-interest method, proportionate NCI)
  const subsidiaries: SubSchedule[] = [];
  let nciProfitTotal = 0;
  for (const sid of consolidatedIds) {
    if (m[sid] !== 'full') continue;
    const s = ent.get(sid)!;
    const b = working[sid];
    const { equityExFx, fctr, profit } = equityParts(b, accounts);
    const g = structure.effective[sid];
    const holds = p.holdings.filter((h) => h.investeeId === sid && isCons(h.holderId));
    const sched: SubSchedule = {
      entityId: sid,
      name: s.name,
      effective: g,
      nciPct: 1 - g,
      equityExFx,
      fctr,
      profit,
      holdings: [],
      goodwill: 0,
      bargain: 0,
      nciOpening: 0,
      nciProfit: (1 - g) * profit,
      nciClosing: 0,
      postAcqToGroup: 0,
    };
    const postings: Posting[] = [];
    // Remove the subsidiary's own equity (except NCI) and the NCI share of its FCTR
    for (const a of accounts) {
      if (a.type !== 'equity' || a.role === 'nci') continue;
      const v = b[a.code] ?? 0;
      if (!v) continue;
      postings.push({ account: a.code, amount: a.role === 'fctr' ? -v * (1 - g) : -v });
    }
    let indirectAdj = 0;
    for (const h of holds) {
      const f = h.pct / 100;
      const gh = structure.effective[h.holderId];
      const acq = h.acqEquity ?? equityExFx;
      const gw = gh * (h.cost - f * acq);
      sched.holdings.push({ holderId: h.holderId, holderName: name(h.holderId), pct: f, holderEffective: gh, cost: h.cost, acqEquity: acq, goodwill: gw });
      postings.push({ account: role('inv_sub')!, amount: -h.cost });
      if (gw >= 0) sched.goodwill += gw;
      else sched.bargain += -gw;
      sched.postAcqToGroup += gh * f * (equityExFx - acq);
      indirectAdj += (1 - gh) * h.cost;
      if (h.cost === 0) checks.push({ level: 'warn', message: `${name(h.holderId)} → ${s.name}: cost of investment is 0.` });
    }
    sched.nciOpening = (1 - g) * (equityExFx + fctr) - indirectAdj;
    sched.nciClosing = sched.nciOpening + sched.nciProfit;
    if (sched.goodwill) postings.push({ account: role('goodwill')!, amount: sched.goodwill });
    if (sched.bargain) {
      postings.push({ account: role('retained')!, amount: -sched.bargain });
      checks.push({ level: 'warn', message: `${s.name}: negative goodwill (bargain purchase) of ${sched.bargain.toFixed(0)} credited to retained earnings — review fair values.` });
    }
    postings.push({ account: role('nci')!, amount: -sched.nciOpening });
    postings.push({ account: role('retained')!, amount: -sched.postAcqToGroup });
    const balance = postings.reduce((x, y) => x + y.amount, 0);
    if (Math.abs(balance) > 0.01) checks.push({ level: 'error', message: `${s.name}: elimination entry out of balance by ${balance.toFixed(2)}.` });
    journals.push({ id: `inv_${sid}`, column: 'invest', description: `Eliminate investment in ${s.name}; goodwill and NCI (${((1 - g) * 100).toFixed(2)}%)`, postings: mergePostings(postings) });
    nciProfitTotal += sched.nciProfit;
    subsidiaries.push(sched);
  }

  // 4. Intercompany eliminations (on aggregated consolidated entities)
  const agg: Balances = {};
  for (const id of consolidatedIds) for (const [k, v] of Object.entries(working[id])) add(agg, k, v);
  if (p.settings.autoEliminateIC) {
    const sumRole = (r: string) => accounts.filter((a) => a.role === r).reduce((s, a) => s + (agg[a.code] ?? 0), 0);
    const pairs: [string, string, string][] = [
      ['ic_rec', 'ic_pay', 'Eliminate intercompany receivables / payables'],
      ['ic_exp', 'ic_rev', 'Eliminate intercompany revenue / expenses'],
    ];
    for (const [drRole, crRole, desc] of pairs) {
      const dr = sumRole(drRole); // debit balance expected
      const cr = -sumRole(crRole); // credit balance expected
      const drAcc = role(drRole as never),
        crAcc = role(crRole as never);
      if (!drAcc || !crAcc) continue;
      const amt = Math.min(Math.max(dr, 0), Math.max(cr, 0));
      if (amt > 0)
        journals.push({ id: `ic_${drRole}`, column: 'ic', description: desc, postings: [{ account: crAcc, amount: amt }, { account: drAcc, amount: -amt }] });
      if (Math.abs(dr - cr) > EPS)
        checks.push({ level: 'warn', message: `${desc.replace('Eliminate ', '')}: mismatch of ${(dr - cr).toFixed(2)} ${p.presentationCurrency} left in the consolidated accounts.` });
      else if (dr || cr) checks.push({ level: 'ok', message: `${desc.replace('Eliminate ', '')} agree (${amt.toFixed(0)}).` });
    }
  }

  // 5. Manual journals
  const validCodes = new Set(accounts.map((a) => a.code));
  for (const j of p.journals) {
    const postings = j.lines.filter((l) => l.account && (l.debit || l.credit)).map((l) => ({ account: l.account, amount: (l.debit || 0) - (l.credit || 0) }));
    if (!postings.length) continue;
    const bal = postings.reduce((s, x) => s + x.amount, 0);
    if (Math.abs(bal) > 0.005) checks.push({ level: 'error', message: `Manual journal "${j.description || 'untitled'}" does not balance (${bal.toFixed(2)}).` });
    if (postings.some((x) => !validCodes.has(x.account))) checks.push({ level: 'error', message: `Manual journal "${j.description}" uses an unknown account.` });
    journals.push({ id: j.id, column: 'manual', description: j.description || 'Manual journal', postings });
  }

  // 6. Build worksheet
  const consolidated: Balances = {};
  const colVals: Record<string, Balances> = {};
  for (const id of consolidatedIds) {
    colVals[id] = translation[id].translated;
    for (const [k, v] of Object.entries(colVals[id])) add(consolidated, k, v);
  }
  for (const c of Object.keys(ADJ_LABELS) as AdjColumn[]) colVals[c] = {};
  for (const j of journals)
    for (const ps of j.postings) {
      add(colVals[j.column], ps.account, ps.amount);
      add(consolidated, ps.account, ps.amount);
    }
  colVals.total = consolidated;

  const columns: ConsolidationResult['columns'] = [
    ...consolidatedIds.map((id) => ({ key: id, label: ent.get(id)!.code || ent.get(id)!.name, kind: 'entity' as const })),
    ...(Object.keys(ADJ_LABELS) as AdjColumn[]).map((c) => ({ key: c, label: ADJ_LABELS[c], kind: 'adj' as const })),
    { key: 'total', label: 'Consolidated', kind: 'total' as const },
  ];
  const rows: ConsolidationResult['rows'] = accounts.map((a) => ({
    code: a.code,
    name: a.name,
    type: a.type,
    values: Object.fromEntries(columns.map((c) => [c.key, colVals[c.key][a.code] ?? 0])),
  }));
  if (columns.some((c) => Math.abs(colVals[c.key][UNMAPPED] ?? 0) > 1e-9))
    rows.push({ code: '—', name: 'Unmapped balances', type: 'asset', values: Object.fromEntries(columns.map((c) => [c.key, colVals[c.key][UNMAPPED] ?? 0])) });

  const totalProfit = equityParts(consolidated, accounts).profit;
  const nciAcc = role('nci');
  const nciTotal = -(nciAcc ? consolidated[nciAcc] ?? 0 : 0) + nciProfitTotal;
  const totalCheck = Object.values(consolidated).reduce((s, v) => s + v, 0);
  if (consolidatedIds.length) {
    if (Math.abs(totalCheck) > EPS) checks.push({ level: 'error', message: `Consolidated balance sheet does not balance (difference ${totalCheck.toFixed(2)}).` });
    else checks.push({ level: 'ok', message: 'Consolidated balance sheet balances.' });
    const invRes = role('inv_sub') ? consolidated[role('inv_sub')!] ?? 0 : 0;
    if (Math.abs(invRes) > EPS)
      checks.push({ level: 'warn', message: `Investments in subsidiaries has a residual of ${invRes.toFixed(2)} after elimination — check that the cost per holding matches the holder's ledger.` });
  }
  if (!checks.some((c) => c.level !== 'ok') && consolidatedIds.length) checks.push({ level: 'ok', message: 'All checks passed.' });

  return {
    structure,
    accounts,
    consolidatedIds,
    translation,
    journals,
    columns,
    rows,
    consolidated,
    subsidiaries,
    associates,
    profit: { total: totalProfit, nci: nciProfitTotal, owners: totalProfit - nciProfitTotal },
    nciTotal,
    checks,
  };
}

function mergePostings(ps: Posting[]): Posting[] {
  const m = new Map<string, number>();
  for (const p of ps) m.set(p.account, (m.get(p.account) ?? 0) + p.amount);
  return [...m.entries()].filter(([, v]) => Math.abs(v) > 1e-9).map(([account, amount]) => ({ account, amount }));
}

export type { Method };
