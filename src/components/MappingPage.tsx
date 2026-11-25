import { useMemo, useState } from 'react';
import type { PageProps } from '../App';
import type { AccountRole, AccountType, GroupAccount } from '../types';
import { suggestMapping } from '../lib/automap';
import { ROLE_LABELS, SECTIONS_BY_TYPE, sortAccounts } from '../lib/coa';
import { signedAmount } from '../lib/consolidate';
import { fmt, lineKey } from '../lib/util';
import { mappingMemory } from './UploadPage';
import { IC_ROLES, autoTagCounterparties } from '../lib/counterparty';

const TYPE_LABEL: Record<AccountType, string> = { asset: 'Assets', liability: 'Liabilities', equity: 'Equity', revenue: 'Income', expense: 'Expenses' };

export function AccountSelect({ accounts, value, onChange, placeholder = '— unmapped —' }: { accounts: GroupAccount[]; value: string; onChange: (v: string) => void; placeholder?: string }) {
  const sorted = sortAccounts(accounts);
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} style={{ borderColor: value ? undefined : 'var(--warn)' }}>
      <option value="">{placeholder}</option>
      {(Object.keys(TYPE_LABEL) as AccountType[]).map((t) => (
        <optgroup key={t} label={TYPE_LABEL[t]}>
          {sorted
            .filter((a) => a.type === t)
            .map((a) => (
              <option key={a.code} value={a.code}>
                {a.code} · {a.name}
              </option>
            ))}
        </optgroup>
      ))}
    </select>
  );
}

