import assert from "node:assert/strict";
import test from "node:test";
import {
  dateString,
  emptyDay,
  mergeFitbitData,
  numeric,
} from "../server/fitbit-data.js";

const range = ["2026-11-01", "2026-11-03", "Europe/Moscow"] as const;
const date = { year: 2026, month: 11, day: 2 };
const blank = { days: [], exercises: [] };

test("Fitbit preserves explicit zeros and missing values; converts v4 units", () => {
  const data = mergeFitbitData(
    blank,
    [
      {
        source: "steps",
        points: [{ civilStartTime: { date }, steps: { countSum: "0" } }],
      },
      {
        source: "distance",
        points: [
          { civilStartTime: { date }, distance: { millimetersSum: "3450000" } },
        ],
      },
      {
        source: "active-zone-minutes",
        points: [
          {
            civilStartTime: { date },
            activeZoneMinutes: {
              sumInFatBurnHeartZone: "10",
              sumInCardioHeartZone: "20",
              sumInPeakHeartZone: "0",
            },
          },
        ],
      },
      {
        source: "daily-heart-rate-variability",
        points: [
          {
            dailyHeartRateVariability: {
              date,
              averageHeartRateVariabilityMilliseconds: 42.5,
            },
          },
        ],
      },
      {
        source: "daily-sleep-temperature-derivations",
        points: [
          {
            dailySleepTemperatureDerivations: {
              date,
              nightlyTemperatureCelsius: 34.5,
            },
          },
        ],
      },
    ],
    ...range,
  );
  assert.equal(data.days[1].steps, 0);
  assert.equal(data.days[1].distanceKm, 3.45);
  assert.equal(data.days[1].activeZoneMinutes, 30);
  assert.equal(data.days[1].hrv, 42.5);
  assert.equal(data.days[1].temperatureDeviation, null);
  assert.equal(data.days[0].steps, null);
  assert.equal(numeric(null), null);
  assert.equal(numeric(""), null);
  assert.equal(numeric("no"), null);
  assert.equal(dateString({ year: 2026, month: 99, day: 1 }), null);
});

test("Fitbit sleep belongs to waking civil date and uses true sleep minutes", () => {
  const main = {
    interval: {
      startTime: "2026-11-01T21:00:00Z",
      endTime: "2026-11-02T05:00:00Z",
      civilStartTime: {
        date: { year: 2026, month: 11, day: 2 },
        time: { hours: 0 },
      },
      civilEndTime: { date, time: { hours: 8 } },
    },
    metadata: { mainSleep: true, processed: true },
    summary: {
      minutesAsleep: "430",
      minutesInSleepPeriod: "480",
      minutesAwake: "50",
      stagesSummary: [
        { type: "DEEP", minutes: "90" },
        { type: "LIGHT", minutes: "250" },
        { type: "REM", minutes: "90" },
        { type: "AWAKE", minutes: "50" },
      ],
    },
  };
  const nap = {
    ...main,
    metadata: { mainSleep: false },
    summary: { minutesAsleep: "60" },
  };
  const data = mergeFitbitData(
    blank,
    [{ source: "sleep", points: [{ sleep: main }, { sleep: nap }] }],
    ...range,
  );
  assert.equal(data.days[0].sleep, null);
  assert.equal(data.days[1].sleep?.minutesAsleep, 430);
  assert.equal(data.days[1].sleep?.stages.DEEP, 90);
  assert.equal(data.days[1].sleep?.bedtime, "00:00");
  assert.equal(data.days[1].sleep?.wakeTime, "08:00");
});

test("Fitbit source UTC offset preserves day during travel", () => {
  const data = mergeFitbitData(
    blank,
    [
      {
        source: "sleep",
        points: [
          {
            sleep: {
              interval: {
                startTime: "2026-11-01T12:00:00Z",
                endTime: "2026-11-01T20:00:00Z",
                endUtcOffset: "18000s",
              },
              summary: { minutesAsleep: "400" },
            },
          },
        ],
      },
    ],
    ...range,
  );
  assert.equal(data.days[1].sleep?.minutesAsleep, 400);
  assert.equal(data.days[1].sleep?.wakeTime, "01:00");
  assert.equal(data.days[0].sleep, null);
});

test("Fitbit refresh removes corrected/deleted rows and retains failed sources and older history", () => {
  const old = {
    days: [
      { ...emptyDay("2026-10-30"), steps: 99 },
      { ...emptyDay("2026-11-01"), steps: 100, hrv: 40 },
    ],
    exercises: [],
  };
  const data = mergeFitbitData(
    old,
    [{ source: "steps", points: [] }],
    ...range,
  );
  assert.equal(data.days[0].steps, 99);
  assert.equal(data.days[1].steps, null);
  assert.equal(data.days[1].hrv, 40);
});

