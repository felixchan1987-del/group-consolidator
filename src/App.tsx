import { useMemo, useRef, useState } from 'react';
import type { Project } from './types';
import { consolidate, type ConsolidationResult } from './lib/consolidate';
import { downloadJson, useProject } from './lib/store';
import { buildSampleProject } from './lib/sample';
import { CURRENCIES, emptyProject, migrateProject } from './lib/util';
import { addDays, hasPrior, periodStartOf, projectForPeriod, shiftYears } from './lib/periods';
import UploadPage from './components/UploadPage';
import StructurePage from './components/StructurePage';
import MappingPage from './components/MappingPage';
import AdjustmentsPage from './components/AdjustmentsPage';
import ReportsPage from './components/ReportsPage';

export interface PageProps {
  project: Project;
  update: (recipe: (d: Project) => void) => void;
  /** current period */
  result: ConsolidationResult;
  /** comparative period, when prior-period data has been imported */
  prior: ConsolidationResult | null;
  go: (step: Step) => void;
}

export type Step = 'upload' | 'structure' | 'mapping' | 'adjust' | 'reports';

const STEPS: { id: Step; label: string }[] = [
  { id: 'upload', label: 'Upload reports' },
  { id: 'structure', label: 'Group structure' },
  { id: 'mapping', label: 'Account mapping' },
  { id: 'adjust', label: 'FX & adjustments' },
  { id: 'reports', label: 'Consolidated reports' },
];

export default function App() {
  const { project, setProject, update, savedAt } = useProject();
  const [step, setStep] = useState<Step>('upload');
  const result = useMemo(() => consolidate(projectForPeriod(project, 'cy')), [project]);
  const prior = useMemo(() => (hasPrior(project) ? consolidate(projectForPeriod(project, 'py')) : null), [project]);
  const fileRef = useRef<HTMLInputElement>(null);

  const status = (s: Step) => {
    const ents = project.entities.length;
    switch (s) {
      case 'upload':
        return ents ? <span className="badge info">{ents}</span> : null;
      case 'structure':
        return project.parentId ? <span className="badge ok">✓</span> : ents ? <span className="badge warn">!</span> : null;
      case 'mapping': {
        const un = [result, prior].reduce((s, r) => s + (r ? Object.values(r.translation).reduce((x, t) => x + t.unmappedCount, 0) : 0), 0);
        return ents ? un ? <span className="badge warn">{un}</span> : <span className="badge ok">✓</span> : null;
      }
      case 'reports': {
        const errs = result.checks.filter((c) => c.level === 'error').length + (prior?.checks.filter((c) => c.level === 'error').length ?? 0);
        return ents ? errs ? <span className="badge err">{errs}</span> : <span className="badge ok">✓</span> : null;
      }
    }
    return null;
  };

  const importJson = async (f: File) => {
    try {
      const p = JSON.parse(await f.text()) as Project;
      if (p.version !== 1 || !Array.isArray(p.entities)) throw new Error('Not a consolidation project file');
      setProject(migrateProject(p));
    } catch (e) {
      alert(`Could not open project: ${(e as Error).message}`);
    }
  };

  const props: PageProps = { project, update, result, prior, go: setStep };

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">
            <svg width="16" height="16" viewBox="0 0 32 32" fill="#fff" aria-hidden>
              <path d="M4 26V12h6v14zm9 0V4h6v22zm9 0V16h6v10z" />
            </svg>
          </div>
          Group Consolidator
        </div>
        <div className="project-meta">
          <input aria-label="Group name" value={project.name} onChange={(e) => update((d) => void (d.name = e.target.value))} style={{ width: 180 }} />
          <label className="row small muted" title="Reporting period. The start defaults to 12 months before the period end; set it for year-to-date reporting (e.g. 1 Jul – 30 Sep).">
            Period
            <input
              type="date"
              aria-label="Period start"
              value={periodStartOf(project, 'cy')}
              max={project.periodEnd}
              onChange={(e) =>
                update((d) => {
                  const v = e.target.value;
                  if (!v || v === addDays(shiftYears(d.periodEnd, -1), 1)) delete d.periodStart;
                  else d.periodStart = v;
                })
              }
            />
            to
            <input type="date" aria-label="Period end" value={project.periodEnd} onChange={(e) => update((d) => void (d.periodEnd = e.target.value))} />
          </label>
          <label className="row small muted">
            Presentation
            <select value={project.presentationCurrency} onChange={(e) => update((d) => void (d.presentationCurrency = e.target.value))}>
              {[...new Set([project.presentationCurrency, ...CURRENCIES])].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <button className="btn sm" onClick={() => downloadJson(project)} title="Save the whole project as a JSON file">
            Save project
          </button>
          <button className="btn sm" onClick={() => fileRef.current?.click()}>
            Open project
          </button>
          <input ref={fileRef} type="file" accept=".json" hidden onChange={(e) => e.target.files?.[0] && importJson(e.target.files[0])} />
          <button
            className="btn sm"
            onClick={() => {
              if (!project.entities.length || confirm('Replace the current project with the sample group?')) {
                setProject(buildSampleProject());
                setStep('structure');
              }
            }}
          >
            Load sample
          </button>
          <button className="btn sm danger" onClick={() => confirm('Clear all data and start a new project?') && setProject(emptyProject())}>
            New
          </button>
          <span className="small muted" title="Saved in this browser only">
            {savedAt ? `Saved locally ${savedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}
          </span>
        </div>
      </header>
      <nav className="steps">
        {STEPS.map((s, i) => (
          <button key={s.id} className={`step ${step === s.id ? 'active' : ''}`} onClick={() => setStep(s.id)}>
            <span className="n">{i + 1}</span>
            {s.label}
            {status(s.id)}
          </button>
        ))}
      </nav>
      <main className="main">
        {step === 'upload' && <UploadPage {...props} />}
        {step === 'structure' && <StructurePage {...props} />}
        {step === 'mapping' && <MappingPage {...props} />}
        {step === 'adjust' && <AdjustmentsPage {...props} />}
        {step === 'reports' && <ReportsPage {...props} />}
      </main>
    </>
  );
}
