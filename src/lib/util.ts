import type { Entity, Project, TBLine } from '../types';
import { DEFAULT_ACCOUNTS } from './coa';

export function uid(prefix = 'id'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}

export const lineKey = (l: Pick<TBLine, 'code' | 'name'>) => `${(l.code || '').trim()}|${l.name.trim().toLowerCase()}`;

/** Parses numbers like "1,234.50", "(1,234.50)", "-1234", "1 234,50", "$1,234", "1,234.50 Cr" */
export function parseAmount(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v).trim();
  if (!s) return null;
  let sign = 1;
  if (/^\(.*\)$/.test(s)) {
    sign = -1;
    s = s.slice(1, -1);
  }
  if (/\s*cr\.?$/i.test(s)) {
    sign *= -1;
    s = s.replace(/\s*cr\.?$/i, '');
  } else s = s.replace(/\s*dr\.?$/i, '');
  if (s.endsWith('-')) {
    sign *= -1;
    s = s.slice(0, -1);
  }
  s = s.replace(/[^\d.,\-]/g, '');
  if (!s || s === '-' || s === '.') return null;
  // European format 1.234,56
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s) || /^-?\d+,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n * sign : null;
}

export function fmt(n: number, decimals = 0): string {
  if (!Number.isFinite(n)) return '–';
  const abs = Math.abs(n);
  if (abs < 0.5 * Math.pow(10, -decimals)) return '–';
  const s = abs.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return n < 0 ? `(${s})` : s;
}

export const pct = (f: number) => `${(f * 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;

export const round2 = (n: number) => Math.round(n * 100) / 100;

export function newEntity(name: string, currency: string): Entity {
  return {
    id: uid('ent'),
    name,
    code: name
      .replace(/[^A-Za-z0-9 ]/g, '')
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w[0])
      .join('')
      .toUpperCase()
      .slice(0, 5),
    currency,
    country: '',
    method: 'auto',
    rates: { closing: 1, average: 1, historical: 1 },
    lines: [],
    sources: [],
    mapping: {},
  };
}

export function emptyProject(): Project {
  return {
    version: 1,
    name: 'My Group',
    periodEnd: new Date().toISOString().slice(0, 10),
    presentationCurrency: 'USD',
    parentId: null,
    entities: [],
    holdings: [],
    accounts: DEFAULT_ACCOUNTS.map((a) => ({ ...a })),
    journals: [],
    settings: { autoEliminateIC: true, controlThreshold: 50, influenceThreshold: 20 },
  };
}

export const CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'CNY', 'HKD', 'SGD', 'AUD', 'NZD', 'CAD', 'CHF', 'SEK', 'NOK', 'DKK', 'INR', 'MYR', 'THB', 'IDR', 'PHP', 'VND', 'KRW', 'TWD', 'AED', 'SAR', 'ZAR', 'BRL', 'MXN'];
