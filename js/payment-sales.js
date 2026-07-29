// ===== Sale Payment Tracking =====
const SalePayments = {
    async render() {
        const activeSeason = await Utils.getActiveSeason();
        const sales = Utils.filterBySeason(await DB.getAll('sales'), activeSeason);
        const search = (document.getElementById('sp-search').value || '').toLowerCase();
        const filter = document.getElementById('sp-filter').value;
        let filtered = sales.filter(s => {
            if (search && !s.buyerName.toLowerCase().includes(search) && !s.id.toLowerCase().includes(search)) return false;
            if (filter && s.paymentStatus !== filter) return false;
            return true;
        }).sort((a, b) => new Date(b.date) - new Date(a.date));

        document.getElementById('sp-tbody').innerHTML = filtered.map(s => {
            const amt = s.amount || 0;
            const rcvd = s.amountReceived || 0;
            const bal = amt - rcvd;
            return `<tr>
                <td class="font-bold">${Utils.escapeHTML(s.id)}</td><td>${Utils.formatDate(s.date)}</td><td class="font-bold">${Utils.escapeHTML(s.buyerName)}</td>
                <td>${Utils.escapeHTML(s.crop)}</td><td class="text-right">PKR ${Utils.formatPKR(amt)}</td>
                <td class="text-right">PKR ${Utils.formatPKR(rcvd)}</td>
                <td class="text-right font-bold" style="color:${bal > 0 ? 'var(--accent-warning)' : 'var(--accent-success)'}">PKR ${Utils.formatPKR(bal)}</td>
                <td>${Utils.statusBadge(s.paymentStatus)}</td>
                <td><button class="btn btn-sm btn-primary" onclick="SalePayments.recordPayment('${s.id}')" ${s.paymentStatus==='paid'?'disabled':''}>Receive</button></td>
            </tr>`;
        }).join('') || '<tr><td colspan="9" class="text-center" style="color:var(--text-muted)">No records</td></tr>';
        await this.renderHistory();
    },

    async renderHistory() {
        const tbody = document.getElementById('sp-history-tbody');
        if (!tbody) return;
        const activeSeason = await Utils.getActiveSeason();
        const payments = Utils.filterBySeason(await DB.getAll('sale_payments'), activeSeason)
            .sort((a, b) => new Date(b.date) - new Date(a.date));
        const accounts = await DB.getAll('capital_accounts');
        const accountMap = Object.fromEntries(accounts.map(a => [a.id, a.name]));
        tbody.innerHTML = payments.map(p => `<tr>
            <td class="font-bold">${Utils.escapeHTML(p.receiptNo || p.id)}</td>
            <td>${Utils.formatDate(p.date)}</td>
            <td>${Utils.escapeHTML(p.buyerName)}</td>
            <td>${Utils.escapeHTML(p.saleId)}</td>
            <td>${Utils.escapeHTML((p.mode || 'cash').toUpperCase())}</td>
            <td class="text-right font-bold">PKR ${Utils.formatPKR(p.amount || 0)}</td>
            <td>${Utils.escapeHTML(accountMap[p.accountId] || '-')}</td>
            <td><div class="table-actions">
                <button class="btn btn-icon btn-ghost btn-sm" onclick="SalePayments.editPayment('${p.id}')" title="Edit">✏️</button>
                <button class="btn btn-icon btn-ghost btn-sm" onclick="SalePayments.printPayment('${p.id}')" title="Print">📄</button>
                <button class="btn btn-icon btn-danger btn-sm" onclick="SalePayments.deletePayment('${p.id}')" title="Delete">×</button>
            </div></td>
        </tr>`).join('') || '<tr><td colspan="8" class="text-center" style="color:var(--text-muted)">No receipt history</td></tr>';
    },

    async recordPayment(saleId) {
        const s = await DB.get('sales', saleId);
        if (!s) return;
        const balance = (s.amount || 0) - (s.amountReceived || 0);
        document.getElementById('pay-modal-title').textContent = `Receive from: ${s.buyerName} (${s.id})`;
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
                const currentS = await DB.get('sales', saleId);
                if (!currentS) return;
                const currentBalance = (currentS.amount || 0) - (currentS.amountReceived || 0);

                const payAmt = Utils.pf(document.getElementById('pay-amount').value);
                if (payAmt <= 0) { Utils.showToast('Amount must be > 0', 'error'); return; }
                if (payAmt > currentBalance) { Utils.showToast('Payment cannot exceed remaining balance', 'error'); return; }
                if (!document.getElementById('pay-account').value) { Utils.showToast('Select cash/bank account for this receipt', 'error'); return; }
                const receiptNo = document.getElementById('pay-receipt-id').value;
                const previousBalance = currentBalance;
                const txId = Utils.generateId();
                const payment = {
                    id: Utils.generateId(), receiptNo, saleId, buyerName: currentS.buyerName,
                    amount: payAmt, date: document.getElementById('pay-date').value,
                    mode: document.getElementById('pay-mode').value,
                    reference: document.getElementById('pay-ref').value.trim(),
                    notes: document.getElementById('pay-notes').value.trim(),
                    accountId: document.getElementById('pay-account').value,
                    previousBalance,
                    newBalance: previousBalance - payAmt,
                    capitalTxId: txId,
                    createdAt: new Date().toISOString()
                };

                currentS.amountReceived = (currentS.amountReceived || 0) + payAmt;
                currentS.balance = (currentS.amount || 0) - currentS.amountReceived;
                currentS.paymentStatus = currentS.amountReceived >= (currentS.amount || 0) ? 'paid' : 'partial';

                const ops = [
                    { storeName: 'sale_payments', action: 'put', data: payment },
                    {
                        storeName: 'capital_transactions',
                        action: 'put',
                        data: {
                            id: txId,
                            accountId: payment.accountId,
                            type: 'deposit',
                            amount: payAmt,
                            date: payment.date,
                            description: `Receipt from buyer ${currentS.buyerName} for sale #${saleId}`,
                            sourceStore: 'sale_payments',
                            sourceId: payment.id,
                            isReconciled: false,
                            createdAt: new Date().toISOString()
                        }
                    },
                    { storeName: 'sales', action: 'put', data: currentS },
                    {
                        storeName: 'audit_logs',
                        action: 'put',
                        data: {
                            id: Utils.generateId(),
                            date: Utils.todayISO(),
                            action: 'create',
                            entityType: 'sale_payment',
                            entityId: payment.id,
                            details: {
                                receiptNo,
                                saleId,
                                buyerName: currentS.buyerName,
                                amount: payAmt,
                                previousBalance,
                                newBalance: payment.newBalance,
                                capitalTxId: txId
                            },
                            createdAt: new Date().toISOString()
                        }
                    }
                ];

                await DB.commitUnitOfWork(ops);
                await Utils.confirmReceiptId('payment', receiptNo);

                Utils.hideModal('payment-modal');
                Utils.showToast('Payment received!');
                if (printAfterSave) await ReceiptPDF.generatePaymentVoucher(payment, currentS, 'buyer');
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
        const payment = await DB.get('sale_payments', paymentId);
        if (!payment) return;
        const s = await DB.get('sales', payment.saleId);
        if (!s) return;
        const total = s.amount || 0;
        const receivedWithoutThis = (s.amountReceived || 0) - (payment.amount || 0);
        const maxAllowed = total - receivedWithoutThis;
        document.getElementById('pay-modal-title').textContent = `Edit Buyer Receipt: ${s.buyerName} (${s.id})`;
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
                const currentS = await DB.get('sales', payment.saleId);
                if (!currentS) return;
                const currentTotal = currentS.amount || 0;
                const currentReceivedWithoutThis = (currentS.amountReceived || 0) - (payment.amount || 0);
                const currentMaxAllowed = currentTotal - currentReceivedWithoutThis;

                const newAmount = Utils.pf(document.getElementById('pay-amount').value);
                if (newAmount <= 0) { Utils.showToast('Amount must be > 0', 'error'); return; }
                if (newAmount > currentMaxAllowed) { Utils.showToast('Receipt cannot exceed remaining balance', 'error'); return; }
                if (!document.getElementById('pay-account').value) { Utils.showToast('Select cash/bank account for this receipt', 'error'); return; }
                const oldPayment = { ...payment };
                await Utils.deleteLinkedCapitalTx('sale_payments', payment.id);
                payment.amount = newAmount;
                payment.date = document.getElementById('pay-date').value;
                payment.mode = document.getElementById('pay-mode').value;
                payment.reference = document.getElementById('pay-ref').value.trim();
                payment.notes = document.getElementById('pay-notes').value.trim();
                payment.accountId = document.getElementById('pay-account').value;
                const previousBalance = currentTotal - currentReceivedWithoutThis;
                payment.newBalance = previousBalance - newAmount;

                await DB.put('sale_payments', payment);
                const tx = await Utils.createLinkedCapitalTx({
                    accountId: payment.accountId,
                    type: 'deposit',
                    amount: newAmount,
                    date: payment.date,
                    description: `Receipt from buyer ${currentS.buyerName} for sale #${currentS.id}`,
                    sourceStore: 'sale_payments',
                    sourceId: payment.id
                });
                if (tx) payment.capitalTxId = tx.id;
                if (tx) await DB.put('sale_payments', payment);

                currentS.amountReceived = currentReceivedWithoutThis + newAmount;
                currentS.balance = currentTotal - currentS.amountReceived;
                currentS.paymentStatus = currentS.amountReceived >= currentTotal ? 'paid' : 'partial';
                await DB.put('sales', currentS);
                await Utils.audit('update', 'sale_payment', payment.id, {
                    oldPayment,
                    newPayment: payment
                });

                Utils.hideModal('payment-modal');
                Utils.showToast('Payment updated!');
                if (printAfterSave) await ReceiptPDF.generatePaymentVoucher(payment, currentS, 'buyer');
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
        const payment = await DB.get('sale_payments', paymentId);
        if (!payment) return;
        const s = await DB.get('sales', payment.saleId);
        if (!s) return;
        if (!await Utils.confirm(`Delete buyer receipt ${payment.receiptNo || payment.id} for PKR ${Utils.formatPKR(payment.amount || 0)}? Linked capital transaction will be reversed.`)) return;
        await Utils.deleteLinkedCapitalTx('sale_payments', payment.id);
        await DB.delete('sale_payments', payment.id);
        const total = s.amount || 0;
        s.amountReceived = Math.max(0, (s.amountReceived || 0) - (payment.amount || 0));
        s.balance = total - s.amountReceived;
        s.paymentStatus = s.amountReceived >= total ? 'paid' : (s.amountReceived > 0 ? 'partial' : 'pending');
        await DB.put('sales', s);
        await Utils.audit('delete', 'sale_payment', payment.id, { oldAmount: payment.amount || 0, oldRecord: payment });
        Utils.showToast('Receipt deleted!');
        await this.render();
    },

    async printPayment(paymentId) {
        const payment = await DB.get('sale_payments', paymentId);
        if (!payment) return;
        const s = await DB.get('sales', payment.saleId);
        if (!s) return;
        await ReceiptPDF.generatePaymentVoucher(payment, s, 'buyer');
    },

    async exportExcel() {
        if (!Utils.requireExcel()) return;
        const activeSeason = await Utils.getActiveSeason();
        const sales = Utils.filterBySeason(await DB.getAll('sales'), activeSeason);
        if (!sales.length) { Utils.showToast('No data to export', 'warning'); return; }
        
        const rows = sales.sort((a,b) => new Date(b.date)-new Date(a.date)).map(s => {
            const amt = s.amount || 0;
            const rcvd = s.amountReceived || 0;
            return {
                'Receipt ID': s.id,
                'Date': s.date,
                'Buyer': s.buyerName,
                'Crop': s.crop || '',
                'Amount': amt,
                'Total Received': rcvd,
                'Balance': amt - rcvd,
                'Status': s.paymentStatus
            };
        });
        const ws = XLSX.utils.json_to_sheet(rows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Buyer Payments');
        XLSX.writeFile(wb, `Buyer_Payments_${Utils.todayISO()}.xlsx`);
        Utils.showToast('Excel exported!');
    }
};
