import fs from "node:fs";
import path from "node:path";

type RawMeasurement = {
  row_id?: number;
  user?: string;
  measured_at?: string;
  measured_at_timezone?: string;
  measured_at_unix_seconds?: number;
  measured_at_minute?: string;
  same_minute_index?: number;
  same_minute_count?: number;
  metrics?: Record<string, unknown>;
  heart_rate_bpm?: number | null;
  heart_rate_raw?: number | string | null;
  measurement_status_code?: number | string | null;
  duid?: number | string;
  user_type_code?: number | string;
  account_id?: number | string;
  source?: Record<string, unknown>;
  raw_xiaomi_fields?: Record<string, unknown>;
};

type RawUser = {
  name?: string;
  account_id?: number | string;
  uid?: number | string;
  type_code?: number | string;
  height_cm?: number;
};

type RawData = {
  schema_version?: number;
  source?: Record<string, unknown>;
  users?: RawUser[];
  units?: Record<string, string>;
  measurements?: RawMeasurement[];
};

type IngestOptions = {
  dataDir: string;
  dataFile: string;
  now?: Date;
};

export type IngestResult = {
  duplicate: boolean;
  measurement: RawMeasurement;
  measurementCount: number;
  dataFile: string;
};

const DEFAULT_TIMEZONE = process.env.HEALTH_DEFAULT_TIMEZONE || "UTC";
const DUPLICATE_WINDOW_SECONDS = 15 * 60;
const ESTIMATE_SOURCE_MIN_METRICS = 12;

const WIDE_METRIC_ORDER = [
  "weight_kg",
  "bmi",
  "body_fat_percent",
  "body_score",
  "heart_rate_bpm",
  "muscle_mass_kg",
  "muscle_percent",
  "body_water_percent",
  "body_water_mass_kg",
  "fat_mass_kg",
  "bone_mineral_content_kg",
  "bone_mineral_percent",
  "protein_mass_kg",
  "protein_percent",
  "skeletal_muscle_mass_kg",
  "visceral_fat_rating",
  "basal_metabolic_rate_kcal",
  "estimated_waist_to_hip_ratio",
  "body_age_years",
  "fat_free_body_weight_kg",
  "standard_weight_kg",
  "weight_control_kg",
  "fat_control_raw",
  "muscle_control_kg",
  "body_type_code",
  "bioimpedance_resistance_raw",
  "bioimpedance_resistance_2_raw"
];

const WIDE_META_COLUMNS = [
  "measurement_status_code",
  "duid",
  "user_type_code",
  "account_id",
  "source_model",
  "source_device_id",
  "source_serial_number"
];

const KNOWN_RAW_FIELDS = [
  "timestamp",
  "measured_at",
  "measuredAt",
  "measured_at_unix_seconds",
  "user",
  "user_name",
  "user_slug",
  "profile_id",
  "profileId",
  "duid",
  "user_type_code",
  "weight",
  "weight_kg",
  "mass",
  "mass_kg",
  "bmi",
  "bodyFatPercent",
  "body_fat_percent",
  "waterPercent",
  "body_water_percent",
  "boneMass",
  "bone_mass",
  "muscleMass",
  "muscle_mass",
  "visceralFat",
  "visceral_fat",
  "bmr",
  "metabolicAge",
  "heartRate",
  "heart_rate_bpm",
  "impedance",
  "impedance_low",
  "impedanceLow",
  "physiqueRating",
  "body_score",
  "model",
  "device_model",
  "device_id",
  "serial_number"
];

export class IngestError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberValue(payload: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value.replace(",", "."));
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function stringValue(payload: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function formatDateTime(date: Date, timeZone = DEFAULT_TIMEZONE): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(date);
}

function parseTimestamp(payload: Record<string, unknown>, now: Date): Date {
  const unixSeconds = numberValue(payload, ["measured_at_unix_seconds", "unix_seconds", "time"]);
  if (unixSeconds !== null && unixSeconds > 0) return new Date(unixSeconds * 1000);

  const text = stringValue(payload, ["timestamp", "measured_at", "measuredAt", "date"]);
  if (!text) return now;

  const normalized = text.includes("T") ? text : text.replace(" ", "T");
  const withTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(normalized)
    ? normalized
    : `${normalized}+03:00`;
  const parsed = new Date(withTimezone);
  if (Number.isNaN(parsed.getTime())) {
    throw new IngestError(400, `Invalid measurement timestamp: ${text}`);
  }
  return parsed;
}

