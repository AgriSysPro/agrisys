// ===== Purchasing Module =====
const Purchasing = {
    method: 'scale',
    additionalDeductions: [],
    scaleImage: null,
    editingId: null,

    async init() {
        document.getElementById('p-date').value = Utils.todayISO();
        document.getElementById('p-id').value = await Utils.getNextReceiptId('purchase');
        const defs = await Settings.getDefaults();
        document.getElementById('p-per-bag-weight').value = defs.perBagWeight || 100;
        document.getElementById('p-weight-per-bag').value = defs.perBagWeight || 100;
        document.getElementById('p-bardana').value = defs.defaultBardana || 0;
        document.getElementById('p-labour').value = defs.defaultLabour || 0;
        await Utils.populateCapitalAccountSelect('p-initial-account', 'Select cash/bank account');
        await this.loadFarmerDatalist();
    },

    async loadFarmerDatalist() {
        const farmers = await DB.getAll('farmers');
        const dl = document.getElementById('farmer-datalist');
        dl.innerHTML = farmers.map(f => `<option value="${Utils.escapeHTML(f.name)}">`).join('');
    },

    async loadFarmerAdvances() {
        const farmerName = document.getElementById('p-farmer').value.trim();
        const display = document.getElementById('p-outstanding-adv');
        if (!farmerName) {
            display.textContent = 'PKR 0.00';
            return;
        }
        const openAdv = await this.getAvailableAdvance(farmerName, this.editingId);
        display.textContent = 'PKR ' + Utils.formatPKR(openAdv);
    },

    setMethod(method) {
        this.method = method;
        document.getElementById('method-scale').classList.toggle('active', method === 'scale');
        document.getElementById('method-bags').classList.toggle('active', method === 'bags');
        document.getElementById('scale-fields').style.display = method === 'scale' ? '' : 'none';
        document.getElementById('bags-fields').style.display = method === 'bags' ? '' : 'none';
        this.calculate();
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
        const container = document.getElementById('p-additional-deductions');
        container.innerHTML = this.additionalDeductions.map(d => `
            <div class="deduction-row">
                <div class="form-group">
                    <label class="form-label">Name</label>
                    <input class="form-input" value="${Utils.escapeHTML(d.name)}" placeholder="Deduction name" onchange="Purchasing.updateDeduction(${d.id},'name',this.value)">
                </div>
                <div class="form-group">
                    <label class="form-label">Amount</label>
                    <input class="form-input" type="number" value="${d.amount}" step="0.01" onchange="Purchasing.updateDeduction(${d.id},'amount',this.value)" oninput="Purchasing.updateDeduction(${d.id},'amount',this.value); Purchasing.calculate()">
                </div>
                <div class="form-group">
                    <label class="form-label">Unit</label>
                    <select class="form-select" onchange="Purchasing.updateDeduction(${d.id},'unit',this.value); Purchasing.calculate()">
                        <option value="kg" ${d.unit==='kg'?'selected':''}>KG Total</option>
                        <option value="kg_per_bag" ${d.unit==='kg_per_bag'?'selected':''}>KG per Bag</option>
                        <option value="pkr" ${d.unit==='pkr'?'selected':''}>PKR</option>
                        <option value="bags" ${d.unit==='bags'?'selected':''}>Bags</option>
                    </select>
                </div>
                <div class="deduction-total" id="ded-total-${d.id}">0</div>
                <button class="btn btn-icon btn-danger btn-sm" onclick="Purchasing.removeDeduction(${d.id})" title="Remove">×</button>
            </div>
        `).join('');
        Utils.safeCreateIcons();
    },

    updateDeduction(id, field, value) {
        const d = this.additionalDeductions.find(x => x.id === id);
        if (d) d[field] = field === 'amount' ? Utils.pf(value) : value;
    },

    calculate() {
        let grossWeight = 0, bagsCount = 0, perBagWeight = 0;

        if (this.method === 'scale') {
            grossWeight = Utils.pf(document.getElementById('p-gross-weight').value);
            perBagWeight = Utils.pf(document.getElementById('p-per-bag-weight').value) || 100;
            bagsCount = perBagWeight > 0 ? grossWeight / perBagWeight : 0;
            document.getElementById('p-bags-count-display').textContent = Utils.formatNum(bagsCount, 2);
        } else {
            const numBags = Utils.pf(document.getElementById('p-num-bags').value);
            perBagWeight = Utils.pf(document.getElementById('p-weight-per-bag').value) || 100;
            grossWeight = numBags * perBagWeight;
            bagsCount = numBags;
            document.getElementById('p-bags-gross-display').textContent = Utils.formatNum(grossWeight, 2) + ' KG';
        }

        // Deductions in KG
        const bardanaPerBag = Utils.pf(document.getElementById('p-bardana').value);
        const labourPerBag = Utils.pf(document.getElementById('p-labour').value);
        const bardanaTotal = bardanaPerBag * bagsCount;
        const labourTotal = labourPerBag * bagsCount;
        document.getElementById('p-bardana-total').textContent = Utils.formatNum(bardanaTotal, 2) + ' KG';
        document.getElementById('p-labour-total').textContent = Utils.formatNum(labourTotal, 2) + ' KG';

        let totalKgDeductions = bardanaTotal + labourTotal;
        let totalPkrDeductions = 0;

        // Additional deductions
        this.additionalDeductions.forEach(d => {
            let dedKg = 0, dedPkr = 0;
            if (d.unit === 'kg') {
                dedKg = d.amount;
                totalKgDeductions += dedKg;
            } else if (d.unit === 'kg_per_bag') {
                dedKg = d.amount * bagsCount;
                totalKgDeductions += dedKg;
            } else if (d.unit === 'bags') {
                dedKg = d.amount * perBagWeight;
                totalKgDeductions += dedKg;
            } else if (d.unit === 'pkr') {
                dedPkr = d.amount;
                totalPkrDeductions += dedPkr;
            }
            const el = document.getElementById('ded-total-' + d.id);
            if (el) el.textContent = d.unit === 'pkr' ? 'PKR ' + Utils.formatPKR(dedPkr) : Utils.formatNum(dedKg, 2) + ' KG';
        });

        const netWeight = Math.max(0, grossWeight - totalKgDeductions);
        const netBags = perBagWeight > 0 ? netWeight / perBagWeight : 0;
        const netMn = netWeight / 40;
        const rate = Utils.pf(document.getElementById('p-rate').value);
        const amount = Utils.roundCurrency(netMn * rate);

        const commissionRate = Utils.pf(document.getElementById('p-commission') ? document.getElementById('p-commission').value : 0);
        const mandiTaxRate = Utils.pf(document.getElementById('p-mandi-tax') ? document.getElementById('p-mandi-tax').value : 0);
        const commissionTotal = Utils.roundCurrency(amount * (commissionRate / 100));
        const mandiTaxTotal = Utils.roundCurrency(amount * (mandiTaxRate / 100));

        if (document.getElementById('p-commission-total')) document.getElementById('p-commission-total').textContent = 'PKR ' + Utils.formatPKR(commissionTotal);
        if (document.getElementById('p-mandi-tax-total')) document.getElementById('p-mandi-tax-total').textContent = 'PKR ' + Utils.formatPKR(mandiTaxTotal);

        totalPkrDeductions += commissionTotal + mandiTaxTotal;

        const advanceDeducted = Utils.pf(document.getElementById('p-deduct-advance').value);
        const payableBeforeAdvance = Math.max(0, Utils.roundCurrency(amount - totalPkrDeductions));
        const netPayableAmount = Math.max(0, Utils.roundCurrency(payableBeforeAdvance - advanceDeducted));

        // Update displays
        document.getElementById('calc-gross').textContent = Utils.formatNum(grossWeight, 2) + ' KG';
        document.getElementById('calc-deductions').textContent = '-' + Utils.formatNum(totalKgDeductions, 2) + ' KG';
        document.getElementById('calc-net-weight').textContent = Utils.formatNum(netWeight, 2) + ' KG';
        document.getElementById('calc-net-bags').textContent = Utils.formatNum(netBags, 2);
        document.getElementById('calc-net-mn').textContent = Utils.formatNum(netMn, 2);
        document.getElementById('calc-amount').textContent = 'PKR ' + Utils.formatPKR(amount);
        document.getElementById('calc-pkr-deductions').textContent = 'PKR ' + Utils.formatPKR(totalPkrDeductions + advanceDeducted);
        document.getElementById('calc-net-amount').textContent = 'PKR ' + Utils.formatPKR(netPayableAmount);

        // Payment balance
        const status = document.getElementById('p-payment-status').value;
        let amountPaid = Utils.pf(document.getElementById('p-amount-paid').value);
        if (status === 'paid') { amountPaid = netPayableAmount; document.getElementById('p-amount-paid').value = netPayableAmount.toFixed(2); }
        const balance = Utils.roundCurrency(netPayableAmount - amountPaid);
        document.getElementById('calc-balance').textContent = 'PKR ' + Utils.formatPKR(balance);
    },

    async handleScaleImage(event) {
        const file = event.target.files[0];
        if (!file) return;
        let base64 = await Utils.fileToBase64(file);
        base64 = await Utils.compressImage(base64, 800, 0.7);
        this.scaleImage = base64;
        this.renderScaleImage(base64);
    },

    renderScaleImage(imgSrc) {
        const area = document.getElementById('scale-slip-area');
        if (!area) return;
        area.innerHTML = '';
        const img = document.createElement('img');
        img.src = imgSrc;
        img.alt = 'Scale Slip';
        const btn = document.createElement('button');
        btn.className = 'btn btn-danger btn-sm';
        btn.style.position = 'absolute';
        btn.style.top = '8px';
        btn.style.right = '8px';
        btn.textContent = '×';
        btn.onclick = (e) => { e.stopPropagation(); Purchasing.removeScaleImage(); };
        area.appendChild(img);
        area.appendChild(btn);
        area.style.position = 'relative';
    },

    removeScaleImage() {
        this.scaleImage = null;
        document.getElementById('p-scale-image').value = '';
        document.getElementById('scale-slip-area').innerHTML = `<i data-lucide="image-plus" style="width:32px;height:32px;color:var(--text-muted)"></i><span class="upload-text">Click to upload scale weight slip</span>`;
        Utils.safeCreateIcons();
    },

    getData() {
        const method = this.method;
        let grossWeight = 0, perBagWeight = 0, bagsCount = 0;
        if (method === 'scale') {
            grossWeight = Utils.pf(document.getElementById('p-gross-weight').value);
            perBagWeight = Utils.pf(document.getElementById('p-per-bag-weight').value);
            bagsCount = perBagWeight > 0 ? grossWeight / perBagWeight : 0;
        } else {
            bagsCount = Utils.pf(document.getElementById('p-num-bags').value);
            perBagWeight = Utils.pf(document.getElementById('p-weight-per-bag').value);
            grossWeight = bagsCount * perBagWeight;
        }
        const bardanaPerBag = Utils.pf(document.getElementById('p-bardana').value);
        const labourPerBag = Utils.pf(document.getElementById('p-labour').value);
        const bardanaTotal = bardanaPerBag * bagsCount;
        const labourTotal = labourPerBag * bagsCount;

        let totalKgDed = bardanaTotal + labourTotal;
        let totalPkrDed = 0;
        const addDeds = this.additionalDeductions.map(d => {
            let totalKg = 0, totalPkr = 0;
            if (d.unit === 'kg') { totalKg = d.amount; totalKgDed += totalKg; }
            else if (d.unit === 'kg_per_bag') { totalKg = d.amount * bagsCount; totalKgDed += totalKg; }
            else if (d.unit === 'bags') { totalKg = d.amount * perBagWeight; totalKgDed += totalKg; }
            else if (d.unit === 'pkr') { totalPkr = d.amount; totalPkrDed += totalPkr; }
            return { ...d, totalKg, totalPkr };
        });

        const netWeight = Math.max(0, grossWeight - totalKgDed);
        const netBags = perBagWeight > 0 ? netWeight / perBagWeight : 0;
        const netMn = netWeight / 40;
        const rate = Utils.pf(document.getElementById('p-rate').value);
        const amount = Utils.roundCurrency(netMn * rate);
        
        const commissionRate = Utils.pf(document.getElementById('p-commission') ? document.getElementById('p-commission').value : 0);
        const mandiTaxRate = Utils.pf(document.getElementById('p-mandi-tax') ? document.getElementById('p-mandi-tax').value : 0);
        const commissionTotal = Utils.roundCurrency(amount * (commissionRate / 100));
        const mandiTaxTotal = Utils.roundCurrency(amount * (mandiTaxRate / 100));
        totalPkrDed += commissionTotal + mandiTaxTotal;

        const advanceDeducted = Utils.pf(document.getElementById('p-deduct-advance').value);
        const pkrDeductionsBeforeAdvance = totalPkrDed;
        const payableBeforeAdvance = Math.max(0, Utils.roundCurrency(amount - pkrDeductionsBeforeAdvance));
        const netPayableAmount = Math.max(0, Utils.roundCurrency(payableBeforeAdvance - advanceDeducted));
        const paymentStatus = document.getElementById('p-payment-status').value;
        let amountPaid = Utils.pf(document.getElementById('p-amount-paid').value);
        if (paymentStatus === 'paid') amountPaid = netPayableAmount;

        return {
            id: document.getElementById('p-id').value,
            farmerName: document.getElementById('p-farmer').value.trim(),
            date: document.getElementById('p-date').value,
            crop: document.getElementById('p-crop').value,
            method, grossWeight, perBagWeight, bagsCount,
            bardanaPerBag, labourPerBag, bardanaTotal, labourTotal,
            commissionRate, mandiTaxRate, commissionTotal, mandiTaxTotal,
            additionalDeductions: addDeds,
            totalKgDeductions: totalKgDed,
            totalPkrDeductions: totalPkrDed + advanceDeducted,
            pkrDeductionsBeforeAdvance,
            payableBeforeAdvance,
            advanceDeducted,
            netWeight, netBags, netMn, rate, amount, netPayableAmount,
            paymentStatus, amountPaid,
            balance: Utils.roundCurrency(netPayableAmount - amountPaid),
            dueDate: document.getElementById('p-due-date').value || '',
            initialPaymentAccountId: document.getElementById('p-initial-account') ? document.getElementById('p-initial-account').value : '',
            notes: document.getElementById('p-notes').value.trim(),
            scaleImage: this.scaleImage,
            createdAt: new Date().toISOString()
        };
    },

    async getAvailableAdvance(farmerName, purchaseId = null) {
        return await Utils.getFarmerAvailableAdvance(farmerName, { excludePurchaseId: purchaseId });
    },

    async validate(data) {
        if (!data.farmerName) { Utils.showToast('Farmer name is required', 'error'); return false; }
        if (!data.crop) { Utils.showToast('Crop is required', 'error'); return false; }
        if (data.grossWeight <= 0) { Utils.showToast('Weight must be greater than 0', 'error'); return false; }
        if (data.rate <= 0) { Utils.showToast('Rate must be greater than 0', 'error'); return false; }
        if (data.amountPaid < 0) { Utils.showToast('Paid amount cannot be negative', 'error'); return false; }
        if (data.amountPaid > data.netPayableAmount) { Utils.showToast('Paid amount cannot exceed net payable amount', 'error'); return false; }
        const linkedPayments = await DB.getByIndex('purchase_payments', 'purchaseId', data.id);
        const laterPaid = Utils.sumBy(linkedPayments, 'amount');
        const initialPaid = Math.max(0, (data.amountPaid || 0) - laterPaid);
        if (initialPaid > 0 && !data.initialPaymentAccountId) { Utils.showToast('Select cash/bank account for initial payment', 'error'); return false; }
        const availableAdvance = await this.getAvailableAdvance(data.farmerName, data.id);
        if ((data.advanceDeducted || 0) > availableAdvance + 0.01) {
            Utils.showToast(`Advance deduction cannot exceed available advance PKR ${Utils.formatPKR(availableAdvance)}`, 'error');
            return false;
        }
        return true;
    },

    async processAdvanceDeduction(data) {
        const all = await DB.getAll('farmer_advances');
        const existing = all.filter(a => a.purchaseId === data.id && (a.amount || 0) <= 0);
        for (const e of existing) await DB.delete('farmer_advances', e.id);
    },

    async syncInitialPaymentTx(data) {
        await Utils.deleteLinkedCapitalTx('purchases', data.id);
        const linkedPayments = await DB.getByIndex('purchase_payments', 'purchaseId', data.id);
        const laterPayments = Utils.sumBy(linkedPayments, 'amount');
        const initialPaid = Math.max(0, (data.amountPaid || 0) - laterPayments);
        data.initialPaymentAmount = initialPaid;
        data.initialCapitalTxId = null;
        if (initialPaid > 0 && data.initialPaymentAccountId) {
            const tx = await Utils.createLinkedCapitalTx({
                accountId: data.initialPaymentAccountId,
                type: 'withdrawal',
                amount: initialPaid,
                date: data.date,
                description: `Initial payment to farmer ${data.farmerName} for purchase #${data.id}`,
                sourceStore: 'purchases',
                sourceId: data.id
            });
            if (tx) data.initialCapitalTxId = tx.id;
        }
        await DB.put('purchases', data);
    },

    async buildUnitOfWorkOperations(data, existing) {
        const ops = [];
        
        // 1. Purchase record
        ops.push({ storeName: 'purchases', action: 'put', data });

        // 2. Farmer record
        const farmerName = (data.farmerName || '').trim();
        if (farmerName) {
            const farmers = await DB.getAll('farmers');
            const f = farmers.find(x => x.name.toLowerCase() === farmerName.toLowerCase());
            if (!f) {
                ops.push({ storeName: 'farmers', action: 'put', data: { id: Utils.generateId(), name: farmerName, phone: '', address: '', createdAt: new Date().toISOString() } });
            }
        }

        // 3. Farmer advances cleanup of any legacy negative deduction records
        const allAdv = await DB.getAll('farmer_advances');
        const existingAdv = allAdv.filter(a => a.purchaseId === data.id && (a.amount || 0) <= 0);
        existingAdv.forEach(e => ops.push({ storeName: 'farmer_advances', action: 'delete', key: e.id }));

        // 4. Linked capital transactions
        const capTxs = await DB.getAll('capital_transactions');
        const linkedCap = capTxs.filter(t => t.sourceStore === 'purchases' && t.sourceId === data.id);
        linkedCap.forEach(t => ops.push({ storeName: 'capital_transactions', action: 'delete', key: t.id }));
        
        const linkedPayments = await DB.getByIndex('purchase_payments', 'purchaseId', data.id);
        const laterPayments = Utils.sumBy(linkedPayments, 'amount');
        const initialPaid = Math.max(0, (data.amountPaid || 0) - laterPayments);
        data.initialPaymentAmount = initialPaid;
        data.initialCapitalTxId = null;
        if (initialPaid > 0 && data.initialPaymentAccountId) {
            const txId = Utils.generateId();
            data.initialCapitalTxId = txId;
            ops.push({
                storeName: 'capital_transactions',
                action: 'put',
                data: {
                    id: txId,
                    accountId: data.initialPaymentAccountId,
                    type: 'withdrawal',
                    amount: initialPaid,
                    date: data.date,
                    description: `Initial payment to farmer ${data.farmerName} for purchase #${data.id}`,
                    sourceStore: 'purchases',
                    sourceId: data.id,
                    isReconciled: false,
                    createdAt: new Date().toISOString()
                }
            });
        }

        // 5. Audit log
        ops.push({
            storeName: 'audit_logs',
            action: 'put',
            data: {
                id: Utils.generateId(),
                date: Utils.todayISO(),
                action: existing ? 'update' : 'create',
                entityType: 'purchase',
                entityId: data.id,
                details: {
                    oldAmount: existing ? (existing.netPayableAmount || existing.amount || 0) : null,
                    newAmount: data.netPayableAmount || data.amount || 0
                },
                createdAt: new Date().toISOString()
            }
        });

        // 6. Materialized Views (Stock & Farmer Balance)
        if (typeof CoreServices !== 'undefined') {
            const stockDeltas = {};
            const farmerDeltas = {};
            
            if (existing && existing.crop) {
                const c = existing.crop.trim().toLowerCase();
                stockDeltas[c] = (stockDeltas[c] || 0) - (existing.netWeight || 0);
            }
            if (data.crop) {
                const c = data.crop.trim().toLowerCase();
                stockDeltas[c] = (stockDeltas[c] || 0) + (data.netWeight || 0);
            }
            
            if (existing && existing.farmerName) {
                const f = existing.farmerName.trim().toLowerCase();
                farmerDeltas[f] = (farmerDeltas[f] || 0) - ((existing.netPayableAmount || existing.amount || 0) - (existing.amountPaid || 0));
            }
            if (data.farmerName) {
                const f = data.farmerName.trim().toLowerCase();
                farmerDeltas[f] = (farmerDeltas[f] || 0) + ((data.netPayableAmount || data.amount || 0) - (data.amountPaid || 0));
            }
            
            for (const [crop, delta] of Object.entries(stockDeltas)) {
                if (Math.abs(delta) < 0.001) continue;
                const op = await CoreServices.getStockOp(crop, delta);
                if (op) ops.push(op);
            }
            for (const [farmer, delta] of Object.entries(farmerDeltas)) {
                if (Math.abs(delta) < 0.001) continue;
                const op = await CoreServices.getPartyBalanceOp('farmer', farmer, delta);
                if (op) ops.push(op);
            }
        }

        return ops;
    },

    async save() {
        const data = this.getData();
        if (!await this.validate(data)) return;
        const existing = await DB.get('purchases', data.id);
        if (existing) {
            const payments = await DB.getByIndex('purchase_payments', 'purchaseId', data.id);
            const oldAmount = existing.netPayableAmount || existing.amount || 0;
            const newAmount = data.netPayableAmount || data.amount || 0;
            if (payments.length && Math.abs(oldAmount - newAmount) > 0.01) {
                const ok = await Utils.confirm(`This purchase has ${payments.length} linked payment(s). Change amount from PKR ${Utils.formatPKR(oldAmount)} to PKR ${Utils.formatPKR(newAmount)}?`);
                if (!ok) return;
            }
            data.createdAt = existing.createdAt || data.createdAt;
            data.updatedAt = new Date().toISOString();
        }

        const ops = await this.buildUnitOfWorkOperations(data, existing);
        await DB.commitUnitOfWork(ops);
        await Utils.confirmReceiptId('purchase', data.id);

        Utils.showToast('Purchase receipt saved!');
        this.clearForm();
        if (typeof StockAdjustments !== 'undefined' && typeof StockAdjustments.syncAll === 'function') await StockAdjustments.syncAll();
        return data;
    },

    async saveAndPrint() {
        const data = await this.save();
        if (data) {
            Utils.showToast('Receipt saved! Generating PDF...');
            Utils.showLoading('Generating PDF...');
            await ReceiptPDF.generatePurchase(data);
            Utils.hideLoading();
        }
    },

    async clearForm() {
        this.editingId = null;
        this.additionalDeductions = [];
        this.scaleImage = null;
        document.getElementById('p-id').value = await Utils.getNextReceiptId('purchase');
        document.getElementById('p-date').value = Utils.todayISO();
        document.getElementById('p-farmer').value = '';
        document.getElementById('p-crop').value = '';
        document.getElementById('p-gross-weight').value = '';
        document.getElementById('p-num-bags').value = '';
        document.getElementById('p-rate').value = '';
        document.getElementById('p-amount-paid').value = '0';
        if (document.getElementById('p-initial-account')) {
            await Utils.populateCapitalAccountSelect('p-initial-account', 'Select cash/bank account');
        }
        document.getElementById('p-payment-status').value = 'pending';
        document.getElementById('p-notes').value = '';
        document.getElementById('p-due-date').value = '';
        document.getElementById('p-deduct-advance').value = '0';
        document.getElementById('p-outstanding-adv').textContent = 'PKR 0.00';
        const defs = await Settings.getDefaults();
        document.getElementById('p-per-bag-weight').value = defs.perBagWeight || 100;
        document.getElementById('p-weight-per-bag').value = defs.perBagWeight || 100;
        document.getElementById('p-bardana').value = defs.defaultBardana || 0;
        document.getElementById('p-labour').value = defs.defaultLabour || 0;
        this.renderDeductions();
        this.removeScaleImage();
        this.setMethod('scale');
        this.calculate();
        await this.loadFarmerDatalist();
    },

    async loadForEdit(id) {
        const data = await DB.get('purchases', id);
        if (!data) return;
        const payments = await DB.getByIndex('purchase_payments', 'purchaseId', id);
        if (payments.length) {
            const ok = await Utils.confirm(`This purchase has ${payments.length} linked payment(s). Editing weight, rate, deductions, or paid amount can change balances. Continue?`);
            if (!ok) return;
        }
        this.editingId = id;
        document.getElementById('p-id').value = data.id;
        document.getElementById('p-date').value = data.date;
        document.getElementById('p-farmer').value = data.farmerName;
        document.getElementById('p-crop').value = data.crop;
        document.getElementById('p-rate').value = data.rate;
        document.getElementById('p-payment-status').value = data.paymentStatus;
        document.getElementById('p-amount-paid').value = data.amountPaid;
        if (document.getElementById('p-initial-account')) {
            await Utils.populateCapitalAccountSelect('p-initial-account', 'Select cash/bank account');
            document.getElementById('p-initial-account').value = data.initialPaymentAccountId || '';
        }
        document.getElementById('p-notes').value = data.notes || '';
        document.getElementById('p-due-date').value = data.dueDate || '';
        document.getElementById('p-deduct-advance').value = data.advanceDeducted || 0;
        document.getElementById('p-bardana').value = data.bardanaPerBag;
        document.getElementById('p-labour').value = data.labourPerBag;
        
        await this.loadFarmerAdvances();

        this.setMethod(data.method);
        if (data.method === 'scale') {
            document.getElementById('p-gross-weight').value = data.grossWeight;
            document.getElementById('p-per-bag-weight').value = data.perBagWeight;
        } else {
            document.getElementById('p-num-bags').value = data.bagsCount;
            document.getElementById('p-weight-per-bag').value = data.perBagWeight;
        }

        this.additionalDeductions = (data.additionalDeductions || []).map(d => ({ ...d, id: d.id || Date.now() + Math.random() }));
        this.renderDeductions();
        if (data.scaleImage) {
            this.scaleImage = data.scaleImage;
            this.renderScaleImage(data.scaleImage);
        }
        this.calculate();
        App.navigate('purchasing');
    }
};

