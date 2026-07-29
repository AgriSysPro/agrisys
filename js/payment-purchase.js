// ===== Purchase Payment Tracking =====
const PurchasePayments = {
    async render() {
        const activeSeason = await Utils.getActiveSeason();
        const purchases = Utils.filterBySeason(await DB.getAll('purchases'), activeSeason);
        const payments = Utils.filterBySeason(await DB.getAll('purchase_payments'), activeSeason);
        const search = (document.getElementById('pp-search').value || '').toLowerCase();
        const filter = document.getElementById('pp-filter').value;

        this.renderKPICards(purchases, payments);

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

    renderKPICards(purchases, payments) {
        const grid = document.getElementById('pp-kpi-grid');
        if (!grid) return;

        const totalPayable = purchases.reduce((s, p) => s + (p.netPayableAmount || p.amount || 0), 0);
        const totalPaid = payments.reduce((s, p) => s + (p.amount || 0), 0);
        const outstanding = purchases.reduce((s, p) => s + Math.max(0, (p.netPayableAmount || p.amount || 0) - (p.amountPaid || 0)), 0);
        const pendingCount = purchases.filter(p => p.paymentStatus !== 'paid').length;

        grid.innerHTML = `
            <div class="stat-card blue"><div class="stat-label">Total Farmer Payables</div><div class="stat-value">PKR ${Utils.formatPKR(totalPayable)}</div></div>
            <div class="stat-card green"><div class="stat-label">Total Paid to Farmers</div><div class="stat-value">PKR ${Utils.formatPKR(totalPaid)}</div></div>
            <div class="stat-card orange"><div class="stat-label">Outstanding Balance</div><div class="stat-value">PKR ${Utils.formatPKR(outstanding)}</div></div>
            <div class="stat-card purple"><div class="stat-label">Pending Invoices</div><div class="stat-value">${pendingCount}</div></div>
        `;
    },

    async renderHistory() {
        const tbody = document.getElementById('pp-history-tbody');
        if (!tbody) return;
        const activeSeason = await Utils.getActiveSeason();
        let payments = Utils.filterBySeason(await DB.getAll('purchase_payments'), activeSeason)
            .sort((a, b) => new Date(b.date) - new Date(a.date));
        
        const modeFilter = document.getElementById('pp-mode-filter') ? document.getElementById('pp-mode-filter').value : '';
        if (modeFilter) {
            payments = payments.filter(p => (p.mode || 'cash').toLowerCase() === modeFilter.toLowerCase());
        }

        const accounts = await DB.getAll('capital_accounts');
        const accountMap = Object.fromEntries(accounts.map(a => [a.id, a.name]));
        tbody.innerHTML = payments.map(p => `<tr>
            <td class="font-bold">${Utils.escapeHTML(p.receiptNo || p.id)}</td>
            <td>${Utils.formatDate(p.date)}</td>
            <td>${Utils.escapeHTML(p.farmerName)}</td>
            <td>${Utils.escapeHTML(p.purchaseId || 'General')}</td>
            <td><span class="badge badge-info">${Utils.escapeHTML((p.mode || 'cash').toUpperCase())}</span></td>
            <td class="text-right font-bold">PKR ${Utils.formatPKR(p.amount || 0)}</td>
            <td>${Utils.escapeHTML(accountMap[p.accountId] || '-')}</td>
            <td><div class="table-actions">
                <button class="btn btn-icon btn-ghost btn-sm" onclick="PurchasePayments.shareWhatsApp('${p.id}')" title="Share via WhatsApp">📱</button>
                <button class="btn btn-icon btn-ghost btn-sm" onclick="PurchasePayments.printPayment('${p.id}')" title="Print PDF Voucher">📄</button>
                <button class="btn btn-icon btn-ghost btn-sm" onclick="PurchasePayments.editPayment('${p.id}')" title="Edit">✏️</button>
                <button class="btn btn-icon btn-danger btn-sm" onclick="PurchasePayments.deletePayment('${p.id}')" title="Delete">×</button>
            </div></td>
        </tr>`).join('') || '<tr><td colspan="8" class="text-center" style="color:var(--text-muted)">No payment history</td></tr>';
    },

    async shareWhatsApp(paymentId) {
        const payment = await DB.get('purchase_payments', paymentId);
        if (!payment) return;
        const biz = await Settings.getBusiness();
        const msg = `*${biz.bizName || 'AgriSys Mandi'} — Farmer Payment Voucher*\n` +
            `Voucher #: ${payment.receiptNo || payment.id}\n` +
            `Date: ${Utils.formatDate(payment.date)}\n` +
            `Farmer: ${payment.farmerName}\n` +
            `Purchase #: ${payment.purchaseId || 'General Payment'}\n` +
            `Amount Paid: PKR ${Utils.formatPKR(payment.amount || 0)}\n` +
            (payment.advanceDeducted ? `Open Advance Adjusted: PKR ${Utils.formatPKR(payment.advanceDeducted)}\n` : '') +
            `Payment Mode: ${(payment.mode || 'cash').toUpperCase()}\n` +
            `Remaining Balance: PKR ${Utils.formatPKR(payment.newBalance || 0)}\n\n` +
            `Thank you for doing business with us!`;

        const encoded = encodeURIComponent(msg);
        window.open(`https://wa.me/?text=${encoded}`, '_blank');
    },

    async getFarmerAvailableAdvance(farmerName) {
        if (!farmerName) return 0;
        const fn = farmerName.trim().toLowerCase();
        const advances = await DB.getAll('farmer_advances');
        const openings = await DB.getAll('opening_balances');
        const purchases = await DB.getAll('purchases');
        const payments = await DB.getAll('purchase_payments');

        const totalAdv = advances.filter(a => a.farmerName && a.farmerName.trim().toLowerCase() === fn).reduce((s, a) => s + (a.amount || 0), 0) +
            openings.filter(o => o.type === 'farmer_advance' && (o.partyName || '').trim().toLowerCase() === fn).reduce((s, o) => s + (o.amount || 0), 0);

        const recoveredInPurchases = purchases.filter(p => p.farmerName && p.farmerName.trim().toLowerCase() === fn).reduce((s, p) => s + (p.advanceDeducted || 0), 0);
        const adjustedInPayments = payments.filter(p => p.farmerName && p.farmerName.trim().toLowerCase() === fn).reduce((s, p) => s + (p.advanceDeducted || 0), 0);

        return Math.max(0, totalAdv - recoveredInPurchases - adjustedInPayments);
    },

    calculateModalTotals() {
        const totalPay = Utils.pf(document.getElementById('pay-amount').value);
        const availAdv = this.currentOpenAdvance || 0;
        const advInput = document.getElementById('pay-deduct-advance');
        let advDeduct = Utils.pf(advInput ? advInput.value : 0);

        if (advDeduct > availAdv) {
            advDeduct = availAdv;
            if (advInput) advInput.value = advDeduct.toFixed(2);
        }
        if (advDeduct > totalPay) {
            advDeduct = totalPay;
            if (advInput) advInput.value = advDeduct.toFixed(2);
        }

        const netCash = Math.max(0, totalPay - advDeduct);

        if (document.getElementById('pay-sum-total')) document.getElementById('pay-sum-total').textContent = `PKR ${Utils.formatPKR(totalPay)}`;
        const advRow = document.getElementById('pay-sum-adv-row');
        if (advRow) {
            if (advDeduct > 0) {
                advRow.style.display = 'flex';
                document.getElementById('pay-sum-adv').textContent = `- PKR ${Utils.formatPKR(advDeduct)}`;
            } else {
                advRow.style.display = 'none';
            }
        }
        if (document.getElementById('pay-sum-net')) document.getElementById('pay-sum-net').textContent = `PKR ${Utils.formatPKR(netCash)}`;
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

        // Check for open advance & auto pre-fill
        const openAdv = await this.getFarmerAvailableAdvance(p.farmerName);
        this.currentOpenAdvance = openAdv;

        const advBox = document.getElementById('pay-advance-box');
        const advInput = document.getElementById('pay-deduct-advance');
        if (openAdv > 0) {
            advBox.style.display = 'block';
            document.getElementById('pay-avail-advance').textContent = `PKR ${Utils.formatPKR(openAdv)}`;
            advInput.max = openAdv;
            const autoDeduct = Math.min(openAdv, balance);
            advInput.value = autoDeduct.toFixed(2);
        } else {
            advBox.style.display = 'none';
            advInput.value = '0';
        }
        this.calculateModalTotals();

        const savePayment = async (printAfterSave = false) => {
            const btn1 = document.getElementById('pay-save-btn');
            const btn2 = document.getElementById('pay-save-print-btn');
            btn1.disabled = true; btn2.disabled = true;
            try {
                const currentP = await DB.get('purchases', purchaseId);
                if (!currentP) return;
                const currentBalance = (currentP.netPayableAmount || currentP.amount || 0) - (currentP.amountPaid || 0);

                const payAmt = Utils.pf(document.getElementById('pay-amount').value);
                const advDeduct = Utils.pf(document.getElementById('pay-deduct-advance').value);
                const netCash = Math.max(0, payAmt - advDeduct);

                if (payAmt <= 0) { Utils.showToast('Payment amount must be > 0', 'error'); return; }
                if (payAmt > currentBalance) { Utils.showToast('Payment cannot exceed remaining purchase balance', 'error'); return; }
                if (advDeduct > openAdv) { Utils.showToast('Advance adjustment cannot exceed available open advance', 'error'); return; }
                if (netCash > 0 && !document.getElementById('pay-account').value) { Utils.showToast('Select cash/bank account for the cash portion', 'error'); return; }

                const receiptNo = document.getElementById('pay-receipt-id').value;
                const previousBalance = currentBalance;
                
                const txId = netCash > 0 ? Utils.generateId() : null;
                const payment = {
                    id: Utils.generateId(),
                    receiptNo,
                    purchaseId,
                    farmerName: currentP.farmerName,
                    amount: payAmt,
                    advanceDeducted: advDeduct,
                    netCashAmount: netCash,
                    date: document.getElementById('pay-date').value,
                    mode: document.getElementById('pay-mode').value,
                    reference: document.getElementById('pay-ref').value.trim(),
                    notes: document.getElementById('pay-notes').value.trim(),
                    accountId: document.getElementById('pay-account').value,
                    previousBalance,
                    newBalance: previousBalance - payAmt,
                    capitalTxId: txId,
                    createdAt: new Date().toISOString()
                };

                currentP.amountPaid = (currentP.amountPaid || 0) + payAmt;
                const total = currentP.netPayableAmount || currentP.amount || 0;
                currentP.balance = total - currentP.amountPaid;
                currentP.paymentStatus = currentP.amountPaid >= total ? 'paid' : 'partial';

                await DB.put('purchases', currentP);
                await DB.put('purchase_payments', payment);

                if (netCash > 0) {
                    const capitalTx = {
                        id: txId,
                        accountId: document.getElementById('pay-account').value,
                        type: 'withdrawal',
                        amount: netCash,
                        date: document.getElementById('pay-date').value,
                        category: 'farmer_payment',
                        referenceId: payment.id,
                        notes: `Farmer payment to ${currentP.farmerName} for ${currentP.id} (Receipt: ${receiptNo})`,
                        createdAt: new Date().toISOString()
                    };
                    await DB.put('capital_transactions', capitalTx);
                }

                await Utils.audit('create', 'purchase_payment', payment.id, { newAmount: payAmt, farmer: currentP.farmerName });

                Utils.hideModal('payment-modal');
                Utils.showToast(advDeduct > 0 ? `Payment saved! Adjusted PKR ${Utils.formatPKR(advDeduct)} from open advance.` : 'Payment saved!');
                await this.render();

                if (printAfterSave) {
                    await ReceiptPDF.generatePaymentVoucher(payment, currentP, 'farmer');
                }
            } catch (e) {
                Utils.showToast('Failed to save payment: ' + e.message, 'error');
            } finally {
                btn1.disabled = false; btn2.disabled = false;
            }
        };

        const btn1 = document.getElementById('pay-save-btn');
        const btn2 = document.getElementById('pay-save-print-btn');
        btn1.onclick = () => savePayment(false);
        btn2.onclick = () => savePayment(true);
        Utils.showModal('payment-modal');
    },

    async showDirectPaymentModal() {
        document.getElementById('dpay-title').textContent = 'General Farmer Payment / Advance Settlement';
        document.getElementById('dpay-party-label').textContent = 'Select Farmer Name *';
        document.getElementById('dpay-receipt-id').value = await Utils.getNextReceiptId('payment');
        document.getElementById('dpay-party-name').value = '';
        document.getElementById('dpay-amount').value = '';
        document.getElementById('dpay-deduct-adv').value = '0';
        document.getElementById('dpay-date').value = Utils.todayISO();
        document.getElementById('dpay-ref').value = '';
        document.getElementById('dpay-info-box').style.display = 'none';

        const farmers = await DB.getAll('farmers');
        const datalist = document.getElementById('dpay-party-datalist');
        datalist.innerHTML = farmers.map(f => `<option value="${Utils.escapeHTML(f.name)}">`).join('');
        await Utils.populateCapitalAccountSelect('dpay-account', 'Select cash/bank account');

        document.getElementById('dpay-save-btn').onclick = () => this.saveDirectPayment();
        Utils.showModal('direct-pay-modal');
    },

    async onDirectPartySelect() {
        const name = document.getElementById('dpay-party-name').value.trim();
        if (!name) {
            document.getElementById('dpay-info-box').style.display = 'none';
            return;
        }
        const fn = name.toLowerCase();
        const purchases = (await DB.getAll('purchases')).filter(p => p.farmerName && p.farmerName.trim().toLowerCase() === fn);
        const openAdv = await this.getFarmerAvailableAdvance(name);
        this.currentDirectOpenAdv = openAdv;

        const totalPending = purchases.reduce((s, p) => s + Math.max(0, (p.netPayableAmount || p.amount || 0) - (p.amountPaid || 0)), 0);
        document.getElementById('dpay-info-box').style.display = 'block';
        document.getElementById('dpay-total-bal').textContent = `PKR ${Utils.formatPKR(totalPending)}`;
        document.getElementById('dpay-open-adv').textContent = `PKR ${Utils.formatPKR(openAdv)}`;

        if (openAdv > 0 && totalPending > 0) {
            document.getElementById('dpay-deduct-adv').value = Math.min(openAdv, totalPending).toFixed(2);
            document.getElementById('dpay-amount').value = totalPending.toFixed(2);
        } else if (totalPending > 0) {
            document.getElementById('dpay-amount').value = totalPending.toFixed(2);
            document.getElementById('dpay-deduct-adv').value = '0';
        }
        this.calculateDirectTotals();
    },

    calculateDirectTotals() {
        const totalAmt = Utils.pf(document.getElementById('dpay-amount').value);
        const availAdv = this.currentDirectOpenAdv || 0;
        const advInput = document.getElementById('dpay-deduct-adv');
        let advDeduct = Utils.pf(advInput ? advInput.value : 0);

        if (advDeduct > availAdv) {
            advDeduct = availAdv;
            if (advInput) advInput.value = advDeduct.toFixed(2);
        }
        if (advDeduct > totalAmt) {
            advDeduct = totalAmt;
            if (advInput) advInput.value = advDeduct.toFixed(2);
        }

        const netCash = Math.max(0, totalAmt - advDeduct);
        document.getElementById('dpay-sum-total').textContent = `PKR ${Utils.formatPKR(totalAmt)}`;
        const advRow = document.getElementById('dpay-sum-adv-row');
        if (advRow) {
            if (advDeduct > 0) {
                advRow.style.display = 'flex';
                document.getElementById('dpay-sum-adv').textContent = `- PKR ${Utils.formatPKR(advDeduct)}`;
            } else {
                advRow.style.display = 'none';
            }
        }
        if (document.getElementById('dpay-sum-net')) document.getElementById('dpay-sum-net').textContent = `PKR ${Utils.formatPKR(netCash)}`;
    },

    async saveDirectPayment() {
        const name = document.getElementById('dpay-party-name').value.trim();
        if (!name) { Utils.showToast('Please select farmer name', 'error'); return; }

        const payAmt = Utils.pf(document.getElementById('dpay-amount').value);
        const advDeduct = Utils.pf(document.getElementById('dpay-deduct-adv').value);
        const netCash = Math.max(0, payAmt - advDeduct);

        if (payAmt <= 0) { Utils.showToast('Payment amount must be > 0', 'error'); return; }
        if (netCash > 0 && !document.getElementById('dpay-account').value) { Utils.showToast('Select cash/bank account for cash portion', 'error'); return; }

        const btn = document.getElementById('dpay-save-btn');
        btn.disabled = true;
        try {
            const receiptNo = document.getElementById('dpay-receipt-id').value;
            const txId = netCash > 0 ? Utils.generateId() : null;

            // Distribute payment across pending purchases FIFO
            let remainingToDistribute = payAmt;
            const fn = name.toLowerCase();
            const purchases = (await DB.getAll('purchases'))
                .filter(p => p.farmerName && p.farmerName.trim().toLowerCase() === fn && p.paymentStatus !== 'paid')
                .sort((a, b) => new Date(a.date) - new Date(b.date));

            for (const p of purchases) {
                if (remainingToDistribute <= 0) break;
                const pBal = (p.netPayableAmount || p.amount || 0) - (p.amountPaid || 0);
                const alloc = Math.min(remainingToDistribute, pBal);
                p.amountPaid = (p.amountPaid || 0) + alloc;
                p.balance = (p.netPayableAmount || p.amount || 0) - p.amountPaid;
                p.paymentStatus = p.amountPaid >= (p.netPayableAmount || p.amount || 0) ? 'paid' : 'partial';
                await DB.put('purchases', p);
                remainingToDistribute -= alloc;
            }

            const payment = {
                id: Utils.generateId(),
                receiptNo,
                purchaseId: purchases.length ? purchases[0].id : 'General',
                farmerName: name,
                amount: payAmt,
                advanceDeducted: advDeduct,
                netCashAmount: netCash,
                date: document.getElementById('dpay-date').value,
                mode: document.getElementById('dpay-mode').value,
                reference: document.getElementById('dpay-ref').value.trim(),
                notes: `General farmer payment & advance settlement for ${name}`,
                accountId: document.getElementById('dpay-account').value,
                capitalTxId: txId,
                createdAt: new Date().toISOString()
            };

            await DB.put('purchase_payments', payment);

            if (netCash > 0) {
                const capitalTx = {
                    id: txId,
                    accountId: document.getElementById('dpay-account').value,
                    type: 'withdrawal',
                    amount: netCash,
                    date: document.getElementById('dpay-date').value,
                    category: 'farmer_payment',
                    referenceId: payment.id,
                    notes: `General farmer payment to ${name} (Receipt: ${receiptNo})`,
                    createdAt: new Date().toISOString()
                };
                await DB.put('capital_transactions', capitalTx);
            }

            await Utils.audit('create', 'purchase_payment', payment.id, { newAmount: payAmt, farmer: name });

            Utils.hideModal('direct-pay-modal');
            Utils.showToast(`General payment saved! Adjusted PKR ${Utils.formatPKR(advDeduct)} from open advance.`);
            await this.render();
        } catch (e) {
            Utils.showToast('Failed to save payment: ' + e.message, 'error');
        } finally {
            btn.disabled = false;
        }
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

        const openAdv = await this.getFarmerAvailableAdvance(p.farmerName) + (payment.advanceDeducted || 0);
        this.currentOpenAdvance = openAdv;
        const advBox = document.getElementById('pay-advance-box');
        const advInput = document.getElementById('pay-deduct-advance');
        if (openAdv > 0) {
            advBox.style.display = 'block';
            document.getElementById('pay-avail-advance').textContent = `PKR ${Utils.formatPKR(openAdv)}`;
            advInput.max = openAdv;
            advInput.value = (payment.advanceDeducted || 0).toFixed(2);
        } else {
            advBox.style.display = 'none';
            advInput.value = '0';
        }
        this.calculateModalTotals();

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
                const advDeduct = Utils.pf(document.getElementById('pay-deduct-advance').value);
                const netCash = Math.max(0, newAmount - advDeduct);

                if (newAmount <= 0) { Utils.showToast('Amount must be > 0', 'error'); return; }
                if (newAmount > currentMaxAllowed) { Utils.showToast('Payment cannot exceed remaining balance', 'error'); return; }
                if (advDeduct > openAdv) { Utils.showToast('Advance adjustment cannot exceed open advance', 'error'); return; }
                if (netCash > 0 && !document.getElementById('pay-account').value) { Utils.showToast('Select cash/bank account for this payment', 'error'); return; }

                const oldPayment = { ...payment };
                if (payment.capitalTxId) {
                    await Utils.deleteLinkedCapitalTx('purchase_payments', payment.id);
                }

                payment.amount = newAmount;
                payment.advanceDeducted = advDeduct;
                payment.netCashAmount = netCash;
                payment.date = document.getElementById('pay-date').value;
                payment.mode = document.getElementById('pay-mode').value;
                payment.reference = document.getElementById('pay-ref').value.trim();
                payment.notes = document.getElementById('pay-notes').value.trim();
                payment.accountId = document.getElementById('pay-account').value;
                const previousBalance = currentTotal - currentPaidWithoutThis;
                payment.newBalance = previousBalance - newAmount;

                if (netCash > 0) {
                    const capitalTx = {
                        id: Utils.generateId(),
                        accountId: payment.accountId,
                        type: 'withdrawal',
                        amount: netCash,
                        date: payment.date,
                        category: 'farmer_payment',
                        referenceId: payment.id,
                        notes: `Farmer payment to ${currentP.farmerName} for ${currentP.id}`,
                        createdAt: new Date().toISOString()
                    };
                    await DB.put('capital_transactions', capitalTx);
                    payment.capitalTxId = capitalTx.id;
                } else {
                    payment.capitalTxId = null;
                }

                await DB.put('purchase_payments', payment);
                currentP.amountPaid = currentPaidWithoutThis + newAmount;
                currentP.balance = currentTotal - currentP.amountPaid;
                currentP.paymentStatus = currentP.amountPaid >= currentTotal ? 'paid' : 'partial';
                await DB.put('purchases', currentP);

                await Utils.audit('update', 'purchase_payment', payment.id, { oldPayment, newPayment: payment });

                Utils.hideModal('payment-modal');
                Utils.showToast('Payment updated!');
                if (printAfterSave) await ReceiptPDF.generatePaymentVoucher(payment, currentP, 'farmer');
                await this.render();
            } finally {
                btn1.disabled = false; btn2.disabled = false;
            }
        };

        const btn1 = document.getElementById('pay-save-btn');
        const btn2 = document.getElementById('pay-save-print-btn');
        btn1.onclick = () => saveEdit(false);
        btn2.onclick = () => saveEdit(true);
        Utils.showModal('payment-modal');
    },

    async deletePayment(paymentId) {
        const payment = await DB.get('purchase_payments', paymentId);
        if (!payment) return;
        const p = await DB.get('purchases', payment.purchaseId);
        if (!p) return;
        if (!await Utils.confirm(`Delete farmer payment ${payment.receiptNo || payment.id} for PKR ${Utils.formatPKR(payment.amount || 0)}? Linked capital transaction will be reversed.`)) return;
        if (payment.capitalTxId) {
            await Utils.deleteLinkedCapitalTx('purchase_payments', payment.id);
        }
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
