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

/** First day of the period (set for year-to-date / part-year reporting; otherwise the 12 months to the period end). */
export function periodStartOf(p: Project, period: Period): string {
  const start = validStart(p.periodStart, p.periodEnd) ?? addDays(shiftYears(p.periodEnd, -1), 1);
  return period === 'cy' ? start : shiftYears(start, -1);
}

/** Number of whole months from start to end (1 Jul – 30 Sep = 3). */
export function periodMonths(start: string, end: string): number {
  const [y1, m1] = start.split('-').map(Number);
  const [y2, m2] = end.split('-').map(Number);
  return (y2 - y1) * 12 + (m2 - m1) + 1;
}

/**
 * A view of the project containing only one period's data, with that period's exchange rates and journals.
 * The consolidation engine itself is period-agnostic and runs on this view.
 */
export function projectForPeriod(p: Project, period: Period): Project {
  return {
    ...p,
    periodEnd: periodEndOf(p, period),
    periodStart: p.periodStart && validStart(p.periodStart, p.periodEnd) ? periodStartOf(p, period) : undefined,
    entities: p.entities.map((e) => ({
      ...e,
      rates: period === 'cy' ? e.rates : e.ratesPrior ?? UNIT,
      lines: e.lines.filter(lineIn(period)),
      sources: e.sources.filter(lineIn(period)),
    })),
    journals: p.journals.filter(lineIn(period)),
    urp: (p.urp ?? []).filter(lineIn(period)),
  };
}

/**
 * Start the next period: current data becomes the comparative, the old comparative is dropped,
 * current-period rates become prior rates (closing rate is a sensible opening historical guess), period end moves one year on.
 */
export function rollForward(p: Project): Project {
  const next = structuredClone(p);
  next.periodEnd = shiftYears(p.periodEnd, 1);
  if (p.periodStart) next.periodStart = shiftYears(p.periodStart, 1);
  for (const e of next.entities) {
    e.lines = e.lines.filter(lineIn('cy')).map((l) => ({ ...l, period: 'py' as const }));
    e.sources = e.sources.filter(lineIn('cy')).map((s) => ({ ...s, period: 'py' as const }));
    e.ratesPrior = { ...e.rates };
  }
  next.journals = p.journals.filter(lineIn('cy')).map((j) => ({ ...j, period: 'py' as const }));
  // URP: this period's entries become comparatives; next period starts from their closing inventory as opening
  const cur = (p.urp ?? []).filter(lineIn('cy'));
  next.urp = [
    ...cur.map((u) => ({ ...u, period: 'py' as const })),
    ...cur.map((u) => ({ ...u, id: `${u.id}_n`, period: 'cy' as const, openingInventory: u.closingInventory, closingInventory: 0 })),
  ];
  return next;
}

const dayNum = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, (m || 1) - 1, d || 1) / 86400000;
};

export function addDays(iso: string, n: number): string {
  return new Date((dayNum(iso) + n) * 86400000).toISOString().slice(0, 10);
}

/** A period start is used only when it falls within the 12 months up to the period end. */
function validStart(start: string | undefined, end: string): string | null {
  if (!start || !/^\d{4}-\d{2}-\d{2}$/.test(start)) return null;
  return start <= end && start > shiftYears(end, -1) ? start : null;
}

/** Whole days from a to b (b - a). */
export function daysBetween(a: string, b: string): number {
  return Math.round(dayNum(b) - dayNum(a));
}

/**
 * The day before the period starts. Periods are the 12 months to the period end unless a period start is given
 * (e.g. year-to-date management accounts: 1 Jul – 30 Sep).
 */
export function openingDate(periodEnd: string, periodStart?: string): string {
  const s = validStart(periodStart, periodEnd);
  return s ? addDays(s, -1) : shiftYears(periodEnd, -1);
}

/** Is the ISO date inside the period (after the opening date, up to and including the period end)? */
export function inPeriod(date: string | undefined, periodEnd: string, opening = openingDate(periodEnd)): boolean {
  return !!date && date > opening && date <= periodEnd;
}

/** Share of the period from `date` (inclusive) to the period end. */
export function fractionFrom(date: string, periodEnd: string, opening = openingDate(periodEnd)): number {
  const total = daysBetween(opening, periodEnd);
  return Math.min(1, Math.max(0, (daysBetween(date, periodEnd) + 1) / total));
}

/** Share of the period from the start up to and including `date`. */
export function fractionTo(date: string, periodEnd: string, opening = openingDate(periodEnd)): number {
  const total = daysBetween(opening, periodEnd);
  return Math.min(1, Math.max(0, daysBetween(opening, date) / total));
}
