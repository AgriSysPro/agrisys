// ===== Bookkeeping Module — Professional Journal Entries =====
const Bookkeeping = {
    async render() {
        const from = document.getElementById('bk-from').value;
        const to = document.getElementById('bk-to').value;

        const entries = await this.generateEntries(from, to);
        const tbody = document.getElementById('bk-tbody');

        // Calculate totals
        const totalDebit = entries.reduce((s, e) => s + (e.debit || 0), 0);
        const totalCredit = entries.reduce((s, e) => s + (e.credit || 0), 0);

        let html = entries.map(e => `<tr>
            <td>${Utils.formatDate(e.date)}</td>
            <td>${Utils.escapeHTML(e.description)}</td>
            <td>${Utils.escapeHTML(e.account)}</td>
            <td class="text-right">${e.debit ? 'PKR ' + Utils.formatPKR(e.debit) : ''}</td>
            <td class="text-right">${e.credit ? 'PKR ' + Utils.formatPKR(e.credit) : ''}</td>
        </tr>`).join('');

        // Add totals row
        if (entries.length > 0) {
            html += `<tr style="border-top:2px solid var(--accent-primary);font-weight:700">
                <td colspan="3" style="text-align:right;padding-right:12px">TOTALS</td>
                <td class="text-right">PKR ${Utils.formatPKR(totalDebit)}</td>
                <td class="text-right">PKR ${Utils.formatPKR(totalCredit)}</td>
            </tr>`;
            // Balance check indicator
            const diff = Math.abs(totalDebit - totalCredit);
            if (diff < 0.01) {
                html += `<tr><td colspan="5" style="text-align:center;color:var(--accent-success);font-size:0.85rem;padding:8px">✓ Books are balanced (Debits = Credits)</td></tr>`;
            } else {
                html += `<tr><td colspan="5" style="text-align:center;color:var(--accent-danger);font-size:0.85rem;padding:8px">⚠ Difference of PKR ${Utils.formatPKR(diff)} — please review entries</td></tr>`;
            }
        }

        tbody.innerHTML = html || '<tr><td colspan="5" class="text-center" style="color:var(--text-muted)">No entries found. Select a date range or use "All Time" preset.</td></tr>';
    },

    async generateEntries(from, to) {
        const activeSeason = await Utils.getActiveSeason();
        const purchases = Utils.filterBySeason(await DB.getAll('purchases'), activeSeason);
        const sales = Utils.filterBySeason(await DB.getAll('sales'), activeSeason);
        const pPayments = Utils.filterBySeason(await DB.getAll('purchase_payments'), activeSeason);
        const sPayments = Utils.filterBySeason(await DB.getAll('sale_payments'), activeSeason);
        const obPayments = Utils.filterBySeason(await DB.getAll('opening_balance_payments'), activeSeason);
        const advances = Utils.filterBySeason(await DB.getAll('farmer_advances'), activeSeason);
        const expenses = Utils.filterBySeason(await DB.getAll('expenses'), activeSeason);
        const openings = Utils.filterBySeason(await DB.getAll('opening_balances'), activeSeason);
        const accounts = await DB.getAll('capital_accounts');
        const capitalTxs = Utils.filterBySeason(await DB.getAll('capital_transactions'), activeSeason);
        let entries = [];

        accounts.forEach(a => {
            const opening = a.openingBalance || 0;
            if (opening > 0) {
                entries.push({ date: a.createdAt ? Utils.dateToISO(new Date(a.createdAt)) : Utils.todayISO(), description: `Opening capital: ${a.name}`, account: 'Cash / Bank', debit: opening, credit: 0, type: 'opening' });
                entries.push({ date: a.createdAt ? Utils.dateToISO(new Date(a.createdAt)) : Utils.todayISO(), description: `Opening capital: ${a.name}`, account: 'Owner Capital', debit: 0, credit: opening, type: 'opening' });
            }
        });

        openings.forEach(o => {
            if (o.type === 'farmer_payable') {
                entries.push({ date: o.date, description: `Opening payable: ${o.partyName}`, account: 'Opening Equity', debit: o.amount, credit: 0, type: 'opening' });
                entries.push({ date: o.date, description: `Opening payable: ${o.partyName}`, account: 'Accounts Payable (Farmer)', debit: 0, credit: o.amount, type: 'opening' });
            } else if (o.type === 'buyer_receivable') {
                entries.push({ date: o.date, description: `Opening receivable: ${o.partyName}`, account: 'Accounts Receivable (Buyer)', debit: o.amount, credit: 0, type: 'opening' });
                entries.push({ date: o.date, description: `Opening receivable: ${o.partyName}`, account: 'Opening Equity', debit: 0, credit: o.amount, type: 'opening' });
            } else if (o.type === 'farmer_advance') {
                entries.push({ date: o.date, description: `Opening farmer advance: ${o.partyName}`, account: 'Advances to Farmers', debit: o.amount, credit: 0, type: 'opening' });
                entries.push({ date: o.date, description: `Opening farmer advance: ${o.partyName}`, account: 'Opening Equity', debit: 0, credit: o.amount, type: 'opening' });
            } else if (o.type === 'buyer_advance') {
                entries.push({ date: o.date, description: `Opening buyer advance: ${o.partyName}`, account: 'Opening Equity', debit: o.amount, credit: 0, type: 'opening' });
                entries.push({ date: o.date, description: `Opening buyer advance: ${o.partyName}`, account: 'Advances from Buyers', debit: 0, credit: o.amount, type: 'opening' });
            } else if (o.type === 'stock') {
                entries.push({ date: o.date, description: `Opening stock: ${o.crop}`, account: 'Inventory / Purchases', debit: o.amount, credit: 0, type: 'opening' });
                entries.push({ date: o.date, description: `Opening stock: ${o.crop}`, account: 'Opening Equity', debit: 0, credit: o.amount, type: 'opening' });
            } else if (o.type === 'capital') {
                entries.push({ date: o.date, description: 'Opening cash / bank balance', account: 'Cash / Bank', debit: o.amount, credit: 0, type: 'opening' });
                entries.push({ date: o.date, description: 'Opening cash / bank balance', account: 'Owner Capital', debit: 0, credit: o.amount, type: 'opening' });
            }
        });

        capitalTxs.filter(t => !t.sourceStore).forEach(t => {
            if (t.type === 'deposit') {
                entries.push({ date: t.date, description: t.description || 'Capital deposit', account: 'Cash / Bank', debit: t.amount, credit: 0, type: 'capital' });
                entries.push({ date: t.date, description: t.description || 'Capital deposit', account: 'Owner Capital', debit: 0, credit: t.amount, type: 'capital' });
            } else {
                entries.push({ date: t.date, description: t.description || 'Capital withdrawal', account: 'Owner Drawings', debit: t.amount, credit: 0, type: 'capital' });
                entries.push({ date: t.date, description: t.description || 'Capital withdrawal', account: 'Cash / Bank', debit: 0, credit: t.amount, type: 'capital' });
            }
        });

        // ── Purchase entries (Double-entry) ──
        purchases.forEach(p => {
            const inventoryCost = Utils.purchaseCostAmount(p);
            const payable = Utils.purchasePayableAmount(p);
            const advanceRecovered = p.advanceDeducted || Math.max(0, inventoryCost - payable);
            entries.push({ date: p.date, description: `Purchase: ${p.farmerName} - ${p.crop} (#${p.id})`, account: 'Inventory / Purchases', debit: inventoryCost, credit: 0, type: 'purchase' });
            if (payable > 0) {
                entries.push({ date: p.date, description: `Purchase payable: ${p.farmerName} - ${p.crop} (#${p.id})`, account: 'Accounts Payable (Farmer)', debit: 0, credit: payable, type: 'purchase' });
            }
            if (advanceRecovered > 0) {
                entries.push({ date: p.date, description: `Advance recovered from purchase #${p.id}`, account: 'Advances to Farmers', debit: 0, credit: advanceRecovered, type: 'advance' });
            }
            const laterPayments = pPayments.filter(pay => pay.purchaseId === p.id).reduce((sum, pay) => sum + (pay.amount || 0), 0);
            const initialPaid = Math.max(0, (p.amountPaid || 0) - laterPayments);
            if (initialPaid > 0) {
                entries.push({ date: p.date, description: `Initial payment to: ${p.farmerName} (#${p.id})`, account: 'Accounts Payable (Farmer)', debit: initialPaid, credit: 0, type: 'payment' });
                entries.push({ date: p.date, description: `Initial payment to: ${p.farmerName} (#${p.id})`, account: 'Cash / Bank', debit: 0, credit: initialPaid, type: 'payment' });
            }
        });

        // Calculate inventory lots to get COGS per sale
        const inventoryMetrics = Utils.calculateInventoryLots(purchases, sales, expenses);
        const saleCogsMap = {};
        Object.values(inventoryMetrics).forEach(lots => {
            if (lots.saleCogs) {
                Object.assign(saleCogsMap, lots.saleCogs);
            }
        });

        // ── Sale entries ──
        sales.forEach(s => {
            entries.push({ date: s.date, description: `Sale: ${s.buyerName} - ${s.crop} (#${s.id})`, account: 'Accounts Receivable (Buyer)', debit: s.amount, credit: 0, type: 'sale' });
            entries.push({ date: s.date, description: `Sale: ${s.buyerName} - ${s.crop} (#${s.id})`, account: 'Sales Revenue', debit: 0, credit: s.amount, type: 'sale' });
            
            const cogs = saleCogsMap[s.id] || 0;
            if (cogs > 0) {
                entries.push({ date: s.date, description: `COGS for Sale #${s.id}`, account: 'Cost of Goods Sold', debit: cogs, credit: 0, type: 'cogs' });
                entries.push({ date: s.date, description: `Inventory reduction for Sale #${s.id}`, account: 'Inventory / Purchases', debit: 0, credit: cogs, type: 'cogs' });
            }

            const laterReceipts = sPayments.filter(pay => pay.saleId === s.id).reduce((sum, pay) => sum + (pay.amount || 0), 0);
            const initialReceived = Math.max(0, (s.amountReceived || 0) - laterReceipts);
            if (initialReceived > 0) {
                entries.push({ date: s.date, description: `Initial receipt from: ${s.buyerName} (#${s.id})`, account: 'Cash / Bank', debit: initialReceived, credit: 0, type: 'receipt' });
                entries.push({ date: s.date, description: `Initial receipt from: ${s.buyerName} (#${s.id})`, account: 'Accounts Receivable (Buyer)', debit: 0, credit: initialReceived, type: 'receipt' });
            }
        });

        // ── Purchase payment entries ──
        pPayments.forEach(p => {
            entries.push({ date: p.date, description: `Payment to: ${p.farmerName} (#${p.purchaseId}) [${(p.mode||'Cash').toUpperCase()}]`, account: 'Accounts Payable (Farmer)', debit: p.amount, credit: 0, type: 'payment' });
            entries.push({ date: p.date, description: `Payment to: ${p.farmerName} (#${p.purchaseId}) [${(p.mode||'Cash').toUpperCase()}]`, account: 'Cash / Bank', debit: 0, credit: p.amount, type: 'payment' });
        });

        // ── Sale payment received entries ──
        sPayments.forEach(p => {
            entries.push({ date: p.date, description: `Received from: ${p.buyerName} (#${p.saleId}) [${(p.mode||'Cash').toUpperCase()}]`, account: 'Cash / Bank', debit: p.amount, credit: 0, type: 'receipt' });
            entries.push({ date: p.date, description: `Received from: ${p.buyerName} (#${p.saleId}) [${(p.mode||'Cash').toUpperCase()}]`, account: 'Accounts Receivable (Buyer)', debit: 0, credit: p.amount, type: 'receipt' });
        });

        // ── Expense entries ──
        advances.filter(a => (a.amount || 0) > 0).forEach(a => {
            entries.push({ date: a.date, description: `Advance paid to farmer: ${a.farmerName}`, account: 'Advances to Farmers', debit: a.amount, credit: 0, type: 'advance' });
            entries.push({ date: a.date, description: `Advance paid to farmer: ${a.farmerName}`, account: 'Cash / Bank', debit: 0, credit: a.amount, type: 'advance' });
        });

        obPayments.forEach(p => {
            if (p.type === 'farmer_payable') {
                entries.push({ date: p.date, description: `Opening payment to: ${p.partyName} [${(p.mode||'Cash').toUpperCase()}]`, account: 'Accounts Payable (Farmer)', debit: p.amount, credit: 0, type: 'payment' });
                entries.push({ date: p.date, description: `Opening payment to: ${p.partyName} [${(p.mode||'Cash').toUpperCase()}]`, account: 'Cash / Bank', debit: 0, credit: p.amount, type: 'payment' });
            } else if (p.type === 'buyer_receivable') {
                entries.push({ date: p.date, description: `Opening receipt from: ${p.partyName} [${(p.mode||'Cash').toUpperCase()}]`, account: 'Cash / Bank', debit: p.amount, credit: 0, type: 'receipt' });
                entries.push({ date: p.date, description: `Opening receipt from: ${p.partyName} [${(p.mode||'Cash').toUpperCase()}]`, account: 'Accounts Receivable (Buyer)', debit: 0, credit: p.amount, type: 'receipt' });
            }
        });

        expenses.forEach(e => {
            const desc = `Expense: ${e.type}${e.description ? ' - ' + e.description : ''}`;
            const accountName = e.purchaseId ? 'Inventory / Purchases' : 'Operating Expenses';
            entries.push({ date: e.date, description: desc, account: accountName, debit: e.amount, credit: 0, type: 'expense' });
            entries.push({ date: e.date, description: desc, account: 'Cash / Bank', debit: 0, credit: e.amount, type: 'expense' });
        });

        // ── Manual Journal Entries ──
        const journalEntries = await DB.getAll('journal_entries') || [];
        journalEntries.forEach(j => {
            entries.push({ date: j.date, description: `Manual JV: ${j.description || ''}`, account: j.debitAccount, debit: j.amount, credit: 0, type: 'journal' });
            entries.push({ date: j.date, description: `Manual JV: ${j.description || ''}`, account: j.creditAccount, debit: 0, credit: j.amount, type: 'journal' });
        });

        // Filter by date range
        if (from) entries = entries.filter(e => e.date >= from);
        if (to) entries = entries.filter(e => e.date <= to);

        entries.sort((a, b) => new Date(a.date) - new Date(b.date));
        return entries;
    },

    async regenerate() {
        Utils.showToast('Bookkeeping journal regenerated!');
        this.render();
    },

    async exportExcel() {
        if (!Utils.requireExcel()) return;
        const entries = await this.generateEntries(document.getElementById('bk-from').value, document.getElementById('bk-to').value);
        if (!entries.length) { Utils.showToast('No data to export', 'warning'); return; }
        
        const totalDebit = entries.reduce((s, e) => s + (e.debit || 0), 0);
        const totalCredit = entries.reduce((s, e) => s + (e.credit || 0), 0);

        const rows = entries.map(e => ({
            'Date': e.date,
            'Description': e.description,
            'Account': e.account,
            'Debit (PKR)': e.debit || '',
            'Credit (PKR)': e.credit || ''
        }));

        // Add totals row
        rows.push({ 'Date': '', 'Description': 'TOTALS', 'Account': '', 'Debit (PKR)': totalDebit, 'Credit (PKR)': totalCredit });
        
        const ws = XLSX.utils.json_to_sheet(rows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Journal');
        XLSX.writeFile(wb, `Bookkeeping_Journal_${Utils.todayISO()}.xlsx`);
        Utils.showToast('Journal Excel exported!');
    },

    async exportPDF() {
        if (!Utils.requirePDF()) return;
        const from = document.getElementById('bk-from').value;
        const to = document.getElementById('bk-to').value;
        const entries = await this.generateEntries(from, to);
        if (!entries.length) { Utils.showToast('No journal entries to export', 'warning'); return; }
        Utils.showLoading('Generating Journal PDF...');

        try {
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF();
            const biz = await Settings.getBusiness();

            // Header — Use shared approach
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(18);
            doc.text((biz.bizName || 'AgriSys').toUpperCase(), 105, 15, { align: 'center' });
            doc.setFontSize(8);
            doc.setFont('helvetica', 'normal');
            doc.text(biz.address || 'Agricultural Business Management', 105, 21, { align: 'center' });
            if (biz.phone) doc.text('Phone: ' + biz.phone, 105, 25, { align: 'center' });

            const hEnd = biz.phone ? 27 : 23;
            doc.setLineWidth(0.8); doc.line(15, hEnd, 195, hEnd);
            doc.setLineWidth(0.3); doc.line(15, hEnd + 1, 195, hEnd + 1);

            doc.setFontSize(12);
            doc.setFont('helvetica', 'bold');
            doc.text('GENERAL JOURNAL', 105, hEnd + 8, { align: 'center' });

            doc.setLineWidth(0.15); doc.line(15, hEnd + 11, 195, hEnd + 11);

            let period = 'All Time';
            if (from && to) period = `${Utils.formatDate(from)} to ${Utils.formatDate(to)}`;
            else if (from) period = `From ${Utils.formatDate(from)}`;
            else if (to) period = `Until ${Utils.formatDate(to)}`;

            doc.setFontSize(9);
            doc.setFont('helvetica', 'normal');
            doc.text(`Period: ${period}`, 105, hEnd + 17, { align: 'center' });
            doc.setLineWidth(0.15); doc.line(15, hEnd + 20, 195, hEnd + 20);

            // Stats row
            const totalDebit = entries.reduce((s, e) => s + (e.debit || 0), 0);
            const totalCredit = entries.reduce((s, e) => s + (e.credit || 0), 0);

            // Table
            const tableBody = entries.map(e => [
                Utils.formatDate(e.date),
                e.description,
                e.account,
                e.debit ? 'PKR ' + Utils.formatPKR(e.debit) : '',
                e.credit ? 'PKR ' + Utils.formatPKR(e.credit) : ''
            ]);

            doc.autoTable({
                startY: hEnd + 25,
                head: [['Date', 'Description', 'Account', 'Debit (PKR)', 'Credit (PKR)']],
                body: tableBody,
                foot: [['', 'TOTALS', entries.length + ' entries', 'PKR ' + Utils.formatPKR(totalDebit), 'PKR ' + Utils.formatPKR(totalCredit)]],
                theme: 'grid',
                headStyles: { fillColor: [40, 40, 40], textColor: 255, fontStyle: 'bold', fontSize: 7.5 },
                footStyles: { fillColor: [240, 240, 240], textColor: 0, fontStyle: 'bold', fontSize: 7.5 },
                styles: { fontSize: 6.5, font: 'helvetica', textColor: 20, lineColor: 180, lineWidth: 0.12, cellPadding: 2 },
                alternateRowStyles: { fillColor: [250, 250, 250] },
                columnStyles: {
                    0: { cellWidth: 20 },
                    1: { cellWidth: 'auto' },
                    2: { cellWidth: 38 },
                    3: { halign: 'right', cellWidth: 28 },
                    4: { halign: 'right', cellWidth: 28 }
                }
            });

            // Balance verification
            const fy = doc.lastAutoTable.finalY + 6;
            const diff = Math.abs(totalDebit - totalCredit);
            doc.setFontSize(8);
            if (diff < 0.01) {
                doc.setFont('helvetica', 'bold');
                doc.text('[OK] BOOKS BALANCED - Debits equal Credits', 105, fy, { align: 'center' });
            } else {
                doc.setFont('helvetica', 'bold');
                doc.text('[!] UNBALANCED - Difference: PKR ' + Utils.formatPKR(diff), 105, fy, { align: 'center' });
            }

            // Signatures
            const sy = Math.min(fy + 25, 270);
            doc.setLineWidth(0.3);
            doc.line(15, sy, 75, sy);
            doc.line(135, sy, 195, sy);
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(7);
            doc.text('Prepared By', 45, sy + 5, { align: 'center' });
            doc.text('Authorized Signature', 165, sy + 5, { align: 'center' });

            // Footer
            doc.setFontSize(6);
            doc.setTextColor(120);
            doc.text('Auto-generated by AgriSys on ' + new Date().toLocaleString(), 105, sy + 12, { align: 'center' });
            doc.setTextColor(0);

            doc.save(`Journal_${Utils.todayISO()}.pdf`);
            Utils.hideLoading();
            Utils.showToast('Journal PDF generated!');
        } catch (err) {
            Utils.hideLoading();
            Utils.showToast('PDF error: ' + err.message, 'error');
        }
    }
};

// ===== Manual Journal Entry Module =====
const Journal = {
    accounts: [
        'Cash / Bank',
        'Accounts Payable (Farmer)',
        'Accounts Receivable (Buyer)',
        'Inventory / Purchases',
        'Cost of Goods Sold (COGS)',
        'Sales Revenue',
        'Operating Expenses',
        'Advances to Farmers',
        'Capital Account',
        'Drawings / Dividends',
        'Other Income'
    ],

    async showModal() {
        document.getElementById('jv-date').value = Utils.todayISO();
        document.getElementById('jv-desc').value = '';
        document.getElementById('jv-amt').value = '';
        
        const populateSelect = async (id) => {
            const sel = document.getElementById(id);
            sel.innerHTML = '<option value="">Select Account</option>';
            
            // Add standard accounts
            this.accounts.forEach(acc => {
                sel.insertAdjacentHTML('beforeend', `<option value="${acc}">${acc}</option>`);
            });

            // Add capital accounts
            const capAccounts = await DB.getAll('capital_accounts') || [];
            capAccounts.forEach(c => {
                const name = `Capital: ${c.name}`;
                if(!this.accounts.includes(name)) {
                    sel.insertAdjacentHTML('beforeend', `<option value="${name}">${name}</option>`);
                }
            });
        };

        await populateSelect('jv-dr');
        await populateSelect('jv-cr');
        
        Utils.showModal('journal-modal');
    },

    async save() {
        const date = document.getElementById('jv-date').value;
        const desc = document.getElementById('jv-desc').value.trim();
        const dr = document.getElementById('jv-dr').value;
        const cr = document.getElementById('jv-cr').value;
        const amt = parseFloat(document.getElementById('jv-amt').value) || 0;

        if (!date || !dr || !cr || amt <= 0) {
            Utils.showToast('Please fill all fields and enter a valid amount', 'error');
            return;
        }

        if (dr === cr) {
            Utils.showToast('Debit and Credit accounts must be different', 'error');
            return;
        }

        const entry = {
            id: 'JV-' + Date.now(),
            date,
            description: desc,
            debitAccount: dr,
            creditAccount: cr,
            amount: amt,
            created_at: new Date().toISOString()
        };

        await DB.add('journal_entries', entry);
        Utils.hideModal('journal-modal');
        Utils.showToast('Journal Entry saved!');
        
        if (App.currentSection === 'bookkeeping') {
            Bookkeeping.render();
        } else if (App.currentSection === 'general-ledger') {
            FinanceReports.renderGeneralLedger();
        } else if (App.currentSection === 'trial-balance') {
            FinanceReports.renderTrialBalance();
        } else if (App.currentSection === 'cash-book') {
            FinanceReports.renderCashBook();
        }
    }
};
