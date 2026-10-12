// ===== Capital Management Module =====
// Tracks owner capital contributions and drawings, syncs to Balance Sheet, Cash Flow, Bookkeeping
const CapitalMgmt = {
    async render() {
        await this.renderStats();
        await this.renderLedger();
    },

    // ── Stats ──
    async renderStats() {
        const summary = await this.getCapitalSummary();
        document.getElementById('capital-mgmt-stats').innerHTML = `
            <div class="stat-card green"><div class="stat-label">Total Contributions</div><div class="stat-value">PKR ${Utils.formatPKR(summary.totalContributions)}</div><div class="stat-sub">All time</div></div>
            <div class="stat-card orange"><div class="stat-label">Total Drawings</div><div class="stat-value">PKR ${Utils.formatPKR(summary.totalDrawings)}</div><div class="stat-sub">All time</div></div>
            <div class="stat-card blue"><div class="stat-label">Net Owner Capital</div><div class="stat-value">PKR ${Utils.formatPKR(summary.netCapital)}</div><div class="stat-sub">All time</div></div>
        `;
    },

    // ── Capital Summary (used by reports, bookkeeping, etc.) ──
    async getCapitalSummary(scopedEntries) {
        const entries = scopedEntries || await DB.getAll('capital_entries');
        const contributions = entries.filter(e => e.type === 'contribution').reduce((s, e) => s + e.amount, 0);
        const drawings = entries.filter(e => e.type === 'drawing').reduce((s, e) => s + e.amount, 0);
        return {
            totalContributions: contributions,
            totalDrawings: drawings,
            netCapital: contributions - drawings,
            entries
        };
    },

    // ── Ledger Table ──
    async renderLedger() {
        const entries = (await DB.getAll('capital_entries')).sort((a, b) => new Date(a.date) - new Date(b.date));
        const accounts = await DB.getAll('capital_accounts');

        let runBal = 0;
        const rows = entries.map(e => {
            if (e.type === 'contribution') runBal += e.amount;
            else runBal -= e.amount;
            const acc = e.accountId ? accounts.find(a => a.id === e.accountId) : null;
            const typeBadge = e.type === 'contribution'
                ? `<span class="badge badge-success">↑ Contribution</span>`
                : `<span class="badge badge-danger">↓ Drawing</span>`;
            return `<tr>
                <td>${Utils.formatDate(e.date)}</td>
                <td>${typeBadge}</td>
                <td>${Utils.escapeHTML(e.description || '-')}</td>
                <td>${acc ? Utils.escapeHTML(acc.name) : '<span style="color:var(--text-muted)">—</span>'}</td>
                <td class="text-right font-bold" style="color:${e.type === 'contribution' ? 'var(--accent-success)' : 'var(--accent-danger)'}">${e.type === 'contribution' ? '+' : '−'}PKR ${Utils.formatPKR(e.amount)}</td>
                <td class="text-right font-bold" style="color:${runBal >= 0 ? 'var(--accent-success)' : 'var(--accent-danger)'}">PKR ${Utils.formatPKR(runBal)}</td>
                <td><button class="btn btn-icon btn-danger btn-sm" onclick="CapitalMgmt.deleteEntry('${e.id}')" title="Delete" aria-label="Delete capital entry">×</button></td>
            </tr>`;
        });

        document.getElementById('capital-mgmt-tbody').innerHTML = rows.reverse().join('') ||
            '<tr><td colspan="7" class="text-center" style="color:var(--text-muted)">No capital entries. Click <strong>Add Contribution</strong> or <strong>Record Drawing</strong> to begin.</td></tr>';
    },

    // ── Show Add Entry Modal ──
    async showAddEntry(type) {
        document.getElementById('cap-entry-type').value = type;
        document.getElementById('cap-entry-title').textContent = type === 'contribution' ? 'Add Capital Contribution' : 'Record Owner Drawing';
        document.getElementById('cap-entry-amount').value = '';
        document.getElementById('cap-entry-date').value = Utils.todayISO();
        document.getElementById('cap-entry-desc').value = '';

        // Populate bank account dropdown
        const accounts = await DB.getAll('capital_accounts');
        const sel = document.getElementById('cap-entry-account');
        sel.innerHTML = '<option value="">— None (no bank link) —</option>' +
            accounts.map(a => `<option value="${Utils.escapeHTML(a.id)}">${Utils.escapeHTML(a.name)} (${a.type})</option>`).join('');
        if (accounts.length > 0) sel.value = accounts[0].id;

        Utils.showModal('capital-entry-modal');
    },

    // ── Save Entry ──
    async saveEntry() {
        const type = document.getElementById('cap-entry-type').value;
        const amount = Utils.pf(document.getElementById('cap-entry-amount').value);
        const date = document.getElementById('cap-entry-date').value;
        const desc = document.getElementById('cap-entry-desc').value.trim();
        const accountId = document.getElementById('cap-entry-account').value || null;

        if (amount <= 0) { Utils.showToast('Amount must be greater than zero', 'error'); return; }
        if (!date) { Utils.showToast('Date is required', 'error'); return; }

        const entryId = Utils.generateId();
        let linkedTxId = null;

        // If linked to a bank/cash account, create matching bank transaction
        const ops = [];
        if (accountId) {
            linkedTxId = Utils.generateId();
            const account = await DB.get('capital_accounts', accountId);
            const txType = type === 'contribution' ? 'deposit' : 'withdrawal';
            const txDesc = desc || (type === 'contribution' ? 'Capital contribution' : 'Owner drawing');

            ops.push({ storeName: 'capital_transactions', action: 'put', data: {
                id: linkedTxId,
                accountId,
                type: txType,
                amount,
                date,
                description: txDesc + (account ? ` (${account.name})` : ''),
                isReconciled: false,
                sourceStore: 'capital_entries',
                sourceId: entryId,
                createdAt: new Date().toISOString()
            } });
        }

        const entry = {
            id: entryId,
            type,
            amount,
            date,
            description: desc || (type === 'contribution' ? 'Capital contribution' : 'Owner drawing'),
            accountId,
            linkedTxId,
            createdAt: new Date().toISOString()
        };
        ops.push({ storeName: 'capital_entries', action: 'put', data: entry });
        ops.push({ storeName: 'audit_logs', action: 'put', data: Utils.createAuditRecord('create', 'capital_entry', entryId, { type, amount, accountId }) });
        try { await DB.commitUnitOfWork(ops, await DB.financialSnapshot()); }
        catch (error) { Utils.showToast(error.code === 'CONFLICT' ? error.message : `Capital entry not saved: ${error.message}`, 'error'); return; }

        Utils.hideModal('capital-entry-modal');
        Utils.showToast(type === 'contribution' ? 'Contribution recorded!' : 'Drawing recorded!');
        this.render();
    },

    // ── Delete Entry ──
    async deleteEntry(id) {
        const entry = await DB.get('capital_entries', id);
        if (!entry) return;
        if (!await Utils.confirm('Delete this capital entry?')) return;
        const snapshot = await DB.financialSnapshot();
        const ops = [{ storeName: 'capital_entries', action: 'delete', key: id, softDelete: true, data: entry }];
        if (entry.sourceStore === 'opening_balances' && entry.sourceId) {
            const opening = await DB.get('opening_balances', entry.sourceId);
            if (opening) ops.push({ storeName: 'opening_balances', action: 'delete', key: opening.id, softDelete: true, data: opening });
        }
        const linkedTxs = (await DB.getAll('capital_transactions')).filter(tx => tx.id === entry.linkedTxId ||
            (tx.sourceStore === 'capital_entries' && tx.sourceId === id) ||
            (entry.sourceStore === 'opening_balances' && tx.sourceStore === 'opening_balances' && tx.sourceId === entry.sourceId));
        linkedTxs.forEach(tx => ops.push({ storeName: 'capital_transactions', action: 'delete', key: tx.id, softDelete: true, data: tx }));
        ops.push({ storeName: 'audit_logs', action: 'put', data: Utils.createAuditRecord('delete', 'capital_entry', id, { oldRecord: entry, deletedCapitalTransactions: linkedTxs.map(tx => tx.id) }) });
        try { await DB.commitUnitOfWork(ops, snapshot); }
        catch (error) { Utils.showToast(error.code === 'CONFLICT' ? error.message : `Capital entry not deleted: ${error.message}`, 'error'); return; }
        Utils.showToast('Deleted!');
        this.render();
    },

    // ── Excel Export ──
    async exportExcel() {
        if (!Utils.requireExcel()) return;
        const entries = (await DB.getAll('capital_entries')).sort((a, b) => new Date(b.date) - new Date(a.date));
        const accounts = await DB.getAll('capital_accounts');

        if (entries.length === 0) {
            Utils.showToast('No data to export', 'warning');
            return;
        }

        let runBal = 0;
        const sorted = [...entries].sort((a, b) => new Date(a.date) - new Date(b.date));
        const rows = sorted.map(e => {
            if (e.type === 'contribution') runBal += e.amount;
            else runBal -= e.amount;
            const acc = e.accountId ? accounts.find(a => a.id === e.accountId) : null;
            return {
                'Date': e.date,
                'Type': e.type,
                'Description': e.description || '',
                'Bank Account': acc ? acc.name : '',
                'Amount': e.type === 'contribution' ? e.amount : -e.amount,
                'Running Balance': runBal
            };
        });

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Capital Ledger');
        XLSX.writeFile(wb, `Capital_Ledger_${Utils.todayISO()}.xlsx`);
        Utils.showToast('Excel exported!');
    }
};
