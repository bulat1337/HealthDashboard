import type { FormEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import streakFlameActiveUrl from "../assets/duolingo-streak-flame-active.svg";
import streakFlameIdleUrl from "../assets/duolingo-streak-flame-idle.svg";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  Bike,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronsUp,
  CircleAlert,
  CircleOff,
  Dumbbell,
  Flower2,
  Footprints,
  MoveDown,
  RefreshCw,
  Stethoscope,
  Users,
  Waves
} from "lucide-react";
import { ActivityPicker } from "./ActivityPicker";
import { fetchSportData, updateSportDay } from "../api";
import type {
  SportActivityCatalogEntry,
  SportActivityKey,
  SportData,
  SportEntry,
  SportMaxReps,
  SportUser
} from "../types";

type SportDashboardProps = {
  today: Date;
  refreshKey: number;
};

type SportStats = {
  currentStreakDays: number;
  bestStreakDays: number;
  currentStreakStartDate: string | null;
  currentStreakWorkoutDays: number;
  currentStreakRestDays: number;
  monthDays: number;
  monthActivities: number;
  monthRunDistanceKm: number;
  weekWorkoutDays: number;
  weekWorkoutDaysRemaining: number;
  weekRestDaysUsed: number;
  weekRestDaysRemaining: number;
  weekRestDaysAllowance: number;
  weekDayStates: SportWeekDayState[];
  currentWeekFulfilled: boolean;
  currentWeekViable: boolean;
  todayDone: boolean;
  lastWorkoutDate: string | null;
};

type CalendarCell = {
  date: Date;
  key: string;
  inMonth: boolean;
};

type SportWeekDayStatus = "workout" | "rest" | "sick" | "open" | "future";

type SportWeekDayState = {
  key: string;
  label: string;
  dayNumber: number;
  status: SportWeekDayStatus;
  isToday: boolean;
};

type SmartStreak = {
  currentStreakDays: number;
  bestStreakDays: number;
  currentStreakStartDate: string | null;
  currentStreakWorkoutDays: number;
  currentStreakRestDays: number;
  currentWeekRestAllowance: number;
};

type RepMetricKey = keyof SportMaxReps;

type SportRepMetric = {
  key: RepMetricKey;
  activityKey: SportActivityKey;
  label: string;
  Icon: LucideIcon;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_LENGTH_DAYS = 7;
// The last full week of August 2026 starts on Monday, August 24.
const THREE_WORKOUT_WEEK_START = "2026-08-24";

function weeklyWorkoutTarget(weekKey: string) {
  return weekKey >= THREE_WORKOUT_WEEK_START ? 3 : 4;
}

function weeklyRestAllowance(weekKey: string) {
  return WEEK_LENGTH_DAYS - weeklyWorkoutTarget(weekKey);
}
const MAX_REPS_LIMIT = 1000;
const EMPTY_MAX_REPS: SportMaxReps = {
  pullUps: null,
  pushUps: null
};
const REST_CARRYOVER_START_DATES: Record<string, string> = {
  diana: "2026-06-29"
};
const WEEKDAY_LABELS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

const ACTIVITY_ICONS: Record<SportActivityKey, LucideIcon> = {
  run: Footprints,
  walking: Footprints,
  pilates: Activity,
  yoga: Flower2,
  strength_lower: Dumbbell,
  strength_upper: Dumbbell,
  strength_whole: Dumbbell,
  cycling: Bike,
  sup: Waves,
  pull_ups: ChevronsUp,
  push_ups: MoveDown
};

const STRENGTH_ACTIVITY_KEYS: SportActivityKey[] = [
  "strength_whole",
  "strength_upper",
  "strength_lower",
];
const STRENGTH_ACTIVITY_KEY_SET = new Set<SportActivityKey>(STRENGTH_ACTIVITY_KEYS);
const STRENGTH_VARIANT_LABELS: Record<SportActivityKey, string> = {
  run: "Бег",
  walking: "Пешая прогулка",
  pilates: "Пилатес",
  yoga: "Йога",
  strength_lower: "Силовая · низ тела",
  strength_upper: "Силовая · верх тела",
  strength_whole: "Силовая · всё тело",
  cycling: "Велотренировка",
  sup: "Сап",
  pull_ups: "Подтягивания",
  push_ups: "Отжимания"
};

const REP_METRICS: SportRepMetric[] = [
  {
    key: "pullUps",
    activityKey: "pull_ups",
    label: "Максимум подтягиваний",
    Icon: ChevronsUp
  },
  {
    key: "pushUps",
    activityKey: "push_ups",
    label: "Максимум отжиманий",
    Icon: MoveDown
  }
];

function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function startOfWeek(date: Date) {
  const local = startOfLocalDay(date);
  const mondayOffset = (local.getDay() + 6) % WEEK_LENGTH_DAYS;
  return addDays(local, -mondayOffset);
}

function addDays(date: Date, days: number) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function addMonths(date: Date, months: number) {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

function dateKey(date: Date) {
  const local = startOfLocalDay(date);
  const year = local.getFullYear();
  const month = String(local.getMonth() + 1).padStart(2, "0");
  const day = String(local.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDateKey(key: string) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function previousDateKey(key: string) {
  return dateKey(addDays(parseDateKey(key), -1));
}

function nextDateKey(key: string) {
  return dateKey(addDays(parseDateKey(key), 1));
}

function dayDistance(start: Date, end: Date) {
  return Math.round((startOfLocalDay(end).getTime() - startOfLocalDay(start).getTime()) / DAY_MS);
}

function formatMonthLabel(date: Date) {
  return new Intl.DateTimeFormat("ru-RU", {
    month: "long",
    year: "numeric"
  }).format(date);
}

function formatLongDate(date: Date) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric"
  }).format(date);
}

function pluralRu(value: number, forms: [string, string, string]) {
  const mod10 = value % 10;
  const mod100 = value % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}

function roundDistanceKm(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function formatDistanceKm(value: number) {
  return new Intl.NumberFormat("ru-RU", {
    maximumFractionDigits: 2
  }).format(value);
}

function formatDistanceDraft(value: number | null) {
  return value === null ? "" : formatDistanceKm(value);
}

function parseDistanceDraft(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return { value: null, error: null };

  const parsed = Number(trimmed.replace(",", "."));
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return { value: null, error: "Введите дистанцию больше 0 км." };
  }

  if (parsed > 1000) {
    return { value: null, error: "Проверьте дистанцию: максимум 1000 км." };
  }

  return { value: roundDistanceKm(parsed), error: null };
}

function formatMaxRepsDraft(value: number | null) {
  return value === null ? "" : String(value);
}

function parseMaxRepsDraft(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return { value: null, error: null };

  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return { value: null, error: "Введите целое число больше 0." };
  }

  if (parsed > MAX_REPS_LIMIT) {
    return { value: null, error: `Проверьте число: максимум ${MAX_REPS_LIMIT}.` };
  }

  return { value: parsed, error: null };
}

