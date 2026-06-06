// ===== App Router & Init =====
const App = {
    currentSection: 'dashboard',

    async init() {
        try {
            await DB.init();
            const hasBusiness = await Settings.init();
            
            // Check for first-time visit
            if (!hasBusiness) {
                Utils.showModal('welcome-modal');
                // Ensure sidebar is hidden or disabled to force focus on modal
                document.querySelector('.sidebar').style.opacity = '0.3';
                document.querySelector('.sidebar').style.pointerEvents = 'none';
            } else {
                const biz = await Settings.getBusiness();
                document.getElementById('sidebar-biz-name').textContent = biz.bizName || 'AgriSys';
            }

            await this.populateCropSelects();
            await this.populateExpenseTypeSelect();
            this.setupHashRouter();
            this.setupKeyboardShortcuts();
            Utils.safeCreateIcons();

            // Load section modules
            await Purchasing.init();
            await Farmers.init();
            await Buyers.init();
            await Selling.init();

            // Navigate to hash or dashboard
            const hash = location.hash.replace('#', '') || 'dashboard';
            this.navigate(hash);

            // Season badge in sidebar
            if (typeof SeasonManager !== 'undefined') {
                await SeasonManager.renderSidebarBadge();
            }

            // Auto-backup check
            await this.checkAutoBackup();

            console.log('AgriSys initialized successfully');
        } catch (e) {
            console.error('Init error:', e);
            Utils.showToast('Failed to initialize: ' + e.message, 'error');
        }
    },

    async saveWelcomeSettings() {
        const bizName = document.getElementById('welcome-biz-name').value.trim();
        const phone = document.getElementById('welcome-phone').value.trim();
        const address = document.getElementById('welcome-address').value.trim();
        const owner = document.getElementById('welcome-owner-name').value.trim();

        if (!bizName || !address || !phone) {
            Utils.showToast('Please fill all required fields (*)', 'error');
            return;
        }

        const data = {
            bizName,
            address,
            phone,
            ownerName: owner,
            crops: 'Wheat,Rice,Cotton,Potato,Maize,Sugarcane,Misc',
            expenseTypes: 'Labour,Transport,Diesel,Rent,Utility,Misc'
        };

        await DB.setSetting('business', data);
        
        // Update UI
        document.getElementById('sidebar-biz-name').textContent = bizName;
        document.querySelector('.sidebar').style.opacity = '1';
        document.querySelector('.sidebar').style.pointerEvents = 'auto';
        
        Utils.hideModal('welcome-modal');
        Utils.showToast('Welcome to AgriSys! Business setup complete.');
        
        // Refresh settings form if user is on settings page
        await Settings.init();
    },

    navigate(section) {
        // Hide all sections
        document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

        // Show target
        const sec = document.getElementById('sec-' + section);
        if (sec) sec.classList.add('active');

        const nav = document.querySelector(`.nav-item[data-section="${section}"]`);
        if (nav) nav.classList.add('active');

        location.hash = section;
        this.currentSection = section;

        // Close mobile sidebar
        document.querySelector('.sidebar').classList.remove('open');

        // Trigger section load
        this.onSectionLoad(section);
        Utils.safeCreateIcons();
    },

    async onSectionLoad(section) {
        switch(section) {
            case 'dashboard': await this.loadDashboard(); break;
            case 'purchase-list': await PurchaseList.render(); break;
            case 'farmers': await Farmers.render(); break;
            case 'purchase-payments': await PurchasePayments.render(); break;
            case 'sale-list': await SaleList.render(); break;
            case 'sale-payments': await SalePayments.render(); break;
            case 'buyers': await Buyers.render(); break;
            case 'expenses': await Expenses.render(); break;
            case 'opening-balances': await OpeningBalances.render(); break;
            case 'stock-adjustments': await StockAdjustments.render(); break;
            case 'inventory-lots': await InventoryLots.render(); break;
            case 'capital': await Capital.render(); break;
            case 'bookkeeping': await Bookkeeping.render(); break;
            case 'cash-book': await FinanceReports.renderCashBook(); break;
            case 'trial-balance': await FinanceReports.renderTrialBalance(); break;
            case 'general-ledger': await FinanceReports.renderGeneralLedger(); break;
            case 'reports': break;
            case 'aging-reports': await AgingReports.render(); break;
            case 'settings':
                if (typeof SeasonManager !== 'undefined') await SeasonManager.renderSettings();
                await Settings.renderAudit();
                break;
        }
    },

    setupHashRouter() {
        window.addEventListener('hashchange', () => {
            const hash = location.hash.replace('#', '') || 'dashboard';
            this.navigate(hash);
        });
    },

    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // Don't trigger shortcuts when typing in inputs
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') {
                if (e.key === 'Escape') e.target.blur();
                return;
            }

            if (e.ctrlKey && e.key === 'n') {
                e.preventDefault();
                if (e.shiftKey) {
                    this.navigate('selling');
                } else {
                    this.navigate('purchasing');
                }
            }
            if (e.key === 'Escape') {
                // Close any open modal
                document.querySelectorAll('.modal-overlay.active').forEach(m => {
                    m.classList.remove('active');
                    document.body.style.overflow = '';
                });
                // Navigate to dashboard if no modal open
                if (!document.querySelector('.modal-overlay.active')) {
                    this.navigate('dashboard');
                }
            }
        });
    },

    async populateCropSelects() {
        const crops = await Settings.getCrops();
        const selects = ['p-crop', 's-crop', 'exp-crop', 'ob-crop', 'sa-crop'];
        selects.forEach(id => {
            const sel = document.getElementById(id);
            if (!sel) return;
            const val = sel.value;
            const first = sel.options[0];
            sel.innerHTML = '';
            sel.appendChild(first);
            crops.forEach(c => {
                const o = document.createElement('option');
                o.value = c; o.textContent = c;
                sel.appendChild(o);
            });
            if (val) sel.value = val;
        });
        // Also update filter selects
        const filterSel = document.getElementById('pl-crop-filter');
        if (filterSel) {
            const val = filterSel.value;
            filterSel.innerHTML = '<option value="">All Crops</option>';
            crops.forEach(c => { const o = document.createElement('option'); o.value = c; o.textContent = c; filterSel.appendChild(o); });
            if (val) filterSel.value = val;
        }
    },

    async populateExpenseTypeSelect() {
        const types = await Settings.getExpenseTypes();
        const sel = document.getElementById('exp-type');
        if (!sel) return;
        const val = sel.value;
        sel.innerHTML = '';
        types.forEach(t => {
            const o = document.createElement('option');
            o.value = t.toLowerCase();
            o.textContent = t;
            sel.appendChild(o);
        });
        if (val) sel.value = val;
    },

    async loadDashboard() {
        let purchases = await DB.getAll('purchases');
        let sales = await DB.getAll('sales');
        let expenses = await DB.getAll('expenses');
        let stockAdjustments = await DB.getAll('stock_adjustments');

        // Apply season filter if active
        const activeSeason = typeof SeasonManager !== 'undefined' ? await SeasonManager.getActiveSeason() : null;
        if (activeSeason) {
            purchases = SeasonManager.filterByActiveSeason(purchases, activeSeason);
            sales = SeasonManager.filterByActiveSeason(sales, activeSeason);
            expenses = SeasonManager.filterByActiveSeason(expenses, activeSeason);
            stockAdjustments = SeasonManager.filterByActiveSeason(stockAdjustments, activeSeason);
        } else {
            purchases = purchases.filter(p => p.type !== 'opening_balance');
        }
        const adjustedStock = Utils.applyStockAdjustments(purchases, sales, stockAdjustments);
        const stockPurchases = adjustedStock.purchases;
        const stockSales = adjustedStock.sales;

        const totalPurchaseAmt = purchases.reduce((s, p) => s + (p.netPayableAmount || p.amount || 0), 0);
        const totalPaid = purchases.reduce((s, p) => s + (p.amountPaid || 0), 0);
        const totalSaleAmt = sales.reduce((s, p) => s + (p.amount || 0), 0);
        const totalReceived = sales.reduce((s, p) => s + (p.amountReceived || 0), 0);
        const totalExpenses = expenses.reduce((s, e) => s + (e.amount || 0), 0);
        const today = Utils.todayISO();
        const overduePurchases = purchases.filter(p => p.paymentStatus !== 'paid' && p.dueDate && p.dueDate < today);
        const overdueSales = sales.filter(s => s.paymentStatus !== 'paid' && s.dueDate && s.dueDate < today);

        // Pending counts
        const pendingFarmers = purchases.filter(p => p.paymentStatus !== 'paid').length;
        const pendingBuyers = sales.filter(s => s.paymentStatus !== 'paid').length;

        document.getElementById('dashboard-stats').innerHTML = `
            <div class="stat-card blue">
                <div class="stat-label">Total Purchases</div>
                <div class="stat-value">${purchases.length}</div>
                <div class="stat-sub">PKR ${Utils.formatPKR(totalPurchaseAmt)}</div>
            </div>
            <div class="stat-card green">
                <div class="stat-label">Total Sales</div>
                <div class="stat-value">${sales.length}</div>
                <div class="stat-sub">PKR ${Utils.formatPKR(totalSaleAmt)}</div>
            </div>
            <div class="stat-card orange">
                <div class="stat-label">Payable to Farmers</div>
                <div class="stat-value">PKR ${Utils.formatPKR(totalPurchaseAmt - totalPaid)}</div>
                <div class="stat-sub">${pendingFarmers} unpaid · Paid: PKR ${Utils.formatPKR(totalPaid)}</div>
            </div>
            <div class="stat-card purple">
                <div class="stat-label">Receivable from Buyers</div>
                <div class="stat-value">PKR ${Utils.formatPKR(totalSaleAmt - totalReceived)}</div>
                <div class="stat-sub">${pendingBuyers} outstanding · Expenses: PKR ${Utils.formatPKR(totalExpenses)}</div>
            </div>
        ` + `
            <div class="stat-card orange">
                <div class="stat-label">Overdue Buyers</div>
                <div class="stat-value">${overdueSales.length}</div>
                <div class="stat-sub">PKR ${Utils.formatPKR(overdueSales.reduce((s, x) => s + ((x.amount || 0) - (x.amountReceived || 0)), 0))}</div>
            </div>
            <div class="stat-card blue">
                <div class="stat-label">Overdue Farmers</div>
                <div class="stat-value">${overduePurchases.length}</div>
                <div class="stat-sub">PKR ${Utils.formatPKR(overduePurchases.reduce((s, x) => s + ((x.netPayableAmount || x.amount || 0) - (x.amountPaid || 0)), 0))}</div>
            </div>
        `;

        // Inventory Stock Calculation
        const stockMap = {};
        stockPurchases.forEach(p => {
            if (!stockMap[p.crop]) stockMap[p.crop] = { weight: 0, bags: 0 };
            stockMap[p.crop].weight += (p.netWeight || 0);
            stockMap[p.crop].bags += (p.netBags || 0);
        });

        stockSales.forEach(s => {
            if (!stockMap[s.crop]) stockMap[s.crop] = { weight: 0, bags: 0 };
            stockMap[s.crop].weight -= (s.netWeight || 0);
            const saleBags = (s.netWeight || s.grossWeight || 0) / (s.perBagWeight || s.perBag || 100);
            stockMap[s.crop].bags -= saleBags;
        });

        const stockContainer = document.getElementById('dashboard-stock');
        let stockHtml = '';
        for (const [crop, data] of Object.entries(stockMap)) {
            stockHtml += `
            <div class="stat-card" style="border-left-color:${data.weight < 0 ? 'var(--accent-danger)' : 'var(--text-muted)'}">
                <div class="stat-label">${Utils.escapeHTML(crop)}${data.weight < 0 ? ' (Oversold)' : ''}</div>
                <div class="stat-value" style="font-size:1.4rem">${Utils.formatNum(data.weight, 2)} KG</div>
                <div class="stat-sub">~${Utils.formatNum(data.weight / 40, 2)} Mn | ${Utils.formatNum(data.bags, 1)} Bags</div>
            </div>`;
        }
        stockContainer.innerHTML = stockHtml || '<div style="grid-column:1/-1;text-align:center;padding:12px;color:var(--text-muted)">Warehouse is currently empty.</div>';

        // Crop Analysis Dashboard
        await CropAnalysis.init();
        await CropAnalysis.render();

        // Profit Chart
        this.renderProfitChart(purchases, sales, expenses);

        // Recent purchases
        const recent = [...purchases].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 5);
        const ptbody = document.querySelector('#dashboard-recent-purchases tbody');
        ptbody.innerHTML = recent.map(p => `<tr>
            <td>${Utils.escapeHTML(p.id)}</td><td>${Utils.formatDate(p.date)}</td><td class="font-bold">${Utils.escapeHTML(p.farmerName)}</td>
            <td>${Utils.escapeHTML(p.crop)}</td><td class="text-right font-bold">PKR ${Utils.formatPKR(p.netPayableAmount || p.amount)}</td>
            <td>${Utils.statusBadge(p.paymentStatus)}</td>
        </tr>`).join('') || '<tr><td colspan="6" style="text-align:center;color:var(--text-muted)">No purchases yet</td></tr>';

        // Recent sales
        const recentS = [...sales].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 5);
        const stbody = document.querySelector('#dashboard-recent-sales tbody');
        stbody.innerHTML = recentS.map(s => `<tr>
            <td>${Utils.escapeHTML(s.id)}</td><td>${Utils.formatDate(s.date)}</td><td class="font-bold">${Utils.escapeHTML(s.buyerName)}</td>
            <td>${Utils.escapeHTML(s.crop)}</td><td class="text-right font-bold">PKR ${Utils.formatPKR(s.amount)}</td>
            <td>${Utils.statusBadge(s.paymentStatus)}</td>
        </tr>`).join('') || '<tr><td colspan="6" style="text-align:center;color:var(--text-muted)">No sales yet</td></tr>';
    },

    renderProfitChart(purchases, sales, expenses) {
        const canvas = document.getElementById('profit-chart');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.parentElement.getBoundingClientRect();
        const w = rect.width || 600;
        const h = 200;
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        canvas.style.width = w + 'px';
        canvas.style.height = h + 'px';
        ctx.scale(dpr, dpr);
        ctx.clearRect(0, 0, w, h);

        // Compute last 6 months data
        const months = [];
        const now = new Date();
        for (let i = 5; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const key = d.toISOString().slice(0, 7); // YYYY-MM
            const label = d.toLocaleString('en', { month: 'short' });
            const rev = sales.filter(s => s.date && s.date.startsWith(key)).reduce((s, x) => s + (x.amount || 0), 0);
            const cost = purchases.filter(p => p.date && p.date.startsWith(key)).reduce((s, x) => s + Utils.purchaseCostAmount(x), 0);
            const exp = expenses.filter(e => e.date && e.date.startsWith(key)).reduce((s, x) => s + (x.amount || 0), 0);
            months.push({ label, rev, cost, exp, profit: rev - cost - exp });
        }

        const maxVal = Math.max(1, ...months.map(m => Math.max(m.rev, m.cost)));
        const chartLeft = 60;
        const chartRight = w - 20;
        const chartTop = 20;
        const chartBottom = h - 30;
        const chartW = chartRight - chartLeft;
        const chartH = chartBottom - chartTop;
        const barGroupWidth = chartW / months.length;
        const barWidth = barGroupWidth * 0.3;

        // Grid lines
        ctx.strokeStyle = 'rgba(203,213,225,0.6)';
        ctx.lineWidth = 0.5;
        for (let i = 0; i <= 4; i++) {
            const y = chartTop + (chartH / 4) * i;
            ctx.beginPath();
            ctx.moveTo(chartLeft, y);
            ctx.lineTo(chartRight, y);
            ctx.stroke();
            // Labels
            ctx.fillStyle = '#475569';
            ctx.font = '10px Inter, sans-serif';
            ctx.textAlign = 'right';
            const val = maxVal - (maxVal / 4) * i;
            ctx.fillText(val >= 1000 ? (val / 1000).toFixed(0) + 'K' : val.toFixed(0), chartLeft - 8, y + 4);
        }

        months.forEach((m, i) => {
            const x = chartLeft + barGroupWidth * i + barGroupWidth * 0.15;
            const revH = (m.rev / maxVal) * chartH;
            const costH = (m.cost / maxVal) * chartH;

            // Revenue bar
            const grad1 = ctx.createLinearGradient(x, chartBottom - revH, x, chartBottom);
            grad1.addColorStop(0, '#10b981');
            grad1.addColorStop(1, '#06b6d4');
            ctx.fillStyle = grad1;
            ctx.beginPath();
            ctx.roundRect(x, chartBottom - revH, barWidth, revH, [3, 3, 0, 0]);
            ctx.fill();

            // Cost bar
            const grad2 = ctx.createLinearGradient(x + barWidth + 2, chartBottom - costH, x + barWidth + 2, chartBottom);
            grad2.addColorStop(0, '#3b82f6');
            grad2.addColorStop(1, '#8b5cf6');
            ctx.fillStyle = grad2;
            ctx.beginPath();
            ctx.roundRect(x + barWidth + 2, chartBottom - costH, barWidth, costH, [3, 3, 0, 0]);
            ctx.fill();

            // Month label
            ctx.fillStyle = '#64748b';
            ctx.font = '11px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(m.label, x + barWidth, chartBottom + 16);
        });

        // Legend
        ctx.fillStyle = '#10b981';
        ctx.fillRect(chartLeft, h - 12, 10, 10);
        ctx.fillStyle = '#475569';
        ctx.font = '10px Inter, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText('Revenue', chartLeft + 14, h - 3);
        ctx.fillStyle = '#3b82f6';
        ctx.fillRect(chartLeft + 70, h - 12, 10, 10);
        ctx.fillStyle = '#475569';
        ctx.fillText('Cost', chartLeft + 84, h - 3);
    },

    async checkAutoBackup() {
        try {
            const lastBackup = localStorage.getItem('agrisys_last_backup_time');
            const now = Date.now();
            const oneDay = 24 * 60 * 60 * 1000; // 24 hours

            if (lastBackup && (now - parseInt(lastBackup)) < oneDay) {
                return; // Less than 24 hours since last backup
            }

            // Check if there's any data worth backing up
            const pCount = await DB.count('purchases');
            const sCount = await DB.count('sales');
            if (pCount === 0 && sCount === 0) return; // No data

            // Trigger backup after a short delay so the UI finishes loading
            setTimeout(async () => {
                Utils.showToast('Auto backup: Generating daily backup...');
                await Settings.backup();
                localStorage.setItem('agrisys_last_backup_time', Date.now().toString());
            }, 2000);
        } catch (e) {
            console.warn('Auto-backup check failed:', e);
        }
    }
};

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', () => App.init());
