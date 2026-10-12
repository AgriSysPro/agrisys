// ===== Opening Balances, Stock Adjustments, Inventory Lots, Aging =====

const OpeningBalances = {
    async render() {
        const activeSeason = await Utils.getActiveSeason();
        const balances = Utils.filterBySeason(await DB.getAll('opening_balances'), activeSeason)
            .sort((a, b) => new Date(b.date) - new Date(a.date));
        const accounts = await DB.getAll('capital_accounts');
        const accountMap = Object.fromEntries(accounts.map(a => [a.id, a.name]));
        document.getElementById('ob-tbody').innerHTML = balances.map(b => {
            const settled = this.settledAmount(b);
            const balance = this.balanceAmount(b);
            const canSettle = ['farmer_payable', 'buyer_receivable'].includes(b.type) && balance > 0;
            const status = balance <= 0 ? 'paid' : settled > 0 ? 'partial' : 'pending';
            return `<tr>
            <td>${Utils.formatDate(b.date)}</td>
            <td><span class="badge badge-info">${Utils.escapeHTML(this.labelType(b.type))}</span></td>
            <td>${Utils.escapeHTML(b.partyName || b.crop || '-')}</td>
            <td>${Utils.escapeHTML(accountMap[b.accountId] || '-')}</td>
            <td class="text-right">${b.weight ? Utils.formatNum(b.weight, 2) + ' KG' : '-'}</td>
            <td class="text-right font-bold">PKR ${Utils.formatPKR(b.amount || 0)}</td>
            <td class="text-right">PKR ${Utils.formatPKR(settled)}</td>
            <td class="text-right font-bold">PKR ${Utils.formatPKR(balance)}</td>
            <td>${Utils.statusBadge(status)}</td>
            <td>${Utils.escapeHTML(b.notes || '-')}</td>
            <td><div class="table-actions">
                ${canSettle ? `<button class="btn btn-icon btn-success btn-sm" onclick="OpeningBalances.settle('${b.id}')" title="Settle">PKR</button>` : ''}
                <button class="btn btn-icon btn-danger btn-sm" onclick="OpeningBalances.delete('${b.id}')" title="Delete">x</button>
            </div></td>
        </tr>`;
        }).join('') || '<tr><td colspan="11" class="text-center" style="color:var(--text-muted)">No opening balances</td></tr>';
    },

    settledAmount(balance) {
        return balance.paidAmount || balance.receivedAmount || balance.settledAmount || 0;
    },

    balanceAmount(balance) {
        return Math.max(0, (balance.amount || 0) - this.settledAmount(balance));
    },

    labelType(type) {
        return {
            farmer_payable: 'Farmer Payable',
            buyer_receivable: 'Buyer Receivable',
            farmer_advance: 'Farmer Advance',
            buyer_advance: 'Buyer Advance',
            capital: 'Capital / Cash',
            stock: 'Crop Stock'
        }[type] || type;
    },

    async showModal() {
        document.getElementById('ob-type').value = 'farmer_payable';
        document.getElementById('ob-date').value = Utils.todayISO();
        document.getElementById('ob-party').value = '';
        document.getElementById('ob-crop').value = '';
        document.getElementById('ob-weight').value = '';
        document.getElementById('ob-amount').value = '';
        document.getElementById('ob-notes').value = '';
        await Utils.populateCapitalAccountSelect('ob-account', 'Select account');
        await this.populatePartyDatalist();
        this.populateCropSelect();
        this.updateFields();
        Utils.showModal('opening-balance-modal');
    },

    async populatePartyDatalist() {
        const farmers = await DB.getAll('farmers');
        const buyers = await DB.getAll('buyers');
        const names = [...new Set(farmers.map(f => f.name).concat(buyers.map(b => b.name)))].sort();
        document.getElementById('ob-party-datalist').innerHTML = names.map(n => `<option value="${Utils.escapeHTML(n)}">`).join('');
    },

    populateCropSelect() {
        const target = document.getElementById('ob-crop');
        const source = document.getElementById('p-crop');
        target.innerHTML = '<option value="">Select Crop</option>';
        Array.from(source.options).slice(1).forEach(o => target.appendChild(o.cloneNode(true)));
    },

    updateFields() {
        const type = document.getElementById('ob-type').value;
        document.getElementById('ob-party-wrap').style.display = ['farmer_payable', 'buyer_receivable', 'farmer_advance', 'buyer_advance'].includes(type) ? '' : 'none';
        document.getElementById('ob-account-wrap').style.display = type === 'capital' ? '' : 'none';
        document.getElementById('ob-crop-wrap').style.display = type === 'stock' ? '' : 'none';
        document.getElementById('ob-weight-wrap').style.display = type === 'stock' ? '' : 'none';
    },

    async save() {
        const snapshot = await DB.financialSnapshot();
        const type = document.getElementById('ob-type').value;
        const amount = Utils.pf(document.getElementById('ob-amount').value);
        const weight = Utils.pf(document.getElementById('ob-weight').value);
        const data = {
            id: Utils.generateId(),
            type,
            date: document.getElementById('ob-date').value,
            partyName: document.getElementById('ob-party').value.trim(),
            crop: document.getElementById('ob-crop').value,
            accountId: document.getElementById('ob-account').value,
            weight,
            amount,
            notes: document.getElementById('ob-notes').value.trim(),
            createdAt: new Date().toISOString()
        };
        if (amount <= 0) { Utils.showToast('Amount is required', 'error'); return; }
        if (type === 'stock' && (!data.crop || weight <= 0)) { Utils.showToast('Crop and stock weight are required', 'error'); return; }
        if (type === 'capital' && !data.accountId) { Utils.showToast('Select a capital account', 'error'); return; }
        if (['farmer_payable', 'buyer_receivable', 'farmer_advance', 'buyer_advance'].includes(type) && !data.partyName) {
            Utils.showToast('Party name is required', 'error'); return;
        }

        const ops = [];
        ops.push({ storeName: 'opening_balances', action: 'put', data });

        if (type === 'farmer_payable' || type === 'farmer_advance') {
            const exists = (await DB.getAll('farmers')).some(f => f.name.trim().toLowerCase() === data.partyName.trim().toLowerCase());
            if (!exists) ops.push({ storeName: 'farmers', action: 'put', data: { id: Utils.generateId(), name: data.partyName, phone: '', address: '', notes: '', createdAt: new Date().toISOString() } });
        }
        if (type === 'buyer_receivable' || type === 'buyer_advance') {
            const exists = (await DB.getAll('buyers')).some(b => b.name.trim().toLowerCase() === data.partyName.trim().toLowerCase());
            if (!exists) ops.push({ storeName: 'buyers', action: 'put', data: { id: Utils.generateId(), name: data.partyName, phone: '', address: '', notes: '', createdAt: new Date().toISOString() } });
        }

        if (type === 'capital') {
            const tx = { id: Utils.generateId(), accountId: data.accountId, type: 'deposit', amount, date: data.date,
                description: 'Opening capital balance', sourceStore: 'opening_balances', sourceId: data.id,
                isReconciled: false, createdAt: new Date().toISOString() };
            data.capitalTxId = tx.id;
            ops[0] = { storeName: 'opening_balances', action: 'put', data };
            ops.push({ storeName: 'capital_transactions', action: 'put', data: tx });
            ops.push({
                storeName: 'capital_entries',
                action: 'put',
                data: {
                    id: Utils.generateId(),
                    type: 'contribution',
                    amount,
                    date: data.date,
                    description: 'Opening capital balance',
                    accountId: data.accountId,
                    linkedTxId: tx.id,
                    sourceStore: 'opening_balances',
                    sourceId: data.id,
                    createdAt: new Date().toISOString()
                }
            });
        }
        if (type === 'stock') {
            const adj = {
                id: data.id,
                date: data.date,
                crop: data.crop,
                direction: 'opening',
                reason: 'Opening Stock',
                weight,
                value: amount,
                notes: data.notes,
                createdAt: data.createdAt
            };
            ops.push({ storeName: 'stock_adjustments', action: 'put', data: adj });
        }
        
        ops.push({
            storeName: 'audit_logs', action: 'put', data: {
                id: Utils.generateId(), date: Utils.todayISO(), action: 'create',
                entityType: 'opening_balance', entityId: data.id, 
                details: { type, newAmount: amount, partyName: data.partyName, crop: data.crop },
                createdAt: new Date().toISOString()
            }
        });

        if (typeof CoreServices !== 'undefined') {
            if (type === 'stock' && data.crop) {
                const op = await CoreServices.getStockOp(data.crop, weight);
                if (op) ops.push(op);
            }
            if (type === 'farmer_payable' && data.partyName) {
                const op = await CoreServices.getPartyBalanceOp('farmer', data.partyName, amount);
                if (op) ops.push(op);
            }
            if (type === 'farmer_advance' && data.partyName) {
                const op = await CoreServices.getPartyBalanceOp('farmer', data.partyName, -amount);
                if (op) ops.push(op);
            }
            if (type === 'buyer_receivable' && data.partyName) {
                const op = await CoreServices.getPartyBalanceOp('buyer', data.partyName, amount);
                if (op) ops.push(op);
            }
            if (type === 'buyer_advance' && data.partyName) {
                const op = await CoreServices.getPartyBalanceOp('buyer', data.partyName, -amount);
                if (op) ops.push(op);
            }
        }

        try {
            await Utils.validateStockHistory(ops);
            await Utils.validateAdvanceHistory(ops);
            await DB.commitUnitOfWork(ops, snapshot);
        } catch (error) { Utils.showToast(error.message, 'error'); return; }
        Utils.hideModal('opening-balance-modal');
        Utils.showToast('Opening balance saved!');
        this.render();
    },

    async settle(id) {
        const b = await DB.get('opening_balances', id);
        if (!b || !['farmer_payable', 'buyer_receivable'].includes(b.type)) return;
        const balance = this.balanceAmount(b);
        if (balance <= 0) { Utils.showToast('Opening balance is already settled', 'warning'); return; }

        const isFarmer = b.type === 'farmer_payable';
        document.getElementById('pay-modal-title').textContent = isFarmer
            ? `Pay Opening Farmer Balance: ${b.partyName}`
            : `Receive Opening Buyer Balance: ${b.partyName}`;
        document.getElementById('pay-receipt-id').value = await Utils.getNextReceiptId('payment');
        document.getElementById('pay-amount').value = balance.toFixed(2);
        document.getElementById('pay-amount').max = balance;
        document.getElementById('pay-date').value = Utils.todayISO();
        document.getElementById('pay-mode').value = 'cash';
        document.getElementById('pay-ref').value = '';
        document.getElementById('pay-notes').value = '';
        await Utils.populateCapitalAccountSelect('pay-account', 'Select cash/bank account');

        const savePayment = async (printAfterSave = false) => {
            const payAmt = Utils.pf(document.getElementById('pay-amount').value);
            if (payAmt <= 0) { Utils.showToast('Amount must be > 0', 'error'); return; }
            if (!document.getElementById('pay-account').value) { Utils.showToast('Select cash/bank account for this settlement', 'error'); return; }
            const snapshot = await DB.financialSnapshot();
            const current = await DB.get('opening_balances', b.id);
            if (!current || current.type !== b.type) { Utils.showToast('Opening balance no longer exists', 'error'); return; }
            const existingPayments = (await DB.getAll('opening_balance_payments')).filter(p => p.openingBalanceId === b.id);
            const recordedSettled = this.settledAmount(current);
            const eventSettled = existingPayments.reduce((sum, p) => sum + (p.amount || 0), 0);
            const currentSettled = Math.max(recordedSettled, eventSettled);
            const currentBalance = Math.max(0, (current.amount || 0) - currentSettled);
            if (payAmt > currentBalance + 0.001) { Utils.showToast('Opening balance changed in another tab. Refresh and retry.', 'error'); return; }
            const receiptNo = document.getElementById('pay-receipt-id').value;
            const payment = {
                id: Utils.generateId(),
                receiptNo,
                openingBalanceId: b.id,
                type: b.type,
                partyName: b.partyName,
                farmerName: isFarmer ? b.partyName : '',
                buyerName: isFarmer ? '' : b.partyName,
                sourceLabel: 'Opening Balance:',
                sourceRef: b.id,
                amount: payAmt,
                date: document.getElementById('pay-date').value,
                mode: document.getElementById('pay-mode').value,
                reference: document.getElementById('pay-ref').value.trim(),
                notes: document.getElementById('pay-notes').value.trim(),
                accountId: document.getElementById('pay-account').value,
                previousBalance: currentBalance,
                newBalance: currentBalance - payAmt,
                createdAt: new Date().toISOString()
            };
            const tx = { id: Utils.generateId(), accountId: payment.accountId, type: isFarmer ? 'withdrawal' : 'deposit', amount: payAmt,
                date: payment.date, description: isFarmer
                    ? `Payment to farmer ${current.partyName} against opening balance`
                    : `Receipt from buyer ${current.partyName} against opening balance`,
                sourceStore: 'opening_balance_payments', sourceId: payment.id, isReconciled: false, createdAt: payment.createdAt };
            payment.capitalTxId = tx.id;
            const newSettled = currentSettled + payAmt;
            current.settledAmount = newSettled;
            if (isFarmer) current.paidAmount = newSettled;
            else current.receivedAmount = newSettled;
            current.balance = Math.max(0, (current.amount || 0) - newSettled);
            current.settlementStatus = current.balance <= 0 ? 'paid' : 'partial';
            current.updatedAt = new Date().toISOString();
            const ops = [
                { storeName: 'opening_balance_payments', action: 'put', data: payment },
                { storeName: 'capital_transactions', action: 'put', data: tx },
                { storeName: 'opening_balances', action: 'put', data: current },
                { storeName: 'audit_logs', action: 'put', data: {
                    id: Utils.generateId(), date: Utils.todayISO(), action: 'create', entityType: 'opening_balance_payment', entityId: payment.id,
                    details: { receiptNo, openingBalanceId: current.id, type: current.type, partyName: current.partyName, amount: payAmt,
                        previousBalance: payment.previousBalance, newBalance: payment.newBalance, capitalTxId: tx.id }, createdAt: new Date().toISOString()
                } }
            ];
            if (typeof CoreServices !== 'undefined') {
                const partyType = isFarmer ? 'farmer' : 'buyer';
                const cacheOp = await CoreServices.getPartyBalanceOp(partyType, current.partyName, -payAmt);
                if (cacheOp) ops.push(cacheOp);
            }
            try { await DB.commitUnitOfWork(ops, snapshot); }
            catch (error) { Utils.showToast(error.code === 'CONFLICT' ? 'Opening balance changed in another tab. Refresh and retry.' : error.message, 'error'); return; }
            await Utils.confirmReceiptId('payment', receiptNo);
            Utils.hideModal('payment-modal');
            Utils.showToast(isFarmer ? 'Opening payment recorded!' : 'Opening receipt recorded!');
            if (printAfterSave) await ReceiptPDF.generatePaymentVoucher(payment, current, isFarmer ? 'farmer' : 'buyer');
            this.render();
        };
        document.getElementById('pay-save-btn').onclick = () => savePayment(false);
        document.getElementById('pay-save-print-btn').onclick = () => savePayment(true);
        Utils.showModal('payment-modal');
    },

    async delete(id) {
        const snapshot = await DB.financialSnapshot();
        const b = await DB.get('opening_balances', id);
        if (!b) return;
        const linkedPayments = (await DB.getAll('opening_balance_payments')).filter(p => p.openingBalanceId === id);
        const paymentText = linkedPayments.length ? ` ${linkedPayments.length} linked settlement payment(s) and their cash/bank entries will also be removed.` : '';
        if (!await Utils.confirm(`Delete this opening balance? Linked stock/capital entry will also be removed.${paymentText}`)) return;
        const ops = [];
        const allCapTxs = await DB.getAll('capital_transactions') || [];
        
        const linkedCap = allCapTxs.filter(t => t.sourceStore === 'opening_balances' && t.sourceId === id);
        for (const lc of linkedCap) ops.push({ storeName: 'capital_transactions', action: 'delete', key: lc.id, softDelete: true, data: lc });
        
        for (const payment of linkedPayments) {
            const linkedPayCap = allCapTxs.filter(t => t.sourceStore === 'opening_balance_payments' && t.sourceId === payment.id);
            for (const lc of linkedPayCap) ops.push({ storeName: 'capital_transactions', action: 'delete', key: lc.id, softDelete: true, data: lc });
            ops.push({ storeName: 'opening_balance_payments', action: 'delete', key: payment.id, softDelete: true, data: payment });
        }

        if (b.type === 'stock') {
            const adj = await DB.get('stock_adjustments', id);
            if (adj) ops.push({ storeName: 'stock_adjustments', action: 'delete', key: id, softDelete: true, data: adj });
        }

        // Clean up linked capital_entries for capital-type opening balances
        if (b.type === 'capital') {
            const allCapEntries = await DB.getAll('capital_entries') || [];
            const linked = allCapEntries.filter(e => e.sourceStore === 'opening_balances' && e.sourceId === id);
            for (const ce of linked) ops.push({ storeName: 'capital_entries', action: 'delete', key: ce.id, softDelete: true, data: ce });
        }

        ops.push({ storeName: 'opening_balances', action: 'delete', key: id, softDelete: true, data: b });
        ops.push({
            storeName: 'audit_logs', action: 'put', data: {
                id: Utils.generateId(), date: Utils.todayISO(), action: 'delete',
                entityType: 'opening_balance', entityId: id, details: { oldAmount: b.amount || 0, linkedPayments: linkedPayments.length },
                createdAt: new Date().toISOString()
            }
        });

        if (typeof CoreServices !== 'undefined') {
            if (b.type === 'stock' && b.crop) {
                const op = await CoreServices.getStockOp(b.crop, -(b.weight || 0));
                if (op) ops.push(op);
            }
            if (b.type === 'farmer_payable' && b.partyName) {
                const op = await CoreServices.getPartyBalanceOp('farmer', b.partyName, -Math.max(0, (b.amount || 0) - this.settledAmount(b)));
                if (op) ops.push(op);
            }
            if (b.type === 'farmer_advance' && b.partyName) {
                const op = await CoreServices.getPartyBalanceOp('farmer', b.partyName, (b.amount || 0));
                if (op) ops.push(op);
            }
            if (b.type === 'buyer_receivable' && b.partyName) {
                const op = await CoreServices.getPartyBalanceOp('buyer', b.partyName, -Math.max(0, (b.amount || 0) - this.settledAmount(b)));
                if (op) ops.push(op);
            }
            if (b.type === 'buyer_advance' && b.partyName) {
                const op = await CoreServices.getPartyBalanceOp('buyer', b.partyName, (b.amount || 0));
                if (op) ops.push(op);
            }
        }

        try {
            await Utils.validateStockHistory(ops);
            await Utils.validateAdvanceHistory(ops);
            await DB.commitUnitOfWork(ops, snapshot);
        } catch (error) { Utils.showToast(error.message, 'error'); return; }
        if (typeof CoreServices !== 'undefined') await CoreServices.runMaterializedViewMigrations();
        Utils.showToast('Opening balance deleted!');
        this.render();
    }
};

