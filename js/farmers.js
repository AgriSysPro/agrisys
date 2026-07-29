// ===== Farmers Module =====
const Farmers = {
    async init() {},

    async ensureFarmer(name) {
        if (!name) return;
        const all = await DB.getAll('farmers');
        const exists = all.find(f => f.name.toLowerCase() === name.toLowerCase());
        if (!exists) {
            await DB.put('farmers', { id: Utils.generateId(), name, phone: '', address: '', notes: '', createdAt: new Date().toISOString() });
        }
    },

    async render() {
        const farmers = await DB.getAll('farmers');
        const activeSeason = await Utils.getActiveSeason();
        const untilDate = activeSeason ? activeSeason.endDate : null;

        const allPurchases = await DB.getAll('purchases');
        const purchases = untilDate ? allPurchases.filter(p => p.date <= untilDate) : allPurchases;

        const allPurchasePayments = await DB.getAll('purchase_payments');
        const purchasePayments = untilDate ? allPurchasePayments.filter(p => p.date <= untilDate) : allPurchasePayments;

        const allAdvances = await DB.getAll('farmer_advances');
        const advances = untilDate ? allAdvances.filter(a => a.date <= untilDate) : allAdvances;

        const allOpenings = await DB.getAll('opening_balances');
        const openings = untilDate ? allOpenings.filter(o => o.date <= untilDate) : allOpenings;

        const search = (document.getElementById('f-search').value || '').toLowerCase();
        const filtered = farmers.filter(f => !search || f.name.toLowerCase().includes(search) || (f.phone || '').includes(search));

        const tbody = document.getElementById('farmers-tbody');
        const empty = document.getElementById('farmers-empty');

        if (filtered.length === 0) { tbody.innerHTML = ''; empty.style.display = ''; return; }
        empty.style.display = 'none';

        tbody.innerHTML = filtered.map(f => {
            const fp = purchases.filter(p => p.farmerName && p.farmerName.toLowerCase() === f.name.toLowerCase());
            const openingPayable = openings.filter(o => o.type === 'farmer_payable' && (o.partyName || '').toLowerCase() === f.name.toLowerCase()).reduce((s, o) => s + (o.amount || 0), 0);
            const openingPaid = openings.filter(o => o.type === 'farmer_payable' && (o.partyName || '').toLowerCase() === f.name.toLowerCase()).reduce((s, o) => s + (o.paidAmount || o.settledAmount || 0), 0);
            const openingAdvance = openings.filter(o => o.type === 'farmer_advance' && (o.partyName || '').toLowerCase() === f.name.toLowerCase()).reduce((s, o) => s + (o.amount || 0), 0);
            
            const totalAmt = openingPayable + fp.reduce((s, p) => s + (p.netPayableAmount || p.amount || 0), 0);
            const totalPaid = openingPaid + fp.reduce((s, p) => s + Utils.paymentTotalFor(p, purchasePayments, 'purchaseId', 'amountPaid', untilDate), 0);
            const givenAdv = advances.filter(a => a.farmerName && a.farmerName.toLowerCase() === f.name.toLowerCase()).reduce((s, a) => s + (a.amount || 0), 0);
            const recoveredAdv = fp.reduce((s, p) => s + (p.advanceDeducted || 0), 0);
            const openAdv = Math.max(0, openingAdvance + givenAdv - recoveredAdv);
            const balance = totalAmt - totalPaid;
            return `<tr>
                <td class="font-bold">${Utils.highlightText(f.name, search)}</td>
                <td>${Utils.highlightText(f.phone || '-', search)}</td>
                <td class="text-center">${fp.length}</td>
                <td class="text-right">PKR ${Utils.formatPKR(totalAmt)}</td>
                <td class="text-right">PKR ${Utils.formatPKR(totalPaid)}</td>
                <td class="text-right font-bold" style="color:${openAdv > 0 ? 'var(--accent-warning)' : 'inherit'}">PKR ${Utils.formatPKR(openAdv)}</td>
                <td class="text-right font-bold" style="color:${balance > 0 ? 'var(--accent-danger)' : 'var(--accent-success)'}">PKR ${Utils.formatPKR(balance)}</td>
                <td><div class="table-actions">
                    <button class="btn btn-icon btn-ghost btn-sm" onclick="Farmers.showLedgerOptions('${Utils.escapeHTML(f.id)}')" title="Ledger Options">📊</button>
                    <button class="btn btn-icon btn-ghost btn-sm" onclick="Farmers.edit('${Utils.escapeHTML(f.id)}')" title="Edit">✏️</button>
                    <button class="btn btn-icon btn-danger btn-sm" onclick="Farmers.delete('${Utils.escapeHTML(f.id)}')" title="Delete">🗑️</button>
                </div></td>
            </tr>`;
        }).join('');
    },

    showAddModal() {
        document.getElementById('fm-name').value = '';
        document.getElementById('fm-phone').value = '';
        document.getElementById('fm-address').value = '';
        document.getElementById('fm-notes').value = '';
        document.getElementById('fm-name').dataset.editId = '';
        Utils.showModal('farmer-modal');
    },

    async edit(id) {
        const f = await DB.get('farmers', id);
        if (!f) return;
        document.getElementById('fm-name').value = f.name;
        document.getElementById('fm-phone').value = f.phone || '';
        document.getElementById('fm-address').value = f.address || '';
        document.getElementById('fm-notes').value = f.notes || '';
        document.getElementById('fm-name').dataset.editId = id;
        Utils.showModal('farmer-modal');
    },

    async save() {
        const name = document.getElementById('fm-name').value.trim();
        if (!name) { Utils.showToast('Name is required', 'error'); return; }
        const editId = document.getElementById('fm-name').dataset.editId;
        const data = {
            id: editId || Utils.generateId(),
            name,
            phone: document.getElementById('fm-phone').value.trim(),
            address: document.getElementById('fm-address').value.trim(),
            notes: document.getElementById('fm-notes').value.trim(),
            createdAt: new Date().toISOString()
        };
        await DB.put('farmers', data);
        Utils.hideModal('farmer-modal');
        Utils.showToast('Farmer saved!');
        this.render();
        Purchasing.loadFarmerDatalist();
    },

    async showAdvanceModal() {
        document.getElementById('adv-farmer').value = '';
        document.getElementById('adv-date').value = Utils.todayISO();
        document.getElementById('adv-amount').value = '';
        document.getElementById('adv-notes').value = '';
        await this.loadAdvanceAccounts();
        await this.loadAdvanceDatalist();
        Utils.showModal('advance-modal');
    },

    async loadAdvanceAccounts() {
        await Utils.populateCapitalAccountSelect('adv-account', 'Select cash/bank account');
    },

    async loadAdvanceDatalist() {
        const farmers = await DB.getAll('farmers');
        document.getElementById('adv-farmer-datalist').innerHTML = farmers.map(f => `<option value="${Utils.escapeHTML(f.name)}">`).join('');
    },

    async saveAdvance() {
        const farmerName = document.getElementById('adv-farmer').value.trim();
        const amount = Utils.pf(document.getElementById('adv-amount').value);
        const accountId = document.getElementById('adv-account').value;
        const date = document.getElementById('adv-date').value;
        const notes = document.getElementById('adv-notes').value.trim();

        if (!farmerName) { Utils.showToast('Select a farmer', 'error'); return; }
        if (amount <= 0) { Utils.showToast('Enter a valid amount', 'error'); return; }
        if (!accountId) { Utils.showToast('Select cash/bank account for this advance', 'error'); return; }

        await this.ensureFarmer(farmerName);

        // Save advance
        const advId = Utils.generateId();
        await DB.put('farmer_advances', {
            id: advId, farmerName, amount, date, notes, createdAt: new Date().toISOString()
        });

        const tx = await Utils.createLinkedCapitalTx({
            accountId,
            type: 'withdrawal',
            amount,
            date,
            description: `Advance paid to ${farmerName}` + (notes ? ` - ${notes}` : ''),
            sourceStore: 'farmer_advances',
            sourceId: advId
        });
        if (tx) {
            const adv = await DB.get('farmer_advances', advId);
            adv.capitalTxId = tx.id;
            adv.accountId = accountId;
            await DB.put('farmer_advances', adv);
        }
        await Utils.audit('create', 'farmer_advance', advId, {
            farmerName,
            amount,
            accountId: accountId || null,
            capitalTxId: tx ? tx.id : null
        });

        Utils.hideModal('advance-modal');
        Utils.showToast('Advance recorded successfully!');
        this.render();
    },

    async delete(id) {
        const farmer = await DB.get('farmers', id);
        if (!farmer) return;

        // Check for associated purchases
        const purchases = await DB.getAll('purchases');
        const linked = purchases.filter(p => p.farmerName.toLowerCase() === farmer.name.toLowerCase());

        let msg = 'Delete this farmer?';
        if (linked.length > 0) {
            msg = `This farmer has ${linked.length} linked purchase(s). Only the farmer record will be deleted — purchases will be preserved. Continue?`;
        }

        if (!await Utils.confirm(msg)) return;
        await DB.delete('farmers', id);
        Utils.showToast('Farmer deleted!');
        this.render();
    },

    async exportExcel() {
        if (!Utils.requireExcel()) return;
        const farmers = await DB.getAll('farmers');
        const activeSeason = await Utils.getActiveSeason();
        const purchases = Utils.filterBySeason(await DB.getAll('purchases'), activeSeason);
        const advances = Utils.filterBySeason(await DB.getAll('farmer_advances'), activeSeason);
        const openings = Utils.filterBySeason(await DB.getAll('opening_balances'), activeSeason);
        if (!farmers.length) { Utils.showToast('No data to export', 'warning'); return; }
        
        const rows = farmers.sort((a,b) => a.name.localeCompare(b.name)).map(f => {
            const fp = purchases.filter(p => p.farmerName.toLowerCase() === f.name.toLowerCase());
            const openingPayable = openings.filter(o => o.type === 'farmer_payable' && (o.partyName || '').toLowerCase() === f.name.toLowerCase()).reduce((s, o) => s + (o.amount || 0), 0);
            const openingPaid = openings.filter(o => o.type === 'farmer_payable' && (o.partyName || '').toLowerCase() === f.name.toLowerCase()).reduce((s, o) => s + (o.paidAmount || o.settledAmount || 0), 0);
            const openingAdvance = openings.filter(o => o.type === 'farmer_advance' && (o.partyName || '').toLowerCase() === f.name.toLowerCase()).reduce((s, o) => s + (o.amount || 0), 0);
            const totalAmt = openingPayable + fp.reduce((s, p) => s + (p.netPayableAmount || p.amount || 0), 0);
            const totalPaid = openingPaid + fp.reduce((s, p) => s + (p.amountPaid || 0), 0);
            const openAdv = openingAdvance + advances.filter(a => a.farmerName.toLowerCase() === f.name.toLowerCase()).reduce((s, a) => s + a.amount, 0);
            return {
                'Name': f.name,
                'Phone': f.phone || '',
                'Total Purchases': fp.length,
                'Total Amount': totalAmt,
                'Total Paid': totalPaid,
                'Open Advances': openAdv,
                'Balance': totalAmt - totalPaid
            };
        });
        const ws = XLSX.utils.json_to_sheet(rows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Farmers');
        XLSX.writeFile(wb, `Farmers_${Utils.todayISO()}.xlsx`);
        Utils.showToast('Excel exported!');
    },

    showLedgerOptions(farmerId) {
        document.getElementById('ledger-filter-title').textContent = 'Farmer Ledger Options';
        document.getElementById('ledger-from').value = '';
        document.getElementById('ledger-to').value = '';
        document.getElementById('ledger-include-opening').checked = true;
        const options = () => ({
            from: document.getElementById('ledger-from').value,
            to: document.getElementById('ledger-to').value,
            includeOpening: document.getElementById('ledger-include-opening').checked
        });
        document.getElementById('ledger-filter-excel').onclick = async () => { Utils.hideModal('ledger-filter-modal'); await Farmers.exportLedgerExcel(farmerId, options()); };
        document.getElementById('ledger-filter-pdf').onclick = async () => { Utils.hideModal('ledger-filter-modal'); await ReceiptPDF.generateFarmerLedger(farmerId, options()); };
        Utils.showModal('ledger-filter-modal');
    },

    async exportLedgerExcel(farmerId, options = {}) {
        if (!Utils.requireExcel()) return;
        const farmer = await DB.get('farmers', farmerId);
        if (!farmer) return;
        const ledger = await Utils.buildFarmerLedger(farmer, options);
        if (!ledger.rows.length) { Utils.showToast('No ledger transactions to export', 'warning'); return; }

        const wb = XLSX.utils.book_new();
        const summary = [
            { Field: 'Account Type', Value: 'Farmer Ledger' },
            { Field: 'Farmer Name', Value: farmer.name },
            { Field: 'Phone', Value: farmer.phone || '' },
            { Field: 'Statement Date', Value: Utils.formatDate(Utils.todayISO()) },
            { Field: 'Period', Value: `${options.from ? Utils.formatDate(options.from) : 'Start'} to ${options.to ? Utils.formatDate(options.to) : 'Today'}` },
            { Field: 'Opening Included', Value: options.includeOpening === false ? 'No' : 'Yes' },
            { Field: 'Purchase Entries', Value: ledger.counts.purchases },
            { Field: 'Payment Entries', Value: ledger.counts.payments },
            { Field: 'Total Payable (PKR)', Value: ledger.totals.credit },
            { Field: 'Total Paid (PKR)', Value: ledger.totals.debit },
            { Field: 'Outstanding Payable (PKR)', Value: ledger.totals.balance },
            { Field: 'Open Advances Memo (PKR)', Value: ledger.totals.openAdvances || 0 }
        ];
        const summaryWs = XLSX.utils.json_to_sheet(summary);
        summaryWs['!cols'] = [{ wch: 28 }, { wch: 36 }];

        const rows = ledger.rows.map(r => ({
            'Date': r.date,
            'Reference': r.ref,
            'Type': r.type,
            'Description': r.description,
            'Debit / Paid (PKR)': r.debit || '',
            'Credit / Payable (PKR)': r.credit || '',
            'Running Balance (PKR)': r.balance
        }));
        rows.push({
            'Date': '',
            'Reference': '',
            'Type': 'TOTALS',
            'Description': 'Closing Balance',
            'Debit / Paid (PKR)': ledger.totals.debit,
            'Credit / Payable (PKR)': ledger.totals.credit,
            'Running Balance (PKR)': ledger.totals.balance
        });
        const ws = XLSX.utils.json_to_sheet(rows);
        ws['!cols'] = [{ wch: 14 }, { wch: 18 }, { wch: 18 }, { wch: 46 }, { wch: 18 }, { wch: 22 }, { wch: 22 }];
        XLSX.utils.book_append_sheet(wb, summaryWs, 'Summary');
        XLSX.utils.book_append_sheet(wb, ws, 'Ledger');
        XLSX.writeFile(wb, `${farmer.name.replace(/\\s+/g, '_')}_Ledger_${Utils.todayISO()}.xlsx`);
        Utils.showToast('Farmer ledger exported!');
    }
};
