import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ingestScaleMeasurement, repairScaleDuplicates } from '../server/health-ingest.ts';

function fixture(t: any) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scale-test-'));
  t.after(() => fs.rmSync(dataDir, {recursive: true, force: true}));
  const dataFile = path.join(dataDir, 'data.json');
  fs.writeFileSync(dataFile, JSON.stringify({users:[{name:'A'}, {name:'B'}], measurements:[]}));
  return {dataDir,dataFile};
}
const payload = {user:'A',weight:65,impedance:470,impedanceLow:420,source_app:'Xiaomi S400 BLE bridge', timestamp:'2026-09-01T10:00:00Z'};
test('unchanged BLE rebroadcast after six hours and restart is a duplicate', t => {
  const options = fixture(t);
  ingestScaleMeasurement(payload, options);
  const r = ingestScaleMeasurement({...payload,timestamp:'2026-09-03T10:00:00Z'}, options);
  assert.equal(r.duplicate,true); assert.equal(r.measurementCount,1);
  assert.equal(r.measurement.measured_at_unix_seconds, Date.parse(payload.timestamp)/1000);
});
test('distinct device ids preserve identical new measurements; same id is idempotent', t => {
  const o=fixture(t);
  ingestScaleMeasurement({...payload,source_measurement_id:'one'},o);
  assert.equal(ingestScaleMeasurement({...payload,source_measurement_id:'two'},o).duplicate,false);
  assert.equal(ingestScaleMeasurement({...payload,source_measurement_id:'one', timestamp:'2026-09-05T00:00:00Z'},o).duplicate,true);
});
test('separate profiles and different impedances at the same weight survive', t=>{
  const o=fixture(t); ingestScaleMeasurement(payload,o);
  assert.equal(ingestScaleMeasurement({...payload,user:'B'},o).duplicate,false);
  assert.equal(ingestScaleMeasurement({...payload,impedance:471,timestamp:'2026-09-01T10:00:10Z'},o).duplicate,false);
});
test('full report preserves supplied values and can enrich an incomplete record', t=>{
  const o=fixture(t); ingestScaleMeasurement({user:'A',weight:65,timestamp:payload.timestamp},o);
  const r=ingestScaleMeasurement({...payload,body_fat_percent:20,fat_mass_kg:12.9,xiaomi_home_full_report:true},o);
  assert.equal(r.duplicate,true); assert.equal(r.measurement.metrics?.fat_mass_kg,12.9);
});
test('invalid weights, unknown users, invalid timezone and huge timestamps fail before writes',t=>{
  const o=fixture(t), before=fs.readFileSync(o.dataFile,'utf8');
  for (const patch of [{weight:-1},{user:'typo'},{timezone:'bad/zone'},{measured_at_unix_seconds:1e100}]) {
    assert.throws(()=>ingestScaleMeasurement({...payload,...patch},o),{statusCode:400});
  }
  assert.equal(fs.readFileSync(o.dataFile,'utf8'),before);
});
test('legacy repair backs up original, removes repetitions and is idempotent',t=>{
  const o=fixture(t); ingestScaleMeasurement(payload,o);
  const raw=JSON.parse(fs.readFileSync(o.dataFile,'utf8'));
  const copy=structuredClone(raw.measurements[0]);copy.measured_at_unix_seconds+=21600;raw.measurements.push(copy);
  fs.writeFileSync(o.dataFile,JSON.stringify(raw));
  assert.deepEqual(repairScaleDuplicates(o,true),{before:2,after:1,removed:1});
  assert.equal(fs.readdirSync(o.dataDir).filter(x=>x.includes('.backup-')).length,1);
  assert.equal(repairScaleDuplicates(o,true).removed,0);
});

test('timestamps without offsets respect the provided timezone', t=>{
  const o=fixture(t);
  const r=ingestScaleMeasurement({...payload,timestamp:'2026-09-01 10:00:00',timezone:'UTC'},o);
  assert.equal(r.measurement.measured_at_unix_seconds,Date.parse('2026-09-01T10:00:00Z')/1000);
});

test('an exact historical timestamp identifies replay even if legacy raw fields were stale',t=>{
  const o=fixture(t);ingestScaleMeasurement(payload,o);
  assert.equal(ingestScaleMeasurement({...payload,impedanceLow:421},o).duplicate,true);
});
