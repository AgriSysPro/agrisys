// ===== Expenses Module =====
const Expenses = {
    currentTab: 'all',

    setTab(tab) {
        this.currentTab = tab;
        document.querySelectorAll('#expenses-tabs .tab').forEach(t => t.classList.remove('active'));
        document.querySelector(`#expenses-tabs .tab:nth-child(${tab==='all'?1:tab==='receipt'?2:tab==='general'?3:4})`).classList.add('active');
        this.render();
    },

    async render() {
        if (this.currentTab === 'analysis') { await this.renderCropAnalysis(); return; }
        document.getElementById('expenses-table-container').style.display = '';
        document.getElementById('crop-analysis').style.display = 'none';

        const activeSeason = await Utils.getActiveSeason();
        const all = Utils.filterBySeason(await DB.getAll('expenses'), activeSeason);
        let filtered = all;
        if (this.currentTab === 'receipt') filtered = all.filter(e => e.purchaseId);
        else if (this.currentTab === 'general') filtered = all.filter(e => !e.purchaseId);
        filtered.sort((a, b) => new Date(b.date) - new Date(a.date));

        document.getElementById('expenses-tbody').innerHTML = filtered.map(e => `<tr>
            <td>${Utils.formatDate(e.date)}</td><td><span class="badge badge-info">${Utils.escapeHTML(e.type)}</span></td>
            <td>${Utils.escapeHTML(e.description || '-')}</td><td>${Utils.escapeHTML(e.crop || '-')}</td>
            <td>${Utils.escapeHTML(e.purchaseId || '-')}</td><td class="text-right font-bold">PKR ${Utils.formatPKR(e.amount)}</td>
            <td><button class="btn btn-icon btn-danger btn-sm" onclick="Expenses.delete('${e.id}')">🗑️</button></td>
        </tr>`).join('') || '<tr><td colspan="7" class="text-center" style="color:var(--text-muted)">No expenses</td></tr>';
    },

    async renderCropAnalysis() {
        document.getElementById('expenses-table-container').style.display = 'none';
        document.getElementById('crop-analysis').style.display = '';
        const activeSeason = await Utils.getActiveSeason();
        const purchases = Utils.filterBySeason(await DB.getAll('purchases'), activeSeason);
        const expenses = Utils.filterBySeason(await DB.getAll('expenses'), activeSeason);
        const crops = [...new Set([...purchases.map(p => p.crop), ...expenses.map(e => e.crop).filter(c => c)])];

        let html = '<div class="stats-grid">';
        crops.forEach(crop => {
            const cp = purchases.filter(p => p.crop === crop);
            const ce = expenses.filter(e => e.crop === crop);
            const purchaseCost = cp.reduce((s, p) => s + Utils.purchaseCostAmount(p), 0);
            const expenseCost = ce.reduce((s, e) => s + (e.amount || 0), 0);
            const totalCost = purchaseCost + expenseCost;
            const totalWeight = cp.reduce((s, p) => s + (p.netWeight || 0), 0);
            const costPerMn = totalWeight > 0 ? totalCost / (totalWeight / 40) : 0;
            html += `<div class="stat-card blue">
                <div class="stat-label">${Utils.escapeHTML(crop)}</div>
                <div class="stat-value">PKR ${Utils.formatPKR(totalCost)}</div>
                <div class="stat-sub">Purchase: PKR ${Utils.formatPKR(purchaseCost)} | Expenses: PKR ${Utils.formatPKR(expenseCost)}</div>
                <div class="stat-sub">Total Weight: ${Utils.formatNum(totalWeight)} KG | Cost/Mn: PKR ${Utils.formatPKR(costPerMn)}</div>
            </div>`;
        });
        html += '</div>';
        document.getElementById('crop-analysis').innerHTML = html || '<div class="empty-state"><h3>No data for analysis</h3></div>';
    },

    showAddModal() {
        document.getElementById('exp-date').value = Utils.todayISO();
        document.getElementById('exp-desc').value = '';
        document.getElementById('exp-amount').value = '';
        document.getElementById('exp-type').value = 'labour';
        document.getElementById('exp-crop').value = '';
        // Populate receipt dropdown
        this.populateReceiptSelect();
        Utils.populateCapitalAccountSelect('exp-account', 'Select cash/bank account');
        Utils.showModal('expense-modal');
    },

    async populateReceiptSelect() {
        const activeSeason = await Utils.getActiveSeason();
        const purchases = Utils.filterBySeason(await DB.getAll('purchases'), activeSeason);
        const sel = document.getElementById('exp-receipt');
        sel.innerHTML = '<option value="">None</option>';
        purchases.sort((a, b) => new Date(b.date) - new Date(a.date)).forEach(p => {
            sel.innerHTML += `<option value="${Utils.escapeHTML(p.id)}">${Utils.escapeHTML(p.id)} - ${Utils.escapeHTML(p.farmerName)} (${Utils.escapeHTML(p.crop)})</option>`;
        });
    },

    async save() {
        const amount = Utils.pf(document.getElementById('exp-amount').value);
        if (amount <= 0) { Utils.showToast('Amount required', 'error'); return; }
        if (!document.getElementById('exp-account').value) { Utils.showToast('Select cash/bank account for this expense', 'error'); return; }
        const data = {
            id: Utils.generateId(),
            date: document.getElementById('exp-date').value,
            type: document.getElementById('exp-type').value,
            description: document.getElementById('exp-desc').value.trim(),
            amount,
            crop: document.getElementById('exp-crop').value,
            purchaseId: document.getElementById('exp-receipt').value,
            accountId: document.getElementById('exp-account').value,
            createdAt: new Date().toISOString()
        };
        await DB.put('expenses', data);
        const tx = await Utils.createLinkedCapitalTx({
            accountId: data.accountId,
            type: 'withdrawal',
            amount,
            date: data.date,
            description: `Expense: ${data.type}${data.description ? ' - ' + data.description : ''}`,
            sourceStore: 'expenses',
            sourceId: data.id
        });
        if (tx) {
            data.capitalTxId = tx.id;
            await DB.put('expenses', data);
        }
        await Utils.audit('create', 'expense', data.id, {
            amount,
            type: data.type,
            accountId: data.accountId || null,
            capitalTxId: data.capitalTxId || null
        });
        Utils.hideModal('expense-modal');
        Utils.showToast('Expense saved!');
        this.render();
    },

    async delete(id) {
        const expense = await DB.get('expenses', id);
        if (!expense) return;
        const allTx = await DB.getAll('capital_transactions');
        const linkedTx = allTx.filter(t => t.sourceStore === 'expenses' && t.sourceId === id);
        if (!await Utils.confirm(`Delete this expense?${linkedTx.length ? ' A linked capital transaction will also be removed.' : ''}`)) return;
        for (const tx of linkedTx) await DB.delete('capital_transactions', tx.id);
        await DB.delete('expenses', id);
        await Utils.audit('delete', 'expense', id, {
            oldAmount: expense.amount || 0,
            oldRecord: expense,
            deletedCapitalTransactions: linkedTx.map(t => t.id)
        });
        Utils.showToast('Deleted!');
        this.render();
    },

    async exportExcel() {
        if (!Utils.requireExcel()) return;
        const activeSeason = await Utils.getActiveSeason();
        const all = Utils.filterBySeason(await DB.getAll('expenses'), activeSeason);
        if (!all.length) { Utils.showToast('No data to export', 'warning'); return; }
        
        const rows = all.sort((a,b) => new Date(b.date)-new Date(a.date)).map(e => ({
            'Date': e.date,
            'Type': e.type,
            'Description': e.description,
            'Crop': e.crop || '',
            'Linked Receipt': e.purchaseId || '',
            'Amount': e.amount
        }));
        const ws = XLSX.utils.json_to_sheet(rows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Expenses');
        XLSX.writeFile(wb, `Expenses_${Utils.todayISO()}.xlsx`);
        Utils.showToast('Excel exported!');
    }
};
