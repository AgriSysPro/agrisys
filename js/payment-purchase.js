// ===== Purchase Payment Tracking =====
const PurchasePayments = {
    async render() {
        const activeSeason = await Utils.getActiveSeason();
        const purchases = Utils.filterBySeason(await DB.getAll('purchases'), activeSeason);
        const search = (document.getElementById('pp-search').value || '').toLowerCase();
        const filter = document.getElementById('pp-filter').value;

        let filtered = purchases.filter(p => {
            if (search && !p.farmerName.toLowerCase().includes(search) && !p.id.toLowerCase().includes(search)) return false;
            if (filter && p.paymentStatus !== filter) return false;
            return true;
        }).sort((a, b) => new Date(b.date) - new Date(a.date));

        const tbody = document.getElementById('pp-tbody');
        tbody.innerHTML = filtered.map(p => {
            const amt = p.netPayableAmount || p.amount || 0;
            const paid = p.amountPaid || 0;
            const balance = amt - paid;
            return `<tr>
                <td class="font-bold">${Utils.escapeHTML(p.id)}</td>
                <td>${Utils.formatDate(p.date)}</td>
                <td class="font-bold">${Utils.escapeHTML(p.farmerName)}</td>
                <td>${Utils.escapeHTML(p.crop)}</td>
                <td class="text-right">PKR ${Utils.formatPKR(amt)}</td>
                <td class="text-right">PKR ${Utils.formatPKR(paid)}</td>
                <td class="text-right font-bold" style="color:${balance > 0 ? 'var(--accent-danger)' : 'var(--accent-success)'}">PKR ${Utils.formatPKR(balance)}</td>
                <td>${Utils.statusBadge(p.paymentStatus)}</td>
                <td><button class="btn btn-sm btn-primary" onclick="PurchasePayments.recordPayment('${p.id}')" ${p.paymentStatus === 'paid' ? 'disabled' : ''}>Pay</button></td>
            </tr>`;
        }).join('') || '<tr><td colspan="9" class="text-center" style="color:var(--text-muted)">No records</td></tr>';
        await this.renderHistory();
    },

    async renderHistory() {
        const tbody = document.getElementById('pp-history-tbody');
        if (!tbody) return;
        const activeSeason = await Utils.getActiveSeason();
        const payments = Utils.filterBySeason(await DB.getAll('purchase_payments'), activeSeason)
            .sort((a, b) => new Date(b.date) - new Date(a.date));
        const accounts = await DB.getAll('capital_accounts');
        const accountMap = Object.fromEntries(accounts.map(a => [a.id, a.name]));
        tbody.innerHTML = payments.map(p => `<tr>
            <td class="font-bold">${Utils.escapeHTML(p.receiptNo || p.id)}</td>
            <td>${Utils.formatDate(p.date)}</td>
            <td>${Utils.escapeHTML(p.farmerName)}</td>
            <td>${Utils.escapeHTML(p.purchaseId)}</td>
            <td>${Utils.escapeHTML((p.mode || 'cash').toUpperCase())}</td>
            <td class="text-right font-bold">PKR ${Utils.formatPKR(p.amount || 0)}</td>
            <td>${Utils.escapeHTML(accountMap[p.accountId] || '-')}</td>
            <td><div class="table-actions">
                <button class="btn btn-icon btn-ghost btn-sm" onclick="PurchasePayments.editPayment('${p.id}')" title="Edit">✏️</button>
                <button class="btn btn-icon btn-ghost btn-sm" onclick="PurchasePayments.printPayment('${p.id}')" title="Print">📄</button>
                <button class="btn btn-icon btn-danger btn-sm" onclick="PurchasePayments.deletePayment('${p.id}')" title="Delete">×</button>
            </div></td>
        </tr>`).join('') || '<tr><td colspan="8" class="text-center" style="color:var(--text-muted)">No payment history</td></tr>';
    },

    async recordPayment(purchaseId) {
        const p = await DB.get('purchases', purchaseId);
        if (!p) return;
        const balance = (p.netPayableAmount || p.amount || 0) - (p.amountPaid || 0);
        document.getElementById('pay-modal-title').textContent = `Pay Farmer: ${p.farmerName} (${p.id})`;
        document.getElementById('pay-receipt-id').value = await Utils.getNextReceiptId('payment');
        document.getElementById('pay-amount').value = balance.toFixed(2);
        document.getElementById('pay-amount').max = balance;
        document.getElementById('pay-date').value = Utils.todayISO();
        document.getElementById('pay-ref').value = '';
        document.getElementById('pay-notes').value = '';
        await Utils.populateCapitalAccountSelect('pay-account', 'Select cash/bank account');

        const savePayment = async (printAfterSave = false) => {
            const btn1 = document.getElementById('pay-save-btn');
            const btn2 = document.getElementById('pay-save-print-btn');
            btn1.disabled = true; btn2.disabled = true;
            try {
                const currentP = await DB.get('purchases', purchaseId);
                if (!currentP) return;
                const currentBalance = (currentP.netPayableAmount || currentP.amount || 0) - (currentP.amountPaid || 0);

                const payAmt = Utils.pf(document.getElementById('pay-amount').value);
                if (payAmt <= 0) { Utils.showToast('Amount must be > 0', 'error'); return; }
                if (payAmt > currentBalance) { Utils.showToast('Payment cannot exceed remaining balance', 'error'); return; }
                if (!document.getElementById('pay-account').value) { Utils.showToast('Select cash/bank account for this payment', 'error'); return; }
                const receiptNo = document.getElementById('pay-receipt-id').value;
                const previousBalance = currentBalance;
                
                const payment = {
                    id: Utils.generateId(), receiptNo, purchaseId, farmerName: currentP.farmerName,
                    amount: payAmt, date: document.getElementById('pay-date').value,
                    mode: document.getElementById('pay-mode').value,
                    reference: document.getElementById('pay-ref').value.trim(),
                    notes: document.getElementById('pay-notes').value.trim(),
                    accountId: document.getElementById('pay-account').value,
                    previousBalance,
                    newBalance: previousBalance - payAmt,
                    createdAt: new Date().toISOString()
                };
                await DB.put('purchase_payments', payment);
                await Utils.confirmReceiptId('payment', receiptNo);
                const tx = await Utils.createLinkedCapitalTx({
                    accountId: payment.accountId,
                    type: 'withdrawal',
                    amount: payAmt,
                    date: payment.date,
                    description: `Payment to farmer ${currentP.farmerName} for purchase #${purchaseId}`,
                    sourceStore: 'purchase_payments',
                    sourceId: payment.id
                });
                if (tx) payment.capitalTxId = tx.id;
                if (tx) await DB.put('purchase_payments', payment);

                currentP.amountPaid = (currentP.amountPaid || 0) + payAmt;
                const total = currentP.netPayableAmount || currentP.amount || 0;
                currentP.balance = total - currentP.amountPaid;
                currentP.paymentStatus = currentP.amountPaid >= total ? 'paid' : 'partial';
                await DB.put('purchases', currentP);
                await Utils.audit('create', 'purchase_payment', payment.id, {
                    receiptNo,
                    purchaseId,
                    farmerName: currentP.farmerName,
                    amount: payAmt,
                    previousBalance,
                    newBalance: payment.newBalance,
                    capitalTxId: payment.capitalTxId || null
                });

                Utils.hideModal('payment-modal');
                Utils.showToast('Payment recorded!');
                if (printAfterSave) await ReceiptPDF.generatePaymentVoucher(payment, currentP, 'farmer');
                this.render();
            } finally {
                btn1.disabled = false; btn2.disabled = false;
            }
        };
        document.getElementById('pay-save-btn').onclick = () => savePayment(false);
        document.getElementById('pay-save-print-btn').onclick = () => savePayment(true);
        Utils.showModal('payment-modal');
    },

    async editPayment(paymentId) {
        const payment = await DB.get('purchase_payments', paymentId);
        if (!payment) return;
        const p = await DB.get('purchases', payment.purchaseId);
        if (!p) return;
        const total = p.netPayableAmount || p.amount || 0;
        const paidWithoutThis = (p.amountPaid || 0) - (payment.amount || 0);
        const maxAllowed = total - paidWithoutThis;
        document.getElementById('pay-modal-title').textContent = `Edit Farmer Payment: ${p.farmerName} (${p.id})`;
        document.getElementById('pay-receipt-id').value = payment.receiptNo || payment.id;
        document.getElementById('pay-amount').value = (payment.amount || 0).toFixed(2);
        document.getElementById('pay-amount').max = maxAllowed;
        document.getElementById('pay-date').value = payment.date || Utils.todayISO();
        document.getElementById('pay-mode').value = payment.mode || 'cash';
        document.getElementById('pay-ref').value = payment.reference || '';
        document.getElementById('pay-notes').value = payment.notes || '';
        await Utils.populateCapitalAccountSelect('pay-account', 'Select cash/bank account');
        document.getElementById('pay-account').value = payment.accountId || '';

        const saveEdit = async (printAfterSave = false) => {
            const btn1 = document.getElementById('pay-save-btn');
            const btn2 = document.getElementById('pay-save-print-btn');
            btn1.disabled = true; btn2.disabled = true;
            try {
                const currentP = await DB.get('purchases', payment.purchaseId);
                if (!currentP) return;
                const currentTotal = currentP.netPayableAmount || currentP.amount || 0;
                const currentPaidWithoutThis = (currentP.amountPaid || 0) - (payment.amount || 0);
                const currentMaxAllowed = currentTotal - currentPaidWithoutThis;

                const newAmount = Utils.pf(document.getElementById('pay-amount').value);
                if (newAmount <= 0) { Utils.showToast('Amount must be > 0', 'error'); return; }
                if (newAmount > currentMaxAllowed) { Utils.showToast('Payment cannot exceed remaining balance', 'error'); return; }
                if (!document.getElementById('pay-account').value) { Utils.showToast('Select cash/bank account for this payment', 'error'); return; }
                const oldPayment = { ...payment };
                await Utils.deleteLinkedCapitalTx('purchase_payments', payment.id);
                payment.amount = newAmount;
                payment.date = document.getElementById('pay-date').value;
                payment.mode = document.getElementById('pay-mode').value;
                payment.reference = document.getElementById('pay-ref').value.trim();
                payment.notes = document.getElementById('pay-notes').value.trim();
                payment.accountId = document.getElementById('pay-account').value;
                const previousBalance = currentTotal - currentPaidWithoutThis;
                payment.newBalance = previousBalance - newAmount;

                await DB.put('purchase_payments', payment);
                const tx = await Utils.createLinkedCapitalTx({
                    accountId: payment.accountId,
                    type: 'withdrawal',
                    amount: newAmount,
                    date: payment.date,
                    description: `Payment to farmer ${currentP.farmerName} for purchase #${currentP.id}`,
                    sourceStore: 'purchase_payments',
                    sourceId: payment.id
                });
                if (tx) payment.capitalTxId = tx.id;
                if (tx) await DB.put('purchase_payments', payment);

                currentP.amountPaid = currentPaidWithoutThis + newAmount;
                currentP.balance = currentTotal - currentP.amountPaid;
                currentP.paymentStatus = currentP.amountPaid >= currentTotal ? 'paid' : 'partial';
                await DB.put('purchases', currentP);
                await Utils.audit('update', 'purchase_payment', payment.id, {
                    oldPayment,
                    newPayment: payment
                });

                Utils.hideModal('payment-modal');
                Utils.showToast('Payment updated!');
                if (printAfterSave) await ReceiptPDF.generatePaymentVoucher(payment, currentP, 'farmer');
                this.render();
            } finally {
                btn1.disabled = false; btn2.disabled = false;
            }
        };
        document.getElementById('pay-save-btn').onclick = () => saveEdit(false);
        document.getElementById('pay-save-print-btn').onclick = () => saveEdit(true);
        Utils.showModal('payment-modal');
    },

    async deletePayment(paymentId) {
        const payment = await DB.get('purchase_payments', paymentId);
        if (!payment) return;
        const p = await DB.get('purchases', payment.purchaseId);
        if (!p) return;
        if (!await Utils.confirm(`Delete farmer payment ${payment.receiptNo || payment.id} for PKR ${Utils.formatPKR(payment.amount || 0)}? Linked capital transaction will be reversed.`)) return;
        await Utils.deleteLinkedCapitalTx('purchase_payments', payment.id);
        await DB.delete('purchase_payments', payment.id);
        const total = p.netPayableAmount || p.amount || 0;
        p.amountPaid = Math.max(0, (p.amountPaid || 0) - (payment.amount || 0));
        p.balance = total - p.amountPaid;
        p.paymentStatus = p.amountPaid >= total ? 'paid' : (p.amountPaid > 0 ? 'partial' : 'pending');
        await DB.put('purchases', p);
        await Utils.audit('delete', 'purchase_payment', payment.id, { oldAmount: payment.amount || 0, oldRecord: payment });
        Utils.showToast('Payment deleted!');
        await this.render();
    },

    async printPayment(paymentId) {
        const payment = await DB.get('purchase_payments', paymentId);
        if (!payment) return;
        const p = await DB.get('purchases', payment.purchaseId);
        if (!p) return;
        await ReceiptPDF.generatePaymentVoucher(payment, p, 'farmer');
    },

    async exportExcel() {
        if (!Utils.requireExcel()) return;
        const activeSeason = await Utils.getActiveSeason();
        const purchases = Utils.filterBySeason(await DB.getAll('purchases'), activeSeason);
        if (!purchases.length) { Utils.showToast('No data to export', 'warning'); return; }
        
        const rows = purchases.sort((a,b) => new Date(b.date)-new Date(a.date)).map(p => {
            const amt = p.netPayableAmount || p.amount || 0;
            const paid = p.amountPaid || 0;
            return {
                'Receipt ID': p.id,
                'Date': p.date,
                'Farmer': p.farmerName,
                'Crop': p.crop || '',
                'Amount': amt,
                'Total Paid': paid,
                'Balance': amt - paid,
                'Status': p.paymentStatus
            };
        });
        const ws = XLSX.utils.json_to_sheet(rows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Farmer Payments');
        XLSX.writeFile(wb, `Farmer_Payments_${Utils.todayISO()}.xlsx`);
        Utils.showToast('Excel exported!');
    }
};
