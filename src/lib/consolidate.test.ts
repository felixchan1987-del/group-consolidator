import { consolidate } from './consolidate';
import { buildSampleProject } from './sample';
import { analyseStructure } from './structure';
import { incomeStatement, balanceSheet } from './statements';
import { detectColumns, detectHeaderRow, extractLines, readWorkbook } from './importer';
import { sampleWorkbook, SAMPLE } from './sample';
import { lineKey, parseAmount } from './util';
import { suggestMapping } from './automap';
import { projectForPeriod, rollForward, shiftYears, hasPrior } from './periods';
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
  const r = consolidate(projectForPeriod(buildSampleProject(), 'cy'));

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
    close(beacon.goodwill, 160000); // 800k - 80% x 800k
    close(beacon.nciOpening, 186000);
    close(beacon.nciProfit, 20000);
    close(beacon.postAcqToGroup, 104000); // 80% x (930k - 800k)
    close(cobalt.goodwill, 228000); // 80% x (600k - 60% x 525k)
    close(cobalt.nciOpening, 195120);
    close(cobalt.nciProfit, 28080);
    close(r.nciTotal, 429200);
  });

  it('applies the equity method to the associate', () => {
    const d = r.associates[0];
    close(d.pickups[0].reserves, 45000); // 30% x (850k - 700k)
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

describe('comparative periods', () => {
  const p = buildSampleProject();
  const cy = consolidate(projectForPeriod(p, 'cy'));
  const py = consolidate(projectForPeriod(p, 'py'));

  it('keeps the periods separate', () => {
    expect(hasPrior(p)).toBe(true);
    for (const e of projectForPeriod(p, 'py').entities) expect(e.lines.every((l) => l.period === 'py')).toBe(true);
    for (const e of projectForPeriod(p, 'cy').entities) expect(e.lines.every((l) => !l.period || l.period === 'cy')).toBe(true);
  });

  it('consolidates the prior period with prior-period rates', () => {
    expect(py.checks.filter((c) => c.level === 'error')).toEqual([]);
    // 207k + 90k + EUR 45k x 1.07 + 30% x 90k
    close(py.profit.total, 207000 + 90000 + 45000 * 1.07 + 27000);
    const cobalt = py.subsidiaries.find((s) => s.name === 'Cobalt GmbH')!;
    close(cobalt.equityExFx, 505000 * 1.05);
  });

  it('builds two-column statements that balance in both periods', () => {
    const bs = balanceSheet(cy, py);
    const ta = bs.find((l) => l.label === 'TOTAL ASSETS')!;
    const tel = bs.find((l) => l.label === 'TOTAL EQUITY AND LIABILITIES')!;
    close(ta.value, tel.value);
    close(ta.prior!, tel.prior!);
    expect(ta.prior).not.toBe(ta.value);
    const is = incomeStatement(cy, py);
    close(is.find((l) => l.label === 'PROFIT FOR THE PERIOD')!.prior!, py.profit.total);
    expect(balanceSheet(cy).every((l) => l.prior === undefined)).toBe(true);
  });

  it('rolls forward: current becomes prior, period moves one year', () => {
    const next = rollForward(p);
    expect(next.periodEnd).toBe('2027-12-31');
    expect(next.entities.every((e) => e.lines.every((l) => l.period === 'py'))).toBe(true);
    expect(next.entities[0].lines.length).toBe(p.entities[0].lines.filter((l) => !l.period).length);
    expect(next.entities[2].ratesPrior).toEqual(p.entities[2].rates);
    const pyNext = consolidate(projectForPeriod(next, 'py'));
    close(pyNext.profit.total, cy.profit.total);
  });

  it('shifts dates by whole years', () => {
    expect(shiftYears('2024-02-29', 1)).toBe('2025-02-28');
    expect(shiftYears('2026-12-31', -1)).toBe('2025-12-31');
  });
});

describe('acquisitions and disposals during the period', () => {
  const sumAll = (b: Record<string, number>) => Object.values(b).reduce((a, x) => a + x, 0);

  it('time-apportions the results of a subsidiary acquired mid-year', () => {
    const p = buildSampleProject();
    const h = p.holdings.find((x) => x.investeeId === p.entities[2].id)!; // Beacon -> Cobalt
    h.acqDate = '2026-07-01';
    h.acqEquity = null; // net assets at acquisition = equity incl. pre-acquisition profit
    const r = consolidate(projectForPeriod(p, 'cy'));
    const f = 184 / 365; // 1 Jul - 31 Dec inclusive
    close(r.structure.fraction[p.entities[2].id], f);
    const cobalt = r.subsidiaries.find((s) => s.name === 'Cobalt GmbH')!;
    close(cobalt.profit, 54000 * f);
    close(cobalt.postAcqToGroup, 0);
    close(cobalt.goodwill, 0.8 * (600000 - 0.6 * (577500 + 54000 * (1 - f))));
    close(r.profit.total, 414000 - 54000 * (1 - f));
    close(sumAll(r.consolidated), 0);
    expect(r.checks.filter((c) => c.level === 'error')).toEqual([]);
    // not yet owned in the comparative period
    const py = consolidate(projectForPeriod(p, 'py'));
    expect(py.structure.method[p.entities[2].id]).toBe('none');
  });

  it('derecognises a subsidiary sold mid-year and books the group gain', () => {
    const p = buildSampleProject();
    const h = p.holdings.find((x) => x.investeeId === p.entities[2].id)!;
    h.disposalDate = '2026-06-30';
    h.proceeds = 700000;
    const r = consolidate(projectForPeriod(p, 'cy'));
    const id = p.entities[2].id;
    expect(r.structure.method[id]).toBe('disposed');
    const f = 181 / 365; // 1 Jan - 30 Jun
    const d = r.disposals[0];
    close(d.fraction, f);
    const pIn = 54000 * f;
    // Group gain per IFRS 10: proceeds - (net assets - NCI + goodwill) + group share of FCTR recycled
    const g = 0.48;
    const na = 577500 + 28500 + pIn;
    const nci = (1 - g) * na - 0.2 * 600000;
    const gw = 0.8 * (600000 - 0.6 * 525000);
    close(d.netAssets, na);
    close(d.nciDerecognised, nci);
    close(d.goodwill, gw);
    close(d.groupGain, 700000 - (na - nci + gw) + g * 28500);
    // nothing of Cobalt's balance sheet or reserves remains; its results to disposal are included
    close(r.consolidated['3300'] ?? 0, 0);
    close(r.consolidated['1200'], 150000); // inventories: Beacon only
    close(r.profit.nci, 20000 + (1 - g) * pIn);
    close(r.nciTotal, 186000 + 20000); // Beacon's NCI only
    close(sumAll(r.consolidated), 0);
    expect(r.checks.filter((c) => c.level === 'error')).toEqual([]);
    // still a subsidiary in the comparative period
    expect(consolidate(projectForPeriod(p, 'py')).structure.method[id]).toBe('full');
  });

  it('picks up only post-acquisition profit of an associate bought mid-year', () => {
    const p = buildSampleProject();
    const h = p.holdings.find((x) => x.investeeId === p.entities[3].id)!;
    h.acqDate = '2026-10-01';
    h.acqEquity = 850000 + 100000 * (1 - 92 / 365); // net assets at acquisition incl. profit to date
    const r = consolidate(projectForPeriod(p, 'cy'));
    const k = r.associates[0].pickups[0];
    close(k.profit, 0.3 * 100000 * (92 / 365));
    close(k.reserves, 0);
  });
});

describe('project migration', () => {
  it('adds system accounts introduced in later versions', async () => {
    const { migrateProject } = await import('./util');
    const p = buildSampleProject();
    p.accounts = p.accounts.filter((a) => a.role !== 'disposal_gain');
    expect(migrateProject(p).accounts.some((a) => a.role === 'disposal_gain')).toBe(true);
  });
});

describe('intra-group dividends and unrealised profit', () => {
  const addLines = (p: ReturnType<typeof buildSampleProject>, idx: number, rows: [string, string, number][]) => {
    const e = p.entities[idx];
    for (const [code, name, amount] of rows) {
      const l = { id: `t${code}${amount}`, code, name, amount, sign: 'dr' as const, sourceId: 's' };
      e.lines.push(l);
      e.mapping[lineKey(l)] = suggestMapping(code, name, p.accounts)!.code;
    }
  };
  const run = (p: ReturnType<typeof buildSampleProject>) => consolidate(projectForPeriod(p, 'cy'));
  const owners = (r: ReturnType<typeof consolidate>) => balanceSheet(r).find((l) => l.label === 'Equity attributable to owners of the parent')!.value;

  it('maps dividend accounts automatically', () => {
    const accts = buildSampleProject().accounts;
    expect(suggestMapping('3500', 'Dividends paid', accts)?.code).toBe('3250');
    expect(suggestMapping('4800', 'Dividend received from subsidiary', accts)?.code).toBe('4060');
    expect(suggestMapping('4810', 'Intercompany dividend income', accts)?.code).toBe('4060');
  });

  it('eliminates a dividend from an 80% subsidiary: profit and owners unchanged, NCI receives its share', () => {
    const base = run(buildSampleProject());
    const p = buildSampleProject();
    addLines(p, 1, [['3250', 'Dividends paid', 50000], ['1010', 'Checking', -50000]]); // Beacon pays 50k
    addLines(p, 0, [['4060', 'Dividend received from subsidiary Beacon', -40000], ['1000', 'Business Bank Account', 40000]]); // Apex gets 80%
    const r = run(p);
    expect(r.dividends).toHaveLength(1);
    close(r.dividends[0].amount, 40000);
    close(r.profit.total, base.profit.total);
    close(r.nciTotal, base.nciTotal - 10000);
    close(owners(r), owners(base));
    close(r.consolidated['4060'] ?? 0, 0);
    expect(r.checks.filter((c) => c.level !== 'ok')).toEqual([]);
  });

  it('handles a dividend from an indirect subsidiary (held 60% by an 80% subsidiary)', () => {
    const usd = () => {
      const p = buildSampleProject();
      p.entities[2].currency = 'USD';
      return p;
    };
    const base = run(usd());
    const p = usd();
    addLines(p, 2, [['3250', 'Dividends paid', 100000], ['113100', 'Bank Deutsche Bank', -100000]]); // Cobalt pays 100k
    addLines(p, 1, [['4060', 'Dividend from group company Cobalt', -60000], ['1010', 'Checking', 60000]]); // Beacon gets 60%
    const r = run(p);
    close(r.profit.total, base.profit.total);
    close(owners(r), owners(base));
    close(r.nciTotal, base.nciTotal - 40000); // only the 40% outside shareholders of Cobalt received cash
    expect(r.checks.filter((c) => c.level === 'error' || c.level === 'warn')).toEqual([]);
  });

  it('warns when the receiver did not record the dividend as group dividend income', () => {
    const p = buildSampleProject();
    addLines(p, 1, [['3250', 'Dividends paid', 50000], ['1010', 'Checking', -50000]]);
    addLines(p, 0, [['4100', 'Other income', -40000], ['1000', 'Business Bank Account', 40000]]);
    expect(run(p).checks.some((c) => c.level === 'warn' && c.message.includes('intra-group dividend income'))).toBe(true);
  });

  it('removes unrealised profit on upstream sales and charges NCI its share', () => {
    const base = run(buildSampleProject());
    const p = buildSampleProject();
    const [apex, beacon] = p.entities;
    p.urp = [{ id: 'u1', sellerId: beacon.id, buyerId: apex.id, description: 'Goods', closingInventory: 100000, openingInventory: 40000, rate: 25, basis: 'margin' }];
    const r = run(p);
    close(r.urp[0].closingUrp, 25000);
    close(r.urp[0].openingUrp, 10000);
    close(r.profit.total, base.profit.total - 15000);
    close(r.profit.nci, base.profit.nci - 3000); // 20% NCI in the seller
    close(r.consolidated['1200'], base.consolidated['1200'] - 25000);
    close(r.nciTotal, base.nciTotal - 5000); // 20% x closing URP (opening part via reserves + profit)
    close(Object.values(r.consolidated).reduce((a, b) => a + b, 0), 0);
  });

  it('downstream URP (parent sells) is borne fully by the owners; mark-up basis', () => {
    const base = run(buildSampleProject());
    const p = buildSampleProject();
    const [apex, beacon] = p.entities;
    p.urp = [{ id: 'u2', sellerId: apex.id, buyerId: beacon.id, description: '', closingInventory: 100000, openingInventory: 0, rate: 25, basis: 'markup' }];
    const r = run(p);
    close(r.urp[0].closingUrp, 20000); // 25% mark-up on cost = 20% of selling price
    close(r.profit.nci, base.profit.nci);
    close(r.profit.owners, base.profit.owners - 20000);
  });

  it('rolls URP forward: closing inventory becomes next period opening', () => {
    const p = buildSampleProject();
    p.urp = [{ id: 'u1', sellerId: p.entities[1].id, buyerId: p.entities[0].id, description: '', closingInventory: 100000, openingInventory: 0, rate: 25, basis: 'margin' }];
    const next = rollForward(p);
    const cy = projectForPeriod(next, 'cy').urp!;
    expect(cy).toHaveLength(1);
    expect(cy[0].openingInventory).toBe(100000);
    expect(cy[0].closingInventory).toBe(0);
    expect(projectForPeriod(next, 'py').urp![0].closingInventory).toBe(100000);
  });
});
