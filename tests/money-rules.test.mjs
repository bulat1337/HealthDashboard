import test from 'node:test';
import assert from 'node:assert/strict';
import {readSavingsPlan, calculateSavings, savingsEvents, recordMoneyManualChanges, readMoneyManualAdjustments, moneyRentPaid} from '../scripts/money-rules.mjs';
import {readMoneyContext, buildMoneyRow, updateMoneyText} from '../scripts/zenmoney-money-sync.mjs';
import {fixture} from './fixtures/money-plan.mjs';

test('migration adds the fixed retrospective contribution and skips only 15 October', () => {
  const plan = readSavingsPlan(fixture);
  assert.deepEqual(calculateSavings(plan, [], '2026-10-04'), {bulatSavings:500000,dianaSavings:171667});
  assert.equal(calculateSavings(plan, [], '2026-10-10').bulatSavings,510000);
  assert.equal(calculateSavings(plan, [], '2026-10-25').bulatSavings,550000);
  assert.equal(calculateSavings(plan, [], '2026-10-15').dianaSavings,171667);
  assert.equal(calculateSavings(plan, [], '2026-10-30').dianaSavings,196667);
  const events = savingsEvents(plan, '2027-01-15').filter(e => e.participantId === 'diana');
  assert.deepEqual(events.filter(e => e.savingsAmount === 0).map(e => e.dateIso), ['2026-10-15']);
  assert.ok(events.filter(e => e.dateIso > '2026-10-15').every(e => e.savingsAmount === 25000));
  assert.equal(events.find(e => e.dateIso === '2026-12-15').savingsAmount,25000);
});

test('manual correction on the skipped payday carries forward and same-day refresh is idempotent', () => {
  const plan=readSavingsPlan(fixture);
  const manual={dateIso:'2026-10-15',bulatSavings:510000,dianaSavings:188890};
  assert.deepEqual(calculateSavings(plan,[manual],'2026-10-15'),{bulatSavings:510000,dianaSavings:188890});
  const next={dateIso:'2026-10-30',...calculateSavings(plan,[manual],'2026-10-30')};
  assert.deepEqual([next.bulatSavings,next.dianaSavings],[550000,213890]);
  assert.deepEqual(calculateSavings(plan,[manual,next],'2026-10-30'),{bulatSavings:550000,dianaSavings:213890});
});

test('missed salary dates carry forward once and manual savings edits persist', () => {
  const plan = readSavingsPlan(fixture);
  const initial = {dateIso:'2026-10-04',...calculateSavings(plan,[],'2026-10-04')};
  const late = {dateIso:'2026-10-31',...calculateSavings(plan,[initial],'2026-10-31')};
  assert.deepEqual([late.bulatSavings,late.dianaSavings],[550000,196667]);
  assert.deepEqual(calculateSavings(plan,[initial,late],'2026-10-31'), {bulatSavings:550000,dianaSavings:196667});
  late.bulatSavings += 3000;
  const november = calculateSavings(plan,[initial,late],'2026-11-30');
  assert.deepEqual([november.bulatSavings,november.dianaSavings],[633000,246667]);
});

test('day 30 falls on the last day of February, including leap years', () => {
  const plan=readSavingsPlan(fixture);
  assert.ok(savingsEvents(plan,'2027-02-28').some(e=>e.participantId==='diana' && e.dateIso==='2027-02-28'));
  assert.ok(savingsEvents(plan,'2028-02-29').some(e=>e.participantId==='diana' && e.dateIso==='2028-02-29'));
});

