// ===== Crop Analysis Dashboard Module =====
const CropAnalysis = {
    selectedCrop: '',

    async init() {
        const purchases = await DB.getAll('purchases');
        const sales = await DB.getAll('sales');
        const expenses = await DB.getAll('expenses');
        const settingsCrops = await Settings.getCrops();

        // Merge setting crops + any crops found in actual data
        const dataCrops = new Set([
            ...purchases.map(p => p.crop).filter(c => c),
            ...sales.map(s => s.crop).filter(c => c),
            ...expenses.map(e => e.crop).filter(c => c)
        ]);
        settingsCrops.forEach(c => dataCrops.add(c));

        const allCrops = [...dataCrops].sort();

        const sel = document.getElementById('crop-analysis-select');
        if (!sel) return;
        const currentVal = sel.value;
        sel.innerHTML = '<option value="">All Crops</option>';
        allCrops.forEach(c => {
            const o = document.createElement('option');
            o.value = c;
            o.textContent = c;
            sel.appendChild(o);
        });
        if (currentVal) sel.value = currentVal;
    },

    computeMetrics(crop, purchases, sales, expenses) {
        // Filter by crop (empty = all)
        const fp = crop ? purchases.filter(p => p.crop === crop) : purchases;
        const fs = crop ? sales.filter(s => s.crop === crop) : sales;
        const fe = crop ? expenses.filter(e => e.crop === crop) : expenses;

        // Purchase metrics
        const purchaseCount = fp.length;
        const purchaseWeight = fp.reduce((s, p) => s + (p.netWeight || 0), 0);
        const purchaseMaund = purchaseWeight / 40;
        const purchaseAmount = fp.reduce((s, p) => s + (p.netPayableAmount || p.amount || 0), 0);
        const purchaseAvgRate = purchaseMaund > 0 ? purchaseAmount / purchaseMaund : 0;
        const purchasePaid = fp.reduce((s, p) => s + (p.amountPaid || 0), 0);
        const purchaseBalance = purchaseAmount - purchasePaid;

        // Sale metrics
        const saleCount = fs.length;
        const saleWeight = fs.reduce((s, p) => s + (p.netWeight || 0), 0);
        const saleMaund = saleWeight / 40;
        const saleAmount = fs.reduce((s, p) => s + (p.amount || 0), 0);
        const saleAvgRate = saleMaund > 0 ? saleAmount / saleMaund : 0;
        const saleReceived = fs.reduce((s, p) => s + (p.amountReceived || 0), 0);
        const saleBalance = saleAmount - saleReceived;

        // Net inventory
        const netWeight = purchaseWeight - saleWeight;
        const netMaund = netWeight / 40;

        // Expenses
        const totalExpenses = fe.reduce((s, e) => s + (e.amount || 0), 0);

        // Group expenses by type
        const expensesByType = {};
        fe.forEach(e => {
            const type = e.type || 'misc';
            if (!expensesByType[type]) expensesByType[type] = { count: 0, amount: 0 };
            expensesByType[type].count++;
            expensesByType[type].amount += (e.amount || 0);
        });

        // Effective cost per maund (purchase + expenses)
        const effectiveCostPerMn = purchaseMaund > 0 ? (purchaseAmount + totalExpenses) / purchaseMaund : 0;

        // Net P&L
        const netPL = saleAmount - purchaseAmount - totalExpenses;

        // Remaining amount (purchase balance - sale balance)
        const remainingAmount = purchaseBalance - saleBalance;

        return {
            purchaseCount, purchaseWeight, purchaseMaund, purchaseAmount, purchaseAvgRate,
            purchasePaid, purchaseBalance,
            saleCount, saleWeight, saleMaund, saleAmount, saleAvgRate,
            saleReceived, saleBalance,
            netWeight, netMaund,
            totalExpenses, expensesByType, effectiveCostPerMn,
            netPL, remainingAmount
        };
    },

    renderKPICards(m) {
        const plClass = m.netPL >= 0 ? 'profit' : 'loss';
        const plSign = m.netPL >= 0 ? '+' : '';
        const invSign = m.netWeight >= 0 ? '' : '-';

        return `
        <div class="crop-kpi-grid">
            <div class="crop-stat purchases">
                <div class="crop-stat-icon"><i data-lucide="shopping-cart"></i></div>
                <div class="crop-stat-body">
                    <div class="crop-stat-label">Total Purchases</div>
                    <div class="crop-stat-value">${m.purchaseCount} <span class="crop-stat-unit">receipts</span></div>
                    <div class="crop-stat-metrics">
                        <div class="crop-metric"><span class="crop-metric-label">Weight</span><span class="crop-metric-value">${Utils.formatNum(m.purchaseWeight, 2)} KG <small>(${Utils.formatNum(m.purchaseMaund, 2)} Mn)</small></span></div>
                        <div class="crop-metric"><span class="crop-metric-label">Amount</span><span class="crop-metric-value">PKR ${Utils.formatPKR(m.purchaseAmount)}</span></div>
                        <div class="crop-metric"><span class="crop-metric-label">Avg Rate/Mn</span><span class="crop-metric-value">PKR ${Utils.formatPKR(m.purchaseAvgRate)}</span></div>
                    </div>
                </div>
            </div>

            <div class="crop-stat sales">
                <div class="crop-stat-icon"><i data-lucide="tag"></i></div>
                <div class="crop-stat-body">
                    <div class="crop-stat-label">Total Sales</div>
                    <div class="crop-stat-value">${m.saleCount} <span class="crop-stat-unit">receipts</span></div>
                    <div class="crop-stat-metrics">
                        <div class="crop-metric"><span class="crop-metric-label">Weight</span><span class="crop-metric-value">${Utils.formatNum(m.saleWeight, 2)} KG <small>(${Utils.formatNum(m.saleMaund, 2)} Mn)</small></span></div>
                        <div class="crop-metric"><span class="crop-metric-label">Amount</span><span class="crop-metric-value">PKR ${Utils.formatPKR(m.saleAmount)}</span></div>
                        <div class="crop-metric"><span class="crop-metric-label">Avg Rate/Mn</span><span class="crop-metric-value">PKR ${Utils.formatPKR(m.saleAvgRate)}</span></div>
                    </div>
                </div>
            </div>

            <div class="crop-stat inventory">
                <div class="crop-stat-icon"><i data-lucide="warehouse"></i></div>
                <div class="crop-stat-body">
                    <div class="crop-stat-label">Net Inventory</div>
                    <div class="crop-stat-value">${Utils.formatNum(Math.abs(m.netWeight), 2)} <span class="crop-stat-unit">KG</span></div>
                    <div class="crop-stat-metrics">
                        <div class="crop-metric"><span class="crop-metric-label">In Maund</span><span class="crop-metric-value">${invSign}${Utils.formatNum(Math.abs(m.netMaund), 2)} Mn</span></div>
                        <div class="crop-metric"><span class="crop-metric-label">Status</span><span class="crop-metric-value">${m.netWeight > 0 ? '<span class="badge badge-success">In Stock</span>' : m.netWeight < 0 ? '<span class="badge badge-danger">Oversold</span>' : '<span class="badge badge-warning">Empty</span>'}</span></div>
                    </div>
                </div>
            </div>

            <div class="crop-stat purchase-amount">
                <div class="crop-stat-icon"><i data-lucide="arrow-up-circle"></i></div>
                <div class="crop-stat-body">
                    <div class="crop-stat-label">Purchase Cost</div>
                    <div class="crop-stat-value">PKR ${Utils.formatPKR(m.purchaseAmount)}</div>
                    <div class="crop-stat-metrics">
                        <div class="crop-metric"><span class="crop-metric-label">Paid</span><span class="crop-metric-value">PKR ${Utils.formatPKR(m.purchasePaid)}</span></div>
                        <div class="crop-metric"><span class="crop-metric-label">Balance</span><span class="crop-metric-value crop-val-danger">PKR ${Utils.formatPKR(m.purchaseBalance)}</span></div>
                    </div>
                </div>
            </div>

            <div class="crop-stat sale-revenue">
                <div class="crop-stat-icon"><i data-lucide="arrow-down-circle"></i></div>
                <div class="crop-stat-body">
                    <div class="crop-stat-label">Sales Revenue</div>
                    <div class="crop-stat-value">PKR ${Utils.formatPKR(m.saleAmount)}</div>
                    <div class="crop-stat-metrics">
                        <div class="crop-metric"><span class="crop-metric-label">Received</span><span class="crop-metric-value">PKR ${Utils.formatPKR(m.saleReceived)}</span></div>
                        <div class="crop-metric"><span class="crop-metric-label">Receivable</span><span class="crop-metric-value crop-val-warning">PKR ${Utils.formatPKR(m.saleBalance)}</span></div>
                    </div>
                </div>
            </div>

            <div class="crop-stat net-pl ${plClass}">
                <div class="crop-stat-icon"><i data-lucide="trending-up"></i></div>
                <div class="crop-stat-body">
                    <div class="crop-stat-label">Net Profit / Loss</div>
                    <div class="crop-stat-value">${plSign}PKR ${Utils.formatPKR(Math.abs(m.netPL))}</div>
                    <div class="crop-stat-metrics">
                        <div class="crop-metric"><span class="crop-metric-label">Cost/Mn (Effective)</span><span class="crop-metric-value">PKR ${Utils.formatPKR(m.effectiveCostPerMn)}</span></div>
                        <div class="crop-metric"><span class="crop-metric-label">Total Expenses</span><span class="crop-metric-value">PKR ${Utils.formatPKR(m.totalExpenses)}</span></div>
                    </div>
                </div>
            </div>
        </div>`;
    },

    renderExpensesTable(expensesByType, totalExpenses) {
        const types = Object.entries(expensesByType).sort((a, b) => b[1].amount - a[1].amount);

        if (types.length === 0) {
            return `
            <div class="crop-expenses-section">
                <h4 class="crop-section-title"><i data-lucide="receipt"></i> Crop-Linked Expenses</h4>
                <div class="crop-no-data">No expenses recorded for this crop</div>
            </div>`;
        }

        const rows = types.map(([type, data]) => {
            const pct = totalExpenses > 0 ? ((data.amount / totalExpenses) * 100).toFixed(1) : 0;
            return `<tr>
                <td><span class="badge badge-info">${type}</span></td>
                <td class="text-center">${data.count}</td>
                <td class="text-right font-bold">PKR ${Utils.formatPKR(data.amount)}</td>
                <td>
                    <div class="crop-expense-bar-wrap">
                        <div class="crop-expense-bar" style="width:${pct}%"></div>
                        <span class="crop-expense-pct">${pct}%</span>
                    </div>
                </td>
            </tr>`;
        }).join('');

        return `
        <div class="crop-expenses-section">
            <h4 class="crop-section-title"><i data-lucide="receipt"></i> Crop-Linked Expenses Breakdown</h4>
            <div class="table-container crop-expenses-table-wrap">
                <table class="data-table crop-expenses-table">
                    <thead><tr>
                        <th>Type</th>
                        <th class="text-center">Count</th>
                        <th class="text-right">Amount</th>
                        <th>Distribution</th>
                    </tr></thead>
                    <tbody>${rows}</tbody>
                    <tfoot><tr class="crop-expenses-total">
                        <td colspan="2"><strong>Total Expenses</strong></td>
                        <td class="text-right"><strong>PKR ${Utils.formatPKR(totalExpenses)}</strong></td>
                        <td></td>
                    </tr></tfoot>
                </table>
            </div>
        </div>`;
    },

    async render() {
        const sel = document.getElementById('crop-analysis-select');
        const container = document.getElementById('crop-analysis-content');
        if (!sel || !container) return;

        this.selectedCrop = sel.value;

        const purchases = await DB.getAll('purchases');
        const sales = await DB.getAll('sales');
        const expenses = await DB.getAll('expenses');

        const m = this.computeMetrics(this.selectedCrop, purchases, sales, expenses);

        // Check if there's any data at all
        if (m.purchaseCount === 0 && m.saleCount === 0 && m.totalExpenses === 0) {
            container.innerHTML = `
                <div class="crop-empty-state">
                    <i data-lucide="bar-chart-2" style="width:48px;height:48px;color:var(--text-muted);margin-bottom:12px"></i>
                    <h3>No Data Available</h3>
                    <p>${this.selectedCrop ? `No transactions found for "${this.selectedCrop}".` : 'Start adding purchases and sales to see crop analysis here.'}</p>
                </div>`;
            lucide.createIcons();
            return;
        }

        container.innerHTML = this.renderKPICards(m) + this.renderExpensesTable(m.expensesByType, m.totalExpenses);
        lucide.createIcons();
    }
};
