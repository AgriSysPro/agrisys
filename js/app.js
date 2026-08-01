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
            case 'bank-accounts': await BankAccounts.render(); break;
            case 'capital-mgmt': await CapitalMgmt.render(); break;
            case 'bookkeeping': await Bookkeeping.render(); break;
            case 'cash-book': await FinanceReports.renderCashBook(); break;
            case 'trial-balance': await FinanceReports.renderTrialBalance(); break;
            case 'general-ledger': await FinanceReports.renderGeneralLedger(); break;
            case 'reports': break;
            case 'aging-reports': await AgingReports.render(); break;
            case 'settings':
                if (typeof SeasonManager !== 'undefined') await SeasonManager.renderSettings();
                await Settings.renderAudit();
                if (typeof BackupManager !== 'undefined') await BackupManager.renderVaultUI();
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
            // Mandi speed shortcuts
            if (e.key === 'F1' || (e.altKey && (e.key === 'd' || e.key === 'D'))) { e.preventDefault(); this.navigate('dashboard'); }
            else if (e.key === 'F2' || (e.altKey && (e.key === 'p' || e.key === 'P'))) { e.preventDefault(); this.navigate('purchasing'); }
            else if (e.key === 'F3' || (e.altKey && (e.key === 's' || e.key === 'S'))) { e.preventDefault(); this.navigate('selling'); }
            else if (e.key === 'F4' || (e.altKey && (e.key === 'f' || e.key === 'F'))) { e.preventDefault(); this.navigate('farmers'); }
            else if (e.key === 'F5' || (e.altKey && (e.key === 'b' || e.key === 'B'))) { e.preventDefault(); this.navigate('buyers'); }
            else if (e.key === 'F7' || (e.altKey && (e.key === 'j' || e.key === 'J'))) { e.preventDefault(); this.navigate('bookkeeping'); }
            else if (e.key === 'F8' || (e.altKey && (e.key === 'r' || e.key === 'R'))) { e.preventDefault(); this.navigate('reports'); }

            // Ctrl+Enter inside forms to save
            if (e.ctrlKey && e.key === 'Enter') {
                if (this.currentSection === 'purchasing') { e.preventDefault(); Purchasing.save(); }
                else if (this.currentSection === 'selling') { e.preventDefault(); Selling.save(); }
            }

            // Don't trigger standard shortcuts when typing in inputs
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
                let closedModal = false;
                document.querySelectorAll('.modal-overlay.active').forEach(m => {
                    m.classList.remove('active');
                    document.body.style.overflow = '';
                    closedModal = true;
                });
                // Navigate to dashboard if no modal was closed
                if (!closedModal) {
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
        let rawPurchases = await DB.getAll('purchases');
        let rawSales = await DB.getAll('sales');
        let rawExpenses = await DB.getAll('expenses');
        let rawStockAdjustments = await DB.getAll('stock_adjustments');

        let purchases = rawPurchases;
        let sales = rawSales;
        let expenses = rawExpenses;
        let stockAdjustments = rawStockAdjustments;

        // Apply season filter if active
        const activeSeason = typeof SeasonManager !== 'undefined' ? await SeasonManager.getActiveSeason() : null;
        if (activeSeason) {
            purchases = SeasonManager.filterByActiveSeason(rawPurchases, activeSeason);
            sales = SeasonManager.filterByActiveSeason(rawSales, activeSeason);
            expenses = SeasonManager.filterByActiveSeason(rawExpenses, activeSeason);
            stockAdjustments = SeasonManager.filterByActiveSeason(rawStockAdjustments, activeSeason);
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

        // Inventory Stock Calculation (Case-Insensitive Grouping)
        const stockMap = {};
        const getCropKey = (cropName) => {
            if (!cropName) return null;
            const trimmed = cropName.trim();
            const existingKey = Object.keys(stockMap).find(k => k.toLowerCase() === trimmed.toLowerCase());
            return existingKey || trimmed;
        };

        stockPurchases.forEach(p => {
            const key = getCropKey(p.crop);
            if (!key) return;
            if (!stockMap[key]) stockMap[key] = { name: p.crop.trim(), weight: 0 };
            stockMap[key].weight += (p.netWeight || 0);
        });

        stockSales.forEach(s => {
            const key = getCropKey(s.crop);
            if (!key) return;
            if (!stockMap[key]) stockMap[key] = { name: s.crop.trim(), weight: 0 };
            stockMap[key].weight -= (s.netWeight || 0);
        });

        const stockContainer = document.getElementById('dashboard-stock');
        let stockHtml = '';
        for (const [key, data] of Object.entries(stockMap)) {
            const bags = data.weight / 100;
            stockHtml += `
            <div class="stat-card" style="border-left-color:${data.weight < 0 ? 'var(--accent-danger)' : 'var(--text-muted)'}">
                <div class="stat-label">${Utils.escapeHTML(data.name)}${data.weight < 0 ? ' (Oversold)' : ''}</div>
                <div class="stat-value" style="font-size:1.4rem">${Utils.formatNum(data.weight, 2)} KG</div>
                <div class="stat-sub">~${Utils.formatNum(data.weight / 40, 2)} Mn | ${Utils.formatNum(bags, 1)} Bags</div>
            </div>`;
        }
        stockContainer.innerHTML = stockHtml || '<div style="grid-column:1/-1;text-align:center;padding:12px;color:var(--text-muted)">Warehouse is currently empty.</div>';

        // Crop Analysis Dashboard
        try {
            await CropAnalysis.init();
            await CropAnalysis.render();
        } catch (e) {
            console.error('CropAnalysis render error:', e);
        }

        // Profit Chart (Pass full raw datasets so last 6 calendar months render properly after layout reflow)
        setTimeout(() => this.renderProfitChart(rawPurchases, rawSales, rawExpenses), 50);

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
        const rect = canvas.parentElement ? canvas.parentElement.getBoundingClientRect() : null;
        const w = (rect && rect.width > 0) ? rect.width : (canvas.clientWidth || 600);
        const h = 220;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        canvas.style.width = w + 'px';
        canvas.style.height = h + 'px';
        const ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);

        // Fill crisp white background
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);

        // Compute last 6 months data
        const months = [];
        const now = new Date();
        for (let i = 5; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const year = d.getFullYear();
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const key = `${year}-${month}`;
            const label = d.toLocaleString('en', { month: 'short' });
            const rev = sales.filter(s => s.date && s.date.startsWith(key)).reduce((s, x) => s + (x.amount || 0), 0);
            const cost = purchases.filter(p => p.date && p.date.startsWith(key)).reduce((s, x) => s + Utils.purchaseCostAmount(x), 0);
            const exp = expenses.filter(e => e.date && e.date.startsWith(key)).reduce((s, x) => s + (x.amount || 0), 0);
            months.push({ label, rev, cost, exp, profit: rev - cost - exp });
        }

        const maxVal = Math.max(1, ...months.map(m => Math.max(m.rev, m.cost))) * 1.15;
        const chartLeft = 60;
        const chartRight = w - 20;
        const chartTop = 25;
        const chartBottom = h - 35;
        const chartW = chartRight - chartLeft;
        const chartH = chartBottom - chartTop;
        const barGroupWidth = chartW / months.length;
        const barWidth = Math.min(barGroupWidth * 0.32, 28);

        // Grid lines
        ctx.strokeStyle = 'rgba(226, 232, 240, 0.9)';
        ctx.lineWidth = 1;
        for (let i = 0; i <= 4; i++) {
            const y = chartTop + (chartH / 4) * i;
            ctx.beginPath();
            ctx.moveTo(chartLeft, y);
            ctx.lineTo(chartRight, y);
            ctx.stroke();
            // Labels
            ctx.fillStyle = '#475569';
            ctx.font = '600 11px Inter, sans-serif';
            ctx.textAlign = 'right';
            const val = maxVal - (maxVal / 4) * i;
            ctx.fillText(val >= 1000 ? (val / 1000).toFixed(0) + 'K' : val.toFixed(0), chartLeft - 8, y + 4);
        }

        months.forEach((m, i) => {
            const groupX = chartLeft + barGroupWidth * i;
            const centerX = groupX + barGroupWidth / 2;
            const revX = centerX - barWidth - 2;
            const costX = centerX + 2;

            const revH = (m.rev / maxVal) * chartH;
            const costH = (m.cost / maxVal) * chartH;

            // Revenue bar (Emerald Gradient)
            if (revH > 0) {
                const grad1 = ctx.createLinearGradient(revX, chartBottom - revH, revX, chartBottom);
                grad1.addColorStop(0, '#10b981');
                grad1.addColorStop(1, '#059669');
                ctx.fillStyle = grad1;
                ctx.beginPath();
                if (typeof ctx.roundRect === 'function') {
                    ctx.roundRect(revX, chartBottom - revH, barWidth, revH, [4, 4, 0, 0]);
                } else {
                    ctx.rect(revX, chartBottom - revH, barWidth, revH);
                }
                ctx.fill();
            }

            // Cost bar (Royal Blue Gradient)
            if (costH > 0) {
                const grad2 = ctx.createLinearGradient(costX, chartBottom - costH, costX, chartBottom);
                grad2.addColorStop(0, '#3b82f6');
                grad2.addColorStop(1, '#2563eb');
                ctx.fillStyle = grad2;
                ctx.beginPath();
                if (typeof ctx.roundRect === 'function') {
                    ctx.roundRect(costX, chartBottom - costH, barWidth, costH, [4, 4, 0, 0]);
                } else {
                    ctx.rect(costX, chartBottom - costH, barWidth, costH);
                }
                ctx.fill();
            }

            // Month label
            ctx.fillStyle = '#334155';
            ctx.font = '600 11px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(m.label, centerX, chartBottom + 18);
        });

        // Legend
        const legendY = h - 8;
        ctx.fillStyle = '#10b981';
        ctx.fillRect(chartLeft, legendY - 8, 10, 8);
        ctx.fillStyle = '#1e293b';
        ctx.font = '600 11px Inter, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText('Revenue', chartLeft + 14, legendY);

        ctx.fillStyle = '#3b82f6';
        ctx.fillRect(chartLeft + 90, legendY - 8, 10, 8);
        ctx.fillStyle = '#1e293b';
        ctx.fillText('Cost', chartLeft + 104, legendY);
    },

    async checkAutoBackup() {
        try {
            if (typeof BackupManager !== 'undefined') {
                await BackupManager.init();
            }
        } catch (e) {
            console.warn('Auto-backup check failed:', e);
        }
    }
};

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', () => App.init());
