// ===== Core Business Services (Performance & Logic) =====

const CoreServices = {
    // ---- Materialized View Getters ----
    
    async getAvailableStock(crop) {
        if (!crop) return 0;
        const cropLower = crop.trim().toLowerCase();
        const record = await DB.get('warehouse_stock', cropLower);
        return record ? record.netWeight : 0;
    },

    async getFarmerBalance(farmerName) {
        if (!farmerName) return 0;
        const key = `farmer_${farmerName.trim().toLowerCase()}`;
        const record = await DB.get('party_running_balances', key);
        return record ? record.balance : 0;
    },

    async getBuyerBalance(buyerName) {
        if (!buyerName) return 0;
        const key = `buyer_${buyerName.trim().toLowerCase()}`;
        const record = await DB.get('party_running_balances', key);
        return record ? record.balance : 0;
    },

    // ---- Operations Builders (for atomic commits) ----

    async getStockOp(crop, deltaWeight) {
        if (!crop || deltaWeight === 0) return null;
        const cropLower = crop.trim().toLowerCase();
        const record = await DB.get('warehouse_stock', cropLower) || { crop: cropLower, netWeight: 0 };
        record.netWeight += deltaWeight;
        return { storeName: 'warehouse_stock', action: 'put', data: record };
    },

    async getPartyBalanceOp(partyType, partyName, deltaBalance) {
        if (!partyName || deltaBalance === 0) return null;
        const pName = partyName.trim().toLowerCase();
        const id = `${partyType}_${pName}`;
        const record = await DB.get('party_running_balances', id) || { id, type: partyType, partyName: pName, balance: 0 };
        record.balance += deltaBalance;
        return { storeName: 'party_running_balances', action: 'put', data: record };
    },

    // ---- Migration Script ----
    async runMaterializedViewMigrations() {
        // Rebuild from source records, including after restore and schema changes.
        const purchases = (await DB.getAll('purchases')).filter(p => p.type !== 'opening_balance');
        const sales = await DB.getAll('sales');
        const purchasePayments = await DB.getAll('purchase_payments');
        const salePayments = await DB.getAll('sale_payments');
        const adjustments = await DB.getAll('stock_adjustments');
        const adjusted = Utils.applyStockAdjustments(purchases, sales, adjustments);
        const stock = {}, parties = {};
        const addStock = (crop, weight) => { if (crop) { const key = crop.trim().toLowerCase(); stock[key] = (stock[key] || 0) + weight; } };
        adjusted.purchases.forEach(p => addStock(p.crop, p.netWeight || 0));
        adjusted.sales.forEach(s => addStock(s.crop, -(s.netWeight || 0)));
        const addParty = (type, name, delta) => {
            if (!name) return;
            const normalized = name.trim().toLowerCase(), id = type + '_' + normalized;
            parties[id] ||= { id, type, partyName: normalized, balance: 0 };
            parties[id].balance += delta;
        };
        purchases.forEach(p => addParty('farmer', p.farmerName, Utils.purchasePayableAmount(p) - Utils.paymentTotalFor(p, purchasePayments, 'purchaseId', 'amountPaid') + (p.advanceDeducted || 0)));
        sales.forEach(s => addParty('buyer', s.buyerName, (s.amount || 0) - Utils.paymentTotalFor(s, salePayments, 'saleId', 'amountReceived')));
        const openings = await DB.getAll('opening_balances');
        openings.forEach(o => {
            if (o.type === 'farmer_payable') addParty('farmer', o.partyName, (o.amount || 0) - Utils.openingBalanceSettled(o));
            if (o.type === 'farmer_advance') addParty('farmer', o.partyName, -(o.amount || 0));
            if (o.type === 'buyer_receivable') addParty('buyer', o.partyName, (o.amount || 0) - Utils.openingBalanceSettled(o));
            if (o.type === 'buyer_advance') addParty('buyer', o.partyName, -(o.amount || 0));
        });
        (await DB.getAll('farmer_advances')).filter(a => a.amount > 0).forEach(a => addParty('farmer', a.farmerName, -a.amount));
        purchasePayments.forEach(p => addParty('farmer', p.farmerName, p.advanceDeducted || 0));
        salePayments.forEach(p => addParty('buyer', p.buyerName, p.advanceDeducted || 0));
        const ops = [];
        for (const store of ['warehouse_stock', 'party_running_balances']) {
            (await DB.getAll(store)).forEach(record => ops.push({ storeName: store, action: 'delete', key: record.id ?? record.crop }));
        }
        Object.entries(stock).forEach(([crop, netWeight]) => ops.push({ storeName: 'warehouse_stock', action: 'put', data: { crop, netWeight } }));
        Object.values(parties).forEach(data => ops.push({ storeName: 'party_running_balances', action: 'put', data }));
        await DB.commitUnitOfWork(ops);
    }
};

window.CoreServices = CoreServices;
