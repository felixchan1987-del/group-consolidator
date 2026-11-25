import type { Entity, GroupAccount, Project } from '../types';
import { accountByRole, sortAccounts } from './coa';
import { analyseStructure, heldOn, type Method, type StructureInfo } from './structure';
import { fractionFrom, inPeriod, openingDate } from './periods';
import { lineKey } from './util';
import { IC_ROLES } from './counterparty';

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
  /** intercompany amounts: role -> counterparty id ('' = not tagged) -> account -> translated amount */
  ic: Record<string, Record<string, Balances>>;
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

export interface DisposalSchedule {
  entityId: string;
  name: string;
  date: string;
  /** share of the period's results consolidated (to disposal date) */
  fraction: number;
  effective: number;
  proceeds: number;
  cost: number;
  /** net assets at disposal = opening equity + FCTR + profit to disposal */
  netAssets: number;
  goodwill: number;
  nciDerecognised: number;
  fctrRecycled: number;
  /** gain in the holders' own books (proceeds - cost) */
  entityGain: number;
  /** consolidated gain */
  groupGain: number;
}

export interface DividendElimination {
  payerId: string;
  payerName: string;
  holderId: string;
  holderName: string;
  /** dividends declared by the payer x holding % */
  amount: number;
}

export interface UrpResult {
  id: string;
  sellerName: string;
  buyerName: string;
  closingUrp: number;
  openingUrp: number;
  /** share borne by NCI (upstream sales by partly owned subsidiaries) */
  nciShare: number;
}

export interface IcReconRow {
  kind: 'balance' | 'pl';
  /** company showing the receivable (balance) or the expense (P&L) */
  debitId: string;
  debitName: string;
  debitAmount: number;
  /** company showing the payable (balance) or the revenue (P&L) */
  creditId: string;
  creditName: string;
  creditAmount: number;
  eliminated: number;
  difference: number;
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
  disposals: DisposalSchedule[];
  dividends: DividendElimination[];
  urp: UrpResult[];
  icRecon: IcReconRow[];
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
  const ic: TranslationInfo['ic'] = {};
  for (const l of e.lines) {
    const code = e.mapping[lineKey(l)];
    const acc = code ? accMap.get(code) : undefined;
    const key = acc ? acc.code : UNMAPPED;
    if (!acc) unmappedCount++;
    const amt = signedAmount(l.amount, l.sign, acc?.type);
    const rate = !acc || acc.type === 'asset' || acc.type === 'liability' ? fx.closing : acc.type === 'equity' ? fx.historical : fx.average;
    add(local, key, amt);
    add(translated, key, amt * rate);
    if (acc?.role && (IC_ROLES as readonly string[]).includes(acc.role)) {
      const cp = e.counterparty?.[lineKey(l)] ?? '';
      const byCp = (ic[acc.role] ??= {});
      add((byCp[cp] ??= {}), acc.code, amt * rate);
    }
    localSum += amt;
    translatedSum += amt * rate;
  }
  // Translation difference goes to FCTR. Any imbalance in the local TB is left visible (translated at closing rate).
  const cta = -(translatedSum - localSum * fx.closing);
  const fctr = accountByRole(accounts, 'fctr');
  if (fctr && Math.abs(cta) > 1e-9) add(translated, fctr.code, cta);
  return { entityId: e.id, localSum, cta, unmappedCount, local, translated, ic };
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
    .filter((e) => m[e.id] === 'parent' || m[e.id] === 'full' || m[e.id] === 'disposed')
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
  const end = p.periodEnd;
  const opening = openingDate(end);
  const plAccounts = accounts.filter((a) => a.type === 'revenue' || a.type === 'expense');