test('ZenMoney includes all card debts once, ignores old manual debt, and preserves history', () => {
  const base={accountSummary:{debitAccounts:[{balanceRub:1500000}],investmentAccounts:[{balanceRub:100000}],
    creditCardAccounts:[{balanceRub:-10000},{balanceRub:-3000},{balanceRub:500}]},config:{requiredCreditCardGroups:[]}};
  const row=buildMoneyRow({...base,moneyContext:readMoneyContext(fixture),targetDate:{day:4,iso:'2026-10-04',display:'04.10.26'}});
  assert.equal(row.totalAmount,1600000);
  assert.equal(row.creditCardDebt,13000);
  assert.equal(row.freeAmount,1500000-13000-500000-171667);
  assert.equal(row.reserveAmount,null);
  assert.equal(buildMoneyRow({...base,moneyContext:readMoneyContext(fixture.replace('Долг по кредиткам Дианы: 1000\n','')),
    targetDate:{day:4,iso:'2026-10-04'}}).creditCardDebt,13000);
  const once=updateMoneyText(fixture,row);
  const context=readMoneyContext(once);
  assert.equal(context.records[0].reserveAmount,750000);
  assert.equal(context.records[0].cells[context.table.headers.indexOf('Долг по кредиткам, руб')],'0');
  assert.equal(context.records[1].dianaSavings,171667);
  assert.equal(updateMoneyText(once,row),once);
  const tenth=buildMoneyRow({...base,moneyContext:context,targetDate:{day:10,iso:'2026-10-10',display:'10.10.26'}});
  assert.equal(tenth.bulatSavings,510000);
  assert.equal(tenth.freeAmount,1500000-13000-60000-510000-171667);
});

test('incomplete or contradictory plans fail instead of silently reverting to legacy accounting', () => {
  assert.equal(readSavingsPlan('legacy money file'),null);
  assert.throws(()=>readSavingsPlan('Начало раздельного учёта: 2026-10-04'));
  assert.throws(()=>readSavingsPlan(fixture.replace('10,25','10,10')));
  assert.throws(()=>readSavingsPlan(fixture.replace('| — | 0 |','| — | 5/9 |')));
  assert.throws(()=>readSavingsPlan(fixture.replace('| — | 0 |','| — | -1 |')));
});

test('early savings and rent edits survive refreshes, skip one payday and resume the regular calendar', () => {
  const base={accountSummary:{debitAccounts:[{balanceRub:1500000}],investmentAccounts:[],creditCardAccounts:[]},config:{requiredCreditCardGroups:[]}};
  for (const dateIso of ['2026-10-08', '2026-10-09']) {
    const plan=readSavingsPlan(fixture);
    const original={dateIso,...calculateSavings(plan,[] ,dateIso),rentPaid:true};
    let text=updateMoneyText(fixture,{...original,date:`${dateIso.slice(8)}.10.26`,totalAmount:1500000,
      investmentAmount:0,reserveAmount:null,creditCardDebt:0,freeAmount:828333,rentPaid:'да'});
    text=recordMoneyManualChanges(text,plan,original,{bulatSavings:510000,rentPaid:false});
    const build=iso=>buildMoneyRow({...base,moneyContext:readMoneyContext(text),targetDate:{iso,day:Number(iso.slice(8)),display:`${iso.slice(8)}.${iso.slice(5,7)}.26`}});
    const early=build(dateIso);
    assert.equal(early.bulatSavings,510000);
    assert.equal(early.rentPaid,'нет');
    assert.equal(early.freeAmount,1500000-510000-171667-60000);
    text=updateMoneyText(text,early);
    assert.equal(build('2026-10-10').bulatSavings,510000);
    text=updateMoneyText(text,build('2026-10-10'));
    assert.equal(build('2026-10-10').bulatSavings,510000);
    assert.equal(build('2026-10-25').bulatSavings,550000);
    assert.equal(build('2026-11-10').bulatSavings,590000);
    assert.equal(build('2026-11-01').rentPaid,'да');
    assert.equal(build('2026-11-10').rentPaid,'нет');
  }
});

