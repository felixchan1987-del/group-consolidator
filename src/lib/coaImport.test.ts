import { analyseCoa, applyChart, buildChart, classifyAccount, looksLikeCoa } from './coaImport';
import { consolidate } from './consolidate';
import { projectForPeriod } from './periods';
import { SAMPLE, sampleWorkbook } from './sample';
import * as XLSX from 'xlsx';
import { suggestForLine, suggestMapping } from './automap';
import { emptyProject, lineKey, newEntity, uid } from './util';
import { readWorkbook } from './importer';
import type { Project, TBLine } from '../types';

// A chart of accounts as Xero exports it (Accounting › Chart of accounts › Export); made-up group.
const XERO_COA: (string | number)[][] = [
  ['*Code', '*Name', '*Type', '*Tax Code', 'Description', 'Dashboard', 'Expense Claims', 'Enable Payments'],
  ['090', 'Operating Account', 'Bank', 'BAS Excluded', '', 'Yes', 'No', 'No'],
  ['200', 'Sales - Hosting', 'Revenue', 'GST on Income', '', 'No', 'No', 'No'],
  ['210', 'Sales - Services', 'Revenue', 'GST on Income', '', 'No', 'No', 'No'],
  ['270', 'Interest Income', 'Other Income', 'GST Free Income', '', 'No', 'No', 'No'],
  ['310', 'Power Costs - Site A', 'Direct Costs', 'GST on Expenses', '', 'No', 'No', 'No'],
  ['311', 'Freight', 'Direct Costs', 'GST on Expenses', '', 'No', 'No', 'No'],
  ['400', 'Wages and Salaries', 'Expense', 'BAS Excluded', '', 'No', 'No', 'No'],
  ['410', 'Repairs and Maintenance', 'Expense', 'GST on Expenses', '', 'No', 'Yes', 'No'],
  ['416', 'Depreciation', 'Depreciation', 'BAS Excluded', '', 'No', 'No', 'No'],
  ['437', 'Interest Expense', 'Expense', 'BAS Excluded', '', 'No', 'No', 'No'],
  ['505', 'Income Tax Expense', 'Expense', 'BAS Excluded', '', 'No', 'No', 'No'],
  ['610', 'Accounts Receivable', 'Current Asset', 'BAS Excluded', '', 'No', 'No', 'No'],
  ['615', 'Intercompany Loan Receivable', 'Current Asset', 'BAS Excluded', '', 'No', 'No', 'No'],
  ['620', 'Prepayments', 'Prepayment', 'BAS Excluded', '', 'No', 'No', 'No'],
  ['630', 'Inventory', 'Inventory', 'BAS Excluded', '', 'No', 'No', 'No'],
  ['710', 'Office Equipment', 'Fixed Asset', 'GST on Expenses', '', 'No', 'No', 'No'],
  ['711', 'Less Accumulated Depreciation on Office Equipment', 'Fixed Asset', 'BAS Excluded', '', 'No', 'No', 'No'],
  ['720', 'Investment in Northwind Hosting', 'Non-current Asset', 'BAS Excluded', '', 'No', 'No', 'No'],
  ['800', 'Accounts Payable', 'Current Liability', 'BAS Excluded', '', 'No', 'No', 'No'],
  ['815', 'Intercompany Loan Payable', 'Current Liability', 'BAS Excluded', '', 'No', 'No', 'No'],
  ['820', 'GST', 'Current Liability', 'BAS Excluded', '', 'No', 'No', 'No'],
  ['900', 'Long term debt', 'Non-current Liability', 'BAS Excluded', '', 'No', 'No', 'No'],
  ['960', 'Retained Earnings', 'Equity', 'BAS Excluded', '', 'No', 'No', 'No'],
  ['970', 'Issued Capital', 'Equity', 'BAS Excluded', '', 'No', 'No', 'No'],
  ['980', 'Old Suspense', 'Expense', 'BAS Excluded', '', 'No', 'No', 'No'],
];

const line = (name: string, amount: number, section: string): TBLine => ({ id: uid('ln'), code: '', name, amount, sign: 'dr', sourceId: 's', period: 'cy', section });