const StockAdjustments = {
    async syncAll() {
        await this.render();
        if (typeof InventoryLots !== 'undefined' && typeof InventoryLots.render === 'function') {
            await InventoryLots.render();
        }
        if (typeof App !== 'undefined' && typeof App.loadDashboard === 'function') {
            await App.loadDashboard();
        }
        if (typeof CropAnalysis !== 'undefined' && typeof CropAnalysis.render === 'function') {
            await CropAnalysis.render();
        }
        if (typeof Selling !== 'undefined' && typeof Selling.populateCropSelect === 'function') {
            await Selling.populateCropSelect();
        }
        if (typeof Bookkeeping !== 'undefined' && typeof Bookkeeping.render === 'function') {
            await Bookkeeping.render();
        }
    },

    async render() {
        const activeSeason = await Utils.getActiveSeason();
        const purchases = Utils.filterBySeason(await DB.getAll('purchases'), activeSeason);
        const sales = Utils.filterBySeason(await DB.getAll('sales'), activeSeason);
        const adjustments = Utils.filterBySeason(await DB.getAll('stock_adjustments'), activeSeason);

        const adjustedStock = Utils.applyStockAdjustments(purchases, sales, adjustments);
        const adjPurchases = adjustedStock.purchases;
        const adjSales = adjustedStock.sales;

        // Collect all unique crops with case-insensitive grouping
        const cropMap = {};
        const getCropName = (rawName) => {
            if (!rawName) return null;
            const trimmed = rawName.trim();
            const lower = trimmed.toLowerCase();
            const existing = Object.keys(cropMap).find(k => k.toLowerCase() === lower);
            if (!existing) cropMap[trimmed] = trimmed;
            return existing || trimmed;
        };

        [...purchases, ...sales, ...adjustments].forEach(x => {
            if (x.crop) getCropName(x.crop);
        });
        const crops = Object.values(cropMap).sort();

        // Render live stock summary cards
        const summaryContainer = document.getElementById('stock-adj-live-summary');
        if (summaryContainer) {
            if (crops.length === 0) {
                summaryContainer.innerHTML = `<div class="crop-empty-state" style="grid-column:1/-1;padding:16px"><p style="margin:0;color:var(--text-muted)">No active inventory recorded yet. Add purchases or stock adjustments to view current stock.</p></div>`;
            } else {
                summaryContainer.innerHTML = crops.map(crop => {
                    const cropLower = crop.toLowerCase();
                    const cPurchases = adjPurchases.filter(p => p.crop && p.crop.trim().toLowerCase() === cropLower);
                    const cSales = adjSales.filter(s => s.crop && s.crop.trim().toLowerCase() === cropLower);
                    const cAdjs = adjustments.filter(a => a.crop && a.crop.trim().toLowerCase() === cropLower);

                    const stockInWeight = cPurchases.reduce((s, p) => s + (p.netWeight || 0), 0);
                    const stockOutWeight = cSales.reduce((s, s1) => s + (s1.netWeight || 0), 0);
                    const netStock = stockInWeight - stockOutWeight;
                    const purchasedWeight = cPurchases.filter(p => p.type !== 'stock_adjustment' && p.type !== 'opening_stock').reduce((s, p) => s + (p.netWeight || 0), 0);
                    const soldWeight = cSales.filter(s => s.type !== 'stock_adjustment').reduce((s, sale) => s + (sale.netWeight || 0), 0);
                    const netBags = netStock / 100;
                    const netMaunds = netStock / 40;

                    const totalDec = cAdjs.filter(a => a.direction === 'decrease').reduce((s, a) => s + (a.weight || 0), 0);
                    const totalInc = cAdjs.filter(a => a.direction === 'increase').reduce((s, a) => s + (a.weight || 0), 0);
                    const openingWeight = cAdjs.filter(a => a.direction === 'opening').reduce((s, a) => s + (a.weight || 0), 0);

                    return `
                        <div class="stat-card ${netStock > 0 ? 'green' : 'orange'}">
                            <div class="stat-label" style="display:flex;justify-content:space-between;align-items:center;">
                                <span class="font-bold" style="font-size:1.1rem;color:var(--text-primary);">${Utils.escapeHTML(crop)}</span>
                                <span class="badge ${netStock > 0 ? 'badge-success' : 'badge-warning'}">${Utils.formatNum(netStock, 2)} KG</span>
                            </div>
                            <div class="stat-value" style="font-size:1.3rem;margin:8px 0;">
                                ${Utils.formatNum(netMaunds, 2)} Maunds <span style="font-size:0.85rem;color:var(--text-muted);font-weight:normal;">(~${Utils.formatNum(netBags, 1)} Bags)</span>
                            </div>
                            <div class="stat-sub" style="display:flex;gap:12px;font-size:0.75rem;border-top:1px solid var(--border-color);padding-top:6px;margin-top:6px;">
                                <span>Purchased: ${Utils.formatNum(purchasedWeight, 0)} KG</span>
                                <span>Sold: ${Utils.formatNum(soldWeight, 0)} KG</span>
                                ${openingWeight > 0 ? `<span>Opening: ${Utils.formatNum(openingWeight, 0)} KG</span>` : ''}
                                ${totalDec > 0 ? `<span style="color:var(--accent-danger)">Loss/Shortage: -${Utils.formatNum(totalDec, 0)} KG</span>` : ''}
                                ${totalInc > 0 ? `<span style="color:var(--accent-success)">Surplus: +${Utils.formatNum(totalInc, 0)} KG</span>` : ''}
                            </div>
                        </div>
                    `;
                }).join('');
            }
        }

        // Render history table
        const rows = adjustments.sort((a, b) => new Date(b.date) - new Date(a.date));
        document.getElementById('stock-adj-tbody').innerHTML = rows.map(a => `<tr>
            <td>${Utils.formatDate(a.date)}</td>
            <td class="font-bold">${Utils.escapeHTML(a.crop)}</td>
            <td><span class="badge ${a.direction === 'decrease' ? 'badge-danger' : 'badge-success'}">${Utils.escapeHTML(a.direction.toUpperCase())}</span></td>
            <td>${Utils.escapeHTML(a.reason || '-')}</td>
            <td class="text-right font-bold">${Utils.formatNum(a.weight, 2)} KG</td>
            <td class="text-right">PKR ${Utils.formatPKR(a.value || 0)}</td>
            <td><button class="btn btn-icon btn-danger btn-sm" onclick="StockAdjustments.delete('${a.id}')" title="Delete">×</button></td>
        </tr>`).join('') || '<tr><td colspan="7" class="text-center" style="color:var(--text-muted)">No stock adjustments recorded</td></tr>';
    },

    async showModal() {
        document.getElementById('sa-date').value = Utils.todayISO();
        
        // Populate crop select from purchases and sales
        const purchases = await DB.getAll('purchases');
        const sales = await DB.getAll('sales');
        const adjs = await DB.getAll('stock_adjustments');
        const crops = [...new Set([...purchases.map(p => p.crop), ...sales.map(s => s.crop), ...adjs.map(a => a.crop)].filter(Boolean))].sort();

        const saCropSelect = document.getElementById('sa-crop');
        saCropSelect.innerHTML = `<option value="">Select Crop</option>` + crops.map(c => `<option value="${Utils.escapeHTML(c)}">${Utils.escapeHTML(c)}</option>`).join('');

        document.getElementById('sa-direction').value = 'decrease';
        document.getElementById('sa-reason').value = 'Shortage';
        document.getElementById('sa-weight').value = '';
        document.getElementById('sa-value').value = '0';
        document.getElementById('sa-notes').value = '';
        
        await this.updateStockBadge();
        Utils.showModal('stock-adjustment-modal');
    },

    async updateStockBadge() {
        const crop = document.getElementById('sa-crop').value;
        const direction = document.getElementById('sa-direction').value;
        const badge = document.getElementById('sa-stock-info-badge');
        if (!badge) return;

        if (!crop) {
            badge.style.display = 'none';
            badge.innerHTML = '';
            return;
        }

        const activeSeason = await Utils.getActiveSeason();
        const purchases = Utils.filterBySeason(await DB.getAll('purchases'), activeSeason);
        const sales = Utils.filterBySeason(await DB.getAll('sales'), activeSeason);
        const adjustments = Utils.filterBySeason(await DB.getAll('stock_adjustments'), activeSeason);

        const adjustedStock = Utils.applyStockAdjustments(purchases, sales, adjustments);
        const cropLower = crop.trim().toLowerCase();
        const cPurchases = adjustedStock.purchases.filter(p => p.crop && p.crop.trim().toLowerCase() === cropLower);
        const cSales = adjustedStock.sales.filter(s => s.crop && s.crop.trim().toLowerCase() === cropLower);

        const pWeight = cPurchases.reduce((s, p) => s + (p.netWeight || 0), 0);
        const sWeight = cSales.reduce((s, s1) => s + (s1.netWeight || 0), 0);
        const availableKg = pWeight - sWeight;
        const availableMn = availableKg / 40;
        const availableBags = availableKg / 100;

        let guideText = '';
        if (direction === 'decrease') {
            guideText = `Decreasing stock records shortage, moisture loss, or damage (inventory loss).`;
        } else if (direction === 'increase') {
            guideText = `Increasing stock adds surplus or found inventory to stock.`;
        } else {
            guideText = `Opening stock initializes baseline inventory for this crop.`;
        }

        badge.style.display = 'block';
        badge.innerHTML = `
            <div class="summary-box" style="padding:10px;background:var(--bg-card);border:1px solid var(--border-color);border-radius:6px;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
                    <span style="font-weight:bold;color:var(--accent-primary);">Current Available Stock:</span>
                    <span class="badge ${availableKg > 0 ? 'badge-success' : 'badge-warning'}">
                        ${Utils.formatNum(availableKg, 2)} KG (${Utils.formatNum(availableMn, 2)} Mn | ~${Utils.formatNum(availableBags, 1)} Bags)
                    </span>
                </div>
                <div style="font-size:0.8rem;color:var(--text-muted);">${guideText}</div>
            </div>
        `;
    },

    async save() {
        const snapshot = await DB.financialSnapshot();
        const data = {
            id: Utils.generateId(),
            date: document.getElementById('sa-date').value,
            crop: document.getElementById('sa-crop').value,
            direction: document.getElementById('sa-direction').value,
            reason: document.getElementById('sa-reason').value,
            weight: Utils.pf(document.getElementById('sa-weight').value),
            value: Utils.pf(document.getElementById('sa-value').value),
            notes: document.getElementById('sa-notes').value.trim(),
            createdAt: new Date().toISOString()
        };
        if (!data.crop) { Utils.showToast('Crop is required', 'error'); return; }
        if (data.weight <= 0) { Utils.showToast('Adjustment weight is required', 'error'); return; }

        const ops = [];
        ops.push({ storeName: 'stock_adjustments', action: 'put', data });
        if (data.direction === 'opening') ops.push({ storeName: 'opening_balances', action: 'put', data: {
            id: data.id, type: 'stock', date: data.date, crop: data.crop, weight: data.weight, amount: data.value,
            notes: data.notes || data.reason || 'Opening stock', createdAt: data.createdAt
        } });
        ops.push({
            storeName: 'audit_logs', action: 'put', data: {
                id: Utils.generateId(), date: Utils.todayISO(), action: 'create',
                entityType: 'stock_adjustment', entityId: data.id, 
                details: { crop: data.crop, direction: data.direction, weight: data.weight, newAmount: data.value },
                createdAt: new Date().toISOString()
            }
        });

        if (typeof CoreServices !== 'undefined' && data.crop) {
            const delta = (data.direction === 'in' || data.direction === 'increase' || data.direction === 'opening') ? data.weight : -data.weight;
            const op = await CoreServices.getStockOp(data.crop, delta);
            if (op) ops.push(op);
        }

        try {
            await Utils.validateStockHistory(ops);
            await Utils.validateAdvanceHistory(ops);
            await DB.commitUnitOfWork(ops, snapshot);
        } catch (error) { Utils.showToast(error.message, 'error'); return; }
        Utils.hideModal('stock-adjustment-modal');
        Utils.showToast('Stock adjustment saved!');
        await this.syncAll();
    },

    async delete(id) {
        const snapshot = await DB.financialSnapshot();
        const adj = await DB.get('stock_adjustments', id);
        if (!adj) return;
        const linkedOpening = await DB.get('opening_balances', id);
        if (!await Utils.confirm(`Delete this stock adjustment?${linkedOpening ? ' The linked opening balance will also be removed.' : ''}`)) return;
        const ops = [];
        ops.push({ storeName: 'stock_adjustments', action: 'delete', key: id, softDelete: true, data: adj });
        if (linkedOpening) ops.push({ storeName: 'opening_balances', action: 'delete', key: id, softDelete: true, data: linkedOpening });
        
        if (typeof CoreServices !== 'undefined' && adj.crop) {
            const delta = (adj.direction === 'in' || adj.direction === 'increase' || adj.direction === 'opening') ? -adj.weight : adj.weight;
            const op = await CoreServices.getStockOp(adj.crop, delta);
            if (op) ops.push(op);
        }
        
        try {
            await Utils.validateStockHistory(ops);
            await Utils.validateAdvanceHistory(ops);
            await DB.commitUnitOfWork(ops, snapshot);
        } catch (error) { Utils.showToast(error.message, 'error'); return; }
        await Utils.audit('delete', 'stock_adjustment', id, { oldRecord: adj, oldAmount: adj.value || 0 });
        Utils.showToast('Stock adjustment deleted!');
        await this.syncAll();
    }
};