  // 1b. Entities that joined or left the group during the period: keep only the results for the time in the group.
  //     The excluded part is moved into the entity's retained earnings (pre-acquisition reserves / derecognised on disposal).
  for (const id of consolidatedIds) {
    const f = structure.fraction[id] ?? 1;
    const e = ent.get(id)!;
    if (f >= 1 || !structure.changeDate[id]) continue;
    const date = structure.changeDate[id];
    const acquired = m[id] === 'full';
    if (e.partialPeriodTB) {
      checks.push({ level: 'ok', message: `${e.name}: ${acquired ? 'acquired' : 'disposed of'} on ${date}; its trial balance is marked as covering only the time in the group.` });
      continue;
    }
    const b = working[id];
    const postings: Posting[] = [];
    let plSum = 0;
    for (const a of plAccounts) {
      const v = b[a.code] ?? 0;
      if (!v) continue;
      postings.push({ account: a.code, amount: -(1 - f) * v });
      plSum += v;
    }
    if (role('retained') && plSum) postings.push({ account: role('retained')!, amount: (1 - f) * plSum });
    if (!postings.length) continue;
    journals.push({
      id: `apportion_${id}`,
      column: 'invest',
      description: acquired
        ? `Exclude pre-acquisition results of ${e.name} (acquired ${date}; ${(f * 100).toFixed(1)}% of the period consolidated)`
        : `Exclude results of ${e.name} after disposal on ${date} (${(f * 100).toFixed(1)}% of the period consolidated)`,
      postings,
    });
    for (const ps of postings) add(b, ps.account, ps.amount);
    checks.push({ level: 'ok', message: `${e.name}: ${acquired ? 'acquired' : 'disposed of'} on ${date}; results time-apportioned (${(f * 100).toFixed(1)}% of the period).` });
  }

  // 1c. Intra-group dividends: the holder's dividend income is replaced by a credit to its retained earnings.
  //     Posted at holder level, so NCI of a partly owned holder and the payer's reduced equity both come out right.
  const dividends: DividendElimination[] = [];
  const divPaid = accounts.filter((a) => a.role === 'div_paid').map((a) => a.code);
  const icDiv = role('ic_div');
  if (p.settings.autoEliminateDividends !== false && divPaid.length && icDiv && role('retained')) {
    const expected: Record<string, number> = {};
    for (const payer of p.entities) {
      const pm = m[payer.id];
      if (pm !== 'full' && pm !== 'disposed' && pm !== 'equity') continue;
      const src = working[payer.id] ?? translation[payer.id].translated;
      const declared = divPaid.reduce((t, c) => t + (src[c] ?? 0), 0); // debit balance
      if (declared <= 0.005) continue;
      const holds = p.holdings.filter(
        (h) => h.investeeId === payer.id && (m[h.holderId] === 'parent' || m[h.holderId] === 'full') && (heldOn(h, end) || (pm === 'disposed' && heldOn(h, opening))),
      );
      for (const h of holds) {
        const amount = declared * (h.pct / 100);
        dividends.push({ payerId: payer.id, payerName: payer.name, holderId: h.holderId, holderName: name(h.holderId), amount });
        expected[h.holderId] = (expected[h.holderId] ?? 0) + amount;
        const postings: Posting[] = [
          { account: icDiv, amount },
          { account: role('retained')!, amount: -amount },
        ];
        journals.push({ id: `div_${h.id}`, column: 'ic', description: `Eliminate dividend from ${payer.name} received by ${name(h.holderId)} (${h.pct}% of ${declared.toFixed(0)})`, postings });
        for (const ps of postings) add(working[h.holderId], ps.account, ps.amount);
      }
    }
    for (const id of consolidatedIds) {
      const recorded = -(translation[id].translated[icDiv] ?? 0);
      const exp = expected[id] ?? 0;
      if (Math.abs(recorded - exp) > EPS)
        checks.push({
          level: 'warn',
          message: `${name(id)} recorded intra-group dividend income of ${recorded.toFixed(0)}, but group companies declared ${exp.toFixed(0)} to it — check the mapping of dividend accounts (payer: "Dividends declared", receiver: "Dividend income from group companies").`,
        });
    }
  }

