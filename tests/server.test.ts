import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {WebSocket} from 'ws';

test('API ingestion, atomic sport edits, websocket updates, origin checks, and missing-data recovery', async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dashboard-api-'));
  const health=path.join(dir,'xiaomi-body-scale-data.json'),sport=path.join(dir,'sport.json');
  const port=await new Promise<number>(resolve=>{const probe=net.createServer();probe.listen(0,'127.0.0.1',()=>{const n=(probe.address() as net.AddressInfo).port;probe.close(()=>resolve(n));});});
  const proc=spawn(process.execPath,['--import','tsx','server/index.ts'],{env:{...process.env,PORT:String(port),HOST:'127.0.0.1',NODE_ENV:'production',HEALTH_DATA_DIR:dir,HEALTH_DATA_FILE:health,MONEY_DATA_FILE:path.join(dir,'Money.md'),SPORT_DATA_FILE:sport,MONEY_SYNC_ENABLED:'false',HEALTH_INGEST_TOKEN:'test',HEALTH_DEFAULT_TIMEZONE:'UTC'},stdio:'ignore'});
  t.after(()=>{proc.kill();fs.rmSync(dir,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${port}`;
  for(let i=0;i<100;i++) {try{await fetch(base+'/api/status');break;}catch{await new Promise(r=>setTimeout(r,50));}}
  assert.equal((await (await fetch(base+'/api/status')).json()).ok,false);
  fs.writeFileSync(health,JSON.stringify({users:[{name:'A'}],measurements:[]}));
  // The service remains up when the data file is absent at startup, and recovers on arrival.
  for(let i=0;i<40;i++){if((await fetch(base+'/api/health-data')).ok)break;await new Promise(r=>setTimeout(r,50));}
  assert.equal((await fetch(base+'/api/missing')).status,404);
  const socket=new WebSocket(base.replace('http','ws')+'/ws');
  t.after(()=>socket.terminate());
  const messages: any[]=[];socket.on('message',raw=>messages.push(JSON.parse(String(raw))));
  await new Promise<void>(r=>socket.on('open',()=>r()));
  const send=(body: unknown,token='test')=>fetch(base+'/api/health-data/measurements',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify(body)});
  assert.equal((await send({weight:65},'wrong')).status,401);
  const body={user:'A',weight:65,impedance:470,impedanceLow:420,source_app:'Xiaomi S400 BLE bridge',timestamp:'2026-09-01T00:00:00Z'};
  assert.equal((await send(body)).status,201);
  assert.equal((await send({...body,timestamp:'2026-09-02T00:00:00Z'})).status,200);
  assert.equal((await (await fetch(base+'/api/health-data')).json()).data.measurements.length,1);
  const sportBody={userId:'bulat',date:'2026-09-05',activities:['run'],runDistanceKm:5};
  assert.equal((await fetch(base+'/api/sport-data/day',{method:'PATCH',headers:{'Content-Type':'application/json',Origin:'https://example.org'},body:JSON.stringify(sportBody)})).status,403);
  const saved=await fetch(base+'/api/sport-data/day',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(sportBody)});
  assert.equal(saved.status,200);
  assert.equal(JSON.parse(fs.readFileSync(sport,'utf8')).users.bulat.entries['2026-09-05'].runDistanceKm,5);
  const editSport = (body: unknown) => fetch(base+'/api/sport-data/day', {
    method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)
  });
  const sickDay = {userId:'bulat', date:'2026-09-06', activities:[], sick:true};
  assert.equal((await editSport({...sickDay, sick:'true'})).status,400);
  assert.equal((await editSport(sickDay)).status,200);
  const readEntries = async (id: string) => (await (await fetch(base+'/api/sport-data')).json()).data.users.find((user: any)=>user.id===id).entries;
  assert.equal((await readEntries('bulat')).find((entry: any)=>entry.date===sickDay.date).sick,true);
  assert.equal((await readEntries('diana')).length,0);
  const persisted = JSON.parse(fs.readFileSync(sport,'utf8'));
  assert.equal(persisted.schemaVersion,4);
  assert.equal(persisted.users.bulat.entries[sickDay.date].sick,true);
  assert.equal(persisted.users.bulat.entries[sportBody.date].runDistanceKm,5);
  // Toggling the exclusion keeps any existing workout details intact.
  assert.equal((await editSport({...sportBody,sick:true})).status,200);
  assert.equal((await readEntries('bulat')).find((entry: any)=>entry.date===sportBody.date).runDistanceKm,5);
  assert.equal((await editSport({...sportBody,sick:false})).status,200);
  assert.equal((await readEntries('bulat')).find((entry: any)=>entry.date===sportBody.date).sick,false);
  assert.equal((await editSport({...sickDay,sick:false})).status,200);
  assert.ok(!(await readEntries('bulat')).some((entry: any)=>entry.date===sickDay.date));
  assert.equal(JSON.parse(fs.readFileSync(sport,'utf8')).users.bulat.entries[sickDay.date],undefined);
  await new Promise(r=>setTimeout(r,100));
  assert.ok(messages.some(m=>m.type==='health-data-updated'));
  assert.ok(messages.some(m=>m.type==='sport-data-updated'));
});
