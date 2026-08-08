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
            const rDate = String(r.date).split('T')[0];
            const fDate = fromDate ? String(fromDate).split('T')[0] : '';
            const tDate = toDate ? String(toDate).split('T')[0] : '';
            if (fDate && rDate < fDate) return false;
            if (tDate && rDate > tDate) return false;
            return true;
        });
    },

    computeMetrics(crop, purchases, sales, expenses) {
        // Filter by crop (empty = all)
        const cropLower = (crop || '').trim().toLowerCase();
        const fp = cropLower ? purchases.filter(p => p.crop && p.crop.trim().toLowerCase() === cropLower) : purchases;
        const fs = cropLower ? sales.filter(s => s.crop && s.crop.trim().toLowerCase() === cropLower) : sales;
        const fe = cropLower ? expenses.filter(e => e.crop && e.crop.trim().toLowerCase() === cropLower) : expenses;

        const actualPurchases = fp.filter(p => p.type !== 'stock_adjustment' && p.type !== 'opening_stock');
        const actualSales = fs.filter(s => s.type !== 'stock_adjustment');

        // Purchase metrics
        const purchaseCount = actualPurchases.length;
        const purchaseWeight = Utils.sumBy(fp, 'netWeight');
        const purchaseMaund = purchaseWeight / 40;
        const purchaseAmount = Utils.sumBy(actualPurchases, p => Utils.purchaseCostAmount(p));
        const purchaseAvgRate = purchaseMaund > 0 ? purchaseAmount / purchaseMaund : 0;
        const purchasePayable = Utils.sumBy(actualPurchases, p => Utils.purchasePayableAmount(p));
        const purchasePaid = Utils.sumBy(actualPurchases, 'amountPaid');
        const purchaseBalance = purchasePayable - purchasePaid;

        // Sale metrics
        const saleCount = actualSales.length;
        const saleWeight = Utils.sumBy(fs, 'netWeight');
        const saleMaund = saleWeight / 40;
        const saleAmount = Utils.sumBy(actualSales, 'amount');
        const saleAvgRate = saleMaund > 0 ? saleAmount / saleMaund : 0;
        const saleReceived = Utils.sumBy(actualSales, 'amountReceived');
        const saleBalance = saleAmount - saleReceived;

        // Net inventory
        const netWeight = purchaseWeight - saleWeight;
        const netMaund = netWeight / 40;

        // Expenses
        const totalExpenses = Utils.sumBy(fe, 'amount');

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

        // Commission Revenue earned on purchases
        const totalCommission = Utils.sumBy(fp, 'commissionTotal');

        // Expenses linked to purchases are already in COGS. We only subtract unlinked expenses.
        const unlinkedExpenses = Utils.sumBy(fe.filter(e => !e.purchaseId), 'amount');

        // Net P&L (Sale Revenue + Commission Revenue - COGS - Unlinked Expenses)
        const netPL = saleAmount + totalCommission - totalCogs - unlinkedExpenses;

        // Remaining amount (purchase balance - sale balance)
        const remainingAmount = purchaseBalance - saleBalance;

        return {
            purchaseCount, purchaseWeight, purchaseMaund, purchaseAmount, purchaseAvgRate,
            purchasePaid, purchaseBalance, totalCommission,
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
        const rect = canvas.parentElement ? canvas.parentElement.getBoundingClientRect() : null;
        const w = (rect && rect.width > 0) ? rect.width : (canvas.clientWidth || 600);
        const h = 240;
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        canvas.style.width = w + 'px';
        canvas.style.height = h + 'px';
        ctx.scale(dpr, dpr);

        // Fill crisp white card background
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);

        // Determine months to display
        const months = [];
        if (fromDate && toDate) {
            const start = new Date(fromDate + 'T00:00:00');
            const end = new Date(toDate + 'T00:00:00');
            const d = new Date(start.getFullYear(), start.getMonth(), 1);
            while (d <= end) {
                const year = d.getFullYear();
                const month = String(d.getMonth() + 1).padStart(2, '0');
                months.push({
                    key: `${year}-${month}`,
                    label: d.toLocaleString('en', { month: 'short', year: '2-digit' })
                });
                d.setMonth(d.getMonth() + 1);
            }
            if (months.length > 12) months.splice(0, months.length - 12);
        } else {
            const now = new Date();
            for (let i = 5; i >= 0; i--) {
                const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
                const year = d.getFullYear();
                const month = String(d.getMonth() + 1).padStart(2, '0');
                months.push({
                    key: `${year}-${month}`,
                    label: d.toLocaleString('en', { month: 'short', year: '2-digit' })
                });
            }
        }

        if (months.length === 0) return;

        // Compute rates per month
        const data = months.map(m => {
            const mp = purchases.filter(p => p.date && p.date.startsWith(m.key));
            const ms = sales.filter(s => s.date && s.date.startsWith(m.key));

            const pWeight = Utils.sumBy(mp, 'netWeight');
            const pAmount = Utils.sumBy(mp, p => Utils.purchaseCostAmount(p));
            const pMaund = pWeight / 40;
            const pRate = pMaund > 0 ? pAmount / pMaund : 0;

            const sWeight = Utils.sumBy(ms, 'netWeight');
            const sAmount = Utils.sumBy(ms, 'amount');
            const sMaund = sWeight / 40;
            const sRate = sMaund > 0 ? sAmount / sMaund : 0;

            return { label: m.label, pRate, sRate };
        });

        // Check if there's any data to plot
        const hasData = data.some(d => d.pRate > 0 || d.sRate > 0);
        if (!hasData) {
            ctx.fillStyle = '#64748b';
            ctx.font = '500 13px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('No rate data available for this period', w / 2, h / 2);
            return;
        }

        const maxRate = Math.max(1, ...data.map(d => Math.max(d.pRate, d.sRate))) * 1.25;
        const chartLeft = 65;
        const chartRight = w - 25;
        const chartTop = 30;
        const chartBottom = h - 45;
        const chartW = chartRight - chartLeft;
        const chartH = chartBottom - chartTop;

        // Grid lines
        ctx.strokeStyle = 'rgba(226, 232, 240, 0.9)';
        ctx.lineWidth = 1;
        for (let i = 0; i <= 4; i++) {
            const y = chartTop + (chartH / 4) * i;
            ctx.beginPath();
            ctx.moveTo(chartLeft, y);
            ctx.lineTo(chartRight, y);
            ctx.stroke();
            // Y-axis labels
            ctx.fillStyle = '#475569';
            ctx.font = '600 11px Inter, sans-serif';
            ctx.textAlign = 'right';
            const val = maxRate - (maxRate / 4) * i;
            ctx.fillText(val >= 1000 ? (val / 1000).toFixed(1) + 'K' : val.toFixed(0), chartLeft - 10, y + 4);
        }

        const stepX = data.length > 1 ? chartW / (data.length - 1) : chartW;
        const getX = (i) => data.length > 1 ? chartLeft + stepX * i : chartLeft + chartW / 2;
        const getY = (val) => chartBottom - (val / maxRate) * chartH;

        // Helper function for drawing lines
        const drawLine = (key, strokeColor, fillColor) => {
            const points = data.map((d, i) => ({ x: getX(i), y: getY(d[key]), val: d[key] }));
            const validPoints = points.filter(p => p.val > 0);
            if (!validPoints.length) return;

            // Gradient Fill
            ctx.beginPath();
            let firstX = validPoints[0].x;
            let lastX = validPoints[validPoints.length - 1].x;
            ctx.moveTo(firstX, chartBottom);
            validPoints.forEach((p) => ctx.lineTo(p.x, p.y));
            ctx.lineTo(lastX, chartBottom);
            ctx.closePath();

            const grad = ctx.createLinearGradient(0, chartTop, 0, chartBottom);
            grad.addColorStop(0, fillColor);
            grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
            ctx.fillStyle = grad;
            ctx.fill();

            // Line
            ctx.beginPath();
            validPoints.forEach((p, i) => {
                if (i === 0) ctx.moveTo(p.x, p.y);
                else ctx.lineTo(p.x, p.y);
            });
            ctx.strokeStyle = strokeColor;
            ctx.lineWidth = 3;
            ctx.lineJoin = 'round';
            ctx.lineCap = 'round';
            ctx.stroke();

            // Data Points
            validPoints.forEach((p) => {
                ctx.beginPath();
                ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
                ctx.fillStyle = strokeColor;
                ctx.fill();
                ctx.beginPath();
                ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
                ctx.fillStyle = '#ffffff';
                ctx.fill();
            });
        };

        // Draw Purchase line (Blue)
        drawLine('pRate', '#2563eb', 'rgba(37, 99, 235, 0.18)');
        // Draw Sale line (Emerald Green)
        drawLine('sRate', '#059669', 'rgba(5, 150, 105, 0.18)');

        // Collision-Aware Pill Label Renderer
        const drawPill = (text, cx, cy, isAbove, color, bgColor, borderColor) => {
            ctx.font = 'bold 10px Inter, sans-serif';
            const metrics = ctx.measureText(text);
            const textW = metrics.width;
            const padX = 7;
            const padY = 3;
            const boxW = textW + padX * 2;
            const boxH = 16;
            const boxX = cx - boxW / 2;
            const boxY = isAbove ? cy - boxH - 4 : cy + 8;

            ctx.fillStyle = bgColor;
            ctx.strokeStyle = borderColor;
            ctx.lineWidth = 1;
            ctx.beginPath();
            if (typeof ctx.roundRect === 'function') {
                ctx.roundRect(boxX, boxY, boxW, boxH, [4]);
            } else {
                ctx.rect(boxX, boxY, boxW, boxH);
            }
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = color;
            ctx.textAlign = 'center';
            ctx.fillText(text, cx, boxY + 11);
        };

        // Smart Label Placement per month
        data.forEach((d, i) => {
            const x = getX(i);
            const pVal = d.pRate;
            const sVal = d.sRate;
            const pY = getY(pVal);
            const sY = getY(sVal);

            const pLabel = pVal >= 1000 ? (pVal / 1000).toFixed(1) + 'K' : pVal.toFixed(0);
            const sLabel = sVal >= 1000 ? (sVal / 1000).toFixed(1) + 'K' : sVal.toFixed(0);

            if (pVal > 0 && sVal > 0) {
                if (Math.abs(pY - sY) < 24) {
                    // Collision detected! Place higher rate above, lower rate below
                    if (pVal >= sVal) {
                        drawPill(pLabel, x, pY, true, '#1e40af', 'rgba(239, 246, 255, 0.95)', '#93c5fd');
                        drawPill(sLabel, x, sY, false, '#065f46', 'rgba(236, 253, 245, 0.95)', '#6ee7b7');
                    } else {
                        drawPill(sLabel, x, sY, true, '#065f46', 'rgba(236, 253, 245, 0.95)', '#6ee7b7');
                        drawPill(pLabel, x, pY, false, '#1e40af', 'rgba(239, 246, 255, 0.95)', '#93c5fd');
                    }
                } else {
                    drawPill(pLabel, x, pY, true, '#1e40af', 'rgba(239, 246, 255, 0.95)', '#93c5fd');
                    drawPill(sLabel, x, sY, true, '#065f46', 'rgba(236, 253, 245, 0.95)', '#6ee7b7');
                }
            } else if (pVal > 0) {
                drawPill(pLabel, x, pY, true, '#1e40af', 'rgba(239, 246, 255, 0.95)', '#93c5fd');
            } else if (sVal > 0) {
                drawPill(sLabel, x, sY, true, '#065f46', 'rgba(236, 253, 245, 0.95)', '#6ee7b7');
            }
        });

        // X-axis labels
        data.forEach((d, i) => {
            ctx.fillStyle = '#334155';
            ctx.font = '600 11px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(d.label, getX(i), chartBottom + 18);
        });

        // Legend
        const legendY = h - 10;
        // Purchase Legend Badge
        ctx.fillStyle = '#2563eb';
        ctx.beginPath();
        ctx.arc(chartLeft + 10, legendY - 3, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#1e293b';
        ctx.font = '600 11px Inter, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText('Purchase Rate / Mn', chartLeft + 20, legendY);

        // Sale Legend Badge
        ctx.fillStyle = '#059669';
        ctx.beginPath();
        ctx.arc(chartLeft + 160, legendY - 3, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#1e293b';
        ctx.fillText('Sale Rate / Mn', chartLeft + 170, legendY);
    },

    async render() {
        const sel = document.getElementById('crop-analysis-select');
        const container = document.getElementById('crop-analysis-content');
        if (!sel || !container) return;

        this.selectedCrop = sel.value;
        const { fromDate, toDate } = this.getDateRange();

        let purchases, sales, expenses, stockAdjustments;
        if (fromDate || toDate) {
            try {
                purchases = await DB.getByDateRange('purchases', fromDate, toDate);
                sales = await DB.getByDateRange('sales', fromDate, toDate);
                expenses = await DB.getByDateRange('expenses', fromDate, toDate);
                stockAdjustments = await DB.getByDateRange('stock_adjustments', fromDate, toDate);
            } catch (e) {
                purchases = await DB.getAll('purchases');
                sales = await DB.getAll('sales');
                expenses = await DB.getAll('expenses');
                stockAdjustments = await DB.getAll('stock_adjustments');
            }
        } else {
            purchases = await DB.getAll('purchases');
            sales = await DB.getAll('sales');
            expenses = await DB.getAll('expenses');
            stockAdjustments = await DB.getAll('stock_adjustments');
        }

        const adjustedStock = Utils.applyStockAdjustments(purchases, sales, stockAdjustments);
        purchases = adjustedStock.purchases;
        sales = adjustedStock.sales;

        let rawPurchases = purchases;
        let rawSales = sales;
        let rawExpenses = expenses;

        // Apply season filter if active
        const activeSeason = typeof SeasonManager !== 'undefined' ? await SeasonManager.getActiveSeason() : null;
        if (activeSeason) {
            purchases = SeasonManager.filterByActiveSeason(rawPurchases, activeSeason);
            sales = SeasonManager.filterByActiveSeason(rawSales, activeSeason);
            expenses = SeasonManager.filterByActiveSeason(rawExpenses, activeSeason);
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