// ===== Purchase List =====
const PurchaseList = {
    currentPage: 1,
    async render(page) {
        if (page) this.currentPage = page;
        const activeSeason = await Utils.getActiveSeason();
        const all = Utils.filterBySeason(await DB.getAll('purchases'), activeSeason);
        const search = (document.getElementById('pl-search').value || '').toLowerCase();
        const cropFilter = document.getElementById('pl-crop-filter').value;
        const statusFilter = document.getElementById('pl-status-filter').value;

        let filtered = all.filter(p => {
            if (search && !p.farmerName.toLowerCase().includes(search) && !p.id.toLowerCase().includes(search) && !(p.crop||'').toLowerCase().includes(search)) return false;
            if (cropFilter && p.crop !== cropFilter) return false;
            if (statusFilter && p.paymentStatus !== statusFilter) return false;
            return true;
        }).sort((a, b) => new Date(b.date) - new Date(a.date));

        const { items, page: p, totalPages } = Utils.paginate(filtered, this.currentPage, 25);
        this.currentPage = p;

        const tbody = document.getElementById('purchase-tbody');
        const empty = document.getElementById('purchase-empty');

        if (filtered.length === 0) {
            tbody.innerHTML = '';
            empty.style.display = '';
            document.getElementById('purchase-pagination') && (document.getElementById('purchase-pagination').innerHTML = '');
            return;
        }
        empty.style.display = 'none';
        tbody.innerHTML = items.map(p => `<tr>
            <td class="font-bold">${Utils.highlightText(p.id, search)}</td>
            <td>${Utils.formatDate(p.date)}</td>
            <td class="font-bold">${Utils.highlightText(p.farmerName, search)}</td>
            <td>${Utils.highlightText(p.crop, search)}</td>
            <td>${p.method === 'scale' ? '⚖️' : '🛍️'}</td>
            <td>${Utils.formatNum(p.netWeight)} KG</td>
            <td>PKR ${Utils.formatPKR(p.rate)}</td>
            <td class="text-right font-bold">PKR ${Utils.formatPKR(p.netPayableAmount || p.amount)}</td>
            <td>${Utils.statusBadge(p.paymentStatus)}</td>
            <td><div class="table-actions">
                <button class="btn btn-icon btn-ghost btn-sm" onclick="Purchasing.loadForEdit('${p.id}')" title="Edit">✏️</button>
                <button class="btn btn-icon btn-ghost btn-sm" onclick="ReceiptPDF.generatePurchase(null,'${p.id}')" title="PDF">📄</button>
                <button class="btn btn-icon btn-danger btn-sm" onclick="PurchaseList.delete('${p.id}')" title="Delete">🗑️</button>
            </div></td>
        </tr>`).join('');

        Utils.renderPagination('purchase-pagination', this.currentPage, totalPages, 'PurchaseList.render');
    },

    async delete(id) {
        const purchase = await DB.get('purchases', id);
        if (!purchase) return;
        const payments = await DB.getByIndex('purchase_payments', 'purchaseId', id);
        const expenses = await DB.getByIndex('expenses', 'purchaseId', id);
        const paymentTotal = Utils.sumBy(payments, 'amount');
        const expenseTotal = Utils.sumBy(expenses, 'amount');
        const msg = `Delete purchase ${id}?\n\nLinked farmer payments: ${payments.length} (PKR ${Utils.formatPKR(paymentTotal)})\nLinked expenses that will be removed: ${expenses.length} (PKR ${Utils.formatPKR(expenseTotal)})\nLinked capital transactions for those payments/expenses will also be removed.`;
        if (!await Utils.confirm(msg)) return;
        const ops = [];
        const allCapTxs = await DB.getAll('capital_transactions') || [];

        for (const e of expenses) {
            const linkedCap = allCapTxs.filter(t => t.sourceStore === 'expenses' && t.sourceId === e.id);
            for (const lc of linkedCap) ops.push({ storeName: 'capital_transactions', action: 'delete', key: lc.id, softDelete: true, data: lc });
            ops.push({ storeName: 'expenses', action: 'delete', key: e.id, softDelete: true, data: e });
        }
        for (const p of payments) {
            const linkedCap = allCapTxs.filter(t => t.sourceStore === 'purchase_payments' && t.sourceId === p.id);
            for (const lc of linkedCap) ops.push({ storeName: 'capital_transactions', action: 'delete', key: lc.id, softDelete: true, data: lc });
            ops.push({ storeName: 'purchase_payments', action: 'delete', key: p.id, softDelete: true, data: p });
        }
        const linkedCap = allCapTxs.filter(t => t.sourceStore === 'purchases' && t.sourceId === id);
        for (const lc of linkedCap) ops.push({ storeName: 'capital_transactions', action: 'delete', key: lc.id, softDelete: true, data: lc });

        ops.push({ storeName: 'audit_logs', action: 'put', data: {
            id: Utils.generateId(), date: Utils.todayISO(), action: 'delete',
            entityType: 'purchase', entityId: id, details: { amount: purchase.netPayableAmount || purchase.amount || 0 },
            createdAt: new Date().toISOString()
        }});

        if (typeof CoreServices !== 'undefined') {
            if (purchase.crop) {
                const op = await CoreServices.getStockOp(purchase.crop, -(purchase.netWeight || 0));
                if (op) ops.push(op);
            }
            if (purchase.farmerName) {
                const op = await CoreServices.getPartyBalanceOp('farmer', purchase.farmerName, -((purchase.netPayableAmount || purchase.amount || 0) - (purchase.amountPaid || 0)));
                if (op) ops.push(op);
            }
        }

        ops.push({ storeName: 'purchases', action: 'delete', key: id, softDelete: true, data: purchase });

        await DB.commitUnitOfWork(ops);
        await Utils.audit('delete', 'purchase', id, {
            oldAmount: purchase.netPayableAmount || purchase.amount || 0,
            oldRecord: purchase,
            linkedPayments: payments,
            linkedExpenses: expenses
        });
        Utils.showToast('Deleted!');
        this.render();
        if (typeof StockAdjustments !== 'undefined' && typeof StockAdjustments.syncAll === 'function') await StockAdjustments.syncAll();
    }
};

