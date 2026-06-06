// ===== Season / Fiscal Year Manager =====
const SeasonManager = {

    async getActiveSeason() {
        const seasons = await DB.getAll('seasons');
        return seasons.find(s => s.active) || null;
    },

    async getAllSeasons() {
        const seasons = await DB.getAll('seasons');
        return seasons.sort((a, b) => new Date(b.startDate) - new Date(a.startDate));
    },

    async createSeason({ label, startDate, endDate, carryForward }) {
        const id = 'SN-' + Date.now();
        const season = {
            id, label, startDate, endDate,
            active: true,
            createdAt: new Date().toISOString()
        };

        // Deactivate all existing seasons
        const all = await DB.getAll('seasons');
        for (const s of all) {
            s.active = false;
            await DB.put('seasons', s);
        }

        await DB.put('seasons', season);

        // Carry forward inventory into the new season if requested
        if (carryForward) {
            await this.carryForwardInventory(season);
        }

        Utils.showToast(`Season "${label}" created and activated!`);
        await this.renderSidebarBadge();
        return season;
    },

    async setActiveSeason(seasonId) {
        const all = await DB.getAll('seasons');
        for (const s of all) {
            s.active = (s.id === seasonId);
            await DB.put('seasons', s);
        }
        const activated = all.find(s => s.id === seasonId);
        Utils.showToast(`Switched to season "${activated?.label || seasonId}"`);
        await this.renderSidebarBadge();

        // Refresh dashboard if we're on it
        if (App.currentSection === 'dashboard') {
            await App.loadDashboard();
        }
    },

    async deleteSeason(seasonId) {
        const season = await DB.get('seasons', seasonId);
        if (!season) return;

        if (season.active) {
            Utils.showToast('Cannot delete the active season. Switch to another season first.', 'error');
            return;
        }

        const ok = await Utils.confirm(`Delete season "${season.label}"? This will NOT delete any transactions, only the season record.`);
        if (!ok) return;

        await DB.delete('seasons', seasonId);
        Utils.showToast(`Season "${season.label}" deleted.`);
        await this.renderSettings();
    },

    async carryForwardInventory(toSeason) {
        const allPurchases = await DB.getAll('purchases');
        const allSales = await DB.getAll('sales');

        // CRITICAL: Exclude previous Opening Balance entries to avoid double-counting.
        // OB entries are virtual copies of inventory already represented by real purchases.
        // True remaining = (real purchases) - (all sales), ignoring OB duplicates.
        const fp = allPurchases.filter(p => p.date && p.date < toSeason.startDate && p.type !== 'opening_balance');
        const fs = allSales.filter(s => s.date && s.date < toSeason.startDate);

        // Calculate per-crop remaining inventory
        const cropData = {};
        fp.forEach(p => {
            if (!p.crop) return;
            if (!cropData[p.crop]) cropData[p.crop] = { weight: 0, amount: 0, purchaseWeight: 0 };
            cropData[p.crop].weight += (p.netWeight || 0);
            cropData[p.crop].amount += Utils.purchaseCostAmount(p);
            cropData[p.crop].purchaseWeight += (p.netWeight || 0);
        });

        fs.forEach(s => {
            if (!s.crop) return;
            if (!cropData[s.crop]) cropData[s.crop] = { weight: 0, amount: 0, purchaseWeight: 0 };
            cropData[s.crop].weight -= (s.netWeight || 0);
        });

        // Create opening balance entries for crops with remaining inventory
        let carryCount = 0;
        for (const [crop, data] of Object.entries(cropData)) {
            if (data.weight <= 0) continue;

            const maund = data.weight / 40;
            const avgCostPerMn = data.purchaseWeight > 0
                ? data.amount / (data.purchaseWeight / 40)
                : 0;
            const carryAmount = avgCostPerMn * maund;

            const obEntry = {
                id: `OB-${toSeason.label}-${crop}`,
                type: 'opening_balance',
                farmerName: 'Opening Balance',
                date: toSeason.startDate,
                crop: crop,
                method: 'scale',
                grossWeight: data.weight,
                perBagWeight: 100,
                bagsCount: 0,
                bardanaPerBag: 0, labourPerBag: 0,
                bardanaTotal: 0, labourTotal: 0,
                additionalDeductions: [],
                totalKgDeductions: 0, totalPkrDeductions: 0,
                advanceDeducted: 0,
                netWeight: data.weight,
                netBags: data.weight / 100,
                netMn: maund,
                rate: avgCostPerMn,
                amount: carryAmount,
                netPayableAmount: carryAmount,
                paymentStatus: 'paid',
                amountPaid: carryAmount,
                balance: 0,
                notes: `Inventory carried forward into season ${toSeason.label}. Remaining weight: ${Utils.formatNum(data.weight, 2)} KG (${Utils.formatNum(maund, 2)} Mn)`,
                scaleImage: null,
                createdAt: new Date().toISOString()
            };

            await DB.put('purchases', obEntry);
            carryCount++;
        }

        if (carryCount > 0) {
            Utils.showToast(`${carryCount} crop(s) inventory carried forward to ${toSeason.label}`);
        } else {
            Utils.showToast('No remaining inventory to carry forward.');
        }
    },

    filterByActiveSeason(records, season) {
        if (!season) return records;
        return records.filter(r => r.date >= season.startDate && r.date <= season.endDate);
    },

    async renderSettings() {
        const container = document.getElementById('season-settings-content');
        if (!container) return;

        const seasons = await this.getAllSeasons();
        const active = seasons.find(s => s.active);

        // Active season display
        let activeHtml = '';
        if (active) {
            activeHtml = `
                <div class="season-active-display">
                    <div class="season-active-indicator"></div>
                    <div>
                        <div class="season-active-label">${Utils.escapeHTML(active.label)}</div>
                        <div class="season-active-dates">${Utils.formatDate(active.startDate)} — ${Utils.formatDate(active.endDate)}</div>
                    </div>
                </div>`;
        } else {
            activeHtml = `<div class="crop-no-data" style="margin-bottom:16px">No active season. Create one below to start tracking by fiscal year.</div>`;
        }

        // Season history table
        let historyHtml = '';
        if (seasons.length > 0) {
            const rows = seasons.map(s => `
                <tr>
                    <td><strong>${Utils.escapeHTML(s.label)}</strong></td>
                    <td>${Utils.formatDate(s.startDate)}</td>
                    <td>${Utils.formatDate(s.endDate)}</td>
                    <td>${s.active
                        ? '<span class="badge badge-success">Active</span>'
                        : '<span class="badge badge-warning">Archived</span>'}</td>
                    <td>
                        ${!s.active ? `
                            <button class="btn btn-sm btn-ghost" onclick="SeasonManager.setActiveSeason('${s.id}')" title="Activate">
                                <i data-lucide="check-circle"></i>
                            </button>
                            <button class="btn btn-sm btn-danger" onclick="SeasonManager.deleteSeason('${s.id}')" title="Delete">
                                <i data-lucide="trash-2"></i>
                            </button>
                        ` : '<span style="color:var(--text-muted);font-size:0.8rem">Current</span>'}
                    </td>
                </tr>`).join('');

            historyHtml = `
                <h4 class="crop-section-title" style="margin-top:20px"><i data-lucide="clock"></i> Season History</h4>
                <div class="table-container">
                    <table class="data-table season-history-table">
                        <thead><tr>
                            <th>Label</th>
                            <th>Start Date</th>
                            <th>End Date</th>
                            <th>Status</th>
                            <th>Actions</th>
                        </tr></thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>`;
        }

        // Clear season filter button
        let clearHtml = '';
        if (active) {
            clearHtml = `
                <div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--border-color)">
                    <button class="btn btn-warning btn-sm" onclick="SeasonManager.clearActiveSeason()">
                        <i data-lucide="x-circle"></i> Clear Season Filter (Show All Data)
                    </button>
                    <p style="font-size:0.75rem;color:var(--text-muted);margin-top:6px">This deactivates the current season so all data is shown across the dashboard and reports.</p>
                </div>`;
        }

        container.innerHTML = activeHtml + historyHtml + clearHtml;
        Utils.safeCreateIcons();
    },

    async clearActiveSeason() {
        const all = await DB.getAll('seasons');
        for (const s of all) {
            s.active = false;
            await DB.put('seasons', s);
        }
        Utils.showToast('Season filter cleared. Showing all data.');
        await this.renderSidebarBadge();
        await this.renderSettings();
        if (App.currentSection === 'dashboard') {
            await App.loadDashboard();
        }
    },

    async startNewSeason() {
        const label = document.getElementById('season-label').value.trim();
        const startDate = document.getElementById('season-start').value;
        const endDate = document.getElementById('season-end').value;
        const carryForward = document.getElementById('season-carry-forward').checked;

        if (!label) { Utils.showToast('Season label is required', 'error'); return; }
        if (!startDate) { Utils.showToast('Start date is required', 'error'); return; }
        if (!endDate) { Utils.showToast('End date is required', 'error'); return; }
        if (startDate >= endDate) { Utils.showToast('End date must be after start date', 'error'); return; }

        // Check for overlapping seasons
        const existing = await this.getAllSeasons();
        const overlap = existing.find(s =>
            (startDate >= s.startDate && startDate <= s.endDate) ||
            (endDate >= s.startDate && endDate <= s.endDate) ||
            (startDate <= s.startDate && endDate >= s.endDate)
        );
        if (overlap) {
            const ok = await Utils.confirm(
                `This season overlaps with "${overlap.label}" (${Utils.formatDate(overlap.startDate)} - ${Utils.formatDate(overlap.endDate)}). Continue anyway?`
            );
            if (!ok) return;
        }

        if (carryForward) {
            const ok = await Utils.confirm(
                `This will create "Opening Balance" purchase entries in the new season for any unsold inventory. Continue?`
            );
            if (!ok) return;
        }

        await this.createSeason({ label, startDate, endDate, carryForward });

        // Clear form
        document.getElementById('season-label').value = '';
        document.getElementById('season-start').value = '';
        document.getElementById('season-end').value = '';
        document.getElementById('season-carry-forward').checked = false;

        await this.renderSettings();
    },

    async renderSidebarBadge() {
        const badge = document.getElementById('sidebar-season-badge');
        if (!badge) return;

        const active = await this.getActiveSeason();
        if (active) {
            badge.textContent = active.label;
            badge.style.display = 'inline-flex';
        } else {
            badge.textContent = '';
            badge.style.display = 'none';
        }
    }
};
