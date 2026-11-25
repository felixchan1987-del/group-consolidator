/**
 * Xero exports as they come out of Xero: headings and totals indented into separate columns, totals saved as formulas
 * without results, monthly P&L columns next to a Year to date column, and an exchange-rate note under the balance sheet.
 * (Made-up company; the layout follows real exports.)
 */
import * as XLSX from 'xlsx';
import { analyseReport, defaultColPeriods, reportToLines, strictAmount } from './reportParser';
import { readWorkbook } from './importer';
import { evaluateFormulas } from './formulas';
import { consolidate } from './consolidate';
import { fractionFrom, openingDate, periodStartOf, projectForPeriod } from './periods';
import { suggestForLine } from './automap';
import { emptyProject, lineKey, newEntity } from './util';

type Cell = string | number | null | { f: string };
const F = (f: string) => ({ f });
/** formula across the amount columns: '{c}' becomes each column letter */
const across = (cols: string[], f: string, at: number[]): Cell[] => {
  const row: Cell[] = [];
  cols.forEach((c, k) => (row[at[k]] = F(f.replace(/\{c\}/g, c))));
  return row;
};

function toBook(sheets: Record<string, Cell[][]>): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    const ws = XLSX.utils.aoa_to_sheet(rows.map((r) => Array.from(r, (v) => (v && typeof v === 'object' ? null : v ?? null))));
    rows.forEach((r, ri) =>
      Array.from(r).forEach((v, ci) => {
        // formula with no saved result, like Xero
        if (v && typeof v === 'object') ws[XLSX.utils.encode_cell({ r: ri, c: ci })] = { t: 'n', v: 0, f: v.f };
      }),
    );
    ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length - 1, c: Math.max(...rows.map((r) => r.length)) - 1 } });
    XLSX.utils.book_append_sheet(wb, ws, name);
  }
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
}

const PL_COLS = ['C', 'D', 'E', 'F'];
const at = [2, 3, 4, 5];
const plRows = (withYtd = true): Cell[][] => {
  const cols = withYtd ? PL_COLS : PL_COLS.slice(0, 3);
  const a = withYtd ? at : at.slice(0, 3);
  const line = (name: string, ...v: number[]): Cell[] => [null, name, ...(withYtd ? v : v.slice(0, 3))];
  const tot = (label: string, f: string, col = 0): Cell[] => {
    const r = across(cols, f, a);
    r[col] = label;
    return r;
  };
  return [
    ['Profit and Loss'],
    ['Northwind Data Pty Ltd'],
    ['For the month ended 30 September 2026'],
    [],
    [null, 'Account', 'Sept 2026', 'Aug 2026', 'July 2026', ...(withYtd ? ['Year to date'] : [])],
    [],
    ['Income'],
    line('Sales - Hosting', 100, 110, 120, 330),
    line('Sales - Services', 50, 40, 30, 120),
    tot('Total Income', 'SUM({c}8:{c}9)'),
    [],
    ['Less Cost of Sales'],
    [null, 'Power Costs'],
    line('Power - Site A', 20, 20, 20, 60),
    line('Power - Site B', 10, 10, 10, 30),
    tot('Total Power Costs', 'SUM({c}14:{c}15)', 1),
    line('Freight', 5, 5, 5, 15),
    tot('Total Less Cost of Sales', '(SUM({c}17:{c}17) + {c}16)'),
    [],
    tot('Gross Profit', '({c}10 - {c}18)', 1),
    [],
    ['Less Operating Expenses'],
    line('Wages and Salaries', 60, 60, 60, 180),
    line('Repairs and Maintenance', -5, 0, 0, -5),
    tot('Total Less Operating Expenses', 'SUM({c}23:{c}24)'),
    [],
    tot('Net Profit', '(({c}20 + 0) - {c}25)', 1),
  ];
};
// YTD profit: 450 - 105 - 175 = 170 (Sep 60, Aug 55, Jul 55)

