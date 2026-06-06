// ===== Capital Module =====
const Capital = {
    async render() {
        await this.renderStats();
        await this.renderAccounts();
        await this.renderTransactions();
    },

    async renderStats() {
        const accounts = await DB.getAll('capital_accounts');
        const activeSeason = await Utils.getActiveSeason();
        const transactions = Utils.filterBySeason(await DB.getAll('capital_transactions'), activeSeason);
        const totalInvested = accounts.reduce((s, a) => s + (a.openingBalance || 0), 0);
        let currentTotal = 0;
        accounts.forEach(a => {
            const txs = transactions.filter(t => t.accountId === a.id);
            const deposits = txs.filter(t => t.type === 'deposit').reduce((s, t) => s + t.amount, 0);
            const withdrawals = txs.filter(t => t.type === 'withdrawal').reduce((s, t) => s + t.amount, 0);
            currentTotal += (a.openingBalance || 0) + deposits - withdrawals;
        });

        document.getElementById('capital-stats').innerHTML = `
            <div class="stat-card blue"><div class="stat-label">Total Invested Capital</div><div class="stat-value">PKR ${Utils.formatPKR(totalInvested)}</div></div>
            <div class="stat-card green"><div class="stat-label">Current Total Balance</div><div class="stat-value">PKR ${Utils.formatPKR(currentTotal)}</div></div>
            <div class="stat-card ${currentTotal >= totalInvested ? 'green' : 'orange'}"><div class="stat-label">Accounts</div><div class="stat-value">${accounts.length}</div></div>
        `;
    },

    async renderAccounts() {
        const accounts = await DB.getAll('capital_accounts');
        const activeSeason = await Utils.getActiveSeason();
        const transactions = Utils.filterBySeason(await DB.getAll('capital_transactions'), activeSeason);
        document.getElementById('capital-accounts-tbody').innerHTML = accounts.map(a => {
            const txs = transactions.filter(t => t.accountId === a.id);
            const dep = txs.filter(t => t.type === 'deposit').reduce((s, t) => s + t.amount, 0);
            const wdr = txs.filter(t => t.type === 'withdrawal').reduce((s, t) => s + t.amount, 0);
            const current = (a.openingBalance || 0) + dep - wdr;
            return `<tr>
                <td class="font-bold">${Utils.escapeHTML(a.name)}</td><td>${Utils.escapeHTML(a.type)}</td>
                <td class="text-right">PKR ${Utils.formatPKR(a.openingBalance)}</td>
                <td class="text-right font-bold" style="color:${current>=0?'var(--accent-success)':'var(--accent-danger)'}">PKR ${Utils.formatPKR(current)}</td>
                <td><button class="btn btn-icon btn-danger btn-sm" onclick="Capital.deleteAccount('${a.id}')">🗑️</button></td>
            </tr>`;
        }).join('') || '<tr><td colspan="5" class="text-center" style="color:var(--text-muted)">No accounts</td></tr>';
    },

    async renderTransactions() {
        const activeSeason = await Utils.getActiveSeason();
        const transactions = Utils.filterBySeason(await DB.getAll('capital_transactions'), activeSeason);
        const accounts = await DB.getAll('capital_accounts');
        const sorted = transactions.sort((a, b) => new Date(a.date) - new Date(b.date));
        // Compute running balance per account
        const balanceMap = {};
        accounts.forEach(a => { balanceMap[a.id] = a.openingBalance || 0; });
        const rows = sorted.map(t => {
            const acc = accounts.find(a => a.id === t.accountId);
            if (t.type === 'deposit') balanceMap[t.accountId] = (balanceMap[t.accountId] || 0) + t.amount;
            else balanceMap[t.accountId] = (balanceMap[t.accountId] || 0) - t.amount;
            const runBalance = balanceMap[t.accountId] || 0;
            return `<tr>
                <td>${Utils.formatDate(t.date)}</td><td>${acc ? Utils.escapeHTML(acc.name) : '-'}</td>
                <td><span class="badge ${t.type==='deposit'?'badge-success':'badge-danger'}">${Utils.escapeHTML(t.type)}</span></td>
                <td>${Utils.escapeHTML(t.description || '-')}</td>
                <td class="text-right font-bold" style="color:${t.type==='deposit'?'var(--accent-success)':'var(--accent-danger)'}">${t.type==='deposit'?'+':'−'}PKR ${Utils.formatPKR(t.amount)}</td>
                <td class="text-right font-bold" style="color:${runBalance>=0?'var(--accent-success)':'var(--accent-danger)'}">PKR ${Utils.formatPKR(runBalance)}</td>
                <td class="text-center">${t.isReconciled ? '✅' : '<span style="color:var(--text-muted);font-size:0.8rem">Pending</span>'}</td>
                <td><button class="btn btn-icon btn-danger btn-sm" onclick="Capital.deleteTx('${t.id}')">🗑️</button></td>
            </tr>`;
        });
        // Show newest first
        document.getElementById('capital-tx-tbody').innerHTML = rows.reverse().join('') || '<tr><td colspan="8" class="text-center" style="color:var(--text-muted)">No transactions</td></tr>';
    },

    async showReconModal() {
        const accounts = await DB.getAll('capital_accounts');
        const sel = document.getElementById('recon-account');
        if (accounts.length === 0) {
            sel.innerHTML = '<option value="">(No Accounts)</option>';
        } else {
            sel.innerHTML = accounts.map(a => `<option value="${Utils.escapeHTML(a.id)}">${Utils.escapeHTML(a.name)}</option>`).join('');
            this.renderReconList();
        }
        Utils.showModal('recon-modal');
    },

    async renderReconList() {
        const accId = document.getElementById('recon-account').value;
        if (!accId) return;
        const allTx = await DB.getByIndex('capital_transactions', 'accountId', accId);
        const sorted = allTx.sort((a,b) => new Date(b.date) - new Date(a.date));
        
        const tbody = document.getElementById('recon-tbody');
        const empty = document.getElementById('recon-empty');
        
        if (sorted.length === 0) {
            tbody.parentElement.style.display = 'none';
            empty.style.display = 'block';
            return;
        }

        tbody.parentElement.style.display = '';
        empty.style.display = 'none';
        
        tbody.innerHTML = sorted.map(t => {
            const checked = t.isReconciled ? 'checked' : '';
            return `<tr>
                <td>${Utils.formatDate(t.date)}</td>
                <td><span class="badge ${t.type==='deposit'?'badge-success':'badge-danger'}">${Utils.escapeHTML(t.type)}</span></td>
                <td>${Utils.escapeHTML(t.description || '-')}</td>
                <td class="text-right font-bold">${t.type==='deposit'?'+':'-'}PKR ${Utils.formatPKR(t.amount)}</td>
                <td class="text-center">
                    <input type="checkbox" ${checked} onchange="Capital.toggleReconciled('${t.id}', this.checked)" style="transform: scale(1.5);">
                </td>
            </tr>`;
        }).join('');
    },

    async toggleReconciled(id, isReconciled) {
        const tx = await DB.get('capital_transactions', id);
        if (tx) {
            tx.isReconciled = isReconciled;
            await DB.put('capital_transactions', tx);
        }
    },

    showAddAccount() {
        document.getElementById('acc-name').value = '';
        document.getElementById('acc-type').value = 'cash';
        document.getElementById('acc-balance').value = '0';
        Utils.showModal('account-modal');
    },

    async saveAccount() {
        const name = document.getElementById('acc-name').value.trim();
        if (!name) { Utils.showToast('Name required', 'error'); return; }
        await DB.put('capital_accounts', {
            id: Utils.generateId(), name,
            type: document.getElementById('acc-type').value,
            openingBalance: Utils.pf(document.getElementById('acc-balance').value),
            createdAt: new Date().toISOString()
        });
        Utils.hideModal('account-modal');
        Utils.showToast('Account added!');
        this.render();
    },

    showAddTransaction() {
        document.getElementById('tx-date').value = Utils.todayISO();
        document.getElementById('tx-amount').value = '';
        document.getElementById('tx-desc').value = '';
        this.populateAccountSelect();
        Utils.showModal('tx-modal');
    },

    async populateAccountSelect() {
        const accounts = await DB.getAll('capital_accounts');
        const sel = document.getElementById('tx-account');
        sel.innerHTML = accounts.map(a => `<option value="${Utils.escapeHTML(a.id)}">${Utils.escapeHTML(a.name)}</option>`).join('');
    },

    async saveTransaction() {
        const amount = Utils.pf(document.getElementById('tx-amount').value);
        if (amount <= 0) { Utils.showToast('Amount required', 'error'); return; }
        await DB.put('capital_transactions', {
            id: Utils.generateId(),
            accountId: document.getElementById('tx-account').value,
            type: document.getElementById('tx-type').value,
            amount, date: document.getElementById('tx-date').value,
            description: document.getElementById('tx-desc').value.trim(),
            isReconciled: false,
            createdAt: new Date().toISOString()
        });
        Utils.hideModal('tx-modal');
        Utils.showToast('Transaction saved!');
        this.render();
    },

    async deleteAccount(id) {
        if (!await Utils.confirm('Delete this account and all its transactions?')) return;
        await DB.delete('capital_accounts', id);
        const txs = await DB.getByIndex('capital_transactions', 'accountId', id);
        for (const t of txs) await DB.delete('capital_transactions', t.id);
        Utils.showToast('Account deleted!');
        this.render();
    },

    async deleteTx(id) {
        if (!await Utils.confirm('Delete this transaction?')) return;
        await DB.delete('capital_transactions', id);
        Utils.showToast('Deleted!');
        this.render();
    },

    async exportExcel() {
        if (!Utils.requireExcel()) return;
        const accounts = await DB.getAll('capital_accounts');
        const activeSeason = await Utils.getActiveSeason();
        const transactions = Utils.filterBySeason(await DB.getAll('capital_transactions'), activeSeason);
        
        const wb = XLSX.utils.book_new();
        
        if (accounts.length) {
            const accRows = accounts.map(a => {
                const txs = transactions.filter(t => t.accountId === a.id);
                const dep = txs.filter(t => t.type === 'deposit').reduce((s, t) => s + t.amount, 0);
                const wdr = txs.filter(t => t.type === 'withdrawal').reduce((s, t) => s + t.amount, 0);
                return {
                    'Account Name': a.name,
                    'Type': a.type,
                    'Opening Balance': a.openingBalance || 0,
                    'Current Balance': (a.openingBalance || 0) + dep - wdr,
                    'Created At': Utils.formatDate(a.createdAt)
                };
            });
            XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(accRows), 'Accounts');
        }
        
        if (transactions.length) {
            const txRows = transactions.sort((a,b) => new Date(b.date)-new Date(a.date)).map(t => {
                const acc = accounts.find(a => a.id === t.accountId);
                return {
                    'Date': t.date,
                    'Account': acc ? acc.name : 'Unknown',
                    'Type': t.type,
                    'Description': t.description || '',
                    'Amount': t.amount,
                    'Reconciled': t.isReconciled ? 'Yes' : 'No'
                };
            });
            XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(txRows), 'Transactions');
        }
        
        if (!accounts.length && !transactions.length) {
            Utils.showToast('No data to export', 'warning');
            return;
        }

        XLSX.writeFile(wb, `Capital_History_${Utils.todayISO()}.xlsx`);
        Utils.showToast('Excel exported!');
    }
};
