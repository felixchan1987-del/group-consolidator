import type { FxRates, Period, Project } from '../types';

export const PERIOD_LABEL: Record<Period, string> = { cy: 'Current period', py: 'Prior period' };

const UNIT: FxRates = { closing: 1, average: 1, historical: 1 };

/** Same calendar date n years later/earlier (29 Feb -> 28 Feb). */
export function shiftYears(isoDate: string, n: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  if (!y || !m || !d) return isoDate;
  const last = new Date(Date.UTC(y + n, m, 0)).getUTCDate();
  return `${y + n}-${String(m).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

export const lineIn = (period: Period) => (x: { period?: Period }) => (x.period ?? 'cy') === period;

export function hasPrior(p: Project): boolean {
  return p.entities.some((e) => e.lines.some(lineIn('py')));
}

export function periodEndOf(p: Project, period: Period): string {
  return period === 'cy' ? p.periodEnd : shiftYears(p.periodEnd, -1);
}

/**
 * A view of the project containing only one period's data, with that period's exchange rates and journals.
 * The consolidation engine itself is period-agnostic and runs on this view.
 */
export function projectForPeriod(p: Project, period: Period): Project {
  return {
    ...p,
    periodEnd: periodEndOf(p, period),
    entities: p.entities.map((e) => ({
      ...e,
      rates: period === 'cy' ? e.rates : e.ratesPrior ?? UNIT,
      lines: e.lines.filter(lineIn(period)),
      sources: e.sources.filter(lineIn(period)),
    })),
    journals: p.journals.filter(lineIn(period)),
  };
}

/**
 * Start the next period: current data becomes the comparative, the old comparative is dropped,
 * current-period rates become prior rates (closing rate is a sensible opening historical guess), period end moves one year on.
 */
export function rollForward(p: Project): Project {
  const next = structuredClone(p);
  next.periodEnd = shiftYears(p.periodEnd, 1);
  for (const e of next.entities) {
    e.lines = e.lines.filter(lineIn('cy')).map((l) => ({ ...l, period: 'py' as const }));
    e.sources = e.sources.filter(lineIn('cy')).map((s) => ({ ...s, period: 'py' as const }));
    e.ratesPrior = { ...e.rates };
  }
  next.journals = p.journals.filter(lineIn('cy')).map((j) => ({ ...j, period: 'py' as const }));
  return next;
}
