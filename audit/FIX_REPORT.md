# AgriSys fixes

All 21 findings from the original review have been addressed in the local working tree. No changes have been committed or pushed.

The payment code now uses a shared [payment service](D:/Downloads/Project/AgriSys/js/payment-service.js) to preserve each invoice allocation, create linked cash transactions, and reverse edits/deletions atomically. Buyer and farmer forms route their input events to the correct module. General payments can settle multiple invoices without duplicating ledger totals. Cashless advance/deposit applications remain separate from actual cash movement.

| Original finding | Change |
| --- | --- |
| 1: Partner save crash | Uses the existing `hideModal` utility; saving now closes the modal and refreshes the view. |
| 2: General payment allocations | Stores allocation amounts per invoice; edits and reversals update every affected invoice. |
| 3: Cash linkage | New payments use consistent source metadata; reversals also recognize legacy category/reference links and transaction IDs. |
| 4: Bank deletion removes source document | Linked bank transactions must be changed in their originating screen, preserving the business document and its inventory. |
| 5: Zero payable becomes gross amount | Null/undefined fallbacks preserve legitimate zero payables throughout the application. |
| 6: Future payments in historical reports | Uses explicit initial-payment fields and complete linked history, applying the cutoff to actual payment events. |
| 7: Double deduction of buyer deposits | Buyer ledgers, buyer lists, and balance-sheet liabilities account for deposit applications and remaining deposits. |
| 8: Noncash settlements in cash flow | Cash flow uses the net cash component; synthetic inventory entries are excluded from initial cash payments. Applied across screen, PDF, and Excel. |
| 9: Overpayment journal imbalance | Excess amounts are debited to farmer advances within the payment event, with cash credited only once. |
| 10: Advance available twice on edit | Excludes the edited application once; validates the available amount again on save. |
| 11: Invoice totals below payment history | Purchase and sale saves reject paid/received totals below recorded allocations. |
| 12: Buyer forms run farmer callbacks | Shared input handlers use the payment mode selected when the form opens. |
| 13: Carry-forward doubles inventory | Financial reports use real history without duplicate carry-forward copies; dashboard all-data mode excludes those copies. |
| 14: Carry-forward loses adjustments | Includes opening stock and stock adjustments and carries remaining FIFO inventory value. |
| 15: FIFO uses future purchases | Costing and sale availability respect transaction dates. Inventory-lot consumption also skips future lots. |
| 16: Crop case loses COGS | Report COGS lookup uses sale IDs, independent of crop display capitalization. |
| 17: Partner profit ignores adjustments | Partner profit includes the same adjusted inventory events as reports. |
| 18: Rename disconnects history | Renames linked trade, payment, advance, commission, and party-opening records in the same transaction as the master; rejects duplicate names. |
| 19: Reset/restore retain caches | Clear-all clears derived caches and local snapshots; restore clears caches and reload rebuilds them. |
| 20: Older restore merges newer records | Validates version, required stores, and record keys, then replaces all canonical stores atomically. Supported older backups initialize absent newer stores empty. |
| 21: Adjustment migration uses wrong fields | Cache rebuild uses canonical stock-adjustment weight and direction values through the shared adjustment helper. |

Validation completed:

- `node audit/regression-tests.cjs`: **30 passing scenarios**, including the original findings, multi-invoice payment editing, legacy cash linkage, partial deposit use, overpayments, invalid inputs, backdated stock, and party renames.
- `node audit/browser-smoke.cjs`: **passed in headless Edge with a fresh browser profile**. Exercised startup, real IndexedDB payment allocations/reversal, cache rebuilding, backup replacement, rollback after an injected restore failure, dashboard rendering, partner save/modal closure, and financial report rendering.
- Browser export checks successfully generated P&L, balance-sheet, and cash-flow PDF and Excel downloads.
- All 25 application modules and five bundled vendor scripts parse. HTML script references and direct handlers resolve; no duplicate HTML IDs.

The regression suite uses an isolated in-memory database. The browser test uses a disposable browser context and never opens the user's saved browser profile or real business database. Its Playwright import points to the bundled runtime on this machine; use an installed Playwright package when running it elsewhere.

Existing legacy general payments did not store enough information to reliably reconstruct invoice allocations. Those ambiguous edits/deletions now stop with a reconciliation message. The fixes prevent new corruption and support legacy single-invoice cash links, but they do not invent missing accounting history. Likewise, records already deleted or previously misstated require reconciliation from a backup or source receipts. PDF download generation was tested; page-by-page visual PDF inspection was not performed.

Receipt-number follow-up: purchase and sale forms now preview one above the highest saved numeric receipt ID (including deleted receipts). Clearing or reopening a form and unsuccessful validation do not reserve a number. Old sequence settings inflated by unused forms are ignored. Saving refreshes the number under a browser lock, rejects duplicate inserts atomically, and awaits the cleared form; editing keeps the original receipt ID. Real-browser checks passed for repeated clears, invalid saves, successful saves advancing once, edits, inflated legacy sequence settings, deleted IDs, and duplicate protection.
