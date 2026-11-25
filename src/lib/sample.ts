import * as XLSX from 'xlsx';
import type { Entity, GroupAccount, Project } from '../types';
import { suggestMapping } from './automap';
import { autoTagCounterparties } from './counterparty';
import { emptyProject, lineKey, newEntity, uid } from './util';

type Row = [code: string, name: string, debitPositive: number];

export interface SampleEntity {
  name: string;
  code: string;
  currency: string;
  country: string;
  system: string;
  rows: Row[];
  rates?: { closing: number; average: number; historical: number };
  ratesPrior?: { closing: number; average: number; historical: number };
}

export const SAMPLE: SampleEntity[] = [
  {
    name: 'Apex Holdings Inc',
    code: 'APEX',
    currency: 'USD',
    country: 'United States',
    system: 'xero',
    rows: [
      ['1000', 'Business Bank Account', 450000],
      ['1100', 'Accounts Receivable', 120000],
      ['1150', 'Intercompany receivable - Beacon', 50000],
      ['1500', 'Office Equipment', 600000],
      ['1700', 'Investment in subsidiary - Beacon Trading LLC', 800000],
      ['1710', 'Investment in associate - Delta Logistics', 300000],
      ['2000', 'Accounts Payable', -90000],
      ['2200', 'Bank Loan', -400000],
      ['3000', 'Share Capital', -1000000],
      ['3200', 'Retained Earnings', -600000],
      ['4000', 'Sales', -1200000],
      ['4050', 'Intercompany management fee income - Beacon', -60000],
      ['5000', 'Cost of Goods Sold', 700000],
      ['5100', 'Wages and Salaries', 180000],
      ['5300', 'Rent', 40000],
      ['5400', 'Interest Expense', 20000],
      ['5500', 'Income Tax Expense', 90000],
    ],
  },
  {
    name: 'Beacon Trading LLC',
    code: 'BEAC',
    currency: 'USD',
    country: 'United States',
    system: 'quickbooks',
    rows: [
      ['1010', 'Checking', 200000],
      ['1200', 'Accounts Receivable (A/R)', 180000],
      ['1300', 'Inventory Asset', 150000],
      ['1500', 'Machinery & Equipment', 400000],
      ['1700', 'Investment in subsidiary - Cobalt GmbH', 600000],
      ['2050', 'Due to Apex Holdings', -50000],
      ['2000', 'Accounts Payable (A/P)', -110000],
      ['2100', 'Accrued Liabilities', -40000],
      ['2700', 'Long-term loan', -300000],
      ['3000', 'Common Stock', -500000],
      ['3900', 'Retained Earnings', -430000],
      ['4000', 'Sales of Product Income', -900000],
      ['5000', 'Cost of Goods Sold', 500000],
      ['6010', 'Intercompany management fees - Apex', 60000],
      ['6100', 'Payroll Expenses', 150000],
      ['6200', 'Depreciation', 40000],
      ['6300', 'Utilities', 20000],
      ['6900', 'Income tax expense', 30000],
    ],
  },
  {
    name: 'Cobalt GmbH',
    code: 'COB',
    currency: 'EUR',
    country: 'Germany',
    system: 'sap',
    rates: { closing: 1.1, average: 1.08, historical: 1.05 },
    ratesPrior: { closing: 1.05, average: 1.07, historical: 1.05 },
    rows: [
      ['113100', 'Bank Deutsche Bank', 150000],
      ['140000', 'Trade receivables', 120000],
      ['200000', 'Raw materials inventory', 80000],
      ['21000', 'Technical equipment and machinery', 500000],
      ['160000', 'Trade payables', -100000],
      ['310000', 'Bank loans', -150000],
      ['800000', 'Subscribed capital', -400000],
      ['860000', 'Retained earnings', -150000],
      ['400000', 'Revenue domestic', -700000],
      ['500000', 'Material costs', 400000],
      ['620000', 'Personnel expenses', 150000],
      ['650000', 'Depreciation', 30000],
      ['680000', 'Other operating expenses', 40000],
      ['770000', 'Corporate income tax', 30000],
    ],
  },
  {
    name: 'Delta Logistics Ltd',
    code: 'DELT',
    currency: 'USD',
    country: 'Singapore',
    system: 'generic',
    rows: [
      ['100', 'Cash at bank', 100000],
      ['110', 'Trade debtors', 200000],
      ['150', 'Vehicles', 700000],
      ['200', 'Trade creditors', -50000],
      ['300', 'Share capital', -600000],
      ['310', 'Retained earnings', -250000],
      ['400', 'Freight revenue', -500000],
      ['500', 'Operating expenses', 350000],
      ['590', 'Income tax expense', 50000],
    ],
  },
];

