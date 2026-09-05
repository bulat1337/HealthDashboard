import test from 'node:test';
import assert from 'node:assert/strict';
import {zenmoneyJson, buildMoneyRow, classifyAccounts} from '../scripts/zenmoney-money-sync.mjs';
test('401 is retried at most once',async t=>{
  const original=global.fetch; let calls=0;
  global.fetch=async()=>{calls++;return new Response('{}',{status:401});};
  t.after(()=>{global.fetch=original;});
  await assert.rejects(zenmoneyJson('/v8/diff/',{}, {access_token:'test',refresh_token:'test'}));
  assert.ok(calls<=2);
});
test('rent is unpaid through 18th and paid on 19th; reserve top-up only once on 25th',()=>{
  const base={moneyContext:{partnerCreditCardDebt:0,partnerMoney:0,rentMonthly:60000,records:[],previousReserveAmount:100000},accountSummary:{debitAccounts:[{balanceRub:500000}],investmentAccounts:[],creditCardAccounts:[]},config:{requiredCreditCardGroups:[]}};
  assert.equal(buildMoneyRow({...base,targetDate:{day:18,iso:'2026-09-18'}}).rentPaid,'нет');
  assert.equal(buildMoneyRow({...base,targetDate:{day:19,iso:'2026-09-19'}}).rentPaid,'да');
  assert.equal(buildMoneyRow({...base,targetDate:{day:25,iso:'2026-09-25'}}).reserveAmount,200000);
  base.moneyContext.records=[{dateIso:'2026-09-24',reserveAmount:100000},{dateIso:'2026-09-25',reserveAmount:200000}];
  assert.equal(buildMoneyRow({...base,targetDate:{day:25,iso:'2026-09-25'}}).reserveAmount,200000);
});
test('excluded investments and positive credit card balances are not counted as debit',()=>{
  const data={accounts:[{id:'investment',active:true,type:'checking',balanceRub:100},{id:'card',active:true,type:'ccard',balanceRub:200,creditLimitRub:1000}]};
  const result=classifyAccounts(data,{investmentAccountIds:['investment'],excludeAccountIds:['investment']});
  assert.equal(result.debitAccounts.length,0);assert.equal(result.investmentAccounts.length,0);
});
test('invalid calendar dates are rejected',async()=>{
  const {dateFromFlag}=await import('../scripts/zenmoney-money-sync.mjs');
  assert.throws(()=>dateFromFlag('2026-02-31','UTC'));
});

test('ZenMoney debit cards with ccard type remain included',()=>{
  const result=classifyAccounts({accounts:[{id:'debit',active:true,type:'ccard',balanceRub:200,creditLimitRub:0}]},{});
  assert.equal(result.debitAccounts.length,1);
});
