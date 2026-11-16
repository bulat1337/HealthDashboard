import fs from "node:fs";
import path from "node:path";
import { atomicWrite } from "./atomic-write.js";
import { object } from "./fitbit-data.js";
import type { SportActivityKey, SportEntry, SportFitbitWorkout } from "../src/types.js";
import { isStrengthPlan, STRENGTH_PLANS, type LoggedStrengthSession, type StrengthSession } from "../src/strength.js";

export function loggedStrengthFromBody(value: unknown): LoggedStrengthSession {
  const { id, date, planId, startedAt, endedAt, sets } = object(value);
  const start = typeof startedAt === "string" ? Date.parse(startedAt) : NaN;
  const end = typeof endedAt === "string" ? Date.parse(endedAt) : NaN;
  const day = typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) ? Date.parse(date) : NaN;
  if (typeof id !== "string" || !/^[a-f0-9]{32}$/.test(id) ||
      typeof date !== "string" || !Number.isFinite(day) || new Date(day).toISOString().slice(0, 10) !== date ||
      !isStrengthPlan(planId) || !Number.isFinite(start) || !Number.isFinite(end) || end < start ||
      Math.abs(day - start) > 40 * 60 * 60 * 1000) {
    throw new Error("Проверьте дату и время тренировки.");
  }
  if (!Array.isArray(sets) || sets.length === 0 || sets.length > 300) {
    throw new Error("Запишите от 1 до 300 подходов.");
  }
  return {
    id, date, planId, source: "dashboard", startedAt: new Date(start).toISOString(), endedAt: new Date(end).toISOString(),
    sets: sets.map((value) => {
      const { exercise, segments } = object(value);
      if (typeof exercise !== "string" || !exercise.trim() || exercise.trim().length > 100 ||
          !Array.isArray(segments) || segments.length !== 1) throw new Error("Проверьте упражнение.");
      const { weightKg, reps } = object(segments[0]);
      if (typeof weightKg !== "number" || !Number.isFinite(weightKg) || weightKg < 0 || weightKg > 1000 ||
          typeof reps !== "number" || !Number.isInteger(reps) || reps < 1 || reps > 1000) {
        throw new Error("Проверьте вес и количество повторений.");
      }
      return { exercise: exercise.trim(), segments: [{ weightKg, reps }] };
    })
  };
}

export function storeStrengthSessions(filename: string, userId: string, sessions: StrengthSession[]) {
  const raw = fs.existsSync(filename) ? object(JSON.parse(fs.readFileSync(filename, "utf8"))) : {};
  const users = object(raw.users);
  const user = object(users[userId]);
  const stored = object(user.strengthSessions);
  let added = 0;
  for (const session of sessions) {
    if (Object.hasOwn(stored, session.id)) continue;
    stored[session.id] = session;
    added++;
  }
  if (added) {
    users[userId] = { ...user, strengthSessions: stored };
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    atomicWrite(filename, `${JSON.stringify({ ...raw, users, schemaVersion: Math.max(Number(raw.schemaVersion) || 1, 7) }, null, 2)}\n`);
  }
  return added;
}

export function readStrengthSessions(rawUser: unknown): StrengthSession[] {
  return Object.values(object(object(rawUser).strengthSessions)).filter((value): value is StrengthSession => {
    const session = object(value);
    return typeof session.id === "string" && typeof session.date === "string" &&
      isStrengthPlan(session.planId) && Array.isArray(session.sets) && session.sets.length > 0 &&
      (session.source === "obsidian" || (session.source === "dashboard" &&
        typeof session.startedAt === "string" && typeof session.endedAt === "string"));
  });
}

function matchFitbit(sessions: StrengthSession[], workouts: SportFitbitWorkout[]) {
  const ids = new Map<string, string>();
  const used = new Set<string>();
  const candidates = workouts.filter((workout) => workout.activityKey.startsWith("strength_"));
  const pairs = sessions.flatMap((session) => {
    if (session.source !== "dashboard") return [];
    const start = Date.parse(session.startedAt);
    const end = Date.parse(session.endedAt);
    return candidates.flatMap(({ exercise }) => {
      const fitbitStart = Date.parse(exercise.start);
      const fitbitEnd = fitbitStart + exercise.durationMinutes * 60_000;
      const overlap = Math.max(0, Math.min(end, fitbitEnd) - Math.max(start, fitbitStart));
      const startGap = Math.abs(start - fitbitStart);
      return overlap > 0 || startGap <= 10 * 60_000 ? [{ session, exercise, overlap, startGap }] : [];
    });
  });
  pairs.sort((a, b) => b.overlap - a.overlap || a.startGap - b.startGap);
  for (const { session, exercise } of pairs) {
    if (ids.has(session.id) || used.has(exercise.id)) continue;
    ids.set(session.id, exercise.id);
    used.add(exercise.id);
  }
  const historical = sessions.filter((session) => session.source === "obsidian");
  const unmatched = candidates.filter(({ exercise }) => !used.has(exercise.id));
  if (historical.length === 1 && unmatched.length === 1) {
    ids.set(historical[0].id, unmatched[0].exercise.id);
  }
  return ids;
}

export function mergeStrengthEntries(entries: SportEntry[], sessions: StrengthSession[]): SportEntry[] {
  if (!sessions.length) return entries;
  const days = new Map(entries.map((entry) => [entry.date, entry]));
  const groups = new Map<string, StrengthSession[]>();
  for (const session of sessions) {
    const group = groups.get(session.date) ?? [];
    group.push(session);
    groups.set(session.date, group);
  }
  for (const [date, group] of groups) {
    const entry: SportEntry = days.get(date) ?? {
      date, activities: [], manualActivities: [], runDistanceKm: null, maxReps: { pullUps: null, pushUps: null }
    };
    const fitbitIds = matchFitbit(group, entry.fitbitWorkouts ?? []);
    const sessionActivities = new Set(group.map(({ planId }) => STRENGTH_PLANS[planId].activityKey));
    const activity: SportActivityKey = sessionActivities.size === 1 ? [...sessionActivities][0] : "strength_whole";
    const manualStrength = entry.manualActivities?.some((key) => key.startsWith("strength_"));
    const activities = manualStrength ? entry.activities : [
      ...entry.activities.filter((key) => !key.startsWith("strength_")), activity
    ];
    days.set(date, {
      ...entry,
      activities,
      strengthSessions: group.map((session) => {
        const fitbitWorkoutId = fitbitIds.get(session.id);
        return fitbitWorkoutId ? { ...session, fitbitWorkoutId } : session;
      })
    });
  }
  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
}
