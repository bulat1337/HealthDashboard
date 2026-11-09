import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readInBodyData, saveInBodyMeasurement, validateInBodyInput } from '../server/inbody.js';
import { inbodyDate } from '../src/inbody-types.js';

const input = {
  userId:'A', measuredAtLocal:'2024-10-13T16:41', device:'InBody 570',
  metrics:{weightKg:60,skeletalMuscleKg:25,bodyFatKg:15,bodyFatPercent:25,score:78,ecwRatio:.375},
  segments:{rightArm:{leanKg:2,leanPercent:100,fatKg:1,fatPercent:95}},
  ranges:{weightKg:[45,70]},
  impedance:[{frequencyKhz:5,rightArm:410,trunk:25}],
  assessments:{'Жировая масса':'Норма'}, notes:'Source report',
};

test('InBody retains report values, partial impedance and the device wall-clock date', () => {
  const parsed=validateInBodyInput(input,['A','B']);
  assert.deepEqual(parsed,input);
  assert.equal(parsed.impedance?.[0].leftLeg,undefined);
  assert.match(inbodyDate(parsed.measuredAtLocal),/13 октября 2024.*16:41/);
  assert.equal(validateInBodyInput({...input,metrics:{...input.metrics,weightControlKg:-2}},['A']).metrics.weightControlKg,-2);
});

test('InBody rejects invalid dates, unknown people, invalid or missing measurements and ranges', () => {
  for (const value of [
    {...input,userId:'B'}, {...input,measuredAtLocal:'2024-02-30T16:41'}, {...input,measuredAtLocal:'2024-10-13T25:00'},
    {...input,metrics:{...input.metrics,bodyFatPercent:101}}, {...input,metrics:{...input.metrics,weightKg:NaN}},
    {...input,metrics:{...input.metrics,bodyFatKg:61}}, {...input,metrics:{weightKg:60}},
    {...input,metrics:JSON.parse('{"__proto__":2}')}, {...input,ranges:{weightKg:[70,45]}},
    {...input,segments:{rightArm:{leanKg:-1}}}, {...input,device:''},
  ]) assert.throws(()=>validateInBodyInput(value,['A']));
});

test('InBody persists independent histories and prevents duplicate or destructive saves', t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'inbody-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=path.join(dir,'records','inbody.json');
  assert.deepEqual(readInBodyData(file).measurements,[]);
  const original=validateInBodyInput(input,['A','B']);
  const first=saveInBodyMeasurement(file,original);
  assert.ok(first.id);
  saveInBodyMeasurement(file,{...original,userId:'B'});
  saveInBodyMeasurement(file,{...original,measuredAtLocal:'2026-01-01T10:00'});
  assert.equal(readInBodyData(file).measurements.length,3);
  assert.equal(readInBodyData(file).measurements.filter(row=>row.userId==='A').length,2);
  assert.deepEqual(readInBodyData(file).measurements.find(row=>row.id===first.id)?.metrics,input.metrics);
  const before=fs.readFileSync(file,'utf8');
  assert.throws(()=>saveInBodyMeasurement(file,original),/уже сохранено/);
  assert.equal(fs.readFileSync(file,'utf8'),before);
  fs.writeFileSync(file,'{invalid');
  assert.throws(()=>saveInBodyMeasurement(file,original));
  assert.equal(fs.readFileSync(file,'utf8'),'{invalid');
});
