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

const dayNum = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, (m || 1) - 1, d || 1) / 86400000;
};

/** Whole days from a to b (b - a). */
export function daysBetween(a: string, b: string): number {
  return Math.round(dayNum(b) - dayNum(a));
}

/** The day before the period starts, i.e. the previous period end (periods are 12 months). */
export function openingDate(periodEnd: string): string {
  return shiftYears(periodEnd, -1);
}

/** Is the ISO date inside the period (after the opening date, up to and including the period end)? */
export function inPeriod(date: string | undefined, periodEnd: string): boolean {
  return !!date && date > openingDate(periodEnd) && date <= periodEnd;
}

/** Share of the period from `date` (inclusive) to the period end. */
export function fractionFrom(date: string, periodEnd: string): number {
  const total = daysBetween(openingDate(periodEnd), periodEnd);
  return Math.min(1, Math.max(0, (daysBetween(date, periodEnd) + 1) / total));
}

/** Share of the period from the start up to and including `date`. */
export function fractionTo(date: string, periodEnd: string): number {
  const total = daysBetween(openingDate(periodEnd), periodEnd);
  return Math.min(1, Math.max(0, daysBetween(openingDate(periodEnd), date) / total));
}
