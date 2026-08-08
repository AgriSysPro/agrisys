// ===== Buyers Module =====
const Buyers = {
    async init() {},

    async ensureBuyer(name) {
        if (!name) return;
        const all = await DB.getAll('buyers');
        const exists = all.find(b => b.name.toLowerCase() === name.toLowerCase());
        if (!exists) {
            await DB.put('buyers', { id: Utils.generateId(), name, phone: '', address: '', notes: '', createdAt: new Date().toISOString() });
        }
    },

    async render() {
        const buyers = await DB.getAll('buyers');
        const activeSeason = await Utils.getActiveSeason();
        const untilDate = activeSeason ? activeSeason.endDate : null;

        const allSales = await DB.getAll('sales');
        const sales = untilDate ? allSales.filter(s => s.date <= untilDate) : allSales;

        const allSalePayments = await DB.getAll('sale_payments');
        const salePayments = untilDate ? allSalePayments.filter(p => p.date <= untilDate) : allSalePayments;

        const allOpenings = await DB.getAll('opening_balances');
        const openings = untilDate ? allOpenings.filter(o => o.date <= untilDate) : allOpenings;

        const search = (document.getElementById('b-search').value || '').toLowerCase();
        const filtered = buyers.filter(b => !search || b.name.toLowerCase().includes(search) || (b.phone || '').includes(search));

        const tbody = document.getElementById('buyers-tbody');
        const empty = document.getElementById('buyers-empty');

        if (filtered.length === 0) { tbody.innerHTML = ''; empty.style.display = ''; return; }
        empty.style.display = 'none';

        tbody.innerHTML = filtered.map(b => {
            const bs = sales.filter(s => s.buyerName && s.buyerName.toLowerCase() === b.name.toLowerCase());
            const openingReceivable = openings.filter(o => o.type === 'buyer_receivable' && (o.partyName || '').toLowerCase() === b.name.toLowerCase()).reduce((s, o) => s + (o.amount || 0), 0);
            const openingReceived = openings.filter(o => o.type === 'buyer_receivable' && (o.partyName || '').toLowerCase() === b.name.toLowerCase()).reduce((s, o) => s + (o.receivedAmount || o.settledAmount || 0), 0);
            const openingAdvance = openings.filter(o => o.type === 'buyer_advance' && (o.partyName || '').toLowerCase() === b.name.toLowerCase()).reduce((s, o) => s + (o.amount || 0), 0);
            
            const totalAmt = openingReceivable + bs.reduce((s, x) => s + (x.amount || 0), 0);
            const totalRcvd = openingReceived + bs.reduce((s, x) => s + Utils.paymentTotalFor(x, salePayments, 'saleId', 'amountReceived', untilDate), 0);
            const balance = totalAmt - totalRcvd - openingAdvance;
            return `<tr>
                <td class="font-bold">${Utils.highlightText(b.name, search)}</td>
                <td>${Utils.highlightText(b.phone || '-', search)}</td>
                <td class="text-center">${bs.length}</td>
                <td class="text-right">PKR ${Utils.formatPKR(totalAmt)}</td>
                <td class="text-right">PKR ${Utils.formatPKR(totalRcvd)}</td>
                <td class="text-right font-bold" style="color:${balance > 0 ? 'var(--accent-warning)' : 'var(--accent-success)'}">PKR ${Utils.formatPKR(balance)}</td>
                <td><div class="table-actions">
                    <button class="btn btn-icon btn-ghost btn-sm" onclick="Buyers.showLedgerOptions('${Utils.escapeHTML(b.id)}')" title="Ledger Options">📊</button>
                    <button class="btn btn-icon btn-ghost btn-sm" onclick="Buyers.edit('${Utils.escapeHTML(b.id)}')" title="Edit">✏️</button>
                    <button class="btn btn-icon btn-danger btn-sm" onclick="Buyers.delete('${Utils.escapeHTML(b.id)}')" title="Delete">🗑️</button>
                </div></td>
            </tr>`;
        }).join('');
    },

    showAddModal() {
        document.getElementById('bm-name').value = '';
        document.getElementById('bm-phone').value = '';
        document.getElementById('bm-address').value = '';
        document.getElementById('bm-notes').value = '';
        document.getElementById('bm-name').dataset.editId = '';
        document.querySelector('#buyer-modal .modal-title').textContent = 'Add Buyer';
        Utils.showModal('buyer-modal');
    },

    async edit(id) {
        const b = await DB.get('buyers', id);
        if (!b) return;
        document.getElementById('bm-name').value = b.name;
        document.getElementById('bm-phone').value = b.phone || '';
        document.getElementById('bm-address').value = b.address || '';
        document.getElementById('bm-notes').value = b.notes || '';
        document.getElementById('bm-name').dataset.editId = id;
        document.querySelector('#buyer-modal .modal-title').textContent = 'Edit Buyer';
        Utils.showModal('buyer-modal');
    },

    async save() {
        const name = document.getElementById('bm-name').value.trim();
        if (!name) { Utils.showToast('Name is required', 'error'); return; }
        const editId = document.getElementById('bm-name').dataset.editId;
        const data = {
            id: editId || Utils.generateId(),
            name,
            phone: document.getElementById('bm-phone').value.trim(),
            address: document.getElementById('bm-address').value.trim(),
            notes: document.getElementById('bm-notes').value.trim(),
            createdAt: new Date().toISOString()
        };
        await DB.put('buyers', data);
        Utils.hideModal('buyer-modal');
        Utils.showToast('Buyer saved!');
        this.render();
        Selling.loadBuyerDatalist();
    },

    async delete(id) {
        if (!await Utils.confirm('Delete this buyer? Associated sale records will NOT be deleted.')) return;
        await DB.delete('buyers', id);
        Utils.showToast('Buyer deleted!');
        this.render();
    },

    async exportExcel() {
        if (!Utils.requireExcel()) return;
        const buyers = await DB.getAll('buyers');
        const activeSeason = await Utils.getActiveSeason();
        const sales = Utils.filterBySeason(await DB.getAll('sales'), activeSeason);
        const openings = Utils.filterBySeason(await DB.getAll('opening_balances'), activeSeason);
        const debts = Utils.filterBySeason(await DB.getAll('company_debts'), activeSeason);
        if (!buyers.length) { Utils.showToast('No data to export', 'warning'); return; }

        const rows = buyers.sort((a, b) => a.name.localeCompare(b.name)).map(b => {
            const bs = sales.filter(s => s.buyerName.toLowerCase() === b.name.toLowerCase());
            const openingReceivable = openings.filter(o => o.type === 'buyer_receivable' && (o.partyName || '').toLowerCase() === b.name.toLowerCase()).reduce((s, o) => s + (o.amount || 0), 0);
            const openingReceived = openings.filter(o => o.type === 'buyer_receivable' && (o.partyName || '').toLowerCase() === b.name.toLowerCase()).reduce((s, o) => s + (o.receivedAmount || o.settledAmount || 0), 0);
            const openingAdvance = openings.filter(o => o.type === 'buyer_advance' && (o.partyName || '').toLowerCase() === b.name.toLowerCase()).reduce((s, o) => s + (o.amount || 0), 0);
            const totalAmt = openingReceivable + bs.reduce((s, x) => s + (x.amount || 0), 0);
            const totalRcvd = openingReceived + bs.reduce((s, x) => s + (x.amountReceived || 0), 0);
            const bDebts = debts.filter(d => (d.personName || '').trim().toLowerCase() === b.name.toLowerCase());
            const netDebt = Math.max(0, bDebts.filter(d => d.type === 'given').reduce((s, d) => s + (d.amount || 0), 0) - bDebts.filter(d => d.type === 'repaid').reduce((s, d) => s + (d.amount || 0), 0));
            return {
                'Name': b.name,
                'Phone': b.phone || '',
                'Total Sales': bs.length,
                'Total Amount': totalAmt,
                'Total Received': totalRcvd,
                'Opening Advance': openingAdvance,
                'Debts / Loans Receivable': netDebt,
                'Balance': totalAmt - totalRcvd - openingAdvance
            };
        });
        const ws = XLSX.utils.json_to_sheet(rows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Buyers');
        XLSX.writeFile(wb, `Buyers_${Utils.todayISO()}.xlsx`);
        Utils.showToast('Excel exported!');
    },

    showLedgerOptions(buyerId) {
        document.getElementById('ledger-filter-title').textContent = 'Buyer Ledger Options';
        document.getElementById('ledger-from').value = '';
        document.getElementById('ledger-to').value = '';
        document.getElementById('ledger-include-opening').checked = true;
        const options = () => ({
            from: document.getElementById('ledger-from').value,
            to: document.getElementById('ledger-to').value,
            includeOpening: document.getElementById('ledger-include-opening').checked
        });
        document.getElementById('ledger-filter-excel').onclick = async () => { Utils.hideModal('ledger-filter-modal'); await Buyers.exportLedgerExcel(buyerId, options()); };
        document.getElementById('ledger-filter-pdf').onclick = async () => { Utils.hideModal('ledger-filter-modal'); await Buyers.printLedger(buyerId, options()); };
        Utils.showModal('ledger-filter-modal');
    },

    async exportLedgerExcel(buyerId, options = {}) {
        if (!Utils.requireExcel()) return;
        const buyer = await DB.get('buyers', buyerId);
        if (!buyer) return;
        const ledger = await Utils.buildBuyerLedger(buyer, options);
        if (!ledger.rows.length) { Utils.showToast('No ledger transactions to export', 'warning'); return; }

        const wb = XLSX.utils.book_new();
        const summary = [
            { Field: 'Account Type', Value: 'Buyer Ledger' },
            { Field: 'Buyer Name', Value: buyer.name },
            { Field: 'Phone', Value: buyer.phone || '' },
            { Field: 'Statement Date', Value: Utils.formatDate(Utils.todayISO()) },
            { Field: 'Period', Value: `${options.from ? Utils.formatDate(options.from) : 'Start'} to ${options.to ? Utils.formatDate(options.to) : 'Today'}` },
            { Field: 'Opening Included', Value: options.includeOpening === false ? 'No' : 'Yes' },
            { Field: 'Sale Entries', Value: ledger.counts.sales },
            { Field: 'Receipt Entries', Value: ledger.counts.payments },
            { Field: 'Total Receivable (PKR)', Value: ledger.totals.debit },
            { Field: 'Total Received (PKR)', Value: ledger.totals.credit },
            { Field: 'Outstanding Receivable (PKR)', Value: ledger.totals.balance }
        ];
        const summaryWs = XLSX.utils.json_to_sheet(summary);
        summaryWs['!cols'] = [{ wch: 30 }, { wch: 36 }];

        const rows = ledger.rows.map(r => ({
            'Date': r.date,
            'Reference': r.ref,
            'Type': r.type,
            'Description': r.description,
            'Debit / Receivable (PKR)': r.debit || '',
            'Credit / Received (PKR)': r.credit || '',
            'Running Balance (PKR)': r.balance
        }));
        rows.push({
            'Date': '',
            'Reference': '',
            'Type': 'TOTALS',
            'Description': 'Closing Balance',
            'Debit / Receivable (PKR)': ledger.totals.debit,
            'Credit / Received (PKR)': ledger.totals.credit,
            'Running Balance (PKR)': ledger.totals.balance
        });
        const ws = XLSX.utils.json_to_sheet(rows);
        ws['!cols'] = [{ wch: 14 }, { wch: 18 }, { wch: 18 }, { wch: 46 }, { wch: 22 }, { wch: 22 }, { wch: 22 }];
        XLSX.utils.book_append_sheet(wb, summaryWs, 'Summary');
        XLSX.utils.book_append_sheet(wb, ws, 'Ledger');
        XLSX.writeFile(wb, `${buyer.name.replace(/\\s+/g, '_')}_Buyer_Ledger_${Utils.todayISO()}.xlsx`);
        Utils.showToast('Buyer ledger exported!');
    },

    async printLedger(buyerId, options = {}) {
        if (!Utils.requirePDF()) return;
        try {
            Utils.showLoading('Generating Buyer Ledger PDF...');
            const buyer = await DB.get('buyers', buyerId);
            if (!buyer) { Utils.hideLoading(); Utils.showToast('Buyer not found', 'error'); return; }

            const biz = await Settings.getBusiness();
            const ledger = await Utils.buildBuyerLedger(buyer, options);
            const tableBody = ledger.rows.map(t => [
                t.date,
                t.ref || '',
                t.type,
                t.description,
                t.debit > 0 ? 'PKR ' + Utils.formatPKR(t.debit) : '',
                t.credit > 0 ? 'PKR ' + Utils.formatPKR(t.credit) : '',
                'PKR ' + Utils.formatPKR(t.balance)
            ]);

            const { jsPDF } = window.jspdf;
            const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

            // Professional Header
            let y = ReceiptPDF.drawReportHeader(doc, biz, 'BUYER STATEMENT OF ACCOUNT');

            // Buyer Info Box
            doc.setFillColor(245, 245, 245);
            doc.rect(15, y + 3, 180, 18, 'F');
            doc.setLineWidth(0.15);
            doc.rect(15, y + 3, 180, 18, 'S');

            doc.setFontSize(9);
            doc.setFont('helvetica', 'bold');
            doc.text('Account:', 18, y + 10);
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(11);
            doc.text(buyer.name.toUpperCase(), 36, y + 10);

            doc.setFontSize(9);
            doc.setFont('helvetica', 'bold');
            doc.text('Phone:', 18, y + 16);
            doc.setFont('helvetica', 'normal');
            doc.text(buyer.phone || 'N/A', 32, y + 16);

            doc.setFont('helvetica', 'bold');
            doc.text('Statement Date:', 130, y + 10);
            doc.setFont('helvetica', 'normal');
            doc.text(Utils.formatDate(new Date().toISOString()), 163, y + 10);

            doc.setFont('helvetica', 'bold');
            doc.text('Sales / Receipts:', 130, y + 16);
            doc.setFont('helvetica', 'normal');
            doc.text(`${ledger.counts.sales} / ${ledger.counts.payments}`, 166, y + 16);
            doc.setFontSize(7);
            doc.text(`Period: ${options.from ? Utils.formatDate(options.from) : 'Start'} to ${options.to ? Utils.formatDate(options.to) : 'Today'}`, 105, y + 24, { align: 'center' });

            y += 30;

            // Ledger Table
            doc.autoTable({
                startY: y,
                margin: { top: 18, left: 15, right: 15 },
                head: [['Date', 'Ref', 'Type', 'Description', 'Receivable (+)', 'Received (-)', 'Balance']],
                body: tableBody,
                foot: [[
                    '', '', 'TOTALS', '',
                    'PKR ' + Utils.formatPKR(ledger.totals.debit),
                    'PKR ' + Utils.formatPKR(ledger.totals.credit),
                    'PKR ' + Utils.formatPKR(ledger.totals.balance)
                ]],
                theme: 'grid',
                headStyles: { fillColor: [35, 35, 35], textColor: 255, fontStyle: 'bold', fontSize: 7 },
                footStyles: { fillColor: [235, 235, 235], textColor: 0, fontStyle: 'bold', fontSize: 7 },
                styles: { fontSize: 6.7, font: 'helvetica', textColor: 20, lineColor: 180, lineWidth: 0.12, cellPadding: 1.8 },
                alternateRowStyles: { fillColor: [250, 250, 250] },
                columnStyles: {
                    0: { cellWidth: 18 },
                    1: { cellWidth: 20 },
                    2: { cellWidth: 20 },
                    3: { cellWidth: 'auto' },
                    4: { halign: 'right', cellWidth: 28 },
                    5: { halign: 'right', cellWidth: 26 },
                    6: { halign: 'right', cellWidth: 28, fontStyle: 'bold' }
                },
                didDrawPage: (data) => {}
            });

            // Final Balance Box
            const fy = doc.lastAutoTable.finalY + 8;
            const balance = ledger.totals.balance;
            const balText = balance > 0
                ? `BALANCE DUE: BUYER OWES SHOP  PKR ${Utils.formatPKR(balance)}`
                : balance < 0
                    ? `BALANCE DUE: SHOP OWES BUYER  PKR ${Utils.formatPKR(Math.abs(balance))}  (Advance)`
                    : 'BALANCE CLEARED - ALL ACCOUNTS SETTLED (PKR 0.00)';

            doc.setLineWidth(0.5);
            doc.rect(15, fy - 4, 180, 10, 'S');
            doc.setFontSize(10);
            doc.setFont('helvetica', 'bold');
            doc.text(balText, 105, fy + 3, { align: 'center' });

            // Signatures
            const sy = Math.min(fy + 30, 270);
            doc.setLineWidth(0.3);
            doc.line(15, sy, 75, sy);
            doc.line(135, sy, 195, sy);
            doc.setFontSize(8);
            doc.setFont('helvetica', 'normal');
            doc.text('Buyer Signature / Stamp', 45, sy + 5, { align: 'center' });
            doc.text('Authorized Signature / Stamp', 165, sy + 5, { align: 'center' });

            // Footer
            ReceiptPDF.drawReportFooter(doc);

            doc.save(`Buyer_Ledger_${buyer.name.replace(/\s+/g, '_')}.pdf`);
            Utils.hideLoading();
            Utils.showToast('Buyer Ledger PDF generated!');
        } catch (err) {
            Utils.hideLoading();
            console.error('Buyer Ledger PDF error:', err);
            Utils.showToast('PDF error: ' + err.message, 'error');
        }
    }
};
