// Isolated reproductions of remaining defects; never accesses browser business data.
// PASS means the previously failing scenario now has correct results.
const fs = require('node:fs');
const vm = require('node:vm');
const setup = fs.readFileSync(__dirname + '/regression-tests.cjs', 'utf8').split('\n(async () => {')[0];
const scenarios = String.raw`
api.PurchaseList.render = async () => {};
const metric = (label) => {
    const text = element('report-content').innerHTML.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
    const start = text.indexOf(label);
    if (start < 0) throw new Error('Missing metric: ' + label);
    return Number(text.slice(start + label.length).match(/PKR\s+([\d,.-]+)/)[1].replace(/,/g, ''));
};
const reportDates = () => form({'rp-from':'2026-01-01','rp-to':'2026-12-31'});
(async () => {
    await check('Opening cash has no corresponding balance-sheet equity', async () => {
        records.capital_accounts = [{id:'cash',name:'Cash',openingBalance:100,createdAt:'2026-01-01'}];
        reportDates(); await api.Reports.generateBalanceSheet();
        assert.equal(metric('Total Assets'),100);
        assert.equal(metric('Total Equity & Liabilities'),100);
    });
    await check('PKR purchase deductions reconcile income, profit, and balance-sheet equity', async () => {
        records.capital_accounts=[{id:'cash',name:'Cash',openingBalance:200,createdAt:'2026-01-01'}];
        records.purchases=[purchase('P1',{amount:100,payableBeforeAdvance:90,netPayableAmount:90,pkrDeductionsBeforeAdvance:10,totalPkrDeductions:10,commissionTotal:0,mandiTaxTotal:0})];
        reportDates(); await api.Reports.generatePnL(); assert.equal(metric('Net Profit'),10);
        await api.Reports.generateBalanceSheet();
        assert.equal(metric('Total Assets'),300); assert.equal(metric('Total Equity & Liabilities'),300);
        assert.equal(await api.PartnersMgmt.getBusinessNetProfit(),10);
        const crop=api.CropAnalysis.computeMetrics('Wheat',records.purchases,[],[]);
        assert.equal(crop.netPL,10);
        const journal=await api.Bookkeeping.generateEntries('','2026-12-31');
        assert.equal(journal.filter(e=>e.account==='Other Income').reduce((s,e)=>s+e.credit,0),10);
    });
    await check('Stock increase is recognized as income and retained equity', async () => {
        records.capital_accounts=[{id:'cash',name:'Cash',openingBalance:100,createdAt:'2026-01-01'}];
        records.stock_adjustments=[{id:'GAIN',direction:'increase',crop:'Wheat',weight:100,value:40,date:'2026-01-02'}];
        reportDates(); await api.Reports.generatePnL(); assert.equal(metric('Net Profit'),40);
        await api.Reports.generateBalanceSheet();
        assert.equal(metric('Total Assets'),140); assert.equal(metric('Total Equity & Liabilities'),140);
        assert.equal(await api.PartnersMgmt.getBusinessNetProfit(),40);
        const adjusted=api.Utils.applyStockAdjustments([],[],records.stock_adjustments);
        assert.equal(api.CropAnalysis.computeMetrics('Wheat',adjusted.purchases,adjusted.sales,[]).netPL,40);
        assert.equal(api.Reports.stockAdjustmentGain({stockAdjustments:records.stock_adjustments},'2026-01-03',''),0);
    });
    await check('Legacy opening stock adjustment receives equity exactly once', async () => {
        records.stock_adjustments=[{id:'OPEN',direction:'opening',crop:'Wheat',weight:100,value:80,date:'2026-01-01'}];
        reportDates(); await api.Reports.generateBalanceSheet();
        assert.equal(metric('Total Assets'),80); assert.equal(metric('Opening Equity'),80);
        assert.equal(metric('Total Equity & Liabilities'),80);
        records.opening_balances=[{id:'OPEN',type:'stock',crop:'Wheat',weight:100,amount:80,date:'2026-01-01'}];
        await api.Reports.generateBalanceSheet(); assert.equal(metric('Opening Equity'),80);
    });
    await check('Crop analysis excludes synthetic stock from purchase and sale weight metrics', async () => {
        const stock=api.Utils.applyStockAdjustments(
            [purchase('P1',{amountPaid:30})],
            [sale('S1',{netWeight:60,amount:120,amountReceived:40})],
            [
                {id:'OB',direction:'opening',crop:'Wheat',weight:100,value:100,date:'2026-01-01'},
                {id:'IN',direction:'increase',crop:'Wheat',weight:50,value:50,date:'2026-01-02'},
                {id:'OUT',direction:'decrease',crop:'Wheat',weight:20,value:20,date:'2026-01-03'}
            ]
        );
        const m=api.CropAnalysis.computeMetrics('Wheat',stock.purchases,stock.sales,[]);
        assert.equal(m.purchaseWeight,100); assert.equal(m.purchaseMaund,2.5);
        assert.equal(m.saleWeight,60); assert.equal(m.saleMaund,1.5);
        assert.equal(m.netWeight,170);
        records.purchases=[purchase('P1',{amountPaid:30})]; records.sales=[sale('S1',{netWeight:60})];
        records.stock_adjustments=[
            {id:'OB',direction:'opening',crop:'Wheat',weight:100,value:100,date:'2026-01-01'},
            {id:'IN',direction:'increase',crop:'Wheat',weight:50,value:50,date:'2026-01-02'},
            {id:'OUT',direction:'decrease',crop:'Wheat',weight:20,value:20,date:'2026-01-03'}
        ];
        await api.StockAdjustments.render();
        const inventoryText=element('stock-adj-live-summary').innerHTML;
        assert.match(inventoryText,/Purchased: 100 KG/); assert.match(inventoryText,/Sold: 60 KG/);
        assert.match(inventoryText,/Opening: 100 KG/); assert.match(inventoryText,/170\.00 KG/);
    });
    await check('Historical cash flow starts account balances on their creation date', async () => {
        records.capital_accounts=[{id:'cash',name:'Cash',openingBalance:100,createdAt:'2026-02-01T09:00:00.000Z'}];
        form({'rp-from':'2026-01-01','rp-to':'2026-02-28'});
        await api.Reports.generateCashFlow();
        assert.equal(metric('Beginning Cash & Bank Balance'),0);
        assert.equal(metric('ENDING CASH & BANK BALANCE'),100);
    });
    await check('P&L groups crop names regardless of capitalization', async () => {
        records.purchases=[purchase('P1',{crop:'Wheat'})];
        records.sales=[sale('S1',{crop:'wheat',amount:200})];
        reportDates(); await api.Reports.generatePnL();
        const html=element('report-content').innerHTML;
        assert.equal(html.split('>Wheat</td>').length - 1,1);
        assert.equal(metric('Net Profit'),100);
    });
    await check('Mandi tax liability missing from balance sheet', async () => {
        records.purchases = [purchase('P1',{netPayableAmount:90,mandiTaxTotal:10,pkrDeductionsBeforeAdvance:10})];
        reportDates(); await api.Reports.generateBalanceSheet();
        assert.equal(metric('Total Assets'),100);
        assert.equal(metric('Total Liabilities'),100);
        const journal = await api.Bookkeeping.generateEntries();
        assert.equal(journal.filter(e=>e.account==='Mandi Tax Payable').reduce((s,e)=>s+e.credit,0),10);
    });
    await check('Opening inventory sale has zero journal COGS', async () => {
        records.opening_balances = [{id:'OB',type:'stock',crop:'Wheat',amount:100,date:'2026-01-01'}];
        records.stock_adjustments = [{id:'ADJ',direction:'opening',crop:'Wheat',weight:100,value:100,date:'2026-01-01'}];
        records.sales = [sale('S1',{amount:200})];
        const journal = await api.Bookkeeping.generateEntries();
        assert.equal(journal.filter(e=>e.account==='Cost of Goods Sold').reduce((s,e)=>s+e.debit,0),100);
        const scoped = await api.Reports.getScopedData('2026-01-01','2026-12-31');
        assert.equal(api.Reports.cogsForSales(scoped.sales,api.Utils.calculateInventoryLots(scoped.purchases,scoped.sales)),100);
    });
    await check('Manual expense journal omitted from P&L', async () => {
        records.journal_entries = [{id:'JV',date:'2026-01-01',debitAccount:'Operating Expenses',creditAccount:'Cash / Bank',amount:50}];
        reportDates(); await api.Reports.generatePnL();
        assert.equal(metric('Net Profit'),-50);
        assert.equal((await api.Bookkeeping.generateEntries()).filter(e=>e.account==='Operating Expenses').reduce((s,e)=>s+e.debit,0),50);
    });
    await check('Deleting used bank account removes cash trail but retains paid invoice', async () => {
        records.capital_accounts = [{id:'cash',name:'Cash',openingBalance:100}];
        records.purchases = [purchase('P1',{amountPaid:100,initialPaymentAmount:100,initialPaymentAccountId:'cash'})];
        records.capital_transactions = [{id:'TX',accountId:'cash',sourceStore:'purchases',sourceId:'P1',type:'withdrawal',amount:100}];
        await api.BankAccounts.deleteAccount('cash');
        assert.equal((await api.DB.getAll('capital_transactions')).length,1);
        assert.equal((await api.DB.get('purchases','P1')).amountPaid,100);
    });
    await check('Deleting consumed purchase leaves sale without cost or stock', async () => {
        records.purchases = [purchase('P1')]; records.sales = [sale('S1',{amount:200})];
        await api.PurchaseList.delete('P1');
        assert.equal((await api.DB.getAll('purchases')).length,1);
        const metrics = api.Utils.calculateInventoryLots(await api.DB.getAll('purchases'),await api.DB.getAll('sales'));
        assert.equal(metrics.Wheat.oversoldWeight,0); assert.equal(metrics.Wheat.cogs,100);
    });
    await check('Season carry-forward averages FIFO layers and changes partner profit', async () => {
        records.purchases = [purchase('P1',{amount:100}),purchase('P2',{amount:300,date:'2026-01-02'})];
        const season = {id:'SN',label:'February',startDate:'2026-02-01',endDate:'2026-12-31',active:true};
        await api.SeasonManager.carryForwardInventory(season); records.seasons=[season];
        records.sales=[sale('S1',{date:'2026-02-02',amount:400})];
        assert.equal(await api.PartnersMgmt.getBusinessNetProfit(),300);
        const scoped=await api.Reports.getScopedData('2026-02-01','2026-12-31');
        assert.equal(400-api.Reports.cogsForSales(scoped.sales,api.Utils.calculateInventoryLots(scoped.purchases,scoped.sales)),300);
    });
    await check('Backdated payment consumes a future buyer deposit', async () => {
        records.sales=[sale('S1')];
        records.opening_balances=[{id:'OB',type:'buyer_advance',partyName:'Ali',amount:100,date:'2026-02-01'}];
        await assert.rejects(api.PaymentService.save('buyer',{name:'Ali',date:'2026-01-02',amount:100,advance:100,invoiceId:'S1'}), /exceeds available/);
    });
    await check('Concurrent payments overwrite invoice total while both cash events survive', async () => {
        records.purchases=[purchase('P1')];
        await Promise.all([1,2].map(()=>api.PaymentService.save('farmer',{name:'Ali',date:'2026-01-02',amount:60,advance:0,accountId:'cash',invoiceId:'P1'})));
        assert.equal((await api.DB.get('purchases','P1')).amountPaid,100);
        assert.equal((await api.DB.getAll('purchase_payments')).reduce((s,p)=>s+p.amount,0),100);
    });
    await check('Backdated application preserves later reserved deposits', async () => {
        records.sales=[sale('S1',{amountReceived:80})];
        records.opening_balances=[{id:'OB',type:'buyer_advance',partyName:'Ali',amount:100,date:'2026-01-01'}];
        records.sale_payments=[{id:'OLD',saleId:'S1',buyerName:'Ali',date:'2026-02-01',amount:80,advanceDeducted:80,netCashAmount:0}];
        records.sales.push(sale('S2'));
        await assert.rejects(api.PaymentService.save('buyer',{name:'Ali',date:'2026-01-02',amount:30,advance:30,invoiceId:'S2'}), /overdrawn/);
        assert.equal((await api.DB.getAll('sale_payments')).length,1);
    });
    await check('Purchase date and quantity edits cannot strand a later sale', async () => {
        records.purchases=[purchase('P1')]; records.sales=[sale('S1',{date:'2026-01-03'})];
        await assert.rejects(api.Utils.validateStockHistory([{storeName:'purchases',action:'put',data:purchase('P1',{date:'2026-02-01'})}]), /insufficient stock/);
        await assert.rejects(api.Utils.validateStockHistory([{storeName:'purchases',action:'put',data:purchase('P1',{netWeight:50})}]), /insufficient stock/);
        await api.Utils.validateStockHistory([{storeName:'purchases',action:'put',data:purchase('P1',{amount:150})}]);
    });
    await check('Unused purchase remains deletable', async () => {
        records.purchases=[purchase('P1')]; await api.PurchaseList.delete('P1');
        assert.equal((await api.DB.getAll('purchases')).length,0);
    });
    await check('Mixed opening balances have signed equity counterparts', async () => {
        records.capital_accounts=[{id:'cash',name:'Cash',openingBalance:100,createdAt:'2026-01-01'}];
        records.opening_balances=[['farmer_payable',20],['buyer_receivable',30],['stock',40],['farmer_advance',10],['buyer_advance',5]].map(([type,amount],i)=>({id:'OB'+i,type,amount,date:'2026-01-01'}));
        records.stock_adjustments=[{id:'OB2',direction:'opening',crop:'Wheat',weight:100,value:40,date:'2026-01-01'}];
        reportDates(); await api.Reports.generateBalanceSheet();
        assert.equal(metric('Total Assets'),180); assert.equal(metric('Total Liabilities'),25);
        assert.equal(metric('Opening Equity'),155); assert.equal(metric('Total Equity & Liabilities'),180);
    });
    await check('Tax remittance reduces liability and cash without reducing profit', async () => {
        records.capital_accounts=[{id:'cash',name:'Cash',openingBalance:100,createdAt:'2026-01-01'}];
        records.purchases=[purchase('P1',{netPayableAmount:90,mandiTaxTotal:10,pkrDeductionsBeforeAdvance:10})];
        records.journal_entries=[{id:'JV',date:'2026-01-02',debitAccount:'Mandi Tax Payable',creditAccount:'Cash / Bank',amount:10}];
        reportDates(); await api.Reports.generateBalanceSheet();
        assert.equal(metric('Mandi Tax Payable'),0); assert.equal(metric('Total Assets'),190);
        assert.equal(metric('Total Equity & Liabilities'),190);
        await api.Reports.generatePnL(); assert.equal(metric('Net Profit'),0);
    });
    await check('Repeated rollover preserves FIFO layers without duplicating them', async () => {
        records.purchases=[purchase('P1'),purchase('P2',{amount:300,date:'2026-01-02'})];
        const season={id:'SN',label:'February',startDate:'2026-02-01'};
        await api.SeasonManager.carryForwardInventory(season); await api.SeasonManager.carryForwardInventory(season);
        const lots=(await api.DB.getAll('purchases')).filter(p=>p.type==='opening_balance');
        assert.equal(lots.length,2); assert.equal(JSON.stringify(lots.map(p=>p.amount).sort((a,b)=>a-b)),'[100,300]');
    });
    await check('Owner journal contributions are financing cash exactly once', async () => {
        records.journal_entries=[{id:'JV',date:'2026-01-02',debitAccount:'Cash / Bank',creditAccount:'Owner Capital',amount:100}];
        reportDates(); await api.Reports.generateCashFlow();
        assert.equal(metric('ENDING CASH & BANK BALANCE'),100);
        await api.Reports.generateBalanceSheet(); assert.equal(metric('Total Assets'),100); assert.equal(metric('Total Equity & Liabilities'),100);
    });
    console.log(JSON.stringify({meaning:'PASS = correct behavior verified',reproductions:results},null,2));
    if(results.some(r=>r.status!=='PASS')) process.exitCode=1;
})();
`;
vm.runInNewContext(setup + scenarios, { require, __dirname, console, structuredClone, process });
