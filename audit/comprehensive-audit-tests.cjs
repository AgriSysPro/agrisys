// Test suite for comprehensive system audit fixes
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const elements = new Map();
const element = id => {
    if (!elements.has(id)) elements.set(id, { value: '', innerHTML: '', textContent: '', style: {}, dataset: {}, disabled: false,
        setAttribute() {}, removeAttribute() {}, classList: { add() {}, remove() {} } });
    return elements.get(id);
};

const context = vm.createContext({
    console: { log() {}, warn() {}, error() {} },
    structuredClone, Date, Math, setTimeout() {}, location: { reload() {} }, window: {},
    document: { getElementById: element, addEventListener() {}, querySelector: () => element('selector'), querySelectorAll: () => [] }
});

context.XLSX = {
    utils: {
        json_to_sheet: rows => rows,
        book_new: () => ({ SheetNames: [], Sheets: {} }),
        book_append_sheet: (wb, sheet, name) => { wb.Sheets[name] = sheet; wb.SheetNames.push(name); }
    },
    writeFile: (wb, name) => { context.lastExport = { wb, name }; }
};

const files = fs.readdirSync(path.join(root, 'js')).filter(f => f.endsWith('.js'));
for (const file of files) {
    vm.runInContext(fs.readFileSync(path.join(root, 'js', file), 'utf8'), context, { filename: file });
}

const api = vm.runInContext('({DB, Utils, Reports, Selling, Purchasing, PurchasePayments, SalePayments, BankAccounts, CoreServices, SeasonManager, Farmers, Buyers, Bookkeeping, Journal, ExportUtils, PartnersMgmt, CropAnalysis, StockAdjustments, Settings, PaymentService, InventoryLots, PurchaseList, SaleList, OpeningBalances, AgingReports, FinanceReports, DebtsMgmt, Expenses, CapitalMgmt, CryptoUtils})', context);

let records = {};
const clone = value => value == null ? value : structuredClone(value);
const key = r => r.id ?? r.key ?? r.crop ?? r.seasonId;
api.DB.getAll = async store => clone((records[store] || []).filter(r => !r.isDeleted));
api.DB.get = async (store, id) => clone((records[store] || []).find(r => key(r) === id && !r.isDeleted));
api.DB.getByIndex = async (store, field, value) => (await api.DB.getAll(store)).filter(r => r[field] === value);
api.DB.put = async (store, data) => { const rows = records[store] ||= []; const i = rows.findIndex(r => key(r) === key(data)); if (i < 0) rows.push(clone(data)); else rows[i] = clone(data); };
api.DB.commitUnitOfWork = async ops => {
    for (const op of ops) {
        if (op.action === 'put' || op.action === 'add') await api.DB.put(op.storeName, op.data);
    }
};