test("Fitbit exercises are replaced idempotently with reconciled resource IDs", () => {
  const points = [
    {
      dataPointName: "users/1/dataTypes/exercise/dataPoints/run-one",
      exercise: {
        exerciseType: "RUNNING",
        displayName: "Run",
        interval: {
          startTime: "2026-11-02T07:00:00Z",
          endTime: "2026-11-02T07:30:00Z",
          civilStartTime: { date },
        },
        metricsSummary: {
          distanceMillimeters: 5_000_000,
          caloriesKcal: 300,
          averageHeartRateBeatsPerMinute: "140",
        },
      },
    },
  ];
  const first = mergeFitbitData(
    blank,
    [{ source: "exercise", points }],
    ...range,
  );
  const second = mergeFitbitData(
    first,
    [{ source: "exercise", points }],
    ...range,
  );
  assert.equal(second.exercises.length, 1);
  assert.equal(second.exercises[0].distanceKm, 5);
  assert.equal(second.exercises[0].durationMinutes, 30);
  assert.equal(second.exercises[0].id, points[0].dataPointName);
  assert.deepEqual(second.exercises[0].dataPoint, points[0]);
  assert.equal(
    mergeFitbitData(second, [{ source: "exercise", points: [] }], ...range)
      .exercises.length,
    0,
  );
});

test("Fitbit retains real sleep intervals, clips invalid segments and preserves missing quality data", () => {
  const sleep = {
    interval: { startTime: "2026-11-01T21:00:00Z", endTime: "2026-11-02T05:00:00Z", civilEndTime: { date } },
    stages: [
      { startTime: "2026-11-01T20:59:00Z", endTime: "2026-11-01T21:10:00Z", type: "AWAKE" },
      { startTime: "2026-11-01T21:10:00Z", endTime: "2026-11-02T05:05:00Z", type: "LIGHT" },
      { startTime: "bad", endTime: "2026-11-01T22:00:00Z", type: "DEEP" },
      { startTime: "2026-11-01T23:00:00Z", endTime: "2026-11-01T22:00:00Z", type: "REM" },
      { startTime: "2026-11-01T22:00:00Z", endTime: "2026-11-01T23:00:00Z", type: "UNKNOWN" },
    ],
    shortAwakenings: [{ startTime: "2026-11-02T01:00:00Z", endTime: "2026-11-02T01:01:00Z", type: "AWAKE" }],
    outOfBedSegments: [],
    summary: { minutesToFallAsleep: "0", minutesAsleep: "470" },
  };
  const result = mergeFitbitData(blank, [{ source: "sleep", points: [{ sleep }] }], ...range).days[1].sleep!;
  assert.equal(result.timeline?.length, 2);
  assert.equal(result.timeline?.[0].start, sleep.interval.startTime.replace("Z", ".000Z"));
  assert.equal(result.timeline?.[1].end, sleep.interval.endTime.replace("Z", ".000Z"));
  assert.equal(result.shortAwakenings?.length, 1);
  assert.deepEqual(result.outOfBed, []);
  assert.equal(result.minutesToFallAsleep, 0);
  const missing = mergeFitbitData(blank, [{ source: "sleep", points: [{ sleep: { interval: sleep.interval } }] }], ...range).days[1].sleep!;
  assert.equal(missing.outOfBed, undefined);
  assert.equal(missing.minutesToFallAsleep, null);
});

test("Fitbit minute pulse retains extrema, civil travel time, source zones, and source refresh windows", () => {
  const point = (time: string, bpm: unknown, utcOffset = "18000s") => ({ heartRate: {
    sampleTime: { physicalTime: time, utcOffset }, beatsPerMinute: bpm,
  } });
  const results = [{ source: "heart-rate" as const, points: [
    point("2026-11-01T20:10:05Z", "60"), point("2026-11-01T20:10:30Z", "90"),
    point("2026-11-01T20:12:00Z", "70"), point("invalid", 60),
    point("2026-11-01T20:15:00Z", 0), point("2026-11-01T20:16:00Z", 301),
  ] }, { source: "daily-heart-rate-zones" as const, points: [{ dailyHeartRateZones: { date, heartRateZones: [
    { heartRateZoneType: "MODERATE", minBeatsPerMinute: "112", maxBeatsPerMinute: "137" },
    { heartRateZoneType: "UNKNOWN", minBeatsPerMinute: "0", maxBeatsPerMinute: "300" },
  ] } }] }];
  const result = mergeFitbitData(blank, results, ...range);
  const pulse = result.days[1].heartRate!;
  assert.equal(pulse.length, 2);
  assert.equal(pulse[0].minute, 70);
  assert.equal(pulse[0].bpm, 75);
  assert.equal(pulse[0].min, 60);
  assert.equal(pulse[0].max, 90);
  assert.equal(pulse[0].count, 2);
  assert.deepEqual(result.days[1].heartRateZones, [{ type: "MODERATE", min: 112, max: 137 }]);
  assert.deepEqual(mergeFitbitData(result, results, ...range).days[1].heartRate, pulse);
  const refreshed = mergeFitbitData(result, [{ source: "heart-rate", points: [], windowStart: "2026-11-03" }], "2026-11-01", "2026-11-04", "Europe/Moscow");
  assert.deepEqual(refreshed.days[1].heartRate, pulse);
  assert.equal(refreshed.days[2].heartRate, null);
  const failed = mergeFitbitData(result, [{ source: "steps", points: [] }], ...range);
  assert.deepEqual(failed.days[1].heartRate, pulse);
});
