import * as XLSX from 'xlsx';
import type { Entity, Project } from '../types';
import { suggestMapping } from './automap';
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
      ['4050', 'Intercompany management fee income', -60000],
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
    e.lines = s.rows.map(([code, name, amount]) => ({ id: uid('ln'), code, name, amount, sign: 'dr' as const, sourceId: srcId }));
    for (const l of e.lines) {
      const sug = suggestMapping(l.code, l.name, p.accounts);
      if (sug) e.mapping[lineKey(l)] = sug.code;
    }
    return e;
  });
  p.entities = ents;
  const [apex, beacon, cobalt, delta] = ents;
  p.parentId = apex.id;
  p.holdings = [
    { id: uid('h'), holderId: apex.id, investeeId: beacon.id, pct: 80, cost: 800000, acqEquity: 900000, acqDate: '2023-01-01' },
    { id: uid('h'), holderId: beacon.id, investeeId: cobalt.id, pct: 60, cost: 600000, acqEquity: 577500, acqDate: '2024-01-01' },
    { id: uid('h'), holderId: apex.id, investeeId: delta.id, pct: 30, cost: 300000, acqEquity: 800000, acqDate: '2022-07-01' },
  ];
  return p;
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
