import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Period, Project, SignMode, SourceFile, TBLine } from '../types';
import { periodEndOf, periodMonths, periodStartOf } from '../lib/periods';
import { COL_ROLE_LABELS, SYSTEMS, detectColumns, detectHeaderRow, extractLines, guessEntityFromSheet, guessEntityName, type ColRole, type ParsedSheet } from '../lib/importer';
import { analyseReport, defaultColPeriods, looksLikeReport, reportToLines, type ColPeriod, type ReportAnalysis } from '../lib/reportParser';
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
  onImport: (target: ImportTarget, lines: TBLine[], sources: SourceFile[]) => void;
  onSkip: () => void;
  /** set the reporting period: end date, and optionally the first day (year-to-date reporting) */
  onSetPeriod: (end: string, start?: string) => void;
}

type Mode = 'report' | 'table';

const KIND_LABEL: Record<ReportAnalysis['kind'], string> = {
  balance_sheet: 'Balance sheet report',
  profit_loss: 'Profit and loss report',
  report: 'Financial report',
};

const longDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

export default function ImportDialog({ fileName, sheets, project, queueInfo, onImport, onSkip, onSetPeriod }: Props) {
  const [sheetIdx, setSheetIdx] = useState(() => {
    const r = sheets.findIndex((s) => looksLikeReport(s.rows));
    if (r >= 0) return r;
    const i = sheets.findIndex((s) => /trial|tb|balance/i.test(s.name));
    return i >= 0 ? i : 0;
  });
  const rows = sheets[sheetIdx]?.rows ?? [];
  const [mode, setMode] = useState<Mode>(() => (looksLikeReport(rows) ? 'report' : 'table'));
  const [system, setSystem] = useState('generic');
  const preset = SYSTEMS.find((s) => s.id === system);
  const [skipZero, setSkipZero] = useState(true);

  // ---- report mode state
  const [overrides, setOverrides] = useState<Record<number, 'account' | 'excluded'>>({});
  const report = useMemo(() => analyseReport(rows, { overrides }), [rows, overrides]);
  const [colPeriodsUser, setColPeriodsUser] = useState<Record<number, ColPeriod>>({});
  const colPeriods = useMemo(() => {
    const d = defaultColPeriods(report, project);
    return report.amountCols.map((c, i) => colPeriodsUser[c.col] ?? d[i]);
  }, [report, project, colPeriodsUser]);

  // ---- table mode state
  const [headerRow, setHeaderRow] = useState(0);
  const [roles, setRoles] = useState<ColRole[]>([]);
  const [sign, setSign] = useState<SignMode>('dr');
  const [period, setPeriod] = useState<Period>(() => {
    const prevYear = periodEndOf(project, 'py').slice(0, 4);
    return /prior|comparative|\bpy\b|last.?year/i.test(fileName) || new RegExp(`(^|\\D)${prevYear}(\\D|$)`).test(fileName) ? 'py' : 'cy';
  });

  useEffect(() => {
    const hr = detectHeaderRow(rows, preset);
    setHeaderRow(hr);
    setRoles(detectColumns(rows, hr, preset));
    if (preset?.sign) setSign(preset.sign);
  }, [sheetIdx, system]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setMode(looksLikeReport(rows) ? 'report' : 'table');
    setOverrides({});
    setColPeriodsUser({});
  }, [sheetIdx]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- target entity
  const guessed = useMemo(() => {
    const s0 = sheets[sheetIdx]?.rows ?? [];
    return analyseReport(s0).entityName ?? guessEntityFromSheet(s0, detectHeaderRow(s0)) ?? guessEntityName(fileName);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const fileStem = fileName.toLowerCase().split(/[_\s.-]+/)[0];
  const existing = project.entities.find((e) => e.name.toLowerCase() === guessed.toLowerCase() || (e.code.length >= 2 && e.code.toLowerCase() === fileStem));
  const [target, setTarget] = useState<string>(existing?.id ?? 'new');
  const [newName, setNewName] = useState(guessed);
  const [currency, setCurrency] = useState(() => {
    const c = analyseReport(sheets[sheetIdx]?.rows ?? []).currency;
    return c && CURRENCIES.includes(c) ? c : project.presentationCurrency;
  });
  const [replace, setReplace] = useState(false);

  // ---- results
  const sourceIds = useMemo(() => ({ cy: uid('src'), py: uid('src') }), []);
  const tableRes = useMemo(() => extractLines(rows, { headerRow, roles, sign, skipZero, sourceId: sourceIds[period] }), [rows, headerRow, roles, sign, skipZero, sourceIds, period]);
  const reportLines = useMemo(
    () => reportToLines(report, colPeriods.map((p) => (p === 'skip' ? null : p)), sourceIds, skipZero),
    [report, colPeriods, sourceIds, skipZero],
  );
  const lines = mode === 'report' ? reportLines : tableRes.lines.map((l) => ({ ...l, period }));

  const doImport = () => {
    const periods = [...new Set(lines.map((l) => l.period ?? 'cy'))];
    const sources: SourceFile[] = periods.map((p) => ({
      id: sourceIds[p],
      fileName,
      sheet: sheets[sheetIdx].name,
      system: mode === 'report' ? `${preset?.id === 'generic' ? '' : `${preset?.label} `}${KIND_LABEL[report.kind].toLowerCase()}` : preset?.label ?? system,
      importedAt: new Date().toISOString(),
      lineCount: lines.filter((l) => (l.period ?? 'cy') === p).length,
      period: p,
    }));
    onImport({ entityId: target === 'new' ? null : target, newName: newName.trim() || guessed, currency, replace }, lines, sources);
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
          <div className="grid cols-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
            <label className="field">
              Layout
              <select value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
                <option value="report">Report (headings, accounts, totals)</option>
                <option value="table">Table / trial balance (pick columns)</option>
              </select>
            </label>
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
            {mode === 'table' && (
              <>
                <label className="field">
                  Period
                  <select value={period} onChange={(e) => setPeriod(e.target.value as Period)}>
                    <option value="cy">Current period (to {periodEndOf(project, 'cy')})</option>
                    <option value="py">Prior period / comparative (to {periodEndOf(project, 'py')})</option>
                  </select>
                </label>
                <label className="field">
                  Header row
                  <input type="number" min={1} max={rows.length} value={headerRow + 1} onChange={(e) => setHeaderRow(Math.max(0, +e.target.value - 1))} />
                </label>
              </>
            )}
          </div>
          {mode === 'table' && preset && <p className="small muted">{preset.hint}</p>}

          {mode === 'report' ? (
            <ReportView
              report={report}
              colPeriods={colPeriods}
              project={project}
              onColPeriod={(col, p) => setColPeriodsUser({ ...colPeriodsUser, [col]: p })}
              onToggle={(i, to) => {
                const next = { ...overrides };
                if (to) next[i] = to;
                else delete next[i];
                setOverrides(next);
              }}
              onSetPeriod={onSetPeriod}
            />
          ) : (
            <TableView rows={rows} headerRow={headerRow} roles={roles} setRoles={setRoles} />
          )}

          <div className="grid cols-3">
            <div className="field" style={{ gap: 8 }}>
              <span>Options</span>
              {mode === 'table' &&
                (roles.includes('debit') || roles.includes('credit') ? (
                  <span className="small">Debit / Credit columns detected — debits positive, credits negative.</span>
                ) : (
                  <select value={sign} onChange={(e) => setSign(e.target.value as SignMode)} disabled={!roles.includes('balance')}>
                    <option value="dr">Debits positive, credits negative (trial balance)</option>
                    <option value="cr">Credits positive, debits negative</option>
                    <option value="natural">Natural signs — resolve after mapping</option>
                  </select>
                ))}
              {mode === 'report' && <span className="small">Signs come from each line's section (assets / expenses = debit; liabilities / equity / income = credit).</span>}
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
                  <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} /> Replace this entity's lines for the imported period(s) (otherwise append)
                </label>
              )}
            </label>
            {mode === 'report' ? <ReportSummary report={report} colPeriods={colPeriods} lines={lines} /> : <TableSummary res={tableRes} sign={sign} roles={roles} />}
          </div>
        </div>
        <div className="modal-f">
          <span className="small muted">Your files are processed in this browser; nothing is uploaded to a server.</span>
          <div className="row">
            <button className="btn" onClick={onSkip}>
              Skip file
            </button>
            <button className="btn primary" onClick={doImport} disabled={!lines.length}>
              Import {lines.length} lines
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- report mode

function ReportView({
  report,
  colPeriods,
  project,
  onColPeriod,
  onToggle,
  onSetPeriod,
}: {
  report: ReportAnalysis;
  colPeriods: ColPeriod[];
  project: Project;
  onColPeriod: (col: number, p: ColPeriod) => void;
  onToggle: (row: number, to: 'account' | 'excluded' | null) => void;
  onSetPeriod: (end: string, start?: string) => void;
}) {
  const shown = report.rows.filter((r) => r.type !== 'blank');
  const cy = periodEndOf(project, 'cy');
  const dates = report.amountCols.map((c) => c.date).filter((d): d is string => !!d);
  const newest = [...dates, report.reportDate ?? ''].filter(Boolean).sort().pop();
  const mismatch = newest && !dates.includes(cy) && newest !== cy;
  const dup = (['cy', 'py'] as const).filter((p) => colPeriods.filter((x) => x === p).length > 1);
  const hasData = project.entities.some((e) => e.lines.length);
  const start = periodStartOf(project, 'cy');
  // Year to date column = sum of the month columns: we know exactly which period the P&L covers
  const ytdEnd = report.amountCols.find((c) => c.ytd)?.date ?? null;
  const ytdPeriod = report.ytdStart && ytdEnd ? { start: report.ytdStart, end: ytdEnd } : null;
  const ytdDiffers = ytdPeriod && (ytdPeriod.start !== start || ytdPeriod.end !== cy);
  const monthCols = report.amountCols.filter((c) => c.month).length;
  const ytdCol = report.amountCols.some((c) => c.ytd);

  if (!report.amountCols.length) return <div className="callout warn small">No amount columns found in this sheet. Try the "Table / trial balance" layout.</div>;

  return (
    <>
      {ytdPeriod && ytdDiffers && (ytdPeriod.end === cy || !hasData) && (
        <div className="callout warn small row">
          <span>
            The <b>Year to date</b> column adds up the month columns, so this P&L covers <b>{longDate(ytdPeriod.start)} – {longDate(ytdPeriod.end)}</b> ({periodMonths(ytdPeriod.start, ytdPeriod.end)} months). The project period is{' '}
            {longDate(start)} – {longDate(cy)}.
          </span>
          <button className="btn sm" onClick={() => onSetPeriod(ytdPeriod.end, ytdPeriod.start)}>
            Use {longDate(ytdPeriod.start)} – {longDate(ytdPeriod.end)}
          </button>
        </div>
      )}
      {report.kind !== 'balance_sheet' && monthCols > 0 && (
        <p className="small muted">
          {ytdCol
            ? 'Monthly layout: the Year to date column is imported; the single-month columns are shown for reference (set one to Current or Prior to use it instead).'
            : `Monthly layout: set every month you want to include to Current (or Prior) and they are added up${project.periodStart ? '' : ' — or set the period start in the header bar and the months inside the period are picked for you'}.`}
        </p>
      )}
      {report.kind === 'balance_sheet' && report.amountCols.length > 1 && !colPeriods.includes('py') && (
        <p className="small muted">
          Only the column dated {cy} is imported. Other columns are left out (a comparative is the same date one year earlier, {periodEndOf(project, 'py')}).
        </p>
      )}
      {mismatch && !(ytdPeriod && ytdDiffers && (ytdPeriod.end === cy || !hasData)) && (
        <div className="callout warn small row">
          <span>
            This report is dated <b>{newest}</b> but the project's period end is <b>{cy}</b>.
          </span>
          {!hasData && (
            <button className="btn sm" onClick={() => onSetPeriod(newest!)}>
              Use {newest} as period end
            </button>
          )}
        </div>
      )}
      {dup.length > 0 &&
        (report.kind === 'balance_sheet' ? (
          <div className="callout warn small">Two balance sheet columns are set to the same period — balances at different dates would be added together.</div>
        ) : (
          <p className="small muted">Columns set to the same period are added together.</p>
        ))}
      <p className="small muted">
        Rows are classified automatically. <b>Click a row</b> to include or exclude it. Totals are recomputed from the account lines: ✓ means the report's total agrees.
      </p>
      <div className="table-wrap" style={{ maxHeight: 380 }}>
        <table className="preview report-preview">
          <thead>
            <tr>
              <th className="small">Row</th>
              <th>Line</th>
              {report.codeCol >= 0 && <th>Code</th>}
              {report.amountCols.map((c, i) => (
                <th key={c.col} className={`num${colPeriods[i] === 'skip' ? ' col-skip' : ''}`}>
                  <div className="small" style={{ fontWeight: 600 }}>{c.header || `Column ${c.col + 1}`}</div>
                  <select value={colPeriods[i]} onChange={(e) => onColPeriod(c.col, e.target.value as ColPeriod)} aria-label={`Period for ${c.header}`}>
                    <option value="cy">Current (to {cy})</option>
                    <option value="py">Prior (to {periodEndOf(project, 'py')})</option>
                    <option value="skip">Don't import</option>
                  </select>
                </th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const clickable = r.type === 'account' || r.type === 'total' || r.type === 'excluded';
              const toggle = () => {
                if (r.type === 'account') onToggle(r.index, 'excluded');
                else if (r.type === 'excluded') onToggle(r.index, null);
                else if (r.type === 'total') onToggle(r.index, 'account');
              };
              return (
                <tr
                  key={r.index}
                  className={`rt-${r.type}`}
                  onClick={clickable ? toggle : undefined}
                  title={`${r.reason}${clickable ? (r.type === 'account' ? ' — click to exclude' : r.type === 'excluded' ? ' — click to include again' : ' — click to import as an account line') : ''}`}
                  style={{ cursor: clickable ? 'pointer' : undefined }}
                >
                  <td className="small muted">{r.index + 1}</td>
                  <td style={{ paddingLeft: 10 + (r.type === 'account' || r.type === 'excluded' ? r.path.length : r.type === 'total' || r.type === 'heading' ? Math.max(0, r.path.length) : 0) * 14 }}>
                    {r.label}
                    {r.currentEarnings && (
                      <span className="badge info" style={{ marginLeft: 6 }} title="Left out automatically when this company's P&L for the same period is imported">
                        profit for the year
                      </span>
                    )}
                  </td>
                  {report.codeCol >= 0 && <td className="small">{r.code}</td>}
                  {r.amounts.map((v, k) => (
                    <td key={k} className={`num${colPeriods[k] === 'skip' ? ' col-skip' : ''}`}>
                      {v === null ? '' : fmt(v, 2)}
                      {r.check?.[k] === 'ok' && <span className="chk ok"> ✓</span>}
                      {r.check?.[k] === 'diff' && <span className="chk err"> ✗</span>}
                    </td>
                  ))}
                  <td>
                    <span className={`badge ${r.type === 'account' ? (r.nature ? 'ok' : 'warn') : r.type === 'excluded' ? 'err' : 'info'}`}>
                      {r.type === 'account' ? (r.nature === 'dr' ? 'Dr line' : r.nature === 'cr' ? 'Cr line' : 'line') : r.type}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function ReportSummary({ report, colPeriods, lines }: { report: ReportAnalysis; colPeriods: ColPeriod[]; lines: TBLine[] }) {
  const { agree, checked } = report.totals;
  const accounts = report.rows.filter((r) => r.type === 'account');
  const noSection = accounts.filter((r) => !r.nature).length;
  return (
    <div className="callout">
      <dl className="kv">
        <dt>Detected</dt>
        <dd>
          <b>{KIND_LABEL[report.kind]}</b>
          {report.entityName ? ` · ${report.entityName}` : ''}
        </dd>
        <dt>Account lines</dt>
        <dd>
          <b>{accounts.length}</b> → {lines.length} imported
        </dd>
        <dt>Report totals</dt>
        <dd>
          {checked === 0 ? (
            <span className="muted small">none to compare</span>
          ) : agree === checked ? (
            <span className="badge ok">{agree} of {checked} agree</span>
          ) : (
            <span className="badge err">
              {checked - agree} of {checked} don't agree
            </span>
          )}
        </dd>
        {report.amountCols.map((c, k) =>
          colPeriods[k] === 'skip' ? null : (
            <FragmentRow key={c.col} label={`${c.header || `Column ${c.col + 1}`}`}>
              {report.kind === 'balance_sheet' ? (
                Math.abs(report.balance[k]) < 0.5 ? (
                  <span className="badge ok">Assets = Liabilities + Equity</span>
                ) : (
                  <span className="badge warn">Out of balance by {fmt(report.balance[k], 2)}</span>
                )
              ) : (
                <span>Net result {fmt(-report.balance[k], 2)}</span>
              )}
            </FragmentRow>
          ),
        )}
      </dl>
      {noSection > 0 && <p className="small muted" style={{ marginTop: 6 }}>{noSection} line(s) are not under a recognisable section; their sign is resolved after mapping.</p>}
    </div>
  );
}

function FragmentRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  );
}

// ---------------------------------------------------------------- table mode

function TableView({ rows, headerRow, roles, setRoles }: { rows: unknown[][]; headerRow: number; roles: ColRole[]; setRoles: (r: ColRole[]) => void }) {
  const width = Math.max(roles.length, ...rows.slice(0, 60).map((r) => r.length));
  const previewFrom = Math.max(0, headerRow - 2);
  const preview = rows.slice(previewFrom, headerRow + 16);
  return (
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
  );
}

function TableSummary({ res, sign, roles }: { res: ReturnType<typeof extractLines>; sign: SignMode; roles: ColRole[] }) {
  const hasDrCr = roles.includes('debit') || roles.includes('credit');
  const hasBal = roles.includes('balance');
  const hasName = roles.includes('name') || roles.includes('codename') || roles.includes('code');
  const diff = res.totalDebit - res.totalCredit;
  return (
    <div className="callout">
      <dl className="kv">
        <dt>Account lines</dt>
        <dd>
          <b>{res.lines.length}</b> <span className="muted small">({res.skipped} rows skipped: headings, totals, blanks)</span>
        </dd>
        {sign !== 'natural' || hasDrCr ? (
          <>
            <dt>Debits</dt>
            <dd>{fmt(res.totalDebit, 2)}</dd>
            <dt>Credits</dt>
            <dd>{fmt(res.totalCredit, 2)}</dd>
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
      {!hasName && <p className="small" style={{ color: 'var(--warn)', marginTop: 6 }}>Choose which column holds the account code / name.</p>}
      {!hasDrCr && !hasBal && <p className="small" style={{ color: 'var(--warn)', marginTop: 6 }}>Choose the Debit &amp; Credit columns, or a single Balance column.</p>}
    </div>
  );
}
