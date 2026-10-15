// ===== Settings Module =====
const Settings = {
    defaults: {
        bizName: '',
        address: '',
        phone: '',
        crops: 'Wheat,Rice,Cotton,Potato,Maize,Sugarcane,Misc',
        expenseTypes: 'Labour,Transport,Diesel,Rent,Utility,Misc',
        perBagWeight: 100,
        defaultBardana: 1,
        defaultLabour: 0.5,
        defaultCommission: 2.0,
        defaultMandiTax: 1.0,
        receiptTemplate: {
            footerText: 'Thank you for your business',
            copyLayout: 'two-copy',
            showQR: true,
            showSignatures: true,
            showOwner: true
        }
    },

    async init() {
        const biz = await DB.getSetting('business');
        const defs = await DB.getSetting('defaults');
        const template = await this.getReceiptTemplate();
        if (biz) {
            document.getElementById('set-biz-name').value = biz.bizName || '';
            document.getElementById('set-address').value = biz.address || '';
            document.getElementById('set-phone').value = biz.phone || '';
            document.getElementById('set-owner-name').value = biz.ownerName || '';
            document.getElementById('set-crops').value = biz.crops || '';
            document.getElementById('set-expense-types').value = biz.expenseTypes || this.defaults.expenseTypes;
        } else {
            document.getElementById('set-biz-name').value = '';
            document.getElementById('set-address').value = '';
            document.getElementById('set-phone').value = '';
            document.getElementById('set-owner-name').value = '';
            document.getElementById('set-crops').value = this.defaults.crops;
            document.getElementById('set-expense-types').value = this.defaults.expenseTypes;
        }
        if (defs) {
            document.getElementById('set-per-bag').value = (defs.perBagWeight !== undefined && defs.perBagWeight !== null && defs.perBagWeight !== '') ? defs.perBagWeight : 100;
            document.getElementById('set-bardana').value = (defs.defaultBardana !== undefined && defs.defaultBardana !== null && defs.defaultBardana !== '') ? defs.defaultBardana : 1;
            document.getElementById('set-labour').value = (defs.defaultLabour !== undefined && defs.defaultLabour !== null && defs.defaultLabour !== '') ? defs.defaultLabour : 0.5;
            if (document.getElementById('set-commission')) {
                document.getElementById('set-commission').value = (defs.defaultCommission !== undefined && defs.defaultCommission !== null && defs.defaultCommission !== '') ? defs.defaultCommission : 2.0;
            }
            if (document.getElementById('set-mandi-tax')) {
                document.getElementById('set-mandi-tax').value = (defs.defaultMandiTax !== undefined && defs.defaultMandiTax !== null && defs.defaultMandiTax !== '') ? defs.defaultMandiTax : 1.0;
            }
        } else {
            document.getElementById('set-per-bag').value = this.defaults.perBagWeight;
            document.getElementById('set-bardana').value = this.defaults.defaultBardana;
            document.getElementById('set-labour').value = this.defaults.defaultLabour;
            if (document.getElementById('set-commission')) document.getElementById('set-commission').value = this.defaults.defaultCommission;
            if (document.getElementById('set-mandi-tax')) document.getElementById('set-mandi-tax').value = this.defaults.defaultMandiTax;
        }
        const footer = document.getElementById('set-receipt-footer');
        if (footer) {
            footer.value = template.footerText || '';
            document.getElementById('set-receipt-layout').value = template.copyLayout || 'two-copy';
            document.getElementById('set-receipt-qr').checked = template.showQR !== false;
            document.getElementById('set-receipt-signatures').checked = template.showSignatures !== false;
            document.getElementById('set-receipt-owner').checked = template.showOwner !== false;
        }
        return !!biz;
    },

    async getBusiness() {
        const biz = await DB.getSetting('business');
        return biz || { ...this.defaults, isNew: true };
    },

    async getDefaults() {
        const defs = await DB.getSetting('defaults');
        if (!defs) {
            return {
                perBagWeight: this.defaults.perBagWeight,
                defaultBardana: this.defaults.defaultBardana,
                defaultLabour: this.defaults.defaultLabour,
                defaultCommission: this.defaults.defaultCommission,
                defaultMandiTax: this.defaults.defaultMandiTax
            };
        }
        return {
            perBagWeight: (defs.perBagWeight !== undefined && defs.perBagWeight !== null) ? defs.perBagWeight : this.defaults.perBagWeight,
            defaultBardana: (defs.defaultBardana !== undefined && defs.defaultBardana !== null) ? defs.defaultBardana : this.defaults.defaultBardana,
            defaultLabour: (defs.defaultLabour !== undefined && defs.defaultLabour !== null) ? defs.defaultLabour : this.defaults.defaultLabour,
            defaultCommission: (defs.defaultCommission !== undefined && defs.defaultCommission !== null) ? defs.defaultCommission : this.defaults.defaultCommission,
            defaultMandiTax: (defs.defaultMandiTax !== undefined && defs.defaultMandiTax !== null) ? defs.defaultMandiTax : this.defaults.defaultMandiTax
        };
    },

    async getReceiptTemplate() {
        const saved = await DB.getSetting('receiptTemplate');
        return { ...this.defaults.receiptTemplate, ...(saved || {}) };
    },

    async getCrops() {
        const biz = await this.getBusiness();
        const str = biz.crops || this.defaults.crops;
        return str.split(',').map(c => c.trim()).filter(c => c);
    },

    async getExpenseTypes() {
        const biz = await this.getBusiness();
        const str = biz.expenseTypes || this.defaults.expenseTypes;
        return str.split(',').map(c => c.trim()).filter(c => c);
    },

    async save() {
        const data = {
            bizName: document.getElementById('set-biz-name').value.trim(),
            address: document.getElementById('set-address').value.trim(),
            phone: document.getElementById('set-phone').value.trim(),
            ownerName: document.getElementById('set-owner-name').value.trim(),
            crops: document.getElementById('set-crops').value.trim(),
            expenseTypes: document.getElementById('set-expense-types').value.trim()
        };
        await DB.setSetting('business', data);
        
        // Also save defaults and receipt template if their inputs are present on the page
        if (document.getElementById('set-per-bag')) {
            await this.saveDefaults(true);
        }
        if (document.getElementById('set-receipt-footer')) {
            await this.saveReceiptTemplate(true);
        }

        // Update sidebar branding
        document.getElementById('sidebar-biz-name').textContent = data.bizName || 'AgriSys';
        
        Utils.showToast('Settings saved!');
        App.populateCropSelects();
        App.populateExpenseTypeSelect();
    },

    async saveDefaults(silent = false) {
        const perBagEl = document.getElementById('set-per-bag');
        const bardanaEl = document.getElementById('set-bardana');
        const labourEl = document.getElementById('set-labour');
        const commEl = document.getElementById('set-commission');
        const mandiTaxEl = document.getElementById('set-mandi-tax');

        const perBagWeight = perBagEl ? Utils.pf(perBagEl.value) : this.defaults.perBagWeight;
        if (perBagWeight <= 0) {
            Utils.showToast('Default bag weight must be greater than 0 KG', 'error');
            return false;
        }

        const data = {
            perBagWeight,
            defaultBardana: bardanaEl ? Math.max(0, Utils.pf(bardanaEl.value)) : this.defaults.defaultBardana,
            defaultLabour: labourEl ? Math.max(0, Utils.pf(labourEl.value)) : this.defaults.defaultLabour,
            defaultCommission: commEl ? Math.max(0, Math.min(100, Utils.pf(commEl.value))) : this.defaults.defaultCommission,
            defaultMandiTax: mandiTaxEl ? Math.max(0, Math.min(100, Utils.pf(mandiTaxEl.value))) : this.defaults.defaultMandiTax
        };
        await DB.setSetting('defaults', data);
        if (!silent) {
            Utils.showToast('Default values saved!');
        }
        return true;
    },

    async saveReceiptTemplate(silent = false) {
        const footer = document.getElementById('set-receipt-footer');
        if (!footer) return;
        const data = {
            footerText: footer.value.trim() || this.defaults.receiptTemplate.footerText,
            copyLayout: document.getElementById('set-receipt-layout') ? document.getElementById('set-receipt-layout').value : 'two-copy',
            showQR: document.getElementById('set-receipt-qr') ? document.getElementById('set-receipt-qr').checked : true,
            showSignatures: document.getElementById('set-receipt-signatures') ? document.getElementById('set-receipt-signatures').checked : true,
            showOwner: document.getElementById('set-receipt-owner') ? document.getElementById('set-receipt-owner').checked : true
        };
        await DB.setSetting('receiptTemplate', data);
        await Utils.audit('update', 'settings', 'receiptTemplate', { type: 'receipt_template' });
        if (!silent) {
            Utils.showToast('Receipt template saved!');
        }
    },

    async renderAudit() {
        const tbody = document.getElementById('audit-tbody');
        if (!tbody) return;
        let logs = [];
        try {
            logs = await DB.getAll('audit_logs');
        } catch (e) {
            tbody.innerHTML = '<tr><td colspan="6" class="text-center" style="color:var(--text-muted)">Audit log is unavailable until the database upgrades.</td></tr>';
            return;
        }
        logs.sort((a, b) => new Date(b.createdAt || b.date) - new Date(a.createdAt || a.date));
        tbody.innerHTML = logs.slice(0, 50).map(log => {
            const d = log.details || {};
            const notes = [
                d.farmerName || d.buyerName || '',
                d.receiptNo ? `Receipt ${d.receiptNo}` : '',
                d.capitalTxId ? `Capital ${d.capitalTxId}` : ''
            ].filter(Boolean).join(' | ');
            return `<tr>
                <td>${Utils.formatDateTime(log.createdAt || log.date)}</td>
                <td><span class="badge badge-info">${Utils.escapeHTML(log.action)}</span></td>
                <td>${Utils.escapeHTML(log.entityType)} #${Utils.escapeHTML(log.entityId)}</td>
                <td class="text-right">${d.oldAmount === null || d.oldAmount === undefined ? '-' : 'PKR ' + Utils.formatPKR(d.oldAmount)}</td>
                <td class="text-right">${d.newAmount === null || d.newAmount === undefined ? '-' : 'PKR ' + Utils.formatPKR(d.newAmount)}</td>
                <td>${Utils.escapeHTML(notes || d.type || '-')}</td>
            </tr>`;
        }).join('') || '<tr><td colspan="6" class="text-center" style="color:var(--text-muted)">No audit entries yet</td></tr>';
    },

    async backup() {
        try {
            Utils.showLoading('Creating backup...');
            const data = await DB.exportAll();
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `AgriSys_Backup_${Utils.todayISO()}.json`;
            a.click();
            URL.revokeObjectURL(url);
            Utils.hideLoading();
            Utils.showToast('Backup downloaded!');
        } catch (e) { Utils.hideLoading(); Utils.showToast('Backup failed: ' + e.message, 'error'); }
    },

    async restore(event) {
        const file = event.target.files[0];
        if (!file) return;
        const ok = await Utils.confirm('This will replace ALL current data. Are you sure?');
        if (!ok) return;
        try {
            Utils.showLoading('Restoring data...');
            const text = await file.text();
            const data = JSON.parse(text);
            
            if (!data || typeof data !== 'object' || !data._version) {
                throw new Error('Invalid backup file format. Missing version info.');
            }
            
            await DB.importAll(data);
            Utils.hideLoading();
            Utils.showToast('Data restored! Reloading...');
            setTimeout(() => location.reload(), 1500);
        } catch (e) { Utils.hideLoading(); Utils.showToast('Restore failed: ' + e.message, 'error'); }
        event.target.value = '';
    },

    async clearAll() {
        const ok = await Utils.confirm('This will DELETE ALL DATA and local backup snapshots permanently. Are you sure?');
        if (!ok) return;
        const stores = ['settings','purchases','farmers','purchase_payments','sales','sale_payments','expenses','capital_accounts','capital_transactions','capital_entries','company_debts','partners','partner_transactions','buyers','farmer_advances','deductions','journal_entries','seasons','audit_logs','opening_balances','stock_adjustments','opening_balance_payments','commissions','retained_earnings','warehouse_stock','party_running_balances','backup_vault'];
        for (const s of stores) await DB.clear(s);
        Utils.showToast('All data cleared! Reloading...');
        setTimeout(() => location.reload(), 1500);
    }
};