function sameDistance(left: number | null, right: number | null) {
  return left === right;
}

function maxRepsForActivities(activities: SportActivityKey[], maxReps: SportMaxReps): SportMaxReps {
  return {
    pullUps: activities.includes("pull_ups") ? maxReps.pullUps : null,
    pushUps: activities.includes("push_ups") ? maxReps.pushUps : null
  };
}

function formatMaxRepsAria(maxReps: SportMaxReps) {
  const parts = [];
  if (maxReps.pullUps !== null) parts.push(`${maxReps.pullUps} подтягиваний`);
  if (maxReps.pushUps !== null) parts.push(`${maxReps.pushUps} отжиманий`);
  return parts.length > 0 ? `, максимум: ${parts.join(", ")}` : "";
}

function buildCalendarCells(month: Date): CalendarCell[] {
  const firstDay = startOfMonth(month);
  const mondayOffset = (firstDay.getDay() + 6) % 7;
  const gridStart = addDays(firstDay, -mondayOffset);
  const daysInMonth = new Date(firstDay.getFullYear(), firstDay.getMonth() + 1, 0).getDate();
  const cellCount = Math.ceil((mondayOffset + daysInMonth) / 7) * 7;

  return Array.from({ length: cellCount }, (_, index) => {
    const date = addDays(gridStart, index);
    return {
      date,
      key: dateKey(date),
      inMonth: date.getMonth() === firstDay.getMonth()
    };
  });
}

function entryMap(entries: SportEntry[]) {
  return new Map(entries.map((entry) => [entry.date, entry]));
}

function activityDateSet(user: SportUser) {
  return new Set(user.entries.filter((entry) => !entry.sick && entry.activities.length > 0).map((entry) => entry.date));
}

function dateKeysBetween(startKey: string, endKey: string) {
  const keys: string[] = [];
  let cursor = startKey;
  while (cursor <= endKey) {
    keys.push(cursor);
    cursor = nextDateKey(cursor);
  }
  return keys;
}

function countWorkoutDays(dates: Set<string>, startKey: string, endKey: string) {
  return dateKeysBetween(startKey, endKey).filter((key) => dates.has(key)).length;
}

function emptySmartStreak(today: Date): SmartStreak {
  return {
    currentStreakDays: 0,
    bestStreakDays: 0,
    currentStreakStartDate: null,
    currentStreakWorkoutDays: 0,
    currentStreakRestDays: 0,
    currentWeekRestAllowance: weeklyRestAllowance(dateKey(startOfWeek(today)))
  };
}

function restDayCarryoverStartKey(user: SportUser) {
  return REST_CARRYOVER_START_DATES[user.id] ?? null;
}

