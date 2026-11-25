import type { GroupAccount } from '../types';

export type Confidence = 'high' | 'low';

interface Rule {
  test: RegExp;
  code: string;
}

// Ordered: more specific patterns first.
const RULES: Rule[] = [
  { test: /accum\w*\.?\s+(depr|amort)/, code: '1500' },
  { test: /investment.{0,6}(in )?(subsidiar|group compan)/, code: '1700' },
  { test: /investment.{0,6}(in )?(associate|joint venture|jv)/, code: '1710' },
  { test: /goodwill/, code: '1650' },
  { test: /dividends? (paid|declared|distributed|payable to shareholders)|interim dividend|final dividend|distributions? to (shareholders|owners)/, code: '3250' },
  { test: /dividend.{0,30}(subsidiar|group|related|inter.?company|intra.?group)|(subsidiar|group|inter.?company|intra.?group).{0,30}dividend/, code: '4060' },
  { test: /(inter.?company|intra.?group|related part|due (from|to)|group compan)/, code: '__ic' },
  { test: /(investment|interest|dividend) (income|revenue|received)|finance income/, code: '4300' },
  { test: /deferred tax assets?/, code: '1800' },
  { test: /deferred tax/, code: '2600' },
  { test: /payroll tax.*(expense|cost)|^payroll tax$|fringe benefits? tax expense|^fbt( expense)?$|workers'? comp/, code: '5100' },
  { test: /(income )?tax (payable|liabilit|provision)|provision for (income )?tax|corporat\w* tax payable/, code: '2300' },
  { test: /(income|corporat\w*) tax( expense)?$|tax expense|current tax/, code: '5500' },
  { test: /(deferred|unearned) (revenue|income)|contract liabilit/, code: '2100' },
  { test: /(gst|vat|sales tax|payroll|wages|salar\w*|payg|withholdings?) (payable|liabilit|control)/, code: '2100' },
  { test: /(term loan|long.?term|non.?current).{0,20}(loan|borrow|debt|lease)|mortgage|bond/, code: '2500' },
  { test: /lease liabilit/, code: '2500' },
  { test: /loan|borrowing|overdraft|credit card|notes? payable|line of credit/, code: '2200' },
  { test: /accounts payable|trade (payable|creditor)|creditors|payables?$|vendors?$/, code: '2000' },
  { test: /accru|other payable|provision|customer deposit/, code: '2100' },
  { test: /share capital|common stock|ordinary shares|capital stock|paid.?in capital|subscribed capital|stated capital|issued capital/, code: '3000' },
  { test: /share premium|additional paid|capital reserve|other reserve|revaluation|reserve|share options?|share.?based payment/, code: '3100' },
  { test: /retained|accumulated (profit|loss|deficit|earning)|opening balance equity|profit brought forward|dividend(s)? (paid|declared)|drawings|current year earnings/, code: '3200' },
  { test: /petty cash|cash|bank|checking|savings|money market|undeposited/, code: '1000' },
  { test: /accounts receivable|trade (receivable|debtor)|debtors|receivables?$|customers?$/, code: '1100' },
  { test: /inventor|stock on hand|finished goods|raw material|work in progress|wip/, code: '1200' },
  { test: /prepa|deposit|other receivable|(gst|vat) (receivable|input|refund)|advance/, code: '1300' },
  { test: /software|patent|trademark|licen[cs]e|intangible|development cost|brand/, code: '1600' },
  { test: /property|plant|equipment|building|vehicle|furniture|fixture|computer|machinery|land|leasehold|fixed asset|right.?of.?use|\brou\b|motor/, code: '1500' },
  { test: /investment|securities|shares in/, code: '1720' },
  { test: /cost of (sales|goods|revenue)|cogs|purchases|direct (cost|labou?r|material)|material cost|freight in|cost of services/, code: '5000' },
  { test: /depreciation|amorti[sz]ation/, code: '5200' },
  { test: /interest (expense|paid)|bank (charge|fee)|finance (cost|charge)|loan interest/, code: '5400' },
  { test: /salar|wage|payroll|staff|employee|personnel|superannuation|pension|bonus|benefit|commission|social security|kiwisaver|cpf|mpf|401k|annual leave|long service leave|sick leave/, code: '5100' },
  { test: /other income|sundry income|rental income|gain on|foreign exchange gain|misc\w* income|grant income|subsid(y|ies) income/, code: '4100' },
  { test: /sales|revenue|turnover|fee income|income from|service income|consulting income|^income$/, code: '4000' },
  { test: /expense|rent|utilit|insurance|travel|marketing|advertis|office|professional|legal|audit|accounting|repair|maintenance|telephone|internet|subscription|postage|printing|entertainment|training|consult|cleaning|electric|loss on|exchange loss|bad debt|donation|motor|fuel|freight|courier|fees|license fee|dues/, code: '5300' },
];

function icCode(n: string): string | null {
  if (/receivable|due from|loan to|advance to|debtor/.test(n)) return '1150';
  if (/payable|due to|loan from|advance from|creditor/.test(n)) return '2050';
  if (/revenue|sales|income|recharge (income|in)/.test(n)) return '4050';
  if (/expense|cost|purchase|fee|charge|recharge/.test(n)) return '5050';
  return null;
}

function byCodeRange(code: string): string | null {
  const d = code.replace(/\D/g, '');
  if (!d) return null;
  switch (d[0]) {
    case '1':
      return '1300';
    case '2':
      return '2100';
    case '3':
      return '3200';
    case '4':
      return '4000';
    case '5':
      return '5000';
    case '6':
    case '7':
    case '8':
    case '9':
      return '5300';
  }
  return null;
}

export function suggestMapping(
  code: string,
  name: string,
  accounts: GroupAccount[],
  memory?: Record<string, string>,
): { code: string; confidence: Confidence } | null {
  const valid = new Set(accounts.map((a) => a.code));
  const n = name.toLowerCase().replace(/[_·•]/g, ' ').replace(/\s+/g, ' ').trim();
  const remembered = memory?.[n];
  if (remembered && valid.has(remembered)) return { code: remembered, confidence: 'high' };
  // exact name match with a group account
  const exact = accounts.find((a) => a.name.toLowerCase() === n);
  if (exact) return { code: exact.code, confidence: 'high' };
  for (const r of RULES) {
    if (r.test.test(n)) {
      const c = r.code === '__ic' ? icCode(n) ?? byCodeRange(code) : r.code;
      if (c && valid.has(c)) return { code: c, confidence: 'high' };
    }
  }
  const fallback = byCodeRange(code);
  if (fallback && valid.has(fallback)) return { code: fallback, confidence: 'low' };
  return null;
}

/** Default group account for a report section such as "Assets › Fixed Assets" or "Less Operating Expenses". */
const SECTION_RULES: { test: RegExp; code: string }[] = [
  { test: /bank|cash/, code: '1000' },
  { test: /receivable|debtors/, code: '1100' },
  { test: /inventor|stock/, code: '1200' },
  { test: /fixed assets|property|plant|equipment|right.?of.?use/, code: '1500' },
  { test: /non-?current assets|long.?term assets/, code: '1800' },
  { test: /intangible/, code: '1600' },
  { test: /investments?/, code: '1720' },
  { test: /current assets|other assets|assets/, code: '1300' },
  { test: /lease liabilit|borrowings?|loans?|debt/, code: '2200' },
  { test: /non-?current liabilit|long.?term liabilit|term liabilit/, code: '2700' },
  { test: /liabilit|payable|creditors/, code: '2100' },
  { test: /equity|capital|reserves/, code: '3200' },
  { test: /cost of (sales|goods)|direct costs|purchases|cogs/, code: '5000' },
  { test: /other income|non-?operating income/, code: '4100' },
  { test: /income|revenue|sales|turnover/, code: '4000' },
  { test: /depreciation|amorti/, code: '5200' },
  { test: /finance costs|interest/, code: '5400' },
  { test: /employee|staff|personnel|payroll|wages|salar/, code: '5100' },
  { test: /tax/, code: '5500' },
  { test: /expenses?|overheads|costs?/, code: '5300' },
];

const TYPE_OF_SECTION: { test: RegExp; types: string[] }[] = [
  { test: /cost of (sales|goods)|expenses?|overheads|direct costs/, types: ['expense'] },
  { test: /income|revenue|sales|turnover/, types: ['revenue'] },
  { test: /liabilit/, types: ['liability'] },
  { test: /equity|capital and reserves|shareholders|owners/, types: ['equity'] },
  { test: /assets/, types: ['asset'] },
];

export function sectionDefault(section: string, accounts: GroupAccount[], accept: (code: string) => boolean = () => true): string | null {
  const parts = section.toLowerCase().split('›').map((x) => x.trim()).reverse(); // innermost first
  const valid = new Set(accounts.map((a) => a.code));
  for (const p of parts)
    for (const r of SECTION_RULES) {
      if (!r.test.test(p)) continue;
      if (valid.has(r.code) && accept(r.code)) return r.code;
      const cp = COUNTERPART[r.code]; // e.g. "Lease Liability" under non-current liabilities: long-term borrowings
      if (cp && valid.has(cp) && accept(cp)) return cp;
    }
  return null;
}

/** Statement section implied by a report heading: current vs non-current, and cost of sales. Innermost heading wins. */
const SECTION_GROUP: { test: RegExp; section: string; bs: boolean }[] = [
  { test: /non-?current assets|fixed assets|long.?term assets|property,? plant/, section: 'Non-current assets', bs: true },
  { test: /current assets|^bank|^cash/, section: 'Current assets', bs: true },
  { test: /non-?current liabilit|long.?term liabilit/, section: 'Non-current liabilities', bs: true },
  { test: /current liabilit/, section: 'Current liabilities', bs: true },
  { test: /cost of (sales|goods|revenue)|direct costs|\bcogs\b/, section: 'Cost of sales', bs: false },
];
/** Same kind of balance on the other side of the current / non-current split. */
const COUNTERPART: Record<string, string> = { '2500': '2200', '2200': '2500', '2700': '2100', '2100': '2700', '1300': '1800', '1800': '1300', '1100': '1800' };
const IC_NAME = /(inter.?company|intra.?group|related part|due (from|to)|group compan)/;

/**
 * Mapping suggestion for an imported line. Uses the account name first; when the line came from a report section,
 * the section must agree with the suggested account type (e.g. "GST" under "Current Liabilities" can't be an asset),
 * and an unknown name falls back to the section's natural account.
 */
export function suggestForLine(
  line: { code: string; name: string; section?: string },
  accounts: GroupAccount[],
  memory?: Record<string, string>,
): { code: string; confidence: Confidence } | null {
  const n = line.name.toLowerCase().replace(/[_·•]/g, ' ').replace(/\s+/g, ' ').trim();
  const valid = new Set(accounts.map((a) => a.code));
  if (memory?.[n] && valid.has(memory[n])) return { code: memory[n], confidence: 'high' }; // what you mapped before wins
  const byName = suggestMapping(line.code, line.name, accounts, memory);
  if (!line.section) return byName;
  const parts = line.section.toLowerCase().split('›').map((x) => x.trim()).reverse(); // innermost first
  let allowed: string[] | null = null;
  for (const part of parts) {
    const hit = TYPE_OF_SECTION.find((t) => t.test.test(part));
    if (hit) {
      allowed = hit.types;
      break;
    }
  }
  let group: (typeof SECTION_GROUP)[number] | null = null;
  for (const part of parts) {
    group = SECTION_GROUP.find((g) => g.test.test(part)) ?? null;
    if (group) break;
  }
  const acc = (code: string) => accounts.find((a) => a.code === code);
  const typeFits = (code: string) => !allowed || allowed.includes(acc(code)?.type ?? '');
  const fits = (code: string) => {
    const a = acc(code);
    if (!a || !typeFits(code)) return false;
    if (!group || a.section === group.section) return true;
    // consolidation accounts (goodwill, intercompany …) and deferred tax keep their place whatever the heading says
    return group.bs && (!!a.role || code === '2600');
  };

  // intercompany balances: the section says which side they are on
  if (IC_NAME.test(n) && allowed) {
    const ic = allowed.includes('liability') ? '2050' : allowed.includes('asset') ? '1150' : allowed.includes('revenue') ? '4050' : allowed.includes('expense') ? '5050' : null;
    if (ic && valid.has(ic)) return { code: ic, confidence: 'high' };
  }
  if (byName && byName.confidence === 'high' && fits(byName.code)) return byName;
  // right kind of account, wrong side of the current / non-current split: use its counterpart
  const cp = byName && byName.confidence === 'high' && typeFits(byName.code) ? COUNTERPART[byName.code] : undefined;
  if (cp && valid.has(cp) && fits(cp)) return { code: cp, confidence: 'high' };
  const def = sectionDefault(line.section, accounts, fits);
  if (def) return { code: def, confidence: 'low' };
  if (byName && typeFits(byName.code)) return byName;
  return byName && !allowed ? byName : null;
}
