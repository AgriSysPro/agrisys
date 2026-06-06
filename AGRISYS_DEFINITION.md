# AgriSys Complete Definition

AgriSys is an offline-first agricultural business management system for crop trading. It manages purchases from farmers, sales to buyers, farmer and buyer balances, expenses, capital accounts, inventory, crop profitability, receipts, ledgers, exports, and financial reports. The system runs in the browser, stores data locally in IndexedDB, and uses PDF and Excel libraries bundled in the project.

## 1. Core Purpose

AgriSys is designed for an agricultural commission, grain, or crop trading business that buys produce from farmers and sells produce to buyers. It tracks:

- What was bought, from whom, at what weight and rate.
- What was sold, to whom, at what weight and rate.
- How much is payable to farmers.
- How much is receivable from buyers.
- What stock remains by crop.
- What expenses were spent on crops or operations.
- What capital or cash accounts exist.
- What profit, cash flow, and balance sheet position the business has.

## 2. Main User Areas

### Dashboard

The dashboard gives a fast business overview:

- Total purchases and purchase value.
- Total sales and sale value.
- Farmer pending balances.
- Buyer pending balances.
- Total expenses.
- Current stock by crop.
- Crop analysis.
- Revenue vs cost chart for the last six months.
- Recent purchase receipts.
- Recent sale receipts.

Dashboard stock is calculated as:

```text
Stock weight by crop = total purchased net weight - total sold net weight
Stock bags by crop = total purchased net bags - sold weight / sale per-bag weight
```

### Purchasing

Purchasing records crop received from a farmer and creates a purchase receipt. It supports two weighing methods:

1. Computer scale method.
2. Bags count method.

The purchase receipt becomes:

- An inventory increase.
- A payable amount to the farmer.
- A farmer ledger entry.
- A PDF receipt source.
- A report and COGS source.

### Selling

Selling records crop sold to a buyer and creates a sale receipt or invoice. It checks that enough stock is available before saving.

The sale receipt becomes:

- An inventory decrease.
- A receivable amount from the buyer.
- A buyer ledger entry.
- A PDF receipt source.
- Revenue for reports.

### Farmers

The farmers module manages farmer records and farmer balances. A farmer can be created manually or automatically when a purchase is saved.

Tracked farmer values:

```text
Total farmer amount = sum of net payable purchase amounts
Total farmer paid = sum of initial and later farmer payments
Farmer balance = total farmer amount - total farmer paid
Open advances = sum of farmer advance records
```

Farmer ledgers can be exported to Excel and printed as PDF.

### Buyers

The buyers module manages buyer records and buyer balances. A buyer can be created manually or automatically when a sale is saved.

Tracked buyer values:

```text
Total buyer amount = sum of sale amounts
Total buyer received = sum of initial and later buyer payments
Buyer balance = total buyer amount - total buyer received
```

Buyer ledgers can be exported to Excel and printed as PDF.

### Farmer Payments

This module records payments made to farmers against purchase receipts. Each payment has:

- Purchase receipt ID.
- Farmer name.
- Amount.
- Date.
- Mode.
- Reference.
- Notes.

After saving a payment:

```text
purchase.amountPaid = old amountPaid + payment amount
purchase.balance = purchase.netPayableAmount - purchase.amountPaid
purchase.paymentStatus = paid if amountPaid >= netPayableAmount, else partial
```

Payment cannot be zero, negative, or greater than the remaining purchase balance.

### Buyer Payments

This module records payments received from buyers against sale receipts. Each receipt has:

- Sale receipt ID.
- Buyer name.
- Amount.
- Date.
- Mode.
- Reference.
- Notes.

After saving a buyer receipt:

```text
sale.amountReceived = old amountReceived + received amount
sale.balance = sale.amount - sale.amountReceived
sale.paymentStatus = paid if amountReceived >= sale.amount, else partial
```

Received amount cannot be zero, negative, or greater than the remaining sale balance.

### Expenses

Expenses are stored as business costs. They can be:

- General operating expenses.
- Crop-linked expenses.
- Purchase receipt-linked expenses.

Fields:

- Date.
- Type.
- Description.
- Amount.
- Crop.
- Linked purchase receipt ID, optional.

