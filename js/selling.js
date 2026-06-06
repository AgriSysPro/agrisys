// ===== Selling Module =====
const Selling = {
    additionalDeductions: [],
    receiptImage: null,
    editingId: null,

    async init() {
        document.getElementById('s-date').value = Utils.todayISO();
        document.getElementById('s-id').value = await Utils.getNextReceiptId('sale');
        await Utils.populateCapitalAccountSelect('s-initial-account', 'Select cash/bank account');
        await this.loadBuyerDatalist();
    },

    async loadBuyerDatalist() {
        // Pull from buyers DB first, then unique names from sales as fallback
        const buyers = await DB.getAll('buyers');
        const sales = await DB.getAll('sales');
        const buyerNames = new Set(buyers.map(b => b.name));
        sales.forEach(s => { if (s.buyerName) buyerNames.add(s.buyerName); });
        document.getElementById('buyer-datalist').innerHTML = [...buyerNames].sort().map(b => `<option value="${Utils.escapeHTML(b)}">`).join('');
    },

    addDeduction() {
        const id = Date.now();
        this.additionalDeductions.push({ id, name: '', amount: 0, unit: 'kg' });
        this.renderDeductions();
    },

    removeDeduction(id) {
        this.additionalDeductions = this.additionalDeductions.filter(d => d.id !== id);
        this.renderDeductions();
        this.calculate();
    },

    renderDeductions() {
        const c = document.getElementById('s-deductions');
        c.innerHTML = this.additionalDeductions.map(d => `
            <div class="deduction-row">
                <div class="form-group"><label class="form-label">Name</label><input class="form-input" value="${Utils.escapeHTML(d.name)}" onchange="Selling.updateDed(${d.id},'name',this.value)"></div>
                <div class="form-group"><label class="form-label">Amount</label><input class="form-input" type="number" value="${d.amount}" step="0.01" oninput="Selling.updateDed(${d.id},'amount',this.value);Selling.calculate()"></div>
                <div class="form-group"><label class="form-label">Unit</label><select class="form-select" onchange="Selling.updateDed(${d.id},'unit',this.value);Selling.calculate()"><option value="kg" ${d.unit==='kg'?'selected':''}>KG</option><option value="pkr" ${d.unit==='pkr'?'selected':''}>PKR</option></select></div>
                <button class="btn btn-icon btn-danger btn-sm" onclick="Selling.removeDeduction(${d.id})">×</button>
            </div>
        `).join('');
    },

    updateDed(id, field, val) {
        const d = this.additionalDeductions.find(x => x.id === id);
        if (d) d[field] = field === 'amount' ? Utils.pf(val) : val;
    },

    calculate() {
        const grossWeight = Utils.pf(document.getElementById('s-weight').value);
        const perBag = Utils.pf(document.getElementById('s-per-bag').value) || 100;
        document.getElementById('s-bags-display').textContent = Utils.formatNum(grossWeight / perBag, 2);

        let kgDed = 0, pkrDed = 0;
        this.additionalDeductions.forEach(d => {
            if (d.unit === 'kg') kgDed += d.amount;
            else pkrDed += d.amount;
        });

        const netWeight = Math.max(0, grossWeight - kgDed);
        const netMn = netWeight / 40;
        const rate = Utils.pf(document.getElementById('s-rate').value);
        const amount = Utils.roundCurrency(netMn * rate - pkrDed);

        document.getElementById('s-net-weight').textContent = Utils.formatNum(netWeight, 2) + ' KG';
        document.getElementById('s-net-mn').textContent = Utils.formatNum(netMn, 2);
        document.getElementById('s-amount').textContent = 'PKR ' + Utils.formatPKR(Math.max(0, amount));
    },

    async handleImage(event) {
        const file = event.target.files[0];
        if (!file) return;
        let base64 = await Utils.fileToBase64(file);
        base64 = await Utils.compressImage(base64, 800, 0.7);
        this.receiptImage = base64;
        document.getElementById('s-receipt-area').innerHTML = `<img src="${base64}" alt="Receipt"><button class="btn btn-danger btn-sm" onclick="event.stopPropagation();Selling.removeImage()" style="position:absolute;top:8px;right:8px">×</button>`;
        document.getElementById('s-receipt-area').style.position = 'relative';
    },

    removeImage() {
        this.receiptImage = null;
        document.getElementById('s-receipt-image').value = '';
        document.getElementById('s-receipt-area').innerHTML = `<i data-lucide="image-plus" style="width:32px;height:32px;color:var(--text-muted)"></i><span class="upload-text">Click to upload buyer receipt</span>`;
        Utils.safeCreateIcons();
    },

    getData() {
        const grossWeight = Utils.pf(document.getElementById('s-weight').value);
        const perBag = Utils.pf(document.getElementById('s-per-bag').value) || 100;
        let kgDed = 0, pkrDed = 0;
        this.additionalDeductions.forEach(d => { if (d.unit === 'kg') kgDed += d.amount; else pkrDed += d.amount; });
        const netWeight = Math.max(0, grossWeight - kgDed);
        const netMn = netWeight / 40;
        const rate = Utils.pf(document.getElementById('s-rate').value);
        const amount = Utils.roundCurrency(Math.max(0, netMn * rate - pkrDed));
        const paymentStatus = document.getElementById('s-payment-status').value;
        let amountReceived = Utils.pf(document.getElementById('s-amount-received').value);
        if (paymentStatus === 'paid') amountReceived = amount;

        return {
            id: document.getElementById('s-id').value, buyerName: document.getElementById('s-buyer').value.trim(),
            date: document.getElementById('s-date').value, crop: document.getElementById('s-crop').value,
            grossWeight, perBag, perBagWeight: perBag, deductions: this.additionalDeductions, kgDeductions: kgDed, pkrDeductions: pkrDed,
            netWeight, netMn, rate, amount, paymentStatus, amountReceived,
            balance: Utils.roundCurrency(amount - amountReceived), notes: document.getElementById('s-notes').value.trim(),
            dueDate: document.getElementById('s-due-date').value || '',
            initialReceiptAccountId: document.getElementById('s-initial-account') ? document.getElementById('s-initial-account').value : '',
            receiptImage: this.receiptImage, createdAt: new Date().toISOString()
        };
    },

    async syncInitialReceiptTx(data) {
        await Utils.deleteLinkedCapitalTx('sales', data.id);
        const linkedReceipts = await DB.getByIndex('sale_payments', 'saleId', data.id);
        const laterReceipts = linkedReceipts.reduce((s, p) => s + (p.amount || 0), 0);
        const initialReceived = Math.max(0, (data.amountReceived || 0) - laterReceipts);
        data.initialReceiptAmount = initialReceived;
        data.initialCapitalTxId = null;
        if (initialReceived > 0 && data.initialReceiptAccountId) {
            const tx = await Utils.createLinkedCapitalTx({
                accountId: data.initialReceiptAccountId,
                type: 'deposit',
                amount: initialReceived,
                date: data.date,
                description: `Initial receipt from buyer ${data.buyerName} for sale #${data.id}`,
                sourceStore: 'sales',
                sourceId: data.id
            });
            if (tx) data.initialCapitalTxId = tx.id;
        }
        await DB.put('sales', data);
    },

    async getAvailableStock(crop, excludeSaleId = null) {
        let purchases = await DB.getAll('purchases');
        let sales = await DB.getAll('sales');
        let adjustments = await DB.getAll('stock_adjustments');
        const activeSeason = await Utils.getActiveSeason();
        purchases = Utils.filterBySeason(purchases, activeSeason);
        sales = Utils.filterBySeason(sales, activeSeason);
        adjustments = Utils.filterBySeason(adjustments, activeSeason);
        const adjusted = Utils.applyStockAdjustments(purchases, sales, adjustments);
        purchases = adjusted.purchases;
        sales = adjusted.sales;
        sales = sales.filter(s => s.id !== excludeSaleId);

        const purchased = purchases
            .filter(p => p.crop === crop)
            .reduce((sum, p) => sum + (p.netWeight || 0), 0);
        const sold = sales
            .filter(s => s.crop === crop)
            .reduce((sum, s) => sum + (s.netWeight || 0), 0);
        return purchased - sold;
    },

    async save() {
        const d = this.getData();
        if (!d.buyerName) { Utils.showToast('Buyer name required', 'error'); return; }
        if (!d.crop) { Utils.showToast('Crop required', 'error'); return; }
        if (d.grossWeight <= 0) { Utils.showToast('Weight required', 'error'); return; }
        if (d.rate <= 0) { Utils.showToast('Rate must be greater than 0', 'error'); return; }
        if (d.amountReceived < 0) { Utils.showToast('Received amount cannot be negative', 'error'); return; }
        if (d.amountReceived > d.amount) { Utils.showToast('Received amount cannot exceed sale amount', 'error'); return; }
        const linkedReceipts = await DB.getByIndex('sale_payments', 'saleId', d.id);
        const laterReceived = linkedReceipts.reduce((sum, p) => sum + (p.amount || 0), 0);
        const initialReceived = Math.max(0, (d.amountReceived || 0) - laterReceived);
        if (initialReceived > 0 && !d.initialReceiptAccountId) { Utils.showToast('Select cash/bank account for initial receipt', 'error'); return; }
        const available = await this.getAvailableStock(d.crop, this.editingId || d.id);
        if (d.netWeight > available) {
            Utils.showToast(`Cannot sell ${Utils.formatNum(d.netWeight, 2)} KG. Available ${d.crop} stock is ${Utils.formatNum(Math.max(0, available), 2)} KG.`, 'error');
            return;
        }
        const existing = await DB.get('sales', d.id);
        if (existing) {
            const payments = await DB.getByIndex('sale_payments', 'saleId', d.id);
            const oldAmount = existing.amount || 0;
            const newAmount = d.amount || 0;
            if (payments.length && Math.abs(oldAmount - newAmount) > 0.01) {
                const ok = await Utils.confirm(`This sale has ${payments.length} linked receipt(s). Change amount from PKR ${Utils.formatPKR(oldAmount)} to PKR ${Utils.formatPKR(newAmount)}?`);
                if (!ok) return;
            }
            d.createdAt = existing.createdAt || d.createdAt;
            d.updatedAt = new Date().toISOString();
        }
        await DB.put('sales', d);
        await Utils.confirmReceiptId('sale', d.id);
        await Buyers.ensureBuyer(d.buyerName);
        await this.syncInitialReceiptTx(d);
        await Utils.audit(existing ? 'update' : 'create', 'sale', d.id, {
            oldAmount: existing ? (existing.amount || 0) : null,
            newAmount: d.amount || 0,
            oldRecord: existing || null,
            newRecord: d
        });
        Utils.showToast('Sale receipt saved!');
        this.clearForm();
        return d;
    },

    async saveAndPrint() {
        const d = await this.save();
        if (d) {
            Utils.showLoading('Generating PDF...');
            await ReceiptPDF.generateSale(d);
            Utils.hideLoading();
        }
    },

    async clearForm() {
        this.editingId = null;
        this.additionalDeductions = [];
        this.receiptImage = null;
        document.getElementById('s-id').value = await Utils.getNextReceiptId('sale');
        document.getElementById('s-date').value = Utils.todayISO();
        document.getElementById('s-buyer').value = '';
        document.getElementById('s-crop').value = '';
        document.getElementById('s-weight').value = '';
        document.getElementById('s-rate').value = '';
        document.getElementById('s-amount-received').value = '0';
        if (document.getElementById('s-initial-account')) {
            await Utils.populateCapitalAccountSelect('s-initial-account', 'Select cash/bank account');
        }
        document.getElementById('s-payment-status').value = 'pending';
        document.getElementById('s-notes').value = '';
        document.getElementById('s-due-date').value = '';
        this.renderDeductions();
        this.removeImage();
        this.calculate();
        await this.loadBuyerDatalist();
    },

    async loadForEdit(id) {
        const data = await DB.get('sales', id);
        if (!data) return;
        const payments = await DB.getByIndex('sale_payments', 'saleId', id);
        if (payments.length) {
            const ok = await Utils.confirm(`This sale has ${payments.length} linked receipt(s). Editing weight, rate, deductions, or received amount can change balances. Continue?`);
            if (!ok) return;
        }
        this.editingId = id;
        document.getElementById('s-id').value = data.id;
        document.getElementById('s-date').value = data.date;
        document.getElementById('s-buyer').value = data.buyerName;
        document.getElementById('s-crop').value = data.crop;
        document.getElementById('s-weight').value = data.grossWeight;
        document.getElementById('s-per-bag').value = data.perBag || data.perBagWeight || 100;
        document.getElementById('s-rate').value = data.rate;
        document.getElementById('s-payment-status').value = data.paymentStatus;
        document.getElementById('s-amount-received').value = data.amountReceived || 0;
        if (document.getElementById('s-initial-account')) {
            await Utils.populateCapitalAccountSelect('s-initial-account', 'Select cash/bank account');
            document.getElementById('s-initial-account').value = data.initialReceiptAccountId || '';
        }
        document.getElementById('s-notes').value = data.notes || '';
        document.getElementById('s-due-date').value = data.dueDate || '';

        this.additionalDeductions = (data.deductions || data.additionalDeductions || []).map(d => ({ ...d, id: d.id || Date.now() + Math.random() }));
        this.renderDeductions();
        if (data.receiptImage) {
            this.receiptImage = data.receiptImage;
            document.getElementById('s-receipt-area').innerHTML = `<img src="${data.receiptImage}" alt="Receipt"><button class="btn btn-danger btn-sm" onclick="event.stopPropagation();Selling.removeImage()" style="position:absolute;top:8px;right:8px">×</button>`;
            document.getElementById('s-receipt-area').style.position = 'relative';
        }
        this.calculate();
        App.navigate('selling');
    }
};

