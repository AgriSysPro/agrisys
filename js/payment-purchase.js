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
            const amt = (p.netPayableAmount ?? p.amount ?? 0);
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

        const totalPayable = purchases.reduce((s, p) => s + ((p.netPayableAmount ?? p.amount ?? 0)), 0);
        const totalPaid = payments.reduce((s, p) => s + (p.amount || 0), 0);
        const outstanding = purchases.reduce((s, p) => s + Math.max(0, ((p.netPayableAmount ?? p.amount ?? 0)) - (p.amountPaid || 0)), 0);
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
            <td class="text-right font-bold">PKR ${Utils.formatPKR(p.totalPaidCash || ((p.amount || 0) + (p.excessAdvance || 0)))}${p.excessAdvance ? ` <span style="color:var(--accent-warning);font-size:11px;display:block;">(+ PKR ${Utils.formatPKR(p.excessAdvance)} Adv)</span>` : ''}</td>
            <td>${Utils.escapeHTML(accountMap[p.accountId] || '-')}</td>
            <td><div class="table-actions">
                <button class="btn btn-icon btn-ghost btn-sm" onclick="PurchasePayments.shareWhatsApp('${p.id}')" title="Share via WhatsApp">📱</button>
                <button class="btn btn-icon btn-ghost btn-sm" onclick="PurchasePayments.printPayment('${p.id}')" title="Print PDF Voucher">📄</button>
                <button class="btn btn-icon btn-ghost btn-sm" onclick="PurchasePayments.editPayment('${p.id}')" title="Edit">✏️</button>
                <button class="btn btn-icon btn-danger btn-sm" onclick="PurchasePayments.deletePayment('${p.id}')" title="Delete" aria-label="Delete farmer payment">×</button>
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

    async getFarmerAvailableAdvance(farmerName, excludePaymentId = null) {
        return await Utils.getFarmerAvailableAdvance(farmerName, { excludePaymentId });
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

    async recordPayment(invoiceId) { return PaymentService.openInvoice('farmer', invoiceId); },

    async showDirectPaymentModal() {
        PaymentService.activate('farmer');
        PaymentService.openingSettlement = false;
        document.getElementById('dpay-title').textContent = 'General Farmer Payment / Advance Settlement';
        document.getElementById('dpay-amount-label').innerHTML = 'Payment Amount (PKR) <span class="required">*</span>';
        document.getElementById('dpay-save-btn').textContent = 'Record Payment';
        document.getElementById('dpay-amount-label').textContent = 'Payment Amount (PKR)';
        document.getElementById('dpay-save-btn').textContent = 'Record Payment';
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

        const totalPending = purchases.reduce((s, p) => s + Math.max(0, ((p.netPayableAmount ?? p.amount ?? 0)) - (p.amountPaid || 0)), 0);
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

    async saveDirectPayment() { return PaymentService.submit('farmer', 'dpay'); },

    async editPayment(paymentId) { return PaymentService.openInvoice('farmer', null, paymentId); },

    async deletePayment(paymentId) { return PaymentService.remove('farmer', paymentId); },

    async printPayment(paymentId) {
        const payment = await DB.get('purchase_payments', paymentId);
        if (!payment) return;
        const p = await DB.get('purchases', payment.purchaseId);
        await ReceiptPDF.generatePaymentVoucher(payment, p || {}, 'farmer');
    },

    async exportExcel() {
        if (!Utils.requireExcel()) return;
        const activeSeason = await Utils.getActiveSeason();
        const purchases = Utils.filterBySeason(await DB.getAll('purchases'), activeSeason);
        if (!purchases.length) { Utils.showToast('No data to export', 'warning'); return; }
        
        const rows = purchases.sort((a,b) => new Date(b.date)-new Date(a.date)).map(p => {
            const amt = (p.netPayableAmount ?? p.amount ?? 0);
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
