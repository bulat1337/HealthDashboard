import assert from 'node:assert/strict';
import test from 'node:test';
import {createServer} from 'vite';
import type {SportUser} from '../src/types';

function user(id: string, dates: string[]): SportUser {
  return {
    id, name: id, activityTypes: ['run'],
    entries: dates.map(date => ({date, activities: ['run'], runDistanceKm: null, maxReps: {pullUps: null, pushUps: null}}))
  };
}

function localDate(key: string) {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
}

// Vite loads the production component, including its SVG imports, so these
// regressions cover both the streak and the weekly figures used by the UI.
test('sport streak uses three workout days from August 24, preserving earlier rules', async t => {
  const vite = await createServer({server: {middlewareMode: true, watch: null}, optimizeDeps: {noDiscovery: true, include: []}, appType: 'custom'});
  t.after(() => vite.close());
  const {calculateSportStats} = await vite.ssrLoadModule('/src/components/SportDashboard.tsx');
  const stats = (id: string, dates: string[], today: string) =>
    calculateSportStats(user(id, dates), localDate(today), localDate(today));

  for (const id of ['bulat', 'diana']) {
    // Sunday is the fourth rest day: three sessions still fail before the change.
    const before = stats(id, ['2026-08-17', '2026-08-19', '2026-08-21'], '2026-08-23');
    assert.equal(before.currentStreakDays, 0);
    assert.equal(before.weekWorkoutDaysRemaining, 1);
    assert.equal(before.currentWeekFulfilled, false);
    assert.equal(before.weekRestDaysAllowance, 3);

    const after = stats(id, ['2026-08-24', '2026-08-26', '2026-08-28'], '2026-08-30');
    assert.equal(after.currentStreakDays, 7);
    assert.equal(after.currentStreakStartDate, '2026-08-24');
    assert.equal(after.weekWorkoutDaysRemaining, 0);
    assert.equal(after.currentWeekFulfilled, true);
    assert.equal(after.weekRestDaysAllowance, 4);

    const insufficient = stats(id, ['2026-08-24', '2026-08-26'], '2026-08-30');
    assert.equal(insufficient.currentStreakDays, 0);
    assert.equal(insufficient.currentWeekFulfilled, false);
    // Sunday is still available for the third workout.
    assert.equal(insufficient.currentWeekViable, true);

    assert.equal(stats(id, [], '2026-08-23').weekRestDaysAllowance, 3);
    assert.equal(stats(id, [], '2026-08-24').weekRestDaysAllowance, 4);
    assert.equal(stats(id, [], '2026-08-24').weekWorkoutDaysRemaining, 3);
    assert.equal(stats(id, ['2026-08-25'], '2026-08-24').currentStreakDays, 0);
  }

  // A continuous summer series crosses both the rule boundary and September.
  const summer: string[] = [];
  for (let day = localDate('2026-06-30'); day <= localDate('2026-08-23'); day.setDate(day.getDate() + 1)) {
    if ([1, 3, 5, 0].includes(day.getDay()) || day.getTime() === localDate('2026-06-30').getTime()) {
      summer.push(`${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`);
    }
  }
  const continuous = stats('bulat', [...summer,
    '2026-08-24', '2026-08-27', '2026-08-29',
    '2026-09-02', '2026-09-04', '2026-09-06',
    '2026-09-08', '2026-09-12'
  ], '2026-09-12');
  assert.equal(continuous.currentStreakStartDate, '2026-06-30');
  assert.equal(continuous.currentStreakDays, 75);
  assert.equal(continuous.bestStreakDays, 75);
  assert.equal(continuous.weekWorkoutDaysRemaining, 1);
  assert.equal(continuous.currentWeekViable, true);

  // Diana keeps her existing carryover. Only the old week's unused allowance
  // transfers; the additional rest day starts with the new week.
  const fiveDays = ['2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20', '2026-08-21'];
  assert.equal(stats('diana', fiveDays, '2026-08-24').weekRestDaysAllowance, 5);
  assert.equal(stats('bulat', fiveDays, '2026-08-24').weekRestDaysAllowance, 4);
});

