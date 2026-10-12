// Payment allocation, cash linkage, and reversals share one implementation.
const PaymentService = {
    activeType: 'farmer',
    busy: false,
    openingSettlement: false,
    config(type) {
        return type === 'farmer'
            ? { invoices: 'purchases', payments: 'purchase_payments', party: 'farmerName', paid: 'amountPaid', link: 'purchaseId', initial: 'initialPaymentAmount', module: PurchasePayments }
            : { invoices: 'sales', payments: 'sale_payments', party: 'buyerName', paid: 'amountReceived', link: 'saleId', initial: 'initialReceiptAmount', module: SalePayments };
    },
    activate(type) { this.activeType = type; },
    onPartyInput() { return this.config(this.activeType).module.onDirectPartySelect(); },
    onTotalsInput(direct = false) {
        if (this.openingSettlement) {
            const amount = Utils.pf(document.getElementById('pay-amount')?.value);
            document.getElementById('pay-sum-total').textContent = `PKR ${Utils.formatPKR(amount)}`;
            document.getElementById('pay-sum-net').textContent = `PKR ${Utils.formatPKR(amount)}`;
            return;
        }
        const module = this.config(this.activeType).module;
        return direct ? module.calculateDirectTotals() : module.calculateModalTotals();
    },
    async availableAdvance(type, name, excludePaymentId = null, untilDate = null) {
        if (type === 'farmer') return Utils.getFarmerAvailableAdvance(name, { excludePaymentId, untilDate, season: null });
        const normalized = name.trim().toLowerCase();
        const openings = (await DB.getAll('opening_balances')).filter(o => !untilDate || o.date <= untilDate);
        const payments = (await DB.getAll('sale_payments')).filter(p => !untilDate || p.date <= untilDate);
        return Math.max(0, openings.filter(o => o.type === 'buyer_advance' && (o.partyName || '').trim().toLowerCase() === normalized).reduce((s, o) => s + (o.amount || 0), 0)
            - payments.filter(p => p.id !== excludePaymentId && (p.buyerName || '').trim().toLowerCase() === normalized).reduce((s, p) => s + (p.advanceDeducted || 0), 0));
    },
    allocations(payment, config) {
        return payment.allocations || (payment[config.link] && payment[config.link] !== 'General' ? [{ invoiceId: payment[config.link], amount: payment.amount || 0 }] : []);
    },
    total(invoice, type) { return type === 'farmer' ? Utils.purchasePayableAmount(invoice) : (invoice.amount || 0); },
    async reversalOps(type, payment) {
        const c = this.config(type), ops = [];
        if (!payment.allocations && /General .*payment|General .*receipt/i.test(payment.notes || '')) throw new Error('This legacy general payment has no invoice allocations. Reconcile its allocations before changing it.');
        if (payment.advanceCreatedId) {
            const advance = await DB.get('farmer_advances', payment.advanceCreatedId);
            const available = await Utils.getFarmerAvailableAdvance(payment.farmerName);
            if (advance && available + 0.01 < advance.amount) throw new Error('This excess advance has been used. Reverse its applications before editing or deleting this payment.');
            if (advance) ops.push({ storeName: 'farmer_advances', action: 'delete', key: advance.id, softDelete: true, data: advance });
        }
        for (const allocation of this.allocations(payment, c)) {
            const invoice = await DB.get(c.invoices, allocation.invoiceId);
            if (!invoice) throw new Error('A payment invoice is missing; reconcile this payment before changing it.');
            if ((invoice[c.paid] || 0) + 0.01 < allocation.amount) throw new Error('Invoice payments disagree with the allocation history. Reconcile this invoice before changing its payment.');
            invoice[c.paid] = Utils.roundCurrency(Math.max(0, (invoice[c.paid] || 0) - allocation.amount));
            this.updateStatus(invoice, type);
            ops.push({ storeName: c.invoices, action: 'put', data: invoice });
        }
        const transactions = await DB.getAll('capital_transactions');
        transactions.filter(t => Utils.isLinkedCapitalTx(t, c.payments, payment.id, payment.capitalTxId)).forEach(t => ops.push({ storeName: 'capital_transactions', action: 'delete', key: t.id, softDelete: true, data: t }));
        return ops;
    },
    updateStatus(invoice, type) {
        const c = this.config(type), total = this.total(invoice, type);
        invoice.balance = Utils.roundCurrency(total - (invoice[c.paid] || 0));
        invoice.paymentStatus = invoice.balance <= 0.01 ? 'paid' : invoice[c.paid] > 0 ? 'partial' : 'pending';
    },
    async save(type, input) {
        for (let attempt = 0; attempt < 3; attempt++) {
            try { return await this.saveAttempt(type, input); }
            catch (error) { if (error.code !== 'CONFLICT' || attempt === 2) throw error; }
        }
    },
    async saveAttempt(type, input) {
        const snapshot = await DB.financialSnapshot();
        const c = this.config(type);
        const amount = Utils.roundCurrency(Utils.pf(input.amount)), advance = Utils.roundCurrency(Utils.pf(input.advance));
        if (!input.name || !input.date) throw new Error('Party and date are required');
        if (!Number.isFinite(amount) || amount <= 0 || advance < 0 || advance > amount) throw new Error('Enter a positive payment and a valid advance adjustment');
        const old = input.paymentId ? await DB.get(c.payments, input.paymentId) : null;
        if (input.paymentId && !old) throw new Error('Payment no longer exists');
        let available = await this.availableAdvance(type, input.name, old?.id, input.date);
        if (type === 'farmer' && old?.advanceCreatedId) available = await Utils.getFarmerAvailableAdvance(input.name, { excludePaymentId: old.id, excludeAdvanceId: old.advanceCreatedId, untilDate: input.date, season: null });
        if (advance > available + 0.01) throw new Error('Advance adjustment exceeds available balance');
        const cash = Utils.roundCurrency(amount - advance);
        if (cash > 0 && !input.accountId) throw new Error('Select a cash/bank account for the cash portion');
        const ops = old ? await this.reversalOps(type, old) : [];
        const invoices = await DB.getAll(c.invoices);
        // Apply the reversal to this working copy before re-allocating an edit.
        for (const op of ops.filter(o => o.storeName === c.invoices)) {
            const index = invoices.findIndex(i => i.id === op.data.id);
            invoices[index] = op.data;
        }
        const candidates = invoices.filter(i => (i[c.party] || '').trim().toLowerCase() === input.name.trim().toLowerCase()
            && i.type !== 'opening_balance' && (!input.invoiceId || i.id === input.invoiceId) && i.date <= input.date)
            .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
        let remaining = amount;
        const allocations = [];
        for (const invoice of candidates) {
            const allocated = Utils.roundCurrency(Math.min(remaining, Math.max(0, this.total(invoice, type) - (invoice[c.paid] || 0))));
            if (allocated <= 0) continue;
            invoice[c.paid] = Utils.roundCurrency((invoice[c.paid] || 0) + allocated);
            this.updateStatus(invoice, type);
            allocations.push({ invoiceId: invoice.id, amount: allocated });
            ops.push({ storeName: c.invoices, action: 'put', data: invoice });
            remaining = Utils.roundCurrency(remaining - allocated);
        }
        if (type === 'buyer' && remaining > 0.01) throw new Error('Receipt exceeds pending invoices. Record a buyer deposit separately.');
        const invoiceAmount = Utils.roundCurrency(amount - remaining);
        if (advance > invoiceAmount + 0.01) throw new Error('Advance adjustment cannot exceed the invoice allocation');
        const payment = {
            id: old?.id || Utils.generateId(), receiptNo: input.receiptNo || old?.receiptNo || await Utils.getNextReceiptId('payment'),
            [c.link]: input.invoiceId || 'General', [c.party]: input.name, allocations,
            amount: invoiceAmount, totalPaidCash: amount, excessAdvance: remaining,
            advanceDeducted: advance, netCashAmount: cash, date: input.date,
            mode: input.mode || 'cash', reference: input.reference || '', notes: input.notes || '', accountId: input.accountId || '',
            createdAt: old?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString(),
            previousBalance: candidates.reduce((s, i) => s + Math.max(0, this.total(i, type) - (i[c.paid] || 0)), 0) + invoiceAmount,
            newBalance: candidates.reduce((s, i) => s + Math.max(0, this.total(i, type) - (i[c.paid] || 0)), 0), capitalTxId: null
        };
        if (remaining > 0) {
            payment.advanceCreatedId = Utils.generateId();
            ops.push({ storeName: 'farmer_advances', action: 'put', data: { id: payment.advanceCreatedId, farmerName: input.name, amount: remaining, date: input.date, sourceStore: c.payments, sourceId: payment.id, accountId: input.accountId, createdAt: payment.createdAt } });
        }
        if (cash > 0) {
            payment.capitalTxId = Utils.generateId();
            ops.push({ storeName: 'capital_transactions', action: 'put', data: { id: payment.capitalTxId, accountId: input.accountId, type: type === 'farmer' ? 'withdrawal' : 'deposit', amount: cash, date: input.date,
                sourceStore: c.payments, sourceId: payment.id, description: `Payment ${payment.receiptNo}: ${input.name}`, isReconciled: false, createdAt: payment.createdAt } });
        }
        ops.push({ storeName: c.payments, action: 'put', data: payment });
        await Utils.validateAdvanceHistory(ops);
        await DB.commitUnitOfWork(ops, snapshot);
        await CoreServices.runMaterializedViewMigrations();
        await Utils.audit(old ? 'update' : 'create', c.payments, payment.id, { newAmount: amount });
        return payment;
    },
    async remove(type, id) {
        const snapshot = await DB.financialSnapshot();
        const c = this.config(type), payment = await DB.get(c.payments, id);
        if (!payment || !await Utils.confirm('Delete this payment and reverse all its invoice allocations and cash movement?')) return;
        try {
            const ops = await this.reversalOps(type, payment);
            ops.push({ storeName: c.payments, action: 'delete', key: id, softDelete: true, data: payment });
            await Utils.validateAdvanceHistory(ops);
            await DB.commitUnitOfWork(ops, snapshot);
            await CoreServices.runMaterializedViewMigrations();
            await c.module.render();
            Utils.showToast('Payment reversed');
        } catch (e) { Utils.showToast(e.message, 'error'); }
    },
    async submit(type, prefix, options = {}, print = false) {
        if (this.busy) return;
        this.busy = true;
        const get = suffix => document.getElementById(`${prefix}-${suffix}`).value;
        try {
            const payment = await this.save(type, { ...options, name: options.name || get('party-name'), amount: get('amount'), advance: get(prefix === 'dpay' ? 'deduct-adv' : 'deduct-advance'), date: get('date'),
                receiptNo: get('receipt-id'), accountId: get('account'), mode: get('mode'), reference: get('ref'), notes: prefix === 'pay' ? get('notes') : '' });
            Utils.hideModal(prefix === 'dpay' ? 'direct-pay-modal' : 'payment-modal');
            await this.config(type).module.render();
            Utils.showToast('Payment saved');
            if (print) await ReceiptPDF.generatePaymentVoucher(payment, {}, type);
        } catch (e) { Utils.showToast(e.message, 'error'); }
        finally { this.busy = false; }
    },
    async openInvoice(type, invoiceId, paymentId = null) {
        this.activate(type);
        this.openingSettlement = false;
        document.getElementById('pay-advance-box').style.display = 'none';
        document.getElementById('pay-deduct-advance').value = '0';
        const c = this.config(type), payment = paymentId ? await DB.get(c.payments, paymentId) : null;
        if (payment && (payment[c.link] === 'General' || (payment.allocations || []).length > 1)) {
            await c.module.showDirectPaymentModal();
            document.getElementById('dpay-party-name').value = payment[c.party];
            document.getElementById('dpay-amount').value = payment.totalPaidCash ?? payment.amount;
            document.getElementById('dpay-deduct-adv').value = payment.advanceDeducted || 0;
            for (const field of ['date', 'mode', 'account', 'ref', 'receipt-id']) document.getElementById(`dpay-${field}`).value = ({ ref: payment.reference, 'receipt-id': payment.receiptNo, account: payment.accountId })[field] ?? payment[field] ?? '';
            document.getElementById('dpay-save-btn').onclick = () => this.submit(type, 'dpay', { paymentId });
            return;
        }
        const invoice = await DB.get(c.invoices, invoiceId || payment?.[c.link]);
        if (!invoice) return;
        const available = await this.availableAdvance(type, invoice[c.party], paymentId);
        c.module.currentOpenAdvance = available;
        const actionLabel = type === 'farmer' ? 'payment' : 'receipt';
        document.getElementById('pay-modal-title').textContent = `${payment ? 'Edit' : 'Record'} ${actionLabel}: ${invoice[c.party]} (${invoice.id})`;
        document.getElementById('pay-amount-label').textContent = type === 'farmer' ? 'Total Payment Amount' : 'Total Receipt Amount';
        document.getElementById('pay-sum-total-label').textContent = type === 'farmer' ? 'Total Payment Amount' : 'Total Receipt Amount';
        document.getElementById('pay-sum-net-label').textContent = type === 'farmer' ? 'Net Cash/Bank Payout' : 'Net Cash/Bank Receipt';
        document.getElementById('pay-save-btn').textContent = type === 'farmer' ? 'Record Payment' : 'Record Receipt';
        document.getElementById('pay-receipt-id').value = payment?.receiptNo || await Utils.getNextReceiptId('payment');
        document.getElementById('pay-amount').value = payment ? (payment.totalPaidCash ?? payment.amount) : Math.max(0, this.total(invoice, type) - (invoice[c.paid] || 0));
        document.getElementById('pay-date').value = payment?.date || Utils.todayISO();
        document.getElementById('pay-mode').value = payment?.mode || 'cash';
        document.getElementById('pay-ref').value = payment?.reference || '';
        document.getElementById('pay-notes').value = payment?.notes || '';
        await Utils.populateCapitalAccountSelect('pay-account', 'Select cash/bank account');
        document.getElementById('pay-account').value = payment?.accountId || '';
        document.getElementById('pay-advance-box').style.display = available > 0 ? 'block' : 'none';
        document.getElementById('pay-avail-advance').textContent = `PKR ${Utils.formatPKR(available)}`;
        document.getElementById('pay-deduct-advance').value = payment?.advanceDeducted || Math.min(available, Utils.pf(document.getElementById('pay-amount').value));
        document.getElementById('pay-deduct-advance').max = available;
        c.module.calculateModalTotals();
        const options = { invoiceId: invoice.id, name: invoice[c.party], paymentId };
        document.getElementById('pay-save-btn').onclick = () => this.submit(type, 'pay', options);
        document.getElementById('pay-save-print-btn').onclick = () => this.submit(type, 'pay', options, true);
        Utils.showModal('payment-modal');
    }
};
