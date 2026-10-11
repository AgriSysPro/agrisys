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
        return new Promise((resolve, reject) => {
            DB.transact(['settings'], 'readwrite', (stores) => {
                const store = stores['settings'];
                const req = store.get(key);
                req.onsuccess = () => {
                    let seq = (req.result && req.result.value) ? req.result.value : 0;
                    seq++;
                    store.put({ key, value: seq }).onsuccess = () => {
                        resolve(`${prefix}-${String(seq).padStart(4, '0')}`);
                    };
                };
                req.onerror = () => reject(req.error);
            });
        });
    },

    async getNextReceiptId(type) {
        const receiptStore = { purchase: 'purchases', sale: 'sales' }[type];
        if (receiptStore) {
            // Preview only: opening or clearing a form must not consume a number.
            // Include deleted receipts so an issued number is never reused.
            let last = 100000;
            await DB.transact([receiptStore], 'readonly', stores => {
                const request = stores[receiptStore].openCursor();
                request.onsuccess = () => {
                    const cursor = request.result;
                    if (!cursor) return;
                    const id = String(cursor.value.id);
                    if (/^\d+$/.test(id) && Number.isSafeInteger(Number(id))) {
                        last = Math.max(last, Number(id));
                    }
                    cursor.continue();
                };
            });
            return String(last + 1);
        }
        const key = `seq_${type}`;
        return new Promise((resolve, reject) => {
            DB.transact(['settings'], 'readwrite', (stores) => {
                const store = stores['settings'];
                const req = store.get(key);
                req.onsuccess = () => {
                    let seq = (req.result && req.result.value) ? req.result.value : 100000;
                    seq++; // Reserve immediately
                    store.put({ key, value: seq }).onsuccess = () => {
                        resolve(seq.toString());
                    };
                };
                req.onerror = () => reject(req.error);
            });
        });
    },

    async confirmReceiptId(type, idUsed) {
        // Purchase/sale numbers come from saved receipts; other sequences reserve immediately.
        return Promise.resolve();
    },

    async withReceiptSaveLock(type, save) {
        if (typeof navigator !== 'undefined' && navigator.locks) {
            return navigator.locks.request(`agrisys-receipt-${type}`, save);
        }
        return save();
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

    // ===== Integer-Scaled Financial Math Utilities =====
    toPaisa(val) {
        return Math.round((parseFloat(val) || 0) * 100);
    },
    fromPaisa(paisas) {
        return paisas / 100;
    },
    sumMoney(...values) {
        let sum = 0;
        for (const val of values) sum += this.toPaisa(val);
        return this.fromPaisa(sum);
    },
    sumBy(array, iteratee) {
        if (!array || !array.length) return 0;
        let sum = 0;
        for (const item of array) {
            let val = typeof iteratee === 'function' ? iteratee(item) : item[iteratee];
            sum += this.toPaisa(val);
        }
        return this.fromPaisa(sum);
    },
    addMoney(a, b) {
        return this.fromPaisa(this.toPaisa(a) + this.toPaisa(b));
    },
    subMoney(a, b) {
        return this.fromPaisa(this.toPaisa(a) - this.toPaisa(b));
    },
    mulMoney(a, multiplier) {
        return this.fromPaisa(Math.round(this.toPaisa(a) * (parseFloat(multiplier) || 0)));
    },

    // Round to 2 decimal places using scaled integer math (Paisas) to prevent floating point drift
    roundCurrency(num) {
        return this.fromPaisa(this.toPaisa(num));
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
        return ((purchase.netPayableAmount ?? purchase.amount ?? 0)) + (purchase.advanceDeducted || 0);
    },

    purchasePayableAmount(purchase) {
        return (purchase.netPayableAmount ?? purchase.amount ?? 0);
    },

    async getInvoicePayments(store, linkField, invoiceId) {
        return (await DB.getAll(store)).filter(p => this.paymentAllocatedTo(p, invoiceId, linkField) > 0)
            .map(p => ({ ...p, amount: this.paymentAllocatedTo(p, invoiceId, linkField) }));
    },

    paymentAllocatedTo(payment, invoiceId, linkField) {
        if (Array.isArray(payment.allocations)) return payment.allocations.filter(a => a.invoiceId === invoiceId).reduce((s, a) => s + (a.amount || 0), 0);
        return payment[linkField] === invoiceId ? (payment.amount || 0) : 0;
    },

    initialPaymentFor(record, allPayments, linkField, paidField) {
        if (['opening_balance', 'opening_stock', 'stock_adjustment'].includes(record.type)) return 0;
        const field = paidField === 'amountPaid' ? 'initialPaymentAmount' : 'initialReceiptAmount';
        if (record[field] !== undefined && record[field] !== null) return record[field];
        return Math.max(0, (record[paidField] || 0) - allPayments.reduce((s, p) => s + this.paymentAllocatedTo(p, record.id, linkField), 0));
    },

    paymentTotalFor(record, allPayments, linkField, paidField, asOfDate = null) {
        // Synthetic stock is settled without a cash or party obligation.
        if (['opening_balance', 'opening_stock', 'stock_adjustment'].includes(record.type)) return record[paidField] || 0;
        if (asOfDate && record.date > asOfDate) return 0;
        const later = allPayments.filter(p => !asOfDate || p.date <= asOfDate).reduce((s, p) => s + this.paymentAllocatedTo(p, record.id, linkField), 0);
        return this.initialPaymentFor(record, allPayments, linkField, paidField) + later;
    },

    paymentCashAmount(payment) {
        return payment.netCashAmount ?? Math.max(0, (payment.totalPaidCash ?? payment.amount ?? 0) - (payment.advanceDeducted || 0));
    },

    isLinkedCapitalTx(tx, store, id, capitalTxId = null) {
        return (capitalTxId && tx.id === capitalTxId) || (tx.sourceStore === store && tx.sourceId === id)
            || (tx.referenceId === id && ((store === 'purchase_payments' && tx.category === 'farmer_payment') || (store === 'sale_payments' && tx.category === 'sale_payment')));
    },

    async renamePartyOps(type, id, name) {
        const master = type === 'farmer' ? 'farmers' : 'buyers';
        const original = await DB.get(master, id);
        const normalized = name.trim().toLowerCase();
        const others = await DB.getAll(master);
        if (others.some(p => p.id !== id && p.name.trim().toLowerCase() === normalized)) throw new Error('A party with this name already exists');
        if (!original || original.name === name) return [];
        const oldName = original.name.trim().toLowerCase();
        const fields = type === 'farmer' ? { purchases: 'farmerName', purchase_payments: 'farmerName', farmer_advances: 'farmerName', commissions: 'farmerName' } : { sales: 'buyerName', sale_payments: 'buyerName', commissions: 'buyerName' };
        const ops = [];
        for (const [store, field] of Object.entries(fields)) {
            for (const record of await DB.getAll(store)) if ((record[field] || '').trim().toLowerCase() === oldName) {
                record[field] = name; ops.push({ storeName: store, action: 'put', data: record });
            }
        }
        for (const store of ['opening_balances', 'opening_balance_payments']) {
            for (const record of await DB.getAll(store)) if (record.type?.startsWith(type + '_') && (record.partyName || '').trim().toLowerCase() === oldName) {
                record.partyName = name;
                if (record[type + 'Name']) record[type + 'Name'] = name;
                ops.push({ storeName: store, action: 'put', data: record });
            }
        }
        return ops;
    },

    sortLedgerTransactions(transactions) {
        return transactions.sort((a, b) => {
            const ad = new Date(a.rawDate || a.createdAt || 0);
            const bd = new Date(b.rawDate || b.createdAt || 0);
            if (ad - bd !== 0) return ad - bd;
            return String(a.sortKey || '').localeCompare(String(b.sortKey || ''));
        });
    },

    async journalCashTransactions() {
        const accounts = await DB.getAll('capital_accounts');
        const journals = (await DB.getAll('journal_entries')).filter(j => !j.cashPosted);
        const result = [];
        for (const j of journals) for (const [side, type] of [['debit', 'deposit'], ['credit', 'withdrawal']]) {
            const label = j[side + 'Account'] || '';
            if (label !== 'Cash / Bank' && !label.startsWith('Bank/Cash: ')) continue;
            const accountId = j[side + 'AccountId'] || accounts.find(a => label === `Bank/Cash: ${a.name}`)?.id || '__unallocated_journal_cash__';
            result.push({ id: `${j.id}-${side}`, accountId, type, amount: j.amount, date: j.date, description: `Legacy journal: ${j.description || j.id}`, sourceStore: 'journal_entries', sourceId: j.id, virtual: true });
        }
        return result;
    },

    async validateAdvanceHistory(operations) {
        const names = ['opening_balances', 'farmer_advances', 'purchases', 'purchase_payments', 'sale_payments'];
        const before = Object.fromEntries(await Promise.all(names.map(async n => [n, await DB.getAll(n)])));
        const after = this.projectOperations(before, operations);
        const events = data => {
            const result = {};
            const add = (type, name, date, amount) => {
                const key = type + ':' + (name || '').trim().toLowerCase();
                const days = result[key] ||= {};
                days[date] = (days[date] || 0) + amount;
            };
            data.opening_balances.forEach(o => {
                if (o.type === 'farmer_advance' || o.type === 'buyer_advance') add(o.type, o.partyName, o.date, o.amount || 0);
            });
            data.farmer_advances.filter(a => a.amount > 0).forEach(a => add('farmer_advance', a.farmerName, a.date, a.amount));
            data.purchases.forEach(p => add('farmer_advance', p.farmerName, p.date, -(p.advanceDeducted || 0)));
            data.purchase_payments.forEach(p => add('farmer_advance', p.farmerName, p.date, -(p.advanceDeducted || 0)));
            data.sale_payments.forEach(p => add('buyer_advance', p.buyerName, p.date, -(p.advanceDeducted || 0)));
            return result;
        };
        this.assertHistoryNotWorsened(events(before), events(after), 'Advance/deposit would be overdrawn');
    },

    projectOperations(data, operations) {
        const result = Object.fromEntries(Object.entries(data).map(([name, rows]) => [name, rows.slice()]));
        for (const op of operations) {
            if (!result[op.storeName]) continue;
            result[op.storeName] = result[op.storeName].filter(r => r.id !== (op.key ?? op.data?.id));
            if (op.action !== 'delete' && !op.data.isDeleted) result[op.storeName].push(op.data);
        }
        return result;
    },

    assertHistoryNotWorsened(before, after, message) {
        for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
            let oldBalance = 0, newBalance = 0;
            const dates = [...new Set([...Object.keys(before[key] || {}), ...Object.keys(after[key] || {})])].sort();
            for (const date of dates) {
                oldBalance += before[key]?.[date] || 0;
                newBalance += after[key]?.[date] || 0;
                if (newBalance < Math.min(0, oldBalance) - 0.001) throw new Error(`${message}: ${key} on ${date}`);
            }
        }
    },

    async validateStockHistory(operations) {
        const before = Object.fromEntries(await Promise.all(['purchases', 'sales', 'stock_adjustments'].map(async n => [n, await DB.getAll(n)])));
        const events = data => {
            const adjusted = this.applyStockAdjustments(data.purchases.filter(p => p.type !== 'opening_balance'), data.sales, data.stock_adjustments);
            const result = {};
            for (const [rows, sign] of [[adjusted.purchases, 1], [adjusted.sales, -1]]) for (const r of rows) {
                const crop = (r.crop || '').trim().toLowerCase(), days = result[crop] ||= {};
                days[r.date] = (days[r.date] || 0) + sign * (r.netWeight || 0);
            }
            return result;
        };
        this.assertHistoryNotWorsened(events(before), events(this.projectOperations(before, operations)), 'Change would leave insufficient stock');
    },

    async getFarmerAvailableAdvance(farmerName, options = {}) {
        if (!farmerName) return 0;
        const fn = farmerName.trim().toLowerCase();
        const activeSeason = options.season !== undefined ? options.season : await this.getActiveSeason();
        const untilDate = options.untilDate || null;

        let advances = this.filterBySeason(await DB.getAll('farmer_advances'), activeSeason);
        let openings = this.filterBySeason(await DB.getAll('opening_balances'), activeSeason);
        let purchases = this.filterBySeason(await DB.getAll('purchases'), activeSeason);
        let payments = this.filterBySeason(await DB.getAll('purchase_payments'), activeSeason);

        if (untilDate) {
            advances = advances.filter(a => (a.date || '') <= untilDate);
            openings = openings.filter(o => (o.date || '') <= untilDate);
            purchases = purchases.filter(p => (p.date || '') <= untilDate);
            payments = payments.filter(p => (p.date || '') <= untilDate);
        }

        const totalAdv = advances
            .filter(a => (a.farmerName || '').trim().toLowerCase() === fn && (a.amount || 0) > 0 && (!options.excludeAdvanceId || a.id !== options.excludeAdvanceId))
            .reduce((s, a) => s + (a.amount || 0), 0) +
            openings
            .filter(o => o.type === 'farmer_advance' && (o.partyName || '').trim().toLowerCase() === fn)
            .reduce((s, o) => s + (o.amount || 0), 0);

        const recoveredInPurchases = purchases
            .filter(p => (p.farmerName || '').trim().toLowerCase() === fn && (!options.excludePurchaseId || p.id !== options.excludePurchaseId))
            .reduce((s, p) => s + (p.advanceDeducted || 0), 0);
        const adjustedInPayments = payments
            .filter(p => (p.farmerName || '').trim().toLowerCase() === fn && (!options.excludePaymentId || p.id !== options.excludePaymentId))
            .reduce((s, p) => s + (p.advanceDeducted || 0), 0);

        return Math.max(0, totalAdv - recoveredInPurchases - adjustedInPayments);
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
            const totalBill = (p.netPayableAmount ?? p.amount ?? 0);
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
            const initialPaid = this.initialPaymentFor(p, payments, 'purchaseId', 'amountPaid');
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

        const debts = this.filterBySeason(await DB.getAll('company_debts'), activeSeason)
            .filter(d => (d.personName || '').trim().toLowerCase() === fNameLower);
        debts.forEach(d => {
            transactions.push({
                rawDate: d.date || d.createdAt,
                createdAt: d.createdAt,
                sortKey: `4-debt-${d.id}`,
                date: this.formatDate(d.date),
                ref: d.id,
                type: d.type === 'given' ? 'Loan Issued' : 'Loan Repayment',
                description: `Debt / Loan: ${d.type === 'given' ? 'Loan Issued' : 'Repayment Received'}${d.notes ? ' (' + d.notes + ')' : ''}`,
                debit: d.type === 'given' ? (d.amount || 0) : 0,
                credit: d.type === 'repaid' ? (d.amount || 0) : 0
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
        const openAdvances = await this.getFarmerAvailableAdvance(farmerName, { season: activeSeason, untilDate: to || null });

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
            const initialReceived = this.initialPaymentFor(s, payments, 'saleId', 'amountReceived');
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
                credit: Math.max(0, (pay.amount || 0) - (pay.advanceDeducted || 0))
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

        const debts = this.filterBySeason(await DB.getAll('company_debts'), activeSeason)
            .filter(d => (d.personName || '').trim().toLowerCase() === bNameLower);
        debts.forEach(d => {
            transactions.push({
                rawDate: d.date || d.createdAt,
                createdAt: d.createdAt,
                sortKey: `4-debt-${d.id}`,
                date: this.formatDate(d.date),
                ref: d.id,
                type: d.type === 'given' ? 'Loan Issued' : 'Loan Repayment',
                description: `Debt / Loan: ${d.type === 'given' ? 'Loan Issued' : 'Repayment Received'}${d.notes ? ' (' + d.notes + ')' : ''}`,
                debit: d.type === 'given' ? (d.amount || 0) : 0,
                credit: d.type === 'repaid' ? (d.amount || 0) : 0
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
            .sort((a, b) => new Date(a.fifoDate || a.date || a.createdAt || 0) - new Date(b.fifoDate || b.date || b.createdAt || 0))
            .forEach(p => {
                if (!p.crop || (p.netWeight || 0) <= 0) return;
                const key = getCropKey(p.crop);
                const cost = (p.amount || this.purchaseCostAmount(p)) + (expenseByPurchase[p.id] || 0);
                if (!lotsByCropKey[key]) lotsByCropKey[key] = [];
                lotsByCropKey[key].push({
                    sourceId: p.id,
                    fifoDate: p.fifoDate || p.date,
                    date: p.date || String(p.createdAt || '').slice(0, 10),
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
                    if (lot.date > (s.date || String(s.createdAt || '').slice(0, 10))) continue;
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

                }
                result[cropName].saleCogs[s.id] = saleCogs;
            });

        Object.entries(lotsByCropKey).forEach(([key, lots]) => {
            const cropName = cropNameMap[key] || key;
            if (!result[cropName]) result[cropName] = { soldWeight: 0, cogs: 0, revenue: 0, oversoldWeight: 0, saleCogs: {} };
            result[cropName].inventoryWeight = lots.reduce((sum, lot) => sum + lot.remainingWeight, 0);
            result[cropName].inventoryValue = lots.reduce((sum, lot) => sum + (lot.remainingWeight * lot.costPerKg), 0);
            result[cropName].remainingLots = lots.filter(lot => lot.remainingWeight > 0).map(lot => ({ ...lot }));
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
