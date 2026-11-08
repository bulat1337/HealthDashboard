import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fitbitSportActivity, mergeSportFitbitEntries, migrateSportWalkingFile, readFitbitSportWorkouts, syncFitbitSportFile } from "../server/sport-fitbit.js";
import type { SportActivityKey, SportEntry } from "../src/types.js";
import type { FitbitExercise } from "../src/fitbit-types.js";

const allowed: SportActivityKey[] = ["run", "strength_whole", "strength_upper", "yoga", "pilates", "cycling", "sup", "pull_ups", "push_ups"];
const exercise = (overrides: Partial<FitbitExercise> = {}): FitbitExercise => ({
  id: "session-1", date: "2026-11-08", start: "2026-11-08T06:00:00Z", label: "Morning run", type: "RUNNING",
  durationMinutes: 25, distanceKm: 3.14, calories: 250, averageHeartRate: 135,
  dataPoint: { name: "session-1", exercise: { exerciseType: "RUNNING", splitSummaries: [{ metricsSummary: { steps: "4100" } }], metadata: { customField: "preserved" } } },
  ...overrides,
});
function storage(t: { after: (fn: () => void) => void }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sport-fitbit-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "sport.json");
  const read = () => JSON.parse(fs.readFileSync(file, "utf8"));
  return { file, read };
}

test("Fitbit maps only catalogued types; walks and generic workouts are excluded regardless of name", () => {
  for (const type of ["WALKING", "TREADMILL_WALK", "STROLLER_WALK", "HIKING", "WALK_WITH_WEIGHTS", "WORKOUT", "OTHER", "SWIMMING"]) {
    assert.equal(fitbitSportActivity(exercise({ type, label: "Running strength yoga" }), allowed), null, type);
  }
  for (const [type, key] of [["RUNNING", "run"], ["TRAIL_RUN", "run"], ["TREADMILL", "run"], ["INCLINE_RUN", "run"], ["STRENGTH_TRAINING", "strength_whole"], ["WEIGHTLIFTING", "strength_whole"], ["YOGA", "yoga"], ["PILATES", "pilates"], ["BIKING", "cycling"], ["STATIONARY_BIKE", "cycling"], ["MOUNTAIN_BIKE", "cycling"], ["PADDLEBOARDING", "sup"]]) {
    assert.equal(fitbitSportActivity(exercise({ type }), allowed), key);
  }
  assert.equal(fitbitSportActivity(exercise(), ["yoga"]), null);
});

test("Walking migration replaces all old formats with 3.14 km runs once and backs up the original", (t) => {
  const { file, read } = storage(t);
  const original = JSON.stringify({ schemaVersion: 4, users: {
    bulat: { extra: "keep", entries: {
      "2026-11-01": ["walking"],
      "2026-11-02": { activities: ["walking", "run", "pull_ups"], runDistanceKm: 8, maxReps: { pullUps: 12 }, sick: true },
      "2026-11-03": { activities: ["run"], runDistanceKm: 5 },
    } }, diana: { entries: { "2026-11-01": ["yoga", "walking"] } },
  } });
  fs.writeFileSync(file, original);
  assert.equal(migrateSportWalkingFile(file), 3);
  assert.equal(fs.readFileSync(`${file}.before-walking-to-run.bak`, "utf8"), original);
  const migrated = read();
  assert.deepEqual(migrated.users.bulat.entries["2026-11-02"], { activities: ["run", "pull_ups"], runDistanceKm: 3.14, maxReps: { pullUps: 12 }, sick: true });
  assert.equal(migrated.users.diana.entries["2026-11-01"].runDistanceKm, 3.14);
  assert.equal(migrated.users.bulat.entries["2026-11-03"].runDistanceKm, 5);
  assert.equal(migrated.users.bulat.extra, "keep");
  assert.equal(migrateSportWalkingFile(file), 0);
});

