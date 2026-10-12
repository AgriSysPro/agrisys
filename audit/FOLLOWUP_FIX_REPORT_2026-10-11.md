# Follow-up fixes — 11 October 2026

All nine findings in `CURRENT_REVIEW_2026-10-11.md` have been addressed. Further follow-up checks found and fixed additional reporting inconsistencies: purchase deductions outside commission and mandi tax were posted as `Other Income` but omitted from reports; stock increases appeared in the journal but not P&L or partner profit; opening stock entered through Stock Adjustments lacked an equity record; crop analysis included synthetic stock in purchase/sale volumes; historical cash flow included account opening cash before the account existed and exports omitted beginning/ending cash; and capitalization differences split one crop across multiple profitability rows. These now reconcile across the P&L, balance sheet, partner profit, crop analysis, and exports.

| Finding | Result |
|---|---|
| Missing opening equity | Balance-sheet screen, PDF, and Excel include the signed equity counterparts of opening cash, stock, receivables, payables, and advances. |
| Missing mandi-tax liability | Reports include withheld tax and manual tax-remittance postings. Remittances reduce cash and tax payable without becoming expenses. |
| Journal ignores opening-stock COGS | Journal costs use the adjusted historical inventory stream, including opening stock and adjustments, respecting the report cutoff. Shortages use consumed FIFO cost. |
| Manual journals ignored by statements | Manual income, expense, capital, asset, and liability balances feed the reports. New cash journals require a specific bank/cash account and create linked cash transactions atomically. Unsupported party/inventory/partner control-account postings must use their originating screens. Legacy unidentified cash remains explicitly unallocated in the cash book. |
| Rollover changes FIFO and partner profit | Carry-forward preserves individual remaining lots, costs, and FIFO dates. Repeated carry-forward replaces that season's synthetic lots atomically. Partner profit uses real historical lots and period-filtered activity, including manual profit adjustments. |
| Bank-account deletion removes history | Accounts with opening balances, transactions, or linked financial records cannot be deleted. |
| Purchase deletion strands sales | Purchases, sales, opening balances, and stock corrections validate dated inventory availability before committing. Changes that worsen a stock deficit are rejected; legitimate unused purchases remain deletable. |
| Backdated settlements use future deposits | Advance availability uses the proposed date and full history. Saves, reversals, and opening-balance changes check subsequent dated balances too, preserving advances already reserved by later applications. |
| Concurrent payment updates lost | Source snapshots are compared inside the same IndexedDB write transaction as the update. Conflicting payments retry with fresh allocations; stale document changes fail without partial writes. |
| Purchase deduction income omitted | A shared calculation applies the journal's existing treatment of non-commission, non-tax PKR deductions as other income across the P&L, retained earnings, partner profit, crop analysis, and exports. |
| Stock increase gains omitted | Stock surplus gains are now recognized in the P&L, retained earnings, partner profit, crop analysis, and PDF/Excel exports. |
| Opening stock adjustment omitted from equity | Saving opening stock through Stock Adjustments now creates its linked opening-balance equity record; legacy unlinked records remain accounted once. |
| Synthetic stock counted as crop purchases/sales | Crop and stock dashboards separate real purchase/sale volumes from opening stock, surplus, and shortage movements while keeping inventory quantity inclusive of all movements. |
| Historical cash flow includes future account balances | Beginning cash uses accounts and transactions that existed before the period; in-period account opening balances appear as financing flows, and screen/PDF/Excel include beginning and ending cash. |
| Crop capitalization splits profitability rows | P&L groups crop data case-insensitively while preserving a readable crop label. |

## Verification

- `node audit/regression-tests.cjs`: 30 passing scenarios; 25 application modules and five vendor scripts parse; HTML reference checks pass.
- `node audit/followup-review.cjs`: 22 passing correctness scenarios. PASS means the correct result was verified.
- `node audit/browser-smoke.cjs`: tested with real IndexedDB in a disposable headless Edge profile, including two tabs deliberately paused after reading the same invoice, conflict rejection, manual journal cash posting, and matching screen/Excel financial totals. Also exercises startup, payment reversal, cache rebuilds, backup replacement/rollback, receipt numbering, and PDF/Excel generation.
- `git diff --check`: no whitespace errors.

The real business database was not opened or modified. Previously deleted records or historical allocations that lack source information cannot be reconstructed by a code fix. Legacy manual control-account postings now affect statement balances, but any missing party/lot identity still needs reconciliation against the original records. PDF generation is checked; full visual pagination review is not included.

Optimistic guards currently compare source records, favoring correctness over large-database performance. A future revision-based mechanism can reduce scan cost without weakening atomic conflict checks. The feature roadmap in the review remains a separate proposal, not part of these bug fixes.
