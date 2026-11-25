import { analyseReport, looksLikeReport, parseDateLabel, reportToLines, splitLabel, strictAmount } from './reportParser';
import { buildSampleProject, SAMPLE, xeroReportRows, sampleWorkbook } from './sample';
import { suggestForLine } from './automap';
import { autoTagCounterparties } from './counterparty';
import { consolidate } from './consolidate';
import { projectForPeriod } from './periods';
import { readWorkbook } from './importer';
import { emptyProject, lineKey, newEntity, parseAmount } from './util';
import { balanceSheet } from './statements';
import * as XLSX from 'xlsx';

const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 2);

describe('cell parsing', () => {
  it('recognises amounts but not dates or labels', () => {
    expect(strictAmount('1,234.50')).toBe(1234.5);
    expect(strictAmount('(1,234.50)')).toBe(-1234.5);
    expect(strictAmount('−500')).toBe(-500);
    expect(strictAmount('$ 2,000')).toBe(2000);
    expect(strictAmount('31 Dec 2026')).toBeNull();
    expect(strictAmount('31/12/2026')).toBeNull();
    expect(strictAmount('Sales (200)')).toBeNull();
    expect(parseAmount('1 234,50')).toBe(1234.5);
  });

  it('reads period dates from column headers and titles', () => {
    expect(parseDateLabel('31 Dec 2026').date).toBe('2026-12-31');
    expect(parseDateLabel('31 Dec 26').date).toBe('2026-12-31');
    expect(parseDateLabel('Dec 2026').date).toBe('2026-12-31');
    expect(parseDateLabel('Jun-25').date).toBe('2025-06-30');
    expect(parseDateLabel('For the year ended 31 December 2026').date).toBe('2026-12-31');
    expect(parseDateLabel('1 Jan 2026 - 31 Dec 2026').date).toBe('2026-12-31');
    expect(parseDateLabel('Dec 31, 2026').date).toBe('2026-12-31');
    expect(parseDateLabel('31/03/2026').date).toBe('2026-03-31');
    expect(parseDateLabel('FY2025')).toEqual({ date: null, year: 2025 });
    expect(parseDateLabel(new Date(2026, 11, 31)).date).toBe('2026-12-31');
  });

  it('splits account codes written into the label', () => {
    expect(splitLabel('Sales (200)')).toEqual({ code: '200', name: 'Sales' });
    expect(splitLabel('200 - Sales')).toEqual({ code: '200', name: 'Sales' });
    expect(splitLabel('1-1100 Cheque Account')).toEqual({ code: '1-1100', name: 'Cheque Account' });
    expect(splitLabel('Civils - Bundaberg (BDB1)')).toEqual({ code: '', name: 'Civils - Bundaberg (BDB1)' });
    expect(splitLabel('Accounts Receivable')).toEqual({ code: '', name: 'Accounts Receivable' });
  });
});

