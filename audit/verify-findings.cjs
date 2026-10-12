// Focused verification of accounting findings. In-memory records + DOM stubs, same scaffold as regression-tests.cjs.
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const elements = new Map();
const element = id => {
    if (!elements.has(id)) elements.set(id, { value: '', innerHTML: '', textContent: '', style: {}, dataset: {}, disabled: false,
        setAttribute() {}, removeAttribute() {}, classList: { add() {}, remove() {} } });
    return elements.get(id);
};
const context = vm.createContext({ console: { log() {}, warn() {}, error() {} }, structuredClone, Date, Math,
    setTimeout() {}, location: { reload() {} }, window: {},
    document: { getElementById: element, addEventListener() {}, querySelector: () => element('selector'), querySelectorAll: () => [] } });
const files = fs.readdirSync(path.join(root, 'js')).filter(f => f.endsWith('.js'));
for (const file of files) vm.runInContext(fs.readFileSync(path.join(root, 'js', file), 'utf8'), context, { filename: file });
const api = vm.runInContext('({DB, Utils, Reports, Bookkeeping})', context);
let records = {}, seq = 0;
const clone = value => value == null ? value : structuredClone(value);
const key = r => r.id ?? r.key ?? r.crop ?? r.seasonId;
api.DB.getAll = async store => clone((records[store] || []).filter(r => !r.isDeleted));
api.DB.get = async (store, id) => clone((records[store] || []).find(r => key(r) === id && !r.isDeleted));
api.Utils.generateId = () => `t-${++seq}`;
api.Utils.getActiveSeason = async () => (records.seasons || []).find(s => s.active) || null;

const money = html => {
    const grab = label => {
        const re = new RegExp(label + '[^]*?PKR ([0-9,]+\\.[0-9]{2})');
        const m = html.match(re);
        return m ? Number(m[1].replace(/,/g, '')) : null;
    };
    return {
        totalAssets: grab('Total Assets'),
        totalLiabEquity: grab('Total Equity &amp; Liabilities') ?? grab('Total Equity & Liabilities'),
        accountsPayable: grab('Accounts Payable \\(Farmers\\)'),
        inventory: grab('Inventory on Hand'),
        cash: grab('Cash &amp; Equivalent') ?? grab('Cash & Equivalent'),
        retained: grab('Accumulated Retained Earnings')
    };
};

(async () => {
    // Scenario: opening cash 200; purchase gross 100 with a PKR 10 "other" deduction -> farmer payable 90, unpaid.
    // No commission, no tax. Inventory is valued at GROSS (100). The journal credits Other Income 10.
    records = {};
    elements.clear();
    records.capital_accounts = [{ id: 'cash', name: 'Cash', openingBalance: 200, createdAt: '2026-01-01' }];
    records.purchases = [{
        id: 'P1', farmerName: 'Ali', crop: 'Wheat', date: '2026-01-05', netWeight: 100, netMn: 2.5,
        amount: 100, payableBeforeAdvance: 90, netPayableAmount: 90, pkrDeductionsBeforeAdvance: 10,
        commissionTotal: 0, mandiTaxTotal: 0, advanceDeducted: 0,
        amountPaid: 0, initialPaymentAmount: 0, paymentStatus: 'pending'
    }];
    element('rp-to').value = '2026-01-31';
    await api.Reports.generateBalanceSheet();
    const bs = money(element('report-content').innerHTML);
    console.log('Balance sheet (PKR 10 other deduction on gross-100 purchase):');
    console.log('  inventory      =', bs.inventory);
    console.log('  cash           =', bs.cash);
    console.log('  total assets   =', bs.totalAssets);
    console.log('  accounts pay.  =', bs.accountsPayable);
    console.log('  retained       =', bs.retained);
    console.log('  total L+E      =', bs.totalLiabEquity);
    console.log('  BALANCED?      =', Math.abs(bs.totalAssets - bs.totalLiabEquity) < 0.01 ? 'yes' : `NO (off by ${bs.totalAssets - bs.totalLiabEquity})`);

    // Cross-check: the journal entry for the same data should balance and recognise Other Income.
    const entries = await api.Bookkeeping.generateEntries('', '2026-01-31');
    const d = entries.reduce((s, e) => s + (e.debit || 0), 0);
    const c = entries.reduce((s, e) => s + (e.credit || 0), 0);
    const otherIncome = entries.filter(e => e.account === 'Other Income').reduce((s, e) => s + (e.credit || 0), 0);
    console.log('\nJournal for same data:');
    console.log('  total debit    =', d, ' total credit =', c, ' balanced?', Math.abs(d - c) < 0.01 ? 'yes' : 'NO');
    console.log('  Other Income credit posted =', otherIncome);

    // P&L for the same data.
    element('rp-from').value = '2026-01-01';
    element('rp-to').value = '2026-01-31';
    await api.Reports.generatePnL();
    const pnlHtml = element('report-content').innerHTML;
    const net = pnlHtml.match(/Net Profit \/ \(Loss\)[^]*?PKR ([0-9,]+\.[0-9]{2})/);
    console.log('\nP&L net profit reported =', net ? net[1] : '(not found)');
    console.log('  (should match the journal Other Income credit)');
    if (Math.abs(bs.totalAssets - bs.totalLiabEquity) >= 0.01 || otherIncome !== 10 || !net || Math.abs(Number(net[1].replace(/,/g, '')) - 10) >= 0.01) {
        throw new Error('Purchase deduction does not reconcile across the balance sheet, journal, and P&L');
    }
})().catch(e => { console.error('ERROR', e); process.exit(1); });