const BS_COLS = ['D', 'F'];
const bat = [3, 5];
const bsRows = (): Cell[][] => {
  const line = (name: string, cy: number, py: number, fx = false): Cell[] => [null, null, name, cy, fx ? '[FX]' : null, py, fx ? '[FX]' : null];
  const tot = (label: string, f: string, col: number): Cell[] => {
    const r = across(BS_COLS, f, bat);
    r[col] = label;
    return r;
  };
  return [
    ['Balance Sheet'],
    ['Northwind Data Pty Ltd'],
    ['As at 30 September 2026'],
    [],
    [null, null, 'Account', '30 Sept 2026', null, '31 Aug 2026', null],
    [],
    ['Assets'],
    [null, 'Bank'],
    line('Operating Account', 500, 400),
    tot('Total Bank', 'SUM({c}9:{c}9)', 1),
    [null, 'Fixed Assets'],
    line('Office Equipment', 300, 300),
    line('Less Accumulated Depreciation on Office Equipment', -100, -90),
    [null, null, 'SYD1 (Sydney)'],
    line('Edge Unit - SYD1', 1000, 1000),
    line('Accum. Depreciation Edge Unit - SYD1', -200, -180),
    tot('Total SYD1 (Sydney)', 'SUM({c}15:{c}16)', 2),
    tot('Total Fixed Assets', '(SUM({c}12:{c}13) + {c}17)', 1),
    tot('Total Assets', '(0 + ({c}10 + {c}18))', 0),
    [],
    ['Liabilities'],
    [null, 'Current Liabilities'],
    line('Accounts Payable', 150, 140, true),
    line('GST', 50, 50),
    tot('Total Current Liabilities', 'SUM({c}23:{c}24)', 1),
    tot('Total Liabilities', '(0 + {c}25)', 0),
    [],
    tot('Net Assets', '({c}19 - {c}26)', 2),
    [],
    ['Equity'],
    line('Current Year Earnings', 170, 110),
    line('Retained Earnings', 1130, 1130),
    tot('Total Equity', 'SUM({c}31:{c}32)', 0),
    [],
    [],
    ['[FX] Exchange rates used to convert foreign currency into AUD are shown below. Rates are provided by XE.com unless otherwise stated.'],
    ['30 Sept 2026'],
    ['0.697399 USD (United States Dollar)'],
  ];
};

const project = (start?: string) => ({ ...emptyProject(), periodEnd: '2026-09-30', ...(start ? { periodStart: start } : {}) });

