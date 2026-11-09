import fs from "node:fs";
import path from "node:path";
import { atomicWrite } from "./atomic-write.js";
import { object } from "./fitbit-data.js";
import type { FitbitExercise } from "../src/fitbit-types.js";
import type { SportActivityKey, SportEntry, SportFitbitWorkout } from "../src/types.js";

// Explicit source types only: names can be user supplied and must never turn a walk into a run.
const ACTIVITY_TYPES: Record<string, SportActivityKey> = {
  RUNNING: "run", TRAIL_RUN: "run", TREADMILL: "run", INCLINE_RUN: "run",
  PILATES: "pilates",
  YOGA: "yoga", YOGA_BIKRAM: "yoga", YOGA_HATHA: "yoga", YOGA_POWER: "yoga", YOGA_VINYASA: "yoga",
  STRENGTH_TRAINING: "strength_whole", FUNCTIONAL_STRENGTH_TRAINING: "strength_whole",
  WEIGHTLIFTING: "strength_whole", POWERLIFTING: "strength_whole", WEIGHTS: "strength_whole",
  WEIGHT_MACHINES: "strength_whole", RESISTANCE_BANDS: "strength_whole",
  FREE_WEIGHTS: "strength_whole",
  BIKING: "cycling", MOUNTAIN_BIKE: "cycling", OUTDOOR_BIKE: "cycling",
  STATIONARY_BIKE: "cycling", SPINNING: "cycling",
  ASSAULT_BIKE: "cycling", HAND_CYCLING: "cycling", ELECTRIC_BIKE: "cycling",
  PADDLEBOARDING: "sup",
  PULL_UPS: "pull_ups", PUSH_UPS: "push_ups",
};

export function fitbitSportActivity(exercise: FitbitExercise, allowed: readonly SportActivityKey[]) {
  const key = ACTIVITY_TYPES[exercise.type];
  return key && allowed.includes(key) ? key : null;
}

/** One-time, backed-up conversion. Preserves dates, other activities, sickness and rep records. */
export function migrateSportWalkingFile(filename: string) {
  if (!fs.existsSync(filename)) return 0;
  const original = fs.readFileSync(filename, "utf8");
  const raw = object(JSON.parse(original));
  let count = 0;
  for (const user of Object.values(object(raw.users))) {
    const entries = object(object(user).entries);
    for (const [date, value] of Object.entries(entries)) {
      const record = object(value);
      const activities = Array.isArray(value) ? value : record.activities;
      if (!Array.isArray(activities) || !activities.includes("walking")) continue;
      entries[date] = {
        ...record,
        activities: [...new Set(activities.map((key) => key === "walking" ? "run" : key))],
        runDistanceKm: 3.14,
      };
      count++;
    }
  }
  if (!count) return 0;
  const backup = `${filename}.before-walking-to-run.bak`;
  if (!fs.existsSync(backup)) fs.writeFileSync(backup, original, { mode: 0o600, flag: "wx" });
  raw.schemaVersion = Math.max(Number(raw.schemaVersion) || 1, 2);
  atomicWrite(filename, `${JSON.stringify(raw, null, 2)}\n`);
  return count;
}

/** Successful fetches replace their date window; startup backfills only upsert cached IDs. */
export function syncFitbitSportFile(
  filename: string,
  userId: string,
  exercises: FitbitExercise[],
  allowed: readonly SportActivityKey[],
  window?: { start: string; end: string },
) {
  const raw = fs.existsSync(filename) ? object(JSON.parse(fs.readFileSync(filename, "utf8"))) : {};
  const users = object(raw.users);
  const user = object(users[userId]);
  const previous = readFitbitSportWorkouts(user, allowed);
  const deletedIds = deletedFitbitIds(user);
  const incomingIds = new Set(exercises.map((exercise) => exercise.id));
  const workouts = new Map(previous
    .filter(({ exercise }) => !incomingIds.has(exercise.id) &&
      (!window || exercise.date < window.start || exercise.date >= window.end))
    .map((workout) => [workout.exercise.id, workout]));
  for (const exercise of exercises) {
    if (deletedIds.has(exercise.id)) continue;
    const activityKey = fitbitSportActivity(exercise, allowed);
    if (!activityKey || !validExercise(exercise)) continue;
    workouts.set(exercise.id, { source: "fitbit", activityKey, exercise });
  }
  const next = [...workouts.values()].sort((a, b) => a.exercise.start.localeCompare(b.exercise.start) || a.exercise.id.localeCompare(b.exercise.id));
  if (JSON.stringify(previous) === JSON.stringify(next)) return false;
  users[userId] = { ...user, fitbitWorkouts: next };
  raw.users = users;
  raw.schemaVersion = Math.max(Number(raw.schemaVersion) || 1, 5);
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  atomicWrite(filename, `${JSON.stringify(raw, null, 2)}\n`);
  return true;
}

