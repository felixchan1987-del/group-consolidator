/**
 * Reads formatted financial reports (balance sheet / profit and loss exports from Xero, QuickBooks, MYOB, Sage …)
 * straight from the exported sheet: title rows, period columns, section headings, account lines and totals.
 * Signs come from the section an account sits in, and the report's own totals are used to check the result.
 */
import type { Period, Project, TBLine } from '../types';
import { periodEndOf, periodStartOf } from './periods';
import { parseAmount, uid } from './util';

export type RowType = 'blank' | 'title' | 'header' | 'heading' | 'account' | 'total' | 'excluded' | 'note';
export type Nature = 'dr' | 'cr';

export interface ReportRow {
  index: number;
  type: RowType;
  label: string;
  code: string;
  /** headings the row sits under, outermost first */
  path: string[];
  nature: Nature | null;
  /** one value per amount column (natural sign, as shown in the report) */
  amounts: (number | null)[];
  /** "Current Year Earnings" on a balance sheet: the profit already shown in the P&L */
  currentEarnings?: boolean;
  /** result of comparing a total row with the lines above it, per amount column */
  check?: ('ok' | 'diff' | null)[];
  reason: string;
}

export interface AmountColumn {
  col: number;
  header: string;
  /** ISO date read from the column header, if any */
  date: string | null;
  year: number | null;
  /** "Year to date" column (its date is the report date) */
  ytd: boolean;
  /** a single calendar month ("Sept 2026"), as in monthly P&L columns */
  month: boolean;
}

export interface ReportAnalysis {
  kind: 'balance_sheet' | 'profit_loss' | 'report';
  labelCol: number;
  codeCol: number;
  amountCols: AmountColumn[];
  rows: ReportRow[];
  entityName: string | null;
  reportDate: string | null;
  /** totals compared with the lines: [agreeing, checked] */
  totals: { agree: number; checked: number };
  /** reporting currency stated in the report (e.g. Xero's "… convert foreign currency into AUD" note) */
  currency: string | null;
  /** when the Year to date column equals the sum of the month columns: the first day of the earliest month */
  ytdStart: string | null;
  /** per amount column, sum of debit-positive account amounts (0 for a balance sheet that balances; -profit for a P&L) */
  balance: number[];
}

// ---------------------------------------------------------------- cells