export function buildSampleProject(): Project {
  const p = emptyProject();
  p.name = 'Apex Group (sample)';
  p.periodEnd = '2026-12-31';
  const ents: Entity[] = SAMPLE.map((s) => {
    const e = newEntity(s.name, s.currency);
    e.code = s.code;
    e.country = s.country;
    if (s.rates) e.rates = { ...s.rates };
    const srcId = uid('src');
    e.sources.push({ id: srcId, fileName: `${s.code}_trial_balance.xlsx`, sheet: 'TB', system: s.system, importedAt: new Date().toISOString(), lineCount: s.rows.length });
    if (s.ratesPrior) e.ratesPrior = { ...s.ratesPrior };
    const pySrc = uid('src');
    const py = priorYearRows(s.rows, p.accounts);
    e.sources.push({ id: pySrc, fileName: `${s.code}_trial_balance_prior_year.xlsx`, sheet: 'TB', system: s.system, importedAt: new Date().toISOString(), lineCount: py.length, period: 'py' });
    e.lines = [
      ...s.rows.map(([code, name, amount]) => ({ id: uid('ln'), code, name, amount, sign: 'dr' as const, sourceId: srcId })),
      ...py.map(([code, name, amount]) => ({ id: uid('ln'), code, name, amount, sign: 'dr' as const, sourceId: pySrc, period: 'py' as const })),
    ];
    for (const l of e.lines) {
      const sug = suggestMapping(l.code, l.name, p.accounts);
      if (sug) e.mapping[lineKey(l)] = sug.code;
    }
    return e;
  });
  p.entities = ents;
  autoTagCounterparties(p);
  const [apex, beacon, cobalt, delta] = ents;
  p.parentId = apex.id;
  p.holdings = [
    { id: uid('h'), holderId: apex.id, investeeId: beacon.id, pct: 80, cost: 800000, acqEquity: 800000, acqDate: '2023-01-01' },
    { id: uid('h'), holderId: beacon.id, investeeId: cobalt.id, pct: 60, cost: 600000, acqEquity: 525000, acqDate: '2024-01-01' },
    { id: uid('h'), holderId: apex.id, investeeId: delta.id, pct: 30, cost: 300000, acqEquity: 700000, acqDate: '2022-07-01' },
  ];
  return p;
}

/**
 * Derives a plausible, balanced prior-year trial balance from the current one:
 * P&L at 90%, working balances at 95%, capital / investments / intercompany unchanged,
 * opening retained earnings rolled back by the prior-year profit and cash as the balancing figure.
 */
export function priorYearRows(rows: Row[], accounts: GroupAccount[]): Row[] {
  const typeOf = (code: string, name: string) => {
    const s = suggestMapping(code, name, accounts);
    return { group: s?.code ?? '', type: accounts.find((a) => a.code === s?.code)?.type };
  };
  const out: Row[] = rows.map(([code, name, amt]) => {
    const { group, type } = typeOf(code, name);
    if (type === 'revenue' || type === 'expense') return [code, name, Math.round(amt * 0.9)];
    if (type === 'equity' || ['1700', '1710', '1150', '2050', '1000'].includes(group)) return [code, name, amt];
    return [code, name, Math.round(amt * 0.95)];
  });
  const pyProfit = -out.filter(([c, n]) => ['revenue', 'expense'].includes(typeOf(c, n).type ?? '')).reduce((t, [, , a]) => t + a, 0);
  const re = out.findIndex(([c, n]) => typeOf(c, n).group === '3200');
  if (re >= 0) out[re] = [out[re][0], out[re][1], out[re][2] + pyProfit];
  const cash = out.findIndex(([c, n]) => typeOf(c, n).group === '1000');
  const diff = out.reduce((t, [, , a]) => t + a, 0);
  out[cash] = [out[cash][0], out[cash][1], out[cash][2] - diff];
  return out;
}

