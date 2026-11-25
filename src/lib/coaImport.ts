/**
 * Imports a chart of accounts (Xero "Chart of accounts" export, QuickBooks account list, MYOB, SAP, or any table with
 * code / name / type columns) as the group chart of accounts. Each company's lines are then mapped to it by name
 * (and by code when the companies share the chart), so a group whose companies use the same Xero template maps itself.
 */
import type { AccountRole, AccountType, GroupAccount, Project } from '../types';
import { DEFAULT_ACCOUNTS } from './coa';
import { normName, suggestForLine, suggestMapping } from './automap';
import { splitLabel } from './reportParser';
import { lineKey } from './util';
import { autoTagCounterparties } from './counterparty';

export interface CoaRow {
  /** row index in the sheet */
  index: number;
  code: string;
  name: string;
  /** the type as written in the file ("Current Liability", "Direct Costs" …) */
  sourceType: string;
  type: AccountType | null;
  section: string | null;
  /** classified from the name because the file has no (recognised) type */
  guessed: boolean;
  /** archived / inactive accounts are left out */
  skip: boolean;
}

export interface CoaAnalysis {
  headerRow: number;
  codeCol: number;
  nameCol: number;
  typeCol: number;
  rows: CoaRow[];
}

const H = (v: unknown) =>
  String(v ?? '')
    .toLowerCase()
    .replace(/^\*+\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
const NAME_H = /^(account )?name$|^account( title| description)?$|^title$|^gl account name$|^short text$/;
const CODE_H = /^(account )?(code|no\.?|number|#)$|^acc(oun)?t\.? ?(no|#|code)\.?$|^gl (code|account)( no| number)?$|^g\/l account$|^nominal code$/;
const TYPE_H = /^(account )?(type|class|classification|category|group)$|^detail type$/;
const STATUS_H = /^(status|active|archived|inactive)$/;

/** Account type text -> type and statement section. Order matters: "Non-current" before "current". */
const TYPE_RULES: { test: RegExp; type: AccountType; section: string | null }[] = [
  { test: /^bank|cash|checking|savings/, type: 'asset', section: 'Current assets' },
  { test: /non.?current asset|fixed asset|long.?term asset|other asset|property|plant|intangible|^non.?current$/, type: 'asset', section: 'Non-current assets' },
  { test: /accounts receivable|\ba\/r\b|receivable|prepayment|inventory|stock|current asset/, type: 'asset', section: 'Current assets' },
  { test: /non.?current liabilit|long.?term liabilit|term liabilit/, type: 'liability', section: 'Non-current liabilities' },
  { test: /credit card|accounts payable|\ba\/p\b|payable|current liabilit|gst|vat|sales tax|payg|superannuation liabilit|wages payable/, type: 'liability', section: 'Current liabilities' },
  { test: /liabilit/, type: 'liability', section: null },
  { test: /equity|capital|retained|reserve/, type: 'equity', section: 'Equity' },
  { test: /direct cost|cost of (goods|sales|revenue)|cogs/, type: 'expense', section: 'Cost of sales' },
  { test: /other income|non.?operating income/, type: 'revenue', section: 'Other income' },
  { test: /revenue|sales|^income|turnover/, type: 'revenue', section: null },
  { test: /depreciation|amorti/, type: 'expense', section: 'Operating expenses' },
  { test: /expense|overhead|wages|cost/, type: 'expense', section: null },
  { test: /asset/, type: 'asset', section: null },
];

const BUILT_IN = DEFAULT_ACCOUNTS.filter((a) => !a.role || ['cogs', 'inventory', 'retained'].includes(a.role));

/** Type and section of one account, from its type text and (to place it within the type) its name. */
export function classifyAccount(typeText: string, name: string): { type: AccountType; section: string; guessed: boolean } | null {
  const t = H(typeText);
  const rule = t ? TYPE_RULES.find((r) => r.test.test(t)) : undefined;
  // what the name says, on the built-in chart (e.g. "Interest expense" -> Finance costs)
  const byName = suggestMapping('', name, BUILT_IN);
  const named = byName ? DEFAULT_ACCOUNTS.find((a) => a.code === byName.code) : undefined;
  if (!rule) return named ? { type: named.type, section: named.section, guessed: true } : null;
  if (rule.section && !(rule.type === 'revenue' || rule.type === 'expense')) return { type: rule.type, section: rule.section, guessed: false };
  if (named && named.type === rule.type) {
    // the type column decides cost of sales / other income; the name refines the rest (finance costs, tax …)
    if (rule.section === 'Cost of sales' || (rule.section && named.section === 'Cost of sales')) return { type: rule.type, section: rule.section ?? named.section, guessed: false };
    if (rule.section === 'Other income' && named.section === 'Revenue') return { type: rule.type, section: rule.section, guessed: false };
    return { type: rule.type, section: named.section, guessed: false };
  }
  const fallback: Record<AccountType, string> = { asset: 'Current assets', liability: 'Current liabilities', equity: 'Equity', revenue: 'Revenue', expense: 'Operating expenses' };
  return { type: rule.type, section: rule.section ?? fallback[rule.type], guessed: false };
}

/** Finds the header and the code / name / type columns. Returns null when the sheet is not a chart of accounts. */
export function analyseCoa(raw: unknown[][]): CoaAnalysis | null {
  for (let hr = 0; hr < Math.min(raw.length, 25); hr++) {
    const head = (raw[hr] ?? []).map(H);
    let nameCol = head.findIndex((h) => NAME_H.test(h) && h !== 'account description');
    if (nameCol < 0) nameCol = head.findIndex((h) => h === 'description');
    const typeCol = head.findIndex((h) => TYPE_H.test(h) && h !== 'detail type');
    const codeCol = head.findIndex((h, i) => i !== nameCol && CODE_H.test(h));
    const statusCol = head.findIndex((h) => STATUS_H.test(h));
    if (nameCol < 0 || (typeCol < 0 && codeCol < 0)) continue;
    const rows: CoaRow[] = [];
    for (let i = hr + 1; i < raw.length; i++) {
      const r = raw[i] ?? [];
      let name = String(r[nameCol] ?? '').trim();
      let code = codeCol >= 0 ? String(r[codeCol] ?? '').trim() : '';
      if (!name) continue;
      if (!code) {
        const sp = splitLabel(name); // QuickBooks "1000 Cash"
        if (sp.code) [code, name] = [sp.code, sp.name];
      }
      const sourceType = typeCol >= 0 ? String(r[typeCol] ?? '').trim() : '';
      const c = classifyAccount(sourceType, name);
      const status = statusCol >= 0 ? H(r[statusCol]) : '';
      rows.push({
        index: i,
        code,
        name,
        sourceType,
        type: c?.type ?? null,
        section: c?.section ?? null,
        guessed: !c || c.guessed,
        skip: /archiv|inactive|deleted|^(no|false|n)$/.test(status) && !/^active$/.test(status),
      });
    }
    if (rows.length) return { headerRow: hr, codeCol, nameCol, typeCol, rows };
  }
  return null;
}

/** A chart of accounts rather than a trial balance or report: name + type columns, mostly recognised types, no amounts to speak of. */
export function looksLikeCoa(raw: unknown[][]): boolean {
  const a = analyseCoa(raw);
  if (!a || a.typeCol < 0 || a.rows.length < 5) return false;
  const typed = a.rows.filter((r) => r.sourceType && r.type).length;
  const head = (raw[a.headerRow] ?? []).map(H);
  const amountCols = head.filter((h) => /^(debit|credit|dr|cr|ytd|closing|opening|net)( balance| amount)?$/.test(h)).length;
  return typed >= a.rows.length * 0.6 && amountCols === 0;
}

// ---------------------------------------------------------------- building the group chart

/** Which imported accounts play a part in the consolidation (retained earnings, intercompany …). */
const ROLE_BY_NAME: { role: AccountRole; type: AccountType; test: RegExp; all?: boolean; section?: string }[] = [
  { role: 'retained', type: 'equity', test: /retained (earnings|profits?)|accumulated (profits?|losses|deficit)/ },
  { role: 'div_paid', type: 'equity', test: /dividends?/, all: true },
  { role: 'fctr', type: 'equity', test: /translation reserve|\bfctr\b|currency translation/ },
  { role: 'nci', type: 'equity', test: /non.?controlling|minority interest/ },
  { role: 'goodwill', type: 'asset', test: /^goodwill( on consolidation)?$/ },
  { role: 'inv_sub', type: 'asset', test: /investments? (in )?(subsidiar|controlled entit)/ },
  { role: 'inv_assoc', type: 'asset', test: /investments? (in )?(associate|joint venture)/ },
  { role: 'inventory', type: 'asset', test: /^inventor(y|ies)|^stock( on hand)?$/ },
  { role: 'cogs', type: 'expense', test: /^cost of (goods sold|sales)$|^purchases$/, section: 'Cost of sales' },
  { role: 'ic_div', type: 'revenue', test: /dividend.{0,30}(subsidiar|group|related|inter.?company)/ },
  { role: 'share_assoc', type: 'revenue', test: /share of (profit|result|loss).{0,20}(associate|joint venture)/ },
  { role: 'disposal_gain', type: 'revenue', test: /(gain|loss).{0,20}disposal.{0,20}subsidiar/ },
  { role: 'ic_rec', type: 'asset', test: /inter.?company|intra.?group|related part|due from/, all: true },
  { role: 'ic_pay', type: 'liability', test: /inter.?company|intra.?group|related part|due to/, all: true },
  { role: 'ic_rev', type: 'revenue', test: /inter.?company|intra.?group/, all: true },
  { role: 'ic_exp', type: 'expense', test: /inter.?company|intra.?group/, all: true },
];

export type ChartMode = 'replace' | 'merge';

export interface ChartResult {
  accounts: GroupAccount[];
  added: number;
  /** imported accounts left out because the chart already has them (merge) */
  existing: number;
  /** built-in accounts added because the consolidation needs them (goodwill, NCI, FX reserve …) */
  systemAdded: GroupAccount[];
  /** role -> imported account names that took it */
  rolesFromChart: Partial<Record<AccountRole, string[]>>;
}

export function buildChart(rows: CoaRow[], mode: ChartMode, current: GroupAccount[]): ChartResult {
  const usable = rows.filter((r) => !r.skip && r.type && r.section);
  const out: GroupAccount[] = mode === 'merge' ? current.map((a) => ({ ...a })) : [];
  const codes = new Set(out.map((a) => a.code));
  const names = new Set(out.map((a) => normName(a.name)));
  let added = 0,
    existing = 0,
    seq = 1;
  const fresh: GroupAccount[] = [];
  for (const r of usable) {
    if (mode === 'merge' && (names.has(normName(r.name)) || (r.code && codes.has(r.code) && normName(out.find((a) => a.code === r.code)!.name) === normName(r.name)))) {
      existing++;
      continue;
    }
    let code = r.code;
    if (!code) {
      while (codes.has(`A${String(seq).padStart(3, '0')}`)) seq++;
      code = `A${String(seq).padStart(3, '0')}`;
    }
    if (codes.has(code)) {
      let k = 2;
      while (codes.has(`${code}-${k}`)) k++;
      code = `${code}-${k}`;
    }
    codes.add(code);
    names.add(normName(r.name));
    const a: GroupAccount = { code, name: r.name, type: r.type!, section: r.section! };
    out.push(a);
    fresh.push(a);
    added++;
  }

  // roles: from the imported accounts' names where possible
  const rolesFromChart: ChartResult['rolesFromChart'] = {};
  const has = (role: AccountRole) => out.some((a) => a.role === role);
  for (const rule of ROLE_BY_NAME) {
    if (has(rule.role) && !rule.all) continue;
    for (const a of fresh) {
      if (a.role || a.type !== rule.type || (rule.section && a.section !== rule.section) || !rule.test.test(a.name.toLowerCase())) continue;
      a.role = rule.role;
      (rolesFromChart[rule.role] ??= []).push(a.name);
      if (!rule.all) break;
    }
  }
  // the rest come from the built-in chart, under a code that is free
  const systemAdded: GroupAccount[] = [];
  for (const d of DEFAULT_ACCOUNTS) {
    if (!d.role || has(d.role)) continue;
    let code = d.code;
    if (codes.has(code)) {
      code = `G${d.code}`;
      for (let k = 2; codes.has(code); k++) code = `G${d.code}-${k}`;
    }
    codes.add(code);
    const a = { ...d, code };
    out.push(a);
    systemAdded.push(a);
  }
  return { accounts: out, added, existing, systemAdded, rolesFromChart };
}

/**
 * Puts the new chart in the project and re-maps the companies already imported: a mapping is kept when its account
 * is still there under the same name, everything else is suggested again against the new chart.
 */
export function applyChart(p: Project, accounts: GroupAccount[]): { project: Project; remapped: number; unmapped: number } {
  const next: Project = structuredClone(p);
  const before = new Map(p.accounts.map((a) => [a.code, normName(a.name)]));
  // generic built-in accounts ("Cost of sales", "Revenue" …) are suggested again: the new chart usually has better ones
  const generic = new Set(accounts.filter((a) => DEFAULT_ACCOUNTS.some((d) => d.code === a.code && d.name === a.name && !(d.role && /^(ic_|inv_)/.test(d.role)))).map((a) => a.code));
  const after = new Map(accounts.map((a) => [a.code, normName(a.name)]));
  next.accounts = accounts.map((a) => ({ ...a }));
  // journals and URP keep working only if their accounts still exist; journals are left for the user to review
  let remapped = 0,
    unmapped = 0;
  for (const e of next.entities) {
    for (const [k, code] of Object.entries(e.mapping)) if (!code || after.get(code) !== before.get(code) || generic.has(code)) delete e.mapping[k];
    const seen = new Set<string>();
    for (const l of e.lines) {
      const k = lineKey(l);
      if (e.mapping[k] || seen.has(k)) continue;
      seen.add(k);
      const s = suggestForLine(l, next.accounts, {});
      if (s) {
        e.mapping[k] = s.code;
        remapped++;
      } else unmapped++;
    }
  }
  autoTagCounterparties(next);
  return { project: next, remapped, unmapped };
}
