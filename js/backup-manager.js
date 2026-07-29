// ===== AgriSys Backup, Security & Encryption Module =====

const CryptoUtils = {
    async deriveKey(passphrase, salt) {
        const encoder = new TextEncoder();
        const baseKey = await crypto.subtle.importKey(
            'raw',
            encoder.encode(passphrase),
            'PBKDF2',
            false,
            ['deriveKey']
        );
        return crypto.subtle.deriveKey(
            {
                name: 'PBKDF2',
                salt: salt,
                iterations: 100000,
                hash: 'SHA-256'
            },
            baseKey,
            { name: 'AES-GCM', length: 256 },
            false,
            ['encrypt', 'decrypt']
        );
    },

    bufferToBase64(buffer) {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    },

    base64ToBuffer(base64) {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes.buffer;
    },

    async encrypt(dataJson, passphrase) {
        if (!passphrase) return dataJson;
        const salt = crypto.getRandomValues(new Uint8Array(16));
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const key = await this.deriveKey(passphrase, salt);
        const encoder = new TextEncoder();
        const encryptedBuffer = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv },
            key,
            encoder.encode(dataJson)
        );

        return JSON.stringify({
            _encrypted: true,
            _version: 10,
            format: 'AGRISYS_AES_GCM',
            salt: this.bufferToBase64(salt),
            iv: this.bufferToBase64(iv),
            ciphertext: this.bufferToBase64(encryptedBuffer),
            createdAt: new Date().toISOString()
        }, null, 2);
    },

    async decrypt(encryptedJsonStr, passphrase) {
        let payload;
        try {
            payload = typeof encryptedJsonStr === 'string' ? JSON.parse(encryptedJsonStr) : encryptedJsonStr;
        } catch (e) {
            throw new Error('Invalid backup file payload format');
        }

        if (!payload || !payload._encrypted) return payload; // Not encrypted

        if (!passphrase) {
            throw new Error('ENCRYPTION_PASSPHRASE_REQUIRED');
        }

        try {
            const salt = new Uint8Array(this.base64ToBuffer(payload.salt));
            const iv = new Uint8Array(this.base64ToBuffer(payload.iv));
            const ciphertext = this.base64ToBuffer(payload.ciphertext);
            const key = await this.deriveKey(passphrase, salt);

            const decryptedBuffer = await crypto.subtle.decrypt(
                { name: 'AES-GCM', iv },
                key,
                ciphertext
            );
            const decoder = new TextDecoder();
            const decryptedText = decoder.decode(decryptedBuffer);
            return JSON.parse(decryptedText);
        } catch (e) {
            throw new Error('Incorrect encryption passphrase or corrupted backup file.');
        }
    }
};

