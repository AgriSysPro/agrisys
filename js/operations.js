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

        await DB.put('opening_balances', data);
        if (type === 'farmer_payable' || type === 'farmer_advance') await Farmers.ensureFarmer(data.partyName);
        if (type === 'buyer_receivable' || type === 'buyer_advance') await Buyers.ensureBuyer(data.partyName);

        if (type === 'capital') {
            const tx = await Utils.createLinkedCapitalTx({
                accountId: data.accountId,
                type: 'deposit',
                amount,
                date: data.date,
                description: 'Opening balance',
                sourceStore: 'opening_balances',
                sourceId: data.id
            });
            if (tx) { data.capitalTxId = tx.id; await DB.put('opening_balances', data); }
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
            await DB.put('stock_adjustments', adj);
        }
        await Utils.audit('create', 'opening_balance', data.id, { type, newAmount: amount, partyName: data.partyName, crop: data.crop });
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
            if (payAmt > balance) { Utils.showToast('Payment cannot exceed opening balance', 'error'); return; }
            if (!document.getElementById('pay-account').value) { Utils.showToast('Select cash/bank account for this settlement', 'error'); return; }
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
                previousBalance: balance,
                newBalance: balance - payAmt,
                createdAt: new Date().toISOString()
            };
            await DB.put('opening_balance_payments', payment);
            await Utils.confirmReceiptId('payment', receiptNo);
            const tx = await Utils.createLinkedCapitalTx({
                accountId: payment.accountId,
                type: isFarmer ? 'withdrawal' : 'deposit',
                amount: payAmt,
                date: payment.date,
                description: isFarmer
                    ? `Payment to farmer ${b.partyName} against opening balance`
                    : `Receipt from buyer ${b.partyName} against opening balance`,
                sourceStore: 'opening_balance_payments',
                sourceId: payment.id
            });
            if (tx) {
                payment.capitalTxId = tx.id;
                await DB.put('opening_balance_payments', payment);
            }

            const newSettled = this.settledAmount(b) + payAmt;
            b.settledAmount = newSettled;
            if (isFarmer) b.paidAmount = newSettled;
            else b.receivedAmount = newSettled;
            b.balance = Math.max(0, (b.amount || 0) - newSettled);
            b.settlementStatus = b.balance <= 0 ? 'paid' : 'partial';
            b.updatedAt = new Date().toISOString();
            await DB.put('opening_balances', b);
            await Utils.audit('create', 'opening_balance_payment', payment.id, {
                receiptNo,
                openingBalanceId: b.id,
                type: b.type,
                partyName: b.partyName,
                amount: payAmt,
                previousBalance: payment.previousBalance,
                newBalance: payment.newBalance,
                capitalTxId: payment.capitalTxId || null
            });
            Utils.hideModal('payment-modal');
            Utils.showToast(isFarmer ? 'Opening payment recorded!' : 'Opening receipt recorded!');
            if (printAfterSave) await ReceiptPDF.generatePaymentVoucher(payment, b, isFarmer ? 'farmer' : 'buyer');
            this.render();
        };
        document.getElementById('pay-save-btn').onclick = () => savePayment(false);
        document.getElementById('pay-save-print-btn').onclick = () => savePayment(true);
        Utils.showModal('payment-modal');
    },

    async delete(id) {
        const b = await DB.get('opening_balances', id);
        if (!b) return;
        const linkedPayments = (await DB.getAll('opening_balance_payments')).filter(p => p.openingBalanceId === id);
        const paymentText = linkedPayments.length ? ` ${linkedPayments.length} linked settlement payment(s) and their cash/bank entries will also be removed.` : '';
        if (!await Utils.confirm(`Delete this opening balance? Linked stock/capital entry will also be removed.${paymentText}`)) return;
        await Utils.deleteLinkedCapitalTx('opening_balances', id);
        for (const payment of linkedPayments) {
            await Utils.deleteLinkedCapitalTx('opening_balance_payments', payment.id);
            await DB.delete('opening_balance_payments', payment.id);
        }
        if (b.type === 'stock') await DB.delete('stock_adjustments', id);
        await DB.delete('opening_balances', id);
        await Utils.audit('delete', 'opening_balance', id, { oldAmount: b.amount || 0, oldRecord: b, linkedPayments: linkedPayments.length });
        Utils.showToast('Opening balance deleted!');
        this.render();
    }
};

