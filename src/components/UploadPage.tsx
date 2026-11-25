import { useRef, useState } from 'react';
import type { PageProps } from '../App';
import type { Project, SourceFile, TBLine } from '../types';
import ImportDialog, { type ImportTarget } from './ImportDialog';
import { readWorkbook, type ParsedSheet } from '../lib/importer';
import { suggestMapping } from '../lib/automap';
import { SAMPLE, downloadSampleFile, downloadTemplate } from '../lib/sample';
import { CURRENCIES, fmt, lineKey, newEntity } from '../lib/util';
import { METHOD_SHORT } from '../lib/structure';

interface Pending {
  fileName: string;
  sheets: ParsedSheet[];
}

export function mappingMemory(p: Project): Record<string, string> {
  const mem: Record<string, string> = {};
  for (const e of p.entities)
    for (const l of e.lines) {
      const c = e.mapping[lineKey(l)];
      if (c) mem[l.name.toLowerCase().replace(/[_·•]/g, ' ').replace(/\s+/g, ' ').trim()] = c;
    }
  return mem;
}

export default function UploadPage({ project, update, result, go }: PageProps) {
  const [queue, setQueue] = useState<Pending[]>([]);
  const [over, setOver] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = async (files: FileList | File[]) => {
    const pend: Pending[] = [];
    const errs: string[] = [];
    for (const f of Array.from(files)) {
      try {
        pend.push({ fileName: f.name, sheets: readWorkbook(await f.arrayBuffer()) });
      } catch (e) {
        errs.push(`${f.name}: ${(e as Error).message}`);
      }
    }
    setErrors(errs);
    setTotal(pend.length);
    setQueue((q) => [...q, ...pend]);
  };

  const onImport = (t: ImportTarget, lines: TBLine[], src: SourceFile) => {
    update((d) => {
      let e = t.entityId ? d.entities.find((x) => x.id === t.entityId) : undefined;
      if (!e) {
        e = newEntity(t.newName, t.currency);
        d.entities.push(e);
        if (!d.parentId) d.parentId = e.id;
      }
      if (t.replace) {
        e.lines = [];
        e.sources = [];
      }
      e.lines.push(...lines);
      e.sources.push(src);
      const mem = mappingMemory(d);
      for (const l of lines) {
        const k = lineKey(l);
        if (e.mapping[k]) continue;
        const s = suggestMapping(l.code, l.name, d.accounts, mem);
        if (s) e.mapping[k] = s.code;
      }
    });
    setQueue((q) => q.slice(1));
  };

  const current = queue[0];

  return (
    <section className="page">
      <div className="page-head">
        <div>
          <h2>Upload financial reports</h2>
          <p className="muted">
            Drop the trial balances (or balance sheet / P&amp;L exports) from each company's accounting system — Xero, QuickBooks, SAP, NetSuite, Sage, MYOB, Dynamics or any Excel/CSV layout.
            Columns are detected automatically and accounts are auto-mapped to the group chart of accounts.
          </p>
        </div>
        <div className="row">
          <button className="btn" onClick={downloadTemplate}>
            Download blank template
          </button>
          {project.entities.length > 0 && (
            <button className="btn primary" onClick={() => go('structure')}>
              Next: group structure →
            </button>
          )}
        </div>
      </div>

      <div
        className={`dropzone ${over ? 'over' : ''}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          handleFiles(e.dataTransfer.files);
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && inputRef.current?.click()}
      >
        <div className="icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 16V4M7 9l5-5 5 5M4 20h16" />
          </svg>
        </div>
        <b>Drop Excel or CSV files here, or click to browse</b>
        <span className="small muted">.xlsx, .xls, .xlsm, .csv, .ods — one or many files, one company per file (or several files per company)</span>
        <input ref={inputRef} type="file" multiple hidden accept=".xlsx,.xls,.xlsm,.csv,.ods" onChange={(e) => e.target.files && handleFiles(e.target.files)} />
      </div>
      {errors.map((e) => (
        <div key={e} className="callout err small">
          {e}
        </div>
      ))}

      {project.entities.length === 0 ? (
        <div className="card">
          <div className="card-h">
            <h3>No files yet? Try the sample group</h3>
          </div>
          <div className="card-b" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <p className="small muted">
              Four companies exported from different systems: a US parent (Xero), an 80% US subsidiary (QuickBooks), a 60% German sub-subsidiary in EUR (SAP) and a 30% associate (generic). Download them to try the
              importer, or use <b>Load sample</b> in the top bar to load the whole group instantly.
            </p>
            <div className="row">
              {SAMPLE.map((s) => (
                <button key={s.code} className="btn sm" onClick={() => downloadSampleFile(s)}>
                  ⬇ {s.name} ({s.system})
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="grid cols-3">
          {project.entities.map((e) => {
            const t = result.translation[e.id];
            const method = result.structure.method[e.id];
            return (
              <div key={e.id} className="card entity-card">
                <div className="card-h">
                  <h3>
                    {e.name} <span className={`badge m-${method}`}>{METHOD_SHORT[method]}</span>
                  </h3>
                  <button
                    className="btn sm ghost danger"
                    onClick={() =>
                      confirm(`Remove ${e.name} and its holdings?`) &&
                      update((d) => {
                        d.entities = d.entities.filter((x) => x.id !== e.id);
                        d.holdings = d.holdings.filter((h) => h.holderId !== e.id && h.investeeId !== e.id);
                        if (d.parentId === e.id) d.parentId = d.entities[0]?.id ?? null;
                      })
                    }
                  >
                    Remove
                  </button>
                </div>
                <div className="card-b" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div className="row">
                    <label className="field grow">
                      Name
                      <input value={e.name} onChange={(ev) => update((d) => void (d.entities.find((x) => x.id === e.id)!.name = ev.target.value))} />
                    </label>
                    <label className="field" style={{ width: 80 }}>
                      Code
                      <input value={e.code} onChange={(ev) => update((d) => void (d.entities.find((x) => x.id === e.id)!.code = ev.target.value))} />
                    </label>
                    <label className="field" style={{ width: 90 }}>
                      Currency
                      <select value={e.currency} onChange={(ev) => update((d) => void (d.entities.find((x) => x.id === e.id)!.currency = ev.target.value))}>
                        {[...new Set([e.currency, ...CURRENCIES])].map((c) => (
                          <option key={c}>{c}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <dl className="kv">
                    <dt>Lines</dt>
                    <dd>{e.lines.length}</dd>
                    <dt>Trial balance</dt>
                    <dd>
                      {!e.lines.length ? (
                        <span className="badge warn">empty</span>
                      ) : Math.abs(t.localSum) < 0.5 ? (
                        <span className="badge ok">Balanced</span>
                      ) : (
                        <span className="badge err">
                          Off by {fmt(t.localSum, 2)} {e.currency}
                        </span>
                      )}
                    </dd>
                    <dt>Mapping</dt>
                    <dd>{t.unmappedCount ? <span className="badge warn">{t.unmappedCount} unmapped</span> : e.lines.length ? <span className="badge ok">Complete</span> : '–'}</dd>
                  </dl>
                  <ul className="src-list">
                    {e.sources.map((s) => (
                      <li key={s.id}>
                        <span title={`Sheet: ${s.sheet} · ${new Date(s.importedAt).toLocaleString()}`}>
                          📄 {s.fileName} <span className="muted small">· {s.system} · {s.lineCount} lines</span>
                        </span>
                        <button
                          className="btn sm ghost"
                          title="Remove this file's lines"
                          onClick={() =>
                            update((d) => {
                              const x = d.entities.find((y) => y.id === e.id)!;
                              x.lines = x.lines.filter((l) => l.sourceId !== s.id);
                              x.sources = x.sources.filter((y) => y.id !== s.id);
                            })
                          }
                        >
                          ✕
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            );
          })}
          <button className="card empty" style={{ cursor: 'pointer', background: 'none' }} onClick={() => update((d) => void d.entities.push(newEntity('New entity', d.presentationCurrency)))}>
            + Add an entity without a file
            <div className="small">e.g. a holding company or an associate you only hold a percentage in</div>
          </button>
        </div>
      )}

      {current && (
        <ImportDialog
          key={current.fileName + queue.length}
          fileName={current.fileName}
          sheets={current.sheets}
          project={project}
          queueInfo={total > 1 ? `File ${total - queue.length + 1} of ${total}` : 'Check the detected columns, then import'}
          onImport={onImport}
          onSkip={() => setQueue((q) => q.slice(1))}
        />
      )}
    </section>
  );
}
