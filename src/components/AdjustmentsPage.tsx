import type { PageProps } from '../App';
import { AccountSelect } from './MappingPage';
import { fmt, uid } from '../lib/util';
import { periodEndOf } from '../lib/periods';
import type { FxRates, Period } from '../types';

const UNIT: FxRates = { closing: 1, average: 1, historical: 1 };

const num = (v: string) => (v === '' ? 0 : Number(v));

export default function AdjustmentsPage({ project, update, result, prior, go }: PageProps) {
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

      {(['cy', 'py'] as Period[])
        .filter((per) => per === 'cy' || prior)
        .map((per) => {
          const res = per === 'cy' ? result : prior!;
          return (
            <div className="card" key={per}>
              <div className="card-h">
                <h3>
                  Exchange rates — {per === 'cy' ? 'current' : 'prior'} period to {periodEndOf(project, per)} (1 unit of functional currency = x {project.presentationCurrency})
                </h3>
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
                      {fxEnts.map((e) => {
                        const rates = (per === 'cy' ? e.rates : e.ratesPrior) ?? UNIT;
                        return (
                          <tr key={e.id}>
                            <td>{e.name}</td>
                            <td>{e.currency}</td>
                            {(['closing', 'average', 'historical'] as const).map((k) => (
                              <td key={k} className="num">
                                <input
                                  type="number"
                                  step="0.0001"
                                  value={rates[k]}
                                  onChange={(ev) =>
                                    update((d) => {
                                      const x = d.entities.find((y) => y.id === e.id)!;
                                      if (per === 'cy') x.rates[k] = num(ev.target.value);
                                      else x.ratesPrior = { ...(x.ratesPrior ?? UNIT), [k]: num(ev.target.value) };
                                    })
                                  }
                                  style={{ width: 110, textAlign: 'right' }}
                                />
                              </td>
                            ))}
                            <td className="num">{fmt(-(res.translation[e.id]?.cta ?? 0), 0)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}

      <div className="card">
        <div className="card-h">
          <h3>Intercompany eliminations</h3>
        </div>
        <div className="card-b" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label className="check">
            <input type="checkbox" checked={project.settings.autoEliminateIC} onChange={(e) => update((d) => void (d.settings.autoEliminateIC = e.target.checked))} />
            Automatically eliminate balances mapped to Intercompany receivables/payables and Intercompany revenue/expenses
          </label>
          <p className="small muted">Matched amounts are eliminated; any mismatch stays visible in the consolidated accounts and is reported in the checks. Dividends and unrealised profit in inventory are handled below; use manual journals for anything else (e.g. profit on intra-group fixed asset transfers).</p>
        </div>
      </div>

      <div className="card">
        <div className="card-h">
          <h3>Intra-group dividends</h3>
          <label className="check small">
            <input type="checkbox" checked={project.settings.autoEliminateDividends !== false} onChange={(e) => update((d) => void (d.settings.autoEliminateDividends = e.target.checked))} />
            Eliminate automatically
          </label>
        </div>
        <div className="card-b" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <p className="small muted">
            Map dividends declared by group companies to <b>Dividends declared</b> and dividends received from group companies to <b>Dividend income from group companies</b>. Each holder&apos;s share
            (declared × holding %) is removed from its income; dividends to non-controlling shareholders reduce NCI. Associates&apos; dividends are eliminated the same way.
          </p>
          {result.dividends.length === 0 ? (
            <span className="small muted">No dividends declared by subsidiaries or associates in the current period.</span>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Paid by</th>
                    <th>Received by</th>
                    <th className="num">Eliminated ({project.presentationCurrency})</th>
                  </tr>
                </thead>
                <tbody>
                  {result.dividends.map((d, i) => (
                    <tr key={i}>
                      <td>{d.payerName}</td>
                      <td>{d.holderName}</td>
                      <td className="num">{fmt(d.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-h">
          <h3>Unrealised profit in inventory</h3>
          <button
            className="btn sm primary"
            disabled={project.entities.length < 2}
            onClick={() =>
              update((d) => {
                const [a, b] = [d.parentId ?? d.entities[0].id, d.entities.find((e) => e.id !== (d.parentId ?? d.entities[0].id))!.id];
                d.urp = [...(d.urp ?? []), { id: uid('urp'), sellerId: a, buyerId: b, description: '', closingInventory: 0, openingInventory: 0, rate: 0, basis: 'margin', period: 'cy' }];
              })
            }
          >
            + Add
          </button>
        </div>
        <div className="card-b" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <p className="small muted">
            Goods sold within the group and still in the buyer&apos;s inventory at the period end. The seller&apos;s profit on them is removed (Dr cost of sales, Cr inventories). Last period&apos;s unrealised profit
            (opening inventory) is released to this period&apos;s profit. When a partly owned subsidiary is the seller, NCI bears its share. Amounts in {project.presentationCurrency}.
          </p>
          {(project.urp ?? []).length > 0 && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Period</th>
                    <th>Seller</th>
                    <th>Buyer</th>
                    <th className="num">Closing inventory</th>
                    <th className="num">Opening inventory</th>
                    <th className="num">Profit %</th>
                    <th>Basis</th>
                    <th className="num">URP (closing)</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {(project.urp ?? []).map((u) => {
                    const set = (fn: (x: typeof u) => void) => update((d) => fn(d.urp!.find((x) => x.id === u.id)!));
                    const res = ((u.period ?? 'cy') === 'cy' ? result : prior)?.urp.find((x) => x.id === u.id);
                    const ents = project.entities;
                    return (
                      <tr key={u.id}>
                        <td>
                          <select value={u.period ?? 'cy'} onChange={(e) => set((x) => void (x.period = e.target.value as Period))}>
                            <option value="cy">Current</option>
                            <option value="py">Prior</option>
                          </select>
                        </td>
                        <td>
                          <select value={u.sellerId} onChange={(e) => set((x) => void (x.sellerId = e.target.value))}>
                            {ents.map((e) => (
                              <option key={e.id} value={e.id}>{e.name}</option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <select value={u.buyerId} onChange={(e) => set((x) => void (x.buyerId = e.target.value))}>
                            {ents.map((e) => (
                              <option key={e.id} value={e.id} disabled={e.id === u.sellerId}>{e.name}</option>
                            ))}
                          </select>
                        </td>
                        {(['closingInventory', 'openingInventory', 'rate'] as const).map((k) => (
                          <td key={k} className="num">
                            <input type="number" value={u[k] || ''} onChange={(e) => set((x) => void (x[k] = num(e.target.value)))} style={{ width: k === 'rate' ? 70 : 120, textAlign: 'right' }} />
                          </td>
                        ))}
                        <td>
                          <select value={u.basis} onChange={(e) => set((x) => void (x.basis = e.target.value as 'margin' | 'markup'))}>
                            <option value="margin">Margin on sales</option>
                            <option value="markup">Mark-up on cost</option>
                          </select>
                        </td>
                        <td className="num">{res ? fmt(res.closingUrp) : '—'}</td>
                        <td>
                          <button className="btn sm ghost danger" onClick={() => update((d) => void (d.urp = d.urp!.filter((x) => x.id !== u.id)))} aria-label="Remove">
                            ✕
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
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
                  <select value={j.period ?? 'cy'} onChange={(e) => setJ((x) => void (x.period = e.target.value as Period))} aria-label="Period">
                    <option value="cy">Current period</option>
                    <option value="py">Prior period</option>
                  </select>
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
    label: 'URP on fixed asset transfer',
    lines: [
      { account: '4100', debit: 0, credit: 0 },
      { account: '1500', debit: 0, credit: 0 },
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
