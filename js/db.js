// ===== AgriSys IndexedDB Data Layer =====

const DB = {
    db: null,
    DB_NAME: 'AgriSysDB',
    DB_VERSION: 11,

    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);
            request.onupgradeneeded = (e) => {
                const db = e.target.result;

                // Settings store
                if (!db.objectStoreNames.contains('settings')) {
                    db.createObjectStore('settings', { keyPath: 'key' });
                }

                // Purchases store
                if (!db.objectStoreNames.contains('purchases')) {
                    const store = db.createObjectStore('purchases', { keyPath: 'id' });
                    store.createIndex('date', 'date');
                    store.createIndex('farmerName', 'farmerName');
                    store.createIndex('crop', 'crop');
                    store.createIndex('paymentStatus', 'paymentStatus');
                }

                // Farmers store
                if (!db.objectStoreNames.contains('farmers')) {
                    const store = db.createObjectStore('farmers', { keyPath: 'id' });
                    store.createIndex('name', 'name', { unique: false });
                }

                // Purchase Payments store
                if (!db.objectStoreNames.contains('purchase_payments')) {
                    const store = db.createObjectStore('purchase_payments', { keyPath: 'id' });
                    store.createIndex('purchaseId', 'purchaseId');
                    store.createIndex('farmerName', 'farmerName');
                    store.createIndex('date', 'date');
                }

                // Sales store
                if (!db.objectStoreNames.contains('sales')) {
                    const store = db.createObjectStore('sales', { keyPath: 'id' });
                    store.createIndex('date', 'date');
                    store.createIndex('buyerName', 'buyerName');
                    store.createIndex('crop', 'crop');
                    store.createIndex('paymentStatus', 'paymentStatus');
                }

                // Sale Payments store
                if (!db.objectStoreNames.contains('sale_payments')) {
                    const store = db.createObjectStore('sale_payments', { keyPath: 'id' });
                    store.createIndex('saleId', 'saleId');
                    store.createIndex('buyerName', 'buyerName');
                    store.createIndex('date', 'date');
                }

                // Expenses store
                if (!db.objectStoreNames.contains('expenses')) {
                    const store = db.createObjectStore('expenses', { keyPath: 'id' });
                    store.createIndex('date', 'date');
                    store.createIndex('type', 'type');
                    store.createIndex('crop', 'crop');
                    store.createIndex('purchaseId', 'purchaseId');
                }

                // Capital Accounts store
                if (!db.objectStoreNames.contains('capital_accounts')) {
                    db.createObjectStore('capital_accounts', { keyPath: 'id' });
                }

                // Capital Transactions store
                if (!db.objectStoreNames.contains('capital_transactions')) {
                    const store = db.createObjectStore('capital_transactions', { keyPath: 'id' });
                    store.createIndex('accountId', 'accountId');
                    store.createIndex('date', 'date');
                }

                // V2: Buyers store
                if (!db.objectStoreNames.contains('buyers')) {
                    const store = db.createObjectStore('buyers', { keyPath: 'id' });
                    store.createIndex('name', 'name', { unique: false });
                }

                // V3: Farmer Advances store
                if (!db.objectStoreNames.contains('farmer_advances')) {
                    const store = db.createObjectStore('farmer_advances', { keyPath: 'id' });
                    store.createIndex('farmerName', 'farmerName');
                    store.createIndex('date', 'date');
                }

                // V7: Deductions table
                if (!db.objectStoreNames.contains('deductions')) {
                    const store = db.createObjectStore('deductions', { keyPath: 'id' });
                    store.createIndex('purchaseId', 'purchaseId');
                }

                // V8: Manual Journal Entries table
                if (!db.objectStoreNames.contains('journal_entries')) {
                    const store = db.createObjectStore('journal_entries', { keyPath: 'id' });
                    store.createIndex('date', 'date');
                }

                // V4: Seasons store
                if (!db.objectStoreNames.contains('seasons')) {
                    const store = db.createObjectStore('seasons', { keyPath: 'id' });
                    store.createIndex('active', 'active');
                }

                // V5: Audit trail
                if (!db.objectStoreNames.contains('audit_logs')) {
                    const store = db.createObjectStore('audit_logs', { keyPath: 'id' });
                    store.createIndex('date', 'date');
                    store.createIndex('entityType', 'entityType');
                    store.createIndex('entityId', 'entityId');
                    store.createIndex('action', 'action');
                }

                // V6: Opening balances and stock adjustments
                if (!db.objectStoreNames.contains('opening_balances')) {
                    const store = db.createObjectStore('opening_balances', { keyPath: 'id' });
                    store.createIndex('date', 'date');
                    store.createIndex('type', 'type');
                    store.createIndex('partyName', 'partyName');
                }
                if (!db.objectStoreNames.contains('stock_adjustments')) {
                    const store = db.createObjectStore('stock_adjustments', { keyPath: 'id' });
                    store.createIndex('date', 'date');
                    store.createIndex('crop', 'crop');
                    store.createIndex('direction', 'direction');
                }

                // V7: Payments made against opening party balances
                if (!db.objectStoreNames.contains('opening_balance_payments')) {
                    const store = db.createObjectStore('opening_balance_payments', { keyPath: 'id' });
                    store.createIndex('openingBalanceId', 'openingBalanceId');
                    store.createIndex('partyName', 'partyName');
                    store.createIndex('date', 'date');
                    store.createIndex('type', 'type');
                }

                // V9: Commissions and Retained Earnings stores
                if (!db.objectStoreNames.contains('commissions')) {
                    const store = db.createObjectStore('commissions', { keyPath: 'id' });
                    store.createIndex('date', 'date');
                    store.createIndex('farmerName', 'farmerName');
                    store.createIndex('buyerName', 'buyerName');
                    store.createIndex('crop', 'crop');
                }
                if (!db.objectStoreNames.contains('retained_earnings')) {
                    db.createObjectStore('retained_earnings', { keyPath: 'seasonId' });
                }

                // V10: Backup Vault store
                if (!db.objectStoreNames.contains('backup_vault')) {
                    const store = db.createObjectStore('backup_vault', { keyPath: 'id' });
                    store.createIndex('date', 'date');
                }

                // V11: Capital Entries store (owner capital contributions & drawings)
                if (!db.objectStoreNames.contains('capital_entries')) {
                    const store = db.createObjectStore('capital_entries', { keyPath: 'id' });
                    store.createIndex('date', 'date');
                    store.createIndex('type', 'type');
                }
            };

            request.onsuccess = (e) => { this.db = e.target.result; resolve(); };
            request.onerror = (e) => reject(e.target.error);
        });
    },

    // Generic CRUD
    async getAll(storeName) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const req = store.getAll();
            req.onsuccess = () => {
                const results = (req.result || []).filter(r => !r || !r.isDeleted);
                resolve(results);
            };
            req.onerror = () => reject(req.error);
        });
    },

    async get(storeName, key) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const req = store.get(key);
            req.onsuccess = () => {
                const record = req.result;
                if (record && record.isDeleted) resolve(null);
                else resolve(record);
            };
            req.onerror = () => reject(req.error);
        });
    },

    async put(storeName, data) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const req = store.put(data);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    },

    async delete(storeName, key) {
        // Soft-delete by setting isDeleted flag
        const record = await this.get(storeName, key);
        if (record) {
            record.isDeleted = true;
            record.deletedAt = new Date().toISOString();
            return this.put(storeName, record);
        }
    },

    async hardDelete(storeName, key) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const req = store.delete(key);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    },

    async getByIndex(storeName, indexName, value) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const index = store.index(indexName);
            const req = index.getAll(value);
            req.onsuccess = () => {
                const results = (req.result || []).filter(r => !r || !r.isDeleted);
                resolve(results);
            };
            req.onerror = () => reject(req.error);
        });
    },

    async getByDateRange(storeName, startDate, endDate) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const index = store.index('date');
            const range = (startDate && endDate)
                ? IDBKeyRange.bound(startDate, endDate)
                : startDate ? IDBKeyRange.lowerBound(startDate)
                : endDate ? IDBKeyRange.upperBound(endDate)
                : null;

            const results = [];
            const req = range ? index.openCursor(range) : index.openCursor();
            req.onsuccess = (e) => {
                const cursor = e.target.result;
                if (cursor) {
                    if (!cursor.value.isDeleted) results.push(cursor.value);
                    cursor.continue();
                } else {
                    resolve(results);
                }
            };
            req.onerror = () => reject(req.error);
        });
    },

    async clear(storeName) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const req = store.clear();
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    },

    async count(storeName) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const req = store.count();
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    },

    // Commit a list of operations synchronously within a single atomic IDB transaction
    async commitUnitOfWork(operations) {
        if (!operations || !operations.length) return true;
        const storeNames = [...new Set(operations.map(op => op.storeName))];

        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(storeNames, 'readwrite');
            tx.oncomplete = () => resolve(true);
            tx.onerror = (e) => reject(e.target.error);
            tx.onabort = () => reject(new Error('Unit of work transaction aborted'));

            for (const op of operations) {
                const store = tx.objectStore(op.storeName);
                if (op.action === 'put') {
                    store.put(op.data);
                } else if (op.action === 'delete') {
                    if (op.softDelete) {
                        op.data.isDeleted = true;
                        op.data.deletedAt = new Date().toISOString();
                        store.put(op.data);
                    } else {
                        store.delete(op.key);
                    }
                }
            }
        });
    },

    // Execute multiple operations in a single atomic transaction
    async transact(storeNames, mode, callback) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(storeNames, mode);
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(new Error('Transaction aborted'));
            
            try {
                const stores = {};
                storeNames.forEach(name => {
                    stores[name] = tx.objectStore(name);
                });
                callback(stores, tx);
            } catch (err) {
                try { tx.abort(); } catch(e) {}
                reject(err);
            }
        });
    },

    // Settings helpers
    async getSetting(key) {
        const record = await this.get('settings', key);
        return record ? record.value : null;
    },

    async setSetting(key, value) {
        return this.put('settings', { key, value });
    },

    // Backup all data
    async exportAll() {
        const stores = ['settings', 'purchases', 'farmers', 'purchase_payments', 'sales', 'sale_payments', 'expenses', 'capital_accounts', 'capital_transactions', 'capital_entries', 'buyers', 'farmer_advances', 'deductions', 'journal_entries', 'seasons', 'audit_logs', 'opening_balances', 'stock_adjustments', 'opening_balance_payments', 'commissions', 'retained_earnings'];
        const data = {};
        for (const s of stores) {
            data[s] = await this.getAll(s);
        }
        data._exportDate = new Date().toISOString();
        data._version = this.DB_VERSION;
        return data;
    },

    // Restore all data atomically with pre-validation
    async importAll(data) {
        if (!data || typeof data !== 'object') {
            throw new Error('Invalid backup file payload');
        }

        const stores = ['settings', 'purchases', 'farmers', 'purchase_payments', 'sales', 'sale_payments', 'expenses', 'capital_accounts', 'capital_transactions', 'capital_entries', 'buyers', 'farmer_advances', 'deductions', 'journal_entries', 'seasons', 'audit_logs', 'opening_balances', 'stock_adjustments', 'opening_balance_payments', 'commissions', 'retained_earnings'];
        
        // Validate store structures before clearing
        for (const s of stores) {
            if (data[s] && !Array.isArray(data[s])) {
                throw new Error(`Invalid data array format for store: ${s}`);
            }
        }

        // Atomic multi-store restore
        return new Promise((resolve, reject) => {
            const activeStores = stores.filter(s => Array.isArray(data[s]));
            if (!activeStores.length) return resolve(false);

            const tx = this.db.transaction(activeStores, 'readwrite');
            tx.oncomplete = () => resolve(true);
            tx.onerror = (e) => reject(new Error('Atomic import failed and was rolled back: ' + e.target.error));

            activeStores.forEach(s => {
                const store = tx.objectStore(s);
                store.clear();
                data[s].forEach(record => store.put(record));
            });
        });
    }
};

