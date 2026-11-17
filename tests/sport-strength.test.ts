import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { parseGymNote } from "../scripts/import-gym.js";
import { deleteSportWorkoutsFile, mergeSportFitbitEntries } from "../server/sport-fitbit.js";
import { loggedStrengthFromBody, mergeStrengthEntries, readStrengthSessions, storeStrengthSessions } from "../server/sport-strength.js";
import { STRENGTH_EXERCISES as exercise } from "../src/strength.js";
import type { SportFitbitWorkout } from "../src/types.js";

const date = "2026-11-16";
const logged = loggedStrengthFromBody({
  id: "a".repeat(32), date, planId: "back", startedAt: `${date}T15:00:00Z`, endedAt: `${date}T15:45:00Z`,
  sets: [{ exercise: exercise.cableRow, segments: [{ weightKg: 52.5, reps: 12 }] }]
});

test("normalizes aliases while retaining shorthand, incomplete values, averages and drop sets", () => {
  const note = parseGymNote(`**Tags:** [[sport]]
Me:
Гребля - 42.5кг-8, 9
Кабель средние дельты: 12кг-8(с читами)+7кг-5, 10к
Подтягивания средним хватом, 3 подхода в среднем по 6
Love:
Присед: 40кг-11
`, "obsidian-test", date);
  assert.equal(note.planId, "back");
  assert.deepEqual(note.sets.map((set) => set.exercise), [
    exercise.cableRow, exercise.cableRow, exercise.cableLateralRaise, exercise.cableLateralRaise,
    exercise.pullUps, exercise.pullUps, exercise.pullUps
  ]);
  assert.deepEqual(note.sets[1].segments, [{ weightKg: 42.5, reps: 9 }]);
  assert.deepEqual(note.sets[2].segments, [{ weightKg: 12, reps: 8, note: "с читами" }, { weightKg: 7, reps: 5 }]);
  assert.deepEqual(note.sets[3].segments, [{ weightKg: 10, reps: null }]);
  assert.equal(note.sets[4].approximate, true);
});

test("adds Fitbit links after sync without folding distinct sessions into one", () => {
  function workout(id: string, hour: string): SportFitbitWorkout {
    return {
      source: "fitbit", activityKey: "strength_whole",
      exercise: { id, date, start: `${date}T${hour}Z`, label: "Силовая", type: "WEIGHTS",
        durationMinutes: 42, calories: null, averageHeartRate: null, distanceKm: null }
    };
  }
  const [before] = mergeStrengthEntries([], [logged]);
  assert.deepEqual(before.activities, ["strength_upper"]);
  assert.deepEqual(before.manualActivities, []);
  assert.equal(before.strengthSessions?.[0].fitbitWorkoutId, undefined);

  const fitbit = [workout("morning", "08:00:00"), workout("matching", "15:04:00")];
  const [after] = mergeStrengthEntries(mergeSportFitbitEntries([], fitbit), [logged]);
  assert.equal(after.strengthSessions?.[0].fitbitWorkoutId, "matching");
  assert.equal(after.fitbitWorkouts?.length, 2);
  assert.equal(mergeStrengthEntries(mergeSportFitbitEntries([], fitbit.slice(0, 1)), [logged])[0]
    .strengthSessions?.[0].fitbitWorkoutId, undefined);

  const manual = { id: "manual-history", date, planId: "legs" as const, source: "manual" as const, sets: logged.sets };
  assert.deepEqual(readStrengthSessions({ strengthSessions: { [manual.id]: manual } }), [manual]);
  const [historical] = mergeStrengthEntries(mergeSportFitbitEntries([], fitbit.slice(0, 1)), [manual]);
  assert.equal(historical.strengthSessions?.[0].fitbitWorkoutId, "morning");
  assert.equal(mergeStrengthEntries(mergeSportFitbitEntries([], fitbit), [manual])[0]
    .strengthSessions?.[0].fitbitWorkoutId, undefined);
});

test("retries preserve a single completed session and clearing a day removes its sets", (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sport-strength-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, "sport.json");
  fs.writeFileSync(file, JSON.stringify({ users: { bulat: { entries: { "2026-11-13": ["run"] } } } }));
  assert.equal(storeStrengthSessions(file, "bulat", [logged]), 1);
  assert.equal(storeStrengthSessions(file, "bulat", [logged]), 0);
  const read = () => JSON.parse(fs.readFileSync(file, "utf8")).users.bulat;
  assert.deepEqual(readStrengthSessions(read()), [logged]);
  assert.deepEqual(read().entries, { "2026-11-13": ["run"] });
  deleteSportWorkoutsFile(file, "bulat", ["run", "strength_whole"], { date });
  assert.deepEqual(readStrengthSessions(read()), []);
  assert.deepEqual(read().entries, { "2026-11-13": ["run"] });
});
