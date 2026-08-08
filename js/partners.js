// ===== Partners & Profit Sharing Management Module =====
// Tracks partnership profiles, agreed profit sharing ratios (%), capital contributions, drawings, and profit distributions.
// Synchronizes with Bank Accounts, Bookkeeping Journals, Balance Sheets, Cash Flow Statements, and Excel backups.

const PartnersMgmt = {
    async render() {
        await this.renderStats();
        await this.renderTables();
    },

    // ── Calculate Business Net Profit (Retained Earnings before partner distributions) ──
    async getBusinessNetProfit() {
        const activeSeason = await Utils.getActiveSeason();
        const purchases = Utils.filterBySeason(await DB.getAll('purchases'), activeSeason);
        const sales = Utils.filterBySeason(await DB.getAll('sales'), activeSeason);
        const expenses = Utils.filterBySeason(await DB.getAll('expenses'), activeSeason);
        const operatingExpenses = expenses.filter(e => !e.purchaseId);

        const actualSales = sales.filter(s => s.type !== 'stock_adjustment');
        const virtualSales = sales.filter(s => s.type === 'stock_adjustment');
        const salesRev = actualSales.reduce((s, x) => s + (x.amount || 0), 0);
        const commRev = purchases.reduce((s, p) => s + (p.commissionTotal || 0), 0);
        const inventoryMetrics = Utils.calculateInventoryLots(purchases, sales, expenses);

        let cogs = 0;
        let invLoss = 0;
        if (typeof Reports !== 'undefined' && Reports.cogsForSales) {
            cogs = Reports.cogsForSales(actualSales, inventoryMetrics);
            invLoss = Reports.cogsForSales(virtualSales, inventoryMetrics);
        } else {
            cogs = actualSales.reduce((s, x) => {
                const lot = inventoryMetrics.cropMap && inventoryMetrics.cropMap[x.crop];
                const avgRate = lot ? lot.avgRate : 0;
                return s + ((x.netWeight || x.grossWeight || 0) / 40) * avgRate;
            }, 0);
        }
        const opExp = operatingExpenses.reduce((s, e) => s + (e.amount || 0), 0);
        return (salesRev + commRev) - cogs - invLoss - opExp;
    },

    // ── Partners Summary Helper ──
    async getPartnersSummary(scopedPartners, scopedTxs) {
        const activeSeason = await Utils.getActiveSeason();
        const partners = scopedPartners || await DB.getAll('partners') || [];
        const transactions = scopedTxs || Utils.filterBySeason(await DB.getAll('partner_transactions') || [], activeSeason);
        const netProfit = await this.getBusinessNetProfit();

        let totalContributions = 0;
        let totalDrawings = 0;
        let totalProfitPayouts = 0;
        let totalAllocatedProfit = 0;
        let totalPercentage = 0;

        const partnerDetails = partners.map(p => {
            const pTxs = transactions.filter(t => t.partnerId === p.id);
            const contributions = pTxs.filter(t => t.type === 'contribution').reduce((s, t) => s + (t.amount || 0), 0);
            const drawings = pTxs.filter(t => t.type === 'drawing').reduce((s, t) => s + (t.amount || 0), 0);
            const profitPayouts = pTxs.filter(t => t.type === 'profit_payout').reduce((s, t) => s + (t.amount || 0), 0);
            const sharePerc = Utils.pf(p.sharePercentage || 0);
            
            // Allocated profit share based on ratio
            const allocatedProfit = netProfit > 0 ? (netProfit * (sharePerc / 100)) : (netProfit * (sharePerc / 100));
            const netEquity = contributions + allocatedProfit - drawings - profitPayouts;

            totalContributions += contributions;
            totalDrawings += drawings;
            totalProfitPayouts += profitPayouts;
            totalAllocatedProfit += allocatedProfit;
            totalPercentage += sharePerc;

            return {
                ...p,
                contributions,
                drawings,
                profitPayouts,
                allocatedProfit,
                netEquity,
                transactions: pTxs
            };
        });

        return {
            partners: partnerDetails,
            transactions,
            totalContributions,
            totalDrawings,
            totalProfitPayouts,
            totalAllocatedProfit,
            totalPercentage,
            netPartnerCapital: totalContributions - totalDrawings - totalProfitPayouts,
            businessNetProfit: netProfit
        };
    },

    // ── Render Stats & Allocation Bar ──
    async renderStats() {
        const summary = await this.getPartnersSummary();
        const statsContainer = document.getElementById('partners-mgmt-stats');
        const barContainer = document.getElementById('partners-allocation-bar');

        if (statsContainer) {
            statsContainer.innerHTML = `
                <div class="stat-card green">
                    <div class="stat-label">Total Partners Capital</div>
                    <div class="stat-value">PKR ${Utils.formatPKR(summary.totalContributions)}</div>
                    <div class="stat-sub">${summary.partners.length} active partner${summary.partners.length === 1 ? '' : 's'}</div>
                </div>
                <div class="stat-card orange">
                    <div class="stat-label">Drawings & Payouts</div>
                    <div class="stat-value">PKR ${Utils.formatPKR(summary.totalDrawings + summary.totalProfitPayouts)}</div>
                    <div class="stat-sub">Drawings: ${Utils.formatPKR(summary.totalDrawings)} | Payouts: ${Utils.formatPKR(summary.totalProfitPayouts)}</div>
                </div>
                <div class="stat-card blue">
                    <div class="stat-label">Total Business Net Profit</div>
                    <div class="stat-value" style="color:${summary.businessNetProfit >= 0 ? 'var(--accent-success)' : 'var(--accent-danger)'}">
                        PKR ${Utils.formatPKR(summary.businessNetProfit)}
                    </div>
                    <div class="stat-sub">Allocated across agreed partner % ratios</div>
                </div>
                <div class="stat-card purple">
                    <div class="stat-label">Net Partners Equity</div>
                    <div class="stat-value">PKR ${Utils.formatPKR(summary.totalContributions + summary.totalAllocatedProfit - summary.totalDrawings - summary.totalProfitPayouts)}</div>
                    <div class="stat-sub">Capital + Profit Share − Withdrawals</div>
                </div>
            `;
        }

        if (barContainer) {
            let barHtml = '';
            let alertClass = 'badge-success';
            let alertMsg = '100% Fully Allocated';

            if (Math.abs(summary.totalPercentage - 100) > 0.01) {
                if (summary.totalPercentage > 100) {
                    alertClass = 'badge-danger';
                    alertMsg = `⚠️ Overallocation Warning (${summary.totalPercentage.toFixed(1)}% Total > 100%)`;
                } else {
                    alertClass = 'badge-warning';
                    alertMsg = `ℹ️ Underallocated (${summary.totalPercentage.toFixed(1)}% Allocated out of 100%)`;
                }
            }

            const colors = ['var(--accent-primary)', 'var(--accent-success)', 'var(--accent-warning)', 'var(--accent-danger)', 'var(--accent-info)', '#8b5cf6', '#ec4899', '#f97316'];
            const barSegments = summary.partners.map((p, idx) => {
                const perc = Math.min(100, Math.max(0, p.sharePercentage || 0));
                return `<div style="background:${colors[idx % colors.length]}; width:${perc}%; height:22px; display:inline-block; title:'${Utils.escapeHTML(p.name)} (${perc}%)'"></div>`;
            }).join('');

            const legend = summary.partners.map((p, idx) => `
                <span style="margin-right: 15px; display: inline-flex; align-items: center; font-size: 0.85rem;">
                    <span style="display:inline-block; width:12px; height:12px; background:${colors[idx % colors.length]}; border-radius:3px; margin-right:5px;"></span>
                    <strong>${Utils.escapeHTML(p.name)}</strong>: ${Utils.pf(p.sharePercentage)}%
                </span>
            `).join('');

            barContainer.innerHTML = `
                <div class="card" style="margin-bottom: 20px; padding: 15px 20px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 10px;">
                        <span style="font-weight:bold; color: var(--text-color);">🤝 Profit Sharing Ratio & Allocation</span>
                        <span class="badge ${alertClass}" style="font-size: 0.8rem;">${alertMsg}</span>
                    </div>
                    <div style="width:100%; background: var(--border-color); border-radius: 6px; overflow:hidden; display:flex; margin-bottom: 10px;">
                        ${barSegments || '<div style="padding:4px 10px; font-size:0.8rem; color:var(--text-muted);">No partners configured yet.</div>'}
                    </div>
                    <div style="display:flex; flex-wrap:wrap; margin-top:5px;">
                        ${legend}
                    </div>
                </div>
            `;
        }
    },

    // ── Render Tables (Partners list & Transactions history) ──
    async renderTables() {
        const summary = await this.getPartnersSummary();
        const partnersTbody = document.getElementById('partners-summary-tbody');
        const txTbody = document.getElementById('partner-tx-tbody');

        if (partnersTbody) {
            const rows = summary.partners.map(p => {
                return `<tr>
                    <td class="font-bold">
                        <a href="javascript:void(0)" onclick="PartnersMgmt.showLedger('${p.id}')" style="color:var(--accent-primary); text-decoration:none;">
                            ${Utils.escapeHTML(p.name)}
                        </a>
                        <div style="font-size:0.75rem; color:var(--text-muted)">${Utils.escapeHTML(p.role || 'Partner')}</div>
                    </td>
                    <td>${Utils.escapeHTML(p.phone || '—')}</td>
                    <td class="text-center font-bold" style="color:var(--accent-primary); font-size:1.05rem;">${Utils.pf(p.sharePercentage)}%</td>
                    <td class="text-right" style="color:var(--accent-success)">+PKR ${Utils.formatPKR(p.contributions)}</td>
                    <td class="text-right font-bold" style="color:${p.allocatedProfit >= 0 ? 'var(--accent-success)' : 'var(--accent-danger)'}">
                        ${p.allocatedProfit >= 0 ? '+' : '−'}PKR ${Utils.formatPKR(Math.abs(p.allocatedProfit))}
                    </td>
                    <td class="text-right" style="color:var(--accent-warning)">−PKR ${Utils.formatPKR(p.profitPayouts)}</td>
                    <td class="text-right" style="color:var(--accent-danger)">−PKR ${Utils.formatPKR(p.drawings)}</td>
                    <td class="text-right font-bold" style="color:var(--text-color); font-size:1.05rem;">PKR ${Utils.formatPKR(p.netEquity)}</td>
                    <td class="text-center">
                        <button class="btn btn-icon btn-secondary btn-sm" title="View Partner Statement / Ledger" onclick="PartnersMgmt.showLedger('${p.id}')">📊</button>
                        <button class="btn btn-icon btn-secondary btn-sm" title="Add Transaction for Partner" onclick="PartnersMgmt.showAddTx('contribution', '${p.id}')">⚡</button>
                        <button class="btn btn-icon btn-secondary btn-sm" title="Edit Partner" onclick="PartnersMgmt.showAddPartner('${p.id}')">✎</button>
                        <button class="btn btn-icon btn-danger btn-sm" title="Delete Partner" onclick="PartnersMgmt.deletePartner('${p.id}')">🗑️</button>
                    </td>
                </tr>`;
            });
            partnersTbody.innerHTML = rows.join('') || 
                '<tr><td colspan="9" class="text-center" style="color:var(--text-muted); padding:25px;">No partners found. Click <strong>+ Add Partner</strong> to define partners and their profit sharing percentages.</td></tr>';
        }

        if (txTbody) {
            const accounts = await DB.getAll('capital_accounts') || [];
            const sortedTxs = (summary.transactions || []).sort((a, b) => new Date(b.date || '') - new Date(a.date || ''));
            
            const rows = sortedTxs.map(t => {
                const partner = summary.partners.find(p => p.id === t.partnerId);
                const acc = t.accountId ? accounts.find(a => a.id === t.accountId) : null;
                
                let badge = '<span class="badge badge-success">↑ Contribution</span>';
                if (t.type === 'drawing') badge = '<span class="badge badge-danger">↓ Drawing</span>';
                if (t.type === 'profit_payout') badge = '<span class="badge badge-warning">💸 Profit Payout</span>';

                const sign = t.type === 'contribution' ? '+' : '−';
                const color = t.type === 'contribution' ? 'var(--accent-success)' : 'var(--accent-danger)';

                return `<tr>
                    <td>${Utils.formatDate(t.date)}</td>
                    <td class="font-bold">${partner ? Utils.escapeHTML(partner.name) : 'Unknown Partner'}</td>
                    <td>${badge}</td>
                    <td>${Utils.escapeHTML(t.description || '—')}</td>
                    <td>${acc ? Utils.escapeHTML(acc.name) : '<span style="color:var(--text-muted)">—</span>'}</td>
                    <td class="text-right font-bold" style="color:${color}">${sign}PKR ${Utils.formatPKR(t.amount)}</td>
                    <td class="text-center">
                        <button class="btn btn-icon btn-danger btn-sm" onclick="PartnersMgmt.deleteTx('${t.id}')" title="Delete Transaction">🗑️</button>
                    </td>
                </tr>`;
            });

            txTbody.innerHTML = rows.join('') ||
                '<tr><td colspan="7" class="text-center" style="color:var(--text-muted); padding:25px;">No partner transactions recorded in this fiscal period.</td></tr>';
        }
    },

    // ── Show Add/Edit Partner Modal ──
    async showAddPartner(partnerId = null) {
        let partner = { id: '', name: '', phone: '', role: 'Managing Partner', sharePercentage: '', address: '', notes: '' };
        if (partnerId) {
            const existing = await DB.get('partners', partnerId);
            if (existing) partner = existing;
        }

        document.getElementById('partner-edit-id').value = partner.id || '';
        document.getElementById('partner-modal-title').textContent = partner.id ? 'Edit Partner Profile & Share' : 'Add New Partner & Profit Ratio';
        document.getElementById('partner-input-name').value = partner.name || '';
        document.getElementById('partner-input-phone').value = partner.phone || '';
        document.getElementById('partner-input-role').value = partner.role || 'Managing Partner';
        document.getElementById('partner-input-share').value = partner.sharePercentage !== undefined ? partner.sharePercentage : '';
        document.getElementById('partner-input-address').value = partner.address || '';
        document.getElementById('partner-input-notes').value = partner.notes || '';

        Utils.showModal('partner-modal');
    },

    // ── Save Partner ──
    async savePartner() {
        const id = document.getElementById('partner-edit-id').value || Utils.generateId();
        const name = document.getElementById('partner-input-name').value.trim();
        const phone = document.getElementById('partner-input-phone').value.trim();
        const role = document.getElementById('partner-input-role').value || 'Partner';
        const sharePercentage = Utils.pf(document.getElementById('partner-input-share').value);
        const address = document.getElementById('partner-input-address').value.trim();
        const notes = document.getElementById('partner-input-notes').value.trim();

        if (!name) { Utils.showToast('Partner name is required', 'error'); return; }
        if (sharePercentage < 0 || sharePercentage > 100) {
            Utils.showToast('Share percentage must be between 0 and 100', 'error');
            return;
        }

        // Check overall allocation
        const allPartners = await DB.getAll('partners') || [];
        const otherPartners = allPartners.filter(p => p.id !== id);
        const otherSum = otherPartners.reduce((s, p) => s + (Utils.pf(p.sharePercentage) || 0), 0);
        const newTotal = otherSum + sharePercentage;

        if (newTotal > 100.01) {
            const ok = await Utils.confirm(`Adding this percentage brings total allocation to ${newTotal.toFixed(1)}% (which exceeds 100%). Continue anyway?`);
            if (!ok) return;
        }

        const existing = await DB.get('partners', id);
        await DB.put('partners', {
            id,
            name,
            phone,
            role,
            sharePercentage,
            address,
            notes,
            status: existing ? existing.status || 'Active' : 'Active',
            createdAt: existing ? existing.createdAt : new Date().toISOString()
        });

        Utils.closeModal('partner-modal');
        Utils.showToast(existing ? 'Partner profile updated!' : 'New partner added!');
        await this.render();
    },

    // ── Delete Partner ──
    async deletePartner(id) {
        const partner = await DB.get('partners', id);
        if (!partner) return;
        
        const txs = await DB.getAll('partner_transactions') || [];
        const linked = txs.filter(t => t.partnerId === id);

        let msg = `Delete partner "${partner.name}"?`;
        if (linked.length > 0) {
            msg = `Partner "${partner.name}" has ${linked.length} linked transactions. Only the profile will be removed. Continue?`;
        }
        if (!await Utils.confirm(msg)) return;

        await DB.delete('partners', id);
        Utils.showToast('Partner deleted!');
        await this.render();
    },

    // ── Show Add Transaction Modal ──
    async showAddTx(type = 'contribution', defaultPartnerId = '') {
        const partners = await DB.getAll('partners') || [];
        if (!partners.length) {
            Utils.showToast('Please add at least one partner first.', 'warning');
            return;
        }

        document.getElementById('partner-tx-type').value = type;
        this.onTxTypeChange();

        const pSel = document.getElementById('partner-tx-partner');
        pSel.innerHTML = partners.map(p => `<option value="${p.id}" ${p.id === defaultPartnerId ? 'selected' : ''}>${Utils.escapeHTML(p.name)} (${Utils.pf(p.sharePercentage)}% share)</option>`).join('');
        if (defaultPartnerId) pSel.value = defaultPartnerId;

        document.getElementById('partner-tx-amount').value = '';
        document.getElementById('partner-tx-date').value = Utils.todayISO();
        document.getElementById('partner-tx-desc').value = '';

        // Populate bank account dropdown
        const accounts = await DB.getAll('capital_accounts') || [];
        const accSel = document.getElementById('partner-tx-account');
        accSel.innerHTML = '<option value="">— None (No bank account link) —</option>' +
            accounts.map(a => `<option value="${a.id}">${Utils.escapeHTML(a.name)} (${a.type} - Bal: ${Utils.formatPKR(a.balance)})</option>`).join('');
        if (accounts.length > 0) accSel.value = accounts[0].id;

        Utils.showModal('partner-tx-modal');
    },

    // ── Handle UI changes on Transaction Type select ──
    onTxTypeChange() {
        const type = document.getElementById('partner-tx-type').value;
        const titleEl = document.getElementById('partner-tx-title');
        const descPlaceholder = document.getElementById('partner-tx-desc');
        if (type === 'contribution') {
            if (titleEl) titleEl.textContent = 'Record Partner Capital Contribution (+)';
            if (descPlaceholder) descPlaceholder.placeholder = 'e.g. Initial capital deposit, Business expansion funding...';
        } else if (type === 'drawing') {
            if (titleEl) titleEl.textContent = 'Record Partner Personal Drawing (−)';
            if (descPlaceholder) descPlaceholder.placeholder = 'e.g. Monthly personal withdrawal, advance drawing...';
        } else if (type === 'profit_payout') {
            if (titleEl) titleEl.textContent = 'Record Profit Share Payout (−)';
            if (descPlaceholder) descPlaceholder.placeholder = 'e.g. Quarterly profit distribution, final season payout...';
        }
    },

    // ── Save Partner Transaction ──
    async saveTx() {
        const type = document.getElementById('partner-tx-type').value;
        const partnerId = document.getElementById('partner-tx-partner').value;
        const amount = Utils.pf(document.getElementById('partner-tx-amount').value);
        const date = document.getElementById('partner-tx-date').value || Utils.todayISO();
        const desc = document.getElementById('partner-tx-desc').value.trim();
        const accountId = document.getElementById('partner-tx-account').value || null;

        if (!partnerId) { Utils.showToast('Please select a partner', 'error'); return; }
        if (amount <= 0) { Utils.showToast('Amount must be greater than zero', 'error'); return; }

        const partner = await DB.get('partners', partnerId);
        const txId = Utils.generateId();
        let linkedTxId = null;
        const ops = [];

        // 1. Link with Bank / Cash Account if specified
        if (accountId) {
            linkedTxId = Utils.generateId();
            const bankTxType = type === 'contribution' ? 'deposit' : 'withdrawal';
            const bankDesc = desc || `Partner ${type.replace('_', ' ')} (${partner ? partner.name : ''})`;

            ops.push({
                storeName: 'capital_transactions',
                action: 'put',
                data: {
                    id: linkedTxId,
                    accountId,
                    date,
                    type: bankTxType,
                    amount,
                    description: bankDesc,
                    sourceStore: 'partner_transactions',
                    sourceId: txId
                }
            });
        }

        // 2. Save Partner Transaction
        const record = {
            id: txId,
            partnerId,
            date,
            type,
            amount,
            accountId,
            linkedTxId,
            description: desc || `Partner ${type.replace('_', ' ')}`,
            createdAt: new Date().toISOString()
        };
        ops.push({ storeName: 'partner_transactions', action: 'put', data: record });

        await DB.commitUnitOfWork(ops);

        // 3. Record Double-Entry Bookkeeping Journal
        if (typeof Bookkeeping !== 'undefined' && Bookkeeping.recordPartnerTx) {
            await Bookkeeping.recordPartnerTx(record, partner);
        }

        Utils.closeModal('partner-tx-modal');
        Utils.showToast('Partner transaction saved and synchronized!');
        await this.render();
    },

    // ── Delete Partner Transaction ──
    async deleteTx(id) {
        if (!await Utils.confirm('Delete this partner transaction? This will automatically adjust linked Bank Account balances and remove bookkeeping journal records.')) return;

        const tx = await DB.get('partner_transactions', id);
        if (!tx) return;

        const ops = [];

        // 1. Clean up linked Bank Transaction
        if (tx.linkedTxId) {
            const linked = await DB.get('capital_transactions', tx.linkedTxId);
            if (linked) {
                ops.push({ storeName: 'capital_transactions', action: 'delete', key: tx.linkedTxId, softDelete: true, data: linked });
            }
        } else {
            // Check if there are implicitly linked transactions
            const allTxs = await DB.getAll('capital_transactions') || [];
            const implicitlyLinked = allTxs.filter(t => t.sourceStore === 'partner_transactions' && t.sourceId === id);
            for (const lt of implicitlyLinked) {
                ops.push({ storeName: 'capital_transactions', action: 'delete', key: lt.id, softDelete: true, data: lt });
            }
        }

        // 2. Clean up linked Journal Entry
        if (typeof Bookkeeping !== 'undefined' && Bookkeeping.deleteByRef) {
            await Bookkeeping.deleteByRef(id);
        }

        ops.push({ storeName: 'partner_transactions', action: 'delete', key: id, softDelete: true, data: tx });
        await DB.commitUnitOfWork(ops);

        Utils.showToast('Partner transaction deleted and balances restored!');
        await this.render();
    },

    // ── Show Interactive Partner Ledger / Statement ──
    async showLedger(partnerId) {
        const summary = await this.getPartnersSummary();
        const partner = summary.partners.find(p => p.id === partnerId);
        if (!partner) { Utils.showToast('Partner not found', 'error'); return; }

        document.getElementById('partner-ledger-title').innerHTML = `
            🤝 Partner Statement: <strong>${Utils.escapeHTML(partner.name)}</strong> (${Utils.pf(partner.sharePercentage)}% Profit Share)
        `;

        // Build chronological statement rows
        const txs = partner.transactions.slice().sort((a, b) => new Date(a.date || '') - new Date(b.date || ''));
        let runningEquity = 0;
        
        const rows = txs.map(t => {
            let credit = 0;
            let debit = 0;
            let label = 'Contribution';
            if (t.type === 'contribution') { credit = t.amount || 0; runningEquity += credit; }
            else if (t.type === 'drawing') { debit = t.amount || 0; runningEquity -= debit; label = 'Drawing'; }
            else if (t.type === 'profit_payout') { debit = t.amount || 0; runningEquity -= debit; label = 'Profit Payout'; }

            return `<tr>
                <td>${Utils.formatDate(t.date)}</td>
                <td><span class="badge ${credit > 0 ? 'badge-success' : 'badge-danger'}">${label}</span></td>
                <td>${Utils.escapeHTML(t.description || '—')}</td>
                <td class="text-right font-bold" style="color:var(--accent-success)">${credit > 0 ? 'PKR ' + Utils.formatPKR(credit) : '—'}</td>
                <td class="text-right font-bold" style="color:var(--accent-danger)">${debit > 0 ? 'PKR ' + Utils.formatPKR(debit) : '—'}</td>
                <td class="text-right font-bold">PKR ${Utils.formatPKR(runningEquity)}</td>
            </tr>`;
        });

        // Add Current Earned Profit Share Summary row at bottom
        if (partner.allocatedProfit !== 0) {
            runningEquity += partner.allocatedProfit;
            rows.push(`<tr style="background:var(--card-bg); font-weight:bold; border-top: 2px solid var(--border-color);">
                <td>${Utils.formatDate(Utils.todayISO())}</td>
                <td><span class="badge badge-info">💡 Share Allocation</span></td>
                <td>Current Season Allocated Profit Share (${Utils.pf(partner.sharePercentage)}% of Business Net Profit)</td>
                <td class="text-right" style="color:${partner.allocatedProfit >= 0 ? 'var(--accent-success)' : 'var(--accent-danger)'}">
                    ${partner.allocatedProfit >= 0 ? 'PKR ' + Utils.formatPKR(partner.allocatedProfit) : '—'}
                </td>
                <td class="text-right" style="color:var(--accent-danger)">
                    ${partner.allocatedProfit < 0 ? 'PKR ' + Utils.formatPKR(Math.abs(partner.allocatedProfit)) : '—'}
                </td>
                <td class="text-right" style="color:var(--accent-primary); font-size:1.1rem;">PKR ${Utils.formatPKR(runningEquity)}</td>
            </tr>`);
        }

        document.getElementById('partner-ledger-tbody').innerHTML = rows.join('') ||
            '<tr><td colspan="6" class="text-center" style="color:var(--text-muted); padding:20px;">No transaction history for this partner.</td></tr>';

        // Bind quick action buttons in modal
        const btnBox = document.getElementById('partner-ledger-actions');
        if (btnBox) {
            btnBox.innerHTML = `
                <button class="btn btn-secondary" onclick="PartnersMgmt.shareWhatsApp('${partner.id}')">💬 Share WhatsApp</button>
                <button class="btn btn-primary" onclick="PartnersMgmt.exportPDF('${partner.id}')">🖨️ Print Statement (PDF)</button>
            `;
        }

        Utils.showModal('partner-ledger-modal');
    },

    // ── WhatsApp Share ──
    async shareWhatsApp(partnerId) {
        const summary = await this.getPartnersSummary();
        const p = summary.partners.find(x => x.id === partnerId);
        if (!p) return;

        const lines = [
            `🤝 *PARTNERSHIP ACCOUNT STATEMENT*`,
            `🏢 *Firm:* AgriSys ERP`,
            `👤 *Partner:* ${p.name} (${p.role || 'Partner'})`,
            `📊 *Profit Share Ratio:* ${Utils.pf(p.sharePercentage)}%`,
            `📅 *As of Date:* ${Utils.formatDate(Utils.todayISO())}`,
            `--------------------------------`,
            `💰 *Capital Contributed:* PKR ${Utils.formatPKR(p.contributions)}`,
            `📈 *Earned Profit Share:* PKR ${Utils.formatPKR(p.allocatedProfit)}`,
            `💸 *Profit Payouts Taken:* −PKR ${Utils.formatPKR(p.profitPayouts)}`,
            `📉 *Personal Drawings:* −PKR ${Utils.formatPKR(p.drawings)}`,
            `--------------------------------`,
            `💎 *NET PARTNER EQUITY:* PKR ${Utils.formatPKR(p.netEquity)}`,
            `--------------------------------`,
            `Generated via AgriSys ERP`
        ];

        const text = encodeURIComponent(lines.join('\n'));
        const url = p.phone ? `https://wa.me/${p.phone.replace(/[^0-9]/g, '')}?text=${text}` : `https://api.whatsapp.com/send?text=${text}`;
        window.open(url, '_blank');
    },

    // ── Professional jsPDF Partner Statement ──
    async exportPDF(partnerId) {
        const summary = await this.getPartnersSummary();
        const p = summary.partners.find(x => x.id === partnerId);
        if (!p) { Utils.showToast('Partner not found', 'error'); return; }
        if (typeof jspdf === 'undefined') { Utils.showToast('jsPDF library not loaded', 'error'); return; }

        const biz = await Settings.getBusiness();
        const doc = new jspdf.jsPDF();
        const pageW = doc.internal.pageSize.getWidth();

        // Title & Header
        let y = ReceiptPDF.drawReportHeader(doc, biz, 'PARTNERSHIP CAPITAL & PROFIT STATEMENT');

        // Partner details box
        doc.setFontSize(10);
        doc.text(`Partner Name: ${p.name}`, 15, y + 8);
        doc.text(`Role / Designation: ${p.role || 'Partner'}`, 15, y + 14);
        doc.text(`Contact Phone: ${p.phone || 'N/A'}`, 15, y + 20);

        doc.text(`Profit Sharing Ratio: ${Utils.pf(p.sharePercentage)}%`, pageW - 80, y + 8);
        doc.text(`Statement Date: ${Utils.formatDate(Utils.todayISO())}`, pageW - 80, y + 14);
        doc.text(`Business Net Profit: PKR ${Utils.formatPKR(summary.businessNetProfit)}`, pageW - 80, y + 20);
        
        y += 28;

        // Table Data
        const txs = p.transactions.slice().sort((a, b) => new Date(a.date || '') - new Date(b.date || ''));
        let bal = 0;
        const body = txs.map(t => {
            let debit = '';
            let credit = '';
            let typeStr = 'Contribution';
            if (t.type === 'contribution') { credit = 'PKR ' + Utils.formatPKR(t.amount); bal += t.amount; }
            else if (t.type === 'drawing') { debit = 'PKR ' + Utils.formatPKR(t.amount); bal -= t.amount; typeStr = 'Drawing'; }
            else if (t.type === 'profit_payout') { debit = 'PKR ' + Utils.formatPKR(t.amount); bal -= t.amount; typeStr = 'Profit Payout'; }
            
            return [
                Utils.formatDate(t.date),
                typeStr,
                t.description || '',
                credit,
                debit,
                'PKR ' + Utils.formatPKR(bal)
            ];
        });

        // Add Earned Profit Share summary line
        if (p.allocatedProfit !== 0) {
            bal += p.allocatedProfit;
            body.push([
                Utils.formatDate(Utils.todayISO()),
                'Share Allocation',
                `Earned Profit Share (${Utils.pf(p.sharePercentage)}% of Firm Net Profit)`,
                p.allocatedProfit >= 0 ? 'PKR ' + Utils.formatPKR(p.allocatedProfit) : '',
                p.allocatedProfit < 0 ? 'PKR ' + Utils.formatPKR(Math.abs(p.allocatedProfit)) : '',
                'PKR ' + Utils.formatPKR(bal)
            ]);
        }

        if (typeof doc.autoTable === 'function') {
            doc.autoTable({
                startY: y,
                head: [['Date', 'Type', 'Description / Memo', 'Contributions (+)', 'Withdrawals (−)', 'Balance']],
                body: body.length ? body : [['—', '—', 'No transactions found for this period.', '—', '—', 'PKR 0']],
                theme: 'plain',
                styles: { fontSize: 9, cellPadding: 3, font: 'helvetica' },
                headStyles: { fontStyle: 'bold', lineWidth: 0.2, lineColor: [0,0,0] },
                bodyStyles: { textColor: [0,0,0] },
                columnStyles: {
                    3: { halign: 'right' },
                    4: { halign: 'right' },
                    5: { halign: 'right', fontStyle: 'bold' }
                }
            });
        }
        const finalY = doc.lastAutoTable ? doc.lastAutoTable.finalY + 15 : y + 15;
        doc.setFont('helvetica', 'bold');
        doc.text(`Net Partner Equity Balance: PKR ${Utils.formatPKR(p.netEquity)}`, pageW - 15, finalY, { align: 'right' });

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.text('Authorized Signature: _______________________', 15, finalY + 25);
        doc.text('Partner Signature: _______________________', pageW - 80, finalY + 25);

        ReceiptPDF.drawReportFooter(doc);
        
        doc.save(`Partner_Statement_${p.name.replace(/\s+/g, '_')}_${Utils.todayISO()}.pdf`);
        Utils.showToast('Partner statement PDF downloaded!');
    },

    // ── Excel Export (Two-Sheet Spreadsheet) ──
    async exportExcel() {
        if (!Utils.requireExcel()) return;
        Utils.showLoading('Exporting Partners Spreadsheet...');
        const summary = await this.getPartnersSummary();

        const wb = XLSX.utils.book_new();

        // Sheet 1: Partners Summary & Ratios
        const pRows = summary.partners.map(p => ({
            'Partner Name': p.name,
            'Role / Designation': p.role || 'Partner',
            'Phone': p.phone || '',
            'Profit Share Ratio (%)': Utils.pf(p.sharePercentage) + '%',
            'Capital Contributed (PKR)': p.contributions,
            'Allocated Profit Share (PKR)': p.allocatedProfit,
            'Profit Payouts Taken (PKR)': p.profitPayouts,
            'Personal Drawings (PKR)': p.drawings,
            'Net Partner Equity (PKR)': p.netEquity,
            'Status': p.status || 'Active',
            'Notes / Address': [p.notes, p.address].filter(Boolean).join(' - ')
        }));
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(pRows.length ? pRows : [{ Info: 'No partners defined' }]), 'Partners Summary');

        // Sheet 2: Partner Transactions Ledger
        const tRows = (summary.transactions || []).map(t => {
            const partner = summary.partners.find(p => p.id === t.partnerId);
            return {
                'Transaction ID': t.id,
                'Date': t.date,
                'Partner Name': partner ? partner.name : 'Unknown Partner',
                'Type': t.type === 'contribution' ? 'Capital Contribution' : (t.type === 'drawing' ? 'Personal Drawing' : 'Profit Payout'),
                'Amount (PKR)': t.amount,
                'Linked Bank Tx ID': t.linkedTxId || '',
                'Description / Memo': t.description || ''
            };
        });
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(tRows.length ? tRows : [{ Info: 'No partner transactions recorded' }]), 'Partner Transactions');

        XLSX.writeFile(wb, `AgriSys_Partners_Share_${Utils.todayISO()}.xlsx`);
        Utils.hideLoading();
        Utils.showToast('Excel spreadsheet exported!');
    }
};