  // 1d. Unrealised profit in inventory, posted at the seller's level so NCI bears its share of upstream sales.
  const urp: UrpResult[] = [];
  const cogs = role('cogs'),
    inventory = role('inventory');
  for (const u of p.urp ?? []) {
    const factor = u.basis === 'markup' ? u.rate / (100 + u.rate) : u.rate / 100;
    const closingUrp = (u.closingInventory || 0) * factor;
    const openingUrp = (u.openingInventory || 0) * factor;
    if (!closingUrp && !openingUrp) continue;
    const both = isCons(u.sellerId) && isCons(u.buyerId) && m[u.sellerId] !== 'disposed' && m[u.buyerId] !== 'disposed';
    if (!both) {
      checks.push({ level: 'warn', message: `Unrealised profit "${u.description || `${name(u.sellerId)} → ${name(u.buyerId)}`}": seller and buyer must both be consolidated subsidiaries; URP with associates is not automated.` });
      continue;
    }
    if (!cogs || !inventory || !role('retained')) {
      checks.push({ level: 'error', message: 'Unrealised profit needs group accounts with the roles "cogs", "inventory" and "retained".' });
      break;
    }
    const postings: Posting[] = [
      { account: cogs, amount: closingUrp - openingUrp },
      { account: inventory, amount: -closingUrp },
      { account: role('retained')!, amount: openingUrp },
    ].filter((x) => Math.abs(x.amount) > 1e-9);
    journals.push({ id: `urp_${u.id}`, column: 'ic', description: `Unrealised profit in inventory: ${name(u.sellerId)} → ${name(u.buyerId)}${u.description ? ` (${u.description})` : ''}`, postings });
    for (const ps of postings) add(working[u.sellerId], ps.account, ps.amount);
    urp.push({ id: u.id, sellerName: name(u.sellerId), buyerName: name(u.buyerId), closingUrp, openingUrp, nciShare: (1 - structure.effective[u.sellerId]) * (closingUrp - openingUrp) });
  }

