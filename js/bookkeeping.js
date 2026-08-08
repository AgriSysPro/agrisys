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
                entries.push({ date: a.createdAt ? Utils.dateToISO(new Date(a.createdAt)) : Utils.todayISO(), description: `Opening balance: ${a.name}`, account: 'Cash / Bank', debit: opening, credit: 0, type: 'opening' });
                entries.push({ date: a.createdAt ? Utils.dateToISO(new Date(a.createdAt)) : Utils.todayISO(), description: `Opening balance: ${a.name}`, account: 'Opening Equity', debit: 0, credit: opening, type: 'opening' });
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
                // Handled via capital_entries which generates its own journal entries below
            }
        });

        // ── Capital entries (from capital_entries store) ──
        const capitalEntries = Utils.filterBySeason(await DB.getAll('capital_entries'), activeSeason);
        capitalEntries.forEach(e => {
            if (e.type === 'contribution') {
                entries.push({ date: e.date, description: e.description || 'Capital contribution', account: 'Cash / Bank', debit: e.amount, credit: 0, type: 'capital' });
                entries.push({ date: e.date, description: e.description || 'Capital contribution', account: 'Owner Capital', debit: 0, credit: e.amount, type: 'capital' });
            } else {
                entries.push({ date: e.date, description: e.description || 'Owner drawing', account: 'Owner Drawings', debit: e.amount, credit: 0, type: 'capital' });
                entries.push({ date: e.date, description: e.description || 'Owner drawing', account: 'Cash / Bank', debit: 0, credit: e.amount, type: 'capital' });
            }
        });

        // ── Debts / Loans ──
        const debts = Utils.filterBySeason(await DB.getAll('company_debts'), activeSeason);
        debts.forEach(d => {
            const desc = `Debt / Loan ${d.type === 'given' ? 'to' : 'repaid by'}: ${d.personName}${d.notes ? ' (' + d.notes + ')' : ''}`;
            if (d.type === 'given') {
                entries.push({ date: d.date, description: desc, account: 'Debts / Loans Receivable', debit: d.amount, credit: 0, type: 'debt' });
                entries.push({ date: d.date, description: desc, account: 'Cash / Bank', debit: 0, credit: d.amount, type: 'debt' });
            } else if (d.type === 'repaid') {
                entries.push({ date: d.date, description: desc, account: 'Cash / Bank', debit: d.amount, credit: 0, type: 'debt' });
                entries.push({ date: d.date, description: desc, account: 'Debts / Loans Receivable', debit: 0, credit: d.amount, type: 'debt' });
            }
        });

        // ── Partner Transactions ──
        const partners = await DB.getAll('partners') || [];
        const partnerTxs = Utils.filterBySeason(await DB.getAll('partner_transactions'), activeSeason);
        partnerTxs.forEach(t => {
            const p = partners.find(x => x.id === t.partnerId);
            const pName = p ? p.name : 'Partner';
            const desc = t.description ? `${t.description} (${pName})` : `Partner ${t.type.replace('_', ' ')} (${pName})`;
            if (t.type === 'contribution') {
                entries.push({ date: t.date, description: desc, account: 'Cash / Bank', debit: t.amount, credit: 0, type: 'partner_capital' });
                entries.push({ date: t.date, description: desc, account: 'Partner Capital (' + pName + ')', debit: 0, credit: t.amount, type: 'partner_capital' });
            } else if (t.type === 'drawing') {
                entries.push({ date: t.date, description: desc, account: 'Partner Drawings (' + pName + ')', debit: t.amount, credit: 0, type: 'partner_capital' });
                entries.push({ date: t.date, description: desc, account: 'Cash / Bank', debit: 0, credit: t.amount, type: 'partner_capital' });
            } else if (t.type === 'profit_payout') {
                entries.push({ date: t.date, description: desc, account: 'Profit Distribution / Retained Earnings', debit: t.amount, credit: 0, type: 'partner_capital' });
                entries.push({ date: t.date, description: desc, account: 'Cash / Bank', debit: 0, credit: t.amount, type: 'partner_capital' });
            }
        });

        // ── Purchase entries (Double-entry) ──
        purchases.forEach(p => {
            const inventoryCost = p.amount || Utils.purchaseCostAmount(p);
            const payable = Utils.purchasePayableAmount(p);
            const advanceRecovered = p.advanceDeducted || 0;
            const comm = p.commissionTotal || 0;
            const tax = p.mandiTaxTotal || 0;
            const otherDeds = Math.max(0, (p.pkrDeductionsBeforeAdvance || 0) - comm - tax);

            entries.push({ date: p.date, description: `Purchase: ${p.farmerName} - ${p.crop} (#${p.id})`, account: 'Inventory / Purchases', debit: inventoryCost, credit: 0, type: 'purchase' });
            if (payable > 0) {
                entries.push({ date: p.date, description: `Purchase payable: ${p.farmerName} - ${p.crop} (#${p.id})`, account: 'Accounts Payable (Farmer)', debit: 0, credit: payable, type: 'purchase' });
            }
            if (advanceRecovered > 0) {
                entries.push({ date: p.date, description: `Advance recovered from purchase #${p.id}`, account: 'Advances to Farmers', debit: 0, credit: advanceRecovered, type: 'advance' });
            }
            if (comm > 0) {
                entries.push({ date: p.date, description: `Commission earned from purchase #${p.id}`, account: 'Commission Revenue', debit: 0, credit: comm, type: 'commission' });
            }
            if (tax > 0) {
                entries.push({ date: p.date, description: `Mandi Tax payable for purchase #${p.id}`, account: 'Mandi Tax Payable', debit: 0, credit: tax, type: 'tax' });
            }
            if (otherDeds > 0) {
                entries.push({ date: p.date, description: `Other deductions for purchase #${p.id}`, account: 'Other Income', debit: 0, credit: otherDeds, type: 'deduction' });
            }
            const laterPayments = pPayments.filter(pay => pay.purchaseId === p.id).reduce((sum, pay) => sum + (pay.amount || 0), 0);
            const initialPaid = p.initialPaymentAmount !== undefined ? p.initialPaymentAmount : Math.max(0, (p.amountPaid || 0) - laterPayments);
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
            const initialReceived = s.initialReceiptAmount !== undefined ? s.initialReceiptAmount : Math.max(0, (s.amountReceived || 0) - laterReceipts);
            if (initialReceived > 0) {
                entries.push({ date: s.date, description: `Initial receipt from: ${s.buyerName} (#${s.id})`, account: 'Cash / Bank', debit: initialReceived, credit: 0, type: 'receipt' });
                entries.push({ date: s.date, description: `Initial receipt from: ${s.buyerName} (#${s.id})`, account: 'Accounts Receivable (Buyer)', debit: 0, credit: initialReceived, type: 'receipt' });
            }
        });

        // ── Purchase payment entries ──
        pPayments.forEach(p => {
            const totalPay = p.amount || 0;
            const advDeduct = p.advanceDeducted || 0;
            const netCash = p.netCashAmount !== undefined ? p.netCashAmount : Math.max(0, totalPay - advDeduct);

            entries.push({ date: p.date, description: `Payment to: ${p.farmerName} (#${p.purchaseId}) [${(p.mode||'Cash').toUpperCase()}]`, account: 'Accounts Payable (Farmer)', debit: totalPay, credit: 0, type: 'payment' });
            if (advDeduct > 0) {
                entries.push({ date: p.date, description: `Advance adjusted for farmer payment: ${p.farmerName}`, account: 'Advances to Farmers', debit: 0, credit: advDeduct, type: 'payment' });
            }
            if (netCash > 0) {
                entries.push({ date: p.date, description: `Payment to: ${p.farmerName} (#${p.purchaseId}) [${(p.mode||'Cash').toUpperCase()}]`, account: 'Cash / Bank', debit: 0, credit: netCash, type: 'payment' });
            }
        });

        // ── Sale payment received entries ──
        sPayments.forEach(p => {
            const totalRcvd = p.amount || 0;
            const advDeduct = p.advanceDeducted || 0;
            const netCash = p.netCashAmount !== undefined ? p.netCashAmount : Math.max(0, totalRcvd - advDeduct);

            if (netCash > 0) {
                entries.push({ date: p.date, description: `Received from: ${p.buyerName} (#${p.saleId}) [${(p.mode||'Cash').toUpperCase()}]`, account: 'Cash / Bank', debit: netCash, credit: 0, type: 'receipt' });
            }
            if (advDeduct > 0) {
                entries.push({ date: p.date, description: `Buyer deposit applied: ${p.buyerName}`, account: 'Buyer Advances / Deposits', debit: advDeduct, credit: 0, type: 'receipt' });
            }
            entries.push({ date: p.date, description: `Received from: ${p.buyerName} (#${p.saleId}) [${(p.mode||'Cash').toUpperCase()}]`, account: 'Accounts Receivable (Buyer)', debit: 0, credit: totalRcvd, type: 'receipt' });
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

        // ── Stock Adjustment entries ──
        const stockAdjustments = Utils.filterBySeason(await DB.getAll('stock_adjustments'), activeSeason);
        stockAdjustments.filter(a => a.direction !== 'opening').forEach(a => {
            const adjVal = a.value || 0;
            if (a.direction === 'decrease') {
                entries.push({ date: a.date, description: `Stock shortage/loss: ${a.crop} (${a.weight} KG) - ${a.reason || 'Shortage'}`, account: 'Stock Shortage Loss', debit: adjVal, credit: 0, type: 'stock_adjustment' });
                entries.push({ date: a.date, description: `Stock shortage/loss: ${a.crop} (${a.weight} KG) - ${a.reason || 'Shortage'}`, account: 'Inventory / Purchases', debit: 0, credit: adjVal, type: 'stock_adjustment' });
            } else if (a.direction === 'increase') {
                entries.push({ date: a.date, description: `Stock surplus gain: ${a.crop} (${a.weight} KG) - ${a.reason || 'Surplus'}`, account: 'Inventory / Purchases', debit: adjVal, credit: 0, type: 'stock_adjustment' });
                entries.push({ date: a.date, description: `Stock surplus gain: ${a.crop} (${a.weight} KG) - ${a.reason || 'Surplus'}`, account: 'Stock Adjustment Gain', debit: 0, credit: adjVal, type: 'stock_adjustment' });
            }
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
            let y = ReceiptPDF.drawReportHeader(doc, biz, 'GENERAL JOURNAL');

            let period = 'All Time';
            if (from && to) period = `${Utils.formatDate(from)} to ${Utils.formatDate(to)}`;
            else if (from) period = `From ${Utils.formatDate(from)}`;
            else if (to) period = `Until ${Utils.formatDate(to)}`;

            doc.setFontSize(9);
            doc.setFont('helvetica', 'normal');
            doc.text(`Period: ${period}`, 105, y + 6, { align: 'center' });
            
            y += 12;

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
                startY: y,
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
            ReceiptPDF.drawReportFooter(doc);

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
        'Debts / Loans Receivable',
        'Owner Capital',
        'Owner Drawings',
        'Partner Capital',
        'Partner Drawings / Profit Payouts',
        'Opening Equity',
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

            // Add bank/cash accounts
            const capAccounts = await DB.getAll('capital_accounts') || [];
            capAccounts.forEach(c => {
                const name = `Bank/Cash: ${c.name}`;
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