/** Sample Excel files in the layouts different accounting systems export, to try the importer. */
export function sampleWorkbook(s: SampleEntity): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  let aoa: unknown[][];
  if (s.system === 'quickbooks') {
    aoa = [[s.name], ['Trial Balance'], ['As of December 31, 2026'], [], ['', 'Debit', 'Credit'], ...s.rows.map(([c, n, a]) => [`${c} · ${n}`, a > 0 ? a : '', a < 0 ? -a : '']), ['TOTAL', sum(s, 1), sum(s, -1)]];
  } else if (s.system === 'sap') {
    aoa = [['Company Code', 'G/L Account', 'Short Text', 'Currency', 'Balance'], ...s.rows.map(([c, n, a]) => ['1000', c, n, s.currency, a])];
  } else if (s.system === 'xero') {
    aoa = [['Trial Balance'], [s.name], ['As at 31 December 2026'], [], ['Account Code', 'Account', 'Account Type', 'Debit', 'Credit', 'YTD Debit', 'YTD Credit'], ...s.rows.map(([c, n, a]) => [c, n, '', '', '', a > 0 ? a : '', a < 0 ? -a : '']), ['', 'Total', '', '', '', sum(s, 1), sum(s, -1)]];
  } else {
    aoa = [['Code', 'Description', 'Closing balance'], ...s.rows.map(([c, n, a]) => [c, n, a])];
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Trial Balance');
  return wb;
}

const sum = (s: SampleEntity, sign: 1 | -1) => s.rows.reduce((t, [, , a]) => t + (sign > 0 ? Math.max(a, 0) : Math.max(-a, 0)), 0);

