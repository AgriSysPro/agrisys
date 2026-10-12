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
        try {
            const data = await DB.exportAll();
            const wb = XLSX.utils.book_new();
            const labels = {
                settings: 'Settings', purchases: 'Purchases', farmers: 'Farmers', purchase_payments: 'Purchase Payments',
                sales: 'Sales', sale_payments: 'Sale Payments', expenses: 'Expenses', capital_accounts: 'Bank Accounts',
                capital_transactions: 'Cash Bank Transactions', capital_entries: 'Owner Capital', company_debts: 'Debts Loans',
                partners: 'Partners', partner_transactions: 'Partner Transactions', buyers: 'Buyers', farmer_advances: 'Farmer Advances',
                deductions: 'Deductions', journal_entries: 'Journal Entries', seasons: 'Seasons', audit_logs: 'Audit Logs',
                opening_balances: 'Opening Balances', stock_adjustments: 'Stock Adjustments',
                opening_balance_payments: 'Opening Payments', commissions: 'Commissions', retained_earnings: 'Retained Earnings'
            };
            const scrubSecrets = value => {
                if (Array.isArray(value)) return value.map(scrubSecrets);
                if (!value || typeof value !== 'object') return value;
                return Object.fromEntries(Object.entries(value).map(([key, item]) =>
                    [key, /passphrase|password|secret|token/i.test(key) ? '[omitted from spreadsheet]' : scrubSecrets(item)]
                ));
            };
            const flatten = record => Object.fromEntries(Object.entries(record).map(([key, value]) => {
                if (/image|signaturedata/i.test(key) && typeof value === 'string' && value.length > 1000) return [`${key}Attached`, true];
                if (value && typeof value === 'object') return [key, JSON.stringify(value)];
                return [key, value];
            }));
            const transactions = data.capital_transactions || [];
            for (const [store, sheetName] of Object.entries(labels)) {
                let rows = Array.isArray(data[store]) ? data[store] : [];
                if (store === 'settings') rows = scrubSecrets(rows);
                if (store === 'capital_accounts') {
                    rows = rows.map(account => ({
                        ...account,
                        openingBalance: account.openingBalance || 0,
                        currentBalance: Utils.capitalAccountBalance(account, transactions)
                    }));
                }
                XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.map(flatten)), sheetName);
            }
            XLSX.writeFile(wb, `AgriSys_Full_${Utils.todayISO()}.xlsx`);
            Utils.showToast('Full historical data export complete!');
        } catch (error) {
            Utils.showToast('Excel export failed: ' + error.message, 'error');
        } finally {
            Utils.hideLoading();
        }
    }
};
