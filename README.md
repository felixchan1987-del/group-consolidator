# Group Consolidator

A browser-based tool for consolidating financial statements across a group of companies.

1. **Upload** Excel/CSV trial balances (or BS / P&L reports) exported from each company's accounting system.
2. **Build the group structure**: who owns what percentage of whom (direct, indirect, multiple holders).
3. **Map** each company's local chart of accounts to a group chart of accounts (auto-suggested).
4. **Translate & adjust**: FX rates per entity, automatic intercompany eliminations, manual journals.
5. **Report**: consolidated balance sheet, income statement, consolidation worksheet, goodwill & NCI schedule, elimination journals, checks. Export everything to Excel.

All processing happens in the browser. No files are sent to a server, and the project autosaves to the browser's local storage. You can save and open the project as a JSON file.

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # consolidation engine & importer tests
npm run build      # static site in dist/ (deploy anywhere: GitHub Pages, Netlify, S3, IIS…)
```

Click **Load sample** in the top bar to load a four-company demo group: a US parent, an 80% subsidiary, a 60% EUR sub-subsidiary (48% effective) and a 30% associate. Or download the sample files on the Upload page to try the importer.

## Supported import layouts

Column detection is automatic: it finds the header row, code/name/debit/credit/balance columns, and combined "1000 · Cash" account cells. Presets add hints for:
Xero, QuickBooks, SAP (S/4HANA, Business One), Oracle NetSuite, Sage, MYOB, Microsoft Dynamics 365, and formatted P&L / balance sheet reports with natural signs.
Any other layout works through manual column selection in the import dialog. Several files per company (e.g. separate BS and P&L) are appended.

## Consolidation logic

| Topic | Approach |
|---|---|
| Control | Votes held by the parent **plus all subsidiaries** > control threshold (default 50%) → full consolidation. Iterates, so sub-subsidiaries and combined holdings are found. Per-entity override available. |
| Significant influence | ≥ 20% (configurable) → equity method; below → investment at cost. |
| Effective interest | Σ (holder's effective interest × holding %) over controlled holders. Fixed-point iteration handles chains and cross-holdings. |
| Goodwill | Per holding: holder's effective interest × (cost − holding % × net assets at acquisition). Proportionate-share (partial goodwill) method. A negative amount (bargain purchase) is credited to retained earnings and flagged. |
| NCI | (1 − effective interest) × subsidiary's equity − indirect NCI share of the intermediate holder's investment cost; plus NCI share of profit. |
| Equity method | Holder's share of the associate's post-acquisition reserves goes to retained earnings, and its share of profit to "Share of profit of associates", both posted at holder level so the holder's NCI shares in them. |
| FX translation | Assets/liabilities at the closing rate, income/expenses at the average rate, equity at the historical rate. The difference goes to the FCTR, and NCI takes its share. |
| Intercompany | Balances mapped to IC receivable/payable and IC revenue/expense are eliminated up to the matched amount. Mismatches stay visible and are reported. |
| Manual journals | Free-form balanced journals with templates for dividends, unrealised profit and goodwill impairment. |

Sign convention internally: debit positive, credit negative.

### Simplifications to be aware of

- One historical rate per entity for all equity lines (opening retained earnings are usually built up year by year).
- Acquisitions are treated as happening before the current period (no mid-year acquisition or disposal, no step acquisitions).
- Manual journals that affect profit are attributed entirely to owners of the parent.
- Intercompany dividends and unrealised profit need manual journals.

## Project structure

```
src/
  lib/
    consolidate.ts   consolidation engine (translation, equity method, eliminations, NCI)
    structure.ts     control / influence / effective interest analysis
    importer.ts      Excel parsing, header & column detection, system presets
    automap.ts       chart-of-accounts mapping suggestions
    statements.ts    balance sheet & income statement layout
    exportXlsx.ts    Excel export
    sample.ts        sample group + sample files in Xero/QuickBooks/SAP/generic layouts
  components/        one page per step + org chart + import dialog
```

## Note on the `xlsx` dependency

npm only has SheetJS up to 0.18.5, which has known advisories for crafted files. Because files are parsed locally from the user's own exports the risk is low, but for production use install the maintained build:
`npm i https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`.

## Roadmap / options

See the options list in the project discussion. Highlights: multi-period and comparatives, cash-flow statement, statement of changes in equity, full-goodwill (fair value NCI) method, mid-year acquisitions and disposals, per-counterparty intercompany reconciliation, AI-assisted account mapping, a backend with user accounts and audit trail, PDF/Word report packs, and direct API connectors to Xero/QuickBooks/NetSuite.
