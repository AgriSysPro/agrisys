// Disposable browser tests. Requires Playwright and pdfjs-dist; accepts an output directory as argv[2].
const modulePath = process.env.PLAYWRIGHT_MODULE || (process.platform === 'win32'
    ? 'C:/Users/Ch/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright' : 'playwright');
const { chromium } = require(modulePath);
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

(async () => {
    const output = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'agrisys-combined-'));
    fs.mkdirSync(output, { recursive: true });
    const pdfjsPath = path.join(path.dirname(path.dirname(require.resolve(modulePath))), 'pdfjs-dist/legacy/build/pdf.mjs');
    const pdfjs = await import(pathToFileURL(pdfjsPath).href);
    const readPDF = async file => {
        const standardFontDataUrl = path.join(path.dirname(path.dirname(require.resolve(modulePath))), 'pdfjs-dist/standard_fonts').replace(/\\/g, '/') + '/';
        const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(file)), standardFontDataUrl }).promise;
        const pages = [];
        for (let i = 1; i <= doc.numPages; i++) pages.push((await (await doc.getPage(i)).getTextContent()).items.map(item => item.str).join(' '));
        const result = { pages, count: doc.numPages, text: pages.join('\n') };
        await doc.destroy(); return result;
    };
    const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
    try {
        const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
        await context.route(/^https?:/, route => route.abort());
        const page = await context.newPage();
        const errors = [], downloads = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('download', download => downloads.push(download));
        const initialized = page.waitForEvent('console', message => message.text().includes('AgriSys initialized successfully'));
        await page.goto(pathToFileURL(path.resolve(__dirname, '../index.html')).href);
        await initialized;
        await page.evaluate(async () => {
            await DB.setSetting('business', { bizName: 'Combined Receipt Test Traders', address: 'Sample market', phone: '0300 1234567', crops: 'Wheat,Rice', expenseTypes: 'Labour' });
            Utils.hideModal('welcome-modal');
            document.querySelector('.sidebar').style.pointerEvents = 'auto';
            await DB.put('seasons', { id: 'current', label: '2026 season', active: true, startDate: '2026-01-01', endDate: '2026-12-31' });
            const purchase = { id: '100001', farmerName: 'Ali Farmer', date: '2026-10-01', crop: 'Wheat', netWeight: 100, rate: 40,
                amount: 100.10, netPayableAmount: 90.10, amountPaid: 20, initialPaymentAmount: 20, advanceDeducted: 10 };
            await DB.put('purchases', purchase);
            await DB.put('purchases', { ...purchase, id: '100002', farmerName: 'ali farmer', date: '2026-10-02', crop: 'Rice', netWeight: 200, amount: 200.20, netPayableAmount: 200.20, amountPaid: 0, initialPaymentAmount: 0, advanceDeducted: 0 });
            await DB.put('purchases', { ...purchase, id: '100003', date: '2026-10-03', netWeight: 1, netPayableAmount: 0, amountPaid: 0, initialPaymentAmount: 0 });
            await DB.put('purchases', { ...purchase, id: 'OLD', date: '2025-01-01' });
            await DB.put('purchases', { ...purchase, id: 'OPEN', type: 'opening_balance' });
            await DB.put('purchases', { ...purchase, id: 'DELETED', isDeleted: true });
            await DB.put('purchases', { ...purchase, id: 'OTHER', farmerName: 'Other Farmer' });
            await DB.put('purchase_payments', { id: 'PP', date: '2026-10-10', amount: 50, farmerName: 'Ali Farmer', allocations: [{ invoiceId: '100001', amount: 30 }, { invoiceId: '100002', amount: 20 }] });
            const sale = { id: '100001', buyerName: 'Ahmed Buyer', date: '2026-10-01', crop: 'Wheat', netWeight: 50, rate: 100,
                amount: 125, amountReceived: 25, initialReceiptAmount: 25 };
            await DB.put('sales', sale);
            await DB.put('sales', { ...sale, id: '100002', date: '2026-10-02', netWeight: 100, amount: 250, amountReceived: 0, initialReceiptAmount: 0 });
            await DB.put('sales', { ...sale, id: 'OTHER', buyerName: '<img src=x onerror="window.combineInjection=true">' });
            await DB.put('sale_payments', { id: 'SP', date: '2026-10-20', amount: 80, buyerName: 'Ahmed Buyer', allocations: [{ invoiceId: '100001', amount: 30 }, { invoiceId: '100002', amount: 50 }] });
            window.combinedSnapshot = async () => { const data = await DB.exportAll(); delete data._exportDate; return JSON.stringify(data); };
            window.combinedBefore = await window.combinedSnapshot();
            App.navigate('purchase-list');
        });
        await page.locator('#sec-purchase-list').getByRole('button', { name: 'Combine receipts' }).click();
        await page.waitForFunction(() => document.querySelectorAll('#cr-party option').length === 3);
        assert.equal(await page.locator('#cr-export').isDisabled(), true);
        await page.locator('#cr-party').selectOption('ali farmer');
        assert.equal(await page.locator('#cr-tbody tr').count(), 3, 'Only real receipts in the default season');
        await page.locator('#cr-tbody input').first().check();
        assert.equal(await page.locator('#cr-export').isDisabled(), true, 'One receipt cannot be merged');
        await page.locator('#cr-select-all').click();
        assert.match(await page.locator('#cr-totals').textContent(), /290\.30.*70\.00.*220\.30/);
        assert.equal(await page.locator('#cr-export').isEnabled(), true);
        await page.screenshot({ path: path.join(output, 'combined-purchase-preview.png'), animations: 'disabled', style: '.toast { visibility: hidden; }' });
        const savePDF = async name => {
            const pending = page.waitForEvent('download'); await page.locator('#cr-export').click();
            const download = await pending;
            assert.equal(await download.failure(), null);
            const file = path.join(output, name); await download.saveAs(file);
            await page.waitForFunction(() => !CombinedReceipts.busy);
            return readPDF(file);
        };
        const purchasePDF = await savePDF('combined-purchases.pdf');
        assert.equal(purchasePDF.count, 1);
        assert.match(purchasePDF.text, /COMBINED PURCHASE RECEIPT/);
        for (const id of ['100001', '100002', '100003']) assert.ok(purchasePDF.text.includes(id));
        assert.match(purchasePDF.text, /GRAND TOTAL.*290\.30.*70\.00.*220\.30/);
        assert.equal((purchasePDF.text.match(/GRAND TOTAL/g) || []).length, 1);
        assert.equal(await page.evaluate(async () => await window.combinedSnapshot() === window.combinedBefore), true);

        await page.locator('#cr-to').fill('2026-10-02');
        assert.equal(await page.locator('#cr-tbody tr').count(), 2);
        assert.equal(await page.evaluate(() => CombinedReceipts.selected.size), 0, 'Date changes clear selection');
        await page.locator('#cr-select-all').click();
        assert.match(await page.locator('#cr-totals').textContent(), /70\.00/, 'Receipt-date filters must retain later settlements');
        await page.locator('#cr-search').fill('Rice');
        assert.equal(await page.locator('#cr-tbody tr').count(), 1);
        assert.equal(await page.evaluate(() => CombinedReceipts.selected.size), 0);
        await page.locator('#cr-search').fill('');
        await page.getByRole('button', { name: 'All dates', exact: true }).click();
        assert.equal(await page.locator('#cr-tbody tr').count(), 4);
        await page.locator('#cr-from').fill('2027-01-01');
        await page.locator('#cr-to').fill('2026-01-01');
        assert.match(await page.locator('#cr-empty').textContent(), /From date/);
        await page.keyboard.press('Escape');

        await page.evaluate(() => App.navigate('sale-list'));
        await page.locator('#sec-sale-list').getByRole('button', { name: 'Combine receipts' }).click();
        await page.waitForFunction(() => document.querySelectorAll('#cr-party option').length === 3 && document.getElementById('cr-party-label').textContent === 'Buyer');
        assert.equal(await page.evaluate(() => !!window.combineInjection), false);
        await page.locator('#cr-party').selectOption('ahmed buyer');
        await page.locator('#cr-select-all').click();
        assert.match(await page.locator('#cr-totals').textContent(), /375\.00.*105\.00.*270\.00/);
        const salePDF = await savePDF('combined-sales.pdf');
        assert.match(salePDF.text, /COMBINED SALE RECEIPT/);
        assert.match(salePDF.text, /GRAND TOTAL.*375\.00.*105\.00.*270\.00/);
        assert.equal(await page.evaluate(async () => await window.combinedSnapshot() === window.combinedBefore), true, 'Both exports preserve all source stores');
        await page.setViewportSize({ width: 390, height: 844 });
        await page.screenshot({ path: path.join(output, 'combined-mobile.png'), animations: 'disabled', style: '.toast { visibility: hidden; }' });
        assert.equal(await page.evaluate(() => document.getElementById('combined-receipts-modal').scrollWidth <= innerWidth), true);
        await page.setViewportSize({ width: 1440, height: 1000 });

        // Prevent duplicate IDs, mixed parties, and summaries based on stale payments.
        const guardChecks = await page.evaluate(async () => {
            const records = await DB.getAll('sales');
            const first = records.find(row => row.id === '100001'), other = records.find(row => row.id === 'OTHER');
            const rejects = rows => { try { CombinedReceipts.summarize('sale', rows, []); return false; } catch { return true; } };
            const checks = { mixed: rejects([first, other]), duplicate: rejects([first, first]), single: rejects([first]) };
            const messages = [], original = Utils.showToast;
            Utils.showToast = (message, type) => messages.push({ message, type });
            try {
                await DB.put('sale_payments', { id: 'NEW', date: '2026-10-25', saleId: '100001', amount: 5 });
                await CombinedReceipts.download();
                checks.changedMessage = messages.at(-1);
                checks.selectionCleared = CombinedReceipts.selected.size === 0;
                CombinedReceipts.selectAll();
                await DB.delete('sales', '100002');
                await CombinedReceipts.download();
                checks.removedMessage = messages.at(-1);
                checks.busyReset = !CombinedReceipts.busy && !document.getElementById('cr-fields').disabled;
                return checks;
            } finally { Utils.showToast = original; }
        });
        assert.equal(guardChecks.mixed && guardChecks.duplicate && guardChecks.single && guardChecks.selectionCleared && guardChecks.busyReset, true);
        assert.match(guardChecks.changedMessage.message, /changed/);
        assert.match(guardChecks.removedMessage.message, /removed/);
        assert.equal(downloads.length, 2, 'Validation failures must not download a partial or stale document');

        // Many receipts must paginate with one final total and repeated column headers.
        const largePDF = await page.evaluate(async () => {
            const records = Array.from({ length: 70 }, (_, i) => ({ id: `BULK-${String(i + 1).padStart(3, '0')}`, buyerName: 'Bulk Buyer', date: '2026-10-26', crop: 'Wheat', netWeight: 40, rate: 100.10, amount: 100.10, amountReceived: 0, initialReceiptAmount: 0 }));
            for (const record of records) await DB.put('sales', record);
            await CombinedReceipts.open('sale');
            document.getElementById('cr-party').value = 'bulk buyer'; CombinedReceipts.filtersChanged(); CombinedReceipts.selectAll();
            const summary = CombinedReceipts.summarize('sale', records, []);
            const doc = await CombinedReceipts.buildPDF(summary);
            return { data: doc.output('datauristring').split(',')[1], total: summary.totals.amount };
        });
        assert.equal(await page.locator('#cr-tbody tr').count(), 25);
        assert.equal(await page.evaluate(() => CombinedReceipts.selected.size), 70);
        await page.locator('#cr-next').click();
        assert.equal(await page.locator('#cr-tbody input:checked').count(), 25);
        assert.equal(largePDF.total, 7007);
        const largeFile = path.join(output, 'combined-multipage.pdf'); fs.writeFileSync(largeFile, Buffer.from(largePDF.data, 'base64'));
        const large = await readPDF(largeFile);
        assert.ok(large.count >= 3);
        assert.equal((large.text.match(/GRAND TOTAL/g) || []).length, 1);
        assert.match(large.pages.at(-1), /GRAND TOTAL.*7,007\.00/);
        assert.ok(large.pages.every(text => text.includes('Receipt no.')));
        assert.equal((large.text.match(/Wheat/g) || []).length, 70, 'Every receipt retains its crop on continuation pages');
        for (let i = 1; i <= 70; i++) assert.ok(large.text.includes(`BULK-${String(i).padStart(3, '0')}`));
        assert.deepEqual(errors, []);
        console.log(JSON.stringify({ status: 'PASS', checks: ['purchase and sale entry points', 'single-party selection', 'season/date/search filters', 'advance and allocated payment totals', 'zero net payable', 'read-only PDFs', 'mobile layout', 'mixed/duplicate party guards', 'stale and deleted receipt guards', 'selection across pages', 'multipage PDF with one grand total'], purchaseTotals: '290.30 / 70.00 / 220.30', saleTotals: '375.00 / 105.00 / 270.00', largePdfPages: large.count, output }, null, 2));
        await context.close();
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
