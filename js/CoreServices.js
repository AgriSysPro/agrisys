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
        console.log('Running materialized view migrations...');
        const stockCount = (await DB.getAll('warehouse_stock')).length;
        if (stockCount === 0) {
            console.log('Backfilling warehouse_stock...');
            // Need to backfill
            const purchases = await DB.getAll('purchases');
            const sales = await DB.getAll('sales');
            const adjustments = await DB.getAll('stock_adjustments');
            
            const stockMap = {};
            for (const p of purchases) {
                if (!p.crop) continue;
                const c = p.crop.trim().toLowerCase();
                stockMap[c] = (stockMap[c] || 0) + (p.netWeight || 0);
            }
            for (const a of adjustments) {
                if (!a.crop) continue;
                const c = a.crop.trim().toLowerCase();
                const amt = a.direction === 'in' ? (a.quantity || 0) : -(a.quantity || 0);
                stockMap[c] = (stockMap[c] || 0) + amt;
            }
            for (const s of sales) {
                if (!s.crop) continue;
                const c = s.crop.trim().toLowerCase();
                stockMap[c] = (stockMap[c] || 0) - (s.netWeight || 0);
            }
            const openingBalances = await DB.getAll('opening_balances');
            for (const ob of openingBalances) {
                if (ob.type === 'stock' && ob.crop) {
                    const c = ob.crop.trim().toLowerCase();
                    stockMap[c] = (stockMap[c] || 0) + (ob.weight || 0);
                }
            }
            
            for (const [crop, weight] of Object.entries(stockMap)) {
                await DB.put('warehouse_stock', { crop, netWeight: weight });
            }
            console.log('warehouse_stock backfilled.');
        }

        const partyCount = (await DB.getAll('party_running_balances')).length;
        if (partyCount === 0) {
            console.log('Backfilling party_running_balances...');
            // Farmer payables
            const purchases = await DB.getAll('purchases');
            const farmerMap = {};
            for (const p of purchases) {
                if (!p.farmerName) continue;
                const f = p.farmerName.trim().toLowerCase();
                farmerMap[f] = (farmerMap[f] || 0) + ((p.netPayableAmount || p.amount || 0) - (p.amountPaid || 0));
            }
            const openingBalances = await DB.getAll('opening_balances');
            for (const ob of openingBalances) {
                if (ob.type === 'farmer_payable' && ob.partyName) {
                    const f = ob.partyName.trim().toLowerCase();
                    farmerMap[f] = (farmerMap[f] || 0) + (ob.amount || 0);
                }
                if (ob.type === 'farmer_advance' && ob.partyName) {
                    const f = ob.partyName.trim().toLowerCase();
                    farmerMap[f] = (farmerMap[f] || 0) - (ob.amount || 0);
                }
            }
            const advances = await DB.getAll('farmer_advances');
            for (const a of advances) {
                if (a.farmerName) {
                    const f = a.farmerName.trim().toLowerCase();
                    farmerMap[f] = (farmerMap[f] || 0) - (a.amount || 0);
                }
            }
            
            for (const [f, bal] of Object.entries(farmerMap)) {
                await DB.put('party_running_balances', { id: `farmer_${f}`, type: 'farmer', partyName: f, balance: bal });
            }

            // Buyer receivables
            const sales = await DB.getAll('sales');
            const buyerMap = {};
            for (const s of sales) {
                if (!s.buyerName) continue;
                const b = s.buyerName.trim().toLowerCase();
                buyerMap[b] = (buyerMap[b] || 0) + ((s.amount || 0) - (s.amountReceived || 0));
            }
            for (const ob of openingBalances) {
                if (ob.type === 'buyer_receivable' && ob.partyName) {
                    const b = ob.partyName.trim().toLowerCase();
                    buyerMap[b] = (buyerMap[b] || 0) + (ob.amount || 0);
                }
                if (ob.type === 'buyer_advance' && ob.partyName) {
                    const b = ob.partyName.trim().toLowerCase();
                    buyerMap[b] = (buyerMap[b] || 0) - (ob.amount || 0);
                }
            }
            for (const [b, bal] of Object.entries(buyerMap)) {
                await DB.put('party_running_balances', { id: `buyer_${b}`, type: 'buyer', partyName: b, balance: bal });
            }
            console.log('party_running_balances backfilled.');
        }
    }
};

window.CoreServices = CoreServices;