describe('chart of accounts import', () => {
  it('recognises a chart of accounts and reads type and section from the account types', () => {
    expect(looksLikeCoa(XERO_COA)).toBe(true);
    // the sample trial balances are not a chart of accounts
    const tb = SAMPLE.map((s) => looksLikeCoa(XLSX.utils.sheet_to_json<unknown[]>(Object.values(sampleWorkbook(s).Sheets)[0], { header: 1, defval: '' })));
    expect(tb.every((x) => !x)).toBe(true);
    const a = analyseCoa(XERO_COA)!;
    expect([a.codeCol, a.nameCol, a.typeCol]).toEqual([0, 1, 2]);
    const by = (n: string) => a.rows.find((r) => r.name === n)!;
    expect([by('Operating Account').type, by('Operating Account').section]).toEqual(['asset', 'Current assets']);
    expect(by('Power Costs - Site A').section).toBe('Cost of sales');
    expect(by('Interest Income').section).toBe('Finance income');
    expect(by('Interest Expense').section).toBe('Finance costs');
    expect(by('Income Tax Expense').section).toBe('Income tax');
    expect(by('Depreciation').section).toBe('Operating expenses');
    expect(by('Office Equipment').section).toBe('Non-current assets');
    expect(by('Long term debt').section).toBe('Non-current liabilities');
    expect(by('GST').section).toBe('Current liabilities');
    expect(by('Retained Earnings').type).toBe('equity');
    expect(by('090' === by('Operating Account').code ? 'Operating Account' : '').code).toBe('090'); // leading zero kept
  });

  it('keeps leading zeros of codes in a CSV export', () => {
    const csv = XERO_COA.map((r) => r.map((c) => `"${c}"`).join(',')).join('\n') + '\n"Total","1,234.50","5"';
    const [sh] = readWorkbook(new TextEncoder().encode(csv).buffer as ArrayBuffer);
    expect(analyseCoa(sh.rows)!.rows[0].code).toBe('090');
    expect(sh.rows[sh.rows.length - 1].slice(0, 3)).toEqual(['Total', 1234.5, 5]);
  });

  it('reads other systems’ type names and guesses from the name when there is no type', () => {
    expect(classifyAccount('Accounts receivable (A/R)', 'Accounts Receivable')?.section).toBe('Current assets');
    expect(classifyAccount('Long Term Liabilities', 'Bank loan')?.section).toBe('Non-current liabilities');
    expect(classifyAccount('Cost of Goods Sold', 'Purchases')?.section).toBe('Cost of sales');
    expect(classifyAccount('Credit Card', 'Amex')?.type).toBe('liability');
    expect(classifyAccount('', 'Rent expense')).toMatchObject({ type: 'expense', guessed: true });
    const qbo = [['Account', 'Type', 'Detail type'], ['1000 Cheque account', 'Bank', 'Checking'], ['4000 Sales', 'Income', 'Sales'], ['6000 Rent', 'Expenses', 'Rent'], ['2000 Trade creditors', 'Accounts payable (A/P)', 'A/P'], ['3000 Owner equity', 'Equity', '']];
    const q = analyseCoa(qbo)!;
    expect(q.rows.map((r) => [r.code, r.name, r.section])).toEqual([
      ['1000', 'Cheque account', 'Current assets'],
      ['4000', 'Sales', 'Revenue'],
      ['6000', 'Rent', 'Operating expenses'],
      ['2000', 'Trade creditors', 'Current liabilities'],
      ['3000', 'Owner equity', 'Equity'],
    ]);
  });

  it('builds the group chart with the accounts the consolidation needs', () => {
    const rows = analyseCoa(XERO_COA)!.rows.map((r) => (r.name === 'Old Suspense' ? { ...r, skip: true } : r));
    const c = buildChart(rows, 'replace', emptyProject().accounts);
    expect(c.added).toBe(24);
    const acc = (n: string) => c.accounts.find((a) => a.name === n)!;
    expect(acc('Retained Earnings').role).toBe('retained');
    expect(acc('Inventory').role).toBe('inventory');
    expect(acc('Intercompany Loan Receivable').role).toBe('ic_rec');
    expect(acc('Intercompany Loan Payable').role).toBe('ic_pay');
    expect(c.accounts.find((a) => a.name === 'Old Suspense')).toBeUndefined();
    // goodwill, NCI, FX reserve, investment in subsidiaries … come from the built-in chart under free codes
    for (const role of ['goodwill', 'nci', 'fctr', 'inv_sub', 'cogs', 'ic_rev', 'ic_exp', 'ic_div', 'div_paid', 'disposal_gain'])
      expect(c.accounts.filter((a) => a.role === role)).toHaveLength(1);
    expect(new Set(c.accounts.map((a) => a.code)).size).toBe(c.accounts.length);
    // adding to an existing chart keeps it and skips accounts it already has
    const m = buildChart(analyseCoa(XERO_COA)!.rows, 'merge', emptyProject().accounts);
    expect(m.accounts.length).toBe(emptyProject().accounts.length + m.added);
    expect(m.existing).toBeGreaterThanOrEqual(1); // "Depreciation" / "Inventory" style duplicates
  });

  it('maps every company to the imported chart and consolidates', () => {
    const p: Project = { ...emptyProject(), periodEnd: '2026-06-30' };
    const parent = newEntity('Northwind Data Pty Ltd', 'AUD');
    const sub = newEntity('Northwind Hosting Pty Ltd', 'AUD');
    p.entities.push(parent, sub);
    p.parentId = parent.id;
    p.holdings.push({ id: 'h', holderId: parent.id, investeeId: sub.id, pct: 100, cost: 1000, acqEquity: 1000, acqDate: '' });
    parent.lines = [
      line('Operating Account', 2000, 'Assets › Bank'),
      line('Investment in Northwind Hosting', 1000, 'Assets › Non-current Assets'),
      line('Intercompany Loan - Northwind Hosting', 500, 'Assets › Current Assets'),
      line('Issued Capital', -3000, 'Equity'),
      line('Sales - Hosting', -800, 'Income'),
      line('Wages & Salaries', 300, 'Less Operating Expenses'),
    ];
    // the subsidiary's names differ slightly from the chart
    sub.lines = [
      line('Operating account', 1700, 'Assets › Bank'),
      line('Power Costs – Site A', 200, 'Less Cost of Sales'),
      line('Intercompany Loan - Northwind Data', -500, 'Liabilities › Current Liabilities'),
      line('Issued capital', -1000, 'Equity'),
      line('Sales - hosting', -400, 'Income'),
    ];
    // companies imported before the chart: mapped to the built-in chart first
    for (const e of p.entities) for (const l of e.lines) e.mapping[lineKey(l)] = suggestForLine(l, p.accounts, {})?.code ?? '';
    const chart = buildChart(analyseCoa(XERO_COA)!.rows, 'replace', p.accounts);
    const { project: q, unmapped } = applyChart(p, chart.accounts);
    expect(unmapped).toBe(0);
    const mapped = (e: number, n: string) => q.accounts.find((a) => a.code === q.entities[e].mapping[lineKey(q.entities[e].lines.find((l) => l.name === n)!)])?.name;
    expect(mapped(0, 'Wages & Salaries')).toBe('Wages and Salaries');
    expect(mapped(0, 'Investment in Northwind Hosting')).toBe('Investments in subsidiaries'); // eliminated against the sub's equity
    expect(mapped(1, 'Operating account')).toBe('Operating Account');
    expect(mapped(1, 'Power Costs – Site A')).toBe('Power Costs - Site A');
    expect(mapped(0, 'Intercompany Loan - Northwind Hosting')).toBe('Intercompany Loan Receivable');
    expect(mapped(1, 'Intercompany Loan - Northwind Data')).toBe('Intercompany Loan Payable');

    const r = consolidate(projectForPeriod(q, 'cy'));
    expect(Object.values(r.consolidated).reduce((s, v) => s + v, 0)).toBeCloseTo(0, 6);
    const bal = (n: string) => r.consolidated[q.accounts.find((a) => a.name === n)!.code] ?? 0;
    expect(bal('Intercompany Loan Receivable')).toBeCloseTo(0, 6);
    expect(bal('Intercompany Loan Payable')).toBeCloseTo(0, 6);
    expect(bal('Investments in subsidiaries')).toBeCloseTo(0, 6);
    expect(bal('Operating Account')).toBe(3700);
    expect(bal('Sales - Hosting')).toBe(-1200);
    expect(r.checks.filter((c) => c.level === 'error')).toEqual([]);
  });

  it('keeps the built-in chart behaviour when no chart is imported', () => {
    const acc = emptyProject().accounts;
    expect(suggestMapping('', 'Wages & Salaries', acc)?.code).toBe('5100');
    expect(suggestMapping('1300', 'Inventory Asset', acc)?.code).toBe('1200'); // same code as a built-in account means nothing
  });
});
