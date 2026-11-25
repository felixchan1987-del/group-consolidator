import { consolidate } from './consolidate';
import { buildSampleProject } from './sample';
import { analyseStructure } from './structure';
import { incomeStatement, balanceSheet } from './statements';
import { detectColumns, detectHeaderRow, extractLines, readWorkbook } from './importer';
import { sampleWorkbook, SAMPLE } from './sample';
import { parseAmount } from './util';
import * as XLSX from 'xlsx';

const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 2);

describe('group structure', () => {
  it('classifies parent, direct & indirect subsidiaries and associates', () => {
    const p = buildSampleProject();
    const s = analyseStructure(p);
    const [apex, beacon, cobalt, delta] = p.entities;
    expect(s.method[apex.id]).toBe('parent');
    expect(s.method[beacon.id]).toBe('full');
    expect(s.method[cobalt.id]).toBe('full'); // 60% held by an 80% subsidiary => controlled
    expect(s.method[delta.id]).toBe('equity');
    close(s.effective[cobalt.id], 0.48);
  });

  it('aggregates holdings by several group companies for control', () => {
    const p = buildSampleProject();
    const [apex, beacon, , delta] = p.entities;
    // Apex 30% + Beacon 25% of Delta => 55% group votes => subsidiary; effective 30% + 0.8*25% = 50%
    p.holdings.push({ id: 'x', holderId: beacon.id, investeeId: delta.id, pct: 25, cost: 250000, acqEquity: 800000, acqDate: '' });
    const s = analyseStructure(p);
    expect(s.method[delta.id]).toBe('full');
    close(s.effective[delta.id], 0.5);
    expect(s.method[apex.id]).toBe('parent');
  });
});

describe('consolidation of the sample group', () => {
  const r = consolidate(buildSampleProject());

  it('maps all sample accounts automatically', () => {
    for (const t of Object.values(r.translation)) expect(t.unmappedCount).toBe(0);
  });

  it('translates the EUR subsidiary with a CTA to FCTR', () => {
    const cobalt = r.subsidiaries.find((s) => s.name === 'Cobalt GmbH')!;
    close(cobalt.equityExFx, 577500);
    close(cobalt.fctr, 28500);
    close(cobalt.profit, 54000);
  });

  it('computes goodwill and NCI with the effective interest method', () => {
    const beacon = r.subsidiaries.find((s) => s.name === 'Beacon Trading LLC')!;
    const cobalt = r.subsidiaries.find((s) => s.name === 'Cobalt GmbH')!;
    close(beacon.goodwill, 80000);
    close(beacon.nciOpening, 186000);
    close(beacon.nciProfit, 20000);
    close(beacon.postAcqToGroup, 24000);
    close(cobalt.goodwill, 202800);
    close(cobalt.nciOpening, 195120);
    close(cobalt.nciProfit, 28080);
    close(r.nciTotal, 429200);
  });

  it('applies the equity method to the associate', () => {
    const d = r.associates[0];
    close(d.pickups[0].reserves, 15000);
    close(d.pickups[0].profit, 30000);
  });

  it('eliminates intercompany balances and produces a balanced statement of financial position', () => {
    close(r.consolidated['1150'] ?? 0, 0);
    close(r.consolidated['2050'] ?? 0, 0);
    close(r.consolidated['4050'] ?? 0, 0);
    close(r.consolidated['1700'] ?? 0, 0);
    close(Object.values(r.consolidated).reduce((a, b) => a + b, 0), 0);
    close(r.profit.total, 414000);
    close(r.profit.nci, 48080);
    expect(r.checks.filter((c) => c.level === 'error')).toEqual([]);
    const bs = balanceSheet(r);
    const ta = bs.find((l) => l.label === 'TOTAL ASSETS')!.value;
    const tel = bs.find((l) => l.label === 'TOTAL EQUITY AND LIABILITIES')!.value;
    close(ta, tel);
    const is = incomeStatement(r);
    close(is.find((l) => l.label === 'PROFIT FOR THE PERIOD')!.value, 414000);
  });
});

describe('importer', () => {
  it('parses accounting number formats', () => {
    expect(parseAmount('(1,234.50)')).toBe(-1234.5);
    expect(parseAmount('1.234,50')).toBe(1234.5);
    expect(parseAmount('$2,000 Cr')).toBe(-2000);
    expect(parseAmount('500-')).toBe(-500);
    expect(parseAmount('')).toBeNull();
  });

  for (const s of SAMPLE) {
    it(`reads the ${s.system} sample layout`, () => {
      const buf = XLSX.write(sampleWorkbook(s), { type: 'array', bookType: 'xlsx' });
      const [sheet] = readWorkbook(buf);
      const hr = detectHeaderRow(sheet.rows);
      const roles = detectColumns(sheet.rows, hr);
      const res = extractLines(sheet.rows, { headerRow: hr, roles, sign: 'dr', skipZero: true, sourceId: 's' });
      expect(res.lines.length).toBe(s.rows.length);
      close(res.totalDebit, res.totalCredit);
      expect(res.lines.map((l) => l.code)).toEqual(s.rows.map((x) => x[0]));
    });
  }
});

describe('entity name detection', () => {
  it('reads the company name from report title rows', async () => {
    const { guessEntityFromSheet, guessEntityName } = await import('./importer');
    expect(guessEntityFromSheet([['Trial Balance'], ['Apex Holdings Inc'], ['As at 31 December 2026'], [], ['Account Code']], 4)).toBe('Apex Holdings Inc');
    expect(guessEntityFromSheet([['Code', 'Description']], 0)).toBeNull();
    expect(guessEntityName('COB_sap_trial_balance.xlsx')).toBe('COB');
  });
});
