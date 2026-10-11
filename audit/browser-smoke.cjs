const { chromium } = require('C:/Users/Ch/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
(async () => {
    const browser = await chromium.launch({ channel: 'msedge', headless: true });
    const context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(pathToFileURL(path.resolve(__dirname, '../index.html')).href);
    await page.waitForFunction(() => DB.db && document.getElementById('welcome-modal').classList.contains('active'));
    const result = await page.evaluate(async () => {
        const assert = (condition, message) => { if (!condition) throw new Error(message); };
        await DB.setSetting('business', { bizName: 'Isolated Test Business', crops: 'Wheat', expenseTypes: 'Labour' });
        Utils.hideModal('welcome-modal');
        await DB.put('capital_accounts', { id: 'cash', name: 'Test Cash', type: 'cash', openingBalance: 1000 });
        for (const id of ['P1', 'P2']) await DB.put('purchases', { id, farmerName: 'Ali', crop: 'Wheat', date: '2026-01-01', netWeight: 100, amount: 100, netPayableAmount: 100, amountPaid: 0, initialPaymentAmount: 0, paymentStatus: 'pending' });
        const payment = await PaymentService.save('farmer', { name: 'Ali', amount: 200, advance: 0, date: '2026-02-01', accountId: 'cash' });
        assert(payment.allocations.length === 2, 'Two allocations missing');
        const ledger = await Utils.buildFarmerLedger('Ali');
        assert(ledger.totals.debit === 200 && ledger.totals.balance === 0, 'Ledger double counted payment');
        // Use the service's operations without user confirmation for isolated test cleanup.
        const ops = await PaymentService.reversalOps('farmer', payment);
        ops.push({ storeName: 'purchase_payments', action: 'delete', key: payment.id });
        await DB.commitUnitOfWork(ops);
        assert((await DB.get('purchases', 'P2')).amountPaid === 0, 'Second invoice not reversed');
        assert((await DB.getAll('capital_transactions')).length === 0, 'Cash not reversed');
        await CoreServices.runMaterializedViewMigrations();
        assert(await CoreServices.getAvailableStock('Wheat') === 200, 'Real IndexedDB stock rebuild failed');
        const backup = await DB.exportAll();
        await DB.put('company_debts', { id: 'new-debt', amount: 500, date: '2026-03-01' });
        await DB.importAll(backup);
        assert((await DB.getAll('company_debts')).length === 0, 'Restore merged newer records');
        assert((await DB.getAll('warehouse_stock')).length === 0, 'Restore did not clear derived stock');
        await CoreServices.runMaterializedViewMigrations();
        assert(await CoreServices.getAvailableStock('Wheat') === 200, 'Restore cache rebuild failed');
        // Verify synchronous IDB errors abort the whole replacement transaction.
        const transaction = DB.db.transaction.bind(DB.db);
        DB.db.transaction = (stores, mode) => {
            const tx = transaction(stores, mode), objectStore = tx.objectStore.bind(tx);
            tx.objectStore = name => {
                const store = objectStore(name);
                if (name === 'purchases') store.put = () => { throw new Error('Injected restore failure'); };
                return store;
            };
            return tx;
        };
        let failed = false;
        try { await DB.importAll(backup); } catch { failed = true; }
        DB.db.transaction = transaction;
        assert(failed && (await DB.getAll('purchases')).length === 2, 'Failed restore did not roll back');
        await App.populateCropSelects();
        await App.loadDashboard();
        await PartnersMgmt.showAddTx('contribution'); // expected warning with no partners
        await DB.put('partners', { id: 'partner', name: 'Test Partner', sharePercentage: 50 });
        await PartnersMgmt.showAddTx('contribution', 'partner');
        document.getElementById('partner-tx-amount').value = '100';
        document.getElementById('partner-tx-date').value = '2026-02-01';
        await PartnersMgmt.saveTx();
        assert(!document.getElementById('partner-tx-modal').classList.contains('active'), 'Partner modal did not close');
        document.getElementById('rp-from').value = '2026-01-01';
        document.getElementById('rp-to').value = '2026-02-28';
        await Reports.generateBalanceSheet();
        await Reports.generateCashFlow();
        return { status: 'PASS', checks: ['startup', 'real IndexedDB payment allocations and reversal', 'cache rebuild', 'backup replacement', 'restore rollback', 'dashboard render', 'partner save and modal close', 'balance sheet and cash flow render'] };
    });
    for (const method of ['exportBalanceSheetPDF', 'exportCashFlowPDF', 'exportPnLPDF', 'exportBalanceSheetExcel', 'exportCashFlowExcel', 'exportPnLExcel']) {
        const downloading = page.waitForEvent('download');
        await page.evaluate(method => Reports[method](), method);
        const download = await downloading;
        if (await download.failure()) throw new Error('Export failed: ' + method);
        result.checks.push(method + ': ' + download.suggestedFilename());
    }
    await page.evaluate(async () => {
        const assert = (condition, message) => { if (!condition) throw new Error(message); };
        await DB.setSetting('seq_purchase', 999999);
        await DB.setSetting('seq_sale', 999999);
        await DB.put('purchases', { id: '100004', farmerName: 'Serial test', crop: 'Wheat', date: '2026-01-01', netWeight: 10, amount: 10, amountPaid: 0 });
        await DB.put('purchases', { id: '100006', isDeleted: true });
        await DB.put('sales', { id: '200001', buyerName: 'Serial test', crop: 'Wheat', date: '2026-01-01', netWeight: 1, amount: 1, amountReceived: 0 });
        await DB.put('sales', { id: '200003', isDeleted: true });
        for (let i = 0; i < 3; i++) {
            await Purchasing.clearForm();
            await Selling.clearForm();
            assert(document.getElementById('p-id').value === '100007', 'Purchase clear consumed a number');
            assert(document.getElementById('s-id').value === '200004', 'Sale clear consumed a number');
        }
        await Purchasing.save();
        await Selling.save();
        assert(await Utils.getNextReceiptId('purchase') === '100007', 'Invalid purchase consumed a number');
        assert(await Utils.getNextReceiptId('sale') === '200004', 'Invalid sale consumed a number');
        const fill = (values) => Object.entries(values).forEach(([id, value]) => document.getElementById(id).value = value);
        fill({ 'p-farmer': 'Serial test', 'p-crop': 'Wheat', 'p-gross-weight': '40', 'p-rate': '100', 'p-bardana': '0', 'p-labour': '0', 'p-commission': '0', 'p-mandi-tax': '0' });
        const purchase = await Purchasing.save();
        assert(purchase && purchase.id === '100007', 'Purchase did not use the next saved number');
        assert(document.getElementById('p-id').value === '100008', 'Purchase save did not advance exactly once');
        fill({ 's-buyer': 'Serial test', 's-crop': 'Wheat', 's-weight': '40', 's-rate': '100' });
        const sale = await Selling.save();
        assert(sale && sale.id === '200004', 'Sale did not use the next saved number');
        assert(document.getElementById('s-id').value === '200005', 'Sale save did not advance exactly once');
        await Purchasing.loadForEdit(purchase.id);
        const editedPurchase = await Purchasing.save();
        assert(editedPurchase.id === purchase.id && await Utils.getNextReceiptId('purchase') === '100008', 'Purchase edit consumed a number');
        await Selling.loadForEdit(sale.id);
        const editedSale = await Selling.save();
        assert(editedSale.id === sale.id && await Utils.getNextReceiptId('sale') === '200005', 'Sale edit consumed a number');
        assert(await DB.getSetting('seq_purchase') === 999999 && await DB.getSetting('seq_sale') === 999999, 'Preview changed stored sequences');
        let duplicateFailed = false;
        try { await DB.commitUnitOfWork([{ storeName: 'purchases', action: 'add', data: { id: purchase.id, farmerName: 'Overwrite' } }]); } catch { duplicateFailed = true; }
        assert(duplicateFailed && (await DB.get('purchases', purchase.id)).farmerName === 'Serial test', 'Duplicate receipt overwrote an issued receipt');
    });
    result.checks.push('receipt numbers: repeated clears, invalid saves, successful saves, edits, legacy sequence inflation, deleted IDs and duplicate protection');
    const second = await context.newPage();
    await second.goto(page.url());
    await second.waitForFunction(() => DB.db);
    await page.evaluate(async () => {
        await DB.put('purchases', { id: 'RACE', farmerName: 'Race Farmer', crop: 'Wheat', date: '2026-01-01', netWeight: 100, amount: 100, netPayableAmount: 100, amountPaid: 0, initialPaymentAmount: 0 });
    });
    for (const tab of [page, second]) await tab.evaluate(() => {
        const snapshot = DB.financialSnapshot.bind(DB);
        let first = true;
        DB.financialSnapshot = async () => {
            const data = await snapshot();
            if (first) {
                first = false; window.snapshotReady = true;
                await new Promise(resolve => { window.releaseSnapshot = resolve; });
            }
            return data;
        };
    });
    const races = [page, second].map(tab => tab.evaluate(() => PaymentService.save('farmer', { name: 'Race Farmer', invoiceId: 'RACE', amount: 60, advance: 0, date: '2026-02-01', accountId: 'cash' })));
    await Promise.all([page, second].map(tab => tab.waitForFunction(() => window.snapshotReady)));
    await Promise.all([page, second].map(tab => tab.evaluate(() => window.releaseSnapshot())));
    await Promise.all(races);
    await page.evaluate(async () => {
        const assert = (condition, message) => { if (!condition) throw new Error(message); };
        const invoice = await DB.get('purchases', 'RACE');
        const payments = (await DB.getAll('purchase_payments')).filter(p => p.farmerName === 'Race Farmer');
        assert(invoice.amountPaid === 100, 'Concurrent payments lost an invoice update');
        assert(payments.reduce((s, p) => s + p.amount, 0) === 100, 'Concurrent allocations exceed invoice');
        assert(payments.reduce((s, p) => s + p.netCashAmount, 0) === 120, 'Concurrent cash total wrong');
        assert(payments.reduce((s, p) => s + p.excessAdvance, 0) === 20, 'Excess payment not advanced');
        // A stale editor cannot overwrite a payment made since it read the invoice.
        const stale = await DB.financialSnapshot();
        await DB.put('purchases', { ...invoice, notes: 'Changed in other editor' });
        let conflict = false;
        try { await DB.commitUnitOfWork([{ storeName: 'purchases', action: 'put', data: invoice }], stale); }
        catch (error) { conflict = error.code === 'CONFLICT'; }
        assert(conflict && (await DB.get('purchases', 'RACE')).notes === 'Changed in other editor', 'Stale write was not rejected');
        // Start a clean financial fixture inside this disposable browser profile.
        for (const store of Object.keys(await DB.exportAll()).filter(k => !k.startsWith('_'))) await DB.clear(store);
        await DB.put('capital_accounts', { id: 'cash', name: 'Cash', openingBalance: 100, createdAt: '2026-01-01' });
        const set = (id, value) => { document.getElementById(id).value = value; };
        await Journal.showModal();
        set('jv-date', '2026-01-02'); set('jv-desc', 'Journal rent'); set('jv-dr', 'Operating Expenses'); set('jv-cr', 'cash:cash'); set('jv-amt', '50');
        await Journal.save();
        assert((await DB.getAll('capital_transactions')).length === 1, 'Journal cash transaction missing');
        set('rp-from', '2026-01-01'); set('rp-to', '2026-01-31');
        const metric = label => {
            const text = document.getElementById('report-content').textContent.replace(/\s+/g, ' ');
            return Number(text.slice(text.indexOf(label) + label.length).match(/PKR\s+([\d,.-]+)/)[1].replace(/,/g, ''));
        };
        await Reports.generatePnL(); assert(metric('Net Profit') === -50, 'Journal expense absent from P&L');
        await Reports.generateBalanceSheet();
        assert(metric('Total Assets') === 50 && metric('Total Equity & Liabilities') === 50, 'Journal cash counted incorrectly in balance sheet');
        await Reports.generateCashFlow();
        assert(metric('ENDING CASH & BANK BALANCE') === 50, 'Journal cash not reconciled in cash flow');
        // Compare exported workbook values, not just successful downloads.
        const write = XLSX.writeFile; const books = [];
        XLSX.writeFile = book => books.push(book);
        try {
            await Reports.exportPnLExcel(); await Reports.exportBalanceSheetExcel(); await Reports.exportCashFlowExcel();
            const rows = books.map(book => XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]]));
            assert(rows[0].find(r => r.Item === 'NET PROFIT / (LOSS)').Amount === -50, 'Excel profit differs');
            assert(rows[1].find(r => r.Item === 'TOTAL LIABILITIES & EQUITY').Amount === 50, 'Excel equity differs');
            assert(rows[2].some(r => r.Item === 'Manual journal operating cash' && r.Amount === -50), 'Excel journal cash missing');
        } finally { XLSX.writeFile = write; }
    });
    result.checks.push('two-tab payment race, atomic conflict rejection, manual-journal cash posting, matching screen and Excel financial totals');
    if (errors.length) throw new Error('Browser errors: ' + errors.join('; '));
    console.log(JSON.stringify(result, null, 2));
    await context.close();
    await browser.close();
})().catch(error => { console.error(error); process.exit(1); });
