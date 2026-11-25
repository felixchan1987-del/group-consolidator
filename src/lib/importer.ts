import * as XLSX from 'xlsx';
import type { SignMode, TBLine } from '../types';
import { parseAmount, uid } from './util';

export type ColRole = 'ignore' | 'code' | 'name' | 'codename' | 'debit' | 'credit' | 'balance';

export const COL_ROLE_LABELS: Record<ColRole, string> = {
  ignore: '— ignore —',
  code: 'Account code',
  name: 'Account name',
  codename: 'Code + name (combined)',
  debit: 'Debit',
  credit: 'Credit',
  balance: 'Balance / Amount',
};

export interface SystemPreset {
  id: string;
  label: string;
  hint: string;
  /** extra header synonyms, checked before the generic ones */
  synonyms?: Partial<Record<ColRole, string[]>>;
  sign?: SignMode;
}

export const SYSTEMS: SystemPreset[] = [
  { id: 'generic', label: 'Generic / other', hint: 'Any trial balance with code, name and debit/credit or balance columns.' },
  {
    id: 'xero',
    label: 'Xero',
    hint: 'Reports → Trial Balance → Export to Excel. Uses "Account Code", "Account", "Debit", "Credit" (YTD columns preferred).',
    synonyms: { code: ['account code'], name: ['account'], debit: ['ytd debit'], credit: ['ytd credit'] },
  },
  {
    id: 'quickbooks',
    label: 'QuickBooks',
    hint: 'Reports → Trial Balance → Export to Excel. Account names often include the number ("1000 · Checking").',
    synonyms: { codename: ['', 'account', 'accounts'] },
  },
  {
    id: 'sap',
    label: 'SAP (S/4HANA, Business One)',
    hint: 'Trial balance / F.01 / S_ALR_87012277 exports. Uses "G/L Account", "Short Text", balance in company code currency.',
    synonyms: { code: ['g/l account', 'gl account', 'g/l acct', 'account number'], name: ['short text', 'g/l acct long text', 'long text', 'g/l account name'], balance: ['balance carryforward', 'accumulated balance', 'balance in company code currency', 'closing balance'] },
  },
  {
    id: 'netsuite',
    label: 'Oracle NetSuite',
    hint: 'Reports → Financial → Trial Balance → Export to Excel.',
    synonyms: { codename: ['account'] },
  },
  {
    id: 'sage',
    label: 'Sage (50/200/Intacct)',
    hint: 'Trial balance export with "N/C" (nominal code) and "Name".',
    synonyms: { code: ['n/c', 'nominal code', 'nominal', 'account no'], name: ['name'] },
  },
  {
    id: 'myob',
    label: 'MYOB',
    hint: 'Trial balance export with "Account No." and "Account Name".',
    synonyms: { code: ['account no.', 'account no', 'account number'], name: ['account name'] },
  },
  {
    id: 'dynamics',
    label: 'Microsoft Dynamics 365 BC / F&O',
    hint: 'Trial Balance report exported to Excel ("No.", "Name", "Net Change", "Balance").',
    synonyms: { code: ['no.', 'main account'], name: ['name'], balance: ['balance at date', 'balance', 'closing balance'] },
  },
  {
    id: 'pl_report',
    label: 'P&L / Balance Sheet report (natural signs)',
    hint: 'Formatted financial statements where revenue and expenses are both shown as positive. Sign is resolved after mapping.',
    sign: 'natural',
  },
];

const GENERIC: Record<Exclude<ColRole, 'ignore'>, string[]> = {
  code: ['account code', 'acct code', 'code', 'account no', 'account no.', 'account number', 'acct no', 'acct', 'gl code', 'gl account', 'g/l account', 'account #', 'acc no', 'number', 'no.', 'no', 'account id', 'nominal code', 'n/c'],
  name: ['account name', 'account description', 'description', 'name', 'account title', 'title', 'gl account name', 'short text', 'account', 'particulars', 'line item'],
  codename: [],
  debit: ['debit', 'debits', 'dr', 'debit amount', 'ytd debit', 'closing debit', 'debit balance'],
  credit: ['credit', 'credits', 'cr', 'credit amount', 'ytd credit', 'closing credit', 'credit balance'],
  balance: ['balance', 'closing balance', 'ending balance', 'end balance', 'net balance', 'amount', 'net', 'ytd', 'year to date', 'ytd balance', 'total', 'closing', 'value', 'current period', 'this year'],
};