describe('Xero balance sheet and P&L reports', () => {
  const accounts = buildSampleProject().accounts;

  for (const s of SAMPLE) {
    it(`reads ${s.name}: structure, both periods, totals agree`, () => {
      const { bs, pl } = xeroReportRows(s, accounts);
      expect(looksLikeReport(bs)).toBe(true);
      expect(looksLikeReport(pl)).toBe(true);
      const a = analyseReport(bs);
      expect(a.kind).toBe('balance_sheet');
      expect(a.entityName).toBe(s.name);
      expect(a.reportDate).toBe('2026-12-31');
      expect(a.amountCols.map((c) => c.date)).toEqual(['2026-12-31', '2025-12-31']);
      expect(a.totals.checked).toBeGreaterThan(6);
      expect(a.totals.agree).toBe(a.totals.checked);
      close(a.balance[0], 0);
      close(a.balance[1], 0);
      expect(a.rows.filter((r) => r.currentEarnings)).toHaveLength(1);
      const p = analyseReport(pl);
      expect(p.kind).toBe('profit_loss');
      expect(p.totals.agree).toBe(p.totals.checked);
    });
  }

  it('is not fooled by a trial balance with debit/credit columns', () => {
    for (const s of SAMPLE) {
      const [sheet] = readWorkbook(XLSX.write(sampleWorkbook(s), { type: 'array', bookType: 'xlsx' }));
      if (s.system === 'xero' || s.system === 'quickbooks') expect(looksLikeReport(sheet.rows)).toBe(false);
    }
  });

  it('flags totals that do not agree, e.g. when a line was missed', () => {
    const { bs } = xeroReportRows(SAMPLE[0], accounts);
    const rows = bs.map((r) => [...r]);
    const i = rows.findIndex((r) => r[0] === 'Accounts Receivable');
    rows[i] = ['Accounts Receivable', '', '']; // amounts lost -> it becomes a heading, the totals no longer add up
    const a = analyseReport(rows);
    expect(a.totals.agree).toBeLessThan(a.totals.checked);
    expect(a.rows.some((r) => r.check?.includes('diff'))).toBe(true);
  });

  it('lets the user exclude or include rows', () => {
    const { bs } = xeroReportRows(SAMPLE[0], accounts);
    const a = analyseReport(bs);
    const ar = a.rows.find((r) => r.label === 'Accounts Receivable')!;
    const b = analyseReport(bs, { overrides: { [ar.index]: 'excluded' } });
    expect(b.rows[ar.index].type).toBe('excluded');
    expect(b.totals.agree).toBeLessThan(b.totals.checked);
  });

  it('maps with the section as context', () => {
    expect(suggestForLine({ code: '', name: 'GST', section: 'Liabilities › Current Liabilities' }, accounts)?.code).toBe('2100');
    expect(suggestForLine({ code: '', name: 'Rounding', section: 'Assets › Fixed Assets' }, accounts)?.code).toBe('1500');
    expect(suggestForLine({ code: '', name: 'Wages Payable - Payroll', section: 'Liabilities › Current Liabilities' }, accounts)?.code).toBe('2100');
  });

  it('consolidates a group imported only from Xero reports exactly like the trial-balance version', () => {
    const ref = buildSampleProject();
    const p = emptyProject();
    p.periodEnd = ref.periodEnd;
    p.entities = SAMPLE.map((s, i) => {
      const e = newEntity(s.name, s.currency);
      e.id = ref.entities[i].id;
      e.rates = { ...ref.entities[i].rates };
      e.ratesPrior = ref.entities[i].ratesPrior && { ...ref.entities[i].ratesPrior! };
      const { bs, pl } = xeroReportRows(s, p.accounts);
      for (const [rows, name] of [
        [bs, 'bs'],
        [pl, 'pl'],
      ] as const) {
        const a = analyseReport(rows);
        const ids = { cy: `${name}cy`, py: `${name}py` };
        e.sources.push({ id: ids.cy, fileName: `${name}.xlsx`, sheet: '', system: 'Xero', importedAt: '', lineCount: 0, period: 'cy' }, { id: ids.py, fileName: `${name}.xlsx`, sheet: '', system: 'Xero', importedAt: '', lineCount: 0, period: 'py' });
        e.lines.push(...reportToLines(a, ['cy', 'py'], ids));
      }
      for (const l of e.lines) e.mapping[lineKey(l)] = suggestForLine(l, p.accounts)!.code;
      return e;
    });
    p.parentId = ref.parentId;
    p.holdings = ref.holdings;
    autoTagCounterparties(p);
    for (const period of ['cy', 'py'] as const) {
      const a = consolidate(projectForPeriod(p, period));
      const b = consolidate(projectForPeriod(ref, period));
      expect(a.checks.filter((c) => c.level === 'error' || c.level === 'warn')).toEqual([]);
      close(a.profit.total, b.profit.total);
      close(a.profit.nci, b.profit.nci);
      close(a.nciTotal, b.nciTotal);
      for (const code of Object.keys(b.consolidated)) close(a.consolidated[code] ?? 0, b.consolidated[code]);
      close(balanceSheet(a).find((l) => l.label === 'TOTAL ASSETS')!.value, balanceSheet(b).find((l) => l.label === 'TOTAL ASSETS')!.value);
      // Current Year Earnings left out because the P&L is there
      expect(a.checks.some((c) => c.message.includes('Current Year Earnings'))).toBe(true);
    }
  });

  it('keeps Current Year Earnings in equity when only the balance sheet is imported', () => {
    const p = emptyProject();
    const e = newEntity('Solo', 'USD');
    const { bs } = xeroReportRows(SAMPLE[3], p.accounts);
    e.sources.push({ id: 's', fileName: 'bs.xlsx', sheet: '', system: 'Xero', importedAt: '', lineCount: 0 });
    e.lines = reportToLines(analyseReport(bs), ['cy', null], { cy: 's' });
    for (const l of e.lines) e.mapping[lineKey(l)] = suggestForLine(l, p.accounts)!.code;
    p.entities = [e];
    p.parentId = e.id;
    const r = consolidate(projectForPeriod(p, 'cy'));
    expect(r.checks.filter((c) => c.level === 'error')).toEqual([]);
    expect(r.checks.some((c) => c.level === 'warn' && c.message.includes('only a balance sheet'))).toBe(true);
    close(Object.values(r.consolidated).reduce((x, y) => x + y, 0), 0);
  });
});