describe('Xero exports with formula totals and monthly columns', () => {
  it('works out totals that were saved as formulas without results', () => {
    const [pl] = readWorkbook(toBook({ 'Profit and Loss': plRows() }));
    const total = pl.rows.find((r) => r[0] === 'Total Income')!;
    expect(total.slice(2, 6)).toEqual([150, 150, 150, 450]);
    expect(pl.rows.find((r) => r[1] === 'Net Profit')!.slice(2, 6)).toEqual([60, 55, 55, 170]);
  });

  it('keeps the saved value for formulas it cannot evaluate', () => {
    const ws = XLSX.utils.aoa_to_sheet([[1, 2]]);
    ws.C1 = { t: 'n', v: 7, f: 'VLOOKUP(A1,Other!A:B,2,0)' };
    ws.D1 = { t: 'n', v: 9, f: 'Other!A1+1' };
    ws.E1 = { t: 'n', v: 0, f: 'A1*2+B1/2-(-3)' };
    ws['!ref'] = 'A1:E1';
    evaluateFormulas(ws);
    expect([ws.C1.v, ws.D1.v, ws.E1.v]).toEqual([7, 9, 6]);
  });

  it('reads a balance sheet with headings indented into other columns', () => {
    const [bs] = readWorkbook(toBook({ 'Balance Sheet': bsRows() }));
    const a = analyseReport(bs.rows);
    expect(a.kind).toBe('balance_sheet');
    expect(a.entityName).toBe('Northwind Data Pty Ltd');
    expect(a.currency).toBe('AUD'); // from the exchange-rate note
    expect(a.totals.checked).toBe(16);
    expect(a.totals.agree).toBe(16);
    expect(a.balance.map((v) => Math.round(v * 100) / 100)).toEqual([0, 0]);
    // a site heading in the account column, not account code "SYD1"
    const site = a.rows.find((r) => r.label === 'SYD1 (Sydney)')!;
    expect(site.type).toBe('heading');
    expect(site.path).toEqual(['Assets', 'Fixed Assets']);
    const unit = a.rows.find((r) => r.label === 'Accum. Depreciation Edge Unit - SYD1')!;
    expect(unit.path).toEqual(['Assets', 'Fixed Assets', 'SYD1 (Sydney)']);
    expect(unit.nature).toBe('dr');
    expect(a.rows.find((r) => r.label === 'Accounts Payable')!.nature).toBe('cr');
    // exchange-rate footer is a note, and the [FX] marker column is not an amount column
    expect(a.rows.filter((r) => r.type === 'note').map((r) => r.label)).toHaveLength(3);
    expect(a.amountCols.map((c) => c.header)).toEqual(['30 Sept 2026', '31 Aug 2026']);
    // last month's balance sheet is not a comparative: only the period-end column is imported
    expect(defaultColPeriods(a, project())).toEqual(['cy', 'skip']);
  });

  it('imports the Year to date column of a monthly P&L and works out the period it covers', () => {
    const [pl] = readWorkbook(toBook({ 'Profit and Loss': plRows() }));
    const a = analyseReport(pl.rows);
    expect(a.kind).toBe('profit_loss');
    expect(a.rows.find((r) => r.label === 'Account')!.type).toBe('header'); // "Aug 2026" is not the amount 2026
    expect(a.amountCols.map((c) => [c.month, c.ytd, c.date])).toEqual([
      [true, false, '2026-09-30'],
      [true, false, '2026-08-31'],
      [true, false, '2026-07-31'],
      [false, true, '2026-09-30'],
    ]);
    expect(a.totals.agree).toBe(a.totals.checked);
    expect(a.totals.checked).toBe(24);
    expect(a.ytdStart).toBe('2026-07-01');
    expect(a.rows.find((r) => r.label === 'Power - Site A')!.path).toEqual(['Less Cost of Sales', 'Power Costs']);
    const cols = defaultColPeriods(a, project());
    expect(cols).toEqual(['skip', 'skip', 'skip', 'cy']);
    const lines = reportToLines(a, cols.map((c) => (c === 'skip' ? null : c)), { cy: 's1' });
    expect(lines.reduce((s, l) => s + l.amount, 0)).toBeCloseTo(-170, 6); // profit, debit-positive
    expect(strictAmount('Aug 2026')).toBeNull();
  });

  it('adds up month columns when there is no Year to date column and a period start is set', () => {
    const [pl] = readWorkbook(toBook({ 'Profit and Loss': plRows(false) }));
    const a = analyseReport(pl.rows);
    expect(defaultColPeriods(a, project())).toEqual(['cy', 'skip', 'skip']); // 12-month period: only the matching month
    const cols = defaultColPeriods(a, project('2026-07-01'));
    expect(cols).toEqual(['cy', 'cy', 'cy']);
    const lines = reportToLines(a, cols.map((c) => (c === 'skip' ? null : c)), { cy: 's1' });
    expect(lines.filter((l) => l.name === 'Sales - Hosting')).toHaveLength(1);
    expect(lines.find((l) => l.name === 'Sales - Hosting')!.amount).toBe(-330);
    expect(lines.reduce((s, l) => s + l.amount, 0)).toBeCloseTo(-170, 6);
  });

  it('consolidates the balance sheet and year-to-date P&L into a balanced group', () => {
    const p = project('2026-07-01');
    const e = newEntity('Northwind Data Pty Ltd', 'AUD');
    p.entities.push(e);
    p.parentId = e.id;
    const [bs] = readWorkbook(toBook({ 'Balance Sheet': bsRows() }));
    const [pl] = readWorkbook(toBook({ 'Profit and Loss': plRows() }));
    for (const sh of [bs, pl]) {
      const a = analyseReport(sh.rows);
      const lines = reportToLines(a, defaultColPeriods(a, p).map((c) => (c === 'skip' ? null : c)), { cy: `src_${a.kind}` });
      e.lines.push(...lines);
      for (const l of lines) e.mapping[lineKey(l)] ??= suggestForLine(l, p.accounts, {})?.code ?? '';
    }
    const r = consolidate(projectForPeriod(p, 'cy'));
    const total = Object.values(r.consolidated).reduce((s, v) => s + v, 0);
    expect(total).toBeCloseTo(0, 6);
    expect(r.profit.owners).toBeCloseTo(170, 6); // P&L used; Current Year Earnings left out of equity
    expect(r.checks.some((c) => /current year earnings/i.test(c.message))).toBe(true);
  });
});