function calculateSmartDayStreak(
  dates: Set<string>,
  today: Date,
  restCarryoverStartKey: string | null,
  sickDates: Set<string>
): SmartStreak {
  const todayKey = dateKey(today);
  const workoutDates = [...dates].filter((key) => key <= todayKey).sort();
  if (workoutDates.length === 0) return emptySmartStreak(today);

  const restCarryoverStartWeekKey = restCarryoverStartKey
    ? dateKey(startOfWeek(parseDateKey(restCarryoverStartKey)))
    : null;
  let cursor = parseDateKey(workoutDates[0]);
  let currentStreakDays = 0;
  let bestStreakDays = 0;
  let currentStreakStartDate: string | null = null;
  let currentStreakWorkoutDays = 0;
  let currentStreakRestDays = 0;
  let activeWeekKey: string | null = null;
  let activeWeekRestDays = 0;
  let carriedRestDays = 0;

  function weekCanUseCarryover(weekKey: string | null) {
    return Boolean(restCarryoverStartWeekKey && weekKey && weekKey >= restCarryoverStartWeekKey);
  }

  function activeWeekRestAllowance(weekKey = activeWeekKey) {
    return weeklyRestAllowance(weekKey ?? dateKey(startOfWeek(today))) +
      (weekCanUseCarryover(weekKey) ? carriedRestDays : 0);
  }

  function resetCurrentStreak() {
    currentStreakDays = 0;
    currentStreakStartDate = null;
    currentStreakWorkoutDays = 0;
    currentStreakRestDays = 0;
    activeWeekKey = null;
    activeWeekRestDays = 0;
    carriedRestDays = 0;
  }

  function startCurrentStreak(key: string, date: Date) {
    currentStreakDays = 1;
    currentStreakStartDate = key;
    currentStreakWorkoutDays = 1;
    currentStreakRestDays = 0;
    activeWeekKey = dateKey(startOfWeek(date));
    activeWeekRestDays = 0;
    carriedRestDays = 0;
  }

  while (dateKey(cursor) <= todayKey) {
    const key = dateKey(cursor);
    // Excluded days neither advance nor break a streak. Entire sick weeks
    // also cannot mint additional rest-day carryover.
    if (sickDates.has(key)) {
      cursor = addDays(cursor, 1);
      continue;
    }
    const hasWorkout = dates.has(key);

    if (currentStreakDays === 0) {
      if (hasWorkout) startCurrentStreak(key, cursor);
      bestStreakDays = Math.max(bestStreakDays, currentStreakDays);
      cursor = addDays(cursor, 1);
      continue;
    }

    const weekKey = dateKey(startOfWeek(cursor));
    if (weekKey !== activeWeekKey) {
      carriedRestDays =
        weekCanUseCarryover(activeWeekKey) && weekCanUseCarryover(weekKey)
          ? Math.max(0, activeWeekRestAllowance(activeWeekKey) - activeWeekRestDays)
          : 0;
      activeWeekKey = weekKey;
      activeWeekRestDays = 0;
    }

    if (hasWorkout) {
      currentStreakDays += 1;
      currentStreakWorkoutDays += 1;
    } else if (activeWeekRestDays < activeWeekRestAllowance()) {
      currentStreakDays += 1;
      currentStreakRestDays += 1;
      activeWeekRestDays += 1;
    } else {
      resetCurrentStreak();
    }

    bestStreakDays = Math.max(bestStreakDays, currentStreakDays);
    cursor = addDays(cursor, 1);
  }

  const todayWeekKey = dateKey(startOfWeek(today));
  const nextWeekCarryover = weekCanUseCarryover(activeWeekKey) && weekCanUseCarryover(todayWeekKey)
    ? Math.max(0, activeWeekRestAllowance() - activeWeekRestDays)
    : 0;

  return {
    currentStreakDays,
    bestStreakDays,
    currentStreakStartDate,
    currentStreakWorkoutDays,
    currentStreakRestDays,
    currentWeekRestAllowance:
      currentStreakDays > 0
        ? activeWeekKey === todayWeekKey
          ? activeWeekRestAllowance()
          : weeklyRestAllowance(todayWeekKey) + nextWeekCarryover
        : weeklyRestAllowance(todayWeekKey)
  };
}

function buildCurrentWeekDayStates(
  dates: Set<string>,
  today: Date,
  currentStreakStartDate: string | null,
  sickDates = new Set<string>()
): SportWeekDayState[] {
  const todayKey = dateKey(today);
  const weekStart = startOfWeek(today);

  return WEEKDAY_LABELS.map((label, index) => {
    const date = addDays(weekStart, index);
    const key = dateKey(date);
    const hasWorkout = dates.has(key);
    const isPastOrToday = key <= todayKey;
    const streakCoversDay = Boolean(currentStreakStartDate && key >= currentStreakStartDate);
    const status: SportWeekDayStatus = sickDates.has(key) ? "sick" : hasWorkout
      ? "workout"
      : !isPastOrToday
        ? "future"
        : streakCoversDay
          ? "rest"
          : "open";

    return {
      key,
      label,
      dayNumber: date.getDate(),
      status,
      isToday: key === todayKey
    };
  });
}

function streakDayStatusLabel(status: SportWeekDayStatus) {
  if (status === "sick") return "больничный · день исключён из стрика";
  if (status === "workout") return "тренировка";
  if (status === "rest") return "отдых в балансе";
  if (status === "future") return "впереди";
  return "ожидает тренировки";
}

