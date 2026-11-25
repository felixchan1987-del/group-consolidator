import { useCallback, useEffect, useRef, useState } from 'react';
import type { Project } from '../types';
import { emptyProject, migrateProject } from './util';

const KEY = 'group-consolidator:project:v1';

function load(): Project {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw) as Project;
      if (p && p.version === 1) return migrateProject(p);
    }
  } catch {
    /* storage unavailable */
  }
  return emptyProject();
}

export function useProject() {
  const [project, setProject] = useState<Project>(load);
  const timer = useRef<number>();
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  useEffect(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      try {
        localStorage.setItem(KEY, JSON.stringify(project));
        setSavedAt(new Date());
      } catch {
        setSavedAt(null);
      }
    }, 400);
  }, [project]);

  /** Immutable update via a mutating recipe on a deep copy. */
  const update = useCallback((recipe: (draft: Project) => void) => {
    setProject((prev) => {
      const next = structuredClone(prev);
      recipe(next);
      return next;
    });
  }, []);

  return { project, setProject, update, savedAt };
}

export function downloadJson(p: Project) {
  const blob = new Blob([JSON.stringify(p, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${p.name.replace(/[^\w\- ]/g, '')}.consolidation.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}
