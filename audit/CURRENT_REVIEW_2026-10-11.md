# AgriSys current-code review — 11 October 2026

**Follow-up:** the nine findings below are the original review baseline and have now been fixed. See [the fix report](FOLLOWUP_FIX_REPORT_2026-10-11.md). The reproduction script now asserts correct behavior.

Reviewed the current local working tree, including the existing uncommitted fixes, rather than treating the previous BUG_REPORT as current. Application code was not changed. This review adds an isolated reproduction script and this report.

**Result: nine remaining defects reproduced.** Existing regression suite: 30/30 pass; 25 application and five vendor modules parse; no missing local script references, duplicate HTML IDs, or unresolved direct HTML handlers in that suite. These checks do not establish accounting correctness.

Run `node audit/followup-review.cjs`. In this diagnostic script, PASS means the defect was reproduced. It uses the existing in-memory test harness, not the user's IndexedDB. The concurrency example demonstrates a permitted read/write interleaving with mocked storage; it has not been exercised in two real browser tabs. No real business records or live browser profiles were inspected, and the browser smoke test was not rerun in this review.

## Confirmed accounting defects

### 1. P1 — Opening equity is missing from the balance sheet

Location: [reports.js:307](../js/reports.js#L307), with opening journal entries in [bookkeeping.js:49](../js/bookkeeping.js#L49).

Reproduction: create a cash account with PKR 100 opening balance and no transactions. The balance sheet reports assets of 100 and total liabilities/equity of zero. The journal correctly credits Opening Equity, but the balance-sheet calculation includes only capital entries, partner transactions, and computed retained earnings. Opening stock and party opening balances also need their equity counterparts carried into the report.

Repair: include net opening equity using one opening-balance model shared with the journal; expose an assets minus liabilities minus equity reconciliation, and verify both screen and exports.

### 2. P1 — Mandi-tax payable is absent from balance-sheet liabilities

Location: [reports.js:288](../js/reports.js#L288), compared with purchase tax postings in [bookkeeping.js:148](../js/bookkeeping.js#L148).

Reproduction: purchase inventory costing PKR 100, deduct PKR 10 mandi tax, leave farmer payable at 90. The journal posts the tax liability; the balance sheet reports inventory 100 and liabilities only 90. It has no mandi-tax liability component. This is an internal inconsistency regardless of the legally applicable rate.

Repair: carry tax withheld less tax remitted as a distinct liability. Add tax-remittance transactions and reconcile the tax subledger to the general ledger. Do not assume a universal tax rate from the application's defaults.

### 3. P1 — Journal COGS excludes opening stock and stock adjustments

Location: [bookkeeping.js:159](../js/bookkeeping.js#L159).

Reproduction: open 100 KG of wheat valued at PKR 100 and sell it for 200. Financial-report FIFO calculates COGS of 100; the journal calculates COGS of zero because it passes only purchase and sale records to the lot calculator, without the stock-adjustment event stream. Equal total debits and credits still conceal the wrong inventory and profit balances.

Repair: build inventory costs once from purchases, opening lots, adjustments, and sales. Use that same result for journal postings, P&L, inventory, and partner allocations. Value shortages consistently with the lots actually consumed.

### 4. P1 — Manual journals do not affect the financial statements

Location: [bookkeeping.js:257](../js/bookkeeping.js#L257), [reports.js:50](../js/reports.js#L50), [reports.js:121](../js/reports.js#L121).

Reproduction: post a manual journal debiting Operating Expenses 50 and crediting Cash / Bank 50. The journal includes the expense, while the P&L still reports zero net loss. Reports reconstruct results from transaction stores and never load `journal_entries`; balance-sheet cash also comes from bank transactions rather than journal cash postings.

Repair: derive financial statements from a common posted ledger, with account classification and cash-account identity. Define which manual postings affect party, inventory, and bank subledgers; restrict unsupported postings rather than silently allowing divergence.

### 5. P1 — Season rollover changes FIFO costs and partner profit

Location: [season-manager.js:78](../js/season-manager.js#L78), [partners.js:14](../js/partners.js#L14).

Reproduction: two unsold lots of 100 KG costing 100 and 300 are carried into February. Carry-forward combines them into one 200 KG lot costing 400. Sell 100 KG for 400: current-season partner profit becomes 200, but the main report retains original FIFO history and reports profit 300.

Repair: preserve each remaining FIFO layer and its original cost/identity across seasons, or use real historical lots everywhere. A season boundary must not silently switch costing methods. Partner allocations should consume the same period profit calculation as formal reports.

## Confirmed technical/data-integrity defects

### 6. P1 — Deleting a used bank account destroys its payment cash trail

Location: [capital.js:443](../js/capital.js#L443).

Reproduction: a purchase paid 100 through a cash account remains marked paid after deleting that account, but its linked withdrawal disappears. The account-level cascade bypasses the source-document protections used by individual transaction deletion. Payments and other source records can retain references to the deleted account.

Repair: archive accounts with financial history. Block deletion of used accounts; explicit financial corrections must reverse the source transaction and all linked postings atomically. A confirmation dialog alone does not maintain referential integrity.

### 7. P1 — Deleting a consumed purchase leaves sales without stock or cost

Location: [purchasing.js:622](../js/purchasing.js#L622).

Reproduction: buy 100 KG for 100, then sell it for 200. Delete the purchase. The sale remains, and FIFO reports 100 KG oversold with zero COGS. The sale-time stock check does not protect subsequent deletion of its supply. Profit is consequently overstated.

Repair: reject purchase deletion or reductions that invalidate stock availability at any subsequent event date. Provide purchase returns, credit notes, and reversal workflows, preserving the history and recalculating dependent costs under a controlled policy.

### 8. P1 — Backdated settlements consume future advances/deposits

Location: [payment-service.js:18](../js/payment-service.js#L18), [payment-service.js:54](../js/payment-service.js#L54), [utils.js:568](../js/utils.js#L568).

Reproduction: create a buyer deposit dated February 1, then apply it cashlessly to a January 2 receipt. Save succeeds despite the deposit not existing at settlement date. Availability is calculated without the proposed payment's date. Farmer availability has an optional date cutoff, but this caller does not supply it; its active-season filtering also differs from the buyer path.

Repair: validate advance/deposit event balances as of the proposed date and throughout subsequent history when inserting, changing, or reversing an application. Standardize season and date rules, and preserve explicit links to the advances consumed.

### 9. P1 — Concurrent payments can overwrite cumulative invoice balances

Location: [payment-service.js:54](../js/payment-service.js#L54), [payment-service.js:110](../js/payment-service.js#L110).

Reproduction with concurrent service calls: two payments of 60 against a 100 invoice both read its unpaid state. Both payment/cash records survive, totaling 120, but the invoice's cumulative paid amount ends at 60. Each operation commits atomically, but its reads and validations happen outside that transaction. The form's in-memory `busy` flag does not synchronize separate tabs.

Repair: put dependent reads, validation, allocation, and updates in one IndexedDB read/write transaction, or serialize all relevant writers with shared locks and revision checks. Include invoice edits and reversals in the same consistency policy. Add a real two-tab test before claiming this is fixed.

## Most useful next features

These are priorities inferred from this project's workflows, not a recommendation to buy a product. The application already has due dates, aging reports, a trial balance, general ledger, payment vouchers, bank reconciliation flags, stock adjustments, partner accounts, and encrypted backup options. Expand those capabilities rather than adding duplicate screens.

| Priority | Feature | Practical value and first deliverable |
|---|---|---|
| 1 | Accounting reconciliation dashboard | Compare assets with liabilities/equity, party subledgers with control accounts, inventory with journal inventory, and cash book with reported cash. Show actionable discrepancies linked to documents. |
| 2 | Period close and safe corrections | Lock closed dates; support authorized reopen, reversal vouchers, sales returns, purchase returns, and credit/debit notes. Preserve the original document and reason for correction. |
| 3 | Collections and cash planning | Extend existing aging with customer credit limits, promised-payment dates, collection notes, overdue alerts, and a rolling forecast of expected receipts/payments. Start with an overdue action list and credit-limit warning. |
| 4 | Lot, warehouse, and quality tracking | Preserve FIFO lot identity; capture godown/location, crop grade, moisture, weighbridge gross/tare, physical versus billable weight, and spoilage. Add lot margin and stock-age views. |
| 5 | Statement-based bank reconciliation | Extend the existing reconciliation checkbox with CSV statement import, suggested matching, unmatched items, and a statement ending-balance check. |
| 6 | Verified off-device backups | Show last successful external backup, retained versions, and a tested restore preview. Current Google Drive export downloads a file and opens Drive for manual upload; it is not automatic cloud backup. Keep encryption keys separate from exported data. |
| 7 | Historical partner allocations | Save effective-dated share ratios and approved profit allocations at close. Later ratio edits should not silently redistribute historical profit; reconcile payouts to the approved allocations. |
| 8 | Tax and commission settlement ledger | Track withheld tax, remittances, supporting receipts, and outstanding liabilities. Distinguish own-account trading from commission-only transactions before recognizing gross sales and inventory. Confirm accounting/tax treatment for the actual business model. |

Recommended sequence: fix the nine defects and add reconciliation checks first; then period closing/returns and verified backups; then collections, bank matching, and lot quality tracking. Multi-user access should follow a deliberate shared-data and authorization design rather than simply exposing the current local database to several users.

Accounting reference: the IFRS Foundation's [IAS 2 overview](https://www.ifrs.org/issued-standards/list-of-standards/ias-2-inventories/) describes inventory-cost recognition and FIFO/weighted-average formulas. It supports the need for a consistent costing policy; it does not establish AgriSys's overall IFRS compliance or which reporting framework applies to this business.