// Purchase Export
const PurchaseExport = {
    async toExcel() {
        if (!Utils.requireExcel()) return;
        const activeSeason = await Utils.getActiveSeason();
        const all = Utils.filterBySeason(await DB.getAll('purchases'), activeSeason);
        if (!all.length) { Utils.showToast('No data to export', 'warning'); return; }
        const rows = all.sort((a,b) => new Date(b.date)-new Date(a.date)).map(p => ({
            'ID': p.id, 'Date': p.date, 'Farmer': p.farmerName, 'Crop': p.crop,
            'Method': p.method, 'Gross Weight (KG)': p.grossWeight, 'Net Weight (KG)': p.netWeight,
            'Net Maund': Utils.formatNum(p.netMn,2), 'Rate/Mn': p.rate,
            'Amount': p.amount, 'PKR Deductions': p.totalPkrDeductions || 0,
            'Cost Before Advance': Utils.purchaseCostAmount(p),
            'Net Payable': p.netPayableAmount || p.amount,
            'Paid': p.amountPaid, 'Balance': p.balance, 'Status': p.paymentStatus
        }));
        const ws = XLSX.utils.json_to_sheet(rows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Purchases');
        XLSX.writeFile(wb, `Purchases_${Utils.todayISO()}.xlsx`);
        Utils.showToast('Excel exported!');
    }
};