// ===== Sale List =====
const SaleList = {
    currentPage: 1,
    async render(page) {
        if (page) this.currentPage = page;
        const activeSeason = await Utils.getActiveSeason();
        const all = Utils.filterBySeason(await DB.getAll('sales'), activeSeason);
        const search = (document.getElementById('sl-search').value || '').toLowerCase();
        const statusFilter = document.getElementById('sl-status-filter').value;
        let filtered = all.filter(s => {
            if (search && !s.buyerName.toLowerCase().includes(search) && !s.id.toLowerCase().includes(search) && !(s.crop||'').toLowerCase().includes(search)) return false;
            if (statusFilter && s.paymentStatus !== statusFilter) return false;
            return true;
        }).sort((a, b) => new Date(b.date) - new Date(a.date));

        const { items, page: p, totalPages } = Utils.paginate(filtered, this.currentPage, 25);
        this.currentPage = p;

        document.getElementById('sale-tbody').innerHTML = items.map(s => `<tr>
            <td class="font-bold">${Utils.highlightText(s.id, search)}</td><td>${Utils.formatDate(s.date)}</td><td class="font-bold">${Utils.highlightText(s.buyerName, search)}</td>
            <td>${Utils.highlightText(s.crop, search)}</td><td>${Utils.formatNum(s.netWeight)} KG</td><td>PKR ${Utils.formatPKR(s.rate)}</td>
            <td class="text-right font-bold">PKR ${Utils.formatPKR(s.amount)}</td>
            <td>${Utils.statusBadge(s.paymentStatus)}</td>
            <td><div class="table-actions">
                <button class="btn btn-icon btn-ghost btn-sm" onclick="Selling.loadForEdit('${s.id}')" title="Edit">✏️</button>
                <button class="btn btn-icon btn-ghost btn-sm" onclick="ReceiptPDF.generateSale(null,'${s.id}')" title="PDF">📄</button>
                <button class="btn btn-icon btn-danger btn-sm" onclick="SaleList.delete('${s.id}')" title="Delete">🗑️</button>
            </div></td>
        </tr>`).join('') || '<tr><td colspan="9" class="text-center" style="color:var(--text-muted)">No sales yet</td></tr>';

        Utils.renderPagination('sale-pagination', this.currentPage, totalPages, 'SaleList.render');
    },
    async delete(id) {
        const sale = await DB.get('sales', id);
        if (!sale) return;
        const payments = await DB.getByIndex('sale_payments', 'saleId', id);
        const paymentTotal = payments.reduce((s, p) => s + (p.amount || 0), 0);
        const msg = `Delete sale ${id}?\n\nLinked buyer receipts: ${payments.length} (PKR ${Utils.formatPKR(paymentTotal)})\nLinked capital transactions for those receipts will also be removed.`;
        if (!await Utils.confirm(msg)) return;
        for (const p of payments) {
            await Utils.deleteLinkedCapitalTx('sale_payments', p.id);
            await DB.delete('sale_payments', p.id);
        }
        await Utils.deleteLinkedCapitalTx('sales', id);
        await DB.delete('sales', id);
        await Utils.audit('delete', 'sale', id, {
            oldAmount: sale.amount || 0,
            oldRecord: sale,
            linkedPayments: payments
        });
        Utils.showToast('Deleted!');
        this.render();
    },
    goToPage(page) { this.currentPage = page; this.render(); }
};

const SaleExport = {
    async toExcel() {
        if (!Utils.requireExcel()) return;
        const activeSeason = await Utils.getActiveSeason();
        const all = Utils.filterBySeason(await DB.getAll('sales'), activeSeason);
        if (!all.length) { Utils.showToast('No data', 'warning'); return; }
        const rows = all.map(s => ({ 'ID': s.id, 'Date': s.date, 'Buyer': s.buyerName, 'Crop': s.crop, 'Gross (KG)': s.grossWeight, 'Net (KG)': s.netWeight, 'Rate/Mn': s.rate, 'Amount': s.amount, 'Received': s.amountReceived, 'Balance': s.balance, 'Status': s.paymentStatus }));
        const ws = XLSX.utils.json_to_sheet(rows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Sales');
        XLSX.writeFile(wb, `Sales_${Utils.todayISO()}.xlsx`);
        Utils.showToast('Excel exported!');
    }
};