const InventoryLots = {
    async buildRows() {
        const activeSeason = await Utils.getActiveSeason();
        let purchases = Utils.filterBySeason(await DB.getAll('purchases'), activeSeason);
        let sales = Utils.filterBySeason(await DB.getAll('sales'), activeSeason);
        const expenses = Utils.filterBySeason(await DB.getAll('expenses'), activeSeason);
        const adjustments = Utils.filterBySeason(await DB.getAll('stock_adjustments'), activeSeason);
        const adjusted = Utils.applyStockAdjustments(purchases, sales, adjustments);
        purchases = adjusted.purchases;
        sales = adjusted.sales;
        const expenseByPurchase = {};
        expenses.forEach(e => { if (e.purchaseId) expenseByPurchase[e.purchaseId] = (expenseByPurchase[e.purchaseId] || 0) + (e.amount || 0); });
        const lots = purchases
            .filter(p => p.crop && (p.netWeight || 0) > 0)
            .sort((a, b) => new Date(a.date || a.createdAt || 0) - new Date(b.date || b.createdAt || 0))
            .map(p => {
                const cost = Utils.purchaseCostAmount(p) + (expenseByPurchase[p.id] || 0);
                return {
                    id: p.id,
                    date: p.date,
                    crop: p.crop,
                    source: p.type || 'purchase',
                    originalWeight: p.netWeight || 0,
                    remainingWeight: p.netWeight || 0,
                    cost,
                    costPerKg: cost / (p.netWeight || 1)
                };
            });
        sales
            .filter(s => s.crop && (s.netWeight || 0) > 0)
            .sort((a, b) => new Date(a.date || a.createdAt || 0) - new Date(b.date || b.createdAt || 0))
            .forEach(s => {
                let remaining = s.netWeight || 0;
                const sCropLower = s.crop.trim().toLowerCase();
                lots.filter(l => l.crop && l.crop.trim().toLowerCase() === sCropLower).forEach(lot => {
                    if (remaining <= 0 || lot.date > s.date) return;
                    const used = Math.min(lot.remainingWeight, remaining);
                    lot.remainingWeight -= used;
                    remaining -= used;
                });
            });
        return lots.map(l => ({
            ...l,
            soldWeight: l.originalWeight - l.remainingWeight,
            remainingValue: l.remainingWeight * l.costPerKg
        }));
    },

    async render() {
        const lots = await this.buildRows();
        const totalWeight = lots.reduce((s, l) => s + l.remainingWeight, 0);
        const totalValue = lots.reduce((s, l) => s + l.remainingValue, 0);
        document.getElementById('inventory-lot-stats').innerHTML = `
            <div class="stat-card blue"><div class="stat-label">Open Lots</div><div class="stat-value">${lots.filter(l => l.remainingWeight > 0).length}</div></div>
            <div class="stat-card green"><div class="stat-label">Remaining Stock</div><div class="stat-value">${Utils.formatNum(totalWeight, 2)} KG</div></div>
            <div class="stat-card orange"><div class="stat-label">Inventory Value</div><div class="stat-value">PKR ${Utils.formatPKR(totalValue)}</div></div>`;
        document.getElementById('inventory-lots-tbody').innerHTML = lots.map(l => `<tr>
            <td class="font-bold">${Utils.escapeHTML(l.id)}</td>
            <td>${Utils.formatDate(l.date)}</td>
            <td>${Utils.escapeHTML(l.crop)}</td>
            <td>${Utils.escapeHTML(l.source)}</td>
            <td class="text-right">${Utils.formatNum(l.originalWeight, 2)}</td>
            <td class="text-right">${Utils.formatNum(l.soldWeight, 2)}</td>
            <td class="text-right font-bold">${Utils.formatNum(l.remainingWeight, 2)}</td>
            <td class="text-right">PKR ${Utils.formatPKR(l.costPerKg * 40)}</td>
            <td class="text-right font-bold">PKR ${Utils.formatPKR(l.remainingValue)}</td>
        </tr>`).join('') || '<tr><td colspan="9" class="text-center" style="color:var(--text-muted)">No inventory lots</td></tr>';
    },

    async exportExcel() {
        if (!Utils.requireExcel()) return;
        const lots = await this.buildRows();
        if (!lots.length) { Utils.showToast('No inventory lots to export', 'warning'); return; }
        const rows = lots.map(l => ({
            'Lot ID': l.id, Date: l.date, Crop: l.crop, Source: l.source,
            'Original KG': l.originalWeight, 'Sold KG': l.soldWeight, 'Remaining KG': l.remainingWeight,
            'Cost/Mn': l.costPerKg * 40, 'Remaining Value': l.remainingValue
        }));
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Inventory Lots');
        XLSX.writeFile(wb, `Inventory_Lots_${Utils.todayISO()}.xlsx`);
    }
};

