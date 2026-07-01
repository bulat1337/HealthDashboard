import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  Bike,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleOff,
  Dumbbell,
  Flame,
  Footprints,
  RefreshCw,
  Target,
  Trophy,
  Users
} from "lucide-react";
import { fetchSportData, updateSportDay } from "../api";
import type {
  SportActivityCatalogEntry,
  SportActivityKey,
  SportData,
  SportEntry,
  SportUser
} from "../types";

type SportDashboardProps = {
  today: Date;
  refreshKey: number;
};

type SportStats = {
  currentStreak: number;
  bestStreak: number;
  monthDays: number;
  monthActivities: number;
  weekWorkoutDays: number;
  weekWorkoutDaysRemaining: number;
  weekRestDaysRemaining: number;
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

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_LENGTH_DAYS = 7;
const WEEKLY_WORKOUT_TARGET = 4;
const WEEKLY_REST_ALLOWANCE = WEEK_LENGTH_DAYS - WEEKLY_WORKOUT_TARGET;
const WEEKDAY_LABELS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

const ACTIVITY_ICONS: Record<SportActivityKey, LucideIcon> = {
  run: Footprints,
  pilates: Activity,
  strength_lower: Dumbbell,
  strength_upper: Dumbbell,
  strength_whole: Dumbbell,
  cycling: Bike
};

const STRENGTH_ACTIVITY_KEYS: SportActivityKey[] = [
  "strength_whole",
  "strength_upper",
  "strength_lower",
];
const STRENGTH_ACTIVITY_KEY_SET = new Set<SportActivityKey>(STRENGTH_ACTIVITY_KEYS);
const DEFAULT_STRENGTH_ACTIVITY_KEY: SportActivityKey = "strength_whole";
const STRENGTH_VARIANT_LABELS: Record<SportActivityKey, string> = {
  run: "Бег",
  pilates: "Пилатес",
  strength_lower: "Lower body",
  strength_upper: "Upper body",
  strength_whole: "Whole body",
  cycling: "Велотренировка"
};

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

function previousWeekKey(key: string) {
  return dateKey(addDays(parseDateKey(key), -WEEK_LENGTH_DAYS));
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

function buildCalendarCells(month: Date): CalendarCell[] {
  const firstDay = startOfMonth(month);
  const mondayOffset = (firstDay.getDay() + 6) % 7;
  const gridStart = addDays(firstDay, -mondayOffset);

  return Array.from({ length: 42 }, (_, index) => {
    const date = addDays(gridStart, index);
    return {
      date,
      key: dateKey(date),
      inMonth: date.getMonth() === firstDay.getMonth()
    };
  });
}

function entryMap(entries: SportEntry[]) {
  return new Map(entries.map((entry) => [entry.date, entry.activities]));
}

function activityDateSet(user: SportUser) {
  return new Set(user.entries.filter((entry) => entry.activities.length > 0).map((entry) => entry.date));
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

function fulfilledWeekSet(dates: Set<string>, todayKey: string) {
  const weekCounts = new Map<string, number>();
  for (const key of dates) {
    if (key > todayKey) continue;
    const weekKey = dateKey(startOfWeek(parseDateKey(key)));
    weekCounts.set(weekKey, (weekCounts.get(weekKey) ?? 0) + 1);
  }

  return new Set(
    [...weekCounts.entries()]
      .filter(([, workoutDays]) => workoutDays >= WEEKLY_WORKOUT_TARGET)
      .map(([weekKey]) => weekKey)
  );
}

function countWeekStreakBackwards(weeks: Set<string>, anchorWeekKey: string) {
  let count = 0;
  let cursor = anchorWeekKey;
  while (weeks.has(cursor)) {
    count += 1;
    cursor = previousWeekKey(cursor);
  }
  return count;
}

function calculateCurrentWeekStreak(
  weeks: Set<string>,
  currentWeekKey: string,
  currentWeekFulfilled: boolean,
  currentWeekViable: boolean
) {
  if (currentWeekFulfilled) return countWeekStreakBackwards(weeks, currentWeekKey);
  if (currentWeekViable) return countWeekStreakBackwards(weeks, previousWeekKey(currentWeekKey));
  return 0;
}

function calculateBestWeekStreak(weeks: Set<string>) {
  const sorted = [...weeks].sort();
  let best = 0;
  let current = 0;
  let previous: string | null = null;

  for (const key of sorted) {
    current = previous && previousWeekKey(key) === previous ? current + 1 : 1;
    best = Math.max(best, current);
    previous = key;
  }

  return best;
}

function calculateSportStats(user: SportUser, today: Date, visibleMonth: Date): SportStats {
  const dates = activityDateSet(user);
  const todayKey = dateKey(today);
  const currentWeekStart = startOfWeek(today);
  const currentWeekKey = dateKey(currentWeekStart);
  const currentWeekEndKey = dateKey(addDays(currentWeekStart, WEEK_LENGTH_DAYS - 1));
  const monthPrefix = dateKey(startOfMonth(visibleMonth)).slice(0, 7);
  const monthEntries = user.entries.filter((entry) => entry.date.startsWith(monthPrefix));
  const pastOrTodayEntries = user.entries.filter((entry) => entry.date <= todayKey);
  const lastWorkoutDate = pastOrTodayEntries[pastOrTodayEntries.length - 1]?.date ?? null;
  const todayDone = dates.has(todayKey);
  const daysBeforeToday = dayDistance(currentWeekStart, today);
  const workoutsBeforeToday = daysBeforeToday > 0
    ? countWorkoutDays(dates, currentWeekKey, previousDateKey(todayKey))
    : 0;
  const weekWorkoutDays = countWorkoutDays(dates, currentWeekKey, todayKey);
  const weekRestDaysUsed = daysBeforeToday - workoutsBeforeToday;
  const weekRestDaysRemaining = Math.max(0, WEEKLY_REST_ALLOWANCE - weekRestDaysUsed);
  const weekWorkoutDaysRemaining = Math.max(0, WEEKLY_WORKOUT_TARGET - weekWorkoutDays);
  const daysRemainingAfterToday = Math.max(0, dayDistance(today, parseDateKey(currentWeekEndKey)));
  const availableWorkoutDays = daysRemainingAfterToday + (todayDone ? 0 : 1);
  const currentWeekFulfilled = weekWorkoutDays >= WEEKLY_WORKOUT_TARGET;
  const currentWeekViable =
    currentWeekFulfilled ||
    (weekRestDaysUsed <= WEEKLY_REST_ALLOWANCE && weekWorkoutDaysRemaining <= availableWorkoutDays);
  const fulfilledWeeks = fulfilledWeekSet(dates, todayKey);

  return {
    currentStreak: calculateCurrentWeekStreak(
      fulfilledWeeks,
      currentWeekKey,
      currentWeekFulfilled,
      currentWeekViable
    ),
    bestStreak: calculateBestWeekStreak(fulfilledWeeks),
    monthDays: monthEntries.length,
    monthActivities: monthEntries.reduce((sum, entry) => sum + entry.activities.length, 0),
    weekWorkoutDays,
    weekWorkoutDaysRemaining,
    weekRestDaysRemaining,
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

function getStrengthActivity(activities: SportActivityKey[]) {
  return activities.find((activity) => STRENGTH_ACTIVITY_KEY_SET.has(activity)) ?? null;
}

function withoutStrengthActivities(activities: SportActivityKey[]) {
  return activities.filter((activity) => !STRENGTH_ACTIVITY_KEY_SET.has(activity));
}

function streakStatus(stats: SportStats) {
  if (stats.currentWeekFulfilled) return "неделя закрыта";
  if (!stats.currentWeekViable) return "неделя сорвана";
  if (stats.currentStreak > 0) return "стрик держится";
  return "стрик готов к старту";
}

function monthWorkoutLabel(value: number) {
  return pluralRu(value, ["день", "дня", "дней"]);
}

export function SportDashboard({ today, refreshKey }: SportDashboardProps) {
  const [data, setData] = useState<SportData | null>(null);
  const [selectedUserId, setSelectedUserId] = useState("bulat");
  const [visibleMonth, setVisibleMonth] = useState(() => startOfMonth(today));
  const [selectedDate, setSelectedDate] = useState(() => dateKey(today));
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingDate, setSavingDate] = useState<string | null>(null);

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

  const selectedDateActivities = selectedEntriesByDate.get(selectedDate) ?? [];
  const selectedDateObject = parseDateKey(selectedDate);
  const availableActivities =
    selectedUser?.activityTypes
      .map((activityKey) => catalogByKey.get(activityKey))
      .filter((activity): activity is SportActivityCatalogEntry => Boolean(activity)) ?? [];
  const availableStrengthActivities = STRENGTH_ACTIVITY_KEYS.map((activityKey) =>
    availableActivities.find((activity) => activity.key === activityKey)
  ).filter((activity): activity is SportActivityCatalogEntry => Boolean(activity));
  const availablePrimaryActivities = availableActivities.filter(
    (activity) => !STRENGTH_ACTIVITY_KEY_SET.has(activity.key)
  );
  const selectedStrengthActivity = getStrengthActivity(selectedDateActivities);
  const defaultStrengthActivity =
    availableStrengthActivities.find((activity) => activity.key === DEFAULT_STRENGTH_ACTIVITY_KEY) ??
    availableStrengthActivities[0] ??
    null;
  const strengthColor = defaultStrengthActivity?.color ?? "#f59e0b";
  const selectedStats = selectedUser ? statsByUser.get(selectedUser.id) : null;
  const selectedStatsValue = selectedStats ?? {
    currentStreak: 0,
    bestStreak: 0,
    monthDays: 0,
    monthActivities: 0,
    weekWorkoutDays: 0,
    weekWorkoutDaysRemaining: WEEKLY_WORKOUT_TARGET,
    weekRestDaysRemaining: WEEKLY_REST_ALLOWANCE,
    currentWeekFulfilled: false,
    currentWeekViable: true,
    todayDone: false,
    lastWorkoutDate: null
  };

  async function saveActivities(nextActivities: SportActivityKey[]) {
    if (!selectedUser) return;

    setSavingDate(selectedDate);
    setError(null);
    try {
      const response = await updateSportDay({
        userId: selectedUser.id,
        date: selectedDate,
        activities: sortActivitiesForUser(selectedUser, nextActivities)
      });
      setData(response.data);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSavingDate(null);
    }
  }

  function toggleActivity(activityKey: SportActivityKey) {
    const selected = new Set(selectedDateActivities);
    if (selected.has(activityKey)) {
      selected.delete(activityKey);
    } else {
      selected.add(activityKey);
    }
    void saveActivities([...selected]);
  }

  function toggleStrengthActivity() {
    if (!defaultStrengthActivity) return;

    if (selectedStrengthActivity) {
      void saveActivities(withoutStrengthActivities(selectedDateActivities));
      return;
    }

    void saveActivities([...withoutStrengthActivities(selectedDateActivities), defaultStrengthActivity.key]);
  }

  function selectStrengthVariant(activityKey: SportActivityKey) {
    if (selectedStrengthActivity === activityKey) return;
    void saveActivities([...withoutStrengthActivities(selectedDateActivities), activityKey]);
  }

  function selectCalendarDate(cell: CalendarCell) {
    setSelectedDate(cell.key);
    if (!cell.inMonth) setVisibleMonth(startOfMonth(cell.date));
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
    <div className="sport-page">
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
              onClick={() => setSelectedUserId(user.id)}
            >
              <Users size={16} />
              <span>{user.name}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="sport-layout">
        <article className="panel sport-calendar-panel">
          <div className="panel-heading compact sport-calendar-heading">
            <div>
              <h2>{selectedUser?.name ?? "Спорт"}</h2>
              <span>
                {selectedStats?.monthDays ?? 0} {monthWorkoutLabel(selectedStats?.monthDays ?? 0)} с занятиями ·{" "}
                {selectedStats?.monthActivities ?? 0}{" "}
                {pluralRu(selectedStats?.monthActivities ?? 0, ["тренировка", "тренировки", "тренировок"])}
              </span>
            </div>
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

          <div className="sport-legend" aria-label="Типы спорта">
            {availableStrengthActivities.length > 0 ? (
              <span className="sport-legend-strength">
                <span className="sport-legend-swatch-stack" aria-hidden="true">
                  {availableStrengthActivities.map((activity) => (
                    <i key={activity.key} style={{ backgroundColor: activity.color }} />
                  ))}
                </span>
                <Dumbbell size={15} />
                <span>Силовая</span>
                <small>whole / upper / lower</small>
              </span>
            ) : null}
            {availablePrimaryActivities.map((activity) => {
              const Icon = ACTIVITY_ICONS[activity.key] ?? Activity;
              return (
                <span key={activity.key}>
                  <i style={{ backgroundColor: activity.color }} />
                  <Icon size={15} />
                  {activity.label}
                </span>
              );
            })}
          </div>

          <div className="sport-weekdays" aria-hidden="true">
            {WEEKDAY_LABELS.map((label) => (
              <span key={label}>{label}</span>
            ))}
          </div>

          <div className="sport-calendar-grid">
            {calendarCells.map((cell) => {
              const activities = selectedEntriesByDate.get(cell.key) ?? [];
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
                    activities.length > 0 ? "has-activity" : ""
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  key={cell.key}
                  type="button"
                  onClick={() => selectCalendarDate(cell)}
                  aria-label={`${formatLongDate(cell.date)}: ${activityDetails
                    .map((activity) => activity.label)
                    .join(", ") || "без занятий"}`}
                >
                  <span className="sport-day-number">{cell.date.getDate()}</span>
                  <span className="sport-day-activity-bars">
                    {activityDetails.map((activity) => (
                      <i key={activity.key} style={{ backgroundColor: activity.color }} />
                    ))}
                  </span>
                </button>
              );
            })}
          </div>
        </article>

        <aside className="sport-side-column">
          <article className="panel sport-streak-card sport-streak-panel" aria-label="Стрик выбранного пользователя">
            <div className="sport-streak-card-top">
              <span className="sport-flame-circle">
                <Flame size={22} />
              </span>
              <div>
                <strong>{selectedUser?.name ?? "Спорт"}</strong>
                <span>{streakStatus(selectedStatsValue)}</span>
              </div>
            </div>
            <div className="sport-streak-value">
              <strong>{selectedStatsValue.currentStreak}</strong>
              <span>
                {pluralRu(selectedStatsValue.currentStreak, ["неделя", "недели", "недель"])} подряд
              </span>
            </div>
            <dl className="sport-streak-facts">
              <div>
                <dt>
                  <Trophy size={15} />
                  Лучший
                </dt>
                <dd>{selectedStatsValue.bestStreak}</dd>
              </div>
              <div>
                <dt>
                  <Target size={15} />
                  Неделя
                </dt>
                <dd>{selectedStatsValue.weekWorkoutDays}/{WEEKLY_WORKOUT_TARGET}</dd>
              </div>
              <div>
                <dt>
                  <CircleOff size={15} />
                  Отдых
                </dt>
                <dd>{selectedStatsValue.weekRestDaysRemaining}</dd>
              </div>
              <div>
                <dt>
                  <Activity size={15} />
                  До цели
                </dt>
                <dd>{selectedStatsValue.weekWorkoutDaysRemaining}</dd>
              </div>
            </dl>
          </article>

        <article className="panel sport-day-panel">
          <div className="panel-heading compact">
            <div>
              <h2>Выбранный день</h2>
              <span>
                {selectedUser?.name ?? "Пользователь"} · {formatLongDate(selectedDateObject)}
              </span>
            </div>
            {savingDate === selectedDate ? <RefreshCw className="spin" size={22} /> : <Check size={22} />}
          </div>

          <div className="sport-activity-actions">
            {defaultStrengthActivity ? (
              <div
                className={[
                  "sport-strength-group",
                  selectedStrengthActivity ? "active" : ""
                ]
                  .filter(Boolean)
                  .join(" ")}
                style={{ "--activity-color": strengthColor } as CSSProperties}
              >
                <button
                  className={selectedStrengthActivity ? "sport-strength-toggle active" : "sport-strength-toggle"}
                  type="button"
                  onClick={toggleStrengthActivity}
                  disabled={savingDate !== null}
                  aria-pressed={Boolean(selectedStrengthActivity)}
                  aria-label={`Силовая: ${
                    selectedStrengthActivity
                      ? STRENGTH_VARIANT_LABELS[selectedStrengthActivity]
                      : "Whole body по умолчанию"
                  }`}
                >
                  <Dumbbell size={18} />
                  <span className="sport-strength-label">
                    <strong>Силовая</strong>
                    <small>
                      {selectedStrengthActivity
                        ? STRENGTH_VARIANT_LABELS[selectedStrengthActivity]
                        : "Whole body по умолчанию"}
                    </small>
                  </span>
                  {selectedStrengthActivity ? <Check size={17} /> : null}
                </button>

                {selectedStrengthActivity ? (
                  <div className="sport-strength-variants" aria-label="Уточнение силовой тренировки">
                    {availableStrengthActivities.map((activity) => {
                      const checked = selectedStrengthActivity === activity.key;
                      return (
                        <button
                          className={checked ? "active" : ""}
                          key={activity.key}
                          type="button"
                          onClick={() => selectStrengthVariant(activity.key)}
                          disabled={savingDate !== null}
                          aria-pressed={checked}
                          style={{ "--activity-color": activity.color } as CSSProperties}
                        >
                          {STRENGTH_VARIANT_LABELS[activity.key]}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            ) : null}

            {availablePrimaryActivities.map((activity) => {
              const Icon = ACTIVITY_ICONS[activity.key] ?? Activity;
              const checked = selectedDateActivities.includes(activity.key);
              return (
                <button
                  className={checked ? "sport-activity-action active" : "sport-activity-action"}
                  key={activity.key}
                  type="button"
                  onClick={() => toggleActivity(activity.key)}
                  disabled={savingDate !== null}
                  aria-pressed={checked}
                  style={{ "--activity-color": activity.color } as CSSProperties}
                >
                  <Icon size={18} />
                  <span>{activity.label}</span>
                  {checked ? <Check size={17} /> : null}
                </button>
              );
            })}
          </div>

          <div className="sport-day-summary">
            <div>
              <strong>{selectedDateActivities.length}</strong>
              <span>
                {pluralRu(selectedDateActivities.length, ["активность", "активности", "активностей"])}
              </span>
            </div>
            <div>
              <strong>{selectedStats?.currentStreak ?? 0}</strong>
              <span>недельный стрик</span>
            </div>
          </div>

          {selectedDateActivities.length > 0 ? (
            <button
              className="sport-clear-button"
              type="button"
              onClick={() => saveActivities([])}
              disabled={savingDate !== null}
            >
              <CircleOff size={17} />
              <span>Снять отметки</span>
            </button>
          ) : (
            <div className="sport-empty-day">
              <CircleAlert size={18} />
              <span>Пустой день</span>
            </div>
          )}

          <div className="sport-last-workout">
            <span>Последняя тренировка</span>
            <strong>
              {selectedStats?.lastWorkoutDate
                ? formatLongDate(parseDateKey(selectedStats.lastWorkoutDate))
                : "—"}
            </strong>
          </div>
        </article>
        </aside>
      </section>
    </div>
  );
}
