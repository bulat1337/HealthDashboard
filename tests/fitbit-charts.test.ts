import assert from "node:assert/strict";
import test from "node:test";
import { personalSleepRange, segmentMinutes, sleepClock, sleepQuality } from "../src/fitbit-charts.js";
import { emptyDay } from "../server/fitbit-data.js";
import type { FitbitSleep } from "../src/fitbit-types.js";
const sleep: FitbitSleep = { start: "2026-11-01T21:24:00Z", end: "2026-11-02T05:28:00Z", bedtime: "00:24", wakeTime: "08:28", minutesAsleep: 472, minutesAwake: 12, stages: { DEEP: 78 }, processed: true };

test("sleep graphics preserve unknown quality values and distinguish explicit zero", () => {
  assert.deepEqual(sleepQuality(sleep), { latency: null, deep: 78, restless: null, breaks: null });
  assert.deepEqual(sleepQuality({ ...sleep, minutesToFallAsleep: 0, outOfBed: [], stages: { RESTLESS: 0 } }), { latency: 0, deep: null, restless: 0, breaks: 0 });
  assert.equal(sleepClock(sleep, Date.parse(sleep.start)), "00:24");
  assert.equal(sleepClock(sleep, Date.parse(sleep.end)), "08:28");
});

test("overlapping sleep interruptions are counted once", () => {
  assert.equal(segmentMinutes([
    { start: "2026-11-02T01:00Z", end: "2026-11-02T01:05Z" },
    { start: "2026-11-02T01:03Z", end: "2026-11-02T01:10Z" },
    { start: "bad", end: "2026-11-02T01:10Z" },
  ]), 10);
});

test("personal sleep ranges use past nights, require seven values and exclude selected/future dates", () => {
  const days = Array.from({ length: 12 }, (_, index) => ({ ...emptyDay(`2026-11-${String(index + 1).padStart(2, "0")}`), sleep: { ...sleep, minutesToFallAsleep: index * 10 } }));
  assert.equal(personalSleepRange(days, "2026-11-07", "latency"), null);
  const range = personalSleepRange(days, "2026-11-08", "latency")!;
  assert.equal(range.nights, 7);
  assert.ok(Math.abs(range.min - 6) < 0.0001);
  assert.equal(range.max, 54);
  assert.equal(personalSleepRange(days, "2026-12-20", "latency"), null);
});