const AgingReports = {
    bucket(days) {
        if (days <= 7) return '0-7 days';
        if (days <= 15) return '8-15 days';
        if (days <= 30) return '16-30 days';
        if (days <= 60) return '31-60 days';
        return '60+ days';
    },

    async buildRows() {
        const activeSeason = await Utils.getActiveSeason();
        const asOfDate = Utils.todayISO();
        const today = new Date(asOfDate);
        const purchases = Utils.filterBySeason(await DB.getAll('purchases'), activeSeason).filter(p => p.date <= asOfDate);
        const sales = Utils.filterBySeason(await DB.getAll('sales'), activeSeason).filter(s => s.date <= asOfDate);
        const purchasePayments = await DB.getAll('purchase_payments');
        const salePayments = await DB.getAll('sale_payments');
        const openingPayments = await DB.getAll('opening_balance_payments');
        const openings = Utils.filterBySeason(await DB.getAll('opening_balances'), activeSeason).filter(o => o.date <= asOfDate);
        const openingSettledAsOf = opening => {
            const linked = openingPayments.filter(p => p.openingBalanceId === opening.id);
            const allSettled = linked.reduce((sum, p) => sum + (p.amount || 0), 0);
            const recorded = Utils.openingBalanceSettled(opening);
            const initial = Math.max(0, recorded - allSettled);
            return initial + linked.filter(p => !p.date || p.date <= asOfDate).reduce((sum, p) => sum + (p.amount || 0), 0);
        };
        const farmerRows = purchases.map(p => {
            const balance = (p.netPayableAmount ?? p.amount ?? 0) - Utils.paymentTotalFor(p, purchasePayments, 'purchaseId', 'amountPaid', asOfDate);
            return { party: p.farmerName, source: p.id, date: p.dueDate || p.date, balance, type: 'farmer' };
        }).concat(openings.filter(o => o.type === 'farmer_payable').map(o => ({ party: o.partyName, source: 'Opening Balance', date: o.date, balance: Math.max(0, (o.amount || 0) - openingSettledAsOf(o)), type: 'farmer' })))
            .filter(r => r.balance > 0);
        const buyerRows = sales.map(s => {
            const balance = (s.amount || 0) - Utils.paymentTotalFor(s, salePayments, 'saleId', 'amountReceived', asOfDate);
            return { party: s.buyerName, source: s.id, date: s.dueDate || s.date, balance, type: 'buyer' };
        }).concat(openings.filter(o => o.type === 'buyer_receivable').map(o => ({ party: o.partyName, source: 'Opening Balance', date: o.date, balance: Math.max(0, (o.amount || 0) - openingSettledAsOf(o)), type: 'buyer' })))
            .filter(r => r.balance > 0);
        const decorate = r => {
            const days = Math.max(0, Math.floor((today - new Date(r.date)) / (24 * 60 * 60 * 1000)));
            return { ...r, days, bucket: this.bucket(days) };
        };
        return { farmerRows: farmerRows.map(decorate), buyerRows: buyerRows.map(decorate) };
    },

    async render() {
        const { farmerRows, buyerRows } = await this.buildRows();
        const buyerTotal = buyerRows.reduce((s, r) => s + r.balance, 0);
        const farmerTotal = farmerRows.reduce((s, r) => s + r.balance, 0);
        document.getElementById('aging-stats').innerHTML = `
            <div class="stat-card purple"><div class="stat-label">Buyer Receivables</div><div class="stat-value">PKR ${Utils.formatPKR(buyerTotal)}</div><div class="stat-sub">${buyerRows.length} open item(s)</div></div>
            <div class="stat-card orange"><div class="stat-label">Farmer Payables</div><div class="stat-value">PKR ${Utils.formatPKR(farmerTotal)}</div><div class="stat-sub">${farmerRows.length} open item(s)</div></div>`;
        document.getElementById('buyer-aging-tbody').innerHTML = this.renderRows(buyerRows);
        document.getElementById('farmer-aging-tbody').innerHTML = this.renderRows(farmerRows);
    },

    renderRows(rows) {
        return rows.sort((a, b) => b.days - a.days).map(r => `<tr>
            <td class="font-bold">${Utils.escapeHTML(r.party)}</td>
            <td>${Utils.escapeHTML(r.source)}</td>
            <td>${Utils.formatDate(r.date)}</td>
            <td class="text-right font-bold">PKR ${Utils.formatPKR(r.balance)}</td>
            <td class="text-right">${r.days}</td>
            <td><span class="badge ${r.days > 30 ? 'badge-danger' : 'badge-warning'}">${r.bucket}</span></td>
        </tr>`).join('') || '<tr><td colspan="6" class="text-center" style="color:var(--text-muted)">No outstanding balances</td></tr>';
    },

    async exportExcel() {
        if (!Utils.requireExcel()) return;
        const { farmerRows, buyerRows } = await this.buildRows();
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(buyerRows), 'Buyer Aging');
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(farmerRows), 'Farmer Aging');
        XLSX.writeFile(wb, `Aging_Report_${Utils.todayISO()}.xlsx`);
    }
};