test("Calendar sync is idempotent, isolates people, preserves all provider fields and manual history", (t) => {
  const { file, read } = storage(t);
  fs.writeFileSync(file, JSON.stringify({ schemaVersion: 4, users: { bulat: { entries: { "2026-11-08": ["yoga"] } } } }));
  const run = exercise(), strength = exercise({ id: "strength", type: "STRENGTH_TRAINING" });
  assert.equal(syncFitbitSportFile(file, "bulat", [run, run, strength, exercise({ id: "walk", type: "WALKING" })], allowed), true);
  assert.equal(syncFitbitSportFile(file, "bulat", [run, strength], allowed), false);
  assert.equal(read().users.bulat.fitbitWorkouts.length, 2);
  assert.deepEqual(read().users.bulat.fitbitWorkouts[0].exercise.dataPoint, run.dataPoint);
  assert.deepEqual(read().users.bulat.entries["2026-11-08"], ["yoga"]);
  syncFitbitSportFile(file, "diana", [exercise({ distanceKm: 7 })], allowed);
  assert.equal(read().users.diana.fitbitWorkouts[0].exercise.distanceKm, 7);
  assert.equal(read().users.bulat.fitbitWorkouts[0].exercise.distanceKm, 3.14);
  syncFitbitSportFile(file, "bulat", [exercise({ distanceKm: 4 })], allowed);
  assert.equal(read().users.bulat.fitbitWorkouts.length, 2);
  assert.equal(read().users.bulat.fitbitWorkouts[0].exercise.distanceKm, 4);
});

test("Successful source windows remove deleted or reclassified sessions; older calendar history survives", (t) => {
  const { file, read } = storage(t);
  const old = exercise({ id: "old", date: "2025-01-01", start: "2025-01-01T06:00:00Z" });
  syncFitbitSportFile(file, "bulat", [old, exercise()], allowed);
  syncFitbitSportFile(file, "bulat", [exercise({ type: "WALKING" })], allowed, { start: "2026-11-01", end: "2026-11-09" });
  assert.deepEqual(read().users.bulat.fitbitWorkouts.map((x: any) => x.exercise.id), ["old"]);
  syncFitbitSportFile(file, "bulat", [exercise()], allowed);
  syncFitbitSportFile(file, "bulat", [], allowed, { start: "2026-11-01", end: "2026-11-09" });
  assert.equal(read().users.bulat.fitbitWorkouts.length, 1);
});

test("Day projection combines multiple Fitbit sessions with independent manual edits and mileage", () => {
  const workouts = readFitbitSportWorkouts({ fitbitWorkouts: [
    { source: "fitbit", activityKey: "run", exercise: exercise() },
    { source: "fitbit", activityKey: "run", exercise: exercise({ id: "second", distanceKm: 2 }) },
    { source: "fitbit", activityKey: "strength_whole", exercise: exercise({ id: "strength", type: "STRENGTH_TRAINING" }) },
  ] }, allowed);
  const base: SportEntry = { date: "2026-11-08", activities: ["strength_upper"], sick: true, runDistanceKm: null, maxReps: { pullUps: null, pushUps: null } };
  const [day] = mergeSportFitbitEntries([base], workouts);
  assert.deepEqual(day.manualActivities, ["strength_upper"]);
  assert.deepEqual(day.activities, ["strength_upper", "run"]);
  assert.equal(day.sick, true);
  assert.equal(day.runDistanceKm, 5.14);
  assert.equal(day.fitbitWorkouts?.length, 3);
  const [manualDistance] = mergeSportFitbitEntries([{ ...base, activities: ["run"], runDistanceKm: 6 }], workouts);
  assert.equal(manualDistance.runDistanceKm, 6);
  const [autoOnly] = mergeSportFitbitEntries([], workouts);
  assert.deepEqual(autoOnly.manualActivities, []);
  assert.deepEqual(autoOnly.activities, ["run", "strength_whole"]);
  assert.deepEqual(base.activities, ["strength_upper"]);
});
