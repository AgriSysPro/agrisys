# AgriSys bug review

**Status:** The findings below describe the original review. They have since been addressed in the local working tree. See [FIX_REPORT.md](D:/Downloads/Project/AgriSys/audit/FIX_REPORT.md) for implementation details and current validation.

Reviewed on 11 October 2026. Repository commit: `998ed7aae5f2da37de3a6c04b0855d6c548ea290`.

Found **21 distinct bugs**, supported by **21 reproducible scenarios**. Two scenarios cover the farmer and buyer versions of the same allocation bug; those scenarios also demonstrate the separate bank-transaction linkage bug. P1 means a core workflow breaks or financial/inventory data becomes incorrect; P2 means a narrower correctness issue.

Scope: application initialization and routing, IndexedDB CRUD and restore, purchases, sales, payments, party masters and ledgers, advances/deposits, opening balances, inventory adjustments and costing, seasons, capital/bank accounts, debts, partners, bookkeeping, reports, PDF/Excel export paths, backup settings, and HTML bindings. Parsed all 24 application JavaScript files and five bundled vendor scripts. All HTML script paths exist, no duplicate HTML IDs were found, and direct HTML method references resolve.

Original validation used a reproduction harness executing the project's JavaScript with an in-memory database and DOM stubs. It has now been converted to expected-correctness regression checks: [regression-tests.cjs](D:/Downloads/Project/AgriSys/audit/regression-tests.cjs), with current results in [regression-results.json](D:/Downloads/Project/AgriSys/audit/regression-results.json).

No production code was changed. No real business data was created, cleared, or restored. This is source review and isolated logic verification, not a complete browser interaction, PDF visual-layout, third-party dependency security, or real IndexedDB durability audit. It cannot establish that no other defects exist.

## Findings, ordered by recommended repair priority

### 1. P1 — Saving partners or partner transactions crashes after committing

Locations: [partners.js:302](D:/Downloads/Project/AgriSys/js/partners.js:302), [partners.js:432](D:/Downloads/Project/AgriSys/js/partners.js:432).

Both save paths call `Utils.closeModal`, which does not exist; the utility is `hideModal`. A PKR 100 contribution and its bank deposit are committed, then `saveTx` throws `closeModal is not a function`. The modal remains open and the view does not refresh. Retrying the transaction can create another contribution and deposit.

Fix: use the existing modal method and prevent repeated submission until save completes. Test both partner creation/edit and contribution/drawing/payout saves.

### 2. P1 — General payments lose their allocations and corrupt ledgers/reversals

Locations: [payment-purchase.js:394](D:/Downloads/Project/AgriSys/js/payment-purchase.js:394), [payment-purchase.js:417](D:/Downloads/Project/AgriSys/js/payment-purchase.js:417), [payment-sales.js:368](D:/Downloads/Project/AgriSys/js/payment-sales.js:368), [payment-sales.js:385](D:/Downloads/Project/AgriSys/js/payment-sales.js:385).

A general PKR 200 payment settles two PKR 100 invoices, but its whole amount is linked to only the first invoice. Ledger reconstruction treats the second invoice's allocated PKR 100 as an initial payment, reporting PKR 300 paid/received. Deleting the general payment resets only the first invoice; the second remains paid/received even though the payment is gone. Editing has the same missing-allocation problem.

Fix: persist per-invoice allocations and use them consistently in ledger, edit, delete, and date-based reporting. Preserve the overall cash transaction separately.

### 3. P1 — Editing/deleting payments fails to reverse their bank transactions

Locations: [payment-purchase.js:456](D:/Downloads/Project/AgriSys/js/payment-purchase.js:456), [payment-purchase.js:547](D:/Downloads/Project/AgriSys/js/payment-purchase.js:547), [payment-purchase.js:657](D:/Downloads/Project/AgriSys/js/payment-purchase.js:657), [payment-sales.js:403](D:/Downloads/Project/AgriSys/js/payment-sales.js:403), [payment-sales.js:569](D:/Downloads/Project/AgriSys/js/payment-sales.js:569).

Payment saves write bank linkage as `category` and `referenceId`. Edit/delete and invoice cascade deletion look for `sourceStore` and `sourceId`. Those searches find nothing. The reproduced general payment deletion leaves its cash withdrawal/deposit active. An edit can retain the old bank transaction and add a new one, overstating cash movement.

Fix: standardize the linkage schema; use `capitalTxId` as a reliable fallback for existing records, and migrate legacy links.