function dayStreakLabel(value: number) {
  return pluralRu(value, ["день", "дня", "дней"]);
}

export function calculateSportStats(user: SportUser, today: Date, visibleMonth: Date): SportStats {
  const dates = activityDateSet(user);
  const sickDates = new Set(user.entries.filter((entry) => entry.sick).map((entry) => entry.date));
  const smartStreak = calculateSmartDayStreak(dates, today, restDayCarryoverStartKey(user), sickDates);
  const todayKey = dateKey(today);
  const currentWeekStart = startOfWeek(today);
  const currentWeekKey = dateKey(currentWeekStart);
  const currentWeekEndKey = dateKey(addDays(currentWeekStart, WEEK_LENGTH_DAYS - 1));
  const monthPrefix = dateKey(startOfMonth(visibleMonth)).slice(0, 7);
  const workoutEntries = user.entries.filter((entry) => !entry.sick && entry.activities.length > 0);
  const monthEntries = workoutEntries.filter((entry) => entry.date.startsWith(monthPrefix));
  const monthRunDistanceKm = roundDistanceKm(
    monthEntries.reduce((sum, entry) => sum + (entry.runDistanceKm ?? 0), 0)
  );
  const pastOrTodayEntries = workoutEntries.filter((entry) => entry.date <= todayKey);
  const lastWorkoutDate = pastOrTodayEntries[pastOrTodayEntries.length - 1]?.date ?? null;
  const todayDone = dates.has(todayKey);
  const daysBeforeToday = dayDistance(currentWeekStart, today);
  const workoutsBeforeToday = daysBeforeToday > 0
    ? countWorkoutDays(dates, currentWeekKey, previousDateKey(todayKey))
    : 0;
  const weekWorkoutDays = countWorkoutDays(dates, currentWeekKey, todayKey);
  const sickDaysBeforeToday = countWorkoutDays(sickDates, currentWeekKey, previousDateKey(todayKey));
  const weekRestDaysUsed = daysBeforeToday - workoutsBeforeToday - sickDaysBeforeToday;
  const weekRestDaysAllowance = smartStreak.currentWeekRestAllowance;
  const weekRestDaysRemaining = Math.max(0, weekRestDaysAllowance - weekRestDaysUsed);
  const weekSickDays = countWorkoutDays(sickDates, currentWeekKey, currentWeekEndKey);
  const weekWorkoutTarget = Math.max(0, weeklyWorkoutTarget(currentWeekKey) - weekSickDays);
  const weekWorkoutDaysRemaining = Math.max(0, weekWorkoutTarget - weekWorkoutDays);
  const daysRemainingAfterToday = Math.max(0, dayDistance(today, parseDateKey(currentWeekEndKey)));
  const remainingSickDays = countWorkoutDays(sickDates, todayKey, currentWeekEndKey);
  const availableWorkoutDays = daysRemainingAfterToday + (todayDone ? 0 : 1) - remainingSickDays;
  const currentWeekFulfilled = weekWorkoutDays >= weekWorkoutTarget;
  const currentWeekViable =
    currentWeekFulfilled ||
    (weekRestDaysUsed <= weekRestDaysAllowance && weekWorkoutDaysRemaining <= availableWorkoutDays);

  return {
    ...smartStreak,
    monthDays: monthEntries.length,
    monthActivities: monthEntries.reduce((sum, entry) => sum + entry.activities.length, 0),
    monthRunDistanceKm,
    weekWorkoutDays,
    weekWorkoutDaysRemaining,
    weekRestDaysUsed,
    weekRestDaysRemaining,
    weekRestDaysAllowance,
    weekDayStates: buildCurrentWeekDayStates(dates, today, smartStreak.currentStreakStartDate, sickDates),
    currentWeekFulfilled,
    currentWeekViable,
    todayDone,
    lastWorkoutDate
  };
}

function activityByKey(catalog: SportActivityCatalogEntry[]) {
  return new Map(catalog.map((activity) => [activity.key, activity]));
}

function sortActivitiesForUser(user: SportUser, activities: SportActivityKey[]) {
  const selected = new Set(activities);
  return user.activityTypes.filter((activity) => selected.has(activity));
}

function withoutStrengthActivities(activities: SportActivityKey[]) {
  return activities.filter((activity) => !STRENGTH_ACTIVITY_KEY_SET.has(activity));
}