Receipt-linked expenses are included in FIFO inventory lot cost. General operating expenses reduce net profit.

### Capital

Capital tracks cash, bank, partner, or other capital accounts.

Capital account balance is:

```text
Current account balance = opening balance + deposits - withdrawals
```

Capital transactions can be reconciled. Farmer advances can optionally create a capital withdrawal.

### Bookkeeping

Bookkeeping generates double-entry journal entries from system data.

Purchase entry:

```text
Debit  Inventory / Purchases
Credit Accounts Payable (Farmer)
```

Initial farmer payment:

```text
Debit  Accounts Payable (Farmer)
Credit Cash / Bank
```

Sale entry:

```text
Debit  Accounts Receivable (Buyer)
Credit Sales Revenue
```

Initial buyer receipt:

```text
Debit  Cash / Bank
Credit Accounts Receivable (Buyer)
```

Later farmer payment:

```text
Debit  Accounts Payable (Farmer)
Credit Cash / Bank
```

Later buyer receipt:

```text
Debit  Cash / Bank
Credit Accounts Receivable (Buyer)
```

Expense entry:

```text
Debit  Operating Expenses
Credit Cash / Bank
```

The bookkeeping view totals debit and credit and reports whether books are balanced.

### Reports

Reports include:

- Profit and Loss.
- Balance Sheet.
- Cash Flow.
- Crop-wise profitability.
- PDF summary.
- Excel exports.

Reports are filtered by selected date range and active season.

### Seasons

Seasons represent fiscal years or crop seasons. Only one season can be active.

When an active season exists, most screens show only transactions inside:

```text
record.date >= season.startDate and record.date <= season.endDate
```

New seasons can optionally carry forward unsold inventory. Carry-forward creates opening balance purchase entries for remaining crop stock.

Carry-forward amount is based on average cost:

```text
remaining weight = previous purchases net weight - previous sales net weight
average cost per maund = previous purchase amount / (previous purchase weight / 40)
opening balance amount = average cost per maund * (remaining weight / 40)
```

Opening balance purchases are marked paid and excluded from all-data mode when no season is active to avoid duplicate stock.

### Settings

Settings define:

- Business name.
- Address.
- Phone.
- Owner name.
- Crop list.
- Expense type list.
- Default per-bag weight.
- Default bardana deduction.
- Default labour deduction.

Default crops:

```text
Wheat, Rice, Cotton, Potato, Maize, Sugarcane, Misc
```

Default expense types:

```text
Labour, Transport, Diesel, Rent, Utility, Misc
```

## 3. Data Stores

AgriSys uses IndexedDB database `AgriSysDB`, version 4.

Stores:

- `settings`: business settings, defaults, and receipt sequences.
- `purchases`: purchase receipts and opening balance inventory.
- `farmers`: farmer master records.
- `purchase_payments`: payments made to farmers.
- `sales`: sale receipts or invoices.
- `sale_payments`: payments received from buyers.
- `expenses`: general, crop, and purchase-linked expenses.
- `capital_accounts`: capital and cash/bank account masters.
- `capital_transactions`: deposits, withdrawals, reconciliations.
- `buyers`: buyer master records.
- `farmer_advances`: farmer advances and advance deductions.
- `seasons`: fiscal or crop seasons.

## 4. Receipt IDs

Purchase and sale receipts use numeric sequences.

```text
First next receipt ID = 100001
After save, sequence is confirmed only if the saved ID matches the next expected ID
```

Other records use a date and random hex ID:

```text
DDMMYYYY-RANDOMHEX
```

## 5. Weight and Unit Rules

AgriSys uses:

- KG for weight.
- Maund for trade rate calculations.
- PKR for currency.

Core conversion:

```text
1 maund = 40 KG
maund = weight in KG / 40
```

Default per-bag weight is 100 KG unless changed in settings or the form.

## 6. Purchase Calculation Method

### Computer Scale Method

Inputs:

- Gross weight in KG.
- Per-bag weight.
- Bardana deduction per bag.
- Labour deduction per bag.
- Additional deductions.
- Rate per maund.
- Amount paid.
- Payment status.
- Optional advance deduction.

Calculations:

