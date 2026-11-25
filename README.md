# Group Consolidator

A browser-based tool for consolidating financial statements across a group of companies.

1. **Upload** Excel/CSV trial balances (or BS / P&L reports) exported from each company's accounting system.
2. **Build the group structure**: who owns what percentage of whom (direct, indirect, multiple holders).
3. **Map** each company's local chart of accounts to a group chart of accounts (auto-suggested).
4. **Translate & adjust**: FX rates per entity, automatic intercompany eliminations, manual journals.
5. **Report**: consolidated balance sheet and income statement with comparatives, consolidation worksheet, goodwill & NCI schedule, elimination journals, checks. Export everything to Excel.

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

## Periods and comparatives

Each imported file is tagged as **current** or **prior (comparative)** period. The import dialog guesses this from the file name, for example "prior", "PY" or last year's year. Each entity has its own prior-period exchange rates, and manual journals belong to one period.
The engine consolidates each period on its own, with that period's rates and journals. Statements show both columns, and the worksheet, NCI and journal views switch between periods.
**Roll forward to next period** (Upload page) turns current-period data into the comparatives, drops the old comparatives and moves the period end on one year.

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
| Ownership over time | A holding counts from its acquisition date until its disposal date. Control is assessed at the start and the end of each period, so comparatives use the structure as it was then. |
| Mid-year acquisition | Only post-acquisition results are consolidated, time-apportioned by days. The pre-acquisition part becomes part of the net assets acquired. Tick "TB covers only this part" if the uploaded TB already starts at acquisition. Associates bought mid-year pick up only post-acquisition profit. |
| Loss of control | Results are consolidated up to the disposal date. Net assets, NCI and the whole FCTR are derecognised, and the group gain (proceeds − (net assets − NCI + goodwill) + recycled FCTR) replaces the gain in the holder's books on the "Gain on disposal of subsidiaries" account. |
| Intercompany | Each line mapped to an IC account names its counterparty company. This is auto-suggested from the account name ("Due to Apex Holdings") and can be set on the mapping page. Balances are matched per company pair and direction (X's receivable from Y vs Y's payable to X; X's expense to Y vs Y's revenue from X), and matched amounts are eliminated. Differences stay visible and appear on the Intercompany reconciliation tab and Excel sheet. Lines without a counterparty are matched as one pool, with a warning. |
| Intra-group dividends | Dividends declared by a subsidiary or associate × each group holder's % are removed from the holder's "Dividend income from group companies" (posted at holder level). The NCI's share of a subsidiary's dividend reduces NCI. A warning appears if the receiver's recorded income doesn't match. |
| Unrealised profit (URP) | Per seller/buyer pair: closing inventory × margin (or mark-up / (1 + mark-up)) → Dr cost of sales, Cr inventories. Opening URP is released through opening retained earnings. Posted at the seller, so NCI bears its share of upstream sales. Roll forward carries closing inventory into next period's opening. |
| Manual journals | Free-form balanced journals with templates for dividends, unrealised profit and goodwill impairment. |

Sign convention internally: debit positive, credit negative.

### Drill-down

Click any amount in the balance sheet, income statement (either year) or consolidation worksheet. A panel lists the trial balance lines behind it: company, source file, local account, local amount, exchange rate used and translated amount. It also shows the calculated translation difference and every consolidation entry posted to that account. The panel can be downloaded to Excel. A test checks that every worksheet cell equals the sum of its drill-down.

### Simplifications to be aware of

- One historical rate per entity for all equity lines (opening retained earnings are usually built up year by year).
- Periods are 12 months. Time apportionment is by days.
- Not automated, but flagged with a warning: step acquisitions (remeasuring a previously held interest), partial disposals without loss of control (NCI equity transactions), remeasuring an interest retained after losing control, and disposals of associates.
- Manual journals that affect profit are attributed entirely to owners of the parent.
- URP on fixed-asset transfers and URP with associates need manual journals.

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
