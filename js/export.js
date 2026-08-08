// ===== Export Utilities =====
const ExportUtils = {
    downloadJSON(data, filename) {
        // Calculate simple integrity checksum signature
        const copy = { ...data };
        delete copy._signature;
        const str = JSON.stringify(copy);
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) - hash) + str.charCodeAt(i);
            hash |= 0;
        }
        data._signature = 'AGRISYS-SIG-' + Math.abs(hash).toString(16).toUpperCase();

        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename; a.click();
        URL.revokeObjectURL(url);
    },

    async allToExcel() {
        if (!Utils.requireExcel()) return;
        Utils.showLoading('Creating full Excel backup...');
        const activeSeason = await Utils.getActiveSeason();
        const purchases = Utils.filterBySeason(await DB.getAll('purchases'), activeSeason);
        const sales = Utils.filterBySeason(await DB.getAll('sales'), activeSeason);
        const expenses = Utils.filterBySeason(await DB.getAll('expenses'), activeSeason);
        const openingBalances = Utils.filterBySeason(await DB.getAll('opening_balances'), activeSeason);
        const openingPayments = Utils.filterBySeason(await DB.getAll('opening_balance_payments'), activeSeason);
        const farmers = await DB.getAll('farmers');
        const buyers = await DB.getAll('buyers');

        const wb = XLSX.utils.book_new();

        if (purchases.length) {
            const ps = purchases.map(p => ({
                ID: p.id, Date: p.date, Farmer: p.farmerName, Crop: p.crop,
                'Gross (KG)': p.grossWeight, 'Net (KG)': p.netWeight, 'Rate/Mn': p.rate,
                Amount: p.amount, 'Net Payable': p.netPayableAmount, Paid: p.amountPaid,
                Balance: p.balance, Status: p.paymentStatus
            }));
            XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(ps), 'Purchases');
        }

        if (sales.length) {
            const ss = sales.map(s => ({
                ID: s.id, Date: s.date, Buyer: s.buyerName, Crop: s.crop,
                'Gross (KG)': s.grossWeight, 'Net (KG)': s.netWeight, 'Rate/Mn': s.rate,
                Amount: s.amount, Received: s.amountReceived, Balance: s.balance, Status: s.paymentStatus
            }));
            XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(ss), 'Sales');
        }

        if (expenses.length) {
            const es = expenses.map(e => ({
                ID: e.id, Date: e.date, Type: e.type, Description: e.description,
                Crop: e.crop, 'Linked Receipt': e.purchaseId, Amount: e.amount
            }));
            XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(es), 'Expenses');
        }

        if (openingBalances.length) {
            const obs = openingBalances.map(o => ({
                ID: o.id, Date: o.date, Type: o.type, Party: o.partyName, Crop: o.crop,
                Amount: o.amount, Settled: o.paidAmount || o.receivedAmount || o.settledAmount || 0,
                Balance: Math.max(0, (o.amount || 0) - (o.paidAmount || o.receivedAmount || o.settledAmount || 0)),
                Status: o.settlementStatus || 'pending'
            }));
            XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(obs), 'Opening Balances');
        }

        if (openingPayments.length) {
            const ops = openingPayments.map(p => ({
                ID: p.id, 'Receipt No': p.receiptNo, Date: p.date, Type: p.type, Party: p.partyName,
                Amount: p.amount, Mode: p.mode, Reference: p.reference, 'Opening Balance ID': p.openingBalanceId
            }));
            XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(ops), 'Opening Payments');
        }

        if (farmers.length) {
            const fs = farmers.map(f => ({ Name: f.name, Phone: f.phone, Address: f.address }));
            XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(fs), 'Farmers');
        }

        if (buyers.length) {
            const bs = buyers.map(b => ({ Name: b.name, Phone: b.phone, Address: b.address }));
            XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(bs), 'Buyers');
        }

        const debts = Utils.filterBySeason(await DB.getAll('company_debts') || [], activeSeason);
        if (debts.length) {
            const ds = debts.map(d => ({
                ID: d.id, Date: d.date, Party: d.personName, Type: d.type === 'given' ? 'Loan Issued' : 'Repayment Received',
                Amount: d.amount, Notes: d.notes || ''
            }));
            XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(ds), 'Debts & Loans');
        }

        const accounts = await DB.getAll('capital_accounts') || [];
        if (accounts.length) {
            const as = accounts.map(a => ({
                ID: a.id, Name: a.name, Type: a.type, 'Account Number': a.accountNumber || '',
                'Opening Balance': a.openingBalance || 0, 'Current Balance': a.balance || 0
            }));
            XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(as), 'Bank Accounts');
        }

        const capEntries = Utils.filterBySeason(await DB.getAll('capital_entries') || [], activeSeason);
        if (capEntries.length) {
            const cs = capEntries.map(e => ({
                ID: e.id, Date: e.date, Type: e.type, Amount: e.amount, Description: e.description || ''
            }));
            XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(cs), 'Owner Capital');
        }

        XLSX.writeFile(wb, `AgriSys_Full_${Utils.todayISO()}.xlsx`);
        Utils.hideLoading();
        Utils.showToast('Full export complete!');
    }
};
