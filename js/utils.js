// ===== AgriSys Utilities =====

const Utils = {
    escapeHTML(value) {
        return String(value ?? '').replace(/[&<>"']/g, ch => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        }[ch]));
    },

    safeCreateIcons() {
        if (window.lucide && typeof window.lucide.createIcons === 'function') {
            window.lucide.createIcons();
        }
    },

    hasExcel() {
        return !!(window.XLSX && XLSX.utils && typeof XLSX.writeFile === 'function');
    },

    hasPDF() {
        return !!(window.jspdf && window.jspdf.jsPDF);
    },

    requireExcel() {
        if (this.hasExcel()) return true;
        this.showToast('Excel export library is unavailable. Reconnect to the internet or bundle XLSX locally.', 'error');
        return false;
    },

    requirePDF() {
        if (this.hasPDF()) return true;
        this.showToast('PDF library is unavailable. Reconnect to the internet or bundle jsPDF locally.', 'error');
        return false;
    },

    // Generate unique ID: date-based + random hex
    generateId() {
        const now = new Date();
        const d = String(now.getDate()).padStart(2, '0');
        const m = String(now.getMonth() + 1).padStart(2, '0');
        const y = now.getFullYear();
        const hex = Math.random().toString(16).substring(2, 8).toUpperCase();
        return `${d}${m}${y}-${hex}`;
    },

    // Generate sequential ID with prefix (P-0001, S-0001)
    async generateSequentialId(prefix) {
        const key = `seq_${prefix}`;
        let seq = (await DB.getSetting(key)) || 0;
        seq++;
        await DB.setSetting(key, seq);
        return `${prefix}-${String(seq).padStart(4, '0')}`;
    },

    async getNextReceiptId(type) {
        const key = `seq_${type}`;
        let seq = (await DB.getSetting(key)) || 100000;
        return (seq + 1).toString();
    },

    async confirmReceiptId(type, idUsed) {
        const key = `seq_${type}`;
        let seq = (await DB.getSetting(key)) || 100000;
        if (idUsed === (seq + 1).toString()) {
            await DB.setSetting(key, seq + 1);
        }
    },

    // Generate a random 6-digit number
    generateRandom6DigitId() {
        return Math.floor(100000 + Math.random() * 900000).toString();
    },

    // Format number with Pakistani comma style (1,25,000.00)
    formatPKR(num) {
        if (num === null || num === undefined || isNaN(num)) return '0.00';
        num = parseFloat(num);
        const parts = num.toFixed(2).split('.');
        let intPart = parts[0];
        const decPart = parts[1];
        const isNeg = intPart.startsWith('-');
        if (isNeg) intPart = intPart.substring(1);
        if (intPart.length > 3) {
            const last3 = intPart.slice(-3);
            const rest = intPart.slice(0, -3);
            const pairs = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',');
            intPart = pairs + ',' + last3;
        }
        return (isNeg ? '-' : '') + intPart + '.' + decPart;
    },

    // Format number with 2 decimal places
    formatNum(num, decimals = 2) {
        if (num === null || num === undefined || isNaN(num)) return '0';
        return parseFloat(num).toFixed(decimals);
    },

    // Round to 2 decimal places using scaled integer math (Paisas) to prevent floating point drift
    roundCurrency(num) {
        if (num === null || num === undefined || isNaN(num)) return 0;
        const parsed = parseFloat(num);
        if (isNaN(parsed)) return 0;
        const paisas = Math.round((parsed + Number.EPSILON) * 100);
        return paisas / 100;
    },

    // Format date to local format
    formatDate(dateStr) {
        if (!dateStr) return '';
        const d = new Date(dateStr);
        return d.toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: 'numeric' });
    },

    formatDateTime(dateStr) {
        if (!dateStr) return '';
        const d = new Date(dateStr);
        return d.toLocaleString('en-PK', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    },

    // Get today's date in YYYY-MM-DD format for input fields
    todayISO() {
        return this.dateToISO(new Date());
    },

    // Parse float safely
    pf(val) {
        const n = parseFloat(val);
        return isNaN(n) ? 0 : n;
    },

    // Show toast notification
    showToast(message, type = 'success') {
        const container = document.getElementById('toast-container');
        if (!container) return;
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        const text = document.createElement('span');
        text.textContent = message;
        const close = document.createElement('button');
        close.className = 'toast-close';
        close.type = 'button';
        close.textContent = 'x';
        close.onclick = () => toast.remove();
        toast.appendChild(text);
        toast.appendChild(close);
        container.appendChild(toast);
        setTimeout(() => { if (toast.parentElement) toast.remove(); }, 4000);
    },

    // Show modal
    showModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) { modal.classList.add('active'); document.body.style.overflow = 'hidden'; }
    },

    // Hide modal
    hideModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) { modal.classList.remove('active'); document.body.style.overflow = ''; }
    },

    // Confirm dialog
    async confirm(message) {
        return new Promise(resolve => {
            const modal = document.getElementById('confirm-modal');
            document.getElementById('confirm-message').textContent = message;
            document.getElementById('confirm-yes').onclick = () => { Utils.hideModal('confirm-modal'); resolve(true); };
            document.getElementById('confirm-no').onclick = () => { Utils.hideModal('confirm-modal'); resolve(false); };
            Utils.showModal('confirm-modal');
        });
    },

    async audit(action, entityType, entityId, details = {}) {
        if (!DB.db) return;
        try {
            const id = this.generateId();
            const date = this.todayISO();
            const createdAt = new Date().toISOString();
            const payload = JSON.stringify({ id, date, action, entityType, entityId, details, createdAt });
            
            // Simple hash digest for audit integrity
            let hash = 0;
            for (let i = 0; i < payload.length; i++) {
                hash = ((hash << 5) - hash) + payload.charCodeAt(i);
                hash |= 0;
            }

            await DB.put('audit_logs', {
                id,
                date,
                action,
                entityType,
                entityId,
                details,
                hash: hash.toString(16),
                createdAt
            });
        } catch (e) {
            console.warn('Audit log failed:', e);
        }
    },

    async populateCapitalAccountSelect(selectId, placeholder = 'Do not link account') {
        const sel = document.getElementById(selectId);
        if (!sel) return;
        const accounts = await DB.getAll('capital_accounts');
        sel.innerHTML = `<option value="">${this.escapeHTML(placeholder)}</option>` +
            accounts.map(a => `<option value="${this.escapeHTML(a.id)}">${this.escapeHTML(a.name)}</option>`).join('');
    },

    async createLinkedCapitalTx({ accountId, type, amount, date, description, sourceStore, sourceId }) {
        if (!accountId || amount <= 0) return null;
        const tx = {
            id: this.generateId(),
            accountId,
            type,
            amount,
            date,
            description,
            sourceStore,
            sourceId,
            isReconciled: false,
            createdAt: new Date().toISOString()
        };
        await DB.put('capital_transactions', tx);
        return tx;
    },

    async deleteLinkedCapitalTx(sourceStore, sourceId) {
        const txs = await DB.getAll('capital_transactions');
        const linked = txs.filter(t => t.sourceStore === sourceStore && t.sourceId === sourceId);
        for (const tx of linked) await DB.delete('capital_transactions', tx.id);
        return linked;
    },

    // Debounce
    debounce(fn, delay = 300) {
        let timer;
        return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), delay); };
    },

    // Status badge HTML
    statusBadge(status) {
        const cls = status === 'paid' ? 'badge-success' : status === 'partial' ? 'badge-warning' : 'badge-danger';
        const label = status === 'paid' ? 'Paid' : status === 'partial' ? 'Partial' : 'Pending';
        return `<span class="badge ${cls}">${label}</span>`;
    },

    // Urdu digits
    toUrduDigits(num) {
        const urduDigits = ['۰','۱','۲','۳','۴','۵','۶','۷','۸','۹'];
        return String(num).replace(/\d/g, d => urduDigits[d]);
    },

    // File to Base64
    fileToBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    },

    // Compress image
    async compressImage(base64, maxWidth = 800, quality = 0.7) {
        return new Promise(resolve => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let w = img.width, h = img.height;
                if (w > maxWidth) { h = (maxWidth / w) * h; w = maxWidth; }
                canvas.width = w; canvas.height = h;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, w, h);
                resolve(canvas.toDataURL('image/jpeg', quality));
            };
            img.src = base64;
        });
    },

    // Highlight search text in string
    highlightText(text, search) {
        if (text === null || text === undefined) return '';
        const raw = String(text);
        if (!search) return this.escapeHTML(raw);
        const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return raw.split(new RegExp(`(${escaped})`, 'gi'))
            .map(part => part.toLowerCase() === search.toLowerCase()
                ? `<mark>${this.escapeHTML(part)}</mark>`
                : this.escapeHTML(part))
            .join('');
    },

    // Date range presets
    getDatePreset(preset) {
        const now = new Date();
        const y = now.getFullYear();
        const m = now.getMonth();
        switch (preset) {
            case 'this-month':
                return { from: new Date(y, m, 1), to: new Date(y, m + 1, 0) };
            case 'last-month':
                return { from: new Date(y, m - 1, 1), to: new Date(y, m, 0) };
            case 'this-quarter': {
                const q = Math.floor(m / 3) * 3;
                return { from: new Date(y, q, 1), to: new Date(y, q + 3, 0) };
            }
            case 'this-year':
                return { from: new Date(y, 0, 1), to: new Date(y, 11, 31) };
            case 'last-year':
                return { from: new Date(y - 1, 0, 1), to: new Date(y - 1, 11, 31) };
            case 'all-time':
                return { from: new Date(2020, 0, 1), to: new Date(y + 1, 11, 31) };
            default:
                return { from: new Date(y, m, 1), to: now };
        }
    },

    // Convert Date to YYYY-MM-DD
    dateToISO(date) {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    },

    async getActiveSeason() {
        return typeof SeasonManager !== 'undefined' ? SeasonManager.getActiveSeason() : null;
    },

    filterBySeason(records, season = null) {
        if (!season) return records.filter(r => r.type !== 'opening_balance');
        return records.filter(r => r.date >= season.startDate && r.date <= season.endDate);
    },

    async getSeasonScoped(storeName) {
        const activeSeason = await this.getActiveSeason();
        return this.filterBySeason(await DB.getAll(storeName), activeSeason);
    },

    applyStockAdjustments(purchases, sales, adjustments) {
        const cleanPurchases = (purchases || []).filter(p => p.type !== 'stock_adjustment' && p.type !== 'opening_stock');
        const cleanSales = (sales || []).filter(s => s.type !== 'stock_adjustment');
        const virtualPurchases = [];
        const virtualSales = [];
        (adjustments || []).forEach(a => {
            const weight = this.pf(a.weight);
            if (!a.crop || weight <= 0) return;
            const amount = this.pf(a.value);
            if (a.direction === 'increase' || a.direction === 'opening') {
                virtualPurchases.push({
                    id: a.id,
                    type: a.direction === 'opening' ? 'opening_stock' : 'stock_adjustment',
                    farmerName: a.direction === 'opening' ? 'Opening Stock' : 'Stock Adjustment',
                    date: a.date,
                    crop: a.crop,
                    method: 'scale',
                    grossWeight: weight,
                    perBagWeight: a.perBagWeight || 100,
                    bagsCount: weight / (a.perBagWeight || 100),
                    netWeight: weight,
                    netBags: weight / (a.perBagWeight || 100),
                    netMn: weight / 40,
                    rate: weight > 0 ? amount / (weight / 40) : 0,
                    amount,
                    netPayableAmount: amount,
                    amountPaid: amount,
                    balance: 0,
                    paymentStatus: 'paid',
                    notes: a.reason || '',
                    createdAt: a.createdAt
                });
            } else {
                virtualSales.push({
                    id: a.id,
                    type: 'stock_adjustment',
                    buyerName: 'Stock Adjustment',
                    date: a.date,
                    crop: a.crop,
                    grossWeight: weight,
                    perBagWeight: a.perBagWeight || 100,
                    perBag: a.perBagWeight || 100,
                    netWeight: weight,
                    netMn: weight / 40,
                    rate: 0,
                    amount: 0,
                    amountReceived: 0,
                    balance: 0,
                    paymentStatus: 'paid',
                    notes: a.reason || '',
                    createdAt: a.createdAt
                });
            }
        });
        return {
            purchases: cleanPurchases.concat(virtualPurchases),
            sales: cleanSales.concat(virtualSales)
        };
    },

    async partyOpeningBalance(type, partyName) {
        const activeSeason = await this.getActiveSeason();
        const balances = this.filterBySeason(await DB.getAll('opening_balances'), activeSeason);
        return balances
            .filter(b => b.type === type && (b.partyName || '').toLowerCase() === (partyName || '').toLowerCase())
            .reduce((sum, b) => sum + Math.max(0, (b.amount || 0) - (b.paidAmount || b.receivedAmount || b.settledAmount || 0)), 0);
    },

    openingBalanceSettled(record) {
        return record.paidAmount || record.receivedAmount || record.settledAmount || 0;
    },

    purchaseCostAmount(purchase) {
        const base = purchase.payableBeforeAdvance;
        if (base !== undefined && base !== null) return base || 0;
        return (purchase.netPayableAmount || purchase.amount || 0) + (purchase.advanceDeducted || 0);
    },

    purchasePayableAmount(purchase) {
        return purchase.netPayableAmount || purchase.amount || 0;
    },

    paymentTotalFor(record, allPayments, linkField, paidField, asOfDate = null) {
        const linked = allPayments.filter(p => p[linkField] === record.id);
        const laterTotal = linked.reduce((sum, p) => sum + (p.amount || 0), 0);
        const initialPaid = Math.max(0, (record[paidField] || 0) - laterTotal);
        const inScopeLater = linked
            .filter(p => !asOfDate || !p.date || p.date <= asOfDate)
            .reduce((sum, p) => sum + (p.amount || 0), 0);
        return initialPaid + inScopeLater;
    },

    sortLedgerTransactions(transactions) {
        return transactions.sort((a, b) => {
            const ad = new Date(a.rawDate || a.createdAt || 0);
            const bd = new Date(b.rawDate || b.createdAt || 0);
            if (ad - bd !== 0) return ad - bd;
            return String(a.sortKey || '').localeCompare(String(b.sortKey || ''));
        });
    },

    async buildFarmerLedger(farmer, options = {}) {
        const activeSeason = await this.getActiveSeason();
        const from = options.from || '';
        const to = options.to || '';
        const includeOpening = options.includeOpening !== false;
        const farmerName = farmer.name || farmer;
        const fNameLower = farmerName.toLowerCase();
        const purchases = this.filterBySeason(await DB.getAll('purchases'), activeSeason)
            .filter(p => (p.farmerName || '').toLowerCase() === fNameLower);
        const payments = this.filterBySeason(await DB.getAll('purchase_payments'), activeSeason)
            .filter(p => (p.farmerName || '').toLowerCase() === fNameLower);
        const openingPayments = this.filterBySeason(await DB.getAll('opening_balance_payments'), activeSeason)
            .filter(p => p.type === 'farmer_payable' && (p.partyName || p.farmerName || '').toLowerCase() === fNameLower);
        const openings = this.filterBySeason(await DB.getAll('opening_balances'), activeSeason)
            .filter(o => (o.partyName || '').toLowerCase() === fNameLower);
        const advances = this.filterBySeason(await DB.getAll('farmer_advances'), activeSeason)
            .filter(a => (a.farmerName || '').toLowerCase() === fNameLower);

        const transactions = [];

        if (includeOpening) openings.filter(o => o.type === 'farmer_payable').forEach(o => {
            transactions.push({
                rawDate: o.date,
                createdAt: o.createdAt,
                sortKey: `0-${o.id}`,
                date: this.formatDate(o.date),
                ref: o.id,
                type: 'Opening',
                description: o.notes || 'Opening payable balance',
                debit: 0,
                credit: o.amount || 0
            });
        });

        purchases.forEach(p => {
            const totalBill = p.netPayableAmount || p.amount || 0;
            transactions.push({
                rawDate: p.date || p.createdAt,
                createdAt: p.createdAt,
                sortKey: `1-${p.id}`,
                date: this.formatDate(p.date),
                ref: p.id,
                type: 'Purchase',
                description: `${p.crop || 'Crop'} | ${this.formatNum(p.netWeight || 0, 2)} KG @ PKR ${this.formatPKR(p.rate || 0)}/Mn`,
                debit: 0,
                credit: totalBill
            });

            const laterPayments = payments.filter(pay => pay.purchaseId === p.id).reduce((s, pay) => s + (pay.amount || 0), 0);
            const initialPaid = Math.max(0, (p.amountPaid || 0) - laterPayments);
            if (initialPaid > 0) {
                transactions.push({
                    rawDate: p.date || p.createdAt,
                    createdAt: p.createdAt,
                    sortKey: `2-${p.id}`,
                    date: this.formatDate(p.date),
                    ref: p.id,
                    type: 'Initial Payment',
                    description: `Initial paid on purchase #${p.id}`,
                    debit: initialPaid,
                    credit: 0
                });
            }
        });

        payments.forEach(pay => {
            transactions.push({
                rawDate: pay.date || pay.createdAt,
                createdAt: pay.createdAt,
                sortKey: `3-${pay.id}`,
                date: this.formatDate(pay.date),
                ref: pay.receiptNo || pay.id,
                type: 'Payment',
                description: `Payment against #${pay.purchaseId} (${(pay.mode || 'Cash').toUpperCase()})${pay.reference ? ' Ref: ' + pay.reference : ''}`,
                debit: pay.amount || 0,
                credit: 0
            });
        });

        openingPayments.forEach(pay => {
            transactions.push({
                rawDate: pay.date || pay.createdAt,
                createdAt: pay.createdAt,
                sortKey: `3-ob-${pay.id}`,
                date: this.formatDate(pay.date),
                ref: pay.receiptNo || pay.id,
                type: 'Opening Payment',
                description: `Payment against opening balance (${(pay.mode || 'Cash').toUpperCase()})${pay.reference ? ' Ref: ' + pay.reference : ''}`,
                debit: pay.amount || 0,
                credit: 0
            });
        });

        let scopedTransactions = transactions;
        if (from) scopedTransactions = scopedTransactions.filter(t => String(t.rawDate || '') >= from);
        if (to) scopedTransactions = scopedTransactions.filter(t => String(t.rawDate || '') <= to);
        this.sortLedgerTransactions(scopedTransactions);
        let balance = 0;
        let totalDebit = 0;
        let totalCredit = 0;
        const rows = scopedTransactions.map(t => {
            totalCredit += t.credit || 0;
            totalDebit += t.debit || 0;
            balance += (t.credit || 0) - (t.debit || 0);
            return { ...t, balance };
        });
        const openAdvances = advances.reduce((sum, a) => sum + (a.amount || 0), 0) +
            openings.filter(o => o.type === 'farmer_advance').reduce((sum, o) => sum + (o.amount || 0), 0);

        return {
            partyName: farmerName,
            rows,
            totals: { debit: totalDebit, credit: totalCredit, balance, openAdvances },
            counts: { purchases: purchases.length, payments: payments.length + openingPayments.length },
            period: { from, to }
        };
    },

    async buildBuyerLedger(buyer, options = {}) {
        const activeSeason = await this.getActiveSeason();
        const from = options.from || '';
        const to = options.to || '';
        const includeOpening = options.includeOpening !== false;
        const buyerName = buyer.name || buyer;
        const bNameLower = buyerName.toLowerCase();
        const sales = this.filterBySeason(await DB.getAll('sales'), activeSeason)
            .filter(s => (s.buyerName || '').toLowerCase() === bNameLower);
        const payments = this.filterBySeason(await DB.getAll('sale_payments'), activeSeason)
            .filter(p => (p.buyerName || '').toLowerCase() === bNameLower);
        const openingPayments = this.filterBySeason(await DB.getAll('opening_balance_payments'), activeSeason)
            .filter(p => p.type === 'buyer_receivable' && (p.partyName || p.buyerName || '').toLowerCase() === bNameLower);
        const openings = this.filterBySeason(await DB.getAll('opening_balances'), activeSeason)
            .filter(o => (o.partyName || '').toLowerCase() === bNameLower);

        const transactions = [];
        if (includeOpening) openings.filter(o => o.type === 'buyer_receivable').forEach(o => {
            transactions.push({
                rawDate: o.date,
                createdAt: o.createdAt,
                sortKey: `0-${o.id}`,
                date: this.formatDate(o.date),
                ref: o.id,
                type: 'Opening',
                description: o.notes || 'Opening receivable balance',
                debit: o.amount || 0,
                credit: 0
            });
        });
        if (includeOpening) openings.filter(o => o.type === 'buyer_advance').forEach(o => {
            transactions.push({
                rawDate: o.date,
                createdAt: o.createdAt,
                sortKey: `0-${o.id}`,
                date: this.formatDate(o.date),
                ref: o.id,
                type: 'Opening Advance',
                description: o.notes || 'Opening buyer advance',
                debit: 0,
                credit: o.amount || 0
            });
        });

        sales.forEach(s => {
            transactions.push({
                rawDate: s.date || s.createdAt,
                createdAt: s.createdAt,
                sortKey: `1-${s.id}`,
                date: this.formatDate(s.date),
                ref: s.id,
                type: 'Sale',
                description: `${s.crop || 'Crop'} | ${this.formatNum(s.netWeight || 0, 2)} KG @ PKR ${this.formatPKR(s.rate || 0)}/Mn`,
                debit: s.amount || 0,
                credit: 0
            });
            const laterPayments = payments.filter(pay => pay.saleId === s.id).reduce((sum, pay) => sum + (pay.amount || 0), 0);
            const initialReceived = Math.max(0, (s.amountReceived || 0) - laterPayments);
            if (initialReceived > 0) {
                transactions.push({
                    rawDate: s.date || s.createdAt,
                    createdAt: s.createdAt,
                    sortKey: `2-${s.id}`,
                    date: this.formatDate(s.date),
                    ref: s.id,
                    type: 'Initial Receipt',
                    description: `Initial received on sale #${s.id}`,
                    debit: 0,
                    credit: initialReceived
                });
            }
        });

        payments.forEach(pay => {
            transactions.push({
                rawDate: pay.date || pay.createdAt,
                createdAt: pay.createdAt,
                sortKey: `3-${pay.id}`,
                date: this.formatDate(pay.date),
                ref: pay.receiptNo || pay.id,
                type: 'Receipt',
                description: `Receipt for #${pay.saleId} (${(pay.mode || 'Cash').toUpperCase()})${pay.reference ? ' Ref: ' + pay.reference : ''}`,
                debit: 0,
                credit: pay.amount || 0
            });
        });

        openingPayments.forEach(pay => {
            transactions.push({
                rawDate: pay.date || pay.createdAt,
                createdAt: pay.createdAt,
                sortKey: `3-ob-${pay.id}`,
                date: this.formatDate(pay.date),
                ref: pay.receiptNo || pay.id,
                type: 'Opening Receipt',
                description: `Receipt against opening balance (${(pay.mode || 'Cash').toUpperCase()})${pay.reference ? ' Ref: ' + pay.reference : ''}`,
                debit: 0,
                credit: pay.amount || 0
            });
        });

        let scopedTransactions = transactions;
        if (from) scopedTransactions = scopedTransactions.filter(t => String(t.rawDate || '') >= from);
        if (to) scopedTransactions = scopedTransactions.filter(t => String(t.rawDate || '') <= to);
        this.sortLedgerTransactions(scopedTransactions);
        let balance = 0;
        let totalDebit = 0;
        let totalCredit = 0;
        const rows = scopedTransactions.map(t => {
            totalDebit += t.debit || 0;
            totalCredit += t.credit || 0;
            balance += (t.debit || 0) - (t.credit || 0);
            return { ...t, balance };
        });

        return {
            partyName: buyerName,
            rows,
            totals: { debit: totalDebit, credit: totalCredit, balance },
            counts: { sales: sales.length, payments: payments.length + openingPayments.length },
            period: { from, to }
        };
    },

    calculateInventoryLots(purchases, sales, expenses = []) {
        const expenseByPurchase = {};
        expenses.forEach(e => {
            if (e.purchaseId) expenseByPurchase[e.purchaseId] = (expenseByPurchase[e.purchaseId] || 0) + (e.amount || 0);
        });

        const cropNameMap = {};
        const getCropKey = (cropName) => {
            if (!cropName) return null;
            const trimmed = cropName.trim();
            const lower = trimmed.toLowerCase();
            if (!cropNameMap[lower]) cropNameMap[lower] = trimmed;
            return lower;
        };

        const lotsByCropKey = {};
        purchases
            .slice()
            .sort((a, b) => new Date(a.date || a.createdAt || 0) - new Date(b.date || b.createdAt || 0))
            .forEach(p => {
                if (!p.crop || (p.netWeight || 0) <= 0) return;
                const key = getCropKey(p.crop);
                const cost = (p.amount || this.purchaseCostAmount(p)) + (expenseByPurchase[p.id] || 0);
                if (!lotsByCropKey[key]) lotsByCropKey[key] = [];
                lotsByCropKey[key].push({
                    remainingWeight: p.netWeight || 0,
                    costPerKg: cost / (p.netWeight || 1)
                });
            });

        const result = {};
        sales
            .slice()
            .sort((a, b) => new Date(a.date || a.createdAt || 0) - new Date(b.date || b.createdAt || 0))
            .forEach(s => {
                if (!s.crop) return;
                const key = getCropKey(s.crop);
                const cropName = cropNameMap[key] || s.crop.trim();
                if (!result[cropName]) result[cropName] = { soldWeight: 0, cogs: 0, revenue: 0, oversoldWeight: 0, saleCogs: {} };
                let remainingToSell = s.netWeight || 0;
                let saleCogs = 0;
                result[cropName].soldWeight += remainingToSell;
                result[cropName].revenue += s.amount || 0;
                const lots = lotsByCropKey[key] || [];
                for (const lot of lots) {
                    if (remainingToSell <= 0) break;
                    const used = Math.min(lot.remainingWeight, remainingToSell);
                    const usedCost = used * lot.costPerKg;
                    result[cropName].cogs += usedCost;
                    saleCogs += usedCost;
                    lot.remainingWeight -= used;
                    remainingToSell -= used;
                }
                if (remainingToSell > 0) {
                    result[cropName].oversoldWeight += remainingToSell;
                    const cropLots = lotsByCropKey[key] || [];
                    const avgCostPerKg = cropLots.length > 0
                        ? cropLots.reduce((sum, l) => sum + l.costPerKg, 0) / cropLots.length
                        : (s.netWeight > 0 ? (s.amount / s.netWeight) * 0.85 : 0);
                    const estimatedCost = remainingToSell * avgCostPerKg;
                    result[cropName].cogs += estimatedCost;
                    saleCogs += estimatedCost;
                }
                result[cropName].saleCogs[s.id] = saleCogs;
            });

        Object.entries(lotsByCropKey).forEach(([key, lots]) => {
            const cropName = cropNameMap[key] || key;
            if (!result[cropName]) result[cropName] = { soldWeight: 0, cogs: 0, revenue: 0, oversoldWeight: 0, saleCogs: {} };
            result[cropName].inventoryWeight = lots.reduce((sum, lot) => sum + lot.remainingWeight, 0);
            result[cropName].inventoryValue = lots.reduce((sum, lot) => sum + (lot.remainingWeight * lot.costPerKg), 0);
        });

        return result;
    },

    // Apply date preset to inputs
    applyDatePreset(preset, fromId, toId, callback) {
        const { from, to } = this.getDatePreset(preset);
        document.getElementById(fromId).value = this.dateToISO(from);
        document.getElementById(toId).value = this.dateToISO(to);
        if (callback) callback();
    },

    // Show loading overlay
    showLoading(message = 'Processing...') {
        let overlay = document.getElementById('loading-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'loading-overlay';
            overlay.className = 'loading-overlay';
            overlay.innerHTML = `
                <div class="loading-content">
                    <div class="loading-spinner"></div>
                    <p class="loading-text">${message}</p>
                </div>`;
            document.body.appendChild(overlay);
        } else {
            overlay.querySelector('.loading-text').textContent = message;
            overlay.style.display = 'flex';
        }
    },

    // Hide loading overlay
    hideLoading() {
        const overlay = document.getElementById('loading-overlay');
        if (overlay) overlay.style.display = 'none';
    },

    // Pagination
    paginate(items, page = 1, perPage = 25) {
        const totalPages = Math.max(1, Math.ceil(items.length / perPage));
        page = Math.max(1, Math.min(page, totalPages));
        const start = (page - 1) * perPage;
        return {
            items: items.slice(start, start + perPage),
            page,
            totalPages,
            totalItems: items.length,
            hasNext: page < totalPages,
            hasPrev: page > 1
        };
    },

    // Render pagination controls
    renderPagination(containerId, currentPage, totalPages, onPageChange) {
        const container = document.getElementById(containerId);
        if (!container || totalPages <= 1) {
            if (container) container.innerHTML = '';
            return;
        }
        let html = '<div class="pagination">';
        html += `<button class="btn btn-ghost btn-sm" ${currentPage <= 1 ? 'disabled' : ''} onclick="${onPageChange}(${currentPage - 1})">‹ Prev</button>`;
        
        // Page numbers
        const maxVisible = 5;
        let startPage = Math.max(1, currentPage - Math.floor(maxVisible / 2));
        let endPage = Math.min(totalPages, startPage + maxVisible - 1);
        if (endPage - startPage < maxVisible - 1) startPage = Math.max(1, endPage - maxVisible + 1);
        
        if (startPage > 1) {
            html += `<button class="btn btn-ghost btn-sm" onclick="${onPageChange}(1)">1</button>`;
            if (startPage > 2) html += '<span class="pagination-dots">…</span>';
        }
        for (let i = startPage; i <= endPage; i++) {
            html += `<button class="btn ${i === currentPage ? 'btn-primary' : 'btn-ghost'} btn-sm" onclick="${onPageChange}(${i})">${i}</button>`;
        }
        if (endPage < totalPages) {
            if (endPage < totalPages - 1) html += '<span class="pagination-dots">…</span>';
            html += `<button class="btn btn-ghost btn-sm" onclick="${onPageChange}(${totalPages})">${totalPages}</button>`;
        }
        
        html += `<button class="btn btn-ghost btn-sm" ${currentPage >= totalPages ? 'disabled' : ''} onclick="${onPageChange}(${currentPage + 1})">Next ›</button>`;
        html += `<span class="pagination-info">${currentPage} of ${totalPages}</span>`;
        html += '</div>';
        container.innerHTML = html;
    }
};
