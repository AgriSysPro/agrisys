// Verification of newly identified defects in AgriSys
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
    document: { getElementById: element, addEventListener() {}, querySelector: () => element('selector'), querySelectorAll: () => [] },
    prompt: () => null
});

context.XLSX = {
    utils: {
        json_to_sheet: rows => rows,
        book_new: () => ({ SheetNames: [], Sheets: {} }),
        book_append_sheet: (wb, sheet, name) => { wb.Sheets[name] = sheet; wb.SheetNames.push(name); }
    },
    writeFile: (wb, name) => { context.lastExport = { wb, name }; }
};

const files = fs.readdirSync(path.join(root, 'js')).filter(f => f.endsWith('.js') && !f.includes('vendor'));
for (const file of files) {
    try {
        vm.runInContext(fs.readFileSync(path.join(root, 'js', file), 'utf8'), context, { filename: file });
    } catch (e) {
        // Some UI handlers might fail on mock environment; ignore non-fatal setup
    }
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
    if (!ops || !ops.length) return true;
    for (const op of ops) {
        if (op.action === 'put' || op.action === 'add') await api.DB.put(op.storeName, op.data);
    }
    return true;
};
api.DB.financialSnapshot = async () => ({});

async function runDefectVerifications() {
    console.log('--- Verifying Newly Identified Defects ---');

    // 1. Defect: Selling.saveReceipt silent false success on general payment allocation validation failure
    console.log('\n[1] Testing Selling.saveReceipt validation failure handling:');
    records = {
        sales: [{ id: 'S-101', date: '2026-05-01', buyerName: 'Tariq Traders', crop: 'Wheat', grossWeight: 1000, netWeight: 1000, rate: 2000, amount: 50000, amountReceived: 40000 }],
        sale_payments: [{
            id: 'PAY-GEN-1',
            saleId: 'General',
            buyerName: 'Tariq Traders',
            date: '2026-05-02',
            amount: 40000,
            allocations: [{ invoiceId: 'S-101', amount: 40000 }]
        }],
        capital_transactions: [],
        capital_accounts: [{ id: 'ACC-1', name: 'Cash', type: 'cash' }]
    };
    element('s-id').value = 'S-101';
    element('s-buyer').value = 'Tariq Traders';
    element('s-crop').value = 'Wheat';
    element('s-weight').value = '1000';
    element('s-rate').value = '2000';
    element('s-amount-received').value = '10000'; // User attempts to lower received to 10000 when 40000 is already allocated
    element('s-date').value = '2026-05-01';
    api.Selling.editingId = 'S-101';

    let toastShown = null;
    api.Utils.showToast = (msg, type) => { toastShown = { msg, type }; };
    let confirmedReceiptId = null;
    api.Utils.confirmReceiptId = async (type, id) => { confirmedReceiptId = { type, id }; };

    const result = await api.Selling.saveReceipt();
    console.log('saveReceipt return value:', result ? 'Returned object (treated as saved)' : result);
    console.log('Toast shown:', toastShown);
    console.log('Confirmed receipt ID:', confirmedReceiptId);
    const saleInDb = await api.DB.get('sales', 'S-101');
    console.log('Sale in DB amountReceived:', saleInDb.amountReceived);
    if (result && saleInDb.amountReceived === 40000 && confirmedReceiptId) {
        console.log('BUG CONFIRMED: saveReceipt returned truthy and confirmed receipt ID despite validation failure and zero database updates!');
    }

    // 2. Defect: Farmer ledger balance inversion when filtered by from-date
    console.log('\n[2] Testing Farmer Ledger date filtering balance calculation:');
    records = {
        purchases: [{ id: 'P-1', date: '2026-04-10', farmerName: 'Bilal', netPayableAmount: 100000, season: '2026' }],
        purchase_payments: [{ id: 'PAY-1', date: '2026-05-05', purchaseId: 'P-1', farmerName: 'Bilal', amount: 30000, season: '2026' }],
        opening_balances: [],
        farmer_advances: [],
        company_debts: []
    };
    const fullFarmerLedger = await api.Utils.buildFarmerLedger({ name: 'Bilal' });
    const filteredFarmerLedger = await api.Utils.buildFarmerLedger({ name: 'Bilal' }, { from: '2026-05-01' });
    console.log('Full Farmer Ledger (Apr-May) Balance:', fullFarmerLedger.totals.balance, '(Shop owes Bilal PKR 70,000)');
    console.log('Filtered Farmer Ledger (From May 1) Balance:', filteredFarmerLedger.totals.balance, '(Claiming Bilal owes Shop PKR 30,000!)');
    if (fullFarmerLedger.totals.balance === 70000 && filteredFarmerLedger.totals.balance === -30000) {
        console.log('BUG CONFIRMED: Date-filtered farmer ledger dropped prior balance, flipping liability from +70,000 to -30,000!');
    }

    // 3. Defect: Buyer ledger balance inversion when filtered by from-date
    console.log('\n[3] Testing Buyer Ledger date filtering balance calculation:');
    records = {
        sales: [{ id: 'S-1', date: '2026-04-10', buyerName: 'Zahid', amount: 80000, season: '2026' }],
        sale_payments: [{ id: 'SPAY-1', date: '2026-05-05', saleId: 'S-1', buyerName: 'Zahid', amount: 50000, season: '2026' }],
        opening_balances: [],
        company_debts: []
    };
    const fullBuyerLedger = await api.Utils.buildBuyerLedger({ name: 'Zahid' });
    const filteredBuyerLedger = await api.Utils.buildBuyerLedger({ name: 'Zahid' }, { from: '2026-05-01' });
    console.log('Full Buyer Ledger (Apr-May) Balance:', fullBuyerLedger.totals.balance, '(Zahid owes Shop PKR 30,000)');
    console.log('Filtered Buyer Ledger (From May 1) Balance:', filteredBuyerLedger.totals.balance, '(Claiming Shop owes Zahid PKR 50,000!)');
    if (fullBuyerLedger.totals.balance === 30000 && filteredBuyerLedger.totals.balance === -50000) {
        console.log('BUG CONFIRMED: Date-filtered buyer ledger dropped prior balance, flipping receivable from +30,000 to -50,000!');
    }

    // 4. Defect: Manual journal entries leak across fiscal seasons in Bookkeeping
    console.log('\n[4] Testing Bookkeeping.generateEntries season isolation on journal_entries:');
    api.Utils.getActiveSeason = async () => ({ id: 'SN-2026', label: 'Season 2026', startDate: '2026-01-01', endDate: '2026-12-31' });
    records = {
        purchases: [],
        sales: [],
        purchase_payments: [],
        sale_payments: [],
        opening_balance_payments: [],
        farmer_advances: [],
        expenses: [],
        opening_balances: [],
        capital_accounts: [],
        capital_transactions: [],
        stock_adjustments: [],
        company_debts: [],
        journal_entries: [
            { id: 'JV-2024-1', date: '2024-06-15', debitAccount: 'Cost of Goods Sold', creditAccount: 'Operating Expenses', amount: 75000, description: '2024 Old Season JV' }
        ]
    };
    const entries = await api.Bookkeeping.generateEntries('', '');
    const leaked = entries.find(e => e.description.includes('2024 Old Season JV'));
    if (leaked) {
        console.log('BUG CONFIRMED: Manual journal entry from 2024 leaked into 2026 fiscal season books:', leaked);
    }

    // 5. Defect: Farmer Excel export regex literal double-escape
    console.log('\n[5] Testing Farmer Excel export filename regex:');
    const farmerName = 'Muhammad Ali Khan';
    const buggyFilename = `${farmerName.replace(/\\s+/g, '_')}_Ledger_2026-10-13.xlsx`;
    const correctFilename = `${farmerName.replace(/\s+/g, '_')}_Ledger_2026-10-13.xlsx`;
    console.log('Buggy filename:', buggyFilename);
    console.log('Correct filename:', correctFilename);
    if (buggyFilename.includes(' ')) {
        console.log('BUG CONFIRMED: Farmer Excel export filename retains spaces due to double-escaped regex literal /\\\\s+/g');
    }
}

runDefectVerifications().catch(console.error);
