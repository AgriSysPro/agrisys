// Regression tests: all records and DOM elements below are in memory.
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
const context = vm.createContext({ console: { log() {}, warn() {}, error() {} }, structuredClone, Date, Math,
    setTimeout() {}, location: { reload() {} }, window: {},
    document: { getElementById: element, addEventListener() {}, querySelector: () => element('selector'), querySelectorAll: () => [] } });
const files = fs.readdirSync(path.join(root, 'js')).filter(f => f.endsWith('.js'));
for (const file of files) vm.runInContext(fs.readFileSync(path.join(root, 'js', file), 'utf8'), context, { filename: file });
const api = vm.runInContext('({DB, Utils, Reports, Selling, Purchasing, PurchasePayments, SalePayments, BankAccounts, CoreServices, SeasonManager, Farmers, Buyers, Bookkeeping, PartnersMgmt, Settings, PaymentService, InventoryLots, PurchaseList, SaleList})', context);
const originalImport = api.DB.importAll;
const originalBuyerRender = api.Buyers.render;
let records = {}, seq = 0;
const clone = value => value == null ? value : structuredClone(value);
const key = r => r.id ?? r.key ?? r.crop ?? r.seasonId;
api.DB.getAll = async store => clone((records[store] || []).filter(r => !r.isDeleted));
api.DB.get = async (store, id) => clone((records[store] || []).find(r => key(r) === id && !r.isDeleted));
api.DB.getByIndex = async (store, field, value) => (await api.DB.getAll(store)).filter(r => r[field] === value);
api.DB.getByDateRange = async (store, from, to) => (await api.DB.getAll(store)).filter(r => (!from || r.date >= from) && (!to || r.date <= to));
api.DB.put = async (store, data) => { const rows = records[store] ||= []; const i = rows.findIndex(r => key(r) === key(data)); if (i < 0) rows.push(clone(data)); else rows[i] = clone(data); };
api.DB.delete = async (store, id) => { const r = await api.DB.get(store, id); if (r) await api.DB.put(store, { ...r, isDeleted: true }); };
api.DB.clear = async store => { records[store] = []; };
api.DB.commitUnitOfWork = async ops => { for (const op of ops) { if (op.action === 'put' || op.action === 'add') { if (op.action === 'add' && (records[op.storeName] || []).some(r => key(r) === key(op.data))) throw new Error('Duplicate key'); await api.DB.put(op.storeName, op.data); } else if (op.softDelete) await api.DB.delete(op.storeName, op.key); else records[op.storeName] = (records[op.storeName] || []).filter(r => key(r) !== op.key); } };
// Serialize mocked commits and enforce the same optimistic guard as IndexedDB.
const unguardedCommit = api.DB.commitUnitOfWork;
let commitQueue = Promise.resolve();
api.DB.commitUnitOfWork = (ops, expected) => {
    const result = commitQueue.then(async () => {
        if (expected) for (const [name, rows] of Object.entries(expected)) {
            if (JSON.stringify((records[name] || []).filter(r => !r.isDeleted)) !== JSON.stringify(rows)) {
                const error = new Error('Records changed'); error.code = 'CONFLICT'; throw error;
            }
        }
        return unguardedCommit(ops);
    });
    commitQueue = result.catch(() => {});
    return result;
};
api.Utils.generateId = () => `test-${++seq}`;
api.Utils.getNextReceiptId = async () => String(++seq);
api.Utils.showToast = api.Utils.showModal = api.Utils.hideModal = api.Utils.audit = () => {};
api.Utils.confirm = async () => true;
api.Utils.populateCapitalAccountSelect = async () => {};
api.Utils.getActiveSeason = async () => (records.seasons || []).find(s => s.active) || null;
for (const module of [api.PurchasePayments, api.SalePayments, api.BankAccounts, api.Farmers, api.Buyers]) module.render = async () => {};
api.SeasonManager.renderSidebarBadge = async () => {};
const results = [];
async function check(name, fn) {
    records = {}; elements.clear(); api.PaymentService.busy = false;
    try { await fn(); results.push({ name, status: 'PASS' }); }
    catch (e) { results.push({ name, status: 'FAIL', error: e.message }); }
}
function form(values) { for (const [id, value] of Object.entries(values)) element(id).value = String(value); }
const purchase = (id, extra = {}) => ({ id, farmerName: 'Ali', crop: 'Wheat', date: '2026-01-01', netWeight: 100, amount: 100, netPayableAmount: 100, amountPaid: 0, initialPaymentAmount: 0, paymentStatus: 'pending', ...extra });
const sale = (id, extra = {}) => ({ id, buyerName: 'Ali', crop: 'Wheat', date: '2026-01-01', netWeight: 100, amount: 100, amountReceived: 0, initialReceiptAmount: 0, paymentStatus: 'pending', ...extra });
(async () => {
    await check('General farmer payment is double counted and deletion leaves second invoice paid', async () => {
        records.purchases = [purchase('P1'), purchase('P2')];
        form({ 'dpay-party-name': 'Ali', 'dpay-amount': 200, 'dpay-deduct-adv': 0, 'dpay-account': 'cash', 'dpay-date': '2026-02-01' });
        await api.PurchasePayments.saveDirectPayment();
        const ledger = await api.Utils.buildFarmerLedger('Ali');
        assert.equal(ledger.totals.debit, 200);
        const payment = records.purchase_payments[0];
        await api.PurchasePayments.deletePayment(payment.id);
        assert.equal((await api.DB.get('purchases', 'P2')).amountPaid, 0);
        assert.equal((await api.DB.getAll('capital_transactions')).length, 0);
    });
    await check('General buyer receipt is double counted and deletion leaves second invoice received', async () => {
        records.sales = [sale('S1'), sale('S2')];
        form({ 'dpay-party-name': 'Ali', 'dpay-amount': 200, 'dpay-deduct-adv': 0, 'dpay-account': 'cash', 'dpay-date': '2026-02-01' });
        await api.SalePayments.saveDirectPayment();
        const ledger = await api.Utils.buildBuyerLedger('Ali');
        assert.equal(ledger.totals.credit, 200);
        await api.SalePayments.deletePayment(records.sale_payments[0].id);
        assert.equal((await api.DB.get('sales', 'S2')).amountReceived, 0);
        assert.equal((await api.DB.getAll('capital_transactions')).length, 0);
    });
    await check('Historical reports treat a future payment as an initial payment', async () => {
        records.purchases = [purchase('P1', { amountPaid: 100 })];
        records.purchase_payments = [{ id: 'PAY', purchaseId: 'P1', amount: 100, date: '2026-02-01' }];
        const scoped = await api.Reports.getScopedData('', '2026-01-31');
        assert.equal(api.Utils.paymentTotalFor(scoped.purchases[0], scoped.purchasePayments, 'purchaseId', 'amountPaid', '2026-01-31'), 0);
    });
    await check('Season carry-forward doubles report inventory', async () => {
        records.purchases = [purchase('P1')];
        const season = { id: 'SN', label: 'New', startDate: '2026-02-01', endDate: '2026-12-31', active: true };
        await api.SeasonManager.carryForwardInventory(season);
        records.seasons = [season];
        const scoped = await api.Reports.getScopedData('2026-02-01', '2026-02-28');
        const lots = api.Utils.calculateInventoryLots(scoped.purchases, scoped.sales);
        assert.equal(lots.Wheat.inventoryWeight, 100);
    });
    await check('Season carry-forward loses opening stock and stock adjustments', async () => {
        records.stock_adjustments = [{ id: 'OB', direction: 'opening', crop: 'Wheat', weight: 100, value: 100, date: '2026-01-01' }];
        await api.SeasonManager.carryForwardInventory({ label: 'New', startDate: '2026-02-01' });
        assert.equal((records.purchases || []).length, 1);
    });
    await check('FIFO consumes a purchase dated after the sale', async () => {
        const lots = api.Utils.calculateInventoryLots([purchase('P1', { date: '2026-02-01' })], [sale('S1')]);
        assert.equal(lots.Wheat.oversoldWeight, 100);
        assert.equal(lots.Wheat.inventoryWeight, 100);
    });
    await check('Crop case normalization is undone by report COGS lookup', async () => {
        const sales = [sale('S1', { crop: 'wheat' })];
        const lots = api.Utils.calculateInventoryLots([purchase('P1')], sales);
        assert.equal(lots.Wheat.cogs, 100);
        assert.equal(api.Reports.cogsForSales(sales, lots), 100);
    });
    await check('Zero net payable falls back to gross amount', async () => {
        assert.equal(api.Utils.purchasePayableAmount(purchase('P1', { netPayableAmount: 0, advanceDeducted: 100 })), 0);
    });
    await check('Deleting initial bank payment deletes the purchase but leaves stock and later payments', async () => {
        records.purchases = [purchase('P1')];
        records.purchase_payments = [{ id: 'PAY', purchaseId: 'P1', amount: 20 }];
        records.warehouse_stock = [{ crop: 'wheat', netWeight: 100 }];
        records.capital_transactions = [{ id: 'TX', sourceStore: 'purchases', sourceId: 'P1', amount: 10 }];
        await api.BankAccounts.deleteTx('TX');
        assert.equal((await api.DB.get('purchases', 'P1')).id, 'P1');
        assert.equal((await api.DB.getAll('capital_transactions')).length, 1);
        assert.equal((await api.DB.getAll('purchase_payments')).length, 1);
        assert.equal(await api.CoreServices.getAvailableStock('Wheat'), 100);
    });
    await check('Clear all data leaves stock and party caches intact', async () => {
        records.warehouse_stock = [{ crop: 'wheat', netWeight: 100 }];
        records.party_running_balances = [{ id: 'buyer_ali', balance: 100 }];
        await api.Settings.clearAll();
        assert.equal(await api.CoreServices.getAvailableStock('Wheat'), 0);
        assert.equal(await api.CoreServices.getBuyerBalance('Ali'), 0);
    });
    await check('Migration ignores actual stock adjustment schema', async () => {
        records.stock_adjustments = [{ id: 'ADJ', direction: 'increase', crop: 'Wheat', weight: 100, value: 100 }];
        await api.CoreServices.runMaterializedViewMigrations();
        assert.equal(await api.CoreServices.getAvailableStock('Wheat'), 100);
    });
    await check('Buyer deposit is deducted twice from buyer balance', async () => {
        records.buyers = [{ id: 'B1', name: 'Ali' }];
        records.sales = [sale('S1', { amountReceived: 100 })];
        records.opening_balances = [{ id: 'OB', type: 'buyer_advance', partyName: 'Ali', amount: 100, date: '2026-01-01' }];
        records.sale_payments = [{ id: 'PAY', buyerName: 'Ali', saleId: 'S1', amount: 100, advanceDeducted: 100, netCashAmount: 0, date: '2026-01-02' }];
        const ledger = await api.Utils.buildBuyerLedger('Ali');
        assert.equal(ledger.totals.balance, 0);
    });
    await check('Cash flow treats advance settlement as cash receipt', async () => {
        records.sales = [sale('S1', { amountReceived: 100 })];
        records.sale_payments = [{ id: 'PAY', saleId: 'S1', amount: 100, advanceDeducted: 100, netCashAmount: 0, date: '2026-02-01' }];
        form({ 'rp-from': '2026-02-01', 'rp-to': '2026-02-28' });
        await api.Reports.generateCashFlow();
        assert.doesNotMatch(element('report-content').innerHTML, /PKR 100\.00/);
        assert.match(element('report-content').innerHTML, /Cash received from Buyers<\/span><span[^>]*>PKR 0\.00/);
    });
    await check('Partner profit excludes stock adjustment cost', async () => {
        records.stock_adjustments = [{ id: 'OB', direction: 'opening', crop: 'Wheat', weight: 100, value: 100, date: '2026-01-01' }];
        records.sales = [sale('S1', { date: '2026-02-01', amount: 200 })];
        assert.equal(await api.PartnersMgmt.getBusinessNetProfit(), 100);
    });
    await check('Renaming farmer disconnects existing purchase ledger', async () => {
        records.farmers = [{ id: 'F1', name: 'Ali' }]; records.purchases = [purchase('P1')];
        form({ 'fm-name': 'Ali Khan' }); element('fm-name').dataset.editId = 'F1';
        await api.Farmers.save();
        const ledger = await api.Utils.buildFarmerLedger(records.farmers[0]);
        assert.equal(ledger.rows.length, 1);
    });
    await check('Buyer general payment input invokes the farmer handler', async () => {
        records.sales = [sale('S1')];
        await api.SalePayments.showDirectPaymentModal();
        element('dpay-party-name').value = 'Ali';
        const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
        const tag = html.match(/<input[^>]*id="dpay-party-name"[^>]*>/)[0];
        const handler = tag.match(/oninput="([^"]+)"/)[1];
        await vm.runInContext(handler, context);
        assert.equal(element('dpay-total-bal').textContent, 'PKR 100.00');
    });
    await check('Editing farmer payment offers already adjusted advance twice', async () => {
        records.purchases = [purchase('P1', { amountPaid: 50 })];
        records.farmer_advances = [{ id: 'ADV', farmerName: 'Ali', amount: 50, date: '2026-01-01' }];
        records.purchase_payments = [{ id: 'PAY', purchaseId: 'P1', farmerName: 'Ali', amount: 50, advanceDeducted: 50, netCashAmount: 0, date: '2026-01-02' }];
        await api.PurchasePayments.editPayment('PAY');
        assert.equal(api.PurchasePayments.currentOpenAdvance, 50);
    });
    await check('Purchase edit accepts a cumulative paid amount below existing linked payments', async () => {
        records.purchase_payments = [{ id: 'PAY', purchaseId: 'P1', amount: 50 }];
        const data = purchase('P1', { grossWeight: 100, rate: 40, amountPaid: 0 });
        assert.equal(await api.Purchasing.validate(data), false);
    });
    await check('Older backup restore leaves later stores and both materialized caches untouched', async () => {
        let includedStores;
        api.DB.db = { transaction(stores) {
            includedStores = stores;
            const tx = { objectStore: name => ({ clear() { records[name] = []; }, put(data) { (records[name] ||= []).push(clone(data)); } }) };
            queueMicrotask(() => tx.oncomplete());
            return tx;
        } };
        records.company_debts = [{ id: 'NEW', amount: 500 }];
        records.warehouse_stock = [{ crop: 'wheat', netWeight: 100 }];
        records.party_running_balances = [{ id: 'buyer_ali', balance: 100 }];
        await assert.rejects(originalImport.call(api.DB, { _version: 4, purchases: [] }), /Incomplete backup/);
        const legacy = { _version: 4 };
        for (const store of ['settings', 'purchases', 'farmers', 'purchase_payments', 'sales', 'sale_payments', 'expenses', 'capital_accounts', 'capital_transactions', 'buyers', 'farmer_advances', 'seasons']) legacy[store] = [];
        await originalImport.call(api.DB, legacy);
        assert.ok(includedStores.includes('company_debts'));
        assert.equal(records.company_debts.length, 0);
        assert.equal(records.warehouse_stock.length, 0);
        assert.equal(records.party_running_balances.length, 0);
    });
    await check('Farmer overpayment posts cash twice in bookkeeping', async () => {
        records.purchases = [purchase('P1', { amountPaid: 100 })];
        records.purchase_payments = [{ id: 'PAY', farmerName: 'Ali', purchaseId: 'P1', amount: 100, excessAdvance: 50, netCashAmount: 150, date: '2026-02-01' }];
        records.farmer_advances = [{ id: 'ADV', farmerName: 'Ali', amount: 50, sourceStore: 'purchase_payments', sourceId: 'PAY', date: '2026-02-01' }];
        const entries = await api.Bookkeeping.generateEntries('', '');
        const cashCredit = entries.filter(e => e.account === 'Cash / Bank').reduce((sum, e) => sum + (e.credit || 0), 0);
        assert.equal(cashCredit, 150);
        assert.equal(entries.reduce((sum, e) => sum + (e.credit || 0) - (e.debit || 0), 0), 0);
    });
    await check('Partner transaction commits then crashes on nonexistent closeModal', async () => {
        records.partners = [{ id: 'PARTNER', name: 'Ali', sharePercentage: 50 }];
        form({ 'partner-tx-type': 'contribution', 'partner-tx-partner': 'PARTNER', 'partner-tx-amount': 100, 'partner-tx-date': '2026-01-01', 'partner-tx-account': 'cash' });
        await api.PartnersMgmt.saveTx();
        assert.equal(records.partner_transactions.length, 1);
        assert.equal(records.capital_transactions.length, 1);
    });
    await check('General payment edit reallocates and replaces cash exactly once', async () => {
        records.purchases = [purchase('P1'), purchase('P2')];
        const first = await api.PaymentService.save('farmer', { name: 'Ali', amount: 200, advance: 0, date: '2026-02-01', accountId: 'cash' });
        const edited = await api.PaymentService.save('farmer', { paymentId: first.id, name: 'Ali', amount: 150, advance: 0, date: '2026-02-01', accountId: 'cash' });
        assert.deepEqual(clone(edited.allocations), [{ invoiceId: 'P1', amount: 100 }, { invoiceId: 'P2', amount: 50 }]);
        assert.equal((await api.DB.get('purchases', 'P2')).amountPaid, 50);
        assert.equal((await api.DB.getAll('capital_transactions')).length, 1);
        assert.equal((await api.DB.getAll('capital_transactions'))[0].amount, 150);
        assert.equal((await api.Utils.buildFarmerLedger('Ali')).totals.balance, 50);
        await api.PaymentService.remove('farmer', first.id);
        assert.equal((await api.DB.get('purchases', 'P1')).amountPaid, 0);
        assert.equal((await api.DB.get('purchases', 'P2')).amountPaid, 0);
        assert.equal((await api.DB.getAll('capital_transactions')).length, 0);
    });
    await check('Legacy bank linkage reverses on payment edit and deletion', async () => {
        records.sales = [sale('S1', { amountReceived: 40 })];
        records.sale_payments = [{ id: 'PAY', saleId: 'S1', buyerName: 'Ali', amount: 40, netCashAmount: 40, capitalTxId: 'TX', date: '2026-02-01' }];
        records.capital_transactions = [{ id: 'TX', category: 'sale_payment', referenceId: 'PAY', amount: 40 }];
        await api.PaymentService.save('buyer', { paymentId: 'PAY', invoiceId: 'S1', name: 'Ali', amount: 30, advance: 0, date: '2026-02-01', accountId: 'cash' });
        assert.equal((await api.DB.getAll('capital_transactions')).length, 1);
        assert.equal((await api.DB.getAll('capital_transactions'))[0].amount, 30);
        await api.PaymentService.remove('buyer', 'PAY');
        assert.equal((await api.DB.getAll('capital_transactions')).length, 0);
        assert.equal((await api.DB.get('sales', 'S1')).amountReceived, 0);
    });
    await check('Partial buyer deposit remains available and buyer totals agree', async () => {
        records.buyers = [{ id: 'B', name: 'Ali' }];
        records.sales = [sale('S1')];
        records.opening_balances = [{ id: 'OB', type: 'buyer_advance', partyName: 'Ali', amount: 80, date: '2026-01-01' }];
        const payment = await api.PaymentService.save('buyer', { name: 'Ali', invoiceId: 'S1', amount: 50, advance: 30, date: '2026-02-01', accountId: 'cash' });
        assert.equal(payment.netCashAmount, 20);
        assert.equal(await api.PaymentService.availableAdvance('buyer', 'Ali'), 50);
        assert.equal((await api.Utils.buildBuyerLedger('Ali')).totals.balance, 0);
        await originalBuyerRender.call(api.Buyers);
        assert.match(element('buyers-tbody').innerHTML, /PKR 0\.00/);
        await api.PaymentService.remove('buyer', payment.id);
        assert.equal(await api.PaymentService.availableAdvance('buyer', 'Ali'), 80);
        assert.equal((await api.DB.get('sales', 'S1')).amountReceived, 0);
    });
    await check('Cashless deposit deletion leaves cached buyer balance correct', async () => {
        records.sales = [sale('S1')];
        records.opening_balances = [{ id: 'OB', type: 'buyer_advance', partyName: 'Ali', amount: 100, date: '2026-01-01' }];
        const payment = await api.PaymentService.save('buyer', { name: 'Ali', invoiceId: 'S1', amount: 100, advance: 100, date: '2026-02-01' });
        assert.equal(await api.CoreServices.getBuyerBalance('Ali'), 0);
        await api.PaymentService.remove('buyer', payment.id);
        assert.equal(await api.CoreServices.getBuyerBalance('Ali'), 0);
    });
    await check('Farmer overpayment creates one cash transaction and a balanced journal', async () => {
        records.purchases = [purchase('P1')];
        const payment = await api.PaymentService.save('farmer', { name: 'Ali', amount: 150, advance: 0, date: '2026-02-01', accountId: 'cash' });
        assert.equal(payment.excessAdvance, 50);
        assert.equal((await api.DB.getAll('capital_transactions')).length, 1);
        const entries = await api.Bookkeeping.generateEntries('', '');
        assert.equal(entries.reduce((s, e) => s + (e.debit || 0) - (e.credit || 0), 0), 0);
        assert.equal(entries.filter(e => e.account === 'Cash / Bank').reduce((s, e) => s + (e.credit || 0), 0), 150);
        await api.PaymentService.remove('farmer', payment.id);
        assert.equal((await api.DB.getAll('farmer_advances')).length, 0);
    });
    await check('Reject invalid advances, excess buyer receipts, and ambiguous legacy allocations', async () => {
        records.sales = [sale('S1')];
        await assert.rejects(api.PaymentService.save('buyer', { name: 'Ali', amount: 150, advance: 0, date: '2026-02-01', accountId: 'cash' }), /exceeds pending/);
        await assert.rejects(api.PaymentService.save('buyer', { name: 'Ali', amount: 100, advance: -10, date: '2026-02-01', accountId: 'cash' }), /valid advance/);
        await assert.rejects(api.PaymentService.reversalOps('buyer', { saleId: 'S1', notes: 'General buyer receipt', amount: 100 }), /legacy general/);
        assert.equal((await api.DB.get('sales', 'S1')).amountReceived, 0);
        assert.equal((await api.DB.getAll('capital_transactions')).length, 0);
    });
    await check('Backdated stock validation excludes future purchases', async () => {
        records.purchases = [purchase('P1', { date: '2026-02-01' })];
        assert.equal(await api.Selling.getAvailableStock('Wheat', null, '2026-01-01'), 0);
        assert.equal(await api.Selling.getAvailableStock('Wheat', null, '2026-02-01'), 100);
    });
    await check('Historic legacy payment reconstruction keeps future events separate', async () => {
        const p = purchase('P1', { amountPaid: 70 }); delete p.initialPaymentAmount;
        records.purchases = [p];
        records.purchase_payments = [{ id: 'PAY', purchaseId: 'P1', amount: 50, date: '2026-02-01' }];
        const scoped = await api.Reports.getScopedData('', '2026-01-31');
        assert.equal(api.Utils.paymentTotalFor(scoped.purchases[0], scoped.purchasePayments, 'purchaseId', 'amountPaid', '2026-01-31'), 20);
    });
    await check('Party rename updates payments, advances, and openings atomically and rejects duplicates', async () => {
        records.farmers = [{ id: 'F', name: 'Ali' }, { id: 'F2', name: 'Other' }];
        records.purchase_payments = [{ id: 'PAY', farmerName: 'Ali', amount: 30 }];
        records.farmer_advances = [{ id: 'ADV', farmerName: 'Ali', amount: 30 }];
        records.opening_balances = [{ id: 'OB', type: 'farmer_payable', partyName: 'Ali', amount: 20 }];
        await assert.rejects(api.Utils.renamePartyOps('farmer', 'F', 'Other'), /already exists/);
        const ops = await api.Utils.renamePartyOps('farmer', 'F', 'Ali Khan');
        await api.DB.commitUnitOfWork(ops);
        assert.equal(records.purchase_payments[0].farmerName, 'Ali Khan');
        assert.equal(records.farmer_advances[0].farmerName, 'Ali Khan');
        assert.equal(records.opening_balances[0].partyName, 'Ali Khan');
    });
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
    const duplicates = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
    const handlerReferences = [...html.matchAll(/\bon\w+="([^"]+)"/g)].flatMap(m => [...m[1].matchAll(/\b([A-Z]\w*)\.(\w+)\s*\(/g)].map(r => `${r[1]}.${r[2]}`));
    const undefinedHandlers = [...new Set(handlerReferences)].filter(ref => { try { return vm.runInContext(`typeof ${ref}`, context) !== 'function'; } catch { return true; } });
    const vendorFiles = fs.readdirSync(path.join(root, 'js', 'vendor')).filter(f => f.endsWith('.js'));
    for (const file of vendorFiles) new vm.Script(fs.readFileSync(path.join(root, 'js', 'vendor', file), 'utf8'), { filename: file });
    const missingLocalScripts = [...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map(m => m[1]).filter(src => !fs.existsSync(path.join(root, src)));
    const result = { parsedApplicationModules: files.length, parsedVendorModules: vendorFiles.length, duplicateHtmlIds: duplicates, undefinedHtmlHandlers: undefinedHandlers, missingLocalScripts, reproductions: results };
    fs.writeFileSync(path.join(__dirname, 'regression-results.json'), JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify(result, null, 2));
    if (results.some(r => r.status !== 'PASS')) process.exitCode = 1;
})();