### 4. P1 — Deleting a linked bank transaction deletes the entire purchase/sale

Location: [capital.js:478](D:/Downloads/Project/AgriSys/js/capital.js:478).

Deleting an initial purchase payment's bank transaction soft-deletes its source purchase, instead of reversing only its payment. It bypasses purchase deletion cleanup. The reproduced case leaves later payment records and the stock cache behind. Sales are subject to the same source-deletion path. Other linked source types also need type-specific handling.

Fix: distinguish cash reversal from deleting the underlying business document. Route requested document deletions through their complete service operations and make confirmation describe the actual effect.

### 5. P1 — A legitimate zero farmer payable becomes the gross purchase amount

Locations: [utils.js:470](D:/Downloads/Project/AgriSys/js/utils.js:470), [payment-purchase.js:135](D:/Downloads/Project/AgriSys/js/payment-purchase.js:135), [reports.js:306](D:/Downloads/Project/AgriSys/js/reports.js:306).

Expressions such as `netPayableAmount || amount || 0` treat zero as missing. A PKR 100 purchase fully covered by a PKR 100 advance has net payable zero, yet the helper returns PKR 100. This pattern occurs throughout farmer balances, payment screens, journals, and reports, so a settled obligation can reappear as payable.

Fix: use a null/undefined fallback, e.g. `netPayableAmount ?? amount ?? 0`, and distinguish gross inventory cost from farmer payable.

### 6. P1 — Historical reports count future payments as initial payments

Locations: [reports.js:56](D:/Downloads/Project/AgriSys/js/reports.js:56), [utils.js:474](D:/Downloads/Project/AgriSys/js/utils.js:474), [farmers.js:24](D:/Downloads/Project/AgriSys/js/farmers.js:24), [buyers.js:24](D:/Downloads/Project/AgriSys/js/buyers.js:24).

Report data excludes payments after the end date, but invoices retain their current cumulative paid/received totals. `paymentTotalFor` subtracts only the supplied payment records to infer the initial payment. A January purchase paid in February therefore appears already paid in a report as of 31 January. Historic buyer balances and inferred initial cash flows have the same problem.

Fix: use the explicit initial-payment fields where available; retrieve complete linked payment history for legacy reconstruction, then apply the report cutoff to actual payment events.

### 7. P1 — Buyer deposits are deducted twice after application to a sale

Locations: [utils.js:691](D:/Downloads/Project/AgriSys/js/utils.js:691), [utils.js:733](D:/Downloads/Project/AgriSys/js/utils.js:733), [buyers.js:45](D:/Downloads/Project/AgriSys/js/buyers.js:45), [reports.js:311](D:/Downloads/Project/AgriSys/js/reports.js:311).

A PKR 100 opening buyer deposit applied to a PKR 100 sale leaves the buyer ledger at negative PKR 100, even though the deposit is exhausted and the sale settled. The opening deposit is credited and the entire settlement is credited again. Buyer lists subtract the original deposit after subtracting receipts; balance sheets retain the original deposit liability without reducing it by applied amounts.

Fix: distinguish fresh cash receipts from deposit application and calculate outstanding deposits from opening deposits less applications. Keep journal account names consistent as well (`Advances from Buyers` versus `Buyer Advances / Deposits`).

### 8. P1 — Cash flow counts noncash advance/deposit settlements as cash

Locations: [reports.js:399](D:/Downloads/Project/AgriSys/js/reports.js:399), [reports.js:1067](D:/Downloads/Project/AgriSys/js/reports.js:1067), [reports.js:1296](D:/Downloads/Project/AgriSys/js/reports.js:1296).

A receipt with `amount: 100`, `advanceDeducted: 100`, and `netCashAmount: 0` produces PKR 100 cash inflow. Farmer advance settlements similarly become cash outflows. The same calculation is repeated in the screen, PDF, and Excel cash-flow paths. Opening inventory/carry-forward records marked paid can also be mistaken for initial cash purchases.

Fix: calculate cash from actual cash events or `netCashAmount`, exclude synthetic stock entries, and share one cash-flow calculation across output formats.

### 9. P1 — Farmer overpayments record cash twice and unbalance the journal

Locations: [bookkeeping.js:193](D:/Downloads/Project/AgriSys/js/bookkeeping.js:193), [bookkeeping.js:223](D:/Downloads/Project/AgriSys/js/bookkeeping.js:223).

