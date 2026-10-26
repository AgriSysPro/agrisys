// Run with Playwright installed, or set PLAYWRIGHT_MODULE to its absolute path.
// Uses a disposable browser context; never opens the user's browser profile.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || (process.platform === 'win32'
    ? 'C:/Users/Ch/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'
    : 'playwright'));
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

(async () => {
    const output = process.argv[2] || process.env.GALLERY_TEST_OUTPUT || fs.mkdtempSync(path.join(os.tmpdir(), 'agrisys-gallery-'));
    fs.mkdirSync(output, { recursive: true });
    const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { channel: 'msedge' } : {}) });
    try {
        const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 1000 } });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        // All application dependencies and receipt images must work offline.
        await context.route(/^https?:/, route => route.abort());
        await page.goto(pathToFileURL(path.resolve(__dirname, '../index.html')).href);
        await page.waitForFunction(() => DB.db && document.getElementById('welcome-modal').classList.contains('active'));
        await page.evaluate(async () => {
            await DB.setSetting('business', { bizName: 'Gallery Test Traders', address: 'Sample market', phone: '0300 1234567', crops: 'Wheat,Rice', expenseTypes: 'Labour' });
            Utils.hideModal('welcome-modal');
            document.querySelector('.sidebar').style.pointerEvents = 'auto';
            document.querySelector('.sidebar').style.opacity = '1';
            App.navigate('receipt-gallery');
        });
        await page.waitForFunction(() => document.getElementById('rg-results').textContent.includes('0 of 0'));
        assert.equal(await page.locator('#rg-empty').isVisible(), true);
        assert.equal(await page.locator('#rg-export').isDisabled(), true);

        await page.evaluate(async () => {
            const makeImage = (width, height, text) => {
                const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height);
                ctx.strokeStyle = '#333'; ctx.strokeRect(12, 12, width - 24, height - 24);
                ctx.fillStyle = '#111'; ctx.font = 'bold 24px sans-serif'; ctx.fillText(text, 30, 60);
                ctx.font = '18px sans-serif'; ctx.fillText('TEST IMAGE - 26 October 2026', 30, 105);
                ctx.fillText('Gross: 1,000 KG', 30, 145); ctx.fillText('Net: 980 KG', 30, 180);
                return canvas.toDataURL('image/png');
            };
            const purchase = { id: '100001', date: '2026-10-26', farmerName: 'Ali Farmer', crop: 'Wheat', method: 'scale',
                grossWeight: 1000, netWeight: 980, netMn: 24.5, perBagWeight: 100, bagsCount: 10, netBags: 9.8,
                bardanaPerBag: 1, labourPerBag: 1, bardanaTotal: 10, labourTotal: 10, rate: 3500, amount: 85750,
                netPayableAmount: 85750, amountPaid: 0, balance: 85750, paymentStatus: 'pending', additionalDeductions: [],
                scaleImage: makeImage(600, 850, 'COMPUTERIZED KANDA SLIP') };
            const sale = { id: '100001', date: '2026-10-26', buyerName: 'Ahmed Buyer', crop: 'Wheat', grossWeight: 500,
                netWeight: 500, netMn: 12.5, perBagWeight: 100, rate: 4000, amount: 50000, amountReceived: 10000,
                balance: 40000, paymentStatus: 'partial', deductions: [], receiptImage: makeImage(850, 400, 'BUYER RECEIPT') };
            await DB.put('purchases', purchase);
            await DB.put('sales', sale);
            await DB.put('purchases', { ...purchase, id: 'OLD', date: '2025-01-01', farmerName: '<img src=x onerror="window.galleryInjection=true">' });
            await DB.put('purchases', { ...purchase, id: 'NO-IMAGE', scaleImage: null });
            await DB.put('sales', { ...sale, id: 'DELETED', isDeleted: true });
            await DB.put('seasons', { id: 'current', active: true, startDate: '2026-01-01', endDate: '2026-12-31' });
            window.gallerySnapshot = async () => {
                const data = await DB.exportAll();
                delete data._exportDate;
                return JSON.stringify(data);
            };
            window.galleryBefore = await window.gallerySnapshot();
            await ReceiptGallery.render();
        });
        assert.equal(await page.locator('.rg-card').count(), 3, 'Historical uploads should remain visible');
        assert.equal(await page.evaluate(() => !!window.galleryInjection), false, 'Party names must remain plain text');
        await page.locator('#rg-search').fill('100001');
        assert.equal(await page.locator('.rg-card').count(), 2);
        await page.locator('#rg-select-filtered').click();
        assert.equal(await page.evaluate(() => ReceiptGallery.selected.size), 2, 'Same purchase and sale IDs must have separate selections');
        await page.locator('#rg-type').selectOption('purchase');
        assert.match(await page.locator('#rg-selection').textContent(), /2 selected \(1 outside current filters\)/);
        await page.locator('.rg-thumbnail').first().click();
        await page.waitForFunction(() => document.getElementById('rg-preview-image').naturalWidth === 600);
        assert.equal(await page.locator('#rg-preview-modal').isVisible(), true);
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('#rg-preview-modal').isVisible(), false);
        await page.locator('#rg-type').selectOption('');
        await page.screenshot({ path: path.join(output, 'gallery-desktop.png'), fullPage: true, animations: 'disabled', style: '.toast-container { visibility: hidden; }' });

        const pdfChecks = await page.evaluate(async () => {
            const items = ReceiptGallery.items.filter(item => ReceiptGallery.selected.has(item.key));
            const paired = await ReceiptGallery.buildPDF(items, true);
            const images = await ReceiptGallery.buildPDF(items, false);
            return { pairedPages: paired.getNumberOfPages(), imagePages: images.getNumberOfPages(),
                pairedImages: Object.keys(paired.internal.collections.addImage_images).length,
                onlyImages: Object.keys(images.internal.collections.addImage_images).length };
        });
        assert.equal(pdfChecks.pairedPages, 2);
        assert.equal(pdfChecks.imagePages, 2);
        assert.equal(pdfChecks.onlyImages, 2);
        assert.ok(pdfChecks.pairedImages >= 2);
        for (const [layout, filename] of [['paired', 'paired-receipts.pdf'], ['images', 'images-only.pdf']]) {
            await page.locator('#rg-pdf-layout').selectOption(layout);
            const downloading = page.waitForEvent('download');
            await page.locator('#rg-export').click();
            const download = await downloading;
            assert.equal(await download.failure(), null);
            await download.saveAs(path.join(output, filename));
            assert.ok(fs.statSync(path.join(output, filename)).size > 1000);
            await page.waitForFunction(() => !ReceiptGallery.exporting);
        }
        assert.equal(await page.evaluate(async () => await window.gallerySnapshot() === window.galleryBefore), true, 'Gallery/export must not modify saved records');

        await page.locator('#rg-from').fill('2026-10-27');
        await page.locator('#rg-to').fill('2026-10-26');
        assert.match(await page.locator('#rg-empty').textContent(), /From date/);
        await page.locator('#sec-receipt-gallery').getByRole('button', { name: 'Reset filters' }).click();
        await page.locator('#rg-to').fill('2025-12-31');
        assert.equal(await page.locator('.rg-card').count(), 1);
        await page.locator('#sec-receipt-gallery').getByRole('button', { name: 'Reset filters' }).click();
        await page.setViewportSize({ width: 390, height: 844 });
        await page.screenshot({ path: path.join(output, 'gallery-mobile.png'), animations: 'disabled', style: '.toast-container { visibility: hidden; }' });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Mobile gallery must not overflow horizontally');
        await page.setViewportSize({ width: 1440, height: 1000 });

        await page.evaluate(async () => {
            const purchase = await DB.get('purchases', '100001');
            for (let i = 0; i < 25; i++) await DB.put('purchases', { ...purchase, id: `PAGE-${i}` });
            await ReceiptGallery.render(); ReceiptGallery.clearSelection();
        });
        await page.waitForFunction(() => document.querySelectorAll('.rg-card').length === 24);
        await page.locator('#rg-select-filtered').click();
        assert.equal(await page.evaluate(() => ReceiptGallery.selected.size), 28, 'Select matching includes all matching pages');
        await page.locator('#rg-next').click();
        assert.equal(await page.locator('.rg-card').count(), 4);
        assert.equal(await page.locator('.rg-card input:checked').count(), 4);
        await page.locator('#rg-clear').click();
        assert.equal(await page.locator('#rg-export').isDisabled(), true);

        // A corrupt image aborts the batch; the user does not receive a partial PDF.
        const failureChecks = await page.evaluate(async () => {
            const purchase = await DB.get('purchases', '100001');
            await DB.put('purchases', { ...purchase, id: 'CORRUPT', scaleImage: 'data:image/png;base64,broken' });
            await ReceiptGallery.render();
            ReceiptGallery.selected = new Set([JSON.stringify(['purchase', 'CORRUPT'])]);
            const messages = []; const toast = Utils.showToast;
            Utils.showToast = (message, type) => messages.push({ message, type });
            try {
                await ReceiptGallery.exportSelected();
                const corrupt = messages.at(-1);
                const recovered = !ReceiptGallery.exporting && !document.getElementById('rg-export').disabled;
                await DB.delete('purchases', 'CORRUPT');
                await ReceiptGallery.exportSelected();
                const removed = messages.at(-1);
                await ReceiptGallery.render();
                return { corrupt, removed, recovered, selectedAfterRefresh: ReceiptGallery.selected.size };
            } finally { Utils.showToast = toast; }
        });
        assert.equal(failureChecks.corrupt.type, 'error');
        assert.match(failureChecks.corrupt.message, /CORRUPT/);
        assert.match(failureChecks.removed.message, /removed/);
        assert.equal(failureChecks.recovered, true);
        assert.equal(failureChecks.selectedAfterRefresh, 0);
        assert.deepEqual(errors, []);
        console.log(JSON.stringify({ status: 'PASS', checks: ['empty gallery', 'all-season uploads', 'deleted and missing-image exclusion', 'escaped party names', 'search/type/date filters', 'unique purchase/sale selections', 'selection across filters and pages', 'preview and Escape', 'paired and image-only PDF downloads', 'read-only export', 'mobile layout', 'corrupt and removed image recovery'], pdfChecks, output }, null, 2));
        await context.close();
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