test('sick days pause sport streaks and are excluded from workout and rest totals', async t => {
  const vite = await createServer({server: {middlewareMode: true, watch: null}, optimizeDeps: {noDiscovery: true, include: []}, appType: 'custom'});
  t.after(() => vite.close());
  const {calculateSportStats} = await vite.ssrLoadModule('/src/components/SportDashboard.tsx');
  const stats = (id: string, workouts: string[], sick: string[], today: string) => {
    const person = user(id, [...new Set([...workouts, ...sick])].sort());
    person.entries.forEach(entry => {
      entry.sick = sick.includes(entry.date);
      if (!workouts.includes(entry.date)) entry.activities = [];
    });
    return calculateSportStats(person, localDate(today), localDate(today));
  };

  for (const id of ['bulat', 'diana']) {
    const paused = stats(id, ['2026-09-07'], ['2026-09-12', '2026-09-13'], '2026-09-13');
    assert.equal(paused.currentStreakDays, 5);
    assert.equal(paused.bestStreakDays, 5);
    assert.equal(paused.currentStreakStartDate, '2026-09-07');
    assert.equal(paused.currentStreakWorkoutDays, 1);
    assert.equal(paused.currentStreakRestDays, 4);
    assert.equal(paused.weekRestDaysUsed, 4);
    assert.equal(paused.weekRestDaysRemaining, 0);
    assert.equal(paused.weekWorkoutDaysRemaining, 0);
    assert.equal(paused.currentWeekFulfilled, true);
    assert.equal(paused.monthDays, 1);
    assert.equal(paused.monthActivities, 1);
    assert.equal(paused.lastWorkoutDate, '2026-09-07');
    assert.equal(paused.todayDone, false);
    assert.equal(paused.weekDayStates[6].status, 'sick');
    assert.equal(stats(id, ['2026-09-07'], [], '2026-09-13').currentStreakDays, 0);
    // A later sick day cannot revive a series already broken on Saturday.
    assert.equal(stats(id, ['2026-09-07'], ['2026-09-13'], '2026-09-13').currentStreakDays, 0);
    assert.equal(stats(id, [], ['2026-09-13'], '2026-09-13').currentStreakDays, 0);

    const longIllness = Array.from({length: 10}, (_, index) => `2026-09-${12 + index}`);
    assert.equal(stats(id, ['2026-09-07'], longIllness, '2026-09-21').currentStreakDays, 5);
    const resumed = stats(id, ['2026-09-07', '2026-09-22'], longIllness, '2026-09-22');
    assert.equal(resumed.currentStreakDays, 6);
    assert.equal(resumed.currentStreakStartDate, '2026-09-07');
    assert.equal(resumed.weekRestDaysUsed, 0);
    assert.equal(resumed.weekRestDaysAllowance, 4);

    // Saved workout details on an excluded day do not count until it is restored.
    const excludedWorkout = stats(id, ['2026-09-07', '2026-09-08'], ['2026-09-08'], '2026-09-08');
    assert.equal(excludedWorkout.currentStreakDays, 1);
    assert.equal(excludedWorkout.monthDays, 1);
    assert.equal(excludedWorkout.lastWorkoutDate, '2026-09-07');
    assert.equal(stats(id, ['2026-09-07', '2026-09-08'], [], '2026-09-08').currentStreakDays, 2);
    // Future sick marks cannot affect the current streak or consume rest days.
    assert.equal(stats(id, ['2026-09-07'], ['2026-09-08'], '2026-09-07').currentStreakDays, 1);
  }

  const fullSickWeek = Array.from({length: 7}, (_, index) => `2026-09-${14 + index}`);
  const carryover = stats('diana', ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11'], fullSickWeek, '2026-09-20');
  assert.equal(carryover.currentStreakDays, 7);
  assert.equal(carryover.weekRestDaysAllowance, 6);
  assert.equal(carryover.weekRestDaysUsed, 0);
  assert.equal(carryover.currentWeekFulfilled, true);
  assert.equal(stats('diana', ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11'], fullSickWeek, '2026-09-21').weekRestDaysAllowance, 6);
});
