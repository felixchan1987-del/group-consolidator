import { useEffect, useMemo, useState } from 'react';
import type { Project, SignMode, SourceFile, TBLine } from '../types';
import { COL_ROLE_LABELS, SYSTEMS, detectColumns, detectHeaderRow, extractLines, guessEntityFromSheet, guessEntityName, type ColRole, type ParsedSheet } from '../lib/importer';
import { CURRENCIES, fmt, uid } from '../lib/util';

export interface ImportTarget {
  entityId: string | null;
  newName: string;
  currency: string;
  replace: boolean;
}

interface Props {
  fileName: string;
  sheets: ParsedSheet[];
  project: Project;
  queueInfo: string;
  onImport: (target: ImportTarget, lines: TBLine[], source: SourceFile) => void;
  onSkip: () => void;
}

export default function ImportDialog({ fileName, sheets, project, queueInfo, onImport, onSkip }: Props) {
  const [sheetIdx, setSheetIdx] = useState(() => {
    const i = sheets.findIndex((s) => /trial|tb|balance/i.test(s.name));
    return i >= 0 ? i : 0;
  });
  const [system, setSystem] = useState('generic');
  const preset = SYSTEMS.find((s) => s.id === system);
  const rows = sheets[sheetIdx]?.rows ?? [];
  const [headerRow, setHeaderRow] = useState(0);
  const [roles, setRoles] = useState<ColRole[]>([]);
  const [sign, setSign] = useState<SignMode>('dr');
  const [skipZero, setSkipZero] = useState(true);
  const guessed = useMemo(() => {
    const s0 = sheets[sheetIdx]?.rows ?? [];
    return guessEntityFromSheet(s0, detectHeaderRow(s0)) ?? guessEntityName(fileName);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const fileStem = fileName.toLowerCase().split(/[_\s.-]+/)[0];
  const existing = project.entities.find((e) => e.name.toLowerCase() === guessed.toLowerCase() || (e.code.length >= 2 && e.code.toLowerCase() === fileStem));
  const [target, setTarget] = useState<string>(existing?.id ?? 'new');
  const [newName, setNewName] = useState(guessed);
  const [currency, setCurrency] = useState(project.presentationCurrency);
  const [replace, setReplace] = useState(false);

  useEffect(() => {
    const hr = detectHeaderRow(rows, preset);
    setHeaderRow(hr);
    setRoles(detectColumns(rows, hr, preset));
    if (preset?.sign) setSign(preset.sign);
  }, [sheetIdx, system]); // eslint-disable-line react-hooks/exhaustive-deps

  const sourceId = useMemo(() => uid('src'), []);
  const res = useMemo(() => extractLines(rows, { headerRow, roles, sign, skipZero, sourceId }), [rows, headerRow, roles, sign, skipZero, sourceId]);
  const width = Math.max(roles.length, ...rows.slice(0, 60).map((r) => r.length));
  const hasDrCr = roles.includes('debit') || roles.includes('credit');
  const hasBal = roles.includes('balance');
  const hasName = roles.includes('name') || roles.includes('codename') || roles.includes('code');
  const diff = res.totalDebit - res.totalCredit;
  const previewFrom = Math.max(0, headerRow - 2);
  const preview = rows.slice(previewFrom, headerRow + 16);

  const doImport = () => {
    const src: SourceFile = { id: sourceId, fileName, sheet: sheets[sheetIdx].name, system: preset?.label ?? system, importedAt: new Date().toISOString(), lineCount: res.lines.length };
    onImport({ entityId: target === 'new' ? null : target, newName: newName.trim() || guessed, currency, replace }, res.lines, src);
  };

  return (
    <div className="modal-bg" role="dialog" aria-modal="true">
      <div className="modal">
        <div className="modal-h">
          <div>
            <h3>Import “{fileName}”</h3>
            <p className="small muted">{queueInfo}</p>
          </div>
          <button className="btn ghost" onClick={onSkip} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="modal-b">
          <div className="grid cols-3">
            <label className="field">
              Source accounting system
              <select value={system} onChange={(e) => setSystem(e.target.value)}>
                {SYSTEMS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Worksheet
              <select value={sheetIdx} onChange={(e) => setSheetIdx(+e.target.value)}>
                {sheets.map((s, i) => (
                  <option key={s.name} value={i}>
                    {s.name} ({s.rows.length} rows)
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Header row
              <input type="number" min={1} max={rows.length} value={headerRow + 1} onChange={(e) => setHeaderRow(Math.max(0, +e.target.value - 1))} />
            </label>
          </div>
          {preset && <p className="small muted">{preset.hint}</p>}

          <div className="table-wrap" style={{ maxHeight: 340 }}>
            <table className="preview">
              <thead>
                <tr>
                  <th className="small">Row</th>
                  {Array.from({ length: width }, (_, c) => (
                    <th key={c}>
                      <select
                        value={roles[c] ?? 'ignore'}
                        onChange={(e) => {
                          const next = [...roles];
                          while (next.length < width) next.push('ignore');
                          const v = e.target.value as ColRole;
                          if (v !== 'ignore') for (let i = 0; i < next.length; i++) if (next[i] === v) next[i] = 'ignore';
                          next[c] = v;
                          setRoles(next);
                        }}
                        style={{ minWidth: 120, fontWeight: roles[c] && roles[c] !== 'ignore' ? 600 : 400 }}
                      >
                        {Object.entries(COL_ROLE_LABELS).map(([k, l]) => (
                          <option key={k} value={k}>
                            {l}
                          </option>
                        ))}
                      </select>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.map((r, i) => {
                  const idx = previewFrom + i;
                  return (
                    <tr key={idx} className={idx === headerRow ? 'hdr' : idx < headerRow ? 'skip' : ''}>
                      <td className="small muted">{idx + 1}</td>
                      {Array.from({ length: width }, (_, c) => (
                        <td key={c} className={typeof r[c] === 'number' ? 'num' : ''}>
                          {r[c] instanceof Date ? (r[c] as Date).toISOString().slice(0, 10) : String(r[c] ?? '')}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="grid cols-3">
            <div className="field" style={{ gap: 8 }}>
              <span>Amount sign</span>
              {hasDrCr ? (
                <span className="small">Debit / Credit columns detected — debits positive, credits negative.</span>
              ) : (
                <select value={sign} onChange={(e) => setSign(e.target.value as SignMode)} disabled={!hasBal}>
                  <option value="dr">Debits positive, credits negative (trial balance)</option>
                  <option value="cr">Credits positive, debits negative</option>
                  <option value="natural">Natural signs (P&L / BS report) — resolve after mapping</option>
                </select>
              )}
              <label className="check small">
                <input type="checkbox" checked={skipZero} onChange={(e) => setSkipZero(e.target.checked)} /> Skip zero balances
              </label>
            </div>
            <label className="field">
              Import into entity
              <select value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value="new">+ New entity…</option>
                {project.entities.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
              {target === 'new' ? (
                <div className="row">
                  <input className="grow" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Entity name" />
                  <select value={currency} onChange={(e) => setCurrency(e.target.value)} aria-label="Functional currency">
                    {CURRENCIES.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </div>
              ) : (
                <label className="check small">
                  <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} /> Replace existing lines (otherwise append)
                </label>
              )}
            </label>
            <div className="callout">
              <dl className="kv">
                <dt>Account lines</dt>
                <dd>
                  <b>{res.lines.length}</b> <span className="muted small">({res.skipped} rows skipped: headings, totals, blanks)</span>
                </dd>
                {sign !== 'natural' || hasDrCr ? (
                  <>
                    <dt>Debits</dt>
                    <dd className="num" style={{ textAlign: 'left' }}>{fmt(res.totalDebit, 2)}</dd>
                    <dt>Credits</dt>
                    <dd className="num" style={{ textAlign: 'left' }}>{fmt(res.totalCredit, 2)}</dd>
                    <dt>Difference</dt>
                    <dd>{Math.abs(diff) < 0.5 ? <span className="badge ok">Balanced</span> : <span className="badge warn">{fmt(diff, 2)}</span>}</dd>
                  </>
                ) : (
                  <>
                    <dt>Balance check</dt>
                    <dd className="small muted">Runs after accounts are mapped.</dd>
                  </>
                )}
              </dl>
            </div>
          </div>
          {!hasName && <div className="callout warn small">Choose which column holds the account code / name.</div>}
          {!hasDrCr && !hasBal && <div className="callout warn small">Choose the Debit &amp; Credit columns, or a single Balance column.</div>}
        </div>
        <div className="modal-f">
          <span className="small muted">Your files are processed in this browser; nothing is uploaded to a server.</span>
          <div className="row">
            <button className="btn" onClick={onSkip}>
              Skip file
            </button>
            <button className="btn primary" onClick={doImport} disabled={!res.lines.length}>
              Import {res.lines.length} lines
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
