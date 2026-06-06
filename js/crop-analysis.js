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

    getDateRange() {
        const from = document.getElementById('crop-analysis-from');
        const to = document.getElementById('crop-analysis-to');
        return {
            fromDate: from ? from.value : '',
            toDate: to ? to.value : ''
        };
    },

    resetDates() {
        const from = document.getElementById('crop-analysis-from');
        const to = document.getElementById('crop-analysis-to');
        if (from) from.value = '';
        if (to) to.value = '';
        this.render();
    },

    filterByDateRange(records, fromDate, toDate) {
        if (!fromDate && !toDate) return records;
        return records.filter(r => {
            if (!r.date) return false;
            if (fromDate && r.date < fromDate) return false;
            if (toDate && r.date > toDate) return false;
            return true;
        });
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
        const purchaseAmount = fp.reduce((s, p) => s + Utils.purchaseCostAmount(p), 0);
        const purchaseAvgRate = purchaseMaund > 0 ? purchaseAmount / purchaseMaund : 0;
        const purchasePayable = fp.reduce((s, p) => s + Utils.purchasePayableAmount(p), 0);
        const purchasePaid = fp.reduce((s, p) => s + (p.amountPaid || 0), 0);
        const purchaseBalance = purchasePayable - purchasePaid;

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

        // Use lots logic to determine COGS
        const lotsInfo = Utils.calculateInventoryLots(fp, fs, fe);
        let totalCogs = 0;
        let inventoryValue = 0;
        Object.values(lotsInfo).forEach(lot => {
            totalCogs += lot.cogs || 0;
            inventoryValue += lot.inventoryValue || 0;
        });

        // Expenses linked to purchases are already in COGS. We only subtract unlinked expenses.
        const unlinkedExpenses = fe.filter(e => !e.purchaseId).reduce((s, e) => s + (e.amount || 0), 0);

        // Net P&L
        const netPL = saleAmount - totalCogs - unlinkedExpenses;

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
                <td><span class="badge badge-info">${Utils.escapeHTML(type)}</span></td>
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

    renderRateChartHTML() {
        return `
        <div class="crop-chart-section">
            <h4 class="crop-section-title"><i data-lucide="trending-up"></i> Rate Trend per Maund</h4>
            <div class="crop-chart-container">
                <canvas id="crop-rate-chart"></canvas>
            </div>
        </div>`;
    },

    renderRateTrendChart(purchases, sales, fromDate, toDate) {
        const canvas = document.getElementById('crop-rate-chart');
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.parentElement.getBoundingClientRect();
        const w = rect.width || 600;
        const h = 220;
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        canvas.style.width = w + 'px';
        canvas.style.height = h + 'px';
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, w, h);

        // Determine months to display
        const months = [];
        if (fromDate && toDate) {
            // Use the date range
            const start = new Date(fromDate + 'T00:00:00');
            const end = new Date(toDate + 'T00:00:00');
            const d = new Date(start.getFullYear(), start.getMonth(), 1);
            while (d <= end) {
                months.push({
                    key: d.toISOString().slice(0, 7),
                    label: d.toLocaleString('en', { month: 'short', year: '2-digit' })
                });
                d.setMonth(d.getMonth() + 1);
            }
            // Cap at 12 months
            if (months.length > 12) months.splice(0, months.length - 12);
        } else {
            // Default: last 6 months
            const now = new Date();
            for (let i = 5; i >= 0; i--) {
                const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
                months.push({
                    key: d.toISOString().slice(0, 7),
                    label: d.toLocaleString('en', { month: 'short', year: '2-digit' })
                });
            }
        }

        if (months.length === 0) return;

        // Compute rates per month
        const data = months.map(m => {
            const mp = purchases.filter(p => p.date && p.date.startsWith(m.key));
            const ms = sales.filter(s => s.date && s.date.startsWith(m.key));

            const pWeight = mp.reduce((s, p) => s + (p.netWeight || 0), 0);
            const pAmount = mp.reduce((s, p) => s + Utils.purchaseCostAmount(p), 0);
            const pMaund = pWeight / 40;
            const pRate = pMaund > 0 ? pAmount / pMaund : 0;

            const sWeight = ms.reduce((s, p) => s + (p.netWeight || 0), 0);
            const sAmount = ms.reduce((s, p) => s + (p.amount || 0), 0);
            const sMaund = sWeight / 40;
            const sRate = sMaund > 0 ? sAmount / sMaund : 0;

            return { label: m.label, pRate, sRate };
        });

        // Check if there's any data to plot
        const hasData = data.some(d => d.pRate > 0 || d.sRate > 0);
        if (!hasData) {
            ctx.fillStyle = '#64748b';
            ctx.font = '13px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('No rate data available for this period', w / 2, h / 2);
            return;
        }

        const maxRate = Math.max(1, ...data.map(d => Math.max(d.pRate, d.sRate))) * 1.15;
        const chartLeft = 65;
        const chartRight = w - 25;
        const chartTop = 25;
        const chartBottom = h - 40;
        const chartW = chartRight - chartLeft;
        const chartH = chartBottom - chartTop;

        // Grid lines
        ctx.strokeStyle = 'rgba(203,213,225,0.6)';
        ctx.lineWidth = 0.5;
        for (let i = 0; i <= 4; i++) {
            const y = chartTop + (chartH / 4) * i;
            ctx.beginPath();
            ctx.moveTo(chartLeft, y);
            ctx.lineTo(chartRight, y);
            ctx.stroke();
            // Y-axis labels
            ctx.fillStyle = '#475569';
            ctx.font = '10px Inter, sans-serif';
            ctx.textAlign = 'right';
            const val = maxRate - (maxRate / 4) * i;
            ctx.fillText(val >= 1000 ? (val / 1000).toFixed(1) + 'K' : val.toFixed(0), chartLeft - 8, y + 4);
        }

        const stepX = data.length > 1 ? chartW / (data.length - 1) : chartW;
        const getX = (i) => data.length > 1 ? chartLeft + stepX * i : chartLeft + chartW / 2;
        const getY = (val) => chartBottom - (val / maxRate) * chartH;

        // Helper to draw a filled line
        const drawLine = (key, color1, color2) => {
            const points = data.map((d, i) => ({ x: getX(i), y: getY(d[key]) }));
            const validPoints = points.filter((_, i) => data[i][key] > 0);

            if (validPoints.length === 0) return;

            // Fill area
            ctx.beginPath();
            let started = false;
            let firstX = 0, lastX = 0;
            points.forEach((p, i) => {
                if (data[i][key] > 0) {
                    if (!started) { ctx.moveTo(p.x, p.y); firstX = p.x; started = true; }
                    else ctx.lineTo(p.x, p.y);
                    lastX = p.x;
                }
            });
            ctx.lineTo(lastX, chartBottom);
            ctx.lineTo(firstX, chartBottom);
            ctx.closePath();
            const grad = ctx.createLinearGradient(0, chartTop, 0, chartBottom);
            grad.addColorStop(0, color1 + '25');
            grad.addColorStop(1, color1 + '05');
            ctx.fillStyle = grad;
            ctx.fill();

            // Line
            ctx.beginPath();
            started = false;
            points.forEach((p, i) => {
                if (data[i][key] > 0) {
                    if (!started) { ctx.moveTo(p.x, p.y); started = true; }
                    else ctx.lineTo(p.x, p.y);
                }
            });
            ctx.strokeStyle = color1;
            ctx.lineWidth = 2.5;
            ctx.lineJoin = 'round';
            ctx.lineCap = 'round';
            ctx.stroke();

            // Dots and labels
            points.forEach((p, i) => {
                if (data[i][key] > 0) {
                    // Dot
                    ctx.beginPath();
                    ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
                    ctx.fillStyle = color1;
                    ctx.fill();
                    ctx.beginPath();
                    ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
                    ctx.fillStyle = '#ffffff';
                    ctx.fill();

                    // Value label
                    const val = data[i][key];
                    ctx.fillStyle = color2;
                    ctx.font = 'bold 9px Inter, sans-serif';
                    ctx.textAlign = 'center';
                    const label = val >= 1000 ? (val / 1000).toFixed(1) + 'K' : val.toFixed(0);
                    ctx.fillText(label, p.x, p.y - 10);
                }
            });
        };

        // Draw purchase rate line (blue)
        drawLine('pRate', '#3b82f6', '#60a5fa');
        // Draw sale rate line (green)
        drawLine('sRate', '#10b981', '#34d399');

        // X-axis labels
        data.forEach((d, i) => {
            ctx.fillStyle = '#64748b';
            ctx.font = '10px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(d.label, getX(i), chartBottom + 16);
        });

        // Legend
        const legendY = h - 8;
        ctx.fillStyle = '#3b82f6';
        ctx.fillRect(chartLeft, legendY - 8, 10, 8);
        ctx.fillStyle = '#475569';
        ctx.font = '10px Inter, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText('Purchase Rate/Mn', chartLeft + 14, legendY);

        ctx.fillStyle = '#10b981';
        ctx.fillRect(chartLeft + 130, legendY - 8, 10, 8);
        ctx.fillStyle = '#475569';
        ctx.fillText('Sale Rate/Mn', chartLeft + 144, legendY);
    },

    async render() {
        const sel = document.getElementById('crop-analysis-select');
        const container = document.getElementById('crop-analysis-content');
        if (!sel || !container) return;

        this.selectedCrop = sel.value;
        const { fromDate, toDate } = this.getDateRange();

        let purchases = await DB.getAll('purchases');
        let sales = await DB.getAll('sales');
        let expenses = await DB.getAll('expenses');

        // Apply season filter if active
        const activeSeason = typeof SeasonManager !== 'undefined' ? await SeasonManager.getActiveSeason() : null;
        if (activeSeason) {
            purchases = SeasonManager.filterByActiveSeason(purchases, activeSeason);
            sales = SeasonManager.filterByActiveSeason(sales, activeSeason);
            expenses = SeasonManager.filterByActiveSeason(expenses, activeSeason);
        } else {
            purchases = purchases.filter(p => p.type !== 'opening_balance');
        }

        // Apply date range filter
        purchases = this.filterByDateRange(purchases, fromDate, toDate);
        sales = this.filterByDateRange(sales, fromDate, toDate);
        expenses = this.filterByDateRange(expenses, fromDate, toDate);

        // Filter by crop for metrics
        const m = this.computeMetrics(this.selectedCrop, purchases, sales, expenses);

        // Check if there's any data at all
        if (m.purchaseCount === 0 && m.saleCount === 0 && m.totalExpenses === 0) {
            container.innerHTML = `
                <div class="crop-empty-state">
                    <i data-lucide="bar-chart-2" style="width:48px;height:48px;color:var(--text-muted);margin-bottom:12px"></i>
                    <h3>No Data Available</h3>
                    <p>${this.selectedCrop ? `No transactions found for "${Utils.escapeHTML(this.selectedCrop)}".` : 'Start adding purchases and sales to see crop analysis here.'}</p>
                </div>`;
            Utils.safeCreateIcons();
            return;
        }

        // Build content: KPI cards + expenses + rate trend chart
        container.innerHTML =
            this.renderKPICards(m) +
            this.renderExpensesTable(m.expensesByType, m.totalExpenses) +
            this.renderRateChartHTML();

        Utils.safeCreateIcons();

        // Render the rate trend chart on canvas (after DOM update)
        const cropPurchases = this.selectedCrop ? purchases.filter(p => p.crop === this.selectedCrop) : purchases;
        const cropSales = this.selectedCrop ? sales.filter(s => s.crop === this.selectedCrop) : sales;
        setTimeout(() => this.renderRateTrendChart(cropPurchases, cropSales, fromDate, toDate), 50);
    }
};
