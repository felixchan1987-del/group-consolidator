import { BS_SECTIONS, PL_SECTIONS } from './coa';
import { UNMAPPED, type ConsolidationResult } from './consolidate';

export interface StmtLine {
  label: string;
  value: number;
  /** comparative amount; undefined when there is no prior period */
  prior?: number;
  kind: 'heading' | 'line' | 'subtotal' | 'total';
  code?: string;
}

const NZ = 0.005;

/** Accumulates a running total for the current and the prior period together. */
class Acc {
  cy = 0;
  py = 0;
  add(cy: number, py: number) {
    this.cy += cy;
    this.py += py;
  }
}

/**
 * Values are presented in natural sign (assets/liabilities/equity/income positive, expenses negative in P&L).
 * Pass the prior-period result to get comparatives; a line is shown when it is non-zero in either period.
 */
export function balanceSheet(r: ConsolidationResult, prior?: ConsolidationResult | null): StmtLine[] {
  const hasPy = !!prior;
  const out: StmtLine[] = [];
  const push = (label: string, kind: StmtLine['kind'], cy = 0, py = 0, code?: string) => out.push({ label, kind, value: cy, prior: hasPy ? py : undefined, code });
  const bal = (res: ConsolidationResult | null | undefined, code: string) => res?.consolidated[code] ?? 0;
  const nat = (type: string, v: number) => (type === 'asset' ? v : -v);

  const section = (sec: string, total: Acc, withUnmapped = false) => {
    const accs = r.accounts.filter((a) => a.section === sec && a.role !== 'nci' && (Math.abs(bal(r, a.code)) > NZ || Math.abs(bal(prior, a.code)) > NZ));
    const unmapped = withUnmapped && (Math.abs(bal(r, UNMAPPED)) > NZ || Math.abs(bal(prior, UNMAPPED)) > NZ);
    if (!accs.length && !unmapped) return;
    push(sec, 'heading');
    const t = new Acc();
    for (const a of accs) {
      const cy = nat(a.type, bal(r, a.code)),
        py = nat(a.type, bal(prior, a.code));
      push(a.name, 'line', cy, py, a.code);
      t.add(cy, py);
    }
    if (unmapped) {
      push('⚠ Unmapped balances (net)', 'line', bal(r, UNMAPPED), bal(prior, UNMAPPED), UNMAPPED);
      t.add(bal(r, UNMAPPED), bal(prior, UNMAPPED));
    }
    push(`Total ${sec.toLowerCase()}`, 'subtotal', t.cy, t.py);
    total.add(t.cy, t.py);
  };

  push('ASSETS', 'heading');
  const assets = new Acc();
  section(BS_SECTIONS[0], assets);
  section(BS_SECTIONS[1], assets, true);
  push('TOTAL ASSETS', 'total', assets.cy, assets.py);

  push('EQUITY AND LIABILITIES', 'heading');
  push('Equity', 'heading');
  const eq = new Acc();
  for (const a of r.accounts.filter((x) => x.section === 'Equity' && x.role !== 'nci' && (Math.abs(bal(r, x.code)) > NZ || Math.abs(bal(prior, x.code)) > NZ))) {
    const cy = -bal(r, a.code),
      py = -bal(prior, a.code);
    push(a.name, 'line', cy, py, a.code);
    eq.add(cy, py);
  }
  push('Profit for the period attributable to owners', 'line', r.profit.owners, prior?.profit.owners ?? 0);
  eq.add(r.profit.owners, prior?.profit.owners ?? 0);
  push('Equity attributable to owners of the parent', 'subtotal', eq.cy, eq.py);
  push('Non-controlling interests', 'line', r.nciTotal, prior?.nciTotal ?? 0);
  const te = new Acc();
  te.add(eq.cy + r.nciTotal, eq.py + (prior?.nciTotal ?? 0));
  push('Total equity', 'subtotal', te.cy, te.py);
  const liab = new Acc();
  section(BS_SECTIONS[2], liab);
  section(BS_SECTIONS[3], liab);
  push('Total liabilities', 'subtotal', liab.cy, liab.py);
  push('TOTAL EQUITY AND LIABILITIES', 'total', te.cy + liab.cy, te.py + liab.py);
  return out;
}

export function incomeStatement(r: ConsolidationResult, prior?: ConsolidationResult | null): StmtLine[] {
  const hasPy = !!prior;
  const out: StmtLine[] = [];
  const push = (label: string, kind: StmtLine['kind'], cy = 0, py = 0, code?: string) => out.push({ label, kind, value: cy, prior: hasPy ? py : undefined, code });
  const bal = (res: ConsolidationResult | null | undefined, code: string) => res?.consolidated[code] ?? 0;
  const run = new Acc();
  const block = (s: string) => {
    for (const a of r.accounts.filter((x) => x.section === s && (Math.abs(bal(r, x.code)) > NZ || Math.abs(bal(prior, x.code)) > NZ))) {
      const cy = -bal(r, a.code),
        py = -bal(prior, a.code);
      push(a.name, 'line', cy, py, a.code);
      run.add(cy, py);
    }
  };
  block('Revenue');
  block('Cost of sales');
  push('Gross profit', 'subtotal', run.cy, run.py);
  block('Other income');
  block('Operating expenses');
  push('Operating profit', 'subtotal', run.cy, run.py);
  block('Finance income');
  block('Finance costs');
  block('Share of associates');
  for (const s of new Set(r.accounts.filter((a) => (a.type === 'revenue' || a.type === 'expense') && !PL_SECTIONS.includes(a.section as never)).map((a) => a.section))) block(s);
  push('Profit before tax', 'subtotal', run.cy, run.py);
  block('Income tax');
  push('PROFIT FOR THE PERIOD', 'total', run.cy, run.py);
  push('Attributable to:', 'heading');
  push('Owners of the parent', 'line', r.profit.owners, prior?.profit.owners ?? 0);
  push('Non-controlling interests', 'line', r.profit.nci, prior?.profit.nci ?? 0);
  return out;
}
