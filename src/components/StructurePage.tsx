import { useState } from 'react';
import type { PageProps } from '../App';
import type { MethodOverride } from '../types';
import OrgChart from './OrgChart';
import { METHOD_LABELS, METHOD_SHORT } from '../lib/structure';
import { pct, uid } from '../lib/util';

const num = (v: string) => (v === '' ? 0 : Number(v));

export default function StructurePage({ project, update, result, go }: PageProps) {
  const s = result.structure;
  const [selected, setSelected] = useState<string | null>(null);
  const ents = project.entities;
  const name = (id: string) => ents.find((e) => e.id === id)?.name ?? '?';
  const holdings = selected ? project.holdings.filter((h) => h.holderId === selected || h.investeeId === selected) : project.holdings;

  const addHolding = () =>
    update((d) => {
      const holder = selected ?? d.parentId ?? d.entities[0]?.id;
      const investee = d.entities.find((e) => e.id !== holder && !d.holdings.some((h) => h.investeeId === e.id) && e.id !== d.parentId)?.id ?? d.entities.find((e) => e.id !== holder)?.id;
      if (!holder || !investee) return;
      d.holdings.push({ id: uid('h'), holderId: holder, investeeId: investee, pct: 100, cost: 0, acqEquity: null, acqDate: '' });
    });

  return (
    <section className="page">
      <div className="page-head">
        <div>
          <h2>Group structure &amp; shareholdings</h2>
          <p className="muted">
            Record who owns what. Control (&gt;{project.settings.controlThreshold}% of votes held by the parent and its subsidiaries combined) means full consolidation; significant influence (≥
            {project.settings.influenceThreshold}%) means the equity method; anything smaller stays at cost. Indirect holdings and multiple holders are supported — effective interest and NCI follow automatically.
          </p>
        </div>
        <button className="btn primary" onClick={() => go('mapping')}>
          Next: account mapping →
        </button>
      </div>

      {ents.length < 2 && <div className="callout warn small">Add at least two entities (upload more reports, or add an entity on the Upload page) to build a group.</div>}

      <div className="row">
        <label className="field" style={{ minWidth: 260 }}>
          Ultimate parent
          <select value={project.parentId ?? ''} onChange={(e) => update((d) => void (d.parentId = e.target.value || null))}>
            <option value="">— select —</option>
            {ents.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field" style={{ width: 150 }}>
          Control threshold (%)
          <input type="number" value={project.settings.controlThreshold} onChange={(e) => update((d) => void (d.settings.controlThreshold = num(e.target.value)))} />
        </label>
        <label className="field" style={{ width: 170 }}>
          Significant influence (%)
          <input type="number" value={project.settings.influenceThreshold} onChange={(e) => update((d) => void (d.settings.influenceThreshold = num(e.target.value)))} />
        </label>
        <div className="grow" />
        <div className="legend">
          <span style={{ ['--c' as string]: 'var(--parent)' }}>Parent</span>
          <span style={{ ['--c' as string]: 'var(--sub)' }}>Subsidiary</span>
          <span style={{ ['--c' as string]: 'var(--assoc)' }}>Associate</span>
          <span style={{ ['--c' as string]: 'var(--inv)' }}>Investment / outside</span>
        </div>
      </div>

      <OrgChart project={project} structure={s} selected={selected} onSelect={(id) => setSelected(selected === id ? null : id)} />
      {s.warnings.map((w) => (
        <div key={w} className="callout warn small">
          {w}
        </div>
      ))}

      <div className="card">
        <div className="card-h">
          <h3>Shareholdings {selected && <span className="muted small">— filtered to {name(selected)} · <a href="#" onClick={(e) => { e.preventDefault(); setSelected(null); }}>show all</a></span>}</h3>
          <button className="btn sm primary" onClick={addHolding} disabled={ents.length < 2}>
            + Add shareholding
          </button>
        </div>
        <div className="table-wrap" style={{ border: 'none', borderRadius: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Holder (shareholder)</th>
                <th>Investee</th>
                <th className="num">Holding %</th>
                <th className="num" title="Cost of investment in presentation currency">Cost of investment ({project.presentationCurrency})</th>
                <th className="num" title="Fair value of the investee's net assets at acquisition date. Leave blank to use its opening equity (i.e. acquired at the start of this period).">
                  Net assets at acquisition
                </th>
                <th>Acquisition date</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {holdings.length === 0 && (
                <tr>
                  <td colSpan={7} className="muted small">
                    No shareholdings yet.
                  </td>
                </tr>
              )}
              {holdings.map((h) => {
                const set = (fn: (x: typeof h) => void) => update((d) => fn(d.holdings.find((x) => x.id === h.id)!));
                return (
                  <tr key={h.id}>
                    <td>
                      <select value={h.holderId} onChange={(e) => set((x) => void (x.holderId = e.target.value))}>
                        {ents.map((e) => (
                          <option key={e.id} value={e.id}>
                            {e.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select value={h.investeeId} onChange={(e) => set((x) => void (x.investeeId = e.target.value))}>
                        {ents.map((e) => (
                          <option key={e.id} value={e.id} disabled={e.id === h.holderId}>
                            {e.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="num">
                      <input type="number" min={0} max={100} step="0.01" value={h.pct} onChange={(e) => set((x) => void (x.pct = num(e.target.value)))} style={{ width: 90, textAlign: 'right' }} />
                    </td>
                    <td className="num">
                      <input type="number" value={h.cost} onChange={(e) => set((x) => void (x.cost = num(e.target.value)))} style={{ width: 140, textAlign: 'right' }} />
                    </td>
                    <td className="num">
                      <input
                        type="number"
                        placeholder="opening equity"
                        value={h.acqEquity ?? ''}
                        onChange={(e) => set((x) => void (x.acqEquity = e.target.value === '' ? null : Number(e.target.value)))}
                        style={{ width: 150, textAlign: 'right' }}
                      />
                    </td>
                    <td>
                      <input type="date" value={h.acqDate} onChange={(e) => set((x) => void (x.acqDate = e.target.value))} />
                    </td>
                    <td>
                      <button className="btn sm ghost danger" onClick={() => update((d) => void (d.holdings = d.holdings.filter((x) => x.id !== h.id)))} aria-label="Delete holding">
                        ✕
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="card-h">
          <h3>Consolidation method per entity</h3>
          <span className="small muted">Override the automatic classification when control differs from shareholding (e.g. voting agreements, potential voting rights).</span>
        </div>
        <div className="table-wrap" style={{ border: 'none', borderRadius: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Entity</th>
                <th>Currency</th>
                <th className="num">Group voting %</th>
                <th className="num">Effective interest</th>
                <th className="num">NCI</th>
                <th>Result</th>
                <th>Override</th>
              </tr>
            </thead>
            <tbody>
              {ents.map((e) => {
                const m = s.method[e.id];
                return (
                  <tr key={e.id} onClick={() => setSelected(e.id)} style={{ cursor: 'pointer' }}>
                    <td>
                      <b>{e.name}</b> <span className="muted small">{e.code}</span>
                    </td>
                    <td>{e.currency}</td>
                    <td className="num">{m === 'parent' ? '—' : pct(s.groupVotes[e.id])}</td>
                    <td className="num">{m === 'parent' || m === 'full' ? pct(s.effective[e.id]) : m === 'equity' ? pct(s.groupVotes[e.id]) : '—'}</td>
                    <td className="num">{m === 'full' ? pct(1 - s.effective[e.id]) : '—'}</td>
                    <td>
                      <span className={`badge m-${m}`} title={METHOD_LABELS[m]}>
                        {METHOD_SHORT[m]}
                      </span>
                    </td>
                    <td onClick={(ev) => ev.stopPropagation()}>
                      {m === 'parent' ? (
                        <span className="muted small">—</span>
                      ) : (
                        <select value={e.method} onChange={(ev) => update((d) => void (d.entities.find((x) => x.id === e.id)!.method = ev.target.value as MethodOverride))}>
                          <option value="auto">Automatic (by %)</option>
                          <option value="full">Force full consolidation</option>
                          <option value="equity">Force equity method</option>
                          <option value="investment">Force cost / fair value</option>
                          <option value="exclude">Exclude from group</option>
                        </select>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
