import { useEffect } from 'react';
import * as XLSX from 'xlsx';
import type { Project } from '../types';
import { ADJ_LABELS, type AdjColumn, type ConsolidationResult } from '../lib/consolidate';
import { drill } from '../lib/drilldown';
import { fmt } from '../lib/util';

interface Props {
  project: Project;
  result: ConsolidationResult;
  account: string;
  column: string;
  periodLabel: string;
  onClose: () => void;
}

const drcr = (n: number) => (Math.abs(n) < 0.005 ? '–' : `${fmt(Math.abs(n), 2)} ${n > 0 ? 'Dr' : 'Cr'}`);
const RATE_LABEL = { closing: 'closing', average: 'average', historical: 'historical' } as const;

export default function DrillPanel({ project, result, account, column, periodLabel, onClose }: Props) {
  const names = Object.fromEntries(project.entities.map((e) => [e.id, { name: e.name, currency: e.currency }]));
  const d = drill(result, account, column, names);
  const colLabel = column === 'total' ? 'Consolidated' : (ADJ_LABELS as Record<string, string>)[column] ?? names[column]?.name ?? column;
  const cur = project.presentationCurrency;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const download = () => {
    const aoa: unknown[][] = [[`${d.account} ${d.accountName} — ${colLabel} — ${periodLabel}`], [], ['Entity', 'Source file', 'Local code', 'Local account', 'Currency', 'Local amount (Dr+)', 'Rate', 'Rate type', `${cur} (Dr+)`]];
    for (const e of d.entities) {
      for (const l of e.lines) aoa.push([e.entityName, l.sourceFile, l.code, l.name, e.currency, l.local, l.rate, l.rateType, l.translated]);
      if (e.cta) aoa.push([e.entityName, '', '', 'Translation difference (calculated)', '', '', '', '', e.cta]);
    }
    aoa.push([], ['Consolidation journal', 'Column', '', '', '', '', '', '', `${cur} (Dr+)`]);
    for (const j of d.journals) aoa.push([j.description, (ADJ_LABELS as Record<string, string>)[j.column] ?? j.column, '', '', '', '', '', '', j.amount]);
    aoa.push([], ['Total', '', '', '', '', '', '', '', d.total]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Drill-down');
    XLSX.writeFile(wb, `drill ${d.account} ${colLabel}.xlsx`.replace(/[^\w\- .]/g, ''));
  };

  return (
    <div className="modal-bg" role="dialog" aria-modal="true" aria-label="Drill-down" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-h">
          <div>
            <h3>
              {d.account !== '__unmapped' && <span className="muted">{d.account} · </span>}
              {d.accountName}
            </h3>
            <p className="small muted">
              {colLabel} · {periodLabel} · amounts in {cur}, Dr = debit, Cr = credit
            </p>
          </div>
          <div className="row">
            <button className="btn sm" onClick={download}>
              ⬇ Excel
            </button>
            <button className="btn ghost" onClick={onClose} aria-label="Close">
              ✕
            </button>
          </div>
        </div>
        <div className="modal-b">
          {d.entities.length === 0 && d.journals.length === 0 && <div className="empty">Nothing is posted to this account here.</div>}
          {d.entities.map((e) => (
            <div key={e.entityId}>
              <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
                <h3>{e.entityName}</h3>
                <b className="num">{drcr(e.total)}</b>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Local account</th>
                      <th>Source file</th>
                      <th className="num">Local ({e.currency})</th>
                      <th className="num">Rate</th>
                      <th className="num">{cur}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {e.lines.map((l) => (
                      <tr key={l.lineId}>
                        <td>
                          <span className="muted small">{l.code}</span> {l.name}
                        </td>
                        <td className="small muted">{l.sourceFile}</td>
                        <td className="num">{drcr(l.local)}</td>
                        <td className="num small">{l.rate === 1 ? '1' : `${l.rate} ${RATE_LABEL[l.rateType]}`}</td>
                        <td className="num">{drcr(l.translated)}</td>
                      </tr>
                    ))}
                    {e.cta !== 0 && (
                      <tr>
                        <td colSpan={4} className="muted">
                          Translation difference (calculated: closing / average / historical rates)
                        </td>
                        <td className="num">{drcr(e.cta)}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
          {d.journals.length > 0 && (
            <div>
              <h3 style={{ marginBottom: 6 }}>Consolidation entries</h3>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Entry</th>
                      <th>Column</th>
                      <th className="num">{cur}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.journals.map((j) => (
                      <tr key={j.id}>
                        <td>{j.description}</td>
                        <td className="small">
                          <span className="badge info">{ADJ_LABELS[j.column as AdjColumn] ?? j.column}</span>
                        </td>
                        <td className="num">{drcr(j.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
        <div className="modal-f">
          <span className="small muted">Source lines + consolidation entries = reported amount</span>
          <b className="num">Total {drcr(d.total)}</b>
        </div>
      </div>
    </div>
  );
}