export interface ParsedSheet {
  name: string;
  rows: unknown[][];
}

export function readWorkbook(data: ArrayBuffer): ParsedSheet[] {
  const wb = XLSX.read(data, { type: 'array', cellDates: true });
  return wb.SheetNames.map((name) => ({
    name,
    rows: XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, raw: true, defval: '', blankrows: false }),
  }));
}

const norm = (v: unknown) =>
  String(v ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

const IGNORE = ['company code', 'company', 'currency', 'curr', 'account type', 'type', 'class', 'entity', 'ledger', 'period', 'fiscal year', 'business area', 'profit center', 'cost center', 'segment'];

function matchRole(header: string, preset?: SystemPreset): ColRole | null {
  const h = norm(header);
  if (IGNORE.includes(h)) return 'ignore';
  if (preset?.synonyms) {
    for (const [role, syns] of Object.entries(preset.synonyms)) if (syns && syns.includes(h) && h !== '') return role as ColRole;
  }
  for (const [role, syns] of Object.entries(GENERIC)) if (syns.includes(h)) return role as ColRole;
  if (!h) return null;
  if (/debit|\bdr\b/.test(h)) return 'debit';
  if (/credit|\bcr\b/.test(h)) return 'credit';
  if (/balance|amount|ytd|closing/.test(h)) return 'balance';
  if (/code|number|\bno\b/.test(h)) return 'code';
  if (/name|description|account/.test(h)) return 'name';
  return null;
}

export function detectHeaderRow(rows: unknown[][], preset?: SystemPreset): number {
  let best = 0;
  let bestScore = -1;
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const r = rows[i] || [];
    let score = 0;
    for (const c of r) if (typeof c === 'string' && matchRole(c, preset)) score++;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return bestScore > 0 ? best : 0;
}

export function detectColumns(rows: unknown[][], headerRow: number, preset?: SystemPreset): ColRole[] {
  const header = rows[headerRow] || [];
  const width = Math.max(header.length, ...rows.slice(headerRow, headerRow + 30).map((r) => r.length));
  const data = rows.slice(headerRow + 1, headerRow + 40);
  const numericCount = (c: number) => data.filter((r) => parseAmount(r[c]) !== null && String(r[c]).trim() !== '').length;
  const candidates = Array.from({ length: width }, (_, c) => matchRole(String(header[c] ?? ''), preset));
  const roles: ColRole[] = Array(width).fill('ignore');
  const used = new Set<ColRole>();
  const byRole = new Map<ColRole, number[]>();
  candidates.forEach((r, c) => r && r !== 'ignore' && byRole.set(r, [...(byRole.get(r) ?? []), c]));
  for (const [role, cols] of byRole) {
    // amount columns: prefer the one that actually holds numbers (e.g. Xero "YTD Debit" vs empty "Debit"); ties -> rightmost
    const pick = ['debit', 'credit', 'balance'].includes(role)
      ? cols.reduce((best, c) => (numericCount(c) >= numericCount(best) ? c : best), cols[0])
      : cols[0];
    roles[pick] = role;
    used.add(role);
  }
  const isNumericCol = (c: number) => data.filter((r) => typeof r[c] === 'number').length >= Math.max(2, data.length * 0.3);
  const isTextCol = (c: number) => data.filter((r) => typeof r[c] === 'string' && String(r[c]).trim()).length >= Math.max(2, data.length * 0.3);

  // "Account" may be name or code+name. If there's no separate code column and the values look like "1000 Cash", use codename.
  if (!used.has('code')) {
    const nameCol = roles.indexOf('name');
    const candidate = nameCol >= 0 ? nameCol : roles.findIndex((r, i) => r === 'ignore' && isTextCol(i));
    if (candidate >= 0) {
      const samples = data.map((r) => String(r[candidate] ?? '')).filter(Boolean);
      const looksCombined = samples.filter((s) => splitCodeName(s).code).length >= samples.length * 0.5;
      if (looksCombined) roles[candidate] = 'codename';
      else if (nameCol < 0) roles[candidate] = 'name';
    }
  }
  // Nothing found for amounts: take numeric columns
  if (!roles.some((r) => r === 'debit' || r === 'credit' || r === 'balance')) {
    const nums = roles.map((_, i) => i).filter((i) => roles[i] === 'ignore' && isNumericCol(i));
    if (nums.length >= 2) {
      roles[nums[nums.length - 2]] = 'debit';
      roles[nums[nums.length - 1]] = 'credit';
    } else if (nums.length === 1) roles[nums[0]] = 'balance';
  }
  return roles;
}

export function splitCodeName(s: string): { code: string; name: string } {
  const t = s.trim();
  const m = t.match(/^([A-Za-z]{0,3}\d[\d.\-/]*)\s*(?:[-–—:·•|]\s*|\s+)(.+)$/);
  if (m) return { code: m[1], name: m[2].trim() };
  return { code: '', name: t };
}

const TOTAL_RE = /^(total|grand total|net (profit|income|loss|assets)|gross profit|operating profit|profit (before|after|for)|subtotal|balance)\b/i;

export interface ImportOptions {
  headerRow: number;
  roles: ColRole[];
  sign: SignMode; // applies to the balance column (debit/credit columns are always dr)
  skipZero: boolean;
  sourceId: string;
}

export interface ImportResult {
  lines: TBLine[];
  totalDebit: number;
  totalCredit: number;
  skipped: number;
}

export function extractLines(rows: unknown[][], opt: ImportOptions): ImportResult {
  const col = (r: ColRole) => opt.roles.indexOf(r);
  const cCode = col('code'),
    cName = col('name'),
    cCN = col('codename'),
    cDr = col('debit'),
    cCr = col('credit'),
    cBal = col('balance');
  const useDrCr = cDr >= 0 || cCr >= 0;
  const lines: TBLine[] = [];
  let skipped = 0,
    totalDebit = 0,
    totalCredit = 0;
  for (let i = opt.headerRow + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    let code = cCode >= 0 ? String(r[cCode] ?? '').trim() : '';
    let name = cName >= 0 ? String(r[cName] ?? '').trim() : '';
    if (cCN >= 0) {
      const sp = splitCodeName(String(r[cCN] ?? ''));
      if (!code) code = sp.code;
      if (!name) name = sp.name;
    }
    if (!code && !name) {
      skipped++;
      continue;
    }
    if (!code && TOTAL_RE.test(name)) {
      skipped++;
      continue;
    }
    let amount: number | null;
    let sign: SignMode;
    if (useDrCr) {
      const dr = cDr >= 0 ? parseAmount(r[cDr]) : null;
      const cr = cCr >= 0 ? parseAmount(r[cCr]) : null;
      if (dr === null && cr === null) {
        skipped++;
        continue;
      }
      amount = (dr ?? 0) - (cr ?? 0);
      sign = 'dr';
    } else {
      amount = cBal >= 0 ? parseAmount(r[cBal]) : null;
      if (amount === null) {
        skipped++;
        continue;
      }
      sign = opt.sign;
    }
    if (opt.skipZero && Math.abs(amount) < 0.005) {
      skipped++;
      continue;
    }
    const drAmt = sign === 'cr' ? -amount : amount;
    if (sign !== 'natural') {
      if (drAmt >= 0) totalDebit += drAmt;
      else totalCredit -= drAmt;
    }
    lines.push({ id: uid('ln'), code, name: name || code, amount, sign, sourceId: opt.sourceId });
  }
  return { lines, totalDebit, totalCredit, skipped };
}

/** Company name from the report title rows above the header (Xero, QuickBooks, Sage etc. put it there). */
export function guessEntityFromSheet(rows: unknown[][], headerRow: number): string | null {
  for (let i = 0; i < Math.min(headerRow, 6); i++) {
    const cell = (rows[i] || []).find((c) => typeof c === 'string' && c.trim());
    const t = typeof cell === 'string' ? cell.trim() : '';
    if (t && t.length < 80 && !/trial balance|balance sheet|profit|loss|income statement|report|as (of|at)|period|for the|\d{4}|ytd|page/i.test(t)) return t;
  }
  return null;
}

export function guessEntityName(fileName: string): string {
  return fileName
    .replace(/\.(xlsx|xlsm|xls|csv|ods)$/i, '')
    .replace(/[_]+/g, ' ')
    .replace(/\b(trial balance|tb|balance sheet|p&l|profit and loss|export|report|xero|quickbooks|qbo|sap|netsuite|sage|myob|dynamics|generic|fy\d{2,4}|\d{4}[-_]?\d{2}([-_]?\d{2})?)\b/gi, '')
    .replace(/[-\s]+$/g, '')
    .replace(/^\s*[-\s]+/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim() || fileName;
}
