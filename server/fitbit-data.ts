import type {
  FitbitDay,
  FitbitExercise,
  FitbitSleep,
  FitbitSleepStage,
  FitbitHeartRatePoint,
  FitbitHeartRateZone,
} from "../src/fitbit-types.js";

// Google Health v4 REST field names (including int64 values serialized as strings).
export type JsonObject = Record<string, unknown>;
export const object = (value: unknown): JsonObject =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
export const list = (value: unknown): JsonObject[] =>
  Array.isArray(value) ? value.map(object) : [];
export function numeric(value: unknown): number | null {
  if (typeof value !== "number" && (typeof value !== "string" || !value.trim()))
    return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

export function dateString(value: unknown): string | null {
  const date = object(value);
  const year = numeric(date.year),
    month = numeric(date.month),
    day = numeric(date.day);
  if (year === null || month === null || day === null) return null;
  const iso = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const physical = new Date(`${iso}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) &&
    Number.isFinite(physical.getTime()) &&
    physical.toISOString().slice(0, 10) === iso
    ? iso
    : null;
}

export function addDays(date: string, amount: number) {
  const result = new Date(`${date}T12:00:00Z`);
  result.setUTCDate(result.getUTCDate() + amount);
  return result.toISOString().slice(0, 10);
}

export function localDate(now: Date, timezone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function emptyDay(date: string): FitbitDay {
  return {
    date,
    steps: null,
    distanceKm: null,
    calories: null,
    activeZoneMinutes: null,
    restingHeartRate: null,
    hrv: null,
    spo2: null,
    respiratoryRate: null,
    temperatureDeviation: null,
    sleep: null,
  };
}

export const SOURCE_FIELDS = {
  steps: ["steps"],
  distance: ["distanceKm"],
  "total-calories": ["calories"],
  "active-zone-minutes": ["activeZoneMinutes"],
  "daily-resting-heart-rate": ["restingHeartRate"],
  "daily-heart-rate-variability": ["hrv"],
  "daily-oxygen-saturation": ["spo2"],
  "daily-respiratory-rate": ["respiratoryRate"],
  "daily-sleep-temperature-derivations": ["temperatureDeviation"],
  sleep: ["sleep"],
  "heart-rate": ["heartRate"],
  "daily-heart-rate-zones": ["heartRateZones"],
  exercise: [],
} as const;
export type FitbitSource = keyof typeof SOURCE_FIELDS;
export type FitbitSourceResult = { source: FitbitSource; points: JsonObject[]; windowStart?: string };

function civilClock(value: unknown): string | null {
  const civil = object(value);
  if (!dateString(civil.date)) return null;
  const time = object(civil.time);
  const hours = numeric(time.hours) ?? 0,
    minutes = numeric(time.minutes) ?? 0;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function intervalDate(
  interval: JsonObject,
  end: boolean,
  timezone: string,
): string | null {
  const civil = object(interval[end ? "civilEndTime" : "civilStartTime"]);
  const explicit = dateString(civil.date);
  if (explicit) return explicit;
  const physical = interval[end ? "endTime" : "startTime"];
  if (typeof physical !== "string" || !Number.isFinite(Date.parse(physical)))
    return null;
  // Preserve the source's UTC offset across travel when civil time is absent.
  const offset = interval[end ? "endUtcOffset" : "startUtcOffset"];
  if (typeof offset === "string" && /^-?\d+(\.\d+)?s$/.test(offset)) {
    return new Date(Date.parse(physical) + Number(offset.slice(0, -1)) * 1000)
      .toISOString()
      .slice(0, 10);
  }
  return localDate(new Date(physical), timezone);
}

const STAGES: FitbitSleepStage[] = [
  "AWAKE",
  "LIGHT",
  "DEEP",
  "REM",
  "ASLEEP",
  "RESTLESS",
];

function sleepSegments(value: unknown, start: string, end: string) {
  return list(value).flatMap((segment) => {
    const from = Math.max(Date.parse(String(segment.startTime)), Date.parse(start));
    const to = Math.min(Date.parse(String(segment.endTime)), Date.parse(end));
    return Number.isFinite(from) && Number.isFinite(to) && to > from
      ? [{ start: new Date(from).toISOString(), end: new Date(to).toISOString(),
          type: segment.type as FitbitSleepStage }]
      : [];
  }).sort((a, b) => a.start.localeCompare(b.start));
}

function intervalClock(interval: JsonObject, end: boolean, timezone: string) {
  const civil = civilClock(interval[end ? "civilEndTime" : "civilStartTime"]);
  if (civil) return civil;
  const physical = interval[end ? "endTime" : "startTime"];
  if (typeof physical !== "string" || !Number.isFinite(Date.parse(physical))) return null;
  const offset = interval[end ? "endUtcOffset" : "startUtcOffset"];
  if (typeof offset === "string" && /^-?\d+(\.\d+)?s$/.test(offset))
    return new Date(Date.parse(physical) + Number(offset.slice(0, -1)) * 1000).toISOString().slice(11, 16);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(new Date(physical));
}

function normalizeSleep(raw: JsonObject, timezone: string): FitbitSleep | null {
  const interval = object(raw.interval);
  if (
    typeof interval.startTime !== "string" ||
    typeof interval.endTime !== "string" ||
    !Number.isFinite(Date.parse(interval.startTime)) ||
    !Number.isFinite(Date.parse(interval.endTime)) ||
    Date.parse(interval.endTime) <= Date.parse(interval.startTime)
  )
    return null;
  const stages: FitbitSleep["stages"] = {};
  for (const stage of list(object(raw.summary).stagesSummary)) {
    if (
      STAGES.includes(stage.type as FitbitSleepStage) &&
      numeric(stage.minutes) !== null
    ) {
      stages[stage.type as FitbitSleepStage] = numeric(stage.minutes)!;
    }
  }
  return {
    start: interval.startTime,
    end: interval.endTime,
    bedtime: intervalClock(interval, false, timezone),
    wakeTime: intervalClock(interval, true, timezone),
    minutesAsleep: numeric(object(raw.summary).minutesAsleep),
    minutesAwake: numeric(object(raw.summary).minutesAwake),
    stages,
    timeline: sleepSegments(raw.stages, interval.startTime, interval.endTime)
      .filter((segment) => STAGES.includes(segment.type)),
    shortAwakenings: sleepSegments(raw.shortAwakenings, interval.startTime, interval.endTime)
      .map((segment) => ({ ...segment, type: "AWAKE" as const })),
    outOfBed: Array.isArray(raw.outOfBedSegments)
      ? sleepSegments(raw.outOfBedSegments, interval.startTime, interval.endTime)
          .map(({ start, end }) => ({ start, end }))
      : undefined,
    minutesToFallAsleep: numeric(object(raw.summary).minutesToFallAsleep),
    processed:
      typeof object(raw.metadata).processed === "boolean"
        ? (object(raw.metadata).processed as boolean)
        : null,
  };
}

/** Replace successful sources in the fetched civil-date window. Failed sources keep their cache. */
export function mergeFitbitData(
  previous: { days: FitbitDay[]; exercises: FitbitExercise[] },
  results: FitbitSourceResult[],
  start: string,
  end: string,
  timezone: string,
) {
  const days = new Map(previous.days.map((day) => [day.date, { ...day }]));
  for (let date = start; date < end; date = addDays(date, 1)) {
    const day = days.get(date) ?? emptyDay(date);
    for (const result of results)
      for (const field of SOURCE_FIELDS[result.source]) {
        // Both null and explicit zero are significant in the public schema.
        if (!result.windowStart || date >= result.windowStart)
          Object.assign(day, { [field]: null });
      }
    days.set(date, day);
  }
  let exercises = results.some((result) => result.source === "exercise")
    ? previous.exercises.filter(
        (entry) => entry.date < start || entry.date >= end,
      )
    : [...previous.exercises];
  for (const { source, points, windowStart } of results) {
    const heartMinutes = new Map<string, Map<string, FitbitHeartRatePoint>>();
    // Sleep list order is unspecified here; prefer main sleep, then longest session.
    const sleepPriority = new Map<string, number>();
    for (const point of points) {
      const field = source.replace(/-([a-z])/g, (_match, character: string) =>
        character.toUpperCase(),
      );
      const raw = object(point[field]);
      const interval = object(raw.interval);
      const sample = object(raw.sampleTime);
      const date = source === "heart-rate"
        ? intervalDate({ civilStartTime: sample.civilTime, startTime: sample.physicalTime,
            startUtcOffset: sample.utcOffset }, false, timezone)
        : [
        "steps",
        "distance",
        "total-calories",
        "active-zone-minutes",
      ].includes(source)
        ? dateString(object(point.civilStartTime).date)
        : source === "sleep" || source === "exercise"
          ? intervalDate(interval, source === "sleep", timezone)
          : dateString(raw.date);
      if (!date || date < start || date < (windowStart ?? start) || date >= end) continue;
      const day = days.get(date)!;
      if (source === "heart-rate") {
        const bpm = numeric(raw.beatsPerMinute), time = sample.physicalTime;
        if (bpm === null || bpm < 1 || bpm > 300 || typeof time !== "string" || !Number.isFinite(Date.parse(time))) continue;
        const clock = civilClock(sample.civilTime) ?? new Intl.DateTimeFormat("en-GB", {
          timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
        }).format(new Date(time));
        // Source offsets take priority over the profile timezone when travelling.
        const offsetClock = typeof sample.utcOffset === "string" && /^-?\d+(\.\d+)?s$/.test(sample.utcOffset)
          ? new Date(Date.parse(time) + Number(sample.utcOffset.slice(0, -1)) * 1000).toISOString().slice(11, 16)
          : clock;
        const [hour, minute] = (civilClock(sample.civilTime) ?? offsetClock).split(":").map(Number);
        const minutes = heartMinutes.get(date) ?? new Map<string, FitbitHeartRatePoint>();
        heartMinutes.set(date, minutes);
        const key = new Date(Math.floor(Date.parse(time) / 60_000) * 60_000).toISOString();
        const existing = minutes.get(key);
        if (existing) {
          existing.bpm = (existing.bpm * existing.count + bpm) / (existing.count + 1);
          existing.count += 1;
          existing.min = Math.min(existing.min, bpm);
          existing.max = Math.max(existing.max, bpm);
        } else minutes.set(key, { time: key, minute: hour * 60 + minute, bpm, min: bpm, max: bpm, count: 1 });
      }
      if (source === "daily-heart-rate-zones") {
        const types = ["LIGHT", "MODERATE", "VIGOROUS", "PEAK"];
        day.heartRateZones = list(raw.heartRateZones).flatMap((zone) => {
          const min = numeric(zone.minBeatsPerMinute), max = numeric(zone.maxBeatsPerMinute);
          return types.includes(String(zone.heartRateZoneType)) && min !== null && max !== null && min >= 0 && max > min
            ? [{ type: zone.heartRateZoneType as FitbitHeartRateZone["type"], min, max }] : [];
        }).sort((a, b) => a.min - b.min);
      }
      if (source === "steps") day.steps = numeric(object(point.steps).countSum);
      if (source === "distance") {
        const millimeters = numeric(object(point.distance).millimetersSum);
        day.distanceKm = millimeters === null ? null : millimeters / 1_000_000;
      }
      if (source === "total-calories")
        day.calories = numeric(object(point.totalCalories).kcalSum);
      if (source === "active-zone-minutes") {
        const zone = object(point.activeZoneMinutes);
        const values = [
          zone.sumInFatBurnHeartZone,
          zone.sumInCardioHeartZone,
          zone.sumInPeakHeartZone,
        ].map(numeric);
        day.activeZoneMinutes = values.every((value) => value === null)
          ? null
          : values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
      }
      if (source === "daily-resting-heart-rate")
        day.restingHeartRate = numeric(raw.beatsPerMinute);
      if (source === "daily-heart-rate-variability")
        day.hrv = numeric(raw.averageHeartRateVariabilityMilliseconds);
      if (source === "daily-oxygen-saturation")
        day.spo2 = numeric(raw.averagePercentage);
      if (source === "daily-respiratory-rate")
        day.respiratoryRate = numeric(raw.breathsPerMinute);
      if (source === "daily-sleep-temperature-derivations") {
        const temperature = numeric(raw.nightlyTemperatureCelsius),
          baseline = numeric(raw.baselineTemperatureCelsius);
        day.temperatureDeviation =
          temperature === null || baseline === null
            ? null
            : temperature - baseline;
      }
      if (source === "sleep") {
        const sleep = normalizeSleep(raw, timezone);
        if (!sleep) continue;
        const priority =
          (object(raw.metadata).mainSleep === true ? 100_000 : 0) +
          (Date.parse(sleep.end) - Date.parse(sleep.start)) / 60_000;
        if (priority > (sleepPriority.get(date) ?? -1)) {
          day.sleep = sleep;
          sleepPriority.set(date, priority);
        }
      }
      if (source === "exercise") {
        const summary = object(raw.metricsSummary);
        const startTime = interval.startTime,
          endTime = interval.endTime;
        if (
          typeof startTime !== "string" ||
          typeof endTime !== "string" ||
          !Number.isFinite(Date.parse(startTime)) ||
          !Number.isFinite(Date.parse(endTime))
        )
          continue;
        const millimeters = numeric(summary.distanceMillimeters);
        exercises.push({
          id:
            typeof point.dataPointName === "string"
              ? point.dataPointName
              : typeof point.name === "string"
                ? point.name
                : `${startTime}:${String(raw.exerciseType)}`,
          date,
          start: startTime,
          label:
            typeof raw.displayName === "string"
              ? raw.displayName
              : "Тренировка",
          type:
            typeof raw.exerciseType === "string" ? raw.exerciseType : "OTHER",
          durationMinutes: Math.max(
            0,
            (Date.parse(endTime) - Date.parse(startTime)) / 60_000,
          ),
          distanceKm: millimeters === null ? null : millimeters / 1_000_000,
          calories: numeric(summary.caloriesKcal),
          averageHeartRate: numeric(summary.averageHeartRateBeatsPerMinute),
          dataPoint: point,
        });
      }
    }
    for (const [date, minutes] of heartMinutes)
      days.get(date)!.heartRate = [...minutes.values()].sort((a, b) => a.time.localeCompare(b.time));
  }
  const cutoff = addDays(end, -366);
  return {
    days: [...days.values()]
      .filter((day) => day.date >= cutoff)
      .map((day) => day.date < addDays(end, -31) ? { ...day, heartRate: undefined } : day)
      .sort((a, b) => a.date.localeCompare(b.date)),
    exercises: [
      ...new Map(
        exercises
          .filter((entry) => entry.date >= cutoff)
          .map((entry) => [entry.id, entry]),
      ).values(),
    ].sort((a, b) => b.start.localeCompare(a.start)),
  };
}