function resolveUserName(payload: Record<string, unknown>, raw: RawData): string {
  const direct = stringValue(payload, ["user", "user_name", "name"]);
  if (direct) return direct;

  const profileId = stringValue(payload, ["profile_id", "profileId", "duid", "user_type_code"]);
  if (profileId) {
    const user = (raw.users ?? []).find((candidate) => {
      return [candidate.type_code, candidate.uid, candidate.account_id]
        .filter((value) => value !== undefined && value !== null)
        .map(String)
        .includes(profileId);
    });
    if (user?.name) return user.name;
  }

  throw new IngestError(
    400,
    "Measurement payload must include user/user_name or profile_id matching an existing user"
  );
}

function addMetric(
  metrics: Record<string, number>,
  key: string,
  payload: Record<string, unknown>,
  aliases: string[]
) {
  const value = numberValue(payload, aliases);
  if (value !== null) metrics[key] = value;
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function metricNumber(measurement: RawMeasurement, key: string): number | null {
  const value = measurement.metrics?.[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function metricDigits(key: string) {
  if (
    [
      "basal_metabolic_rate_kcal",
      "body_age_years",
      "body_score",
      "visceral_fat_rating",
      "body_type_code"
    ].includes(key)
  ) {
    return 0;
  }
  if (key === "estimated_waist_to_hip_ratio") return 2;
  return 1;
}

function roundMetric(key: string, value: number) {
  return round(value, metricDigits(key));
}

function hasFullReport(measurement: RawMeasurement) {
  const metricCount = Object.keys(measurement.metrics ?? {}).length;
  return (
    metricCount >= ESTIMATE_SOURCE_MIN_METRICS &&
    measurement.source?.app === "Xiaomi Home" &&
    measurement.raw_xiaomi_fields?.bfp !== undefined
  );
}

function estimateMetricFromHistory(
  raw: RawData,
  userName: string,
  metricKey: string,
  metrics: Record<string, number>
) {
  const targetWeight = metrics.weight_kg;
  if (!Number.isFinite(targetWeight)) return null;
  const targetImpedance = metrics.bioimpedance_resistance_raw;
  const targetLowImpedance = metrics.bioimpedance_resistance_2_raw;

  const samples = (raw.measurements ?? [])
    .filter((measurement) => measurement.user === userName && hasFullReport(measurement))
    .map((measurement) => ({
      value: metricNumber(measurement, metricKey),
      weight: metricNumber(measurement, "weight_kg"),
      impedance: metricNumber(measurement, "bioimpedance_resistance_raw"),
      lowImpedance: metricNumber(measurement, "bioimpedance_resistance_2_raw")
    }))
    .filter(
      (sample): sample is { value: number; weight: number; impedance: number | null; lowImpedance: number | null } =>
        sample.value !== null && sample.weight !== null
    );

  if (samples.length === 0) return null;

  let weightedSum = 0;
  let weightSum = 0;
  for (const sample of samples) {
    const weightDistance = (sample.weight - targetWeight) / 0.8;
    const impedanceDistance =
      sample.impedance !== null && targetImpedance !== undefined
        ? (sample.impedance - targetImpedance) / 28
        : 0;
    const lowImpedanceDistance =
      sample.lowImpedance !== null && targetLowImpedance !== undefined
        ? (sample.lowImpedance - targetLowImpedance) / 28
        : 0;
    const distance = Math.sqrt(
      weightDistance ** 2 + impedanceDistance ** 2 + lowImpedanceDistance ** 2
    );
    const sampleWeight = 1 / (0.35 + distance) ** 2;
    weightedSum += sample.value * sampleWeight;
    weightSum += sampleWeight;
  }

  return weightSum > 0 ? weightedSum / weightSum : null;
}

function fillMetricFromHistory(
  raw: RawData,
  userName: string,
  metrics: Record<string, number>,
  key: string,
  filledKeys: string[]
) {
  if (metrics[key] !== undefined) return;
  const estimate = estimateMetricFromHistory(raw, userName, key, metrics);
  if (estimate === null) return;
  metrics[key] = roundMetric(key, estimate);
  filledKeys.push(key);
}

function completeEstimatedMetrics(raw: RawData, userName: string, metrics: Record<string, number>) {
  const filledKeys: string[] = [];
  const keysToEstimate = [
    "body_fat_percent",
    "body_score",
    "muscle_mass_kg",
    "body_water_percent",
    "bone_mineral_content_kg",
    "protein_percent",
    "skeletal_muscle_mass_kg",
    "visceral_fat_rating",
    "basal_metabolic_rate_kcal",
    "estimated_waist_to_hip_ratio",
    "body_age_years",
    "standard_weight_kg",
    "fat_control_raw",
    "muscle_control_kg",
    "body_type_code"
  ];

  for (const key of keysToEstimate) {
    fillMetricFromHistory(raw, userName, metrics, key, filledKeys);
  }

  if (metrics.weight_kg && metrics.body_fat_percent) {
    metrics.fat_mass_kg = roundMetric(
      "fat_mass_kg",
      (metrics.weight_kg * metrics.body_fat_percent) / 100
    );
  }
  if (metrics.weight_kg && metrics.body_fat_percent) {
    metrics.fat_free_body_weight_kg = roundMetric(
      "fat_free_body_weight_kg",
      metrics.weight_kg - (metrics.weight_kg * metrics.body_fat_percent) / 100
    );
  }
  if (metrics.weight_kg && metrics.muscle_mass_kg) {
    metrics.muscle_percent = roundMetric(
      "muscle_percent",
      (metrics.muscle_mass_kg / metrics.weight_kg) * 100
    );
  }
  if (metrics.weight_kg && metrics.body_water_percent) {
    metrics.body_water_mass_kg = roundMetric(
      "body_water_mass_kg",
      (metrics.weight_kg * metrics.body_water_percent) / 100
    );
  }
  if (metrics.weight_kg && metrics.bone_mineral_content_kg) {
    metrics.bone_mineral_percent = roundMetric(
      "bone_mineral_percent",
      (metrics.bone_mineral_content_kg / metrics.weight_kg) * 100
    );
  }
  if (metrics.weight_kg && metrics.protein_percent) {
    metrics.protein_mass_kg = roundMetric(
      "protein_mass_kg",
      (metrics.weight_kg * metrics.protein_percent) / 100
    );
  }
  if (metrics.weight_kg && metrics.standard_weight_kg) {
    metrics.weight_control_kg = roundMetric(
      "weight_control_kg",
      metrics.standard_weight_kg - metrics.weight_kg
    );
  }

  return filledKeys;
}

function buildMetrics(payload: Record<string, unknown>): Record<string, number> {
  const metrics: Record<string, number> = {};
  addMetric(metrics, "weight_kg", payload, ["weight_kg", "weight", "mass_kg", "mass"]);
  addMetric(metrics, "bmi", payload, ["bmi"]);
  addMetric(metrics, "body_fat_percent", payload, ["body_fat_percent", "bodyFatPercent"]);
  addMetric(metrics, "body_score", payload, ["body_score", "bodyScore"]);
  addMetric(metrics, "muscle_mass_kg", payload, ["muscle_mass_kg", "muscleMass", "muscle_mass"]);
  addMetric(metrics, "muscle_percent", payload, ["muscle_percent", "musclePercent"]);
  addMetric(metrics, "body_water_percent", payload, ["body_water_percent", "waterPercent"]);
  addMetric(metrics, "body_water_mass_kg", payload, ["body_water_mass_kg", "waterMass"]);
  addMetric(metrics, "fat_mass_kg", payload, ["fat_mass_kg", "fatMass"]);
  addMetric(metrics, "bone_mineral_content_kg", payload, ["bone_mineral_content_kg", "boneMass", "bone_mass"]);
  addMetric(metrics, "bone_mineral_percent", payload, ["bone_mineral_percent", "bonePercent"]);
  addMetric(metrics, "protein_mass_kg", payload, ["protein_mass_kg", "proteinMass"]);
  addMetric(metrics, "protein_percent", payload, ["protein_percent", "proteinPercent"]);
  addMetric(metrics, "skeletal_muscle_mass_kg", payload, ["skeletal_muscle_mass_kg", "skeletalMuscleMass"]);
  addMetric(metrics, "visceral_fat_rating", payload, ["visceral_fat_rating", "visceralFat", "visceral_fat"]);
  addMetric(metrics, "basal_metabolic_rate_kcal", payload, ["basal_metabolic_rate_kcal", "bmr"]);
  addMetric(metrics, "estimated_waist_to_hip_ratio", payload, ["estimated_waist_to_hip_ratio", "whr"]);
  addMetric(metrics, "body_age_years", payload, ["body_age_years", "metabolicAge"]);
  addMetric(metrics, "fat_free_body_weight_kg", payload, ["fat_free_body_weight_kg", "leanBodyMass", "lean_body_mass"]);
  addMetric(metrics, "standard_weight_kg", payload, ["standard_weight_kg", "idealWeight"]);
  addMetric(metrics, "weight_control_kg", payload, ["weight_control_kg", "weightControl"]);
  addMetric(metrics, "fat_control_raw", payload, ["fat_control_raw", "fatControl"]);
  addMetric(metrics, "muscle_control_kg", payload, ["muscle_control_kg", "muscleControl"]);
  addMetric(metrics, "body_type_code", payload, ["body_type_code", "physiqueRating"]);
  addMetric(metrics, "bioimpedance_resistance_raw", payload, ["bioimpedance_resistance_raw", "impedance"]);
  addMetric(metrics, "bioimpedance_resistance_2_raw", payload, [
    "bioimpedance_resistance_2_raw",
    "impedance_low",
    "impedanceLow"
  ]);

  if (metrics.weight_kg && metrics.body_fat_percent && !metrics.fat_mass_kg) {
    metrics.fat_mass_kg = round((metrics.weight_kg * metrics.body_fat_percent) / 100, 1);
  }
  if (metrics.weight_kg && metrics.body_water_percent && !metrics.body_water_mass_kg) {
    metrics.body_water_mass_kg = round((metrics.weight_kg * metrics.body_water_percent) / 100, 1);
  }
  if (metrics.weight_kg && metrics.bone_mineral_content_kg && !metrics.bone_mineral_percent) {
    metrics.bone_mineral_percent = round(
      (metrics.bone_mineral_content_kg / metrics.weight_kg) * 100,
      1
    );
  }

  if (!metrics.weight_kg) {
    throw new IngestError(400, "Measurement payload must include weight or weight_kg");
  }

  return metrics;
}

function buildRawFields(payload: Record<string, unknown>) {
  const fields: Record<string, unknown> = {};
  for (const key of KNOWN_RAW_FIELDS) {
    const value = payload[key];
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean" ||
      value === null
    ) {
      fields[key] = value;
    }
  }
  return fields;
}

function buildMeasurement(payload: Record<string, unknown>, raw: RawData, now: Date): RawMeasurement {
  const measuredDate = parseTimestamp(payload, now);
  const timezone = stringValue(payload, ["measured_at_timezone", "timezone"]) ?? DEFAULT_TIMEZONE;
  const measuredAt = formatDateTime(measuredDate, timezone);
  const measuredAtUnixSeconds = Math.floor(measuredDate.getTime() / 1000);
  const userName = resolveUserName(payload, raw);
  const profileId = stringValue(payload, ["profile_id", "profileId", "duid", "user_type_code"]);
  const user = (raw.users ?? []).find((candidate) => candidate.name === userName);
  const metrics = buildMetrics(payload);
  if (!metrics.bmi && metrics.weight_kg && typeof user?.height_cm === "number" && user.height_cm > 0) {
    const heightM = user.height_cm / 100;
    metrics.bmi = round(metrics.weight_kg / (heightM * heightM), 1);
  }
  const estimatedMetricKeys = completeEstimatedMetrics(raw, userName, metrics);
  const heartRate = numberValue(payload, ["heart_rate_bpm", "heartRate"]);
  const statusCode = numberValue(payload, ["measurement_status_code", "status"]);

  return {
    row_id: 0,
    user: userName,
    measured_at: measuredAt,
    measured_at_timezone: timezone,
    measured_at_unix_seconds: measuredAtUnixSeconds,
    measured_at_minute: measuredAt.slice(0, 16),
    same_minute_index: 1,
    same_minute_count: 1,
    metrics,
    heart_rate_bpm: heartRate !== null && heartRate > 0 ? heartRate : null,
    heart_rate_raw: heartRate,
    measurement_status_code: statusCode ?? 0,
    duid: profileId ?? user?.type_code,
    user_type_code: profileId ?? user?.type_code,
    account_id: user?.account_id,
    source: {
      app: "Health Dashboard ingest",
      api_endpoint: "/api/health-data/measurements",
      model: stringValue(payload, ["device_model", "model"]) ?? raw.source?.device_model,
      device_id: stringValue(payload, ["device_id"]) ?? raw.source?.device_id,
      serial_number: stringValue(payload, ["serial_number"]),
      ingested_at: formatDateTime(now, timezone),
      derived_metrics_method:
        estimatedMetricKeys.length > 0 ? "weighted nearest Xiaomi Home full reports" : undefined,
      derived_metric_keys: estimatedMetricKeys.length > 0 ? estimatedMetricKeys : undefined
    },
    raw_xiaomi_fields: buildRawFields(payload)
  };
}

function measurementWeight(measurement: RawMeasurement): number | null {
  const value = measurement.metrics?.weight_kg;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function isDuplicate(existing: RawMeasurement, incoming: RawMeasurement) {
  if (existing.user !== incoming.user) return false;
  const existingUnix = numberValue(existing as Record<string, unknown>, ["measured_at_unix_seconds"]);
  const incomingUnix = numberValue(incoming as Record<string, unknown>, ["measured_at_unix_seconds"]);
  if (existingUnix === null || incomingUnix === null) return false;
  if (Math.abs(existingUnix - incomingUnix) > DUPLICATE_WINDOW_SECONDS) return false;

  const existingWeight = measurementWeight(existing);
  const incomingWeight = measurementWeight(incoming);
  if (existingWeight === null || incomingWeight === null) return false;
  return Math.abs(existingWeight - incomingWeight) <= 0.05;
}

function normalizeMeasurements(measurements: RawMeasurement[]) {
  measurements.sort((a, b) => {
    const aUnix = numberValue(a as Record<string, unknown>, ["measured_at_unix_seconds"]) ?? 0;
    const bUnix = numberValue(b as Record<string, unknown>, ["measured_at_unix_seconds"]) ?? 0;
    return aUnix - bUnix;
  });

  const minuteCounts = new Map<string, number>();
  for (const measurement of measurements) {
    const minute = measurement.measured_at_minute ?? measurement.measured_at?.slice(0, 16) ?? "";
    const key = `${measurement.user ?? ""}\n${minute}`;
    minuteCounts.set(key, (minuteCounts.get(key) ?? 0) + 1);
  }

  const minuteIndexes = new Map<string, number>();
  measurements.forEach((measurement, index) => {
    const minute = measurement.measured_at_minute ?? measurement.measured_at?.slice(0, 16) ?? "";
    const key = `${measurement.user ?? ""}\n${minute}`;
    const sameMinuteIndex = (minuteIndexes.get(key) ?? 0) + 1;
    minuteIndexes.set(key, sameMinuteIndex);
    measurement.row_id = index + 1;
    measurement.measured_at_minute = minute;
    measurement.same_minute_index = sameMinuteIndex;
    measurement.same_minute_count = minuteCounts.get(key) ?? 1;
  });
}

function atomicWrite(filePath: string, contents: string) {
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, contents);
  fs.renameSync(tmpPath, filePath);
}

function csvCell(value: unknown): string {
  if (value === undefined || value === null) return "";
  const text = String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function sortedMetricKeys(measurements: RawMeasurement[]) {
  const keys = new Set<string>();
  for (const measurement of measurements) {
    for (const key of Object.keys(measurement.metrics ?? {})) keys.add(key);
    if (measurement.heart_rate_bpm) keys.add("heart_rate_bpm");
  }
  return [
    ...WIDE_METRIC_ORDER.filter((key) => keys.has(key)),
    ...[...keys].filter((key) => !WIDE_METRIC_ORDER.includes(key)).sort()
  ];
}

function writeWideCsv(filePath: string, raw: RawData) {
  const measurements = raw.measurements ?? [];
  const metricKeys = sortedMetricKeys(measurements);
  const columns = [
    "row_id",
    "user",
    "measured_at",
    "measured_at_unix_seconds",
    "measured_at_minute",
    "same_minute_index",
    "same_minute_count",
    ...metricKeys,
    "heart_rate_raw",
    ...WIDE_META_COLUMNS
  ];
  const rows = measurements.map((measurement) => {
    const source = measurement.source ?? {};
    const values: Record<string, unknown> = {
      row_id: measurement.row_id,
      user: measurement.user,
      measured_at: measurement.measured_at,
      measured_at_unix_seconds: measurement.measured_at_unix_seconds,
      measured_at_minute: measurement.measured_at_minute,
      same_minute_index: measurement.same_minute_index,
      same_minute_count: measurement.same_minute_count,
      heart_rate_raw: measurement.heart_rate_raw,
      measurement_status_code: measurement.measurement_status_code,
      duid: measurement.duid,
      user_type_code: measurement.user_type_code,
      account_id: measurement.account_id,
      source_model: source.model,
      source_device_id: source.device_id,
      source_serial_number: source.serial_number
    };
    for (const key of metricKeys) {
      values[key] = key === "heart_rate_bpm" ? measurement.heart_rate_bpm : measurement.metrics?.[key];
    }
    return columns.map((column) => csvCell(values[column])).join(",");
  });
  atomicWrite(filePath, `${columns.join(",")}\n${rows.join("\n")}${rows.length ? "\n" : ""}`);
}

function writeLongCsv(filePath: string, raw: RawData) {
  const rows = ["row_id,user,measured_at,metric,value"];
  for (const measurement of raw.measurements ?? []) {
    const entries: [string, unknown][] = Object.entries(measurement.metrics ?? {});
    if (measurement.heart_rate_bpm) entries.push(["heart_rate_bpm", measurement.heart_rate_bpm]);
    for (const [metric, value] of entries) {
      if (value === undefined || value === null || value === "") continue;
      rows.push(
        [
          csvCell(measurement.row_id),
          csvCell(measurement.user),
          csvCell(measurement.measured_at),
          csvCell(metric),
          csvCell(value)
        ].join(",")
      );
    }
  }
  atomicWrite(filePath, `${rows.join("\n")}\n`);
}

function updateSourceMetadata(raw: RawData, now: Date) {
  raw.source = {
    ...(raw.source ?? {}),
    collected_at: formatDateTime(now),
    collection_method:
      "Automated ingest via /api/health-data/measurements; manual Xiaomi Home export remains available for full-history reconciliation.",
    privacy_note:
      typeof raw.source?.privacy_note === "string"
        ? raw.source.privacy_note
        : "Xiaomi authentication secrets and encryption key material are not serialized in this file."
  };
}

export function ingestScaleMeasurement(payload: unknown, options: IngestOptions): IngestResult {
  if (!isRecord(payload)) {
    throw new IngestError(400, "Measurement payload must be a JSON object");
  }

  const raw = JSON.parse(fs.readFileSync(options.dataFile, "utf8")) as RawData;
  const now = options.now ?? new Date();
  const measurement = buildMeasurement(payload, raw, now);
  const measurements = raw.measurements ?? [];

  const duplicate = measurements.find((existing) => isDuplicate(existing, measurement));
  if (duplicate) {
    return {
      duplicate: true,
      measurement: duplicate,
      measurementCount: measurements.length,
      dataFile: options.dataFile
    };
  }

  measurements.push(measurement);
  raw.measurements = measurements;
  normalizeMeasurements(raw.measurements);
  updateSourceMetadata(raw, now);

  atomicWrite(options.dataFile, `${JSON.stringify(raw, null, 2)}\n`);
  writeWideCsv(path.join(options.dataDir, "xiaomi-body-scale-measurements.csv"), raw);
  writeLongCsv(path.join(options.dataDir, "xiaomi-body-scale-measurements-long.csv"), raw);

  return {
    duplicate: false,
    measurement,
    measurementCount: raw.measurements.length,
    dataFile: options.dataFile
  };
}