const FinanceReports = {
    async initDateInputs(prefix) {
        const from = document.getElementById(`${prefix}-from`);
        const to = document.getElementById(`${prefix}-to`);
        if (from && !from.value) from.value = Utils.dateToISO(new Date(new Date().getFullYear(), 0, 1));
        if (to && !to.value) to.value = Utils.todayISO();
    },

    inRange(rows, from, to) {
        return rows.filter(r => (!from || r.date >= from) && (!to || r.date <= to));
    },

    async populateCashAccountSelect(selectId) {
        const sel = document.getElementById(selectId);
        if (!sel) return;
        const accounts = await DB.getAll('capital_accounts');
        const current = sel.value;
        sel.innerHTML = '<option value="">All Accounts</option>' + accounts.map(a => `<option value="${Utils.escapeHTML(a.id)}">${Utils.escapeHTML(a.name)}</option>`).join('');
        if (current) sel.value = current;
    },

    async renderCashBook() {
        await this.initDateInputs('cb');
        await this.populateCashAccountSelect('cb-account');
        const accountId = document.getElementById('cb-account').value;
        const from = document.getElementById('cb-from').value;
        const to = document.getElementById('cb-to').value;
        const accounts = await DB.getAll('capital_accounts');
        const selectedAccounts = accounts.filter(a => !accountId || a.id === accountId);
        const transactions = [...await DB.getAll('capital_transactions'), ...await Utils.journalCashTransactions()].filter(t => !accountId || t.accountId === accountId);
        const accountMap = Object.fromEntries(accounts.map(a => [a.id, a]));
        const openingDate = account => account.createdAt ? String(account.createdAt).slice(0, 10) : '';
        const eligibleAccounts = selectedAccounts.filter(a => !to || !openingDate(a) || openingDate(a) <= to);
        const opening = eligibleAccounts.filter(a => !from || !openingDate(a) || openingDate(a) <= from).reduce((s, a) => s + (a.openingBalance || 0), 0);
        const openingEvents = from ? eligibleAccounts.filter(a => openingDate(a) > from && (!to || openingDate(a) <= to) && (a.openingBalance || 0) !== 0)
            .map(a => ({ id: `opening-${a.id}`, accountId: a.id, date: openingDate(a), type: a.openingBalance > 0 ? 'deposit' : 'withdrawal', amount: Math.abs(a.openingBalance),
                description: `Opening balance: ${a.name}`, isReconciled: true, openingEvent: true })) : [];
        const sorted = [...transactions, ...openingEvents].sort((a, b) => a.date.localeCompare(b.date)
            || Number(Boolean(b.openingEvent)) - Number(Boolean(a.openingEvent)));
        let running = opening;
        sorted.filter(t => from && t.date < from).forEach(t => {
            if (t.type === 'deposit') running += t.amount || 0;
            else running -= t.amount || 0;
        });
        const allRows = [{
            date: '',
            account: accountId ? accountMap[accountId]?.name || '' : 'All Accounts',
            description: from ? 'Balance Brought Forward' : 'Opening Balance',
            deposit: 0,
            withdrawal: 0,
            balance: running,
            recon: ''
        }];
        sorted.filter(t => (!from || t.date >= from) && (!to || t.date <= to)).forEach(t => {
            if (t.type === 'deposit') running += t.amount || 0;
            else running -= t.amount || 0;
            allRows.push({
                id: t.id,
                date: t.date,
                account: accountMap[t.accountId]?.name || 'Unallocated journal cash',
                description: t.description || '-',
                deposit: t.type === 'deposit' ? t.amount || 0 : 0,
                withdrawal: t.type === 'withdrawal' ? t.amount || 0 : 0,
                balance: running,
                isReconciled: t.isReconciled,
                recon: t.isReconciled ? 'Reconciled' : 'Pending'
            });
        });
        const rows = allRows;
        const deposits = rows.filter(r => r.date).reduce((s, r) => s + (r.deposit || 0), 0);
        const withdrawals = rows.filter(r => r.date).reduce((s, r) => s + (r.withdrawal || 0), 0);
        const closing = running;
        document.getElementById('cash-book-stats').innerHTML = `
            <div class="stat-card green"><div class="stat-label">Deposits</div><div class="stat-value">PKR ${Utils.formatPKR(deposits)}</div></div>
            <div class="stat-card orange"><div class="stat-label">Withdrawals</div><div class="stat-value">PKR ${Utils.formatPKR(withdrawals)}</div></div>
            <div class="stat-card blue"><div class="stat-label">Closing Balance</div><div class="stat-value">PKR ${Utils.formatPKR(closing)}</div></div>`;
        document.getElementById('cash-book-tbody').innerHTML = rows.map(r => `<tr>
            <td>${r.date ? Utils.formatDate(r.date) : '-'}</td>
            <td>${Utils.escapeHTML(r.account)}</td>
            <td>${Utils.escapeHTML(r.description)}</td>
            <td class="text-right">${r.deposit ? 'PKR ' + Utils.formatPKR(r.deposit) : ''}</td>
            <td class="text-right">${r.withdrawal ? 'PKR ' + Utils.formatPKR(r.withdrawal) : ''}</td>
            <td class="text-right font-bold">PKR ${Utils.formatPKR(r.balance)}</td>
            <td>${r.id ? `<button class="btn btn-sm ${r.isReconciled ? 'btn-success' : 'btn-ghost'}" onclick="BankAccounts.toggleReconciled('${r.id}', ${!r.isReconciled}).then(()=>FinanceReports.renderCashBook())">${r.isReconciled ? '✅ Reconciled' : '⏳ Pending'}</button>` : '-'}</td>
        </tr>`).join('') || '<tr><td colspan="7" class="text-center" style="color:var(--text-muted)">No cash book rows</td></tr>';
        this.cashBookRows = rows;
    },

    async renderTrialBalance() {
        await this.initDateInputs('tb');
        const from = document.getElementById('tb-from').value;
        const to = document.getElementById('tb-to').value;
        const entries = await Bookkeeping.generateEntries(from, to);
        const map = {};
        entries.forEach(e => {
            if (!map[e.account]) map[e.account] = { account: e.account, debit: 0, credit: 0 };
            map[e.account].debit += e.debit || 0;
            map[e.account].credit += e.credit || 0;
        });
        const rows = Object.values(map).sort((a, b) => a.account.localeCompare(b.account));
        const totalDebit = rows.reduce((s, r) => s + r.debit, 0);
        const totalCredit = rows.reduce((s, r) => s + r.credit, 0);
        const diff = Math.abs(totalDebit - totalCredit);
        document.getElementById('trial-balance-stats').innerHTML = `
            <div class="stat-card green"><div class="stat-label">Total Debit</div><div class="stat-value">PKR ${Utils.formatPKR(totalDebit)}</div></div>
            <div class="stat-card blue"><div class="stat-label">Total Credit</div><div class="stat-value">PKR ${Utils.formatPKR(totalCredit)}</div></div>
            <div class="stat-card ${diff < 0.01 ? 'green' : 'orange'}"><div class="stat-label">Difference</div><div class="stat-value">PKR ${Utils.formatPKR(diff)}</div></div>`;
        document.getElementById('trial-balance-tbody').innerHTML = rows.map(r => {
            const net = r.debit - r.credit;
            return `<tr>
                <td class="font-bold">${Utils.escapeHTML(r.account)}</td>
                <td class="text-right">PKR ${Utils.formatPKR(r.debit)}</td>
                <td class="text-right">PKR ${Utils.formatPKR(r.credit)}</td>
                <td class="text-right">${net > 0 ? 'PKR ' + Utils.formatPKR(net) : ''}</td>
                <td class="text-right">${net < 0 ? 'PKR ' + Utils.formatPKR(Math.abs(net)) : ''}</td>
            </tr>`;
        }).join('') || '<tr><td colspan="5" class="text-center" style="color:var(--text-muted)">No journal entries</td></tr>';
        this.trialBalanceRows = rows;
    },

    async populateGLAccounts(entries) {
        const sel = document.getElementById('gl-account');
        if (!sel) return;
        const current = sel.value;
        const accounts = [...new Set(entries.map(e => e.account))].sort();
        sel.innerHTML = accounts.map(a => `<option value="${Utils.escapeHTML(a)}">${Utils.escapeHTML(a)}</option>`).join('');
        if (current && accounts.includes(current)) sel.value = current;
    },

    async renderGeneralLedger() {
        await this.initDateInputs('gl');
        const from = document.getElementById('gl-from').value;
        const to = document.getElementById('gl-to').value;
        const entries = await Bookkeeping.generateEntries('', to);
        await this.populateGLAccounts(entries);
        const account = document.getElementById('gl-account').value || entries[0]?.account || '';
        const accountEntries = entries.filter(e => e.account === account).sort((a, b) => new Date(a.date) - new Date(b.date));
        let balance = accountEntries
            .filter(e => from && e.date < from)
            .reduce((s, e) => s + (e.debit || 0) - (e.credit || 0), 0);
        const periodRows = accountEntries.filter(e => (!from || e.date >= from) && (!to || e.date <= to));
        const rows = [{
            date: '',
            description: from ? 'Balance Brought Forward' : 'Opening Balance',
            debit: 0,
            credit: 0,
            balance
        }].concat(periodRows.map(e => {
            balance += (e.debit || 0) - (e.credit || 0);
            return { ...e, balance };
        }));
        const debit = rows.filter(r => r.date).reduce((s, r) => s + (r.debit || 0), 0);
        const credit = rows.filter(r => r.date).reduce((s, r) => s + (r.credit || 0), 0);
        document.getElementById('general-ledger-stats').innerHTML = `
            <div class="stat-card green"><div class="stat-label">Debit</div><div class="stat-value">PKR ${Utils.formatPKR(debit)}</div></div>
            <div class="stat-card blue"><div class="stat-label">Credit</div><div class="stat-value">PKR ${Utils.formatPKR(credit)}</div></div>
            <div class="stat-card orange"><div class="stat-label">Net Balance</div><div class="stat-value">PKR ${Utils.formatPKR(balance)}</div></div>`;
        document.getElementById('general-ledger-tbody').innerHTML = rows.map(r => `<tr>
            <td>${r.date ? Utils.formatDate(r.date) : '-'}</td>
            <td>${Utils.escapeHTML(r.description)}</td>
            <td class="text-right">${r.debit ? 'PKR ' + Utils.formatPKR(r.debit) : ''}</td>
            <td class="text-right">${r.credit ? 'PKR ' + Utils.formatPKR(r.credit) : ''}</td>
            <td class="text-right font-bold">PKR ${Utils.formatPKR(r.balance)}</td>
        </tr>`).join('') || '<tr><td colspan="5" class="text-center" style="color:var(--text-muted)">No entries for this account</td></tr>';
        this.generalLedgerRows = rows;
    },

    exportRows(rows, sheetName, filename) {
        if (!Utils.requireExcel()) return;
        if (!rows || !rows.length) { Utils.showToast('No rows to export', 'warning'); return; }
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), sheetName);
        XLSX.writeFile(wb, filename);
    },

    async exportCashBook() { await this.renderCashBook(); this.exportRows(this.cashBookRows, 'Cash Book', `Cash_Book_${Utils.todayISO()}.xlsx`); },
    async exportTrialBalance() { await this.renderTrialBalance(); this.exportRows(this.trialBalanceRows, 'Period Journal Summary', `Period_Journal_Summary_${Utils.todayISO()}.xlsx`); },
    async exportGeneralLedger() { await this.renderGeneralLedger(); this.exportRows(this.generalLedgerRows, 'General Ledger', `General_Ledger_${Utils.todayISO()}.xlsx`); }
};
