import type { MetricStats, NormalizedMeasurement } from "./types";

export type ChartPoint = {
  rowId: number;
  time: number;
  measuredAt: string;
  value: number;
  smoothed: number;
  error: number;
  ciLow: number;
  ciHigh: number;
  isOutlier: boolean;
  statusCode: number | null;
  sameMinuteCount: number;
};

export function round(value: number, digits = 1) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function formatNumber(value: number | null | undefined, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("ru-RU", {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0
  }).format(value);
}

export function formatDateTime(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(iso));
}

export function formatDateShort(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short"
  }).format(new Date(iso));
}

export function formatSigned(value: number | null | undefined, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${formatNumber(value, digits)}`;
}

function average(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sampleSd(values: number[]) {
  if (values.length < 2) return 0;
  const mean = average(values);
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

export function recordsForUser(
  measurements: NormalizedMeasurement[],
  user: string,
  metricKey: string
) {
  return measurements
    .filter((measurement) => measurement.user === user)
    .filter((measurement) => Number.isFinite(measurement.metrics[metricKey]))
    .sort((a, b) => a.measuredAtUnixSeconds - b.measuredAtUnixSeconds);
}

export function buildChartPoints(
  records: NormalizedMeasurement[],
  metricKey: string,
  stats: MetricStats | undefined
): ChartPoint[] {
  const values = records.map((record) => record.metrics[metricKey]);
  const median = stats?.median ?? average(values.length ? values : [0]);
  const robustSigma = stats?.mad && stats.mad > 0 ? stats.mad * 1.4826 : stats?.sd ?? 0;
  const precision = Math.max(stats?.precision ?? 0.1, 0.0001);

  return records.map((record, index) => {
    const value = record.metrics[metricKey];
    const windowStart = Math.max(0, index - 4);
    const windowValues = values.slice(windowStart, index + 1);
    const smoothed = average(windowValues);
    const sd = sampleSd(windowValues);
    const sem = windowValues.length > 1 ? (1.96 * sd) / Math.sqrt(windowValues.length) : 0;
    const error = Math.max(precision / 2, sem, (stats?.meanCi95 ?? 0) / 2);
    const robustZ = robustSigma > 0 ? Math.abs(value - median) / robustSigma : 0;

    return {
      rowId: record.rowId,
      time: record.measuredAtUnixSeconds * 1000,
      measuredAt: record.measuredAt,
      value,
      smoothed,
      error,
      ciLow: smoothed - error,
      ciHigh: smoothed + error,
      isOutlier: robustZ > 3.5,
      statusCode: record.statusCode,
      sameMinuteCount: record.sameMinuteCount
    };
  });
}

export function latestMetricValue(records: NormalizedMeasurement[], metricKey: string) {
  const latest = [...records]
    .reverse()
    .find((measurement) => Number.isFinite(measurement.metrics[metricKey]));
  return latest?.metrics[metricKey] ?? null;
}

export function changeBetweenEdges(records: NormalizedMeasurement[], metricKey: string) {
  const values = records
    .filter((record) => Number.isFinite(record.metrics[metricKey]))
    .map((record) => record.metrics[metricKey]);
  if (values.length < 2) return null;
  return values[values.length - 1] - values[0];
}
