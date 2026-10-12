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
                <button class="btn btn-icon btn-danger btn-sm" onclick="SalePayments.deletePayment('${p.id}')" title="Delete" aria-label="Delete buyer receipt">×</button>
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

    async getBuyerAvailableDeposit(name) { return PaymentService.availableAdvance('buyer', name); },

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

    async recordPayment(invoiceId) { return PaymentService.openInvoice('buyer', invoiceId); },

    async showDirectPaymentModal() {
        PaymentService.activate('buyer');
        PaymentService.openingSettlement = false;
        document.getElementById('dpay-title').textContent = 'General Buyer Receipt / Deposit Settlement';
        document.getElementById('dpay-amount-label').innerHTML = 'Receipt Amount (PKR) <span class="required">*</span>';
        document.getElementById('dpay-save-btn').textContent = 'Record Receipt';
        document.getElementById('dpay-amount-label').textContent = 'Receipt Amount (PKR)';
        document.getElementById('dpay-save-btn').textContent = 'Record Receipt';
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

    async saveDirectPayment() { return PaymentService.submit('buyer', 'dpay'); },

    async editPayment(paymentId) { return PaymentService.openInvoice('buyer', null, paymentId); },

    async deletePayment(paymentId) { return PaymentService.remove('buyer', paymentId); },

    async printPayment(paymentId) {
        const payment = await DB.get('sale_payments', paymentId);
        if (!payment) return;
        const s = await DB.get('sales', payment.saleId);
        await ReceiptPDF.generatePaymentVoucher(payment, s || {}, 'buyer');
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