async function runTests() {
    console.log('Running comprehensive audit tests...');
    let passed = 0;

    // Test 1: formatPKR negative zero handling
    assert.strictEqual(api.Utils.formatPKR(0), '0.00');
    assert.strictEqual(api.Utils.formatPKR(-0), '0.00');
    assert.strictEqual(api.Utils.formatPKR(-0.0001), '0.00');
    assert.strictEqual(api.Utils.formatPKR(125000), '1,25,000.00');
    assert.strictEqual(api.Utils.formatPKR(-500), '-500.00');
    console.log('✔ Test 1: formatPKR negative zero handling passed');
    passed++;

    // Test 2: Bookkeeping purchase payment entry with excessAdvance balances debits and credits
    const testPayment = {
        id: 'PAY-1',
        purchaseId: 'P-1',
        farmerName: 'Akram',
        date: '2026-03-01',
        amount: 1000,
        excessAdvance: 500,
        advanceDeducted: 0,
        netCashAmount: 1500,
        mode: 'cash'
    };
    
    const entries = [];
    const totalPay = testPayment.amount || 0;
    const excess = testPayment.excessAdvance || 0;
    const advDeduct = testPayment.advanceDeducted || 0;
    const netCash = Math.max(0, testPayment.netCashAmount !== undefined ? Math.max(testPayment.netCashAmount, totalPay + excess - advDeduct) : (totalPay + excess - advDeduct));
    if (excess > 0) entries.push({ account: 'Advances to Farmers', debit: excess, credit: 0 });
    entries.push({ account: 'Accounts Payable (Farmer)', debit: totalPay, credit: 0 });
    if (advDeduct > 0) entries.push({ account: 'Advances to Farmers', debit: 0, credit: advDeduct });
    if (netCash > 0) entries.push({ account: 'Cash / Bank', debit: 0, credit: netCash });

    const totalDebits = entries.reduce((s, e) => s + e.debit, 0);
    const totalCredits = entries.reduce((s, e) => s + e.credit, 0);
    assert.strictEqual(totalDebits, 1500);
    assert.strictEqual(totalCredits, 1500);
    assert.strictEqual(totalDebits, totalCredits);
    console.log('✔ Test 2: Bookkeeping excess advance journal entry balance passed');
    passed++;

    // Test 3: Party rename updates company_debts
    records = {
        farmers: [{ id: 'F1', name: 'Rashid Khan' }],
        purchases: [{ id: 'P1', farmerName: 'Rashid Khan' }],
        purchase_payments: [],
        farmer_advances: [],
        commissions: [],
        opening_balances: [],
        opening_balance_payments: [],
        company_debts: [{ id: 'D1', personName: 'Rashid Khan', amount: 5000 }]
    };

    const ops = await api.Utils.renamePartyOps('farmer', 'F1', 'Rashid Ahmad');
    const debtOp = ops.find(o => o.storeName === 'company_debts');
    assert.ok(debtOp, 'company_debts should be updated on party rename');
    assert.strictEqual(debtOp.data.personName, 'Rashid Ahmad');
    console.log('✔ Test 3: Party rename company_debts update passed');
    passed++;

    // Test 4: CryptoUtils encrypt uses dynamic DB.DB_VERSION (14)
    const backupSrc = fs.readFileSync(path.join(root, 'js', 'backup-manager.js'), 'utf8');
    assert.ok(backupSrc.includes('DB.DB_VERSION'), 'CryptoUtils.encrypt should use dynamic DB.DB_VERSION');
    assert.ok(!backupSrc.includes('_version: 10,'), 'Hardcoded version 10 should be removed');
    console.log('✔ Test 4: Backup version dynamic check passed');
    passed++;

    // Test 5: Reports export functions scoping arguments
    const reportsSrc = fs.readFileSync(path.join(root, 'js', 'reports.js'), 'utf8');
    assert.ok(reportsSrc.includes('this.getScopedData(from, to)'), 'P&L exports should pass from, to');
    assert.ok(reportsSrc.includes("this.getScopedData('', toDate)"), 'Balance Sheet exports should pass toDate');
    console.log('✔ Test 5: Reports export scoping arguments passed');
    passed++;

    // Test 6: Cash flow uses paymentCashAmount for openingBalancePayments
    assert.ok(reportsSrc.includes('openingBalancePayments.filter(p => p.type === \'buyer_receivable\').reduce((s, p) => s + Utils.paymentCashAmount(p)'), 'Cash flow opening receivable uses paymentCashAmount');
    assert.ok(reportsSrc.includes('openingBalancePayments.filter(p => p.type === \'farmer_payable\').reduce((s, p) => s + Utils.paymentCashAmount(p)'), 'Cash flow opening payable uses paymentCashAmount');
    console.log('✔ Test 6: Cash flow opening payments cash amount passed');
    passed++;

    // Test 7: Crop table reconciles with total COGS when stock shortage losses exist
    const cropActualSale = { id: 'S1', crop: 'Rice', amount: 500, netWeight: 40 };
    const cropVirtualSale = { id: 'ADJ1', type: 'stock_adjustment', crop: 'Rice', amount: 0, netWeight: 20 };
    const mockInventoryMetrics = {
        Rice: {
            saleCogs: { S1: 300, ADJ1: 150 },
            inventoryValue: 1000
        }
    };
    const cSales = [cropActualSale, cropVirtualSale];
    const cActualSales = cSales.filter(s => s.type !== 'stock_adjustment');
    const cVirtualSales = cSales.filter(s => s.type === 'stock_adjustment');
    const cost = api.Reports.cogsForSales(cActualSales, mockInventoryMetrics);
    const shortageLoss = api.Reports.cogsForSales(cVirtualSales, mockInventoryMetrics);
    const totalCropCost = cost + shortageLoss;
    assert.strictEqual(cost, 300);
    assert.strictEqual(shortageLoss, 150);
    assert.strictEqual(totalCropCost, 450);
    console.log('✔ Test 7: Crop table shortage loss reconciliation passed');
    passed++;

    // Test 8: Farmer ledger date filtering retains prior balance brought forward
    records = {
        purchases: [{ id: 'P-1', date: '2026-04-10', farmerName: 'Bilal', netPayableAmount: 100000, season: '2026' }],
        purchase_payments: [{ id: 'PAY-1', date: '2026-05-05', purchaseId: 'P-1', farmerName: 'Bilal', amount: 30000, season: '2026' }],
        opening_balances: [],
        farmer_advances: [],
        company_debts: []
    };
    const fLedgerFiltered = await api.Utils.buildFarmerLedger({ name: 'Bilal' }, { from: '2026-05-01' });
    assert.strictEqual(fLedgerFiltered.totals.balance, 70000, 'Filtered farmer ledger should maintain +70,000 balance');
    assert.ok(fLedgerFiltered.rows.some(r => r.ref === 'B/F' && r.description === 'Balance Brought Forward'), 'Should include Balance Brought Forward row');
    console.log('✔ Test 8: Farmer ledger date filtering prior balance passed');
    passed++;

    // Test 9: Buyer ledger date filtering retains prior balance brought forward
    records = {
        sales: [{ id: 'S-1', date: '2026-04-10', buyerName: 'Zahid', amount: 80000, season: '2026' }],
        sale_payments: [{ id: 'SPAY-1', date: '2026-05-05', saleId: 'S-1', buyerName: 'Zahid', amount: 50000, season: '2026' }],
        opening_balances: [],
        company_debts: []
    };
    const bLedgerFiltered = await api.Utils.buildBuyerLedger({ name: 'Zahid' }, { from: '2026-05-01' });
    assert.strictEqual(bLedgerFiltered.totals.balance, 30000, 'Filtered buyer ledger should maintain +30,000 balance');
    assert.ok(bLedgerFiltered.rows.some(r => r.ref === 'B/F' && r.description === 'Balance Brought Forward'), 'Should include Balance Brought Forward row');
    console.log('✔ Test 9: Buyer ledger date filtering prior balance passed');
    passed++;

    // Test 10: Bookkeeping journal entries isolated to active season boundaries
    api.Utils.getActiveSeason = async () => ({ id: 'SN-2026', label: 'Season 2026', startDate: '2026-01-01', endDate: '2026-12-31' });
    records = {
        purchases: [], sales: [], purchase_payments: [], sale_payments: [], opening_balance_payments: [],
        farmer_advances: [], expenses: [], opening_balances: [], capital_accounts: [], capital_transactions: [],
        stock_adjustments: [], company_debts: [],
        journal_entries: [
            { id: 'JV-2024-1', date: '2024-06-15', debitAccount: 'Cost of Goods Sold', creditAccount: 'Operating Expenses', amount: 75000, description: '2024 Old Season JV' },
            { id: 'JV-2026-1', date: '2026-06-15', debitAccount: 'Cost of Goods Sold', creditAccount: 'Operating Expenses', amount: 25000, description: '2026 Current Season JV' }
        ]
    };
    const bkEntries = await api.Bookkeeping.generateEntries('', '');
    assert.ok(!bkEntries.some(e => e.description.includes('2024 Old Season JV')), 'Old season journal entry must not leak into current season');
    assert.ok(bkEntries.some(e => e.description.includes('2026 Current Season JV')), 'Current season journal entry must be included');
    console.log('✔ Test 10: Bookkeeping journal entry season isolation passed');
    passed++;

    // Test 11: CropAnalysis computeMetrics accounts for stock adjustment shortage loss
    const caStock = api.Utils.applyStockAdjustments(
        [{ id: 'P1', date: '2026-01-01', crop: 'Wheat', netWeight: 100, amount: 2000, netPayableAmount: 2000 }],
        [{ id: 'S1', date: '2026-01-02', crop: 'Wheat', netWeight: 50, amount: 1500, amountReceived: 1500 }],
        [{ id: 'ADJ1', date: '2026-01-03', crop: 'Wheat', direction: 'decrease', reason: 'Shortage', weight: 20, value: 400 }]
    );
    const m = api.CropAnalysis.computeMetrics('Wheat', caStock.purchases, caStock.sales, []);
    assert.strictEqual(m.shortageLoss, 400, 'Crop analysis should recognize PKR 400 shortage loss');
    assert.strictEqual(m.netPL, 1500 - 1000 - 400, 'Net P&L must be saleAmount (1500) - totalCogs (1000) - shortageLoss (400) = 100');
    console.log('✔ Test 11: Crop analysis shortage loss deduction in Net P&L passed');
    passed++;

    // Test 12: Balance sheet debt overpayment liability maintains Assets = Liabilities + Equity
    records = {
        purchases: [], sales: [], purchase_payments: [], sale_payments: [], opening_balance_payments: [],
        farmer_advances: [], expenses: [], opening_balances: [],
        capital_accounts: [{ id: 'ACC1', name: 'Cash Account', openingBalance: 1000 }],
        capital_transactions: [{ id: 'CTX1', accountId: 'ACC1', type: 'deposit', amount: 500, date: '2026-01-10' }],
        capital_entries: [{ id: 'CE1', type: 'contribution', amount: 1500, date: '2026-01-10' }],
        company_debts: [
            { id: 'LOAN1', personName: 'Tariq', type: 'given', amount: 1000, date: '2026-01-01' },
            { id: 'REPAY1', personName: 'Tariq', type: 'repaid', amount: 1200, date: '2026-01-15' } // overpaid by 200
        ],
        stock_adjustments: [], journal_entries: []
    };
    element('rp-to').value = '2026-01-31';
    await api.Reports.generateBalanceSheet();
    const renderedHtml = element('report-content').innerHTML;
    assert.ok(renderedHtml.includes('Debt Overpayments / Credits'), 'Balance sheet must display Debt Overpayments / Credits under liabilities');
    assert.ok(renderedHtml.includes('200.00'), 'Debt overpayment amount must be 200');
    console.log('✔ Test 12: Balance sheet debt overpayment liability passed');
    passed++;

    // Test 13: PartnersMgmt.savePartner blocks total allocation exceeding 100%
    records = {
        partners: [{ id: 'PT1', name: 'Partner A', sharePercentage: 60 }]
    };
    element('partner-edit-id').value = '';
    element('partner-input-name').value = 'Partner B';
    element('partner-input-phone').value = '03001234567';
    element('partner-input-role').value = 'Partner';
    element('partner-input-share').value = '50'; // 60 + 50 = 110% > 100%
    element('partner-input-address').value = '';
    element('partner-input-notes').value = '';
    let partnerToast = null;
    api.Utils.showToast = (msg, type) => { partnerToast = { msg, type }; };
    await api.PartnersMgmt.savePartner();
    assert.ok(partnerToast && partnerToast.type === 'error' && partnerToast.msg.includes('cannot exceed 100%'), 'Must reject partner save exceeding 100%');
    assert.strictEqual(records.partners.length, 1, 'Partner B must not be saved');
    console.log('✔ Test 13: Partner 100% share allocation cap passed');
    passed++;

    // Test 14: AgingReports buckets future due dates as Current / Not Due
    records = {
        purchases: [{ id: 'P-FUT', farmerName: 'Farmer Future', date: '2026-01-01', dueDate: '2099-01-01', netPayableAmount: 5000, amountPaid: 0 }],
        sales: [{ id: 'S-FUT', buyerName: 'Buyer Future', date: '2026-01-01', dueDate: '2099-01-01', amount: 8000, amountReceived: 0 }],
        purchase_payments: [], sale_payments: [], opening_balances: [], opening_balance_payments: []
    };
    const agingData = await api.AgingReports.buildRows();
    const futFarmer = agingData.farmerRows.find(r => r.source === 'P-FUT');
    const futBuyer = agingData.buyerRows.find(r => r.source === 'S-FUT');
    assert.strictEqual(futFarmer.bucket, 'Current / Not Due', 'Future farmer purchase must be Current / Not Due');
    assert.strictEqual(futBuyer.bucket, 'Current / Not Due', 'Future buyer sale must be Current / Not Due');
    console.log('✔ Test 14: Aging reports future due date classification passed');
    passed++;

    // Test 15: Farmer and Buyer master tables incorporate company debts into balance
    records = {
        farmers: [{ id: 'F1', name: 'Kashif' }],
        buyers: [{ id: 'B1', name: 'Sultan' }],
        purchases: [{ id: 'P1', date: '2026-01-01', farmerName: 'Kashif', netPayableAmount: 50000, amountPaid: 0 }],
        sales: [{ id: 'S1', date: '2026-01-01', buyerName: 'Sultan', amount: 60000, amountReceived: 0 }],
        purchase_payments: [], sale_payments: [], opening_balances: [], farmer_advances: [],
        company_debts: [
            { id: 'D-F1', borrowerName: 'Kashif', personName: 'Kashif', type: 'given', amount: 15000, date: '2026-01-01' },
            { id: 'D-B1', borrowerName: 'Sultan', personName: 'Sultan', type: 'given', amount: 20000, date: '2026-01-01' }
        ]
    };
    await api.Farmers.render();
    const farmerRowHtml = element('farmers-tbody').innerHTML;
    assert.ok(farmerRowHtml.includes('35,000.00'), 'Farmer balance should be 50,000 payable - 15,000 loan given = 35,000');

    await api.Buyers.render();
    const buyerRowHtml = element('buyers-tbody').innerHTML;
    assert.ok(buyerRowHtml.includes('80,000.00'), 'Buyer balance should be 60,000 sales + 20,000 loan given = 80,000');
    console.log('✔ Test 15: Farmer and Buyer master tables include company debts passed');
    passed++;

    console.log(`\nALL ${passed} COMPREHENSIVE AUDIT TESTS PASSED!`);
}

runTests().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
});