export function downloadTemplate() {
  const wb = XLSX.utils.book_new();
  const aoa = [
    ['Account Code', 'Account Name', 'Debit', 'Credit'],
    ['1000', 'Cash at bank', 10000, ''],
    ['2000', 'Trade payables', '', 4000],
    ['3000', 'Share capital', '', 6000],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Trial Balance');
  XLSX.writeFile(wb, 'trial_balance_template.xlsx');
}

export function downloadSampleFile(s: SampleEntity) {
  XLSX.writeFile(sampleWorkbook(s), `${s.code}_${s.system}_trial_balance.xlsx`);
}

// ---------------------------------------------------------------- Xero-style report exports

type Section = { title: string; codes: (c: string) => boolean };
const BS_LAYOUT: { root: string; total: string; sections: Section[] }[] = [
  {
    root: 'Assets',
    total: 'Total Assets',
    sections: [
      { title: 'Bank', codes: (c) => c === '1000' },
      { title: 'Current Assets', codes: (c) => ['1100', '1150', '1200', '1300'].includes(c) },
      { title: 'Fixed Assets', codes: (c) => ['1500', '1600'].includes(c) },
      { title: 'Non-current Assets', codes: (c) => ['1650', '1700', '1710', '1720', '1800'].includes(c) },
    ],
  },
  {
    root: 'Liabilities',
    total: 'Total Liabilities',
    sections: [
      { title: 'Current Liabilities', codes: (c) => c >= '2000' && c < '2500' },
      { title: 'Non-current Liabilities', codes: (c) => c >= '2500' && c < '3000' },
    ],
  },
];
const PL_LAYOUT: Section[] = [
  { title: 'Trading Income', codes: (c) => ['4000', '4050'].includes(c) },
  { title: 'Cost of Sales', codes: (c) => c === '5000' },
  { title: 'Other Income', codes: (c) => c > '4050' && c < '5000' },
  { title: 'Operating Expenses', codes: (c) => c > '5000' },
];

/** Rows of a Xero "Balance Sheet" and "Profit and Loss" export (current + comparative column) for a sample company. */
export function xeroReportRows(s: SampleEntity, accounts: GroupAccount[], periodEnd = '2026-12-31') {
  const py = priorYearRows(s.rows, accounts);
  const group = (code: string, name: string) => suggestMapping(code, name, accounts)?.code ?? '';
  const typeOf = (g: string) => accounts.find((a) => a.code === g)?.type;
  const lines = s.rows.map(([code, name, cy], i) => {
    const g = group(code, name);
    const t = typeOf(g);
    const nat = (v: number) => (t === 'asset' || t === 'expense' ? v : -v);
    return { name, g, t, cy: nat(cy), py: nat(py[i][2]) };
  });
  const year = periodEnd.slice(0, 4);
  const head = (title: string) => [[title], [s.name], [title === 'Balance Sheet' ? `As at 31 December ${year}` : `For the year ended 31 December ${year}`], [], ['', `31 Dec ${year}`, `31 Dec ${+year - 1}`]];
  const sum = (ls: typeof lines) => [ls.reduce((t, l) => t + l.cy, 0), ls.reduce((t, l) => t + l.py, 0)];

  const pl: unknown[][] = head('Profit and Loss');
  const plTotals: Record<string, number[]> = {};
  for (const sec of PL_LAYOUT) {
    const ls = lines.filter((l) => (l.t === 'revenue' || l.t === 'expense') && sec.codes(l.g));
    plTotals[sec.title] = sum(ls);
    if (ls.length) {
      pl.push([sec.title], ...ls.map((l) => [l.name, l.cy, l.py]), [`Total ${sec.title}`, ...plTotals[sec.title]], []);
    }
    if (sec.title === 'Cost of Sales') pl.push(['Gross Profit', ...[0, 1].map((k) => plTotals['Trading Income'][k] - plTotals['Cost of Sales'][k])], []);
  }
  const profit = [0, 1].map((k) => plTotals['Trading Income'][k] - plTotals['Cost of Sales'][k] + plTotals['Other Income'][k] - plTotals['Operating Expenses'][k]);
  pl.push(['Net Profit', ...profit]);

  const bs: unknown[][] = head('Balance Sheet');
  const rootTotals: number[][] = [];
  for (const root of BS_LAYOUT) {
    bs.push([root.root]);
    const all: typeof lines = [];
    for (const sec of root.sections) {
      const ls = lines.filter((l) => sec.codes(l.g) && (l.t === 'asset' || l.t === 'liability'));
      if (!ls.length) continue;
      all.push(...ls);
      bs.push([sec.title], ...ls.map((l) => [l.name, l.cy, l.py]), [`Total ${sec.title}`, ...sum(ls)], []);
    }
    rootTotals.push(sum(all));
    bs.push([root.total, ...sum(all)], []);
  }
  bs.push(['Net Assets', ...[0, 1].map((k) => rootTotals[0][k] - rootTotals[1][k])], []);
  const eq = lines.filter((l) => l.t === 'equity');
  const eqRows = [['Current Year Earnings', ...profit], ...eq.map((l) => [l.name, l.cy, l.py])];
  bs.push(['Equity'], ...eqRows, ['Total Equity', ...[0, 1].map((k) => eqRows.reduce((t, r) => t + (r[k + 1] as number), 0))]);
  return { bs, pl };
}

export function downloadXeroReports(s: SampleEntity, accounts: GroupAccount[]) {
  const { bs, pl } = xeroReportRows(s, accounts);
  for (const [rows, title] of [
    [bs, 'Balance_Sheet'],
    [pl, 'Profit_and_Loss'],
  ] as const) {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), title.replace(/_/g, ' '));
    XLSX.writeFile(wb, `${s.name.replace(/[^\w]+/g, '_')}-${title}.xlsx`);
  }
}