export default function MappingPage({ project, update, result, prior, go }: PageProps) {
  const ents = project.entities.filter((e) => e.lines.length);
  const [entId, setEntId] = useState(ents[0]?.id ?? '');
  const [onlyUnmapped, setOnlyUnmapped] = useState(false);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState('');
  const e = project.entities.find((x) => x.id === entId) ?? ents[0];
  const accMap = new Map(project.accounts.map((a) => [a.code, a]));

  const rows = useMemo(() => {
    if (!e) return [];
    const m = new Map<string, { key: string; code: string; name: string; amount: number; prior: number }>();
    for (const l of e.lines) {
      const k = lineKey(l);
      const type = accMap.get(e.mapping[k])?.type;
      const r = m.get(k) ?? { key: k, code: l.code, name: l.name, amount: 0, prior: 0 };
      if ((l.period ?? 'cy') === 'py') r.prior += signedAmount(l.amount, l.sign, type);
      else r.amount += signedAmount(l.amount, l.sign, type);
      m.set(k, r);
    }
    return [...m.values()].sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }) || a.name.localeCompare(b.name));
  }, [e, project.accounts]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!ents.length)
    return (
      <section className="page">
        <h2>Account mapping</h2>
        <div className="empty">Import at least one trial balance first.</div>
      </section>
    );

  const visible = rows.filter((r) => (!onlyUnmapped || !e.mapping[r.key]) && (!q || `${r.code} ${r.name}`.toLowerCase().includes(q.toLowerCase())));
  const setMap = (keys: string[], code: string) =>
    update((d) => {
      const x = d.entities.find((y) => y.id === e.id)!;
      for (const k of keys) {
        if (code) x.mapping[k] = code;
        else delete x.mapping[k];
      }
      autoTagCounterparties(d);
    });
  const setCp = (key: string, cp: string) =>
    update((d) => {
      const x = d.entities.find((y) => y.id === e.id)!;
      x.counterparty = { ...(x.counterparty ?? {}) };
      if (cp) x.counterparty[key] = cp;
      else delete x.counterparty[key];
    });
  const isIc = (code: string) => (IC_ROLES as readonly string[]).includes(accMap.get(code)?.role ?? '');
  const anyIc = rows.some((r) => isIc(e.mapping[r.key] ?? ''));
  const autoMap = (overwrite: boolean) =>
    update((d) => {
      const mem = overwrite ? {} : mappingMemory(d);
      for (const x of d.entities)
        for (const l of x.lines) {
          const k = lineKey(l);
          if (x.mapping[k] && !overwrite) continue;
          const s = suggestMapping(l.code, l.name, d.accounts, mem);
          if (s) x.mapping[k] = s.code;
        }
      autoTagCounterparties(d, overwrite);
    });

  const unmappedTotal = [result, prior].reduce((s, r) => s + (r ? Object.values(r.translation).reduce((x, t) => x + t.unmappedCount, 0) : 0), 0);
  const showPrior = rows.some((r) => r.prior !== 0);

  return (
    <section className="page">
      <div className="page-head">
        <div>
          <h2>Map local accounts to the group chart of accounts</h2>
          <p className="muted">
            Each company keeps its own chart of accounts; map every line to a group account. Suggestions come from account names and code ranges, and anything you map is remembered for other companies with the same
            account name. Intercompany accounts must map to the <b>Intercompany</b> group accounts and name the <b>counterparty</b> company, so balances can be reconciled and eliminated company by company.
          </p>
        </div>
        <div className="row">
          <button className="btn" onClick={() => autoMap(false)}>
            Auto-map unmapped
          </button>
          <button className="btn" onClick={() => confirm('Re-run auto-mapping for all lines? Manual mappings will be overwritten.') && autoMap(true)}>
            Reset all to suggestions
          </button>
          <button className="btn primary" onClick={() => go('adjust')}>
            Next: FX &amp; adjustments →
          </button>
        </div>
      </div>

      <div className="tabs">
        {ents.map((x) => {
          const un = (result.translation[x.id]?.unmappedCount ?? 0) + (prior?.translation[x.id]?.unmappedCount ?? 0);
          return (
            <button key={x.id} className={`tab ${x.id === e.id ? 'active' : ''}`} onClick={() => { setEntId(x.id); setSel(new Set()); }}>
              {x.name} {un ? <span className="badge warn">{un}</span> : <span className="badge ok">✓</span>}
            </button>
          );
        })}
      </div>

      <div className="row">
        <input placeholder="Search code or name…" value={q} onChange={(ev) => setQ(ev.target.value)} style={{ width: 260 }} />
        <label className="check small">
          <input type="checkbox" checked={onlyUnmapped} onChange={(ev) => setOnlyUnmapped(ev.target.checked)} /> Only unmapped
        </label>
        <span className="small muted">
          {rows.length} accounts · {unmappedTotal} unmapped lines across all entities
        </span>
        <div className="grow" />
        {sel.size > 0 && (
          <>
            <span className="small">{sel.size} selected → map to</span>
            <div style={{ width: 280 }}>
              <AccountSelect accounts={project.accounts} value={bulk} onChange={setBulk} placeholder="— choose —" />
            </div>
            <button className="btn sm primary" disabled={!bulk} onClick={() => { setMap([...sel], bulk); setSel(new Set()); }}>
              Apply
            </button>
          </>
        )}
      </div>

      <div className="table-wrap" style={{ maxHeight: '60vh' }}>
        <table>
          <thead>
            <tr>
              <th style={{ width: 30 }}>
                <input type="checkbox" aria-label="Select all" checked={visible.length > 0 && visible.every((r) => sel.has(r.key))} onChange={(ev) => setSel(ev.target.checked ? new Set(visible.map((r) => r.key)) : new Set())} />
              </th>
              <th>Local code</th>
              <th>Local account name</th>
              <th className="num">Current ({e.currency}, Dr+ / Cr−)</th>
              {showPrior && <th className="num">Prior period</th>}
              <th style={{ width: 340 }}>Group account</th>
              {anyIc && <th title="The group company on the other side of an intercompany balance">Counterparty</th>}
              <th>Suggestion</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => {
              const cur = e.mapping[r.key] ?? '';
              const sug = suggestMapping(r.code, r.name, project.accounts);
              return (
                <tr key={r.key}>
                  <td>
                    <input type="checkbox" checked={sel.has(r.key)} onChange={(ev) => { const n = new Set(sel); ev.target.checked ? n.add(r.key) : n.delete(r.key); setSel(n); }} />
                  </td>
                  <td className="small">{r.code}</td>
                  <td>{r.name}</td>
                  <td className="num">{fmt(r.amount, 2)}</td>
                  {showPrior && <td className="num muted">{fmt(r.prior, 2)}</td>}
                  <td>
                    <AccountSelect accounts={project.accounts} value={cur} onChange={(v) => setMap([r.key], v)} />
                  </td>
                  {anyIc && (
                    <td>
                      {isIc(cur) && (
                        <select value={e.counterparty?.[r.key] ?? ''} onChange={(ev) => setCp(r.key, ev.target.value)} style={{ borderColor: e.counterparty?.[r.key] ? undefined : 'var(--warn)' }} aria-label="Counterparty">
                          <option value="">— which company? —</option>
                          {project.entities
                            .filter((x) => x.id !== e.id)
                            .map((x) => (
                              <option key={x.id} value={x.id}>
                                {x.name}
                              </option>
                            ))}
                        </select>
                      )}
                    </td>
                  )}
                  <td className="small">
                    {sug && sug.code !== cur ? (
                      <button className="btn sm" onClick={() => setMap([r.key], sug.code)} title={accMap.get(sug.code)?.name}>
                        {sug.code} {sug.confidence === 'low' ? '(by code range)' : ''}
                      </button>
                    ) : sug ? (
                      <span className={`badge ${sug.confidence === 'high' ? 'ok' : 'warn'}`}>{sug.confidence === 'high' ? 'match' : 'by code range'}</span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <CoaEditor {...{ project, update }} />
    </section>
  );
}

function CoaEditor({ project, update }: Pick<PageProps, 'project' | 'update'>) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<GroupAccount>({ code: '', name: '', type: 'expense', section: 'Operating expenses' });
  const used = new Set(project.entities.flatMap((e) => Object.values(e.mapping)));
  return (
    <div className="card">
      <div className="card-h">
        <h3>Group chart of accounts ({project.accounts.length} accounts)</h3>
        <button className="btn sm" onClick={() => setOpen(!open)}>
          {open ? 'Hide' : 'Edit chart of accounts'}
        </button>
      </div>
      {open && (
        <div className="card-b" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="row">
            <input placeholder="Code" value={draft.code} onChange={(e) => setDraft({ ...draft, code: e.target.value })} style={{ width: 90 }} />
            <input placeholder="Account name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className="grow" />
            <select value={draft.type} onChange={(e) => { const t = e.target.value as AccountType; setDraft({ ...draft, type: t, section: SECTIONS_BY_TYPE[t][0] }); }}>
              {Object.entries(TYPE_LABEL).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
            <select value={draft.section} onChange={(e) => setDraft({ ...draft, section: e.target.value })}>
              {SECTIONS_BY_TYPE[draft.type].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
            <button
              className="btn primary"
              disabled={!draft.code || !draft.name || project.accounts.some((a) => a.code === draft.code)}
              onClick={() => { update((d) => void d.accounts.push({ ...draft })); setDraft({ ...draft, code: '', name: '' }); }}
            >
              Add account
            </button>
          </div>
          <div className="table-wrap" style={{ maxHeight: 400 }}>
            <table>
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Statement section</th>
                  <th>System role</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {sortAccounts(project.accounts).map((a) => (
                  <tr key={a.code}>
                    <td>{a.code}</td>
                    <td>
                      <input value={a.name} onChange={(e) => update((d) => void (d.accounts.find((x) => x.code === a.code)!.name = e.target.value))} style={{ width: '100%' }} />
                    </td>
                    <td className="small">{TYPE_LABEL[a.type]}</td>
                    <td>
                      <select value={a.section} onChange={(e) => update((d) => void (d.accounts.find((x) => x.code === a.code)!.section = e.target.value))}>
                        {SECTIONS_BY_TYPE[a.type].map((s) => (
                          <option key={s}>{s}</option>
                        ))}
                      </select>
                    </td>
                    <td className="small">{a.role ? <span className="badge info">{ROLE_LABELS[a.role as AccountRole]}</span> : ''}</td>
                    <td>
                      {!a.role && (
                        <button
                          className="btn sm ghost danger"
                          disabled={used.has(a.code)}
                          title={used.has(a.code) ? 'In use by a mapping' : 'Delete'}
                          onClick={() => update((d) => void (d.accounts = d.accounts.filter((x) => x.code !== a.code)))}
                        >
                          ✕
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