const BackupManager = {
    async init() {
        await this.checkAutoBackup();
        await this.renderVaultUI();
    },

    async getBackupSettings() {
        const config = await DB.getSetting('backupConfig');
        return config || {
            autoBackupEnabled: true,
            frequency: 'daily', // 'daily', 'weekly', 'manual'
            passphrase: '',
            googleDriveSync: false,
            lastAutoBackup: null
        };
    },

    async saveBackupSettings(config) {
        await DB.setSetting('backupConfig', config);
        await Utils.audit('update', 'settings', 'backupConfig', { frequency: config.frequency, autoBackupEnabled: config.autoBackupEnabled });
    },

    async checkAutoBackup() {
        const config = await this.getBackupSettings();
        if (!config.autoBackupEnabled) return;

        const lastBackup = config.lastAutoBackup ? new Date(config.lastAutoBackup) : null;
        const now = new Date();
        let shouldBackup = false;

        if (!lastBackup) {
            shouldBackup = true;
        } else {
            const diffHours = (now - lastBackup) / (1000 * 60 * 60);
            if (config.frequency === 'daily' && diffHours >= 24) shouldBackup = true;
            else if (config.frequency === 'weekly' && diffHours >= 168) shouldBackup = true;
        }

        if (shouldBackup) {
            try {
                await this.performAutoBackup(config);
            } catch (e) {
                console.error('Auto backup failed:', e);
            }
        }
    },

    async performAutoBackup(config) {
        const rawData = await DB.exportAll();
        const jsonStr = JSON.stringify(rawData, null, 2);
        const passphrase = config.passphrase || '';
        const finalDataStr = passphrase ? await CryptoUtils.encrypt(jsonStr, passphrase) : jsonStr;

        const snapshot = {
            id: `auto_${Date.now()}`,
            date: new Date().toISOString(),
            type: 'auto',
            isEncrypted: !!passphrase,
            payload: finalDataStr,
            recordCount: Object.values(rawData).filter(Array.isArray).reduce((s, arr) => s + arr.length, 0)
        };

        // Save into IndexedDB vault store
        await DB.put('backup_vault', snapshot);

        // Prune old snapshots (keep last 7)
        const allVault = await DB.getAll('backup_vault');
        if (allVault.length > 7) {
            allVault.sort((a, b) => new Date(b.date) - new Date(a.date));
            const toDelete = allVault.slice(7);
            for (const item of toDelete) {
                await DB.hardDelete('backup_vault', item.id);
            }
        }

        // Update settings
        config.lastAutoBackup = snapshot.date;
        await this.saveBackupSettings(config);
        Utils.showToast('Automated daily backup created successfully!', 'info');
    },

    async exportToFile(passphraseInput = null) {
        try {
            Utils.showLoading('Preparing backup...');
            const config = await this.getBackupSettings();
            const passphrase = passphraseInput !== null ? passphraseInput : (config.passphrase || '');
            const rawData = await DB.exportAll();
            const jsonStr = JSON.stringify(rawData, null, 2);

            let finalContent = jsonStr;
            let filename = `AgriSys_Backup_${Utils.todayISO()}.json`;

            if (passphrase) {
                finalContent = await CryptoUtils.encrypt(jsonStr, passphrase);
                filename = `AgriSys_Backup_${Utils.todayISO()}_encrypted.agrisys.json`;
            }

            const blob = new Blob([finalContent], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            a.click();
            URL.revokeObjectURL(url);

            Utils.hideLoading();
            Utils.showToast(passphrase ? 'Encrypted backup downloaded!' : 'Backup downloaded!');
        } catch (e) {
            Utils.hideLoading();
            Utils.showToast('Export failed: ' + e.message, 'error');
        }
    },

    async exportToGoogleDrive() {
        try {
            Utils.showLoading('Preparing Google Drive backup...');
            const config = await this.getBackupSettings();
            const rawData = await DB.exportAll();
            const jsonStr = JSON.stringify(rawData, null, 2);
            const passphrase = config.passphrase || '';
            const finalContent = passphrase ? await CryptoUtils.encrypt(jsonStr, passphrase) : jsonStr;
            const filename = `AgriSys_Backup_${Utils.todayISO()}${passphrase ? '_encrypted' : ''}.json`;

            // Generate and download file directly
            const blob = new Blob([finalContent], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            a.click();
            URL.revokeObjectURL(url);

            Utils.hideLoading();
            Utils.showToast(passphrase ? 'Encrypted backup generated!' : 'Backup file generated!');

            // Prompt user to open Google Drive to upload file
            const ok = await Utils.confirm(`Backup file generated ("${filename}"). Would you like to open Google Drive to upload it to your cloud storage?`);
            if (ok) {
                window.open('https://drive.google.com/drive/u/0/my-drive', '_blank');
            }
        } catch (e) {
            Utils.hideLoading();
            Utils.showToast('Google Drive backup error: ' + e.message, 'error');
        }
    },

    async restoreFromFile(file, passphraseInput = null) {
        if (!file) return;
        const confirmRestore = await Utils.confirm('Restoring data will replace ALL current records in AgriSys. Make sure you have a current backup. Continue?');
        if (!confirmRestore) return;

        try {
            Utils.showLoading('Reading backup file...');
            const text = await file.text();
            let data;

            // Check if encrypted
            let isEncrypted = false;
            try {
                const parsed = JSON.parse(text);
                if (parsed && parsed._encrypted) isEncrypted = true;
                data = parsed;
            } catch (e) {
                throw new Error('Corrupted JSON backup file format');
            }

            if (isEncrypted) {
                let pass = passphraseInput;
                if (!pass) {
                    pass = prompt('This backup is password-protected. Enter encryption passphrase:');
                    if (!pass) { Utils.hideLoading(); return; }
                }
                data = await CryptoUtils.decrypt(text, pass);
            }

            if (!data || typeof data !== 'object' || !data._version) {
                throw new Error('Invalid AgriSys backup file. Version signature missing.');
            }

            Utils.showLoading('Restoring database stores...');
            await DB.importAll(data);
            Utils.hideLoading();
            Utils.showToast('Database successfully restored! Reloading application...');
            setTimeout(() => location.reload(), 1500);
        } catch (e) {
            Utils.hideLoading();
            Utils.showToast('Restore failed: ' + e.message, 'error');
        }
    },

    async restoreFromVault(snapshotId) {
        const snapshot = await DB.get('backup_vault', snapshotId);
        if (!snapshot) return;

        const ok = await Utils.confirm(`Restore automated snapshot from ${Utils.formatDateTime(snapshot.date)}? Current data will be replaced.`);
        if (!ok) return;

        try {
            Utils.showLoading('Restoring from local vault...');
            let data = snapshot.payload;
            if (typeof data === 'string') data = JSON.parse(data);

            if (data._encrypted) {
                const pass = prompt('This vault snapshot is encrypted. Enter passphrase:');
                if (!pass) { Utils.hideLoading(); return; }
                data = await CryptoUtils.decrypt(snapshot.payload, pass);
            }

            await DB.importAll(data);
            Utils.hideLoading();
            Utils.showToast('Restored from vault snapshot! Reloading...');
            setTimeout(() => location.reload(), 1500);
        } catch (e) {
            Utils.hideLoading();
            Utils.showToast('Vault restore failed: ' + e.message, 'error');
        }
    },

    async renderVaultUI() {
        const config = await this.getBackupSettings();
        
        // Update UI inputs
        if (document.getElementById('set-autobackup-enable')) {
            document.getElementById('set-autobackup-enable').checked = config.autoBackupEnabled !== false;
            document.getElementById('set-autobackup-freq').value = config.frequency || 'daily';
            document.getElementById('set-backup-pass').value = config.passphrase || '';
        }

        const tbody = document.getElementById('backup-vault-tbody');
        if (!tbody) return;

        const snapshots = await DB.getAll('backup_vault');
        snapshots.sort((a, b) => new Date(b.date) - new Date(a.date));

        if (!snapshots.length) {
            tbody.innerHTML = `<tr><td colspan="5" class="text-center" style="color:var(--text-muted)">No automated local backups saved in vault yet.</td></tr>`;
            return;
        }

        tbody.innerHTML = snapshots.map(s => `
            <tr>
                <td>${Utils.formatDateTime(s.date)}</td>
                <td><span class="badge ${s.type === 'auto' ? 'badge-info' : 'badge-success'}">${s.type === 'auto' ? 'Daily Auto' : 'Manual'}</span></td>
                <td>${s.isEncrypted ? '🔒 AES-256 Encrypted' : '🔓 Unencrypted'}</td>
                <td class="text-right font-bold">${s.recordCount || '-'} records</td>
                <td>
                    <div class="table-actions">
                        <button class="btn btn-icon btn-ghost btn-sm" onclick="BackupManager.restoreFromVault('${s.id}')" title="Restore Snapshot">🔄</button>
                        <button class="btn btn-icon btn-danger btn-sm" onclick="BackupManager.deleteVaultItem('${s.id}')" title="Delete">🗑️</button>
                    </div>
                </td>
            </tr>
        `).join('');
    },

    async deleteVaultItem(id) {
        if (!await Utils.confirm('Delete this backup snapshot from vault?')) return;
        await DB.hardDelete('backup_vault', id);
        Utils.showToast('Snapshot removed!');
        await this.renderVaultUI();
    },

    async saveSettingsFromForm() {
        const config = {
            autoBackupEnabled: document.getElementById('set-autobackup-enable').checked,
            frequency: document.getElementById('set-autobackup-freq').value,
            passphrase: document.getElementById('set-backup-pass').value.trim(),
            lastAutoBackup: (await this.getBackupSettings()).lastAutoBackup || null
        };
        await this.saveBackupSettings(config);
        Utils.showToast('Backup & security settings saved!');
    }
};