export function SportDashboard({ today, refreshKey }: SportDashboardProps) {
  const pageRef = useRef<HTMLDivElement>(null);
  const streakRef = useRef<HTMLElement>(null);
  const calendarRef = useRef<HTMLElement>(null);
  const dayPanelRef = useRef<HTMLElement>(null);
  const [data, setData] = useState<SportData | null>(null);
  const [selectedUserId, setSelectedUserId] = useState("bulat");
  const [visibleMonth, setVisibleMonth] = useState(() => startOfMonth(today));
  const [selectedDate, setSelectedDate] = useState(() => dateKey(today));
  const [revealDayRequest, setRevealDayRequest] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingDate, setSavingDate] = useState<string | null>(null);
  const [runDistanceDraft, setRunDistanceDraft] = useState("");
  const [runDistanceError, setRunDistanceError] = useState<string | null>(null);
  const [maxRepsDrafts, setMaxRepsDrafts] = useState<Record<RepMetricKey, string>>({
    pullUps: "",
    pushUps: ""
  });
  const [maxRepsErrors, setMaxRepsErrors] = useState<Record<RepMetricKey, string | null>>({
    pullUps: null,
    pushUps: null
  });

  useEffect(() => {
    const streak = streakRef.current;
    if (!streak) return;
    const measure = () => pageRef.current?.style.setProperty(
      "--sport-streak-height", `${streak.getBoundingClientRect().height}px`
    );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(streak);
    return () => observer.disconnect();
  }, [data !== null]);

  useEffect(() => {
    if (revealDayRequest === 0) return;
    dayPanelRef.current?.scrollIntoView({ block: "start" });
    dayPanelRef.current?.focus({ preventScroll: true });
  }, [revealDayRequest]);

  useEffect(() => {
    const controller = new AbortController();
    setIsLoading(true);
    fetchSportData(controller.signal)
      .then((response) => {
        setData(response.data);
        setError(null);
        setSelectedUserId((current) =>
          response.data.users.some((user) => user.id === current)
            ? current
            : response.data.users[0]?.id ?? "bulat"
        );
      })
      .catch((loadError) => {
        if (controller.signal.aborted) return;
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });

    return () => controller.abort();
  }, [refreshKey]);

  const catalogByKey = useMemo(() => activityByKey(data?.activityCatalog ?? []), [data]);
  const selectedUser = useMemo(
    () => data?.users.find((user) => user.id === selectedUserId) ?? data?.users[0] ?? null,
    [data, selectedUserId]
  );
  const selectedEntriesByDate = useMemo(
    () => entryMap(selectedUser?.entries ?? []),
    [selectedUser]
  );
  const calendarCells = useMemo(() => buildCalendarCells(visibleMonth), [visibleMonth]);
  const statsByUser = useMemo(() => {
    if (!data) return new Map<string, SportStats>();
    return new Map(data.users.map((user) => [user.id, calculateSportStats(user, today, visibleMonth)]));
  }, [data, today, visibleMonth]);

  const selectedDateEntry = selectedEntriesByDate.get(selectedDate) ?? null;
  const selectedDateSick = selectedDateEntry?.sick ?? false;
  const selectedDateActivities = selectedDateEntry?.activities ?? [];
  const selectedDateRunDistanceKm = selectedDateEntry?.runDistanceKm ?? null;
  const selectedDateMaxReps = selectedDateEntry?.maxReps ?? EMPTY_MAX_REPS;
  const selectedDateHasRun = selectedDateActivities.includes("run");
  const activeRepMetrics = REP_METRICS.filter((metric) => selectedDateActivities.includes(metric.activityKey));
  const selectedDateObject = parseDateKey(selectedDate);
  const availableActivities =
    selectedUser?.activityTypes
      .map((activityKey) => catalogByKey.get(activityKey))
      .filter((activity): activity is SportActivityCatalogEntry => Boolean(activity)) ?? [];
  const activityOptions = availableActivities.map((activity) => ({
    ...activity,
    label: STRENGTH_ACTIVITY_KEY_SET.has(activity.key) ? STRENGTH_VARIANT_LABELS[activity.key] : activity.label,
    Icon: ACTIVITY_ICONS[activity.key] ?? Activity
  }));
  const selectedStats = selectedUser ? statsByUser.get(selectedUser.id) : null;
  const selectedStatsValue = selectedStats ?? {
    currentStreakDays: 0,
    bestStreakDays: 0,
    currentStreakStartDate: null,
    currentStreakWorkoutDays: 0,
    currentStreakRestDays: 0,
    monthDays: 0,
    monthActivities: 0,
    monthRunDistanceKm: 0,
    weekWorkoutDays: 0,
    weekWorkoutDaysRemaining: weeklyWorkoutTarget(dateKey(startOfWeek(today))),
    weekRestDaysUsed: 0,
    weekRestDaysRemaining: weeklyRestAllowance(dateKey(startOfWeek(today))),
    weekRestDaysAllowance: weeklyRestAllowance(dateKey(startOfWeek(today))),
    weekDayStates: buildCurrentWeekDayStates(new Set<string>(), today, null),
    currentWeekFulfilled: false,
    currentWeekViable: true,
    todayDone: false,
    lastWorkoutDate: null
  };
  const runDistanceParseResult = useMemo(() => parseDistanceDraft(runDistanceDraft), [runDistanceDraft]);
  const maxRepsParseResults = useMemo(
    () => ({
      pullUps: parseMaxRepsDraft(maxRepsDrafts.pullUps),
      pushUps: parseMaxRepsDraft(maxRepsDrafts.pushUps)
    }),
    [maxRepsDrafts]
  );
  const runDistanceMessage = runDistanceError ?? runDistanceParseResult.error;
  const runDistanceDirty =
    selectedDateHasRun &&
    !runDistanceParseResult.error &&
    !sameDistance(runDistanceParseResult.value, selectedDateRunDistanceKm);

  useEffect(() => {
    setRunDistanceDraft(formatDistanceDraft(selectedDateRunDistanceKm));
    setRunDistanceError(null);
  }, [selectedDate, selectedUser?.id, selectedDateRunDistanceKm]);

  useEffect(() => {
    setMaxRepsDrafts({
      pullUps: formatMaxRepsDraft(selectedDateMaxReps.pullUps),
      pushUps: formatMaxRepsDraft(selectedDateMaxReps.pushUps)
    });
    setMaxRepsErrors({
      pullUps: null,
      pushUps: null
    });
  }, [selectedDate, selectedUser?.id, selectedDateMaxReps.pullUps, selectedDateMaxReps.pushUps]);

  async function saveSportDay(
    nextActivities: SportActivityKey[],
    nextRunDistanceKm: number | null,
    nextMaxReps: SportMaxReps,
    sick = selectedDateSick
  ) {
    if (!selectedUser) return;

    const activities = sortActivitiesForUser(selectedUser, nextActivities);
    const maxReps = maxRepsForActivities(activities, nextMaxReps);
    setSavingDate(selectedDate);
    setError(null);
    try {
      const response = await updateSportDay({
        userId: selectedUser.id,
        date: selectedDate,
        sick,
        activities,
        runDistanceKm: activities.includes("run") ? nextRunDistanceKm : null,
        maxReps
      });
      setData(response.data);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSavingDate(null);
    }
  }

  async function saveActivities(nextActivities: SportActivityKey[]) {
    await saveSportDay(
      nextActivities,
      nextActivities.includes("run") ? selectedDateRunDistanceKm : null,
      selectedDateMaxReps
    );
  }

  function saveRunDistance(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedDateHasRun) return;

    const parsed = parseDistanceDraft(runDistanceDraft);
    if (parsed.error) {
      setRunDistanceError(parsed.error);
      return;
    }

    setRunDistanceError(null);
    void saveSportDay(selectedDateActivities, parsed.value, selectedDateMaxReps);
  }

  function saveMaxReps(metric: SportRepMetric, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedDateActivities.includes(metric.activityKey)) return;

    const parsed = parseMaxRepsDraft(maxRepsDrafts[metric.key]);
    if (parsed.error) {
      setMaxRepsErrors((current) => ({
        ...current,
        [metric.key]: parsed.error
      }));
      return;
    }

    setMaxRepsErrors((current) => ({
      ...current,
      [metric.key]: null
    }));
    void saveSportDay(selectedDateActivities, selectedDateRunDistanceKm, {
      ...selectedDateMaxReps,
      [metric.key]: parsed.value
    });
  }

  function toggleActivity(activityKey: SportActivityKey) {
    if (savingDate !== null) return;
    if (selectedDateActivities.includes(activityKey)) {
      void saveActivities(selectedDateActivities.filter((key) => key !== activityKey));
    } else {
      const previous = STRENGTH_ACTIVITY_KEY_SET.has(activityKey)
        ? withoutStrengthActivities(selectedDateActivities) : selectedDateActivities;
      void saveActivities([...previous, activityKey]);
    }
  }

  function selectCalendarDate(cell: CalendarCell) {
    setSelectedDate(cell.key);
    if (!cell.inMonth) setVisibleMonth(startOfMonth(cell.date));
    if (window.matchMedia("(max-width: 760px)").matches) {
      setRevealDayRequest((current) => current + 1);
    }
  }

  if (isLoading && !data) {
    return (
      <section className="panel sport-empty-panel">
        <RefreshCw className="spin" size={24} />
        <div>
          <h2>Спорт загружается</h2>
          <p>Календарь тренировок готовится.</p>
        </div>
      </section>
    );
  }

  if (!data) {
    return (
      <section className="panel sport-empty-panel">
        <CircleAlert size={26} />
        <div>
          <h2>Спорт недоступен</h2>
          <p>{error ?? "Сервер не вернул данные спорта."}</p>
        </div>
      </section>
    );
  }

  return (
    <div className="sport-page" ref={pageRef}>
      {error ? (
        <section className="error-banner sport-error-banner" role="alert">
          <CircleAlert size={18} />
          <span>{error}</span>
        </section>
      ) : null}

      <section className="control-band sport-control-band">
        <div className="segmented users-control" aria-label="Пользователь спорта">
          {data.users.map((user) => (
            <button
              key={user.id}
              type="button"
              className={selectedUser?.id === user.id ? "active" : ""}
              aria-pressed={selectedUser?.id === user.id}
              onClick={() => setSelectedUserId(user.id)}
            >
              <Users size={16} />
              <span>{user.name}</span>
            </button>
          ))}
        </div>
      </section>

      <article
        className={[
          "panel sport-streak-card sport-streak-panel",
          selectedStatsValue.currentStreakDays > 0 ? "active" : "idle"
        ].join(" ")}
        ref={streakRef}
        aria-label="Стрик выбранного пользователя"
      >
        <div className="sport-streak-main">
          <div className="sport-streak-copy">
            <span className="sport-streak-eyebrow">Стрик</span>
            <div className="sport-streak-value">
              <strong>{selectedStatsValue.currentStreakDays}</strong>
              <span>{dayStreakLabel(selectedStatsValue.currentStreakDays)} подряд</span>
            </div>
          </div>

          <div className="sport-streak-stage" aria-hidden="true">
            <span
              key={`${selectedUser?.id ?? "sport"}-${selectedStatsValue.currentStreakDays}`}
              className="sport-streak-flame-pop"
            >
              <span className="sport-streak-flame-burn">
                <img
                  className="sport-streak-flame-image"
                  src={selectedStatsValue.currentStreakDays > 0 ? streakFlameActiveUrl : streakFlameIdleUrl}
                  alt=""
                />
                {selectedStatsValue.currentStreakDays > 0 ? (
                  <img className="sport-streak-flame-glow" src={streakFlameActiveUrl} alt="" />
                ) : null}
              </span>
            </span>
          </div>
        </div>

        <div className="sport-streak-week" aria-label="Текущая неделя стрика">
          {selectedStatsValue.weekDayStates.map((day) => (
            <button
              type="button"
              key={day.key}
              aria-pressed={selectedDate === day.key}
              onClick={() => selectCalendarDate({ date: parseDateKey(day.key), key: day.key,
                inMonth: day.key.slice(0, 7) === dateKey(visibleMonth).slice(0, 7) })}
              className={[
                "sport-streak-weekday",
                day.status,
                day.isToday ? "today" : ""
              ]
                .filter(Boolean)
                .join(" ")}
              title={`${formatLongDate(parseDateKey(day.key))}: ${streakDayStatusLabel(day.status)}`}
              aria-label={`${day.label}, ${day.dayNumber}: ${streakDayStatusLabel(day.status)}`}
            >
              <small>{day.label}</small>
              {day.status === "sick" ? <Stethoscope size={16} aria-hidden="true" /> : <b>{day.dayNumber}</b>}
            </button>
          ))}
        </div>

      </article>

      <section className="sport-layout">
        <article className="panel sport-calendar-panel" ref={calendarRef}>
          <div className="panel-heading compact sport-calendar-heading">
            <div className="sport-month-nav" aria-label="Месяц">
              <button
                className="icon-button"
                type="button"
                onClick={() => setVisibleMonth((current) => addMonths(current, -1))}
                aria-label="Предыдущий месяц"
                title="Предыдущий месяц"
              >
                <ChevronLeft size={18} />
              </button>
              <strong>{formatMonthLabel(visibleMonth)}</strong>
              <button
                className="icon-button"
                type="button"
                onClick={() => setVisibleMonth((current) => addMonths(current, 1))}
                aria-label="Следующий месяц"
                title="Следующий месяц"
              >
                <ChevronRight size={18} />
              </button>
            </div>
          </div>

          <div className="sport-weekdays" aria-hidden="true">
            {WEEKDAY_LABELS.map((label) => (
              <span key={label}>{label}</span>
            ))}
          </div>

          <div className="sport-calendar-grid">
            {calendarCells.map((cell) => {
              const entry = selectedEntriesByDate.get(cell.key);
              const activities = entry?.activities ?? [];
              const isToday = cell.key === dateKey(today);
              const isSelected = cell.key === selectedDate;
              const activityDetails = activities
                .map((activityKey) => catalogByKey.get(activityKey))
                .filter((activity): activity is SportActivityCatalogEntry => Boolean(activity));

              return (
                <button
                  className={[
                    "sport-day-button",
                    cell.inMonth ? "" : "muted",
                    isToday ? "today" : "",
                    isSelected ? "selected" : "",
                    activities.length > 0 ? "has-activity" : "",
                    entry?.sick ? "sick" : ""
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  key={cell.key}
                  type="button"
                  onClick={() => selectCalendarDate(cell)}
                  aria-pressed={isSelected}
                  aria-label={`${formatLongDate(cell.date)}: ${entry?.sick ? "больничный, " : ""}${activityDetails
                    .map((activity) => activity.label)
                    .join(", ") || "без занятий"}${
                    entry?.runDistanceKm ? `, ${formatDistanceKm(entry.runDistanceKm)} км` : ""
                  }${entry ? formatMaxRepsAria(entry.maxReps) : ""}`}
                >
                  <span className="sport-day-number">{cell.date.getDate()}</span>
                  <span className="sport-day-marks" aria-hidden="true">
                    {entry?.sick ? <Stethoscope size={17} aria-hidden="true" /> : null}
                    {activityDetails.slice(0, 1).map((activity) => {
                      const Icon = ACTIVITY_ICONS[activity.key] ?? Activity;
                      return <Icon key={activity.key} size={14} style={{ color: activity.color }} />;
                    })}
                    {activityDetails.length > 1 && <small>+{activityDetails.length - 1}</small>}
                  </span>
                </button>
              );
            })}
          </div>
        </article>

        <article className="panel sport-day-panel" ref={dayPanelRef} tabIndex={-1} aria-label="Выбранный день">
          <button className="sport-back-to-calendar disclosure-button" type="button" onClick={() => {
            calendarRef.current?.scrollIntoView({ block: "start" });
            calendarRef.current?.querySelector<HTMLButtonElement>(".sport-day-button.selected")?.focus({ preventScroll: true });
          }}>К календарю</button>
          <div className="panel-heading compact">
            <div>
              <h2>{formatLongDate(selectedDateObject)}</h2>

            </div>
            {savingDate === selectedDate && <RefreshCw className="spin" size={20} aria-label="Сохранение" />}
          </div>

          <div className="sport-sick-control">
            <button
              className={`sport-sick-button${selectedDateSick ? " active" : ""}`}
              type="button"
              aria-pressed={selectedDateSick}
              disabled={savingDate !== null}
              onClick={() => void saveSportDay(selectedDateActivities, selectedDateRunDistanceKm, selectedDateMaxReps, !selectedDateSick)}
            >
              <Stethoscope size={18} />
              <span>Больничный</span>
              {selectedDateSick ? <Check size={17} /> : null}
            </button>
          </div>

          <ActivityPicker key={`${selectedUserId}-${selectedDate}`} options={activityOptions}
            selected={selectedDateActivities} disabled={savingDate !== null} onToggle={toggleActivity} />

          {selectedDateHasRun ? (
            <form className="sport-run-distance-form" onSubmit={saveRunDistance}>
              <label htmlFor="sport-run-distance">
                <Footprints size={16} />
                <span>Дистанция забега</span>
              </label>
              <div className="sport-run-distance-row">
                <div className="sport-run-distance-input-shell">
                  <input
                    id="sport-run-distance"
                    type="text"
                    inputMode="decimal"
                    value={runDistanceDraft}
                    onChange={(event) => {
                      setRunDistanceDraft(event.target.value);
                      setRunDistanceError(null);
                    }}
                    placeholder="0,00"
                    disabled={savingDate !== null}
                    aria-invalid={Boolean(runDistanceMessage)}
                  />
                  <span>км</span>
                </div>
                <button
                  className="sport-run-distance-save"
                  type="submit"
                  disabled={savingDate !== null || !runDistanceDirty}
                >
                  <Check size={16} />
                  <span>Сохранить</span>
                </button>
              </div>
              {runDistanceMessage ? (
                <span className="sport-run-distance-error">{runDistanceMessage}</span>
              ) : null}
            </form>
          ) : null}

          {activeRepMetrics.length > 0 ? (
            <div className="sport-rep-max-forms" aria-label="Максимумы повторений">
              {activeRepMetrics.map((metric) => {
                const Icon = metric.Icon;
                const parseResult = maxRepsParseResults[metric.key];
                const message = maxRepsErrors[metric.key] ?? parseResult.error;
                const dirty = !parseResult.error && parseResult.value !== selectedDateMaxReps[metric.key];

                return (
                  <form
                    className="sport-rep-max-form"
                    key={metric.key}
                    onSubmit={(event) => saveMaxReps(metric, event)}
                  >
                    <label htmlFor={`sport-${metric.key}-max-reps`}>
                      <Icon size={16} />
                      <span>{metric.label}</span>
                    </label>
                    <div className="sport-rep-max-row">
                      <div className="sport-rep-max-input-shell">
                        <input
                          id={`sport-${metric.key}-max-reps`}
                          type="text"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          value={maxRepsDrafts[metric.key]}
                          onChange={(event) => {
                            setMaxRepsDrafts((current) => ({
                              ...current,
                              [metric.key]: event.target.value
                            }));
                            setMaxRepsErrors((current) => ({
                              ...current,
                              [metric.key]: null
                            }));
                          }}
                          placeholder="0"
                          disabled={savingDate !== null}
                          aria-invalid={Boolean(message)}
                        />
                        <span>раз</span>
                      </div>
                      <button
                        className="sport-rep-max-save"
                        type="submit"
                        disabled={savingDate !== null || !dirty}
                      >
                        <Check size={16} />
                        <span>Сохранить</span>
                      </button>
                    </div>
                    {message ? <span className="sport-rep-max-error">{message}</span> : null}
                  </form>
                );
              })}
            </div>
          ) : null}

          {selectedDateActivities.length > 0 || selectedDateSick ? (
            <button
              className="sport-clear-button"
              type="button"
              onClick={() => void saveSportDay([], null, EMPTY_MAX_REPS, false)}
              disabled={savingDate !== null}
            >
              <CircleOff size={17} />
              <span>Снять отметки</span>
            </button>
          ) : null}
        </article>
      </section>
    </div>
  );
}
