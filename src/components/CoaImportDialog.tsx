import { useMemo, useState } from 'react';
import type { AccountType, Project } from '../types';
import { DEFAULT_ACCOUNTS, ROLE_LABELS, SECTIONS_BY_TYPE } from '../lib/coa';
import { analyseCoa, applyChart, buildChart, type ChartMode, type CoaRow } from '../lib/coaImport';
import type { ParsedSheet } from '../lib/importer';

const TYPE_LABEL: Record<AccountType, string> = { asset: 'Asset', liability: 'Liability', equity: 'Equity', revenue: 'Income', expense: 'Expense' };

interface Props {
  fileName: string;
  sheets: ParsedSheet[];
  project: Project;
  queueInfo?: string;
  onApply: (next: Project) => void;
  onClose: () => void;
}

/** Is the group chart still the built-in one (nothing imported or added yet)? */
const isBuiltInChart = (p: Project) => p.accounts.every((a) => DEFAULT_ACCOUNTS.some((d) => d.code === a.code && d.name === a.name));

export default function CoaImportDialog({ fileName, sheets, project, queueInfo, onApply, onClose }: Props) {
  const [sheetIdx, setSheetIdx] = useState(() => Math.max(0, sheets.findIndex((s) => analyseCoa(s.rows))));
  const analysis = useMemo(() => analyseCoa(sheets[sheetIdx]?.rows ?? []), [sheets, sheetIdx]);
  const [edits, setEdits] = useState<Record<number, Partial<CoaRow>>>({});
  const rows: CoaRow[] = useMemo(() => (analysis?.rows ?? []).map((r) => ({ ...r, ...edits[r.index] })), [analysis, edits]);
  const [mode, setMode] = useState<ChartMode>(() => (isBuiltInChart(project) ? 'replace' : 'merge'));
  const chart = useMemo(() => buildChart(rows, mode, project.accounts), [rows, mode, project.accounts]);
  const companies = project.entities.filter((e) => e.lines.length).length;
  const incomplete = rows.filter((r) => !r.skip && (!r.type || !r.section)).length;
  const head = analysis ? sheets[sheetIdx].rows[analysis.headerRow] ?? [] : [];
  const edit = (r: CoaRow, patch: Partial<CoaRow>) => setEdits({ ...edits, [r.index]: { ...edits[r.index], ...patch, guessed: false } });

  return (
    <div className="modal-bg" role="dialog" aria-modal="true">
      <div className="modal">
        <div className="modal-h">
          <div>
            <h3>Chart of accounts “{fileName}”</h3>
            <p className="small muted">{queueInfo ?? 'Becomes the group chart of accounts; every company is then mapped to it.'}</p>
          </div>
          <button className="btn ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="modal-b">
          {!analysis ? (
            <div className="callout warn small">
              No chart of accounts found in this file. It needs a header row with an account <b>name</b> column and a <b>type</b> or <b>code</b> column — for example Xero's
              <i> Accounting › Chart of accounts › Export</i>.
            </div>
          ) : (
            <>
              <div className="grid cols-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
                {sheets.length > 1 && (
                  <label className="field">
                    Worksheet
                    <select value={sheetIdx} onChange={(e) => { setSheetIdx(+e.target.value); setEdits({}); }}>
                      {sheets.map((s, i) => (
                        <option key={s.name} value={i}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <div className="field">
                  <span>Columns found</span>
                  <span className="small">
                    {[
                      analysis.codeCol >= 0 && `code “${String(head[analysis.codeCol])}”`,
                      `name “${String(head[analysis.nameCol])}”`,
                      analysis.typeCol >= 0 ? `type “${String(head[analysis.typeCol])}”` : 'no type column — types guessed from the names',
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </div>
                <div className="field">
                  <span>Use it</span>
                  <label className="check small">
                    <input type="radio" name="coa-mode" checked={mode === 'replace'} onChange={() => setMode('replace')} /> Replace the group chart ({project.accounts.length} accounts now)
                  </label>
                  <label className="check small">
                    <input type="radio" name="coa-mode" checked={mode === 'merge'} onChange={() => setMode('merge')} /> Add its accounts to the group chart
                  </label>
                </div>
              </div>
              <p className="small muted">
                Type and statement section come from the file's account types (and the name, e.g. interest → finance costs). Change any of them here; untick an account to leave it out.
              </p>
              <div className="table-wrap" style={{ maxHeight: 360 }}>
                <table className="preview">
                  <thead>
                    <tr>
                      <th />
                      <th>Code</th>
                      <th>Name</th>
                      <th>Type in file</th>
                      <th>Type</th>
                      <th>Statement section</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.index} style={{ opacity: r.skip ? 0.45 : 1 }}>
                        <td>
                          <input type="checkbox" checked={!r.skip} onChange={(e) => edit(r, { skip: !e.target.checked })} aria-label={`Import ${r.name}`} />
                        </td>
                        <td className="small">{r.code || <span className="muted">—</span>}</td>
                        <td>{r.name}</td>
                        <td className="small muted">{r.sourceType}</td>
                        <td>
                          <select value={r.type ?? ''} onChange={(e) => { const t = e.target.value as AccountType; edit(r, { type: t, section: SECTIONS_BY_TYPE[t][0] }); }} style={{ borderColor: r.type ? undefined : 'var(--warn)' }}>
                            {!r.type && <option value="">— choose —</option>}
                            {(Object.keys(TYPE_LABEL) as AccountType[]).map((t) => (
                              <option key={t} value={t}>
                                {TYPE_LABEL[t]}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          {r.type && (
                            <select value={r.section ?? ''} onChange={(e) => edit(r, { section: e.target.value })}>
                              {SECTIONS_BY_TYPE[r.type].map((s) => (
                                <option key={s}>{s}</option>
                              ))}
                            </select>
                          )}
                          {r.guessed && r.type && (
                            <span className="badge warn" style={{ marginLeft: 6 }} title="No recognised type in the file: guessed from the name">
                              guess
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="callout small">
                <b>{chart.added}</b> accounts {mode === 'replace' ? 'make up the new group chart' : 'are added'}
                {chart.existing > 0 && <> · {chart.existing} already in the chart</>}
                {incomplete > 0 && <span className="badge err" style={{ marginLeft: 6 }}>{incomplete} without a type — left out</span>}
                {Object.keys(chart.rolesFromChart).length > 0 && (
                  <div style={{ marginTop: 6 }}>
                    Used by the consolidation:{' '}
                    {Object.entries(chart.rolesFromChart)
                      .map(([role, names]) => `${ROLE_LABELS[role]} → ${names!.length > 2 ? `${names!.length} accounts` : names!.join(', ')}`)
                      .join(' · ')}
                  </div>
                )}
                {chart.systemAdded.length > 0 && (
                  <div style={{ marginTop: 6 }} className="muted">
                    Added for the consolidation entries: {chart.systemAdded.map((a) => a.name).join(', ')}.
                  </div>
                )}
                {companies > 0 && (
                  <div style={{ marginTop: 6 }}>
                    The {companies} imported compan{companies === 1 ? 'y is' : 'ies are'} mapped again to the new chart; mappings to accounts that are still there are kept.
                  </div>
                )}
              </div>
            </>
          )}
        </div>
        <div className="modal-f">
          <span className="small muted">Tip: import the chart before the companies' reports — lines with the same account name are then mapped automatically.</span>
          <div className="row">
            <button className="btn" onClick={onClose}>
              Cancel
            </button>
            <button className="btn primary" disabled={!analysis || chart.added === 0} onClick={() => onApply(applyChart(project, chart.accounts).project)}>
              {mode === 'replace' ? `Use these ${chart.added} accounts` : `Add ${chart.added} accounts`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