describe('year-to-date reporting periods', () => {
  it('uses the period start for the opening date and time apportionment', () => {
    expect(openingDate('2026-09-30')).toBe('2025-09-30');
    expect(openingDate('2026-09-30', '2026-07-01')).toBe('2026-06-30');
    expect(openingDate('2026-09-30', '2024-01-01')).toBe('2025-09-30'); // outside the 12 months: ignored
    expect(fractionFrom('2026-08-01', '2026-09-30', openingDate('2026-09-30', '2026-07-01'))).toBeCloseTo(61 / 92, 10);
    const p = project('2026-07-01');
    expect(periodStartOf(p, 'py')).toBe('2025-07-01');
    expect(projectForPeriod(p, 'py').periodStart).toBe('2025-07-01');
    expect(periodStartOf(project(), 'cy')).toBe('2025-10-01');
  });
});

describe('mapping uses the report layout', () => {
  const accounts = emptyProject().accounts;
  const map = (name: string, section: string) => suggestForLine({ code: '', name, section }, accounts, {})?.code;
  it('respects current / non-current headings, cost of sales and intercompany sides', () => {
    expect(map('Lease Liability Current - Printers', 'Liabilities › Current Liabilities › Lease Liability')).toBe('2200');
    expect(map('Lease Liability Non-Current - Printers', 'Liabilities › Non-Current Liabilities › Lease Liability')).toBe('2500');
    expect(map('Site Lease Long term - SYD1', 'Liabilities › Non-Current Liabilities › Lease Liability')).toBe('2500');
    expect(map('Power Costs - SYD1', 'Less Cost of Sales › Power Costs')).toBe('5000');
    expect(map('Light, Power, Heating', 'Less Operating Expenses')).toBe('5300');
    expect(map('Network Lease - ROU', 'Assets › Fixed Assets › Right-of-Use Assets')).toBe('1500');
    expect(map('Sundry Debtors', 'Assets › Non-current Assets')).toBe('1800');
    expect(map('Deferred Tax Assets', 'Assets › Non-current Assets')).toBe('1800');
    expect(map('Deferred Tax Liabilities', 'Liabilities › Current Liabilities')).toBe('2600');
    expect(map('Northwind Property Pty Ltd', 'Assets › Bank')).toBe('1000'); // a bank account, not property
    expect(map('Intercompany Loan - Northwind Hosting', 'Liabilities › Current Liabilities')).toBe('2050');
    expect(map('Intercompany Loan - Northwind Hosting', 'Assets › Current Assets')).toBe('1150');
    expect(map('Payroll Tax Expenses', 'Less Operating Expenses › Employee Related')).toBe('5100');
    expect(map('Provision for Payroll Tax', 'Liabilities › Current Liabilities › Provision')).toBe('2100');
    expect(map('Annual Leave', 'Less Operating Expenses › Employee Related')).toBe('5100');
    expect(map('Share Options', 'Equity › Share Equity')).toBe('3100');
    // a remembered mapping is kept whatever the heading
    expect(suggestForLine({ code: '', name: 'Sundry Debtors', section: 'Assets › Non-current Assets' }, accounts, { 'sundry debtors': '1100' })?.code).toBe('1100');
  });
});
