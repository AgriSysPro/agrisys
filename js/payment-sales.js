// ===== Sale Payment Tracking =====
const SalePayments = {
    async render() {
        const activeSeason = await Utils.getActiveSeason();
        const sales = Utils.filterBySeason(await DB.getAll('sales'), activeSeason);
        const payments = Utils.filterBySeason(await DB.getAll('sale_payments'), activeSeason);
        const search = (document.getElementById('sp-search').value || '').toLowerCase();
        const filter = document.getElementById('sp-filter').value;

        this.renderKPICards(sales, payments);

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

    renderKPICards(sales, payments) {
        const grid = document.getElementById('sp-kpi-grid');
        if (!grid) return;

        const totalSales = sales.reduce((s, x) => s + (x.amount || 0), 0);
        const totalReceived = payments.reduce((s, p) => s + (p.amount || 0), 0);
        const outstanding = sales.reduce((s, x) => s + Math.max(0, (x.amount || 0) - (x.amountReceived || 0)), 0);
        const pendingCount = sales.filter(x => x.paymentStatus !== 'paid').length;

        grid.innerHTML = `
            <div class="stat-card blue"><div class="stat-label">Total Invoiced Sales</div><div class="stat-value">PKR ${Utils.formatPKR(totalSales)}</div></div>
            <div class="stat-card green"><div class="stat-label">Total Received from Buyers</div><div class="stat-value">PKR ${Utils.formatPKR(totalReceived)}</div></div>
            <div class="stat-card orange"><div class="stat-label">Outstanding Receivables</div><div class="stat-value">PKR ${Utils.formatPKR(outstanding)}</div></div>
            <div class="stat-card purple"><div class="stat-label">Pending Sales Invoices</div><div class="stat-value">${pendingCount}</div></div>
        `;
    },

    async renderHistory() {
        const tbody = document.getElementById('sp-history-tbody');
        if (!tbody) return;
        const activeSeason = await Utils.getActiveSeason();
        let payments = Utils.filterBySeason(await DB.getAll('sale_payments'), activeSeason)
            .sort((a, b) => new Date(b.date) - new Date(a.date));

        const modeFilter = document.getElementById('sp-mode-filter') ? document.getElementById('sp-mode-filter').value : '';
        if (modeFilter) {
            payments = payments.filter(p => (p.mode || 'cash').toLowerCase() === modeFilter.toLowerCase());
        }

        const accounts = await DB.getAll('capital_accounts');
        const accountMap = Object.fromEntries(accounts.map(a => [a.id, a.name]));
        tbody.innerHTML = payments.map(p => `<tr>
            <td class="font-bold">${Utils.escapeHTML(p.receiptNo || p.id)}</td>
            <td>${Utils.formatDate(p.date)}</td>
            <td>${Utils.escapeHTML(p.buyerName)}</td>
            <td>${Utils.escapeHTML(p.saleId || 'General')}</td>
            <td><span class="badge badge-info">${Utils.escapeHTML((p.mode || 'cash').toUpperCase())}</span></td>
            <td class="text-right font-bold">PKR ${Utils.formatPKR(p.amount || 0)}</td>
            <td>${Utils.escapeHTML(accountMap[p.accountId] || '-')}</td>
            <td><div class="table-actions">
                <button class="btn btn-icon btn-ghost btn-sm" onclick="SalePayments.shareWhatsApp('${p.id}')" title="Share via WhatsApp">📱</button>
                <button class="btn btn-icon btn-ghost btn-sm" onclick="SalePayments.printPayment('${p.id}')" title="Print PDF Receipt">📄</button>
                <button class="btn btn-icon btn-ghost btn-sm" onclick="SalePayments.editPayment('${p.id}')" title="Edit">✏️</button>
                <button class="btn btn-icon btn-danger btn-sm" onclick="SalePayments.deletePayment('${p.id}')" title="Delete">×</button>
            </div></td>
        </tr>`).join('') || '<tr><td colspan="8" class="text-center" style="color:var(--text-muted)">No receipt history</td></tr>';
    },

    async shareWhatsApp(paymentId) {
        const payment = await DB.get('sale_payments', paymentId);
        if (!payment) return;
        const biz = await Settings.getBusiness();
        const msg = `*${biz.bizName || 'AgriSys Mandi'} — Buyer Receipt Voucher*\n` +
            `Voucher #: ${payment.receiptNo || payment.id}\n` +
            `Date: ${Utils.formatDate(payment.date)}\n` +
            `Buyer: ${payment.buyerName}\n` +
            `Sale #: ${payment.saleId || 'General Receipt'}\n` +
            `Amount Received: PKR ${Utils.formatPKR(payment.amount || 0)}\n` +
            (payment.advanceDeducted ? `Buyer Deposit Adjusted: PKR ${Utils.formatPKR(payment.advanceDeducted)}\n` : '') +
            `Payment Mode: ${(payment.mode || 'cash').toUpperCase()}\n` +
            `Remaining Balance: PKR ${Utils.formatPKR(payment.newBalance || 0)}\n\n` +
            `Thank you for your business!`;

        const encoded = encodeURIComponent(msg);
        window.open(`https://wa.me/?text=${encoded}`, '_blank');
    },

    async getBuyerAvailableDeposit(buyerName) {
        if (!buyerName) return 0;
        const bn = buyerName.trim().toLowerCase();
        const openings = await DB.getAll('opening_balances');
        const sales = await DB.getAll('sales');
        const payments = await DB.getAll('sale_payments');

        const totalOpeningDeposit = openings.filter(o => o.type === 'buyer_advance' && (o.partyName || '').trim().toLowerCase() === bn).reduce((s, o) => s + (o.amount || 0), 0);
        const adjustedInPayments = payments.filter(p => p.buyerName && p.buyerName.trim().toLowerCase() === bn).reduce((s, p) => s + (p.advanceDeducted || 0), 0);

        return Math.max(0, totalOpeningDeposit - adjustedInPayments);
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

        // Check for buyer open deposit & auto pre-fill
        const openAdv = await this.getBuyerAvailableDeposit(s.buyerName);
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
                const currentS = await DB.get('sales', saleId);
                if (!currentS) return;
                const currentBalance = (currentS.amount || 0) - (currentS.amountReceived || 0);

                const payAmt = Utils.pf(document.getElementById('pay-amount').value);
                const advDeduct = Utils.pf(document.getElementById('pay-deduct-advance').value);
                const netCash = Math.max(0, payAmt - advDeduct);

                if (payAmt <= 0) { Utils.showToast('Receipt amount must be > 0', 'error'); return; }
                if (payAmt > currentBalance) { Utils.showToast('Receipt cannot exceed remaining sale balance', 'error'); return; }
                if (advDeduct > openAdv) { Utils.showToast('Deposit adjustment cannot exceed available open deposit', 'error'); return; }
                if (netCash > 0 && !document.getElementById('pay-account').value) { Utils.showToast('Select cash/bank account for the cash portion', 'error'); return; }

                const receiptNo = document.getElementById('pay-receipt-id').value;
                const previousBalance = currentBalance;
                const txId = netCash > 0 ? Utils.generateId() : null;

                const payment = {
                    id: Utils.generateId(),
                    receiptNo,
                    saleId,
                    buyerName: currentS.buyerName,
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

                currentS.amountReceived = (currentS.amountReceived || 0) + payAmt;
                currentS.balance = (currentS.amount || 0) - currentS.amountReceived;
                currentS.paymentStatus = currentS.amountReceived >= (currentS.amount || 0) ? 'paid' : 'partial';

                await DB.put('sales', currentS);
                await DB.put('sale_payments', payment);

                if (netCash > 0) {
                    const capitalTx = {
                        id: txId,
                        accountId: document.getElementById('pay-account').value,
                        type: 'deposit',
                        amount: netCash,
                        date: document.getElementById('pay-date').value,
                        category: 'sale_payment',
                        referenceId: payment.id,
                        notes: `Buyer payment from ${currentS.buyerName} for ${currentS.id} (Receipt: ${receiptNo})`,
                        createdAt: new Date().toISOString()
                    };
                    await DB.put('capital_transactions', capitalTx);
                }

                await Utils.audit('create', 'sale_payment', payment.id, { newAmount: payAmt, buyer: currentS.buyerName });

                Utils.hideModal('payment-modal');
                Utils.showToast(advDeduct > 0 ? `Receipt saved! Adjusted PKR ${Utils.formatPKR(advDeduct)} from open deposit.` : 'Receipt recorded!');
                await this.render();

                if (printAfterSave) {
                    await ReceiptPDF.generatePaymentVoucher(payment, currentS, 'buyer');
                }
            } catch (e) {
                Utils.showToast('Failed to save receipt: ' + e.message, 'error');
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
        document.getElementById('dpay-title').textContent = 'General Buyer Receipt / Deposit Settlement';
        document.getElementById('dpay-party-label').textContent = 'Select Buyer Name *';
        document.getElementById('dpay-receipt-id').value = await Utils.getNextReceiptId('payment');
        document.getElementById('dpay-party-name').value = '';
        document.getElementById('dpay-amount').value = '';
        document.getElementById('dpay-deduct-adv').value = '0';
        document.getElementById('dpay-date').value = Utils.todayISO();
        document.getElementById('dpay-ref').value = '';
        document.getElementById('dpay-info-box').style.display = 'none';

        const buyers = await DB.getAll('buyers');
        const datalist = document.getElementById('dpay-party-datalist');
        datalist.innerHTML = buyers.map(b => `<option value="${Utils.escapeHTML(b.name)}">`).join('');
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
        const bn = name.toLowerCase();
        const sales = (await DB.getAll('sales')).filter(s => s.buyerName && s.buyerName.trim().toLowerCase() === bn);
        const openAdv = await this.getBuyerAvailableDeposit(name);
        this.currentDirectOpenAdv = openAdv;

        const totalPending = sales.reduce((s, x) => s + Math.max(0, (x.amount || 0) - (x.amountReceived || 0)), 0);
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
        document.getElementById('dpay-sum-net').textContent = `PKR ${Utils.formatPKR(netCash)}`;
    },

    async saveDirectPayment() {
        const name = document.getElementById('dpay-party-name').value.trim();
        if (!name) { Utils.showToast('Please select buyer name', 'error'); return; }

        const payAmt = Utils.pf(document.getElementById('dpay-amount').value);
        const advDeduct = Utils.pf(document.getElementById('dpay-deduct-adv').value);
        const netCash = Math.max(0, payAmt - advDeduct);

        if (payAmt <= 0) { Utils.showToast('Receipt amount must be > 0', 'error'); return; }
        if (netCash > 0 && !document.getElementById('dpay-account').value) { Utils.showToast('Select cash/bank account for cash portion', 'error'); return; }

        const btn = document.getElementById('dpay-save-btn');
        btn.disabled = true;
        try {
            const receiptNo = document.getElementById('dpay-receipt-id').value;
            const txId = netCash > 0 ? Utils.generateId() : null;

            // Distribute receipt across pending sales FIFO
            let remainingToDistribute = payAmt;
            const bn = name.toLowerCase();
            const sales = (await DB.getAll('sales'))
                .filter(s => s.buyerName && s.buyerName.trim().toLowerCase() === bn && s.paymentStatus !== 'paid')
                .sort((a, b) => new Date(a.date) - new Date(b.date));

            for (const s of sales) {
                if (remainingToDistribute <= 0) break;
                const sBal = (s.amount || 0) - (s.amountReceived || 0);
                const alloc = Math.min(remainingToDistribute, sBal);
                s.amountReceived = (s.amountReceived || 0) + alloc;
                s.balance = (s.amount || 0) - s.amountReceived;
                s.paymentStatus = s.amountReceived >= (s.amount || 0) ? 'paid' : 'partial';
                await DB.put('sales', s);
                remainingToDistribute -= alloc;
            }

            const payment = {
                id: Utils.generateId(),
                receiptNo,
                saleId: sales.length ? sales[0].id : 'General',
                buyerName: name,
                amount: payAmt,
                advanceDeducted: advDeduct,
                netCashAmount: netCash,
                date: document.getElementById('dpay-date').value,
                mode: document.getElementById('dpay-mode').value,
                reference: document.getElementById('dpay-ref').value.trim(),
                notes: `General buyer receipt & deposit settlement for ${name}`,
                accountId: document.getElementById('dpay-account').value,
                capitalTxId: txId,
                createdAt: new Date().toISOString()
            };

            await DB.put('sale_payments', payment);

            if (netCash > 0) {
                const capitalTx = {
                    id: txId,
                    accountId: document.getElementById('dpay-account').value,
                    type: 'deposit',
                    amount: netCash,
                    date: document.getElementById('dpay-date').value,
                    category: 'sale_payment',
                    referenceId: payment.id,
                    notes: `General buyer receipt from ${name} (Receipt: ${receiptNo})`,
                    createdAt: new Date().toISOString()
                };
                await DB.put('capital_transactions', capitalTx);
            }

            await Utils.audit('create', 'sale_payment', payment.id, { newAmount: payAmt, buyer: name });

            Utils.hideModal('direct-pay-modal');
            Utils.showToast(`General buyer receipt saved! Adjusted PKR ${Utils.formatPKR(advDeduct)} from open deposit.`);
            await this.render();
        } catch (e) {
            Utils.showToast('Failed to save receipt: ' + e.message, 'error');
        } finally {
            btn.disabled = false;
        }
    },

    async editPayment(paymentId) {
        const payment = await DB.get('sale_payments', paymentId);
        if (!payment) return;
        const s = await DB.get('sales', payment.saleId);
        if (!s) return;
        const total = s.amount || 0;
        const rcvdWithoutThis = (s.amountReceived || 0) - (payment.amount || 0);
        const maxAllowed = total - rcvdWithoutThis;
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

        const openAdv = await this.getBuyerAvailableDeposit(s.buyerName) + (payment.advanceDeducted || 0);
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
                const currentS = await DB.get('sales', payment.saleId);
                if (!currentS) return;
                const currentTotal = currentS.amount || 0;
                const currentRcvdWithoutThis = (currentS.amountReceived || 0) - (payment.amount || 0);
                const currentMaxAllowed = currentTotal - currentRcvdWithoutThis;

                const newAmount = Utils.pf(document.getElementById('pay-amount').value);
                const advDeduct = Utils.pf(document.getElementById('pay-deduct-advance').value);
                const netCash = Math.max(0, newAmount - advDeduct);

                if (newAmount <= 0) { Utils.showToast('Amount must be > 0', 'error'); return; }
                if (newAmount > currentMaxAllowed) { Utils.showToast('Receipt cannot exceed remaining balance', 'error'); return; }
                if (advDeduct > openAdv) { Utils.showToast('Deposit adjustment cannot exceed open deposit', 'error'); return; }
                if (netCash > 0 && !document.getElementById('pay-account').value) { Utils.showToast('Select cash/bank account for this receipt', 'error'); return; }

                const oldPayment = { ...payment };
                if (payment.capitalTxId) {
                    await Utils.deleteLinkedCapitalTx('sale_payments', payment.id);
                }

                payment.amount = newAmount;
                payment.advanceDeducted = advDeduct;
                payment.netCashAmount = netCash;
                payment.date = document.getElementById('pay-date').value;
                payment.mode = document.getElementById('pay-mode').value;
                payment.reference = document.getElementById('pay-ref').value.trim();
                payment.notes = document.getElementById('pay-notes').value.trim();
                payment.accountId = document.getElementById('pay-account').value;
                const previousBalance = currentTotal - currentRcvdWithoutThis;
                payment.newBalance = previousBalance - newAmount;

                if (netCash > 0) {
                    const capitalTx = {
                        id: Utils.generateId(),
                        accountId: payment.accountId,
                        type: 'deposit',
                        amount: netCash,
                        date: payment.date,
                        category: 'sale_payment',
                        referenceId: payment.id,
                        notes: `Buyer payment from ${currentS.buyerName} for ${currentS.id}`,
                        createdAt: new Date().toISOString()
                    };
                    await DB.put('capital_transactions', capitalTx);
                    payment.capitalTxId = capitalTx.id;
                } else {
                    payment.capitalTxId = null;
                }

                await DB.put('sale_payments', payment);
                currentS.amountReceived = currentRcvdWithoutThis + newAmount;
                currentS.balance = currentTotal - currentS.amountReceived;
                currentS.paymentStatus = currentS.amountReceived >= currentTotal ? 'paid' : 'partial';
                await DB.put('sales', currentS);

                await Utils.audit('update', 'sale_payment', payment.id, { oldPayment, newPayment: payment });

                Utils.hideModal('payment-modal');
                Utils.showToast('Receipt updated!');
                if (printAfterSave) await ReceiptPDF.generatePaymentVoucher(payment, currentS, 'buyer');
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
        const payment = await DB.get('sale_payments', paymentId);
        if (!payment) return;
        const s = await DB.get('sales', payment.saleId);
        if (!s) return;
        if (!await Utils.confirm(`Delete buyer receipt ${payment.receiptNo || payment.id} for PKR ${Utils.formatPKR(payment.amount || 0)}? Linked capital transaction will be reversed.`)) return;
        if (payment.capitalTxId) {
            await Utils.deleteLinkedCapitalTx('sale_payments', payment.id);
        }
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
                'Total Amount': amt,
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
