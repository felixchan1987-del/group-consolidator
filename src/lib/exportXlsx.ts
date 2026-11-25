import * as XLSX from 'xlsx';
import type { Project } from '../types';
import type { ConsolidationResult } from './consolidate';
import { METHOD_SHORT } from './structure';
import { balanceSheet, incomeStatement, type StmtLine } from './statements';

const r2 = (n: number) => Math.round(n * 100) / 100;

function stmtSheet(title: string, p: Project, lines: StmtLine[]) {
  const aoa: unknown[][] = [[p.name], [title], [`Period ended ${p.periodEnd} — ${p.presentationCurrency}`], []];
  for (const l of lines) aoa.push([l.kind === 'line' ? `   ${l.label}` : l.label, l.kind === 'heading' ? '' : r2(l.value)]);
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 52 }, { wch: 18 }];
  return ws;
}

export function exportConsolidation(p: Project, r: ConsolidationResult) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, stmtSheet('Consolidated statement of financial position', p, balanceSheet(r)), 'Balance Sheet');
  XLSX.utils.book_append_sheet(wb, stmtSheet('Consolidated income statement', p, incomeStatement(r)), 'Income Statement');

  const ws = [['Code', 'Account', ...r.columns.map((c) => c.label)], ...r.rows.map((row) => [row.code, row.name, ...r.columns.map((c) => r2(row.values[c.key]))])];
  ws.push(['', 'Check (should be 0)', ...r.columns.map((c) => r2(r.rows.reduce((s, row) => s + row.values[c.key], 0)))]);
  const wsSheet = XLSX.utils.aoa_to_sheet(ws);
  wsSheet['!cols'] = [{ wch: 8 }, { wch: 40 }, ...r.columns.map(() => ({ wch: 16 }))];
  XLSX.utils.book_append_sheet(wb, wsSheet, 'Worksheet (Dr+ Cr-)');

  const accName = new Map(r.accounts.map((a) => [a.code, a.name]));
  const jr: unknown[][] = [['Journal', 'Column', 'Account', 'Account name', 'Debit', 'Credit']];
  for (const j of r.journals)
    for (const ps of j.postings) jr.push([j.description, j.column, ps.account, accName.get(ps.account) ?? '', ps.amount > 0 ? r2(ps.amount) : '', ps.amount < 0 ? r2(-ps.amount) : '']);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(jr), 'Journals');

  const sub: unknown[][] = [['Subsidiary', 'Group effective %', 'NCI %', 'Equity excl. FCTR', 'FCTR', 'Profit', 'Goodwill', 'Bargain purchase', 'NCI opening', 'NCI share of profit', 'NCI closing']];
  for (const s of r.subsidiaries) sub.push([s.name, r2(s.effective * 100), r2(s.nciPct * 100), r2(s.equityExFx), r2(s.fctr), r2(s.profit), r2(s.goodwill), r2(s.bargain), r2(s.nciOpening), r2(s.nciProfit), r2(s.nciClosing)]);
  sub.push([]);
  sub.push(['Associate', 'Holder', 'Holding %', 'Cost', 'Net assets at acquisition', 'Share of post-acq reserves', 'Share of profit']);
  for (const a of r.associates) for (const k of a.pickups) sub.push([a.name, k.holderName, r2(k.pct * 100), r2(k.cost), r2(k.acqEquity), r2(k.reserves), r2(k.profit)]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sub), 'Goodwill & NCI');

  const st: unknown[][] = [['Entity', 'Code', 'Currency', 'Method', 'Group votes %', 'Effective interest %']];
  for (const e of p.entities) st.push([e.name, e.code, e.currency, METHOD_SHORT[r.structure.method[e.id]], r2(r.structure.groupVotes[e.id] * 100), r2(r.structure.effective[e.id] * 100)]);
  st.push([]);
  st.push(['Holder', 'Investee', '%', 'Cost', 'Net assets at acquisition', 'Acquisition date']);
  const n = (id: string) => p.entities.find((e) => e.id === id)?.name ?? '?';
  for (const h of p.holdings) st.push([n(h.holderId), n(h.investeeId), h.pct, h.cost, h.acqEquity ?? '(opening equity)', h.acqDate]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(st), 'Group Structure');

  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Level', 'Message'], ...r.checks.map((c) => [c.level, c.message])]), 'Checks');
  XLSX.writeFile(wb, `${p.name.replace(/[^\w\- ]/g, '')} consolidation ${p.periodEnd}.xlsx`);
}
