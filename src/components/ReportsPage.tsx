import { useState } from 'react';
import type { PageProps } from '../App';
import { balanceSheet, incomeStatement, type StmtLine } from '../lib/statements';
import { exportConsolidation } from '../lib/exportXlsx';
import { ADJ_LABELS } from '../lib/consolidate';
import { fmt, pct } from '../lib/util';
import { periodEndOf } from '../lib/periods';
import type { Period } from '../types';

type Tab = 'bs' | 'is' | 'ws' | 'nci' | 'jr' | 'checks';

function Statement({ lines, title, sub, heads }: { lines: StmtLine[]; title: string; sub: string; heads: [string, string] }) {
  const hasPy = lines.some((l) => l.prior !== undefined);
  return (
    <div>
      <h3>{title}</h3>
      <p className="small muted" style={{ marginBottom: 8 }}>
        {sub}
      </p>
      <table className="stmt">
        <thead>
          <tr>
            <th />
            <th className="num">{heads[0]}</th>
            {hasPy && <th className="num">{heads[1]}</th>}
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i} className={l.kind}>
              <td>{l.label}</td>
              <td className="num">{l.kind === 'heading' ? '' : fmt(l.value)}</td>
              {hasPy && <td className="num muted">{l.kind === 'heading' ? '' : fmt(l.prior ?? 0)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ReportsPage({ project, result: cyResult, prior }: PageProps) {
  const [tab, setTab] = useState<Tab>('bs');
  const [per, setPer] = useState<Period>('cy');
  // detail tabs (worksheet, NCI, journals) show one period at a time
  const r = per === 'py' && prior ? prior : cyResult;
  const [showZero, setShowZero] = useState(false);
  const cur = project.presentationCurrency;
  const sub = `${project.name} · period ended ${project.periodEnd} · ${cur}`;
  if (!cyResult.consolidatedIds.length)
    return (
      <section className="page">
        <h2>Consolidated reports</h2>
        <div className="empty">Upload reports and select the parent entity first.</div>
      </section>
    );
  const bs = balanceSheet(cyResult, prior);
  const is = incomeStatement(cyResult, prior);
  const heads: [string, string] = [periodEndOf(project, 'cy'), periodEndOf(project, 'py')];
  const ta = bs.find((l) => l.label === 'TOTAL ASSETS')?.value ?? 0;
  const eqOwners = bs.find((l) => l.label === 'Equity attributable to owners of the parent')?.value ?? 0;
  const goodwill = cyResult.subsidiaries.reduce((s, x) => s + x.goodwill, 0);
  const allChecks = [...cyResult.checks, ...(prior?.checks ?? []).map((c) => ({ ...c, message: `Prior period: ${c.message}` }))];
  const errors = allChecks.filter((c) => c.level === 'error');
  const warns = allChecks.filter((c) => c.level === 'warn');
  const accName = new Map(r.accounts.map((a) => [a.code, a.name]));

  return (
    <section className="page">
      <div className="page-head">
        <div>
          <h2>Consolidated reports</h2>
          <p className="muted">
            {cyResult.consolidatedIds.length} entities fully consolidated, {cyResult.associates.length} equity-accounted{prior ? ', with comparatives' : ''}. Everything recalculates live as you change data, structure or mappings.
          </p>
        </div>
        <button className="btn primary" onClick={() => exportConsolidation(project, cyResult, prior)}>
          ⬇ Export to Excel
        </button>
      </div>

      {errors.length > 0 && (
        <div className="callout err small">
          <b>{errors.length} issue(s) need attention:</b> {errors.slice(0, 3).map((e) => e.message).join(' · ')}
          {errors.length > 3 ? ' …' : ''}{' '}
          <a href="#" onClick={(e) => { e.preventDefault(); setTab('checks'); }}>
            View all checks
          </a>
        </div>
      )}

      <div className="kpis">
        <div className="kpi"><div className="l">Total assets</div><div className="v">{fmt(ta)}</div></div>
        <div className="kpi"><div className="l">Equity attributable to owners</div><div className="v">{fmt(eqOwners)}</div></div>
        <div className="kpi"><div className="l">Non-controlling interests</div><div className="v">{fmt(cyResult.nciTotal)}</div></div>
        <div className="kpi">
          <div className="l">Profit for the period</div>
          <div className="v">{fmt(cyResult.profit.total)}</div>
          {prior && <div className="small muted">Prior: {fmt(prior.profit.total)}{prior.profit.total ? ` (${cyResult.profit.total >= prior.profit.total ? '+' : ''}${(((cyResult.profit.total - prior.profit.total) / Math.abs(prior.profit.total)) * 100).toFixed(1)}%)` : ''}</div>}
        </div>
        <div className="kpi"><div className="l">Goodwill</div><div className="v">{fmt(goodwill)}</div></div>
      </div>

      <div className="tabs">
        {(
          [
            ['bs', 'Balance sheet'],
            ['is', 'Income statement'],
            ['ws', 'Consolidation worksheet'],
            ['nci', 'Goodwill & NCI'],
            ['jr', `Elimination journals (${r.journals.length})`],
            ['checks', `Checks${errors.length ? ` (${errors.length} errors)` : warns.length ? ` (${warns.length} warnings)` : ''}`],
          ] as [Tab, string][]
        ).map(([k, l]) => (
          <button key={k} className={`tab ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>
            {l}
          </button>
        ))}
      </div>

      {prior && ['ws', 'nci', 'jr'].includes(tab) && (
        <div className="row">
          <span className="small muted">Period:</span>
          {(['cy', 'py'] as Period[]).map((x) => (
            <button key={x} className={`btn sm ${per === x ? 'primary' : ''}`} onClick={() => setPer(x)}>
              {x === 'cy' ? 'Current' : 'Prior'} ({periodEndOf(project, x)})
            </button>
          ))}
        </div>
      )}
      {tab === 'bs' && <Statement lines={bs} heads={heads} title="Consolidated statement of financial position" sub={sub} />}
      {tab === 'is' && <Statement lines={is} heads={heads} title="Consolidated statement of profit or loss" sub={sub} />}

      {tab === 'ws' && (
        <>
          <div className="row">
            <span className="small muted">Debit positive, credit in brackets. Entity columns are translated to {cur} and mapped to group accounts.</span>
            <div className="grow" />
            <label className="check small">
              <input type="checkbox" checked={showZero} onChange={(e) => setShowZero(e.target.checked)} /> Show zero rows
            </label>
          </div>
          <div className="table-wrap" style={{ maxHeight: '65vh' }}>
            <table>
              <thead>
                <tr>
                  <th className="sticky-col">Account</th>
                  {r.columns.map((c) => (
                    <th key={c.key} className={`num ${c.kind === 'total' ? 'col-total' : c.kind === 'adj' ? 'col-adj' : ''}`} title={c.kind === 'entity' ? project.entities.find((e) => e.id === c.key)?.name : undefined}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {r.rows
                  .filter((row) => showZero || r.columns.some((c) => Math.abs(row.values[c.key]) > 0.005))
                  .map((row) => (
                    <tr key={row.code}>
                      <td className="sticky-col">
                        <span className="muted small">{row.code}</span> {row.name}
                      </td>
                      {r.columns.map((c) => (
                        <td key={c.key} className={`num ${c.kind === 'total' ? 'col-total' : c.kind === 'adj' ? 'col-adj' : ''}`}>
                          {fmt(row.values[c.key])}
                        </td>
                      ))}
                    </tr>
                  ))}
                <tr>
                  <td className="sticky-col">
                    <b>Check (Σ = 0)</b>
                  </td>
                  {r.columns.map((c) => {
                    const s = r.rows.reduce((t, row) => t + row.values[c.key], 0);
                    return (
                      <td key={c.key} className="num">
                        {Math.abs(s) < 0.5 ? <span className="badge ok">0</span> : <span className="badge err">{fmt(s)}</span>}
                      </td>
                    );
                  })}
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'nci' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Subsidiary</th>
                  <th className="num">Group interest</th>
                  <th className="num">NCI %</th>
                  <th className="num">Equity (excl. FCTR)</th>
                  <th className="num">FCTR</th>
                  <th className="num">Profit</th>
                  <th className="num">Goodwill</th>
                  <th className="num">NCI b/f</th>
                  <th className="num">NCI share of profit</th>
                  <th className="num">NCI c/f</th>
                </tr>
              </thead>
              <tbody>
                {r.subsidiaries.map((s) => (
                  <tr key={s.entityId}>
                    <td>{s.name}</td>
                    <td className="num">{pct(s.effective)}</td>
                    <td className="num">{pct(s.nciPct)}</td>
                    <td className="num">{fmt(s.equityExFx)}</td>
                    <td className="num">{fmt(s.fctr)}</td>
                    <td className="num">{fmt(s.profit)}</td>
                    <td className="num">{fmt(s.goodwill - s.bargain)}</td>
                    <td className="num">{fmt(s.nciOpening)}</td>
                    <td className="num">{fmt(s.nciProfit)}</td>
                    <td className="num"><b>{fmt(s.nciClosing)}</b></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <h3 style={{ marginBottom: 8 }}>Goodwill by holding</h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Holder → Subsidiary</th>
                    <th className="num">Holding</th>
                    <th className="num">Holder's group interest</th>
                    <th className="num">Cost</th>
                    <th className="num">Net assets at acq.</th>
                    <th className="num">Goodwill (group share)</th>
                  </tr>
                </thead>
                <tbody>
                  {r.subsidiaries.flatMap((s) =>
                    s.holdings.map((h) => (
                      <tr key={s.entityId + h.holderId}>
                        <td>
                          {h.holderName} → {s.name}
                        </td>
                        <td className="num">{pct(h.pct)}</td>
                        <td className="num">{pct(h.holderEffective)}</td>
                        <td className="num">{fmt(h.cost)}</td>
                        <td className="num">{fmt(h.acqEquity)}</td>
                        <td className="num">{fmt(h.goodwill)}</td>
                      </tr>
                    )),
                  )}
                </tbody>
              </table>
            </div>
            <p className="small muted" style={{ marginTop: 6 }}>
              Goodwill = holder's group interest × (cost − holding % × net assets at acquisition). NCI is measured at its proportionate share of net assets; for indirect holdings the NCI of the intermediate holder is charged its share of the investment cost.
            </p>
          </div>
          {r.associates.length > 0 && (
            <div>
              <h3 style={{ marginBottom: 8 }}>Associates (equity method)</h3>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Associate</th>
                      <th>Held by</th>
                      <th className="num">Holding</th>
                      <th className="num">Cost</th>
                      <th className="num">Share of post-acq. reserves</th>
                      <th className="num">Share of profit</th>
                      <th className="num">Carrying amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.associates.flatMap((a) =>
                      a.pickups.map((k) => (
                        <tr key={a.entityId + k.holderId}>
                          <td>{a.name}</td>
                          <td>{k.holderName}</td>
                          <td className="num">{pct(k.pct)}</td>
                          <td className="num">{fmt(k.cost)}</td>
                          <td className="num">{fmt(k.reserves)}</td>
                          <td className="num">{fmt(k.profit)}</td>
                          <td className="num">{fmt(k.cost + k.reserves + k.profit)}</td>
                        </tr>
                      )),
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'jr' && (
        <div>
          {r.journals.length === 0 && <div className="empty">No consolidation entries.</div>}
          {r.journals.map((j) => (
            <div key={j.id} className="journal">
              <h4>
                {j.description} <span className="badge info">{ADJ_LABELS[j.column]}</span>
              </h4>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Account</th>
                      <th className="num">Debit</th>
                      <th className="num">Credit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {j.postings.map((p, i) => (
                      <tr key={i}>
                        <td style={{ paddingLeft: p.amount < 0 ? 30 : undefined }}>
                          {p.amount < 0 ? 'Cr ' : 'Dr '}
                          {p.account} · {accName.get(p.account)}
                        </td>
                        <td className="num">{p.amount > 0 ? fmt(p.amount, 2) : ''}</td>
                        <td className="num">{p.amount < 0 ? fmt(-p.amount, 2) : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'checks' && (
        <ul className="checks">
          {allChecks.map((c, i) => (
            <li key={i}>
              <span className={`badge ${c.level === 'error' ? 'err' : c.level === 'warn' ? 'warn' : 'ok'}`}>{c.level === 'error' ? 'Error' : c.level === 'warn' ? 'Warning' : 'OK'}</span>
              <span>{c.message}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
