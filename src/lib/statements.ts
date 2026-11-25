import { BS_SECTIONS, PL_SECTIONS } from './coa';
import { UNMAPPED, type ConsolidationResult } from './consolidate';

export interface StmtLine {
  label: string;
  value: number;
  kind: 'heading' | 'line' | 'subtotal' | 'total';
  code?: string;
}

/** Values are presented in natural sign (assets/liabilities/equity/income positive, expenses negative in P&L). */
export function balanceSheet(r: ConsolidationResult): StmtLine[] {
  const b = r.consolidated;
  const out: StmtLine[] = [];
  const nat = (type: string, v: number) => (type === 'asset' ? v : -v);
  let totalAssets = 0;
  const sectionLines = (sec: string) =>
    r.accounts.filter((a) => a.section === sec && a.role !== 'nci' && Math.abs(b[a.code] ?? 0) > 0.005).map((a) => ({ a, v: nat(a.type, b[a.code] ?? 0) }));

  out.push({ label: 'ASSETS', value: 0, kind: 'heading' });
  for (const sec of BS_SECTIONS.slice(0, 2)) {
    const ls = sectionLines(sec);
    if (sec === 'Current assets' && Math.abs(b[UNMAPPED] ?? 0) > 0.005) ls.push({ a: { code: UNMAPPED, name: '⚠ Unmapped balances (net)' } as never, v: b[UNMAPPED] });
    if (!ls.length) continue;
    out.push({ label: sec, value: 0, kind: 'heading' });
    let t = 0;
    for (const { a, v } of ls) {
      out.push({ label: a.name, value: v, kind: 'line', code: a.code });
      t += v;
    }
    out.push({ label: `Total ${sec.toLowerCase()}`, value: t, kind: 'subtotal' });
    totalAssets += t;
  }
  out.push({ label: 'TOTAL ASSETS', value: totalAssets, kind: 'total' });

  out.push({ label: 'EQUITY AND LIABILITIES', value: 0, kind: 'heading' });
  out.push({ label: 'Equity', value: 0, kind: 'heading' });
  let eq = 0;
  for (const { a, v } of sectionLines('Equity')) {
    out.push({ label: a.name, value: v, kind: 'line', code: a.code });
    eq += v;
  }
  out.push({ label: 'Profit for the period attributable to owners', value: r.profit.owners, kind: 'line' });
  eq += r.profit.owners;
  out.push({ label: 'Equity attributable to owners of the parent', value: eq, kind: 'subtotal' });
  out.push({ label: 'Non-controlling interests', value: r.nciTotal, kind: 'line' });
  const totalEquity = eq + r.nciTotal;
  out.push({ label: 'Total equity', value: totalEquity, kind: 'subtotal' });
  let totalLiab = 0;
  for (const sec of BS_SECTIONS.slice(2, 4)) {
    const ls = sectionLines(sec);
    if (!ls.length) continue;
    out.push({ label: sec, value: 0, kind: 'heading' });
    let t = 0;
    for (const { a, v } of ls) {
      out.push({ label: a.name, value: v, kind: 'line', code: a.code });
      t += v;
    }
    out.push({ label: `Total ${sec.toLowerCase()}`, value: t, kind: 'subtotal' });
    totalLiab += t;
  }
  out.push({ label: 'Total liabilities', value: totalLiab, kind: 'subtotal' });
  out.push({ label: 'TOTAL EQUITY AND LIABILITIES', value: totalEquity + totalLiab, kind: 'total' });
  return out;
}

export function incomeStatement(r: ConsolidationResult): StmtLine[] {
  const b = r.consolidated;
  const out: StmtLine[] = [];
  const sec = (s: string) => r.accounts.filter((a) => a.section === s && Math.abs(b[a.code] ?? 0) > 0.005).map((a) => ({ a, v: -(b[a.code] ?? 0) }));
  let running = 0;
  const block = (s: string) => {
    for (const { a, v } of sec(s)) {
      out.push({ label: a.name, value: v, kind: 'line', code: a.code });
      running += v;
    }
  };
  block('Revenue');
  block('Cost of sales');
  out.push({ label: 'Gross profit', value: running, kind: 'subtotal' });
  block('Other income');
  block('Operating expenses');
  out.push({ label: 'Operating profit', value: running, kind: 'subtotal' });
  block('Finance income');
  block('Finance costs');
  block('Share of associates');
  // any custom sections not in the standard list
  for (const s of new Set(r.accounts.filter((a) => (a.type === 'revenue' || a.type === 'expense') && !PL_SECTIONS.includes(a.section as never)).map((a) => a.section))) block(s);
  out.push({ label: 'Profit before tax', value: running, kind: 'subtotal' });
  block('Income tax');
  out.push({ label: 'PROFIT FOR THE PERIOD', value: running, kind: 'total' });
  out.push({ label: 'Attributable to:', value: 0, kind: 'heading' });
  out.push({ label: 'Owners of the parent', value: r.profit.owners, kind: 'line' });
  out.push({ label: 'Non-controlling interests', value: r.profit.nci, kind: 'line' });
  return out;
}