function validExercise(exercise: FitbitExercise) {
  const date = new Date(`${exercise.date}T00:00:00Z`);
  return typeof exercise.id === "string" && Boolean(exercise.id) &&
    /^\d{4}-\d{2}-\d{2}$/.test(exercise.date) && Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === exercise.date && Number.isFinite(Date.parse(exercise.start));
}

function deletedFitbitIds(rawUser: unknown): Set<string> {
  const ids = object(rawUser).deletedFitbitWorkoutIds;
  return new Set(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : []);
}

/** Persist exclusions before any network request so refreshes and startup backfills cannot restore them. */
export function deleteSportWorkoutsFile(
  filename: string, userId: string, allowed: readonly SportActivityKey[],
  target: { exerciseId: string } | { date: string },
) {
  const raw = fs.existsSync(filename) ? object(JSON.parse(fs.readFileSync(filename, "utf8"))) : {};
  const users = object(raw.users), user = object(users[userId]);
  const workouts = readFitbitSportWorkouts(user, allowed);
  const deletedIds = deletedFitbitIds(user);
  const ids = "exerciseId" in target
    ? workouts.filter(({ exercise }) => exercise.id === target.exerciseId).map(({ exercise }) => exercise.id)
    : workouts.filter(({ exercise }) => exercise.date === target.date).map(({ exercise }) => exercise.id);
  if ("exerciseId" in target && !ids.length) {
    if (deletedIds.has(target.exerciseId)) return [target.exerciseId];
    throw new Error("Тренировка не найдена. Обновите календарь.");
  }
  for (const id of ids) deletedIds.add(id);
  const entries = { ...object(user.entries) };
  if ("date" in target) delete entries[target.date];
  users[userId] = { ...user, entries, deletedFitbitWorkoutIds: [...deletedIds],
    fitbitWorkouts: workouts.filter(({ exercise }) => !deletedIds.has(exercise.id)) };
  raw.users = users;
  raw.schemaVersion = Math.max(Number(raw.schemaVersion) || 1, 6);
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  atomicWrite(filename, `${JSON.stringify(raw, null, 2)}\n`);
  return ids;
}

export function readFitbitSportWorkouts(rawUser: unknown, allowed: readonly SportActivityKey[]): SportFitbitWorkout[] {
  const raw = object(rawUser).fitbitWorkouts;
  if (!Array.isArray(raw)) return [];
  const deletedIds = deletedFitbitIds(rawUser);
  return raw.filter((value): value is SportFitbitWorkout => {
    const workout = object(value), exercise = object(workout.exercise) as FitbitExercise;
    return workout.source === "fitbit" && validExercise(exercise) && !deletedIds.has(exercise.id) &&
      fitbitSportActivity(exercise, allowed) === workout.activityKey;
  });
}

export function mergeSportFitbitEntries(manual: SportEntry[], workouts: SportFitbitWorkout[]): SportEntry[] {
  const entries = new Map(manual.map((entry) => [entry.date, {
    ...entry, manualActivities: entry.activities, manualRunDistanceKm: entry.runDistanceKm,
    fitbitWorkouts: [] as SportFitbitWorkout[],
  }]));
  for (const workout of workouts) {
    const date = workout.exercise.date;
    const entry = entries.get(date) ?? {
      date, sick: false, activities: [], runDistanceKm: null,
      maxReps: { pullUps: null, pushUps: null }, manualActivities: [], manualRunDistanceKm: null,
      fitbitWorkouts: [],
    };
    entry.fitbitWorkouts.push(workout);
    // A manually selected muscle group also describes the day's generic Fitbit strength session.
    const manualStrength = entry.manualActivities.some((key) => key.startsWith("strength_"));
    if (!entry.activities.includes(workout.activityKey) && !(workout.activityKey === "strength_whole" && manualStrength)) {
      entry.activities = [...entry.activities, workout.activityKey];
    }
    entries.set(date, entry);
  }
  for (const entry of entries.values()) {
    const runs = entry.fitbitWorkouts.filter((workout) => workout.activityKey === "run" && workout.exercise.distanceKm !== null);
    // A day's explicit manual distance takes precedence, avoiding duplicate daily mileage.
    entry.runDistanceKm = entry.manualRunDistanceKm ?? (runs.length
      ? Math.round(runs.reduce((sum, run) => sum + run.exercise.distanceKm!, 0) * 100) / 100 : null);
  }
  return [...entries.values()].sort((a, b) => a.date.localeCompare(b.date));
}
