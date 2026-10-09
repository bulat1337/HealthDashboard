import test, {type TestContext} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import {spawn} from "node:child_process";
// @ts-expect-error JavaScript fixture is intentionally shared with the sync tests.
import {fixture} from "./fixtures/money-plan.mjs";
// @ts-expect-error CLI helpers run directly in the integration fixture.
import {updateMoneyText, buildMoneyRow, readMoneyContext} from "../scripts/zenmoney-money-sync.mjs";

async function startMoneyServer(t: TestContext, text: string) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"money-api-"));
  const file=path.join(dir,"Money.md");
  fs.writeFileSync(file,text);
  fs.writeFileSync(path.join(dir,"health.json"),JSON.stringify({users:[],measurements:[]}));
  const port=await new Promise<number>(resolve=>{const probe=net.createServer();probe.listen(0,"127.0.0.1",()=>{const port=(probe.address() as net.AddressInfo).port;probe.close(()=>resolve(port));});});
  const proc=spawn(process.execPath,["--import","tsx","server/index.ts"],{env:{...process.env,
    PORT:String(port),HOST:"127.0.0.1",NODE_ENV:"production",MONEY_DATA_FILE:file,MONEY_SYNC_ENABLED:"false",
    HEALTH_DATA_DIR:dir,HEALTH_DATA_FILE:path.join(dir,"health.json"),SPORT_DATA_FILE:path.join(dir,"sport.json")},stdio:"ignore"});
  t.after(()=>{proc.kill();fs.rmSync(dir,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${port}`;
  for (let i=0;i<100;i++) {try{await fetch(base+"/api/status");break;}catch{await new Promise(resolve=>setTimeout(resolve,50));}}
  const get=async()=> (await (await fetch(base+"/api/health-data")).json()).data.money;
  const patch=async(endpoint:string,body:unknown)=>{
    const response=await fetch(base+"/api/money-data/"+endpoint,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
    return {status:response.status,body:await response.json()};
  };
  return {file,get,patch,base};
}

test("money API persists manual savings corrections, preserves history and enforces the new budget formula", async t => {
  let text=fixture;
  for (const [date,bulat,diana] of [["15",510000,171667],["30",550000,196667]] as const) {
    text=updateMoneyText(text,{date:`${date}.10.26`,dateIso:`2026-10-${date}`,totalAmount:1500000,
      investmentAmount:100000,reserveAmount:null,bulatSavings:bulat,dianaSavings:diana,
      creditCardDebt:1000,rentPaid:"да",freeAmount:1500000-100000-bulat-diana-1000});
  }
  const {file,get,patch,base}=await startMoneyServer(t,text);
  let money=await get();
  assert.equal(money.monthlyIncome,290000);
  assert.equal(money.savings.monthlySavings,130000);
  assert.equal('partnerCreditCardDebt' in money,false);
  assert.equal(money.records[0].reserveAmount,750000);
  assert.equal(money.records[1].dianaSavings,171667);
  const row=money.latestRecord.rowId;
  assert.equal((await fetch(base+"/api/money-data/salary",{method:"PATCH",headers:{"Content-Type":"application/json"},body:"{}"})).status,404);
  assert.equal((await fetch(base+"/api/money-data/partner",{method:"PATCH",headers:{"Content-Type":"application/json"},body:"{}"})).status,404);
  assert.equal((await patch(`records/${row}`,{dianaSavings:213890})).status,200);
  money=await get();
  assert.equal(money.latestRecord.dianaSavings,213890);
  assert.equal(money.latestRecord.freeAmount,635110);
  assert.equal(money.latestRecord.totalAmount,1500000);
  assert.equal(money.records[0].reserveAmount,750000);
  assert.equal(money.records[1].dianaSavings,171667);
  const saved=fs.readFileSync(file,"utf8");
  assert.equal((await patch(`records/${row}`,{dianaSavings:213890})).status,200);
  assert.equal(fs.readFileSync(file,"utf8"),saved);
  assert.equal((await patch(`records/${row}`,{investmentAmount:110000})).status,200);
  money=await get();
  assert.equal(money.latestRecord.totalAmount,1510000);
  assert.equal(money.latestRecord.freeAmount,635110);
  assert.equal((await patch(`records/${row}`,{bulatSavings:560000})).status,200);
  assert.equal((await get()).latestRecord.freeAmount,625110);
  assert.equal((await patch(`records/${row}`,{freeAmount:-100})).status,200);
  assert.equal((await get()).latestRecord.totalAmount,884790);
  assert.equal((await patch(`records/${row}`,{dianaSavings:-1})).status,400);
  assert.equal((await patch(`records/${row}`,{dateIso:"2026-09-01"})).status,400);
});

test("snapshot editor preserves early salary and rent edits through ZenMoney sync and a restart", async t => {
  const accounts={accountSummary:{debitAccounts:[{balanceRub:1500000}],investmentAccounts:[{balanceRub:100000}],
    creditCardAccounts:[{balanceRub:-1000}]},config:{requiredCreditCardGroups:[]}};
  const build=(text:string,iso:string)=>buildMoneyRow({...accounts,moneyContext:readMoneyContext(text),
    targetDate:{iso,day:Number(iso.slice(8)),display:`${iso.slice(8)}.${iso.slice(5,7)}.26`}});
  const text=updateMoneyText(fixture,build(fixture,"2026-10-09"));
  const {file,get,patch}=await startMoneyServer(t,text);
  const original=(await get()).latestRecord;
  // The UI submits all fields, including unchanged Diana savings and rent.
  const request={dateIso:original.dateIso,totalAmount:original.totalAmount,investmentAmount:original.investmentAmount,
    reserveAmount:null,creditCardDebt:original.creditCardDebt,bulatSavings:510000,dianaSavings:original.dianaSavings,rentPaid:false};
  assert.equal((await patch(`records/${original.rowId}`,request)).status,200);
  let saved=fs.readFileSync(file,"utf8");
  const sameDay=build(saved,"2026-10-09");
  assert.equal(sameDay.bulatSavings,510000);
  assert.equal(sameDay.dianaSavings,original.dianaSavings);
  assert.equal(sameDay.rentPaid,"нет");
  assert.equal(sameDay.freeAmount,1500000-510000-original.dianaSavings-1000-60000);
  assert.equal((await patch(`records/${original.rowId}`,request)).status,200);
  assert.equal(fs.readFileSync(file,"utf8"),saved);
  saved=updateMoneyText(saved,sameDay);
  const payday=build(saved,"2026-10-10");
  assert.equal(payday.bulatSavings,510000);
  assert.equal(payday.rentPaid,"нет");
  saved=updateMoneyText(saved,payday);
  assert.equal(build(saved,"2026-10-25").bulatSavings,550000);
  fs.writeFileSync(file,saved);
  const restarted=await startMoneyServer(t,fs.readFileSync(file,"utf8"));
  assert.equal((await restarted.get()).latestRecord.bulatSavings,510000);
  assert.equal((await restarted.get()).latestRecord.rentPaid,false);
  const row=(await restarted.get()).latestRecord.rowId;
  assert.equal((await restarted.patch(`records/${row}`,{rentPaid:true})).status,200);
  saved=fs.readFileSync(restarted.file,"utf8");
  assert.equal(build(saved,"2026-10-18").rentPaid,"да");
  assert.equal(build(saved,"2026-11-10").rentPaid,"нет");
});
