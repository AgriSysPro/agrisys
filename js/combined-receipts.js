// Combine selected receipts into a document without changing their source records.
const CombinedReceipts = {
    type: 'purchase',
    records: [],
    payments: [],
    selected: new Set(),
    page: 1,
    pageSize: 25,
    version: 0,
    busy: false,

    config(type = this.type) {
        if (type === 'purchase') return { store: 'purchases', paymentStore: 'purchase_payments', partyField: 'farmerName', partyLabel: 'Farmer', paidField: 'amountPaid', linkField: 'purchaseId', settledLabel: 'Paid / adjusted', title: 'Combined purchase receipt' };
        if (type === 'sale') return { store: 'sales', paymentStore: 'sale_payments', partyField: 'buyerName', partyLabel: 'Buyer', paidField: 'amountReceived', linkField: 'saleId', settledLabel: 'Received / adjusted', title: 'Combined sale receipt' };
        throw new Error('Unknown receipt type');
    },

    partyKey(name) { return String(name ?? '').trim().toLowerCase(); },
    recordKey(record) { return JSON.stringify(record.id); },
    isReceipt(record) {
        return record && !record.isDeleted && !['opening_balance', 'opening_stock', 'stock_adjustment'].includes(record.type);
    },

    async readData(type) {
        const config = this.config(type);
        const [records, payments] = await Promise.all([DB.getAll(config.store), DB.getAll(config.paymentStore)]);
        return { records: records.filter(record => this.isReceipt(record)), payments: payments.filter(payment => payment && !payment.isDeleted) };
    },

    async open(type) {
        if (this.busy) return;
        const config = this.config(type);
        const version = ++this.version;
        this.type = type;
        this.selected.clear();
        this.records = [];
        this.payments = [];
        this.page = 1;
        document.getElementById('cr-title').textContent = config.title;
        document.getElementById('cr-party-label').textContent = config.partyLabel;
        document.getElementById('cr-settled-heading').textContent = config.settledLabel + ' (PKR)';
        document.getElementById('cr-total-settled-label').textContent = config.settledLabel;
        document.getElementById('cr-total-amount-label').textContent = type === 'purchase' ? 'Total net payable' : 'Total sale amount';
        document.getElementById('cr-party').replaceChildren(new Option('Loading...', ''));
        for (const id of ['cr-from', 'cr-to', 'cr-search']) document.getElementById(id).value = '';
        document.getElementById('cr-scope').querySelector('span').textContent = 'Loading saved receipts...';
        this.render();
        Utils.showModal('combined-receipts-modal');
        try {
            const [data, season] = await Promise.all([this.readData(type), Utils.getActiveSeason()]);
            if (version !== this.version) return;
            this.records = data.records;
            this.payments = data.payments;
            const names = new Map();
            for (const record of this.records) {
                const key = this.partyKey(record[config.partyField]);
                if (key && !names.has(key)) names.set(key, String(record[config.partyField]).trim());
            }
            const select = document.getElementById('cr-party');
            select.replaceChildren(new Option(`Choose a ${config.partyLabel.toLowerCase()}`, ''));
            [...names].sort((a, b) => a[1].localeCompare(b[1])).forEach(([key, name]) => select.add(new Option(name, key)));
            if (season) {
                document.getElementById('cr-from').value = season.startDate;
                document.getElementById('cr-to').value = season.endDate;
            }
            document.getElementById('cr-scope').querySelector('span').textContent = season
                ? `Dates start with ${season.label || 'the active season'}. Use All dates to include earlier receipts.`
                : 'Choose a party and select at least two receipts. Dates filter the receipt dates.';
            this.render();
            select.focus();
        } catch (error) {
            if (version !== this.version) return;
            document.getElementById('cr-party').replaceChildren(new Option('Unable to load receipts', ''));
            document.getElementById('cr-scope').querySelector('span').textContent = 'Close and reopen this window to try again.';
            Utils.showToast('Could not load receipts: ' + error.message, 'error');
        }
    },

    filtersChanged() {
        this.selected.clear();
        this.page = 1;
        this.render();
    },

    allDates() {
        document.getElementById('cr-from').value = '';
        document.getElementById('cr-to').value = '';
        this.filtersChanged();
    },

    filteredRecords() {
        const { partyField } = this.config();
        const party = document.getElementById('cr-party').value;
        const from = document.getElementById('cr-from').value;
        const to = document.getElementById('cr-to').value;
        const query = document.getElementById('cr-search').value.trim().toLowerCase();
        if (!party) return [];
        return this.records.filter(record => this.partyKey(record[partyField]) === party
            && (!from || record.date >= from) && (!to || record.date <= to)
            && (!query || [record.id, record.crop].some(value => String(value ?? '').toLowerCase().includes(query))))
            .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')) || String(a.id).localeCompare(String(b.id), undefined, { numeric: true }));
    },

    number(value) {
        const result = Number(value ?? 0);
        if (!Number.isFinite(result)) throw new Error('A selected receipt contains an invalid amount or weight. Correct the original receipt first.');
        return result;
    },

    rowFor(type, record, payments) {
        const config = this.config(type);
        const amount = Utils.roundCurrency(this.number(type === 'purchase' ? record.netPayableAmount ?? record.amount : record.amount));
        const settled = Utils.roundCurrency(this.number(Utils.paymentTotalFor(record, payments, config.linkField, config.paidField)));
        return { id: record.id, date: record.date || '', crop: record.crop || '',
            weight: Utils.roundCurrency(this.number(record.netWeight)), rate: this.number(record.rate), amount, settled,
            balance: Utils.roundCurrency(amount - settled) };
    },

    summarize(type, records, payments) {
        const config = this.config(type);
        if (records.length < 2) throw new Error('Select at least two receipts to combine.');
        const party = this.partyKey(records[0][config.partyField]);
        if (!party || records.some(record => !this.isReceipt(record) || this.partyKey(record[config.partyField]) !== party)) {
            throw new Error(`All selected receipts must belong to the same ${config.partyLabel.toLowerCase()}.`);
        }
        if (new Set(records.map(record => this.recordKey(record))).size !== records.length) throw new Error('A receipt was selected more than once.');
        const rows = records.map(record => this.rowFor(type, record, payments))
            .sort((a, b) => a.date.localeCompare(b.date) || String(a.id).localeCompare(String(b.id), undefined, { numeric: true }));
        // Sum the displayed amounts in paisa so the grand totals match every row.
        const totals = {};
        for (const key of ['weight', 'amount', 'settled', 'balance']) totals[key] = rows.reduce((sum, row) => sum + Math.round(row[key] * 100), 0) / 100;
        return { type, party: String(records[0][config.partyField]).trim(), rows, totals };
    },

    render() {
        const records = this.filteredRecords();
        const pages = Math.max(1, Math.ceil(records.length / this.pageSize));
        this.page = Math.min(this.page, pages);
        const body = document.getElementById('cr-tbody');
        body.replaceChildren();
        let invalid = false;
        for (const record of records.slice((this.page - 1) * this.pageSize, this.page * this.pageSize)) {
            const tr = document.createElement('tr');
            const cell = document.createElement('td');
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.checked = this.selected.has(this.recordKey(record));
            input.setAttribute('aria-label', `Select receipt ${record.id}`);
            input.addEventListener('change', () => {
                if (input.checked) this.selected.add(this.recordKey(record)); else this.selected.delete(this.recordKey(record));
                this.render();
                const replacement = [...document.querySelectorAll('#cr-tbody input')].find(element => element.getAttribute('aria-label') === input.getAttribute('aria-label'));
                replacement?.focus({ preventScroll: true });
            });
            cell.appendChild(input); tr.appendChild(cell);
            try {
                const row = this.rowFor(this.type, record, this.payments);
                [row.id, Utils.formatDate(row.date), row.crop, Utils.formatNum(row.weight, 2), Utils.formatPKR(row.rate), Utils.formatPKR(row.amount), Utils.formatPKR(row.settled), Utils.formatPKR(row.balance)]
                    .forEach((value, index) => {
                        const td = document.createElement('td'); td.textContent = value;
                        if (index >= 3) td.className = 'text-right';
                        tr.appendChild(td);
                    });
            } catch (error) {
                invalid = true;
                const td = document.createElement('td'); td.colSpan = 8; td.textContent = `${record.id}: ${error.message}`;
                tr.appendChild(td); input.disabled = true;
            }
            body.appendChild(tr);
        }
        const empty = document.getElementById('cr-empty');
        const from = document.getElementById('cr-from').value, to = document.getElementById('cr-to').value;
        empty.hidden = records.length > 0;
        empty.textContent = from && to && from > to ? 'The From date must be on or before the To date.'
            : document.getElementById('cr-party').value ? 'No receipts match these dates or search.' : 'Choose a farmer or buyer to view their receipts.';
        document.getElementById('cr-page').textContent = `Page ${this.page} of ${pages} · ${records.length} matching receipts`;
        document.getElementById('cr-prev').disabled = this.page <= 1;
        document.getElementById('cr-next').disabled = this.page >= pages;
        document.getElementById('cr-select-all').disabled = !records.length || invalid;
        document.getElementById('cr-clear').disabled = !this.selected.size;
        document.getElementById('cr-selected').textContent = `${this.selected.size} selected`;
        document.getElementById('cr-export').disabled = this.busy || this.selected.size < 2;
        document.getElementById('cr-total-count').textContent = String(this.selected.size);
        for (const [id, key, places] of [
            ['cr-total-weight', 'weight', 2], ['cr-total-amount', 'amount', 2],
            ['cr-total-settled', 'settled', 2], ['cr-total-balance', 'balance', 2]
        ]) document.getElementById(id).textContent = Utils.formatNum(0, places);
        if (this.selected.size) {
            const selected = this.records.filter(record => this.selected.has(this.recordKey(record)));
            try {
                const rows = selected.map(record => this.rowFor(this.type, record, this.payments));
                const totals = key => rows.reduce((sum, row) => sum + Math.round(row[key] * 100), 0) / 100;
                document.getElementById('cr-total-weight').textContent = Utils.formatNum(totals('weight'), 2);
                document.getElementById('cr-total-amount').textContent = Utils.formatPKR(totals('amount'));
                document.getElementById('cr-total-settled').textContent = Utils.formatPKR(totals('settled'));
                document.getElementById('cr-total-balance').textContent = Utils.formatPKR(totals('balance'));
            } catch (error) {
                document.getElementById('cr-selected').textContent = error.message;
                document.getElementById('cr-export').disabled = true;
            }
        }
    },

    selectAll() {
        this.filteredRecords().forEach(record => this.selected.add(this.recordKey(record)));
        this.render();
    },
    clearSelection() { this.selected.clear(); this.render(); },
    changePage(delta) { this.page = Math.max(1, this.page + delta); this.render(); },

    async buildPDF(summary) {
        const config = this.config(summary.type);
        const [biz, template] = await Promise.all([Settings.getBusiness(), Settings.getReceiptTemplate()]);
        const doc = new window.jspdf.jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });
        const drawHeader = () => {
            let y = ReceiptPDF.drawReportHeader(doc, biz, config.title, { marginX: 12, showOwner: template.showOwner });
            doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
            const lines = doc.splitTextToSize(`${config.partyLabel}: ${summary.party}`, 273);
            doc.text(lines, 12, y); y += lines.length * 4 + 3;
            doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
            doc.text(`${summary.rows.length} original receipts | ${Utils.formatDate(summary.rows[0].date)} to ${Utils.formatDate(summary.rows.at(-1).date)} | Amounts in PKR`, 12, y);
            return y + 5;
        };
        const top = drawHeader();
        if (top > 125) throw new Error('The party or business details are too long to fit the receipt.');
        const totals = summary.totals;
        doc.autoTable({
            startY: top, margin: { top, bottom: 27, left: 12, right: 12 },
            head: [['Receipt no.', 'Date', 'Crop', 'Net KG', 'Rate / maund', summary.type === 'purchase' ? 'Net payable' : 'Sale amount', config.settledLabel, 'Balance']],
            body: summary.rows.map(row => [String(row.id), Utils.formatDate(row.date), row.crop, Utils.formatNum(row.weight, 2), Utils.formatPKR(row.rate), Utils.formatPKR(row.amount), Utils.formatPKR(row.settled), Utils.formatPKR(row.balance)]),
            foot: [[{ content: `GRAND TOTAL — ${summary.rows.length} receipts`, colSpan: 3 }, ...[Utils.formatNum(totals.weight, 2), '—', Utils.formatPKR(totals.amount), Utils.formatPKR(totals.settled), Utils.formatPKR(totals.balance)].map(content => ({ content, styles: { halign: 'right' } }))]],
            showFoot: 'lastPage', rowPageBreak: 'avoid', theme: 'grid',
            styles: { font: 'helvetica', fontSize: 8, cellPadding: 2.5, textColor: 20, lineColor: 190, lineWidth: 0.1, overflow: 'linebreak' },
            headStyles: { fillColor: [35, 35, 35], textColor: 255, fontStyle: 'bold' },
            footStyles: { fillColor: [235, 235, 235], textColor: 0, fontStyle: 'bold' },
            columnStyles: { 0: { cellWidth: 28 }, 1: { cellWidth: 24 }, 2: { cellWidth: 43 }, 3: { cellWidth: 25, halign: 'right' }, 4: { cellWidth: 32, halign: 'right' }, 5: { cellWidth: 40, halign: 'right' }, 6: { cellWidth: 40, halign: 'right' }, 7: { cellWidth: 41, halign: 'right' } },
            willDrawPage: data => {
                if (data.pageNumber > 1) drawHeader();
            },
            didDrawPage: () => {
                doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(80);
                doc.text('Settlements include recorded payments and advance adjustments. This balance covers only the selected receipts.', 12, 190);
                doc.text('Original receipt numbers are retained. ' + String(template.footerText || '').slice(0, 100), 12, 194);
                doc.setTextColor(0);
            }
        });
        ReceiptPDF.drawReportFooter(doc);
        return doc;
    },

    async download() {
        if (this.busy || this.selected.size < 2 || !Utils.requirePDF()) return;
        this.busy = true;
        document.getElementById('cr-fields').disabled = true;
        document.getElementById('cr-export').disabled = true;
        Utils.showLoading('Combining selected receipts...');
        try {
            const selectedRecords = this.records.filter(record => this.selected.has(this.recordKey(record)));
            const before = this.summarize(this.type, selectedRecords, this.payments);
            const fresh = await this.readData(this.type);
            const selected = fresh.records.filter(record => this.selected.has(this.recordKey(record)));
            this.records = fresh.records;
            this.payments = fresh.payments;
            if (selected.length !== this.selected.size) {
                this.selected = new Set(selected.map(record => this.recordKey(record)));
                throw new Error('A selected receipt was removed. Review the selection and try again.');
            }
            if (selected.some(record => this.partyKey(record[this.config().partyField]) !== this.partyKey(before.party))) {
                this.selected.clear();
                throw new Error('A selected receipt now belongs to a different party. Close and reopen this window to select again.');
            }
            const summary = this.summarize(this.type, selected, fresh.payments);
            if (JSON.stringify(summary) !== JSON.stringify(before)) {
                this.selected.clear();
                throw new Error('Selected receipts or their payments changed. Review the updated rows and select again.');
            }
            const doc = await this.buildPDF(summary);
            const name = summary.party.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 60) || 'Party';
            await doc.save(`Combined_${this.type === 'purchase' ? 'Purchases' : 'Sales'}_${name}_${Utils.todayISO()}.pdf`, { returnPromise: true });
            Utils.showToast(`Combined PDF downloaded with ${summary.rows.length} receipts.`);
        } catch (error) {
            Utils.showToast('Could not combine receipts: ' + error.message, 'error');
        } finally {
            this.busy = false;
            document.getElementById('cr-fields').disabled = false;
            Utils.hideLoading();
            this.render();
        }
    }
};
