/** cy = current period, py = prior (comparative) period */
export type Period = 'cy' | 'py';

export type AccountType ='asset' | 'liability' | 'equity' | 'revenue' | 'expense';

/** Special roles the consolidation engine relies on. */
export type AccountRole =
  | 'goodwill'
  | 'inv_sub'
  | 'inv_assoc'
  | 'retained'
  | 'fctr'
  | 'nci'
  | 'share_assoc'
  | 'ic_rec'
  | 'ic_pay'
  | 'ic_rev'
  | 'ic_exp';

export interface GroupAccount {
  code: string;
  name: string;
  type: AccountType;
  section: string;
  role?: AccountRole;
}

/**
 * How the imported amount should be read:
 *  - dr: debit positive / credit negative (standard trial balance)
 *  - cr: credit positive / debit negative
 *  - natural: amounts shown with their "natural" sign (e.g. a P&L report where revenue and expenses are both positive);
 *    the sign is resolved from the mapped group account type.
 */
export type SignMode = 'dr' | 'cr' | 'natural';

export interface TBLine {
  id: string;
  code: string;
  name: string;
  amount: number;
  sign: SignMode;
  sourceId: string;
  /** defaults to 'cy' */
  period?: Period;
}

export interface SourceFile {
  id: string;
  fileName: string;
  sheet: string;
  system: string;
  importedAt: string;
  lineCount: number;
  period?: Period;
}

export type MethodOverride = 'auto' | 'full' | 'equity' | 'investment' | 'exclude';

export interface FxRates {
  /** 1 unit of functional currency = X units of presentation currency */
  closing: number;
  average: number;
  historical: number;
}

export interface Entity {
  id: string;
  name: string;
  code: string;
  currency: string;
  country: string;
  method: MethodOverride;
  rates: FxRates;
  /** rates for the comparative period */
  ratesPrior?: FxRates;
  lines: TBLine[];
  sources: SourceFile[];
  /** local account key -> group account code */
  mapping: Record<string, string>;
}

export interface Holding {
  id: string;
  holderId: string;
  investeeId: string;
  /** percentage 0-100 */
  pct: number;
  /** cost of investment in presentation currency */
  cost: number;
  /** investee net assets (fair value) at acquisition, presentation currency. null = same as opening equity this period */
  acqEquity: number | null;
  acqDate: string;
}

export interface JournalLine {
  account: string;
  debit: number;
  credit: number;
}

export interface ManualJournal {
  id: string;
  description: string;
  lines: JournalLine[];
  period?: Period;
}

export interface Project {
  version: 1;
  name: string;
  periodEnd: string;
  presentationCurrency: string;
  parentId: string | null;
  entities: Entity[];
  holdings: Holding[];
  accounts: GroupAccount[];
  journals: ManualJournal[];
  settings: {
    autoEliminateIC: boolean;
    controlThreshold: number;
    influenceThreshold: number;
  };
}