```text
bagsCount = grossWeight / perBagWeight
bardanaTotal = bardanaPerBag * bagsCount
labourTotal = labourPerBag * bagsCount
```

### Bags Count Method

Inputs:

- Number of bags.
- Weight per bag.
- Bardana deduction per bag.
- Labour deduction per bag.
- Additional deductions.
- Rate per maund.

Calculations:

```text
grossWeight = numberOfBags * weightPerBag
bagsCount = numberOfBags
```

### Purchase Additional Deduction Rules

Additional deductions can be:

```text
KG deduction:
deductionKg = amount * bagsCount

Bags deduction:
deductionKg = amount * perBagWeight

PKR deduction:
deductionPkr = amount
```

Total purchase deductions:

```text
totalKgDeductions = bardanaTotal + labourTotal + additionalKgDeductions
totalPkrDeductions = additionalPkrDeductions + advanceDeducted
```

Final purchase weights:

```text
netWeight = max(0, grossWeight - totalKgDeductions)
netBags = netWeight / perBagWeight
netMaund = netWeight / 40
```

Purchase amount:

```text
grossPurchaseAmount = netMaund * ratePerMaund
netPayableAmount = max(0, grossPurchaseAmount - totalPkrDeductions)
```

Payment balance:

```text
if paymentStatus is paid:
    amountPaid = netPayableAmount

balance = netPayableAmount - amountPaid
```

Validation:

- Farmer name is required.
- Crop is required.
- Gross weight must be greater than zero.
- Rate must be greater than zero.
- Paid amount cannot be negative.
- Paid amount cannot exceed net payable amount.

## 7. Farmer Advance Method

Farmer advances are stored separately in `farmer_advances`.

When an advance is given:

```text
farmer_advances.amount = positive advance amount
```

If a capital account is selected, a withdrawal transaction is also stored:

```text
capital transaction type = withdrawal
capital transaction description = Advance paid to farmer
```

When an advance is deducted in a purchase:

```text
farmer_advances.amount = negative deducted amount
purchase.advanceDeducted = deducted amount
purchase.totalPkrDeductions includes advanceDeducted
```

Open advance shown for a farmer:

```text
openAdvance = sum of all farmer_advances.amount for that farmer
```

## 8. Sale Calculation Method

Inputs:

- Buyer.
- Date.
- Receipt ID.
- Crop.
- Gross weight in KG.
- Per-bag weight.
- Additional deductions.
- Rate per maund.
- Amount received.
- Payment status.
- Optional buyer receipt image.

Sale deductions can be:

```text
KG deduction:
deductionKg = amount

PKR deduction:
deductionPkr = amount
```

Final sale values:

```text
bags = grossWeight / perBagWeight
netWeight = max(0, grossWeight - kgDeductions)
netMaund = netWeight / 40
rawAmount = netMaund * ratePerMaund
saleAmount = max(0, rawAmount - pkrDeductions)
```

Payment balance:

```text
if paymentStatus is paid:
    amountReceived = saleAmount

balance = saleAmount - amountReceived
```

Validation:

- Buyer name is required.
- Crop is required.
- Weight must be greater than zero.
- Rate must be greater than zero.
- Received amount cannot be negative.
- Received amount cannot exceed sale amount.
- Net sale weight cannot exceed available stock for the crop.

Available stock:

```text
availableStock = total purchase net weight for crop - total sale net weight for crop
```

When editing a sale, the current sale is excluded from the available stock check.

## 9. Invoice and Receipt Methods

### Purchase Receipt PDF

A purchase receipt can be generated after saving or from the purchase list.

The PDF contains two side-by-side copies:

- Customer copy.
- Shop copy.

It includes:

- Business name, address, and phone from settings.
- Receipt number.
- Farmer name.
- Date.
- Crop.
- Weighing method.
- Gross weight.
- Bardana deduction.
- Labour deduction.
- Additional KG deductions.
- Net weight.
- Bags and maund.
- Rate per maund.
- Gross amount.
- PKR deductions.
- Advance deduction.
- Net payable amount.
- Amount paid.
- Balance.
- Notes.
- QR code when the QR library is available.

The purchase PDF filename is:

```text
Purchase_<receiptId>.pdf
```

