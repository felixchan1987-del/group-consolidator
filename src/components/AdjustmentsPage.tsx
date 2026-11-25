import type { PageProps } from '../App';
import { AccountSelect } from './MappingPage';
import { fmt, uid } from '../lib/util';

const num = (v: string) => (v === '' ? 0 : Number(v));

export default function AdjustmentsPage({ project, update, result, go }: PageProps) {
  const fxEnts = project.entities.filter((e) => e.currency !== project.presentationCurrency && result.structure.method[e.id] !== 'none');
  return (
    <section className="page">
      <div className="page-head">
        <div>
          <h2>Foreign exchange &amp; consolidation adjustments</h2>
          <p className="muted">
            Entities reporting in another currency are translated into {project.presentationCurrency}: assets and liabilities at the closing rate, income and expenses at the average rate, equity at the historical rate.
            The difference goes to the foreign currency translation reserve (shared with NCI).
          </p>
        </div>
        <button className="btn primary" onClick={() => go('reports')}>
          Next: consolidated reports →
        </button>
      </div>

      <div className="card">
        <div className="card-h">
          <h3>Exchange rates (1 unit of functional currency = x {project.presentationCurrency})</h3>
        </div>
        {fxEnts.length === 0 ? (
          <div className="card-b small muted">All group entities report in {project.presentationCurrency}. No translation needed.</div>
        ) : (
          <div className="table-wrap" style={{ border: 'none', borderRadius: 0 }}>
            <table>
              <thead>
                <tr>
                  <th>Entity</th>
                  <th>Currency</th>
                  <th className="num">Closing rate</th>
                  <th className="num">Average rate</th>
                  <th className="num">Historical rate (equity)</th>
                  <th className="num">Translation difference</th>
                </tr>
              </thead>
              <tbody>
                {fxEnts.map((e) => (
                  <tr key={e.id}>
                    <td>{e.name}</td>
                    <td>{e.currency}</td>
                    {(['closing', 'average', 'historical'] as const).map((k) => (
                      <td key={k} className="num">
                        <input
                          type="number"
                          step="0.0001"
                          value={e.rates[k]}
                          onChange={(ev) => update((d) => void (d.entities.find((x) => x.id === e.id)!.rates[k] = num(ev.target.value)))}
                          style={{ width: 110, textAlign: 'right' }}
                        />
                      </td>
                    ))}
                    <td className="num">{fmt(-(result.translation[e.id]?.cta ?? 0), 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-h">
          <h3>Intercompany eliminations</h3>
        </div>
        <div className="card-b" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label className="check">
            <input type="checkbox" checked={project.settings.autoEliminateIC} onChange={(e) => update((d) => void (d.settings.autoEliminateIC = e.target.checked))} />
            Automatically eliminate balances mapped to Intercompany receivables/payables and Intercompany revenue/expenses
          </label>
          <p className="small muted">Matched amounts are eliminated; any mismatch stays visible in the consolidated accounts and is reported in the checks. Use manual journals below for dividends, unrealised profit in inventory, intercompany loans with interest, etc.</p>
        </div>
      </div>

      <div className="card">
        <div className="card-h">
          <h3>Manual consolidation journals</h3>
          <div className="row">
            {TEMPLATES.map((t) => (
              <button key={t.label} className="btn sm" onClick={() => update((d) => void d.journals.push({ id: uid('j'), description: t.label, lines: t.lines.map((l) => ({ ...l })) }))}>
                + {t.label}
              </button>
            ))}
            <button className="btn sm primary" onClick={() => update((d) => void d.journals.push({ id: uid('j'), description: '', lines: [{ account: '', debit: 0, credit: 0 }, { account: '', debit: 0, credit: 0 }] }))}>
              + Blank journal
            </button>
          </div>
        </div>
        <div className="card-b" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {project.journals.length === 0 && <div className="small muted">No manual journals. Amounts are in {project.presentationCurrency}.</div>}
          {project.journals.map((j) => {
            const dr = j.lines.reduce((s, l) => s + (l.debit || 0), 0);
            const cr = j.lines.reduce((s, l) => s + (l.credit || 0), 0);
            const setJ = (fn: (x: typeof j) => void) => update((d) => fn(d.journals.find((x) => x.id === j.id)!));
            return (
              <div key={j.id} className="card">
                <div className="card-h">
                  <input value={j.description} placeholder="Description" onChange={(e) => setJ((x) => void (x.description = e.target.value))} className="grow" />
                  {Math.abs(dr - cr) < 0.005 ? <span className="badge ok">Balanced</span> : <span className="badge err">Out by {fmt(dr - cr, 2)}</span>}
                  <button className="btn sm ghost danger" onClick={() => update((d) => void (d.journals = d.journals.filter((x) => x.id !== j.id)))}>
                    Delete
                  </button>
                </div>
                <table>
                  <thead>
                    <tr>
                      <th>Group account</th>
                      <th className="num">Debit</th>
                      <th className="num">Credit</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {j.lines.map((l, i) => (
                      <tr key={i}>
                        <td style={{ width: '55%' }}>
                          <AccountSelect accounts={project.accounts} value={l.account} onChange={(v) => setJ((x) => void (x.lines[i].account = v))} placeholder="— account —" />
                        </td>
                        <td className="num">
                          <input type="number" value={l.debit || ''} onChange={(e) => setJ((x) => void (x.lines[i].debit = num(e.target.value)))} style={{ width: 140, textAlign: 'right' }} />
                        </td>
                        <td className="num">
                          <input type="number" value={l.credit || ''} onChange={(e) => setJ((x) => void (x.lines[i].credit = num(e.target.value)))} style={{ width: 140, textAlign: 'right' }} />
                        </td>
                        <td>
                          <button className="btn sm ghost" onClick={() => setJ((x) => void x.lines.splice(i, 1))} aria-label="Remove line">
                            ✕
                          </button>
                        </td>
                      </tr>
                    ))}
                    <tr>
                      <td>
                        <button className="btn sm" onClick={() => setJ((x) => void x.lines.push({ account: '', debit: 0, credit: 0 }))}>
                          + Line
                        </button>
                      </td>
                      <td className="num">
                        <b>{fmt(dr, 2)}</b>
                      </td>
                      <td className="num">
                        <b>{fmt(cr, 2)}</b>
                      </td>
                      <td />
                    </tr>
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

const TEMPLATES = [
  {
    label: 'Intra-group dividend',
    lines: [
      { account: '4100', debit: 0, credit: 0 },
      { account: '3200', debit: 0, credit: 0 },
    ],
  },
  {
    label: 'Unrealised profit in inventory',
    lines: [
      { account: '5000', debit: 0, credit: 0 },
      { account: '1200', debit: 0, credit: 0 },
    ],
  },
  {
    label: 'Goodwill impairment',
    lines: [
      { account: '5300', debit: 0, credit: 0 },
      { account: '1650', debit: 0, credit: 0 },
    ],
  },
];