const clean = (v: unknown) =>
  typeof v === 'string'
    ? v
        .replace(/[   ]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    : v;

const AMOUNT_RE = /^[(\s]*[-−–]?\s*[A-Z$€£¥₹]{0,3}\s*[-−–]?\s*\d[\d,.\s']*\)?\s*(cr|dr)?\.?\s*-?$/i;

/** A real amount — rejects dates, codes with letters and text that merely contains digits ("31 Dec 2026"). */
export function strictAmount(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const s = (clean(v) as string).replace(/[−–]/g, '-');
  if (!s || !AMOUNT_RE.test(s)) return null;
  if (/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?[\s-]+\d/i.test(s)) return null; // "Aug 2026" is a heading, not 2026
  if (/^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$/.test(s)) return null; // 31/12/2026
  return parseAmount(s);
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const monthEnd = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const fullYear = (y: number) => (y < 100 ? 2000 + y : y);

/** Reads the (last) date in a header or title such as "31 Dec 2026", "Dec 2026", "Year ended 31 December 2026", "2026-12-31", "FY2026". */
export function parseDateLabel(v: unknown): { date: string | null; year: number | null } {
  if (v instanceof Date && !isNaN(v.getTime())) return { date: iso(v.getFullYear(), v.getMonth() + 1, v.getDate()), year: v.getFullYear() };
  if (typeof v === 'number') return v >= 1990 && v <= 2100 && Number.isInteger(v) ? { date: null, year: v } : { date: null, year: null };
  if (typeof v !== 'string') return { date: null, year: null };
  const s = (clean(v) as string).toLowerCase();
  const found: { at: number; date: string | null; year: number }[] = [];
  const mon = '(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?';
  let m: RegExpExecArray | null;
  const push = (at: number, y: number, mo: number, d: number | null) => {
    if (mo < 1 || mo > 12) return;
    const day = d ?? monthEnd(y, mo);
    if (day < 1 || day > monthEnd(y, mo)) return;
    found.push({ at, date: iso(y, mo, day), year: y });
  };
  const re1 = new RegExp(`(\\d{1,2})(?:st|nd|rd|th)?[\\s-]+${mon}[\\s,-]+(\\d{4}|\\d{2})\\b`, 'g'); // 31 Dec 2026
  while ((m = re1.exec(s))) push(m.index, fullYear(+m[3]), MONTHS.indexOf(m[2].slice(0, 3)) + 1, +m[1]);
  const re2 = new RegExp(`${mon}\\s+(\\d{1,2}),?\\s+(\\d{4})\\b`, 'g'); // Dec 31, 2026
  while ((m = re2.exec(s))) push(m.index, +m[3], MONTHS.indexOf(m[1].slice(0, 3)) + 1, +m[2]);
  const re3 = /\b(\d{4})-(\d{2})-(\d{2})\b/g; // 2026-12-31
  while ((m = re3.exec(s))) push(m.index, +m[1], +m[2], +m[3]);
  const re4 = /\b(\d{1,2})[/.](\d{1,2})[/.](\d{4})\b/g; // 31/12/2026 (day first unless impossible)
  while ((m = re4.exec(s))) +m[2] > 12 ? push(m.index, +m[3], +m[1], +m[2]) : push(m.index, +m[3], +m[2], +m[1]);
  if (!found.length) {
    const re5 = new RegExp(`${mon}[\\s-]+(\\d{4}|\\d{2})\\b`, 'g'); // Dec 2026, Dec-26
    while ((m = re5.exec(s))) push(m.index, fullYear(+m[2]), MONTHS.indexOf(m[1].slice(0, 3)) + 1, null);
  }
  if (found.length) {
    const last = found.sort((a, b) => a.at - b.at)[found.length - 1];
    return { date: last.date, year: last.year };
  }
  const y = s.match(/\b(?:fy\s?)?(19\d{2}|20\d{2})\b/);
  return { date: null, year: y ? +y[1] : null };
}

// ---------------------------------------------------------------- classification

const TOTAL_RE =
  /^(total\b|sub-?total\b|net (assets|liabilities|profit|loss|income|earnings|operating|surplus|deficit|current assets|worth)\b|gross (profit|margin|loss)\b|operating (profit|income|loss|result)\b|(net )?profit (before|after|for|\/)|(net )?loss (before|after|for)|ebitda?\b|earnings before|surplus|deficit|working capital|capital employed|balance$|sum$)/i;
const ENDS_TOTAL_RE = /\btotals?$/i;
const NET_ASSETS_RE = /^net (assets|liabilities|worth|current assets)|^working capital|^capital employed/i;
const PROFIT_TOTAL_RE = /^(net |gross |operating )?(profit|loss|income|margin|result|earnings|surplus|deficit)\b|^ebit|^earnings before|^(net )?profit|^(net )?loss/i;

const DR_STRONG = /\b(expenses?|costs?|cost of (sales|goods|revenue)|purchases|overheads|cogs|depreciation|amorti[sz]ation|tax expense|direct costs|outgoings)\b/i;
const CR_WORDS = /\b(liabilit(y|ies)|payables?|creditors|borrowings?|loans? (payable|from)|equity|capital|reserves?|retained|shareholders|owners|income|revenue|sales|turnover|takings|other income|gains?|fees? earned)\b/i;
const DR_WORDS = /\b(assets?|bank|cash|receivables?|debtors|inventor(y|ies)|stock|prepayments?|investments?|fixed|property|plant|equipment|intangibles?|goodwill)\b/i;

/** Debit or credit nature of a section heading. */
export function headingNature(label: string): Nature | null {
  if (DR_STRONG.test(label)) return 'dr';
  if (CR_WORDS.test(label)) return 'cr';
  if (DR_WORDS.test(label)) return 'dr';
  return null;
}

const ROOT_RE = /^(less[: ]+)?(assets|liabilities|equity|capital and reserves|shareholders'? equity|owners'? equity|income|revenue|trading income|sales|other income|cost of sales|cost of goods sold|direct costs|expenses|operating expenses|overheads|other expenses|non-operating expenses|liabilities and equity)$/i;
const CURRENT_EARNINGS_RE = /current (year|period)'?s? (earnings|profit|surplus|result|net income)|profit (for|of) the (current )?(year|period)|net (income|profit) for the (year|period)|unallocated profit|undistributed current/i;

const YTD_RE = /\b(year|fy|financial year|period)[ -]to[ -]date\b|\bytd\b|\bcumulative\b/i;
/** "Sept 2026", "Sep-26", "September 2026" — a month without a day */
const MONTH_ONLY_RE = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?[\s-]+(\d{4}|\d{2})$/i;
const monthIndex = (d: string) => +d.slice(0, 4) * 12 + +d.slice(5, 7);

const isText = (v: unknown) => typeof v === 'string' && (clean(v) as string).length > 0 && strictAmount(v) === null;
const CODE_RE = /^[A-Za-z]{0,3}[-.]?\d[\d.\-/]{0,11}$/;

/** "200 - Sales", "Sales (200)", "1-1100 Cheque Account" -> code + name */
export function splitLabel(label: string): { code: string; name: string } {
  const t = label.trim();
  const tail = t.match(/^(.+?)\s*\((\w{0,3}[-.]?\d[\w.\-/]{0,11})\)$/);
  // "Sales (200)" is a code; "Civils - Bundaberg (BDB1)" is a site name (more letters than digits)
  if (tail && (tail[2].match(/\d/g) ?? []).length >= (tail[2].match(/[a-z]/gi) ?? []).length) return { code: tail[2], name: tail[1].trim() };
  const head = t.match(/^([A-Za-z]{0,3}[-.]?\d[\d.\-/]{0,11})\s*(?:[-–—:·•|]\s*|\s+)(.+)$/);
  if (head && /\d/.test(head[1]) && !/^\d{1,2}$/.test(head[1])) return { code: head[1], name: head[2].trim() };
  return { code: '', name: t };
}

export interface AnalyseOptions {
  /** row index -> forced type */
  overrides?: Record<number, 'account' | 'excluded'>;
}

export function analyseReport(raw: unknown[][], opt: AnalyseOptions = {}): ReportAnalysis {
  const rows = raw.map((r) => (r ?? []).map(clean));
  const width = Math.max(1, ...rows.map((r) => r.length));
  const cols = Array.from({ length: width }, (_, c) => c);

  // Label column: the one naming the rows that carry amounts (leftmost on near-ties). Titles and headings, which
  // reports often indent into other columns, have no amounts and do not count.
  const withNums = rows.filter((r) => r.some((v) => strictAmount(v) !== null));
  const basis = withNums.length >= 3 ? withNums : rows;
  const textCount = cols.map((c) => basis.filter((r) => isText(r[c])).length);
  const maxText = Math.max(...textCount);
  const labelCol = cols.find((c) => textCount[c] >= maxText * 0.6) ?? 0;

  const rowHasNum = (r: unknown[], c: number) => c !== labelCol && strictAmount(r[c]) !== null;
  /** Reports often indent headings and totals into the columns left of the account names (Xero). */
  const labelAt = (r: unknown[]): { text: string; level: number } => {
    if (isText(r[labelCol])) return { text: String(r[labelCol]), level: labelCol };
    for (let c = 0; c < labelCol; c++) if (c !== codeCol && isText(r[c]) && !CODE_RE.test(String(r[c]))) return { text: String(r[c]), level: c };
    return { text: '', level: labelCol };
  };
  // Code column: a column (other than the label) holding short code-like values on rows that also have a label
  const labelled = rows.filter((r) => isText(r[labelCol]));
  let codeCol = -1;
  for (const c of cols) {
    if (c === labelCol) continue;
    const vals = labelled.map((r) => r[c]).filter((v) => v !== '' && v !== undefined && v !== null);
    if (vals.length < 3) continue;
    const codeLike = vals.filter((v) => CODE_RE.test(String(v)) && !(typeof v === 'number' && !Number.isInteger(v)));
    const header = rows.slice(0, 15).some((r) => /\b(code|acc(oun)?t\.? ?(no|number|#)|n\/c|gl)\b/i.test(String(r[c] ?? '')));
    const unique = new Set(codeLike.map(String)).size >= codeLike.length * 0.9;
    if ((header || (c < labelCol && codeLike.length >= vals.length * 0.8)) && unique && codeLike.length >= vals.length * 0.6) {
      codeCol = c;
      break;
    }
  }

  // Amount columns: numeric on rows that carry a label
  const numCount = cols.map((c) => (c === codeCol || c === labelCol ? 0 : labelled.filter((r) => rowHasNum(r, c)).length));
  const maxNum = Math.max(0, ...numCount);
  const amountColIdx = cols.filter((c) => numCount[c] > 0 && numCount[c] >= Math.max(1, maxNum * 0.25));

  // First row that looks like data (label + amount)
  const firstData = rows.findIndex((r) => isText(r[labelCol]) && amountColIdx.some((c) => rowHasNum(r, c)));
  // Header row: last row above the first data row with non-numeric text in an amount column
  let headerRow = -1;
  for (let i = (firstData < 0 ? rows.length : firstData) - 1; i >= 0; i--) {
    if (amountColIdx.some((c) => rows[i][c] !== '' && rows[i][c] !== undefined && (strictAmount(rows[i][c]) === null || parseDateLabel(rows[i][c]).year))) {
      headerRow = i;
      break;
    }
  }
  const amountCols: AmountColumn[] = amountColIdx.map((c) => {
    const h = headerRow >= 0 ? rows[headerRow][c] : '';
    const d = parseDateLabel(h);
    const text = h instanceof Date ? d.date ?? '' : String(h ?? '');
    return { col: c, header: text, date: d.date, year: d.year, ytd: YTD_RE.test(text), month: !!d.date && !(h instanceof Date) && MONTH_ONLY_RE.test(text) };
  });

  // Title rows: everything above the header (or above the first heading/data row)
  const titleEnd = headerRow >= 0 ? headerRow : Math.max(0, firstData);
  const titles = rows
    .slice(0, titleEnd)
    .map((r) => r.find((v) => isText(v)) as string | undefined)
    .filter((v): v is string => !!v);
  const entityName =
    titles.find((t) => t.length < 80 && !/balance sheet|financial position|profit|loss|income statement|trial balance|report|as (of|at)|for the|period|month|year|ended|\d{4}|ytd|page|accrual|cash basis/i.test(t)) ?? null;
  const reportDate = titles.map((t) => parseDateLabel(t).date).find(Boolean) ?? null;
  for (const c of amountCols) if (c.ytd && !c.date && reportDate) Object.assign(c, { date: reportDate, year: +reportDate.slice(0, 4) });

  // Report kind from titles and headings
  const allText = [...titles, ...rows.map((r) => (isText(r[labelCol]) ? String(r[labelCol]) : ''))].join(' \n ').toLowerCase();
  const isBS = /balance sheet|financial position|statement of assets/.test(allText) || (/\bassets\b/.test(allText) && /\b(liabilities|equity)\b/.test(allText));
  const isPL = /profit (and|&) loss|income statement|statement of (profit|comprehensive income|operations)|\bp ?& ?l\b/.test(allText) || (/\b(income|revenue|sales)\b/.test(allText) && /\b(expenses|cost of sales)\b/.test(allText));
  const kind: ReportAnalysis['kind'] = isBS && !(isPL && !/balance sheet|financial position/.test(allText)) ? 'balance_sheet' : isPL ? 'profit_loss' : 'report';

  // Walk the rows
  interface Frame {
    label: string;
    /** column the heading sits in (indentation) */
    level: number;
    sums: number[];
    /** account lines directly under this heading (not via a sub-heading) */
    direct: boolean;
  }
  const stack: Frame[] = [];
  const out: ReportRow[] = [];
  const n = amountCols.length;
  const running = Array(n).fill(0); // debit-positive sum of all accounts so far
  let agree = 0,
    checked = 0;
  const natureOf = (path: string[]): Nature | null => {
    for (let i = path.length - 1; i >= 0; i--) {
      const nt = headingNature(path[i]);
      if (nt) return nt;
    }
    return null;
  };

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const at = labelAt(r);
    const rawLabel = at.text;
    const amounts = amountCols.map((a) => strictAmount(r[a.col]));
    const hasAmt = amounts.some((v) => v !== null);
    const path = stack.map((f) => f.label);
    const base = { index: i, code: '', path, amounts, nature: null as Nature | null };
    if (i < titleEnd) {
      out.push({ ...base, type: 'title', label: rawLabel || String(r.find((v) => isText(v)) ?? ''), reason: 'Report title' });
      continue;
    }
    if (i === headerRow) {
      out.push({ ...base, type: 'header', label: rawLabel, reason: 'Column headings' });
      continue;
    }
    if (!rawLabel && !hasAmt) {
      out.push({ ...base, type: 'blank', label: '', reason: '' });
      continue;
    }
    let { code, name } = splitLabel(rawLabel);
    if (codeCol >= 0 && r[codeCol] !== '' && r[codeCol] !== undefined) code = String(r[codeCol]);
    const forced = opt.overrides?.[i];

    if (!hasAmt && !forced) {
      // headings keep their full text: "ABX1 (Albury)" is a site, not account code ABX1
      code = '';
      name = rawLabel.trim();
      if (TOTAL_RE.test(name) || ENDS_TOTAL_RE.test(name)) {
        popTo(name);
        out.push({ ...base, type: 'total', label: name, reason: 'Total without amounts' });
      } else {
        if (ROOT_RE.test(name)) stack.length = 0;
        else {
          // headings indented less than (or as much as) an open section close it: they are siblings or uncles
          while (stack.length && stack[stack.length - 1].level > at.level) stack.pop();
          const top = stack[stack.length - 1];
          // same indent: a sibling if it is indented left of the accounts, or follows account lines without a total
          if (top && top.level === at.level && (at.level < labelCol || top.direct)) stack.pop();
        }
        stack.push({ label: name, level: at.level, sums: Array(n).fill(0), direct: false });
        out.push({ ...base, type: 'heading', label: name, path: stack.slice(0, -1).map((f) => f.label), nature: headingNature(name), reason: 'Section heading (text without amounts)' });
      }
      continue;
    }

    const looksTotal = !code && (TOTAL_RE.test(name) || ENDS_TOTAL_RE.test(name) || !name);
    if ((looksTotal && forced !== 'account') || forced === 'excluded') {
      const row: ReportRow = { ...base, type: forced === 'excluded' ? 'excluded' : 'total', label: name, reason: forced === 'excluded' ? 'Excluded by you' : !name ? 'Unlabelled amount row (a sum)' : 'Total / subtotal row' };
      if (row.type === 'total') {
        // compare with the lines it should add up
        const target = name.replace(/^(total|sub-?total)\s*(for\s*)?:?\s*/i, '').replace(/\s*totals?$/i, '').toLowerCase();
        const frameIdx = findFrame(target);
        let computed: number[] | null = null;
        if (frameIdx >= 0) computed = stack[frameIdx].sums;
        else if (NET_ASSETS_RE.test(name)) computed = running.slice();
        else if (PROFIT_TOTAL_RE.test(name)) computed = running.map((v) => -v);
        if (computed) {
          row.check = amounts.map((v, k) => {
            if (v === null) return null;
            checked++;
            const ok = Math.abs(v - computed![k]) < 0.6;
            if (ok) agree++;
            return ok ? 'ok' : 'diff';
          });
        }
        if (frameIdx >= 0) stack.length = frameIdx;
      }
      out.push(row);
      continue;
    }

    // account line
    const nature = natureOf(path);
    const currentEarnings = CURRENT_EARNINGS_RE.test(name) && (nature === 'cr' || kind === 'balance_sheet');
    for (const f of stack) amounts.forEach((v, k) => (f.sums[k] += v ?? 0));
    if (stack.length) stack[stack.length - 1].direct = true;
    amounts.forEach((v, k) => (running[k] += nature === 'cr' ? -(v ?? 0) : v ?? 0));
    out.push({ ...base, type: 'account', label: name, code, nature, currentEarnings, reason: forced === 'account' ? 'Included by you' : nature ? `Account under “${path[path.length - 1] ?? ''}”` : 'Account (no section found)' });
  }

  // headings with no account lines after them are notes below the report (exchange rates, signatures …)
  const lastAccount = out.reduce((k, r) => (r.type === 'account' || r.type === 'total' ? r.index : k), -1);
  for (const r of out) if (r.index > lastAccount && r.type === 'heading') Object.assign(r, { type: 'note', reason: 'Note below the report' });

  // Does the Year to date column add up the month columns? Then it covers exactly those months.
  let ytdStart: string | null = null;
  const yi = amountCols.findIndex((c) => c.ytd);
  const months = amountCols.map((c, k) => ({ c, k })).filter((x) => x.c.month && x.c.date);
  if (yi >= 0 && months.length) {
    const accs = out.filter((r) => r.type === 'account');
    const sums = accs.every((r) => Math.abs((r.amounts[yi] ?? 0) - months.reduce((t, m) => t + (r.amounts[m.k] ?? 0), 0)) < 0.6);
    const ds = months.map((m) => m.c.date!).sort();
    const contiguous = ds.every((d, k) => k === 0 || monthIndex(d) - monthIndex(ds[k - 1]) === 1);
    if (accs.length && sums && contiguous && ds[ds.length - 1] === amountCols[yi].date) ytdStart = `${ds[0].slice(0, 7)}-01`;
  }

  function findFrame(target: string): number {
    if (!target) return -1;
    for (let k = stack.length - 1; k >= 0; k--) if (stack[k].label.toLowerCase().replace(/^less[: ]+/, '') === target.replace(/^less[: ]+/, '')) return k;
    return -1;
  }
  function popTo(name: string) {
    const k = findFrame(name.replace(/^(total|sub-?total)\s*:?\s*/i, '').toLowerCase());
    if (k >= 0) stack.length = k;
  }

  const currency =
    rows
      .flat()
      .map((v) => (typeof v === 'string' ? v.match(/\b(?:into|amounts (?:are )?in|currency:?|presented in|expressed in)\s+([A-Z]{3})\b/)?.[1] : undefined))
      .find(Boolean) ?? null;

  return { kind, labelCol, codeCol, amountCols, rows: out, entityName, reportDate, currency, totals: { agree, checked }, ytdStart, balance: running };
}

/** Is this sheet a formatted report rather than a table with debit/credit columns? */
export function looksLikeReport(raw: unknown[][]): boolean {
  const head = raw.slice(0, 40);
  if (head.some((r) => (r ?? []).filter((c) => typeof c === 'string' && /^(ytd |closing |period )?(debit|credit|dr|cr)s?( amount| balance)?$/i.test(c.trim())).length >= 2)) return false;
  const a = analyseReport(raw);
  const headings = a.rows.filter((r) => r.type === 'heading').length;
  const totals = a.rows.filter((r) => r.type === 'total').length;
  const accounts = a.rows.filter((r) => r.type === 'account').length;
  return accounts > 0 && headings >= 2 && totals >= 1;
}

/**
 * Turns the account lines into trial balance lines for the chosen periods.
 * Amounts become debit-positive using the section nature; lines whose section is unknown keep the natural sign
 * (resolved after mapping).
 */
export function reportToLines(a: ReportAnalysis, colPeriods: (Period | null)[], sourceIds: Partial<Record<Period, string>>, skipZero = true): TBLine[] {
  const lines: TBLine[] = [];
  for (const r of a.rows) {
    if (r.type !== 'account') continue;
    // several columns can be set to one period (e.g. monthly columns added up): one line per period
    const per = new Map<Period, number>();
    r.amounts.forEach((v, k) => {
      const period = colPeriods[k];
      if (period && v !== null) per.set(period, (per.get(period) ?? 0) + v);
    });
    per.forEach((v, period) => {
      if (skipZero && Math.abs(v) < 0.005) return;
      const sourceId = sourceIds[period]!;
      lines.push({
        id: uid('ln'),
        code: r.code,
        name: r.label,
        amount: r.nature === 'cr' ? -v : v,
        sign: r.nature ? 'dr' : 'natural',
        sourceId,
        period,
        section: r.path.join(' › '),
        currentEarnings: r.currentEarnings || undefined,
      });
    });
  }
  return lines;
}

export type ColPeriod = Period | 'skip';

/**
 * Default period for each amount column.
 * - P&L with a Year to date column (monthly Xero layouts): import the YTD column, not the single months.
 * - P&L with only month columns and a period start set: add up the months inside each period.
 * - Otherwise by exact date, then by year (one column per period), then left-to-right.
 * Balance sheet columns are points in time and are never added together.
 */
export function defaultColPeriods(a: ReportAnalysis, project: Project): ColPeriod[] {
  const cy = periodEndOf(project, 'cy'),
    py = periodEndOf(project, 'py');
  const cols = a.amountCols;
  const out: (ColPeriod | null)[] = cols.map(() => null);
  const pl = a.kind !== 'balance_sheet';
  if (pl && cols.some((c) => c.ytd)) {
    cols.forEach((c, i) => {
      if (!c.ytd) out[i] = 'skip';
      else if (c.date === py && !out.includes('py')) out[i] = 'py';
      else if (!out.includes('cy')) out[i] = 'cy';
      else out[i] = 'skip';
    });
    return out as ColPeriod[];
  }
  if (pl && project.periodStart && cols.some((c) => c.month)) {
    const s = periodStartOf(project, 'cy'),
      ps = periodStartOf(project, 'py');
    cols.forEach((c, i) => {
      if (!c.month || !c.date) return;
      out[i] = c.date >= s && c.date <= cy ? 'cy' : c.date >= ps && c.date <= py ? 'py' : 'skip';
    });
    if (out.includes('cy') || out.includes('py')) return out.map((x) => x ?? 'skip') as ColPeriod[];
  }
  cols.forEach((c, i) => (out[i] = c.date === cy && !out.includes('cy') ? 'cy' : c.date === py && !out.includes('py') ? 'py' : null));
  cols.forEach((c, i) => {
    if (out[i]) return;
    if (c.year === +cy.slice(0, 4) && !out.includes('cy')) out[i] = 'cy';
    else if (c.year === +py.slice(0, 4) && !out.includes('py')) out[i] = 'py';
  });
  const datesKnown = cols.some((c) => c.date || c.year);
  cols.forEach((_, i) => {
    if (out[i]) return;
    if (!datesKnown && !out.includes('cy')) out[i] = 'cy';
    else if (!datesKnown && !out.includes('py')) out[i] = 'py';
    else out[i] = 'skip';
  });
  // dated columns that match neither period: take the newest as current and the next as prior
  if (!out.includes('cy') && !out.includes('py') && datesKnown) {
    const order = cols.map((c, i) => ({ i, key: c.date ?? `${c.year}-12-31` })).sort((x, y) => (x.key < y.key ? 1 : -1));
    if (order[0]) out[order[0].i] = 'cy';
    if (order[1]) out[order[1].i] = 'py';
  }
  return out as ColPeriod[];
}