Paying PKR 150 against a PKR 100 invoice creates a PKR 50 excess advance. Bookkeeping credits PKR 150 cash for the payment, then credits another PKR 50 for the generated advance. Actual cash outflow is PKR 150; journal cash outflow is PKR 200 and credits exceed debits by PKR 50.

Fix: post the combined event once: debit payable PKR 100, debit farmer advance PKR 50, credit cash PKR 150. Exclude the generated excess advance from independent cash disbursement postings.

### 10. P1 — Editing a farmer payment makes spent advances available twice

Location: [payment-purchase.js:507](D:/Downloads/Project/AgriSys/js/payment-purchase.js:507).

`getFarmerAvailableAdvance(..., payment.id)` already excludes the edited payment's deduction. Adding `payment.advanceDeducted` again duplicates the restored amount. A PKR 50 advance already applied by the edited payment is offered as PKR 100 available, and save validation trusts that inflated allowance.

Fix: remove the second addition and validate against a fresh balance at save time.

### 11. P1 — Invoice edits can reduce cumulative payments below existing payment history

Locations: [purchasing.js:288](D:/Downloads/Project/AgriSys/js/purchasing.js:288), [selling.js:281](D:/Downloads/Project/AgriSys/js/selling.js:281).

Purchase validation accepts `amountPaid: 0` with an existing PKR 50 linked payment. Sale validation similarly lacks a lower bound against recorded receipts. Save retains the payment history while overwriting the invoice's cumulative total, so payment tables, ledgers, outstanding balances, and future payment limits disagree. An amount-change confirmation does not reconcile those records.

Fix: protect recorded payment totals, edit only the initial component, and reject invoice totals below already allocated settlements unless an explicit reversal/refund is performed.

### 12. P1 — Buyer payment forms execute farmer input handlers

Locations: [index.html:1127](D:/Downloads/Project/AgriSys/index.html:1127), [index.html:1160](D:/Downloads/Project/AgriSys/index.html:1160), [index.html:1175](D:/Downloads/Project/AgriSys/index.html:1175).

Shared form inputs choose `PurchasePayments` whenever its method exists. Those methods always exist, even when `SalePayments` opened the form. Selecting a buyer owing PKR 100 invokes farmer lookup and displays zero pending when no purchases exist. Deposit edits can be clamped against stale farmer advance state instead of buyer deposits.

Fix: record the active payment mode and bind all shared input callbacks to the module that opened the modal.

### 13. P1 — Season carry-forward doubles inventory in reports

Locations: [reports.js:56](D:/Downloads/Project/AgriSys/js/reports.js:56), [season-manager.js:112](D:/Downloads/Project/AgriSys/js/season-manager.js:112), [app.js:258](D:/Downloads/Project/AgriSys/js/app.js:258).

With an active season and an end date, report fetching returns every earlier purchase plus the synthetic opening purchase. A remaining 100 KG lot carried into February becomes 200 KG in report inventory. The dashboard also takes raw purchases in all-data mode and retains the synthetic copies, unlike `Utils.filterBySeason`, which excludes them there. Both paths require a consistent carry-forward policy.

Fix: choose either complete real history excluding synthetic carry-forward records, or current-season transactions plus opening lots; never combine both representations of the same stock.

### 14. P1 — Season carry-forward drops opening stock and stock adjustments

Location: [season-manager.js:74](D:/Downloads/Project/AgriSys/js/season-manager.js:74).

Carry-forward reads only purchases and sales. Stock entered through opening balances is stored as a stock adjustment and is not included. A business starting with 100 KG opening stock carries no inventory into its next season. Stock increases and decreases are omitted too.

Fix: use the same inventory event stream as the stock screens, including opening stock and adjustments, and carry actual remaining lots and their costs.

### 15. P2 — FIFO consumes stock purchased after the sale date

Locations: [utils.js:816](D:/Downloads/Project/AgriSys/js/utils.js:816), [operations.js:626](D:/Downloads/Project/AgriSys/js/operations.js:626), [selling.js:155](D:/Downloads/Project/AgriSys/js/selling.js:155).

The lot calculator loads all purchase lots before processing sales and never checks whether a lot existed on the sale date. A January sale consumes a February purchase, shows no oversold weight, and exhausts future stock. The save-time stock check also totals the season without a sale-date cutoff, allowing this state through backdated entry.

Fix: process events chronologically and validate availability as of the transaction date, with an explicit policy for backdated stock corrections.

### 16. P2 — Crop case changes cause report COGS to become zero