  // 2. Equity accounting for associates (posted at holder level so the holder's NCI shares in it)
  const associates: AssocSchedule[] = [];
  for (const e of p.entities.filter((x) => m[x.id] === 'equity')) {
    const parts = equityParts(translation[e.id].translated, accounts);
    const sched: AssocSchedule = { entityId: e.id, name: e.name, groupVotes: structure.groupVotes[e.id], equity: parts.equityExFx + parts.fctr, profit: parts.profit, pickups: [] };
    for (const h of p.holdings.filter((x) => x.investeeId === e.id && isCons(x.holderId) && m[x.holderId] !== 'disposed')) {
      if (inPeriod(h.disposalDate, end))
        checks.push({ level: 'warn', message: `${name(h.holderId)} sold shares in associate ${e.name} during the period — record the disposal with a manual journal.` });
      if (!heldOn(h, end)) continue;
      const f = h.pct / 100;
      const acq = h.acqEquity ?? sched.equity;
      // bought during the period: only the post-acquisition share of profit; the rest is in the acquired net assets
      const post = inPeriod(h.acqDate, end) ? fractionFrom(h.acqDate, end) : 1;
      const profit = f * parts.profit * post;
      const reserves = f * (sched.equity + parts.profit - acq) - profit;
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
    const holds = p.holdings.filter((h) => h.investeeId === sid && isCons(h.holderId) && m[h.holderId] !== 'disposed' && heldOn(h, end));
    for (const h of p.holdings.filter((x) => x.investeeId === sid && inPeriod(x.disposalDate, end)))
      checks.push({ level: 'warn', message: `${name(h.holderId)} sold part of ${s.name} without losing control — the change in NCI is an equity transaction; record it with a manual journal.` });
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

  // 3b. Subsidiaries disposed of during the period (loss of control)
  const disposals: DisposalSchedule[] = [];
  for (const sid of consolidatedIds) {
    if (m[sid] !== 'disposed') continue;
    const s = ent.get(sid)!;
    const b = working[sid];
    const g = structure.effective[sid];
    const { equityExFx: e0, fctr: f0 } = equityParts(translation[sid].translated, accounts); // opening equity, FCTR
    const pIn = equityParts(b, accounts).profit; // results up to disposal
    const held = p.holdings.filter((h) => h.investeeId === sid && isCons(h.holderId) && heldOn(h, opening));
    const sold = held.filter((h) => inPeriod(h.disposalDate, end));
    let r0 = 0,
      goodwill = 0,
      indirect = 0;
    for (const h of held) {
      const gh = structure.effective[h.holderId];
      const acq = h.acqEquity ?? e0;
      r0 += gh * (h.pct / 100) * (e0 - acq);
      goodwill += gh * (h.cost - (h.pct / 100) * acq);
      indirect += (1 - gh) * h.cost;
    }
    const proceeds = sold.reduce((t, h) => t + (h.proceeds ?? 0), 0);
    const cost = sold.reduce((t, h) => t + h.cost, 0);
    const entityGain = proceeds - cost;
    const groupGain = entityGain - g * pIn - r0;
    const netAssets = e0 + f0 + pIn;
    const nciDerecognised = (1 - g) * netAssets - indirect;
    const postings: Posting[] = [];
    // derecognise all assets, liabilities and equity of the subsidiary (incl. its whole FCTR: group share recycled to profit)
    for (const a of accounts) {
      if (a.type === 'revenue' || a.type === 'expense' || a.role === 'nci') continue;
      const v = b[a.code] ?? 0;
      if (v) postings.push({ account: a.code, amount: -v });
    }
    if (b[UNMAPPED]) postings.push({ account: UNMAPPED, amount: -b[UNMAPPED] });
    postings.push({ account: role('nci')!, amount: (1 - g) * pIn }); // NCI's share of profit to disposal leaves with the subsidiary
    postings.push({ account: role('retained')!, amount: -r0 }); // group share of post-acquisition reserves at the start of the period
    const gainAcc = role('disposal_gain');
    if (!gainAcc) checks.push({ level: 'error', message: 'Group chart of accounts has no account with role "disposal_gain" (needed for disposals).' });
    else postings.push({ account: gainAcc, amount: entityGain - groupGain }); // replace the holder's gain with the group gain
    if (!sold.length) checks.push({ level: 'warn', message: `${s.name}: control lost on ${structure.changeDate[sid]} without a recorded sale — enter the disposal date and proceeds on the shareholding.` });
    if (sold.some((h) => !h.proceeds)) checks.push({ level: 'warn', message: `${s.name}: disposal proceeds are 0 — enter the sale proceeds on the shareholding.` });
    const balance = postings.reduce((x, y) => x + y.amount, 0);
    if (Math.abs(balance) > 0.01) checks.push({ level: 'error', message: `${s.name}: disposal entry out of balance by ${balance.toFixed(2)}.` });
    journals.push({
      id: `disp_${sid}`,
      column: 'invest',
      description: `Disposal of ${s.name} on ${structure.changeDate[sid]}: derecognise net assets and NCI; group gain ${groupGain.toFixed(0)} replaces the holder's gain ${entityGain.toFixed(0)}`,
      postings: mergePostings(postings),
    });
    nciProfitTotal += (1 - g) * pIn;
    disposals.push({ entityId: sid, name: s.name, date: structure.changeDate[sid], fraction: structure.fraction[sid], effective: g, proceeds, cost, netAssets, goodwill, nciDerecognised, fctrRecycled: g * f0, entityGain, groupGain });
  }

  // 4. Intercompany eliminations, company by company.
  //    Each direction is matched separately: what X shows as receivable from (or expense to) Y against what Y shows as
  //    payable to (or revenue from) X. Lines without a counterparty are matched as one pool, as a fallback.
  //    Year-end balances of subsidiaries disposed of in the period are no longer intra-group; their P&L up to disposal is.
  const icRecon: IcReconRow[] = [];
  if (p.settings.autoEliminateIC) {
    const defs = [
      { kind: 'balance' as const, dr: 'ic_rec', cr: 'ic_pay', label: 'intercompany receivables / payables', drWord: 'receivable from', crWord: 'payable to' },
      { kind: 'pl' as const, dr: 'ic_exp', cr: 'ic_rev', label: 'intercompany revenue / expenses', drWord: 'expense to', crWord: 'revenue from' },
    ];
    const total = (b: Balances) => Object.values(b).reduce((t, v) => t + v, 0);
    /** spread `amount` over the accounts in b in proportion to their balances */
    const alloc = (b: Balances, amount: number): Posting[] => {
      const t = total(b);
      return t ? Object.entries(b).map(([account, v]) => ({ account, amount: (amount * v) / t })) : [];
    };
    for (const d of defs) {
      const members = consolidatedIds.filter((id) => d.kind === 'pl' || m[id] !== 'disposed');
      const get = (id: string, r: string, cp: string): Balances => translation[id].ic[r]?.[cp] ?? {};
      const postings: Posting[] = [];
      const poolDr: Balances = {},
        poolCr: Balances = {};
      let untagged = 0;
      for (const id of members) {
        for (const [k, v] of Object.entries(get(id, d.dr, ''))) add(poolDr, k, v);
        for (const [k, v] of Object.entries(get(id, d.cr, ''))) add(poolCr, k, v);
        untagged += Object.keys(get(id, d.dr, '')).length + Object.keys(get(id, d.cr, '')).length;
      }
      for (const x of members)
        for (const y of members) {
          if (x === y) continue;
          const xb = get(x, d.dr, y),
            yb = get(y, d.cr, x);
          const xa = total(xb),
            ya = -total(yb);
          if (Math.abs(xa) < 1e-9 && Math.abs(ya) < 1e-9) continue;
          const matched = Math.min(Math.max(xa, 0), Math.max(ya, 0));
          postings.push(...alloc(xb, -matched), ...alloc(yb, matched)); // Cr the debit side, Dr the credit side
          icRecon.push({ kind: d.kind, debitId: x, debitName: name(x), debitAmount: xa, creditId: y, creditName: name(y), creditAmount: ya, eliminated: matched, difference: xa - ya });
          if (Math.abs(xa - ya) > EPS)
            checks.push({
              level: 'warn',
              message: `Intercompany mismatch: ${name(x)} ${d.drWord} ${name(y)} ${xa.toFixed(0)} vs ${name(y)} ${d.crWord} ${name(x)} ${ya.toFixed(0)} (difference ${(xa - ya).toFixed(0)} ${p.presentationCurrency}).`,
            });
        }
      // amounts tagged to a company outside the consolidated set (e.g. an associate) are not eliminated
      const pa = total(poolDr),
        pc = -total(poolCr);
      if (untagged) {
        const matched = Math.min(Math.max(pa, 0), Math.max(pc, 0));
        postings.push(...alloc(poolDr, -matched), ...alloc(poolCr, matched));
        icRecon.push({ kind: d.kind, debitId: '', debitName: '(no counterparty)', debitAmount: pa, creditId: '', creditName: '(no counterparty)', creditAmount: pc, eliminated: matched, difference: pa - pc });
        checks.push({
          level: 'warn',
          message: `${untagged} ${d.label} line(s) have no counterparty and were matched as one pool${Math.abs(pa - pc) > EPS ? ` (mismatch ${(pa - pc).toFixed(0)})` : ''} — set the counterparty on the Account mapping page to reconcile company by company.`,
        });
      }
      const merged = mergePostings(postings);
      if (merged.length) journals.push({ id: `ic_${d.dr}`, column: 'ic', description: `Eliminate ${d.label}`, postings: merged });
      const rows = icRecon.filter((r) => r.kind === d.kind && r.debitId);
      if (rows.length && rows.every((r) => Math.abs(r.difference) <= EPS))
        checks.push({ level: 'ok', message: `${d.label[0].toUpperCase()}${d.label.slice(1)} agree for all ${rows.length} company pair(s).` });
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
    ...consolidatedIds.map((id) => ({ key: id, label: (ent.get(id)!.code || ent.get(id)!.name) + (m[id] === 'disposed' ? ' (disposed)' : ''), kind: 'entity' as const })),
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
    disposals,
    dividends,
    urp,
    icRecon,
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
