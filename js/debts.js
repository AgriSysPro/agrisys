// ===== Debts & Loans Module =====
// Tracks interest-free company loans given to any party (farmers, buyers, staff, external) and repayments.
// Zero interest, APR, or penalties are applied.

const DebtsMgmt = {
    async render() {
        await this.renderStats();
        await this.renderTables();
    },

    // ── Summary Metrics Helper (Used by reports.js, bookkeeping.js, and app.js) ──
    async getDebtsSummary(scopedEntries) {
        const activeSeason = await Utils.getActiveSeason();
        const entries = scopedEntries || Utils.filterBySeason(await DB.getAll('company_debts'), activeSeason);
        const totalGiven = entries.filter(e => e.type === 'given').reduce((s, e) => s + (e.amount || 0), 0);
        const totalRepaid = entries.filter(e => e.type === 'repaid').reduce((s, e) => s + (e.amount || 0), 0);
        const netReceivable = Math.max(0, totalGiven - totalRepaid);

        // Group by personName
        const byPerson = {};
        entries.forEach(e => {
            const name = (e.personName || 'Unknown').trim();
            const key = name.toLowerCase();
            if (!byPerson[key]) byPerson[key] = { name, given: 0, repaid: 0, net: 0 };
            if (e.type === 'given') byPerson[key].given += (e.amount || 0);
            else if (e.type === 'repaid') byPerson[key].repaid += (e.amount || 0);
            byPerson[key].net = byPerson[key].given - byPerson[key].repaid;
        });

        const activeDebtorsCount = Object.values(byPerson).filter(p => p.net > 0).length;

        return {
            totalGiven,
            totalRepaid,
            netReceivable,
            activeDebtorsCount,
            byPerson,
            entries
        };
    },

    // ── Render Stats Grid ──
    async renderStats() {
        const summary = await this.getDebtsSummary();
        const statsEl = document.getElementById('debts-mgmt-stats');
        if (!statsEl) return;

        statsEl.innerHTML = `
            <div class="stat-card orange">
                <div class="stat-label">Total Loans Given (Outflow)</div>
                <div class="stat-value">PKR ${Utils.formatPKR(summary.totalGiven)}</div>
                <div class="stat-desc" style="font-size: 0.75rem; color: var(--text-muted);">100% Interest-Free Principal</div>
            </div>
            <div class="stat-card green">
                <div class="stat-label">Total Recovered (Inflow)</div>
                <div class="stat-value">PKR ${Utils.formatPKR(summary.totalRepaid)}</div>
                <div class="stat-desc" style="font-size: 0.75rem; color: var(--text-muted);">Repayments received</div>
            </div>
            <div class="stat-card primary">
                <div class="stat-label">Net Debts Receivable</div>
                <div class="stat-value">PKR ${Utils.formatPKR(summary.netReceivable)}</div>
                <div class="stat-desc" style="font-size: 0.75rem; color: var(--text-muted);">Outstanding asset balance</div>
            </div>
            <div class="stat-card blue">
                <div class="stat-label">Active Borrowers</div>
                <div class="stat-value">${summary.activeDebtorsCount}</div>
                <div class="stat-desc" style="font-size: 0.75rem; color: var(--text-muted);">Parties with open balance</div>
            </div>
        `;
    },

    // ── Render Summary & Ledger Tables ──
    async renderTables() {
        const summary = await this.getDebtsSummary();
        const accounts = await DB.getAll('capital_accounts');
        
        // 1. Debtors Summary Table
        const personsTbody = document.getElementById('debts-persons-tbody');
        if (personsTbody) {
            const personList = Object.values(summary.byPerson).sort((a, b) => b.net - a.net);
            personsTbody.innerHTML = personList.map(p => {
                const isSettled = p.net <= 0;
                const statusBadge = isSettled 
                    ? `<span class="badge badge-success">✓ Settled</span>` 
                    : `<span class="badge badge-warning">● Active</span>`;
                
                return `
                <tr>
                    <td><strong>${Utils.escapeHTML(p.name)}</strong></td>
                    <td class="text-right" style="color: var(--accent-danger);">PKR ${Utils.formatPKR(p.given)}</td>
                    <td class="text-right" style="color: var(--accent-success);">PKR ${Utils.formatPKR(p.repaid)}</td>
                    <td class="text-right font-bold" style="color: ${p.net > 0 ? 'var(--accent-primary)' : 'var(--text-muted)'};">
                        PKR ${Utils.formatPKR(Math.max(0, p.net))}
                    </td>
                    <td>${statusBadge}</td>
                    <td class="text-right">
                        <button class="btn btn-sm btn-ghost" title="Give More Loan" onclick="DebtsMgmt.showAddModal('given', '${Utils.escapeHTML(p.name)}')"><i data-lucide="plus"></i> Give</button>
                        <button class="btn btn-sm btn-success" title="Receive Repayment" onclick="DebtsMgmt.showAddModal('repaid', '${Utils.escapeHTML(p.name)}')"><i data-lucide="arrow-down-left"></i> Receive</button>
                        ${p.net > 0 ? `<button class="btn btn-sm btn-icon btn-ghost" title="Send WhatsApp Reminder" onclick="DebtsMgmt.shareReminder('${Utils.escapeHTML(p.name)}')">💬</button>` : ''}
                    </td>
                </tr>`;
            }).join('') || `<tr><td colspan="6" class="text-center" style="color: var(--text-muted); padding: 24px;">No debtors found. Click <strong>Give Debt / Loan</strong> to issue an interest-free loan.</td></tr>`;
        }

        // 2. Transactions Ledger Table
        const txTbody = document.getElementById('debts-tx-tbody');
        if (txTbody) {
            const sortedTx = [...summary.entries].sort((a, b) => new Date(b.date) - new Date(a.date));
            txTbody.innerHTML = sortedTx.map(tx => {
                const acc = tx.accountId ? accounts.find(a => a.id === tx.accountId) : null;
                const typeBadge = tx.type === 'given'
                    ? `<span class="badge badge-danger">OUTFLOW (Given)</span>`
                    : `<span class="badge badge-success">INFLOW (Repaid)</span>`;
                
                return `
                <tr>
                    <td>${Utils.formatDate(tx.date)}</td>
                    <td><strong>${Utils.escapeHTML(tx.personName || '-')}</strong></td>
                    <td>${typeBadge}</td>
                    <td>${acc ? Utils.escapeHTML(acc.name) : '<span style="color:var(--text-muted)">Cash / Unlinked</span>'}</td>
                    <td>${Utils.escapeHTML(tx.notes || '-')}</td>
                    <td class="text-right font-bold" style="color: ${tx.type === 'given' ? 'var(--accent-danger)' : 'var(--accent-success)'};">
                        ${tx.type === 'given' ? '−' : '+'}PKR ${Utils.formatPKR(tx.amount)}
                    </td>
                    <td class="text-right">
                        <button class="btn btn-sm btn-icon btn-ghost" title="Print Voucher PDF" onclick="DebtsMgmt.printVoucher('${tx.id}')">🖨️</button>
                        <button class="btn btn-sm btn-icon btn-ghost" title="Share Voucher WhatsApp" onclick="DebtsMgmt.shareWhatsApp('${tx.id}')">💬</button>
                        <button class="btn btn-sm btn-icon btn-ghost" title="Edit Entry" onclick="DebtsMgmt.editEntry('${tx.id}')">✏️</button>
                        <button class="btn btn-sm btn-icon btn-danger" title="Delete Entry" onclick="DebtsMgmt.deleteEntry('${tx.id}')">🗑️</button>
                    </td>
                </tr>`;
            }).join('') || `<tr><td colspan="7" class="text-center" style="color: var(--text-muted); padding: 24px;">No loan transactions recorded yet.</td></tr>`;
        }
        if (window.lucide && lucide.createIcons) lucide.createIcons();
    },

    // ── Show Add/Edit Modal ──
    async showAddModal(type = 'given', prefilledPerson = '', editId = null) {
        const modal = document.getElementById('debt-modal');
        if (!modal) return;

        // Populate Datalist with unique existing names (Farmers, Buyers, existing Debtors)
        const datalist = document.getElementById('debt-persons-list');
        if (datalist) {
            const farmers = await DB.getAll('farmers') || [];
            const buyers = await DB.getAll('buyers') || [];
            const debts = await DB.getAll('company_debts') || [];
            
            const uniqueNames = new Set([
                ...farmers.map(f => f.name),
                ...buyers.map(b => b.name),
                ...debts.map(d => d.personName)
            ]);
            datalist.innerHTML = Array.from(uniqueNames)
                .filter(Boolean)
                .sort()
                .map(n => `<option value="${Utils.escapeHTML(n)}">`)
                .join('');
        }

        // Populate bank accounts dropdown
        const accounts = await DB.getAll('capital_accounts') || [];
        const accSelect = document.getElementById('debt-account');
        if (accSelect) {
            accSelect.innerHTML = '<option value="">— Cash / No Bank Link —</option>' + 
                accounts.map(a => `<option value="${a.id}">${Utils.escapeHTML(a.name)} (${a.type}) - Bal: PKR ${Utils.formatPKR(a.balance || 0)}</option>`).join('');
        }

        if (editId) {
            const record = await DB.get('company_debts', editId);
            if (!record) { Utils.showToast('Record not found', 'error'); return; }
            document.getElementById('debt-id').value = record.id;
            document.getElementById('debt-type').value = record.type;
            document.getElementById('debt-modal-title').textContent = record.type === 'given' ? 'Edit Loan Issued' : 'Edit Repayment Received';
            document.getElementById('debt-person').value = record.personName || '';
            document.getElementById('debt-amount').value = record.amount || '';
            document.getElementById('debt-date').value = record.date || Utils.todayISO();
            document.getElementById('debt-notes').value = record.notes || '';
            if (accSelect) accSelect.value = record.accountId || '';
        } else {
            document.getElementById('debt-id').value = '';
            document.getElementById('debt-type').value = type;
            document.getElementById('debt-modal-title').textContent = type === 'given' ? 'Give Debt / Loan (Outflow)' : 'Receive Repayment (Inflow)';
            document.getElementById('debt-person').value = prefilledPerson || '';
            document.getElementById('debt-amount').value = '';
            document.getElementById('debt-date').value = Utils.todayISO();
            document.getElementById('debt-notes').value = type === 'given' ? 'Interest-free loan issued' : 'Loan recovery / repayment';
            if (accSelect && accounts.length > 0) accSelect.value = accounts[0].id;
        }

        Utils.showModal('debt-modal');
    },

    // ── Save Transaction ──
    async saveEntry() {
        const idInput = document.getElementById('debt-id').value;
        const type = document.getElementById('debt-type').value || 'given';
        const personName = document.getElementById('debt-person').value.trim();
        const amount = Utils.pf(document.getElementById('debt-amount').value);
        const date = document.getElementById('debt-date').value;
        const notes = document.getElementById('debt-notes').value.trim();
        const accountId = document.getElementById('debt-account').value || null;

        if (!personName) { Utils.showToast('Please specify a person or party name', 'error'); return; }
        if (amount <= 0) { Utils.showToast('Amount must be greater than zero', 'error'); return; }
        if (!date) { Utils.showToast('Date is required', 'error'); return; }

        const recordId = idInput || Utils.generateId();
        const isEdit = Boolean(idInput);

        const ops = [];

        // If editing, clean up any pre-existing linked bank transaction first
        if (isEdit) {
            const allTxs = await DB.getAll('capital_transactions') || [];
            const linked = allTxs.filter(t => t.sourceStore === 'company_debts' && t.sourceId === recordId);
            for (const t of linked) {
                ops.push({ storeName: 'capital_transactions', action: 'delete', key: t.id, softDelete: true, data: t });
            }
        }

        // Create linked bank transaction if account is selected
        let linkedTxId = null;
        if (accountId) {
            linkedTxId = Utils.generateId();
            const txType = type === 'given' ? 'withdrawal' : 'deposit';
            const txDesc = type === 'given' 
                ? `Loan Issued: ${personName}` 
                : `Loan Repayment: ${personName}`;

            ops.push({
                storeName: 'capital_transactions',
                action: 'put',
                data: {
                    id: linkedTxId,
                    accountId,
                    type: txType,
                    amount,
                    date,
                    description: txDesc + (notes ? ` (${notes})` : ''),
                    isReconciled: false,
                    sourceStore: 'company_debts',
                    sourceId: recordId,
                    createdAt: new Date().toISOString()
                }
            });
        }

        // Save core debt record
        ops.push({
            storeName: 'company_debts',
            action: 'put',
            data: {
                id: recordId,
                personName,
                type,
                amount,
                date,
                notes,
                accountId,
                linkedTxId,
                createdAt: new Date().toISOString()
            }
        });

        await DB.commitUnitOfWork(ops);

        Utils.hideModal('debt-modal');
        Utils.showToast(isEdit ? 'Debt entry updated successfully!' : 'Interest-free debt transaction saved!');
        await this.render();
    },

    // ── Edit Entry Trigger ──
    async editEntry(id) {
        await this.showAddModal('given', '', id);
    },

    // ── Delete Entry ──
    async deleteEntry(id) {
        if (!await Utils.confirm('Are you sure you want to delete this debt transaction? This will also reverse any associated bank cash flows.')) return;
        const ops = [];
        // Clean up linked bank transactions
        const allTxs = await DB.getAll('capital_transactions') || [];
        const linked = allTxs.filter(t => t.sourceStore === 'company_debts' && t.sourceId === id);
        for (const t of linked) {
            ops.push({ storeName: 'capital_transactions', action: 'delete', key: t.id, softDelete: true, data: t });
        }

        const debt = await DB.get('company_debts', id);
        if (debt) ops.push({ storeName: 'company_debts', action: 'delete', key: id, softDelete: true, data: debt });

        await DB.commitUnitOfWork(ops);
        Utils.showToast('Transaction deleted successfully!');
        await this.render();
    },

    // ── WhatsApp Voucher Share ──
    async shareWhatsApp(id) {
        const tx = await DB.get('company_debts', id);
        if (!tx) { Utils.showToast('Transaction not found', 'error'); return; }
        const bizName = await DB.getSetting('bizName') || 'AgriSys';
        
        const typeTitle = tx.type === 'given' ? 'LOAN ISSUANCE VOUCHER' : 'DEBT REPAYMENT RECEIPT';
        let msg = `*${bizName} — ${typeTitle}*\n`;
        msg += `----------------------------\n`;
        msg += `*Party Name:* ${tx.personName}\n`;
        msg += `*Date:* ${Utils.formatDate(tx.date)}\n`;
        msg += `*Amount:* PKR ${Utils.formatPKR(tx.amount)}\n`;
        if (tx.notes) msg += `*Notes:* ${tx.notes}\n`;
        msg += `----------------------------\n`;
        msg += `ℹ️ _All company loans are recorded as interest-free transactions._\n`;
        msg += `Thank you for working with ${bizName}.`;

        window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
    },

    // ── WhatsApp Reminder Share ──
    async shareReminder(personName) {
        const summary = await this.getDebtsSummary();
        const person = summary.byPerson[personName.trim().toLowerCase()];
        if (!person) { Utils.showToast('Party details not found', 'error'); return; }
        
        const bizName = await DB.getSetting('bizName') || 'AgriSys';
        let msg = `*${bizName} — Loan Balance Reminder*\n\n`;
        msg += `Dear ${person.name},\n`;
        msg += `This is a reminder regarding your outstanding interest-free loan account balance:\n\n`;
        msg += `• *Total Received:* PKR ${Utils.formatPKR(person.given)}\n`;
        msg += `• *Total Repaid:* PKR ${Utils.formatPKR(person.repaid)}\n`;
        msg += `• *Net Outstanding Balance:* PKR ${Utils.formatPKR(person.net)}\n\n`;
        msg += `Please let us know if you have any questions or require any clarification. Thank you!`;

        window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
    },

    // ── Print Professional jsPDF Voucher ──
    async printVoucher(id) {
        if (!Utils.requirePDF()) return;
        const tx = await DB.get('company_debts', id);
        if (!tx) { Utils.showToast('Transaction not found', 'error'); return; }
        
        const bizName = await DB.getSetting('bizName') || 'AgriSys';
        const address = await DB.getSetting('address') || '';
        const phone = await DB.getSetting('phone') || '';

        const { jsPDF } = window.jspdf;
        const doc = new jsPDF('p', 'mm', 'a5');
        const pw = 148; // A5 width in mm
        const mx = 12;
        let y = 15;

        const biz = {
            bizName: bizName,
            address: address,
            phone: phone
        };
        const title = tx.type === 'given' ? 'LOAN ISSUANCE VOUCHER' : 'LOAN REPAYMENT RECEIPT (INFLOW)';
        y = ReceiptPDF.drawReportHeader(doc, biz, title, { marginX: mx });

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.text(`Voucher Ref: DEBT-${tx.id.toString().slice(-6).toUpperCase()}`, mx, y);
        doc.text(`Date: ${Utils.formatDate(tx.date)}`, pw - mx, y, { align: 'right' });
        y += 8;

        doc.setFillColor(240, 243, 246);
        doc.rect(mx, y, pw - mx * 2, 28, 'F');
        y += 6;
        doc.setFont('helvetica', 'bold');
        doc.text('Party / Borrower:', mx + 4, y);
        doc.setFont('helvetica', 'normal');
        doc.text(tx.personName, mx + 40, y);
        y += 7;
        
        doc.setFont('helvetica', 'bold');
        doc.text('Transaction Type:', mx + 4, y);
        doc.setFont('helvetica', 'normal');
        doc.text(tx.type === 'given' ? 'Loan Issued (Outflow)' : 'Repayment Received (Inflow)', mx + 40, y);
        y += 7;

        doc.setFont('helvetica', 'bold');
        doc.text('Amount (PKR):', mx + 4, y);
        doc.setFontSize(11);
        doc.text(`PKR ${Utils.formatPKR(tx.amount)}`, mx + 40, y);
        doc.setFontSize(9);
        y += 12;

        if (tx.notes) {
            doc.setFont('helvetica', 'bold');
            doc.text('Notes / Memo:', mx, y);
            doc.setFont('helvetica', 'normal');
            doc.text(tx.notes, mx + 25, y);
            y += 10;
        }

        y += 5;
        doc.setFontSize(8);
        doc.setFont('helvetica', 'italic');
        doc.text('Note: This transaction is recorded as an interest-free company loan.', pw / 2, y, { align: 'center' });
        y += 4;
        doc.text('No interest, finance charges, or late penalties apply.', pw / 2, y, { align: 'center' });
        y += 15;

        doc.setFont('helvetica', 'normal');
        doc.setLineWidth(0.2);
        doc.line(mx, y, mx + 40, y);
        doc.line(pw - mx - 40, y, pw - mx, y);
        y += 4;
        doc.text('Prepared By / Stamp', mx, y);
        doc.text('Receiver Signature', pw - mx - 40, y);

        ReceiptPDF.drawReportFooter(doc);

        doc.save(`Voucher_${tx.type === 'given' ? 'Loan' : 'Recovery'}_${tx.personName}_${Utils.todayISO()}.pdf`);
        Utils.showToast('PDF voucher generated successfully!');
    },

    // ── Excel Export ──
    async exportExcel() {
        if (!Utils.requireExcel()) return;
        const summary = await this.getDebtsSummary();
        const accounts = await DB.getAll('capital_accounts');

        if (summary.entries.length === 0) {
            Utils.showToast('No debts data to export', 'warning');
            return;
        }

        // Sheet 1: Debtors Summary
        const personsData = Object.values(summary.byPerson).map(p => ({
            'Party Name': p.name,
            'Total Given (PKR)': p.given,
            'Total Repaid (PKR)': p.repaid,
            'Net Outstanding Receivable (PKR)': Math.max(0, p.net),
            'Status': p.net <= 0 ? 'Settled' : 'Active'
        }));

        // Sheet 2: Transactions Ledger
        const txData = summary.entries.map(t => {
            const acc = t.accountId ? accounts.find(a => a.id === t.accountId) : null;
            return {
                'Date': t.date,
                'Party Name': t.personName,
                'Type': t.type === 'given' ? 'Loan Issued (Outflow)' : 'Repayment (Inflow)',
                'Amount (PKR)': t.amount,
                'Bank / Cash Account': acc ? acc.name : 'Cash / Unlinked',
                'Notes': t.notes || ''
            };
        });

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(personsData), 'Debtors Summary');
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(txData), 'Transactions Ledger');
        XLSX.writeFile(wb, `Debts_Loans_Ledger_${Utils.todayISO()}.xlsx`);
        Utils.showToast('Excel ledger exported successfully!');
    }
};