test('manual payment status persists through the rental calendar and resets next month', () => {
  const original={dateIso:'2026-10-08',bulatSavings:500000,dianaSavings:171667,rentPaid:true};
  let text=recordMoneyManualChanges(fixture,readSavingsPlan(fixture),original,{rentPaid:false});
  assert.equal(moneyRentPaid(readMoneyManualAdjustments(text),'2026-10-09'),false);
  assert.equal(moneyRentPaid(readMoneyManualAdjustments(text),'2026-10-19'),false);
  text=recordMoneyManualChanges(text,readSavingsPlan(text),{...original,dateIso:'2026-10-17',rentPaid:false},{rentPaid:true});
  const state=readMoneyManualAdjustments(text);
  assert.equal(moneyRentPaid(state,'2026-10-16'),false);
  assert.equal(moneyRentPaid(state,'2026-10-17'),true);
  assert.equal(moneyRentPaid(state,'2026-10-18'),true);
  assert.equal(moneyRentPaid(state,'2026-11-10'),false);
  text=recordMoneyManualChanges(text,readSavingsPlan(text),{...original,dateIso:'2026-10-18',rentPaid:true},{rentPaid:null});
  assert.equal(moneyRentPaid(readMoneyManualAdjustments(text),'2026-10-18'),false);
  assert.equal(moneyRentPaid(readMoneyManualAdjustments(text),'2026-10-19'),true);
});

test('only changed fields consume a payday; an ordinary correction leaves future contributions scheduled', () => {
  const plan=readSavingsPlan(fixture);
  const original={dateIso:'2026-10-04',bulatSavings:500000,dianaSavings:171667,rentPaid:true};
  assert.equal(recordMoneyManualChanges(fixture,plan,original,original),fixture);
  let text=recordMoneyManualChanges(fixture,plan,original,{bulatSavings:501000,dianaSavings:171667,rentPaid:true});
  const state=readMoneyManualAdjustments(text);
  assert.deepEqual(state.savings[0].handledDates,[]);
  assert.equal(state.savings.length,1);
  assert.equal(calculateSavings(plan,[], '2026-10-10',state).bulatSavings,511000);
  assert.equal(recordMoneyManualChanges(text,plan,{...original,bulatSavings:501000},{bulatSavings:501000}),text);
});

test('early contributions respect February, year boundaries and separate participant schedules', () => {
  const plan=readSavingsPlan(fixture);
  for (const [dateIso,scheduledDate] of [['2027-02-26','2027-02-28'],['2028-02-27','2028-02-29']]) {
    const original={dateIso,...calculateSavings(plan,[],dateIso),rentPaid:true};
    const text=recordMoneyManualChanges(fixture,plan,original,{dianaSavings:original.dianaSavings+25000});
    const state=readMoneyManualAdjustments(text);
    assert.deepEqual(state.savings[0].handledDates,[scheduledDate]);
    assert.equal(calculateSavings(plan,[],scheduledDate,state).dianaSavings,original.dianaSavings+25000);
    assert.equal(calculateSavings(plan,[],`${Number(dateIso.slice(0,4))}-03-15`,state).dianaSavings,original.dianaSavings+50000);
  }
  const original={dateIso:'2026-12-28',...calculateSavings(plan,[],'2026-12-28'),rentPaid:true};
  const state=readMoneyManualAdjustments(recordMoneyManualChanges(fixture,plan,original,{dianaSavings:original.dianaSavings+25000}));
  assert.equal(calculateSavings(plan,[],'2027-01-15',state).dianaSavings,original.dianaSavings+50000);
});

test('latest manual anchor remains authoritative over snapshots already written after it', () => {
  const plan=readSavingsPlan(fixture);
  const original={dateIso:'2026-10-09',bulatSavings:500000,dianaSavings:171667,rentPaid:true};
  const state=readMoneyManualAdjustments(recordMoneyManualChanges(fixture,plan,original,{bulatSavings:510000}));
  const stale={dateIso:'2026-10-10',bulatSavings:520000,dianaSavings:171667};
  assert.equal(calculateSavings(plan,[stale],'2026-10-10',state).bulatSavings,510000);
  assert.equal(calculateSavings(plan,[stale],'2026-10-25',state).bulatSavings,550000);
});
