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
  | 'ic_exp'
  | 'disposal_gain'
  | 'div_paid'
  | 'ic_div'
  | 'cogs'
  | 'inventory';

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
  /**
   * When an entity joins or leaves the group during the period: true if its trial balance already covers only the
   * time it was in the group (e.g. a TB at the disposal date). false/undefined = full-period TB, results are time-apportioned.
   */
  partialPeriodTB?: boolean;
  /** local account key -> counterparty entity id, for lines mapped to intercompany accounts */
  counterparty?: Record<string, string>;
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
  /** date the holding was sold; empty = still held */
  disposalDate?: string;
  /** sale proceeds in presentation currency */
  proceeds?: number;
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

/** Unrealised profit on goods sold within the group and still held by the buyer. */
export interface UrpEntry {
  id: string;
  sellerId: string;
  buyerId: string;
  description: string;
  /** buyer's inventory bought from the seller, at transfer price (presentation currency) */
  closingInventory: number;
  /** same at the start of the period (reverses last period's URP) */
  openingInventory: number;
  /** seller's profit percentage */
  rate: number;
  /** rate is a gross margin on the selling price, or a mark-up on cost */
  basis: 'margin' | 'markup';
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
  urp?: UrpEntry[];
  settings: {
    autoEliminateIC: boolean;
    autoEliminateDividends?: boolean;
    controlThreshold: number;
    influenceThreshold: number;
  };
}