### Sale Receipt or Invoice PDF

A sale receipt can be generated after saving or from the sale list.

The PDF contains two side-by-side copies:

- Buyer copy.
- Shop copy.

It includes:

- Business name, address, and phone from settings.
- Receipt number.
- Buyer name.
- Date.
- Crop.
- Gross weight.
- KG deductions.
- Net weight.
- Bags and maund.
- Rate per maund.
- Raw amount.
- PKR deductions.
- Net sale amount.
- Amount received.
- Balance.
- Notes.
- QR code when available.

The sale PDF filename is:

```text
Sale_<receiptId>.pdf
```

### Payment Receipts

Current payment screens record payment details and update ledgers. They do not generate a separate payment receipt PDF. Payment proof is available through:

- Farmer payment list.
- Buyer payment list.
- Farmer ledger PDF.
- Buyer ledger PDF.
- Bookkeeping journal.
- Excel exports.

## 10. Ledgers

### Farmer Ledger

Farmer ledger combines purchases and payments.

For every purchase:

```text
payable += netPayableAmount
```

For initial payment on the receipt:

```text
paid += initialPaid
initialPaid = purchase.amountPaid - laterPaymentsAgainstSamePurchase
```

For later farmer payments:

```text
paid += payment.amount
```

Running farmer balance:

```text
balance = previousBalance + payable - paid
```

### Buyer Ledger

Buyer ledger combines sales and receipts.

For every sale:

```text
receivable += sale.amount
```

For initial receipt on the sale:

```text
received += initialReceived
initialReceived = sale.amountReceived - laterPaymentsAgainstSameSale
```

For later buyer payments:

```text
received += payment.amount
```

Running buyer balance:

```text
balance = previousBalance + receivable - received
```

If buyer balance is positive, buyer owes the business. If negative, the business owes the buyer as advance.

## 11. Inventory and COGS

Inventory costing uses FIFO lots in reports.

For each purchase, a lot is created:

```text
lotWeight = purchase.netWeight
lotCost = purchase.netPayableAmount + expenses linked to that purchase
lotCostPerKg = lotCost / lotWeight
```

Sales consume purchase lots by date order:

```text
for each sale by date:
    consume sale.netWeight from earliest remaining lots of the same crop
    saleCOGS += consumedWeight * lotCostPerKg
```

Report values:

```text
COGS = sum of saleCOGS for selected sales
inventoryWeight = remaining lot weights
inventoryValue = remainingWeight * lotCostPerKg
oversoldWeight = sale weight not covered by purchase lots
```

## 12. Profit and Loss

Profit and Loss report uses:

```text
salesRevenue = sum of sale.amount
COGS = FIFO cost assigned to sold stock
grossProfit = salesRevenue - COGS
operatingExpenses = sum of expenses where purchaseId is empty
netProfit = grossProfit - operatingExpenses
grossMarginPercent = grossProfit / salesRevenue * 100
netMarginPercent = netProfit / salesRevenue * 100
```

Crop-wise profitability:

```text
cropRevenue = sum of sale.amount for crop
cropCost = FIFO COGS for crop sales
cropExpenses = operating expenses linked to crop
cropProfit = cropRevenue - cropCost - cropExpenses
```

Average rates:

```text
averageBuyRate = crop COGS / (soldWeight / 40)
averageSellRate = cropRevenue / (soldWeight / 40)
```

## 13. Balance Sheet

Balance Sheet is calculated as of the selected to-date.

Assets:

```text
Accounts receivable = total sales revenue - total buyer received
Farmer advances = sum farmer_advances.amount
Cash and bank = sum account opening balances + deposits - withdrawals
Inventory on hand = FIFO remaining inventory value
Total assets = receivable + farmer advances + cash/bank + inventory value
```

Liabilities:

```text
Accounts payable = total purchase cost - total farmer paid
Total liabilities = accounts payable
```

Equity:

```text
netEquity = totalAssets - totalLiabilities
totalLiabilitiesAndEquity = totalLiabilities + netEquity
```

## 14. Cash Flow

Cash Flow uses actual receipts and payments in the selected range.

Operating cash inflows:

```text
cashFromSales = initial buyer receipts on sales + later buyer payments
```

