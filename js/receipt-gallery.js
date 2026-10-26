// Read-only collection of the images already attached to purchases and sales.
const ReceiptGallery = {
    items: [],
    selected: new Set(),
    page: 1,
    pageSize: 24,
    loadVersion: 0,
    exporting: false,

    async readItems() {
        const [purchases, sales] = await Promise.all([DB.getAll('purchases'), DB.getAll('sales')]);
        return [
            ...purchases.map(data => ({ type: 'purchase', data, image: data.scaleImage, party: data.farmerName })),
            ...sales.map(data => ({ type: 'sale', data, image: data.receiptImage, party: data.buyerName }))
        ].filter(item => !item.data.isDeleted && item.image)
            .map(item => ({ ...item, key: JSON.stringify([item.type, String(item.data.id)]) }))
            .sort((a, b) => String(b.data.date || '').localeCompare(String(a.data.date || '')) || a.key.localeCompare(b.key, undefined, { numeric: true }));
    },

    async render() {
        const version = ++this.loadVersion;
        try {
            const items = await this.readItems();
            if (version !== this.loadVersion) return;
            this.items = items;
            const available = new Set(items.map(item => item.key));
            this.selected = new Set([...this.selected].filter(key => available.has(key)));
            this.renderGrid();
        } catch (error) {
            if (version !== this.loadVersion) return;
            this.items = [];
            this.selected.clear();
            this.renderGrid();
            document.getElementById('rg-empty').textContent = 'Could not load receipt images. Use Refresh to try again.';
            Utils.showToast('Could not load receipt images: ' + error.message, 'error');
        }
    },

    filteredItems() {
        const query = document.getElementById('rg-search').value.trim().toLowerCase();
        const type = document.getElementById('rg-type').value;
        const from = document.getElementById('rg-from').value;
        const to = document.getElementById('rg-to').value;
        return this.items.filter(item => (!type || item.type === type)
            && (!from || item.data.date >= from) && (!to || item.data.date <= to)
            && (!query || [item.data.id, item.party, item.data.crop].some(value => String(value ?? '').toLowerCase().includes(query))));
    },

    applyFilters() {
        this.page = 1;
        this.renderGrid();
    },

    resetFilters() {
        for (const id of ['rg-search', 'rg-type', 'rg-from', 'rg-to']) document.getElementById(id).value = '';
        this.applyFilters();
    },

    isImageSource(source) {
        return typeof source === 'string' && /^data:image\/(?:png|jpe?g|webp|gif|bmp);base64,/i.test(source);
    },

    renderGrid() {
        const filtered = this.filteredItems();
        const pages = Math.max(1, Math.ceil(filtered.length / this.pageSize));
        this.page = Math.min(this.page, pages);
        const grid = document.getElementById('rg-grid');
        grid.replaceChildren();
        for (const item of filtered.slice((this.page - 1) * this.pageSize, this.page * this.pageSize)) {
            const card = document.createElement('article');
            card.className = 'rg-card';
            const label = item.type === 'purchase' ? 'Purchase' : 'Sale';
            const identity = `${label} #${item.data.id}`;
            const escape = Utils.escapeHTML;
            card.innerHTML = `
                <label class="rg-card-heading"><input type="checkbox"><span>${escape(identity)}</span><span class="rg-kind">${label}</span></label>
                <button class="rg-thumbnail" type="button"><span class="rg-image-error" hidden>Image unavailable. Open the original record to replace it.</span></button>
                <div class="rg-card-details"><strong>${escape(item.party || 'Unnamed party')}</strong><span>${escape(Utils.formatDate(item.data.date))} · ${escape(item.data.crop || '—')}</span><span>${item.type === 'purchase' ? 'Kanda / scale slip' : 'Buyer receipt'}</span></div>`;
            const checkbox = card.querySelector('input');
            checkbox.checked = this.selected.has(item.key);
            checkbox.setAttribute('aria-label', 'Select ' + identity);
            card.classList.toggle('selected', checkbox.checked);
            checkbox.addEventListener('change', () => {
                if (checkbox.checked) this.selected.add(item.key); else this.selected.delete(item.key);
                card.classList.toggle('selected', checkbox.checked);
                this.updateSelection();
            });
            const preview = card.querySelector('button');
            preview.setAttribute('aria-label', 'Preview ' + identity);
            const image = document.createElement('img');
            image.alt = identity + ' uploaded image';
            image.loading = 'lazy';
            image.onerror = () => { image.hidden = true; preview.querySelector('span').hidden = false; };
            if (this.isImageSource(item.image)) image.src = item.image;
            else image.onerror();
            preview.appendChild(image);
            preview.addEventListener('click', () => this.preview(item));
            grid.appendChild(card);
        }
        const empty = document.getElementById('rg-empty');
        empty.hidden = filtered.length > 0;
        const invalidRange = document.getElementById('rg-from').value && document.getElementById('rg-to').value
            && document.getElementById('rg-from').value > document.getElementById('rg-to').value;
        empty.textContent = invalidRange ? 'The From date must be on or before the To date.' : this.items.length
            ? 'No receipt images match these filters.'
            : 'No receipt images yet. Upload a scale slip in a purchase or a buyer receipt in a sale, then save the record.';
        document.getElementById('rg-results').textContent = `${filtered.length} of ${this.items.length} receipt images · All seasons`;
        document.getElementById('rg-page').textContent = `Page ${this.page} of ${pages}`;
        document.getElementById('rg-prev').disabled = this.page <= 1;
        document.getElementById('rg-next').disabled = this.page >= pages;
        document.getElementById('rg-select-filtered').disabled = !filtered.length;
        this.updateSelection();
    },

    changePage(delta) {
        this.page = Math.max(1, this.page + delta);
        this.renderGrid();
    },

    selectFiltered() {
        this.filteredItems().forEach(item => this.selected.add(item.key));
        this.renderGrid();
    },

    clearSelection() {
        this.selected.clear();
        this.renderGrid();
    },

    updateSelection() {
        const visibleKeys = new Set(this.filteredItems().map(item => item.key));
        const hidden = [...this.selected].filter(key => !visibleKeys.has(key)).length;
        document.getElementById('rg-selection').textContent = `${this.selected.size} selected${hidden ? ` (${hidden} outside current filters)` : ''}`;
        document.getElementById('rg-export').disabled = !this.selected.size || this.exporting;
        document.getElementById('rg-clear').disabled = !this.selected.size;
    },

    preview(item) {
        const image = document.getElementById('rg-preview-image');
        const error = document.getElementById('rg-preview-error');
        const title = `${item.type === 'purchase' ? 'Purchase' : 'Sale'} #${item.data.id} · ${item.party || ''}`;
        document.getElementById('rg-preview-title').textContent = title;
        image.removeAttribute('src');
        image.alt = title;
        image.hidden = false;
        error.hidden = true;
        image.onerror = () => { image.hidden = true; error.hidden = false; };
        if (this.isImageSource(item.image)) image.src = item.image; else image.onerror();
        Utils.showModal('rg-preview-modal');
    },

    // Decode to a supported raster format without changing the stored upload.
    loadImage(source) {
        return new Promise((resolve, reject) => {
            if (!this.isImageSource(source)) { reject(new Error('Unsupported image format')); return; }
            const image = new Image();
            const timer = setTimeout(() => { image.onload = image.onerror = null; reject(new Error('Image took too long to load')); }, 15000);
            image.onerror = () => { clearTimeout(timer); reject(new Error('Uploaded image cannot be read')); };
            image.onload = () => {
                clearTimeout(timer);
                try {
                    const canvas = document.createElement('canvas');
                    canvas.width = image.naturalWidth;
                    canvas.height = image.naturalHeight;
                    const ctx = canvas.getContext('2d');
                    ctx.fillStyle = '#ffffff';
                    ctx.fillRect(0, 0, canvas.width, canvas.height);
                    ctx.drawImage(image, 0, 0);
                    resolve({ source: canvas.toDataURL('image/jpeg', 0.95), width: canvas.width, height: canvas.height });
                } catch (error) { reject(error); }
            };
            image.src = source;
        });
    },

    async buildPDF(items, includeReceipt) {
        const [biz, template] = await Promise.all([Settings.getBusiness(), Settings.getReceiptTemplate()]);
        const doc = new window.jspdf.jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });
        for (let index = 0; index < items.length; index++) {
            const item = items[index];
            const label = item.type === 'purchase' ? 'Purchase' : 'Sale';
            try {
                const image = await this.loadImage(item.image);
                if (index) doc.addPage('a4', 'landscape');
                // Reset styles left by the receipt renderer before drawing this page.
                doc.setTextColor(0);
                doc.setDrawColor(180);
                doc.setFont('helvetica', 'normal');
                doc.setFontSize(8);
                const left = includeReceipt ? 158 : 12;
                const width = includeReceipt ? 127 : 273;
                doc.text(`${label.toUpperCase()} #${item.data.id}`, left, 12, { maxWidth: width });
                const details = doc.splitTextToSize(`${item.party || ''} | ${Utils.formatDate(item.data.date)} | ${item.data.crop || ''}`, width);
                doc.text(details, left, 18);
                const labelY = 20 + details.length * 4;
                doc.setFont('helvetica', 'bold');
                doc.text(item.type === 'purchase' ? 'UPLOADED KANDA / SCALE SLIP' : 'UPLOADED BUYER RECEIPT', left, labelY);
                const top = labelY + 5;
                const height = 195 - top;
                if (height <= 0) throw new Error('Receipt details are too long to fit on a page');
                const scale = Math.min(width / image.width, height / image.height);
                const imageWidth = image.width * scale, imageHeight = image.height * scale;
                doc.addImage(image.source, 'JPEG', left + (width - imageWidth) / 2, top + (height - imageHeight) / 2, imageWidth, imageHeight);
                doc.setFont('helvetica', 'normal');
                doc.setFontSize(7);
                doc.text(`${index + 1} / ${items.length}`, 285, 204, { align: 'right' });
                if (includeReceipt) {
                    doc.setLineWidth(0.2);
                    doc.line(149, 5, 149, 205);
                    const amount = item.type === 'purchase' ? item.data.netPayableAmount ?? item.data.amount ?? 0 : item.data.amount ?? 0;
                    const qr = template.showQR === false ? null : await ReceiptPDF.getQRCode(`AgriSys ${label}\nID: ${item.data.id}\nDate: ${item.data.date}\nParty: ${item.party}\nAmount: PKR ${amount}`);
                    doc.setDrawColor(0);
                    if (item.type === 'purchase') ReceiptPDF.drawPurchaseCopy(doc, item.data, biz, 3, 'COMPUTERIZED COPY', qr, template);
                    else ReceiptPDF.drawSaleCopy(doc, item.data, biz, 3, 'COMPUTERIZED COPY', qr, template);
                }
            } catch (error) {
                throw new Error(`${label} #${item.data.id}: ${error.message}`);
            }
        }
        return doc;
    },

    async exportSelected() {
        if (this.exporting || !this.selected.size || !Utils.requirePDF()) return;
        const keys = new Set(this.selected);
        const includeReceipt = document.getElementById('rg-pdf-layout').value === 'paired';
        this.exporting = true;
        this.updateSelection();
        Utils.showLoading('Preparing selected receipts...');
        try {
            // Re-read so edited or deleted records are never exported from stale gallery data.
            const items = (await this.readItems()).filter(item => keys.has(item.key));
            if (items.length !== keys.size) throw new Error('Some selected images were removed. Refresh the gallery and select again.');
            const doc = await this.buildPDF(items, includeReceipt);
            await doc.save(`AgriSys_Receipts_${Utils.todayISO()}.pdf`, { returnPromise: true });
            Utils.showToast(`PDF downloaded with ${items.length} receipt${items.length === 1 ? '' : 's'}.`);
        } catch (error) {
            console.error('Receipt gallery PDF:', error);
            Utils.showToast('PDF could not be created. ' + error.message, 'error');
        } finally {
            this.exporting = false;
            Utils.hideLoading();
            this.updateSelection();
        }
    }
};