const StockAdjustments = {
    async render() {
        const activeSeason = await Utils.getActiveSeason();
        const rows = Utils.filterBySeason(await DB.getAll('stock_adjustments'), activeSeason)
            .sort((a, b) => new Date(b.date) - new Date(a.date));
        document.getElementById('stock-adj-tbody').innerHTML = rows.map(a => `<tr>
            <td>${Utils.formatDate(a.date)}</td>
            <td class="font-bold">${Utils.escapeHTML(a.crop)}</td>
            <td><span class="badge ${a.direction === 'decrease' ? 'badge-danger' : 'badge-success'}">${Utils.escapeHTML(a.direction)}</span></td>
            <td>${Utils.escapeHTML(a.reason || '-')}</td>
            <td class="text-right">${Utils.formatNum(a.weight, 2)} KG</td>
            <td class="text-right">PKR ${Utils.formatPKR(a.value || 0)}</td>
            <td><button class="btn btn-icon btn-danger btn-sm" onclick="StockAdjustments.delete('${a.id}')" title="Delete">×</button></td>
        </tr>`).join('') || '<tr><td colspan="7" class="text-center" style="color:var(--text-muted)">No stock adjustments</td></tr>';
    },

    showModal() {
        document.getElementById('sa-date').value = Utils.todayISO();
        document.getElementById('sa-crop').innerHTML = document.getElementById('ob-crop').innerHTML || '<option value="">Select Crop</option>';
        if (document.getElementById('sa-crop').options.length <= 1) OpeningBalances.populateCropSelect();
        document.getElementById('sa-crop').innerHTML = document.getElementById('ob-crop').innerHTML;
        document.getElementById('sa-direction').value = 'decrease';
        document.getElementById('sa-reason').value = 'Shortage';
        document.getElementById('sa-weight').value = '';
        document.getElementById('sa-value').value = '0';
        document.getElementById('sa-notes').value = '';
        Utils.showModal('stock-adjustment-modal');
    },

    async save() {
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
        if (data.weight <= 0) { Utils.showToast('Weight is required', 'error'); return; }
        await DB.put('stock_adjustments', data);
        await Utils.audit('create', 'stock_adjustment', data.id, { crop: data.crop, direction: data.direction, weight: data.weight, newAmount: data.value });
        Utils.hideModal('stock-adjustment-modal');
        Utils.showToast('Stock adjustment saved!');
        this.render();
    },

    async delete(id) {
        const adj = await DB.get('stock_adjustments', id);
        if (!adj) return;
        const linkedOpening = await DB.get('opening_balances', id);
        if (!await Utils.confirm(`Delete this stock adjustment?${linkedOpening ? ' The linked opening balance will also be removed.' : ''}`)) return;
        await DB.delete('stock_adjustments', id);
        if (linkedOpening) await DB.delete('opening_balances', id);
        await Utils.audit('delete', 'stock_adjustment', id, { oldRecord: adj, oldAmount: adj.value || 0 });
        Utils.showToast('Stock adjustment deleted!');
        this.render();
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
                lots.filter(l => l.crop === s.crop).forEach(lot => {
                    if (remaining <= 0) return;
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
        const today = new Date(Utils.todayISO());
        const purchases = Utils.filterBySeason(await DB.getAll('purchases'), activeSeason);
        const sales = Utils.filterBySeason(await DB.getAll('sales'), activeSeason);
        const openings = Utils.filterBySeason(await DB.getAll('opening_balances'), activeSeason);
        const farmerRows = purchases.map(p => {
            const balance = (p.netPayableAmount || p.amount || 0) - (p.amountPaid || 0);
            return { party: p.farmerName, source: p.id, date: p.dueDate || p.date, balance, type: 'farmer' };
        }).concat(openings.filter(o => o.type === 'farmer_payable').map(o => ({ party: o.partyName, source: 'Opening Balance', date: o.date, balance: Math.max(0, (o.amount || 0) - (o.paidAmount || o.settledAmount || 0)), type: 'farmer' })))
            .filter(r => r.balance > 0);
        const buyerRows = sales.map(s => {
            const balance = (s.amount || 0) - (s.amountReceived || 0);
            return { party: s.buyerName, source: s.id, date: s.dueDate || s.date, balance, type: 'buyer' };
        }).concat(openings.filter(o => o.type === 'buyer_receivable').map(o => ({ party: o.partyName, source: 'Opening Balance', date: o.date, balance: Math.max(0, (o.amount || 0) - (o.receivedAmount || o.settledAmount || 0)), type: 'buyer' })))
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
        const txs = (await DB.getAll('capital_transactions')).filter(t => !accountId || t.accountId === accountId);
        const accountMap = Object.fromEntries(accounts.map(a => [a.id, a]));
        const opening = accounts
            .filter(a => !accountId || a.id === accountId)
            .reduce((s, a) => s + (a.openingBalance || 0), 0);
        const sorted = txs.sort((a, b) => new Date(a.date) - new Date(b.date));
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
                date: t.date,
                account: accountMap[t.accountId]?.name || 'Unknown',
                description: t.description || '-',
                deposit: t.type === 'deposit' ? t.amount || 0 : 0,
                withdrawal: t.type === 'withdrawal' ? t.amount || 0 : 0,
                balance: running,
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
            <td>${Utils.escapeHTML(r.recon)}</td>
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

    async exportCashBook() { if (!this.cashBookRows) await this.renderCashBook(); this.exportRows(this.cashBookRows, 'Cash Book', `Cash_Book_${Utils.todayISO()}.xlsx`); },
    async exportTrialBalance() { if (!this.trialBalanceRows) await this.renderTrialBalance(); this.exportRows(this.trialBalanceRows, 'Trial Balance', `Trial_Balance_${Utils.todayISO()}.xlsx`); },
    async exportGeneralLedger() { if (!this.generalLedgerRows) await this.renderGeneralLedger(); this.exportRows(this.generalLedgerRows, 'General Ledger', `General_Ledger_${Utils.todayISO()}.xlsx`); }
};
