// ===== Bank Accounts Module =====
const BankAccounts = {
    async render() {
        await this.renderStats();
        await this.renderAccounts();
        await this.populateTxAccountFilter();
        await this.renderTransactions();
    },

    // ── Stats ──
    async renderStats() {
        const accounts = await DB.getAll('capital_accounts');
        const activeSeason = await Utils.getActiveSeason();
        const transactions = Utils.filterBySeason(await DB.getAll('capital_transactions'), activeSeason);
        const totalInvested = accounts.reduce((s, a) => s + (a.openingBalance || 0), 0);
        let currentTotal = 0;
        let totalDeposits = 0;
        let totalWithdrawals = 0;
        accounts.forEach(a => {
            const txs = transactions.filter(t => t.accountId === a.id);
            const deposits = txs.filter(t => t.type === 'deposit').reduce((s, t) => s + t.amount, 0);
            const withdrawals = txs.filter(t => t.type === 'withdrawal').reduce((s, t) => s + t.amount, 0);
            currentTotal += (a.openingBalance || 0) + deposits - withdrawals;
            totalDeposits += deposits;
            totalWithdrawals += withdrawals;
        });

        document.getElementById('capital-stats').innerHTML = `
            <div class="stat-card blue"><div class="stat-label">Total Invested Capital</div><div class="stat-value">PKR ${Utils.formatPKR(totalInvested)}</div></div>
            <div class="stat-card green"><div class="stat-label">Current Total Balance</div><div class="stat-value">PKR ${Utils.formatPKR(currentTotal)}</div></div>
            <div class="stat-card ${currentTotal >= totalInvested ? 'green' : 'orange'}"><div class="stat-label">Accounts</div><div class="stat-value">${accounts.length}</div></div>
        `;
    },

    // ── Visual Account Cards ──
    async renderAccounts() {
        const accounts = await DB.getAll('capital_accounts');
        const activeSeason = await Utils.getActiveSeason();
        const transactions = Utils.filterBySeason(await DB.getAll('capital_transactions'), activeSeason);
        const container = document.getElementById('capital-account-cards');

        if (accounts.length === 0) {
            container.innerHTML = `<div class="account-card-empty">
                <i data-lucide="landmark"></i>
                <p>No accounts yet. Click <strong>Add Account</strong> to get started.</p>
            </div>`;
            Utils.safeCreateIcons();
            return;
        }

        container.innerHTML = accounts.map(a => {
            const txs = transactions.filter(t => t.accountId === a.id).sort((x, y) => new Date(x.date) - new Date(y.date));
            const dep = txs.filter(t => t.type === 'deposit').reduce((s, t) => s + t.amount, 0);
            const wdr = txs.filter(t => t.type === 'withdrawal').reduce((s, t) => s + t.amount, 0);
            const current = (a.openingBalance || 0) + dep - wdr;
            const sparkSvg = this.generateSparkline(txs, a.openingBalance || 0);
            const isCash = a.type === 'cash';
            const icon = isCash ? 'wallet' : 'landmark';
            const typeClass = isCash ? 'cash' : 'bank';

            // Bank details rows
            let bankDetailsHtml = '';
            if (!isCash && (a.bankName || a.accountNumber || a.branch || a.iban)) {
                bankDetailsHtml = `<div class="account-card-details">`;
                if (a.bankName) bankDetailsHtml += `<div class="account-card-detail-row"><span class="detail-label">Bank</span><span class="detail-value">${Utils.escapeHTML(a.bankName)}</span></div>`;
                if (a.accountNumber) bankDetailsHtml += `<div class="account-card-detail-row"><span class="detail-label">Account #</span><span class="detail-value">${Utils.escapeHTML(a.accountNumber)}</span></div>`;
                if (a.branch) bankDetailsHtml += `<div class="account-card-detail-row"><span class="detail-label">Branch</span><span class="detail-value">${Utils.escapeHTML(a.branch)}</span></div>`;
                if (a.iban) bankDetailsHtml += `<div class="account-card-detail-row"><span class="detail-label">IBAN</span><span class="detail-value">${Utils.escapeHTML(a.iban)}</span></div>`;
                bankDetailsHtml += `</div>`;
            }

            return `<div class="account-card">
                <div class="account-card-top">
                    <div class="account-card-icon ${typeClass}"><i data-lucide="${icon}"></i></div>
                    <div class="account-card-info">
                        <div class="account-card-name">${Utils.escapeHTML(a.name)}</div>
                        <div class="account-card-type ${typeClass}">${isCash ? '💵 Cash' : '🏦 Bank'}</div>
                    </div>
                    <div class="account-card-actions">
                        <button class="btn btn-icon btn-ghost btn-sm" title="Edit" onclick="BankAccounts.showEditAccount('${a.id}')">✏️</button>
                        <button class="btn btn-icon btn-danger btn-sm" title="Delete" onclick="BankAccounts.deleteAccount('${a.id}')">🗑️</button>
                    </div>
                </div>
                <div class="account-card-balance-section">
                    <div class="account-card-balance-label">Current Balance</div>
                    <div class="account-card-balance-value ${current >= 0 ? 'positive' : 'negative'}">PKR ${Utils.formatPKR(current)}</div>
                </div>
                ${sparkSvg ? `<div class="account-card-sparkline">${sparkSvg}</div>` : ''}
                ${bankDetailsHtml}
                <div class="account-card-stats">
                    <div class="account-card-stat">
                        <div class="account-card-stat-label">Opening</div>
                        <div class="account-card-stat-value">PKR ${Utils.formatPKR(a.openingBalance || 0)}</div>
                    </div>
                    <div class="account-card-stat">
                        <div class="account-card-stat-label" style="color:var(--accent-success)">Deposits</div>
                        <div class="account-card-stat-value" style="color:var(--accent-success)">+${Utils.formatPKR(dep)}</div>
                    </div>
                    <div class="account-card-stat">
                        <div class="account-card-stat-label" style="color:var(--accent-danger)">Withdrawals</div>
                        <div class="account-card-stat-value" style="color:var(--accent-danger)">−${Utils.formatPKR(wdr)}</div>
                    </div>
                </div>
            </div>`;
        }).join('');
        Utils.safeCreateIcons();
    },

    // ── SVG Sparkline Generator ──
    generateSparkline(txs, openingBalance) {
        if (txs.length < 2) return '';
        // Build balance points from chronological transactions
        let bal = openingBalance || 0;
        const points = [bal];
        txs.forEach(t => {
            if (t.type === 'deposit') bal += t.amount;
            else bal -= t.amount;
            points.push(bal);
        });
        // Take last 15 points max
        const data = points.slice(-15);
        if (data.length < 2) return '';
        const min = Math.min(...data);
        const max = Math.max(...data);
        const range = max - min || 1;
        const w = 300;
        const h = 36;
        const pad = 2;
        const stepX = w / (data.length - 1);
        const coords = data.map((v, i) => {
            const x = i * stepX;
            const y = h - pad - ((v - min) / range) * (h - pad * 2);
            return `${x.toFixed(1)},${y.toFixed(1)}`;
        });
        const lineColor = data[data.length - 1] >= data[0] ? '#059669' : '#dc2626';
        const fillColor = data[data.length - 1] >= data[0] ? 'rgba(5,150,105,0.08)' : 'rgba(220,38,38,0.08)';
        const polyline = coords.join(' ');
        const areaPoints = `0,${h} ${polyline} ${w},${h}`;
        return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
            <polygon points="${areaPoints}" fill="${fillColor}" />
            <polyline points="${polyline}" fill="none" stroke="${lineColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
        </svg>`;
    },

    // ── Populate Transaction Account Filter ──
    async populateTxAccountFilter() {
        const accounts = await DB.getAll('capital_accounts');
        const sel = document.getElementById('cap-tx-account');
        if (!sel) return;
        const current = sel.value;
        sel.innerHTML = '<option value="">All Accounts</option>' +
            accounts.map(a => `<option value="${Utils.escapeHTML(a.id)}">${Utils.escapeHTML(a.name)}</option>`).join('');
        if (current) sel.value = current;
    },

    // ── Transactions with Filtering ──
    async renderTransactions() {
        const activeSeason = await Utils.getActiveSeason();
        const transactions = Utils.filterBySeason(await DB.getAll('capital_transactions'), activeSeason);
        const accounts = await DB.getAll('capital_accounts');

        // Read filters
        const filterAccount = document.getElementById('cap-tx-account')?.value || '';
        const filterType = document.getElementById('cap-tx-type')?.value || '';
        const filterFrom = document.getElementById('cap-tx-from')?.value || '';
        const filterTo = document.getElementById('cap-tx-to')?.value || '';
        const filterSearch = (document.getElementById('cap-tx-search')?.value || '').toLowerCase().trim();

        // Apply filters
        let filtered = transactions;
        if (filterAccount) filtered = filtered.filter(t => t.accountId === filterAccount);
        if (filterType === 'transfer') {
            filtered = filtered.filter(t => !!t.transferId);
        } else if (filterType) {
            filtered = filtered.filter(t => t.type === filterType && !t.transferId);
        }
        if (filterFrom) filtered = filtered.filter(t => t.date >= filterFrom);
        if (filterTo) filtered = filtered.filter(t => t.date <= filterTo);
        if (filterSearch) filtered = filtered.filter(t => (t.description || '').toLowerCase().includes(filterSearch));

        const sorted = filtered.sort((a, b) => new Date(a.date) - new Date(b.date));

        // Compute running balance per account (using all transactions, not just filtered)
        const balanceMap = {};
        accounts.forEach(a => { balanceMap[a.id] = a.openingBalance || 0; });
        const allSorted = transactions.sort((a, b) => new Date(a.date) - new Date(b.date));
        const txBalances = {};
        allSorted.forEach(t => {
            if (t.type === 'deposit') balanceMap[t.accountId] = (balanceMap[t.accountId] || 0) + t.amount;
            else balanceMap[t.accountId] = (balanceMap[t.accountId] || 0) - t.amount;
            txBalances[t.id] = balanceMap[t.accountId];
        });

        const rows = sorted.map(t => {
            const acc = accounts.find(a => a.id === t.accountId);
            const runBalance = txBalances[t.id] || 0;
            const isTransfer = !!t.transferId;
            const typeBadge = isTransfer
                ? `<span class="badge" style="background:rgba(37,99,235,0.12);color:var(--accent-primary)">↔ transfer</span>`
                : `<span class="badge ${t.type === 'deposit' ? 'badge-success' : 'badge-danger'}">${Utils.escapeHTML(t.type)}</span>`;
            return `<tr>
                <td>${Utils.formatDate(t.date)}</td><td>${acc ? Utils.escapeHTML(acc.name) : '-'}</td>
                <td>${typeBadge}</td>
                <td>${Utils.escapeHTML(t.description || '-')}</td>
                <td class="text-right font-bold" style="color:${t.type === 'deposit' ? 'var(--accent-success)' : 'var(--accent-danger)'}">${t.type === 'deposit' ? '+' : '−'}PKR ${Utils.formatPKR(t.amount)}</td>
                <td class="text-right font-bold" style="color:${runBalance >= 0 ? 'var(--accent-success)' : 'var(--accent-danger)'}">PKR ${Utils.formatPKR(runBalance)}</td>
                <td class="text-center">${t.isReconciled ? '✅' : '<span style="color:var(--text-muted);font-size:0.8rem">Pending</span>'}</td>
                <td><button class="btn btn-icon btn-danger btn-sm" onclick="BankAccounts.deleteTx('${t.id}')">🗑️</button></td>
            </tr>`;
        });
        // Show newest first
        document.getElementById('capital-tx-tbody').innerHTML = rows.reverse().join('') || '<tr><td colspan="8" class="text-center" style="color:var(--text-muted)">No transactions</td></tr>';
    },

    // ── Bank Recon Modal ──
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
        const sorted = allTx.sort((a, b) => new Date(b.date) - new Date(a.date));

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
                <td><span class="badge ${t.type === 'deposit' ? 'badge-success' : 'badge-danger'}">${Utils.escapeHTML(t.type)}</span></td>
                <td>${Utils.escapeHTML(t.description || '-')}</td>
                <td class="text-right font-bold">${t.type === 'deposit' ? '+' : '-'}PKR ${Utils.formatPKR(t.amount)}</td>
                <td class="text-center">
                    <input type="checkbox" ${checked} onchange="BankAccounts.toggleReconciled('${t.id}', this.checked)" style="transform: scale(1.5);">
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

    // ── Toggle Bank Fields Visibility ──
    toggleBankFields() {
        const type = document.getElementById('acc-type').value;
        document.getElementById('bank-details-section').style.display = type === 'bank' ? 'block' : 'none';
    },

    // ── Add Account ──
    showAddAccount() {
        document.getElementById('acc-modal-title').textContent = 'Add Account';
        document.getElementById('acc-edit-id').value = '';
        document.getElementById('acc-name').value = '';
        document.getElementById('acc-type').value = 'cash';
        document.getElementById('acc-balance').value = '0';
        document.getElementById('acc-bank-name').value = '';
        document.getElementById('acc-account-number').value = '';
        document.getElementById('acc-branch').value = '';
        document.getElementById('acc-iban').value = '';
        this.toggleBankFields();
        Utils.showModal('account-modal');
    },

    // ── Edit Account ──
    async showEditAccount(id) {
        const a = await DB.get('capital_accounts', id);
        if (!a) { Utils.showToast('Account not found', 'error'); return; }
        document.getElementById('acc-modal-title').textContent = 'Edit Account';
        document.getElementById('acc-edit-id').value = a.id;
        document.getElementById('acc-name').value = a.name || '';
        document.getElementById('acc-type').value = a.type || 'cash';
        document.getElementById('acc-balance').value = a.openingBalance || 0;
        document.getElementById('acc-bank-name').value = a.bankName || '';
        document.getElementById('acc-account-number').value = a.accountNumber || '';
        document.getElementById('acc-branch').value = a.branch || '';
        document.getElementById('acc-iban').value = a.iban || '';
        this.toggleBankFields();
        Utils.showModal('account-modal');
    },

    // ── Save Account (Add or Edit) ──
    async saveAccount() {
        const name = document.getElementById('acc-name').value.trim();
        if (!name) { Utils.showToast('Name required', 'error'); return; }
        const editId = document.getElementById('acc-edit-id').value;
        const type = document.getElementById('acc-type').value;
        const data = {
            id: editId || Utils.generateId(),
            name,
            type,
            openingBalance: Utils.pf(document.getElementById('acc-balance').value),
            bankName: type === 'bank' ? document.getElementById('acc-bank-name').value.trim() : '',
            accountNumber: type === 'bank' ? document.getElementById('acc-account-number').value.trim() : '',
            branch: type === 'bank' ? document.getElementById('acc-branch').value.trim() : '',
            iban: type === 'bank' ? document.getElementById('acc-iban').value.trim() : '',
        };
        if (editId) {
            // Preserve original createdAt
            const existing = await DB.get('capital_accounts', editId);
            if (existing) data.createdAt = existing.createdAt;
        } else {
            data.createdAt = new Date().toISOString();
        }
        await DB.put('capital_accounts', data);
        Utils.hideModal('account-modal');
        Utils.showToast(editId ? 'Account updated!' : 'Account added!');
        this.render();
    },

    // ── Add Transaction ──
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

    // ── Transfer ──
    async showTransferModal() {
        const accounts = await DB.getAll('capital_accounts');
        if (accounts.length < 2) {
            Utils.showToast('Need at least 2 accounts to transfer', 'error');
            return;
        }
        const opts = accounts.map(a => `<option value="${Utils.escapeHTML(a.id)}">${Utils.escapeHTML(a.name)}</option>`).join('');
        document.getElementById('xfer-from').innerHTML = opts;
        document.getElementById('xfer-to').innerHTML = opts;
        // Default the second dropdown to a different account
        if (accounts.length >= 2) document.getElementById('xfer-to').value = accounts[1].id;
        document.getElementById('xfer-amount').value = '';
        document.getElementById('xfer-date').value = Utils.todayISO();
        document.getElementById('xfer-desc').value = '';
        Utils.showModal('transfer-modal');
        Utils.safeCreateIcons();
    },

    async saveTransfer() {
        const fromId = document.getElementById('xfer-from').value;
        const toId = document.getElementById('xfer-to').value;
        const amount = Utils.pf(document.getElementById('xfer-amount').value);
        const date = document.getElementById('xfer-date').value;
        const desc = document.getElementById('xfer-desc').value.trim();

        if (!fromId || !toId) { Utils.showToast('Select both accounts', 'error'); return; }
        if (fromId === toId) { Utils.showToast('From and To accounts must be different', 'error'); return; }
        if (amount <= 0) { Utils.showToast('Amount must be greater than zero', 'error'); return; }

        const accounts = await DB.getAll('capital_accounts');
        const fromAcc = accounts.find(a => a.id === fromId);
        const toAcc = accounts.find(a => a.id === toId);
        const transferId = Utils.generateId();

        // Withdrawal from source
        await DB.put('capital_transactions', {
            id: Utils.generateId(),
            accountId: fromId,
            type: 'withdrawal',
            amount, date,
            description: desc || `Transfer to ${toAcc ? toAcc.name : 'Unknown'}`,
            transferId,
            isReconciled: false,
            createdAt: new Date().toISOString()
        });

        // Deposit to destination
        await DB.put('capital_transactions', {
            id: Utils.generateId(),
            accountId: toId,
            type: 'deposit',
            amount, date,
            description: desc || `Transfer from ${fromAcc ? fromAcc.name : 'Unknown'}`,
            transferId,
            isReconciled: false,
            createdAt: new Date().toISOString()
        });

        Utils.hideModal('transfer-modal');
        Utils.showToast(`PKR ${Utils.formatPKR(amount)} transferred!`);
        this.render();
    },

    // ── Delete Account ──
    async deleteAccount(id) {
        if (!await Utils.confirm('Delete this account and all its transactions?')) return;
        await DB.delete('capital_accounts', id);
        const txs = await DB.getByIndex('capital_transactions', 'accountId', id);
        for (const t of txs) await DB.delete('capital_transactions', t.id);
        Utils.showToast('Account deleted!');
        this.render();
    },

    // ── Delete Transaction ──
    async deleteTx(id) {
        if (!await Utils.confirm('Delete this transaction?')) return;
        // If it's a transfer, also delete the linked transaction
        const tx = await DB.get('capital_transactions', id);
        if (tx && tx.transferId) {
            const allTx = await DB.getAll('capital_transactions');
            const linked = allTx.filter(t => t.transferId === tx.transferId && t.id !== id);
            for (const lt of linked) await DB.delete('capital_transactions', lt.id);
        }
        await DB.delete('capital_transactions', id);
        Utils.showToast('Deleted!');
        this.render();
    },

    // ── Account Statement PDF ──
    async showStatementModal() {
        const accounts = await DB.getAll('capital_accounts');
        if (accounts.length === 0) {
            Utils.showToast('No accounts to generate statement for', 'error');
            return;
        }
        document.getElementById('stmt-account').innerHTML = accounts.map(a =>
            `<option value="${Utils.escapeHTML(a.id)}">${Utils.escapeHTML(a.name)} (${a.type})</option>`
        ).join('');
        document.getElementById('stmt-from').value = Utils.dateToISO(new Date(new Date().getFullYear(), 0, 1));
        document.getElementById('stmt-to').value = Utils.todayISO();
        Utils.showModal('statement-modal');
    },

    async generateStatement() {
        if (!Utils.requirePDF()) return;
        const accId = document.getElementById('stmt-account').value;
        const from = document.getElementById('stmt-from').value;
        const to = document.getElementById('stmt-to').value;
        if (!accId) { Utils.showToast('Select an account', 'error'); return; }

        const account = await DB.get('capital_accounts', accId);
        if (!account) { Utils.showToast('Account not found', 'error'); return; }

        const allTx = (await DB.getByIndex('capital_transactions', 'accountId', accId))
            .sort((a, b) => new Date(a.date) - new Date(b.date));

        // Calculate opening balance (all tx before from date)
        let openingBal = account.openingBalance || 0;
        if (from) {
            allTx.filter(t => t.date < from).forEach(t => {
                if (t.type === 'deposit') openingBal += t.amount;
                else openingBal -= t.amount;
            });
        }

        // Filter transactions in range
        const txInRange = allTx.filter(t =>
            (!from || t.date >= from) && (!to || t.date <= to)
        );

        // Build PDF
        const biz = {
            bizName: await DB.getSetting('bizName') || 'AgriSys',
            address: await DB.getSetting('address') || '',
            phone: await DB.getSetting('phone') || '',
            ownerName: await DB.getSetting('ownerName') || ''
        };

        const { jsPDF } = window.jspdf;
        const doc = new jsPDF('p', 'mm', 'a4');
        const pw = 210; // A4 width
        const mx = 15; // margin
        const cw = pw - mx * 2; // content width

        // ── Header ──
        let y = 15;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(16);
        doc.text((biz.bizName).toUpperCase(), pw / 2, y, { align: 'center' });
        y += 5;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        if (biz.address) { doc.text(biz.address, pw / 2, y, { align: 'center' }); y += 4; }
        if (biz.phone) { doc.text('Phone: ' + biz.phone, pw / 2, y, { align: 'center' }); y += 4; }
        if (biz.ownerName) { doc.text('Proprietor: ' + biz.ownerName, pw / 2, y, { align: 'center' }); y += 4; }

        // Double rule
        doc.setLineWidth(0.8);
        doc.line(mx, y, pw - mx, y);
        y += 1;
        doc.setLineWidth(0.3);
        doc.line(mx, y, pw - mx, y);
        y += 6;

        // ── Title ──
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(13);
        doc.text('ACCOUNT STATEMENT', pw / 2, y, { align: 'center' });
        y += 7;

        // ── Account Info Block ──
        doc.setFontSize(9);
        doc.setFont('helvetica', 'bold');
        doc.text('Account: ', mx, y);
        doc.setFont('helvetica', 'normal');
        doc.text(account.name, mx + 20, y);
        doc.setFont('helvetica', 'bold');
        doc.text('Type: ', pw / 2 + 10, y);
        doc.setFont('helvetica', 'normal');
        doc.text(account.type === 'bank' ? 'Bank Account' : 'Cash', pw / 2 + 22, y);
        y += 5;

        if (account.type === 'bank' && (account.bankName || account.accountNumber)) {
            doc.setFont('helvetica', 'bold');
            doc.text('Bank: ', mx, y);
            doc.setFont('helvetica', 'normal');
            doc.text(account.bankName || '-', mx + 20, y);
            if (account.accountNumber) {
                doc.setFont('helvetica', 'bold');
                doc.text('A/C #: ', pw / 2 + 10, y);
                doc.setFont('helvetica', 'normal');
                doc.text(account.accountNumber, pw / 2 + 25, y);
            }
            y += 5;
            if (account.branch) {
                doc.setFont('helvetica', 'bold');
                doc.text('Branch: ', mx, y);
                doc.setFont('helvetica', 'normal');
                doc.text(account.branch, mx + 20, y);
            }
            if (account.iban) {
                doc.setFont('helvetica', 'bold');
                doc.text('IBAN: ', pw / 2 + 10, y);
                doc.setFont('helvetica', 'normal');
                doc.text(account.iban, pw / 2 + 22, y);
            }
            y += 5;
        }

        // Period
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        const fromLabel = from ? Utils.formatDate(from) : 'Beginning';
        const toLabel = to ? Utils.formatDate(to) : 'Today';
        doc.text(`Statement Period: ${fromLabel} to ${toLabel}`, pw / 2, y, { align: 'center' });
        y += 4;

        doc.setLineWidth(0.3);
        doc.line(mx, y, pw - mx, y);
        y += 5;

        // ── Table Header ──
        const cols = [mx, mx + 25, mx + 85, mx + 115, mx + 145];
        const colLabels = ['Date', 'Description', 'Deposit', 'Withdrawal', 'Balance'];
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.text(colLabels[0], cols[0], y);
        doc.text(colLabels[1], cols[1], y);
        doc.text(colLabels[2], cols[2] + 25, y, { align: 'right' });
        doc.text(colLabels[3], cols[3] + 25, y, { align: 'right' });
        doc.text(colLabels[4], pw - mx, y, { align: 'right' });
        y += 2;
        doc.setLineWidth(0.5);
        doc.line(mx, y, pw - mx, y);
        y += 5;

        // ── Opening Balance Row ──
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.text(from ? Utils.formatDate(from) : '-', cols[0], y);
        doc.setFont('helvetica', 'bold');
        doc.text(from ? 'Balance Brought Forward' : 'Opening Balance', cols[1], y);
        doc.setFont('helvetica', 'normal');
        doc.text('PKR ' + Utils.formatPKR(openingBal), pw - mx, y, { align: 'right' });
        y += 5;

        // ── Transaction Rows ──
        let runBal = openingBal;
        let totalDep = 0;
        let totalWdr = 0;

        txInRange.forEach(t => {
            if (y > 270) {
                doc.addPage();
                y = 15;
            }
            const dep = t.type === 'deposit' ? t.amount : 0;
            const wdr = t.type === 'withdrawal' ? t.amount : 0;
            runBal += dep - wdr;
            totalDep += dep;
            totalWdr += wdr;

            doc.setFont('helvetica', 'normal');
            doc.setFontSize(7.5);
            doc.text(Utils.formatDate(t.date), cols[0], y);
            // Truncate long descriptions
            const descText = (t.description || '-').substring(0, 40);
            doc.text(descText, cols[1], y);
            if (dep > 0) doc.text('PKR ' + Utils.formatPKR(dep), cols[2] + 25, y, { align: 'right' });
            if (wdr > 0) doc.text('PKR ' + Utils.formatPKR(wdr), cols[3] + 25, y, { align: 'right' });
            doc.text('PKR ' + Utils.formatPKR(runBal), pw - mx, y, { align: 'right' });
            y += 4.5;
        });

        // ── Closing Summary ──
        y += 2;
        if (y > 265) { doc.addPage(); y = 15; }
        doc.setLineWidth(0.8);
        doc.line(mx, y, pw - mx, y);
        y += 5;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.text('SUMMARY', mx, y);
        y += 6;
        doc.setFontSize(8);
        doc.text('Total Deposits:', mx, y);
        doc.setFont('helvetica', 'normal');
        doc.text('PKR ' + Utils.formatPKR(totalDep), mx + 60, y);
        y += 5;
        doc.setFont('helvetica', 'bold');
        doc.text('Total Withdrawals:', mx, y);
        doc.setFont('helvetica', 'normal');
        doc.text('PKR ' + Utils.formatPKR(totalWdr), mx + 60, y);
        y += 5;
        doc.setFont('helvetica', 'bold');
        doc.text('Closing Balance:', mx, y);
        doc.setFont('helvetica', 'normal');
        doc.text('PKR ' + Utils.formatPKR(runBal), mx + 60, y);
        y += 8;

        // Footer
        doc.setFontSize(7);
        doc.setFont('helvetica', 'normal');
        doc.text(`Generated: ${new Date().toLocaleString()}`, pw / 2, y, { align: 'center' });

        const fileName = `Statement_${account.name.replace(/[^a-zA-Z0-9]/g, '_')}_${Utils.todayISO()}.pdf`;
        doc.save(fileName);
        Utils.hideModal('statement-modal');
        Utils.showToast('Statement PDF generated!');
    },

    // ── Excel Export ──
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
                    'Bank Name': a.bankName || '',
                    'Account Number': a.accountNumber || '',
                    'Branch': a.branch || '',
                    'IBAN': a.iban || '',
                    'Opening Balance': a.openingBalance || 0,
                    'Current Balance': (a.openingBalance || 0) + dep - wdr,
                    'Created At': Utils.formatDate(a.createdAt)
                };
            });
            XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(accRows), 'Accounts');
        }

        if (transactions.length) {
            const txRows = transactions.sort((a, b) => new Date(b.date) - new Date(a.date)).map(t => {
                const acc = accounts.find(a => a.id === t.accountId);
                return {
                    'Date': t.date,
                    'Account': acc ? acc.name : 'Unknown',
                    'Type': t.type,
                    'Description': t.description || '',
                    'Amount': t.amount,
                    'Transfer': t.transferId ? 'Yes' : 'No',
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