Location: [reports.js:99](D:/Downloads/Project/AgriSys/js/reports.js:99).

Inventory costing normalizes crop names and may emit the key `Wheat`; report COGS lookup indexes by the sale's original crop string. Purchasing `Wheat` and selling `wheat` gives inventory COGS PKR 100 but report COGS zero. Changes to crop capitalization in settings or imported data can trigger this and inflate profit.

Fix: use a stable normalized crop key everywhere, or a sale-ID-based COGS map independent of display names.

### 17. P1 — Partner profit ignores opening stock and adjustments

Location: [partners.js:12](D:/Downloads/Project/AgriSys/js/partners.js:12).

Unlike formal reports, partner profit feeds raw purchases/sales into FIFO without `applyStockAdjustments`. Opening 100 KG stock valued at PKR 100 and selling it for PKR 200 produces partner profit PKR 30, because the calculator invents estimated COGS PKR 170. The actual stock cost is PKR 100 and profit is PKR 100. Adjusted inventory losses are omitted as well.

Fix: use the common adjusted stock and profit calculations for both reports and partner allocation.

### 18. P1 — Renaming a farmer/buyer disconnects financial history

Locations: [farmers.js:90](D:/Downloads/Project/AgriSys/js/farmers.js:90), [buyers.js:84](D:/Downloads/Project/AgriSys/js/buyers.js:84), [utils.js:535](D:/Downloads/Project/AgriSys/js/utils.js:535).

Party saves change only the master name. Financial records are joined by name rather than party ID. Changing `Ali` to `Ali Khan` leaves purchases, payments, advances, and openings under `Ali`; the renamed party's ledger becomes empty and its visible balance disappears. Buyers use the same design. Duplicate master names can also show the same financial history for multiple parties.

Fix: reference immutable party IDs. Until that migration is available, rename all related records atomically and disallow conflicting names.

### 19. P2 — Clear/restore retain obsolete materialized stock and party balances

Locations: [settings.js:202](D:/Downloads/Project/AgriSys/js/settings.js:202), [db.js:419](D:/Downloads/Project/AgriSys/js/db.js:419), [CoreServices.js:48](D:/Downloads/Project/AgriSys/js/CoreServices.js:48).

Both clear-all and restore omit `warehouse_stock` and `party_running_balances`. Migration rebuilds only empty stores. After clearing, the reproduced cached stock remains 100 KG and cached buyer balance remains PKR 100. Restore similarly retains pre-restore cache values. Current selling validation and party lists calculate from source records, so this defect primarily affects the cache getters and future use of these views rather than every current screen.

Fix: clear/rebuild derived stores as part of reset/restore, with an explicit complete rebuild flag rather than an emptiness heuristic.

### 20. P1 — Restoring older or incomplete backups merges unrelated current data

Location: [db.js:430](D:/Downloads/Project/AgriSys/js/db.js:430).

Restore clears only stores supplied as arrays. Older backups lack newly introduced stores; existing company debts, partner transactions, and other newer data survive despite the UI promising replacement of all current records. The reproduced version-4 restore clears purchases but preserves a newer company debt. An incomplete payload with `_version` is likewise accepted without proving completeness.

Fix: validate backup schema and supported versions, then replace every canonical data store, initializing absent stores according to a versioned migration policy. Keep vault preservation explicit and separate.

### 21. P2 — Stock migration uses nonexistent adjustment fields

Location: [CoreServices.js:66](D:/Downloads/Project/AgriSys/js/CoreServices.js:66).

Migration expects `quantity` and direction `in`; current adjustment records use `weight` and `increase`, `decrease`, or `opening`. A 100 KG increase is migrated as zero. This affects the materialized stock cache; current screen calculations use the actual adjustment schema separately.

Fix: use the canonical weight/direction schema and the same stock event calculation used by normal operations.

## Suggested repair sequence

First repair partner save crashes, payment allocation/linkage, destructive bank deletion, and zero-payable handling. Then consolidate payment/deposit event accounting and historical reporting. Next consolidate seasonal inventory, FIFO, and partner profit calculations. Finally migrate party identity and backup/cache rebuild behavior.

Turn these reproduction scenarios into expected-correctness regression checks while implementing fixes. Validate the fixes in a real browser with IndexedDB, including multi-invoice payments, payment edit/delete, season switching, legacy backup restore, and matching screen/PDF/Excel totals. Existing financial records affected by these bugs may need reconciliation; fixing code alone will not reconstruct missing payment allocations automatically.
