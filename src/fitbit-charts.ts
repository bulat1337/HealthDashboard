import type { FitbitDay, FitbitSleep, FitbitSleepSegment } from "./fitbit-types";

export function sleepDuration(minutes: number | null | undefined) {
  if (minutes == null || !Number.isFinite(minutes)) return "—";
  const rounded = Math.round(minutes);
  return rounded < 60 ? `${rounded} мин` : `${Math.floor(rounded / 60)} ч ${String(rounded % 60).padStart(2, "0")} мин`;
}

export function segmentMinutes(segments: { start: string; end: string }[]) {
  const intervals = segments.map(({ start, end }) => [Date.parse(start), Date.parse(end)])
    .filter(([start, end]) => Number.isFinite(start) && Number.isFinite(end) && end > start)
    .sort((a, b) => a[0] - b[0]);
  let total = 0, lastEnd = -Infinity;
  for (const [start, end] of intervals) {
    total += Math.max(0, end - Math.max(start, lastEnd));
    lastEnd = Math.max(lastEnd, end);
  }
  return total / 60_000;
}

export function sleepQuality(sleep: FitbitSleep) {
  return {
    latency: sleep.minutesToFallAsleep ?? null,
    deep: sleep.stages.DEEP ?? null,
    restless: sleep.stages.RESTLESS ?? (sleep.shortAwakenings?.length ? segmentMinutes(sleep.shortAwakenings) : null),
    breaks: sleep.outOfBed ? segmentMinutes(sleep.outOfBed) : null,
  };
}

export type SleepQualityKey = keyof ReturnType<typeof sleepQuality>;

export function personalSleepRange(days: FitbitDay[], date: string, key: SleepQualityKey) {
  const cutoff = Date.parse(`${date}T12:00:00Z`) - 30 * 86_400_000;
  const values = days.filter((day) => day.date < date && Date.parse(`${day.date}T12:00:00Z`) >= cutoff)
    .flatMap((day) => day.sleep && day.sleep.processed !== false ? [sleepQuality(day.sleep)[key]] : [])
    .filter((value): value is number => value != null && Number.isFinite(value) && value >= 0)
    .sort((a, b) => a - b);
  if (values.length < 7) return null;
  const quantile = (q: number) => {
    const index = (values.length - 1) * q, lower = Math.floor(index);
    return values[lower] + (values[Math.ceil(index)] - values[lower]) * (index - lower);
  };
  return { min: quantile(.1), max: quantile(.9), nights: values.length };
}

export function sleepClock(sleep: FitbitSleep, time: number) {
  if (sleep.bedtime) {
    const [hours, minutes] = sleep.bedtime.split(":").map(Number);
    const minute = ((hours * 60 + minutes + Math.round((time - Date.parse(sleep.start)) / 60_000)) % 1440 + 1440) % 1440;
    return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
  }
  return new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" }).format(time);
}

export function stageSegments(sleep: FitbitSleep, stage: FitbitSleepSegment["type"]) {
  return (sleep.timeline ?? []).filter((segment) => segment.type === stage);
}
