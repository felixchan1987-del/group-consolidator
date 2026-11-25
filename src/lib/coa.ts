import type { AccountType, GroupAccount } from '../types';

export const BS_SECTIONS = ['Non-current assets', 'Current assets', 'Current liabilities', 'Non-current liabilities', 'Equity'] as const;
export const PL_SECTIONS = [
  'Revenue',
  'Cost of sales',
  'Other income',
  'Operating expenses',
  'Finance income',
  'Finance costs',
  'Share of associates',
  'Income tax',
] as const;

export const SECTIONS_BY_TYPE: Record<AccountType, string[]> = {
  asset: ['Non-current assets', 'Current assets'],
  liability: ['Current liabilities', 'Non-current liabilities'],
  equity: ['Equity'],
  revenue: ['Revenue', 'Other income', 'Finance income', 'Share of associates'],
  expense: ['Cost of sales', 'Operating expenses', 'Finance costs', 'Income tax'],
};

export const DEFAULT_ACCOUNTS: GroupAccount[] = [
  { code: '1000', name: 'Cash and cash equivalents', type: 'asset', section: 'Current assets' },
  { code: '1100', name: 'Trade receivables', type: 'asset', section: 'Current assets' },
  { code: '1150', name: 'Intercompany receivables', type: 'asset', section: 'Current assets', role: 'ic_rec' },
  { code: '1200', name: 'Inventories', type: 'asset', section: 'Current assets' },
  { code: '1300', name: 'Prepayments and other current assets', type: 'asset', section: 'Current assets' },
  { code: '1500', name: 'Property, plant and equipment', type: 'asset', section: 'Non-current assets' },
  { code: '1600', name: 'Intangible assets', type: 'asset', section: 'Non-current assets' },
  { code: '1650', name: 'Goodwill', type: 'asset', section: 'Non-current assets', role: 'goodwill' },
  { code: '1700', name: 'Investments in subsidiaries', type: 'asset', section: 'Non-current assets', role: 'inv_sub' },
  { code: '1710', name: 'Investments in associates', type: 'asset', section: 'Non-current assets', role: 'inv_assoc' },
  { code: '1720', name: 'Other investments', type: 'asset', section: 'Non-current assets' },
  { code: '1800', name: 'Other non-current assets', type: 'asset', section: 'Non-current assets' },
  { code: '2000', name: 'Trade payables', type: 'liability', section: 'Current liabilities' },
  { code: '2050', name: 'Intercompany payables', type: 'liability', section: 'Current liabilities', role: 'ic_pay' },
  { code: '2100', name: 'Accruals and other payables', type: 'liability', section: 'Current liabilities' },
  { code: '2200', name: 'Short-term borrowings', type: 'liability', section: 'Current liabilities' },
  { code: '2300', name: 'Current tax payable', type: 'liability', section: 'Current liabilities' },
  { code: '2500', name: 'Long-term borrowings', type: 'liability', section: 'Non-current liabilities' },
  { code: '2600', name: 'Deferred tax liabilities', type: 'liability', section: 'Non-current liabilities' },
  { code: '2700', name: 'Other non-current liabilities', type: 'liability', section: 'Non-current liabilities' },
  { code: '3000', name: 'Share capital', type: 'equity', section: 'Equity' },
  { code: '3100', name: 'Share premium and other reserves', type: 'equity', section: 'Equity' },
  { code: '3200', name: 'Retained earnings', type: 'equity', section: 'Equity', role: 'retained' },
  { code: '3300', name: 'Foreign currency translation reserve', type: 'equity', section: 'Equity', role: 'fctr' },
  { code: '3900', name: 'Non-controlling interests', type: 'equity', section: 'Equity', role: 'nci' },
  { code: '4000', name: 'Revenue', type: 'revenue', section: 'Revenue' },
  { code: '4050', name: 'Intercompany revenue', type: 'revenue', section: 'Revenue', role: 'ic_rev' },
  { code: '4100', name: 'Other income', type: 'revenue', section: 'Other income' },
  { code: '4200', name: 'Share of profit of associates', type: 'revenue', section: 'Share of associates', role: 'share_assoc' },
  { code: '4300', name: 'Finance income', type: 'revenue', section: 'Finance income' },
  { code: '5000', name: 'Cost of sales', type: 'expense', section: 'Cost of sales' },
  { code: '5050', name: 'Intercompany expenses', type: 'expense', section: 'Operating expenses', role: 'ic_exp' },
  { code: '5100', name: 'Employee benefits expense', type: 'expense', section: 'Operating expenses' },
  { code: '5200', name: 'Depreciation and amortisation', type: 'expense', section: 'Operating expenses' },
  { code: '5300', name: 'Other operating expenses', type: 'expense', section: 'Operating expenses' },
  { code: '5400', name: 'Finance costs', type: 'expense', section: 'Finance costs' },
  { code: '5500', name: 'Income tax expense', type: 'expense', section: 'Income tax' },
];

export const ROLE_LABELS: Record<string, string> = {
  goodwill: 'Goodwill',
  inv_sub: 'Investment in subsidiaries',
  inv_assoc: 'Investment in associates',
  retained: 'Retained earnings',
  fctr: 'FX translation reserve',
  nci: 'Non-controlling interests',
  share_assoc: 'Share of associates profit',
  ic_rec: 'Intercompany receivable',
  ic_pay: 'Intercompany payable',
  ic_rev: 'Intercompany revenue',
  ic_exp: 'Intercompany expense',
};

export function accountByRole(accounts: GroupAccount[], role: string): GroupAccount | undefined {
  return accounts.find((a) => a.role === role);
}

export function sortAccounts(accounts: GroupAccount[]): GroupAccount[] {
  return [...accounts].sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
}