Operating cash outflows:

```text
cashToPurchases = initial farmer payments on purchases + later farmer payments
cashToAdvances = positive farmer advances
cashToExpenses = all expenses
```

Net operating cash:

```text
netOperatingCash = cashFromSales - cashToPurchases - cashToAdvances - cashToExpenses
```

Financing cash:

```text
netFinancingCash = capital deposits - capital withdrawals
```

Advance-related capital withdrawals are excluded from financing withdrawals in the cash-flow view because they are treated as operating advances.

Net cash flow:

```text
netCashFlow = netOperatingCash + netFinancingCash
```

## 15. Crop Analysis

Crop analysis summarizes purchase, sale, expense, and balance data by crop or all crops.

Metrics:

```text
purchaseWeight = sum purchase.netWeight
purchaseMaund = purchaseWeight / 40
purchaseAmount = sum purchase.netPayableAmount
purchaseAverageRate = purchaseAmount / purchaseMaund
purchaseBalance = purchaseAmount - purchasePaid

saleWeight = sum sale.netWeight
saleMaund = saleWeight / 40
saleAmount = sum sale.amount
saleAverageRate = saleAmount / saleMaund
saleBalance = saleAmount - saleReceived

netWeight = purchaseWeight - saleWeight
netMaund = netWeight / 40
totalExpenses = sum crop expenses
effectiveCostPerMaund = (purchaseAmount + totalExpenses) / purchaseMaund
netProfitLoss = saleAmount - purchaseAmount - totalExpenses
remainingAmount = purchaseBalance - saleBalance
```

This dashboard metric is a simple crop-level view. Formal financial reports use FIFO COGS for sold stock.

## 16. Exports and Backup

Excel exports are available for:

- Purchases.
- Sales.
- Farmer payments.
- Buyer payments.
- Farmers.
- Buyers.
- Farmer ledgers.
- Buyer ledgers.
- Expenses.
- Capital accounts and transactions.
- Bookkeeping journal.
- Reports.
- Full business export.

JSON backup:

```text
AgriSys_Backup_<date>.json
```

JSON restore replaces current local data after confirmation.

## 17. Formatting and Localization

Currency is shown as PKR with Pakistani comma grouping:

```text
125000.00 -> 1,25,000.00
```

Dates use Pakistani English formatting for display.

## 18. Business Rules Summary

- Purchases increase inventory and farmer payable.
- Sales decrease inventory and increase buyer receivable.
- Farmer payments reduce farmer payable.
- Buyer receipts reduce buyer receivable.
- Purchase-linked expenses increase inventory lot cost.
- Operating expenses reduce net profit.
- Capital accounts track cash/bank movement independently.
- Farmer advances are separate from purchase payments until deducted.
- Sale cannot be saved if stock is insufficient.
- Paid status automatically sets full payment amount.
- Partial payments update status to partial.
- A record with zero or invalid weight/rate is rejected.
- Season filters restrict most screens to the active season date range.

## 19. Practical End-to-End Flow

1. Configure business settings, crops, expense types, and default deductions.
2. Create or select an active season if seasonal reporting is needed.
3. Add capital accounts if cash/bank tracking is needed.
4. Add farmers and buyers, or let the system auto-create them during entry.
5. Record purchases from farmers.
6. Generate purchase receipts for farmer and shop records.
7. Record expenses and link them to crop or purchase receipt where needed.
8. Record sales to buyers after stock is available.
9. Generate sale receipts or invoices for buyer and shop records.
10. Record later farmer payments and buyer receipts.
11. Review farmers, buyers, ledgers, stock, and crop analysis.
12. Export PDFs, Excel files, or full JSON backups.
13. Use reports for P&L, Balance Sheet, Cash Flow, and crop profitability.

## 20. Current Implementation Notes

- Payment entries are stored and reflected in ledgers, but standalone payment receipt PDFs are not currently implemented.
- Purchase receipt PDF and sale receipt PDF are implemented.
- Farmer ledger PDF and buyer ledger PDF are implemented.
- FIFO COGS is used in financial reports.
- Crop analysis dashboard uses a simpler crop-level total method.
- Data is local to the browser unless exported or backed up.
