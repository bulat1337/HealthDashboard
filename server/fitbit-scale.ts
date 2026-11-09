import { createHash } from "node:crypto";
import type { RawMeasurement } from "./health-ingest.js";
import { object, list } from "./fitbit-data.js";

export const SCALE_WRITE_SCOPE = "https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.writeonly";
export const SCALE_READ_SCOPE = "https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly";
type ScaleType = "weight" | "body-fat";
export type ScalePoint = {
  key: string;
  type: ScaleType;
  measuredAt: string;
  fingerprint: string;
  body: Record<string, unknown>;
};
type Receipt = {
  name?: string;
  fingerprint?: string;
  // Persist before sending: a lost POST response must be reconciled, never blindly retried.
  pending?: ScalePoint;
};
export type ScaleExportState = {
  records: Record<string, Receipt>;
  lastAttemptAt: string | null;
  lastSyncAt: string | null;
  lastMeasurementAt: string | null;
  error: string | null;
};
export function emptyScaleExport(): ScaleExportState {
  return { records: {}, lastAttemptAt: null, lastSyncAt: null, lastMeasurementAt: null, error: null };
}

const LABELS: Record<string, string> = {
  weight_kg: "Вес, кг", bmi: "ИМТ", body_fat_percent: "Жир, %", body_score: "Оценка тела",
  heart_rate_bpm: "Пульс, уд/мин", muscle_mass_kg: "Мышцы, кг", muscle_percent: "Мышцы, %",
  body_water_percent: "Вода, %", body_water_mass_kg: "Вода, кг", fat_mass_kg: "Жир, кг",
  bone_mineral_content_kg: "Минеральная масса костей, кг", bone_mineral_percent: "Минералы костей, %",
  protein_mass_kg: "Белок, кг", protein_percent: "Белок, %", skeletal_muscle_mass_kg: "Скелетные мышцы, кг",
  visceral_fat_rating: "Висцеральный жир", basal_metabolic_rate_kcal: "Основной обмен, ккал",
  estimated_waist_to_hip_ratio: "Расчётное соотношение талии и бёдер", body_age_years: "Возраст тела, лет",
  fat_free_body_weight_kg: "Безжировая масса, кг", standard_weight_kg: "Стандартный вес, кг",
  weight_control_kg: "Контроль веса, кг", fat_control_raw: "Контроль жира (значение Xiaomi)",
  muscle_control_kg: "Контроль мышц, кг", body_type_code: "Тип тела (код Xiaomi)",
  bioimpedance_resistance_raw: "Биоимпеданс (значение Xiaomi)",
  bioimpedance_resistance_2_raw: "Второй биоимпеданс (значение Xiaomi)",
};
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function number(value: unknown): number | null {
  if (typeof value !== "number" && !(typeof value === "string" && value.trim())) return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}
function offsetAt(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: string) => Number(parts.find((entry) => entry.type === type)!.value);
  return `${(Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"), part("second")) - Math.floor(date.getTime() / 1000) * 1000) / 1000}s`;
}

/** Only weight and body-fat support scale writes in the stable Google Health API.
 * Other numeric Xiaomi metrics travel in weight.notes, including explicit derivation labels.
 * Account IDs, device IDs, raw payloads and secrets never become notes.
 */
export function planScaleExport(measurements: RawMeasurement[], userId: string, timezone: string) {
  const points = new Map<string, ScalePoint>();
  let skipped = 0;
  for (const row of measurements) {
    if (row.user !== userId) continue;
    const weight = number(row.metrics?.weight_kg);
    const unix = number(row.measured_at_unix_seconds);
    const explicitTime = row.measured_at?.match(/(?:Z|[+-]\d{2}:?\d{2})$/) ? Date.parse(row.measured_at) : NaN;
    const date = new Date(unix !== null ? unix * 1000 : explicitTime);
    if (weight === null || weight <= 0 || weight > 300 || !Number.isFinite(date.getTime()) ||
        (number(row.measurement_status_code) ?? 0) !== 0) { skipped++; continue; }
    const measuredAt = date.toISOString();
    let utcOffset: string;
    try { utcOffset = offsetAt(date, row.measured_at_timezone || timezone); }
    catch { skipped++; continue; }
    const sampleTime = { physicalTime: measuredAt, utcOffset };
    const sourceId = row.raw_xiaomi_fields?.source_measurement_id;
    const identity = digest([userId, sourceId ? String(sourceId) : measuredAt,
      sourceId ? String(row.duid ?? row.user_type_code ?? "") : row.same_minute_index ?? 1]);
    const derived = new Set(Array.isArray(row.source?.derived_metric_keys) ? row.source.derived_metric_keys : []);
    const metrics = { ...row.metrics };
    if (number(row.heart_rate_bpm) !== null) metrics.heart_rate_bpm = row.heart_rate_bpm;
    const notes = ["Xiaomi · Life Dashboard", `Измерение: ${identity}`, ...Object.keys(metrics).sort().flatMap((key) => {
      const value = number(metrics[key]);
      return value === null ? [] : [`${LABELS[key] ?? key}: ${value}${derived.has(key) ? " (расчёт по предыдущим отчётам Xiaomi Home)" : ""}`];
    })].join("\n");
    const device = { formFactor: "SCALE", manufacturer: "Xiaomi", displayName: "Xiaomi Body Composition Scale" };
    function add(type: ScaleType, field: string, payload: Record<string, unknown>, estimated = false) {
      const body = { dataSource: { recordingMethod: estimated ? "DERIVED" : "ACTIVELY_MEASURED", device }, [field]: payload };
      const key = `${identity}:${type}`;
      points.set(key, { key, type, measuredAt, fingerprint: digest(body), body });
    }
    add("weight", "weight", { sampleTime, weightGrams: Math.round(weight * 1_000_000) / 1000, notes }, derived.has("weight_kg"));
    const fat = number(metrics.body_fat_percent);
    if (fat !== null && fat >= 0 && fat <= 100)
      add("body-fat", "bodyFat", { sampleTime, percentage: fat }, derived.has("body_fat_percent"));
  }
  return { points: [...points.values()].sort((a, b) => a.measuredAt.localeCompare(b.measuredAt) || a.key.localeCompare(b.key)), skipped };
}

export class ScaleRequestError extends Error {
  constructor(public code: string, public definitive = false) { super(code); }
}
export type ScaleRequest = (endpoint: string, method?: "GET" | "POST" | "PATCH", body?: unknown) => Promise<Record<string, unknown>>;
const fieldOf = (type: ScaleType) => type === "weight" ? "weight" : "bodyFat";
function resourceName(value: unknown, type: ScaleType): value is string {
  return typeof value === "string" && new RegExp(`^users/[^/]+/dataTypes/${type}/dataPoints/[a-zA-Z0-9-]+$`).test(value);
}
function matches(point: Record<string, unknown>, expected: ScalePoint, clientId: string) {
  const field = fieldOf(expected.type), actual = object(point[field]), wanted = object(expected.body[field]);
  const source = object(point.dataSource);
  const app = object(source.application);
  // Read raw points from this OAuth application, so other integrations/manual entries stay separate.
  if (app.googleWebClientId !== clientId || !resourceName(point.name, expected.type)) return false;
  if (Date.parse(String(object(actual.sampleTime).physicalTime)) !== Date.parse(expected.measuredAt)) return false;
  if (source.recordingMethod !== object(expected.body.dataSource).recordingMethod) return false;
  return expected.type === "weight"
    ? actual.weightGrams === wanted.weightGrams && actual.notes === wanted.notes
    : actual.percentage === wanted.percentage && object(source.device).manufacturer === "Xiaomi";
}

async function recoverPoint(request: ScaleRequest, point: ScalePoint, clientId: string, used: Set<string>) {
  const field = point.type.replaceAll("-", "_");
  const query = new URLSearchParams({
    filter: `${field}.sample_time.physical_time >= "${point.measuredAt}" AND ${field}.sample_time.physical_time < "${new Date(Date.parse(point.measuredAt) + 1000).toISOString()}"`,
    pageSize: "1000",
  });
  const tokens = new Set<string>();
  for (;;) {
    const response = await request(`users/me/dataTypes/${point.type}/dataPoints?${query}`);
    const found = list(response.dataPoints).find((item) => matches(item, point, clientId) && !used.has(String(item.name)));
    if (found) return String(found.name);
    if (!response.nextPageToken) return null;
    const token = String(response.nextPageToken);
    if (tokens.has(token) || tokens.size >= 100) throw new ScaleRequestError("sync");
    tokens.add(token);
    query.set("pageToken", token);
  }
}

/** A source rescan is the durable queue; receipts and in-flight payloads survive restarts.
 * Google currently ignores client-assigned IDs. Persist provider IDs and reconcile
 * uncertain writes by exact payload + timestamp + OAuth application before progressing.
 */
export async function exportScalePoints(options: {
  points: ScalePoint[];
  state: ScaleExportState;
  clientId: string;
  request: ScaleRequest;
  save: (state: ScaleExportState) => void;
  limit?: number;
}) {
  const { points, state, request, clientId, save } = options;
  state.lastAttemptAt = new Date().toISOString();
  state.error = null;
  save(state);
  let processed = 0;
  try {
    // Send the newest weigh-ins first, while gradually backfilling all historical records.
    const queue = [...points].reverse().sort((a, b) => Number(Boolean(state.records[a.key]?.pending)) - Number(Boolean(state.records[b.key]?.pending)));
    for (const point of queue) {
      const receipt = state.records[point.key] ??= {};
      if (receipt.fingerprint === point.fingerprint && !receipt.pending) continue;
      if (processed++ >= (options.limit ?? 40)) break;
      if (receipt.pending) {
        const used = new Set(Object.values(state.records).flatMap((item) => item.name ? [item.name] : []));
        if (receipt.name) used.delete(receipt.name);
        const recovered = await recoverPoint(request, receipt.pending, clientId, used);
        if (!recovered && !receipt.name) { state.error = "confirming"; continue; }
        if (recovered) {
          receipt.name = recovered;
          receipt.fingerprint = receipt.pending.fingerprint;
          state.lastMeasurementAt = !state.lastMeasurementAt || point.measuredAt > state.lastMeasurementAt ? point.measuredAt : state.lastMeasurementAt;
          delete receipt.pending;
          save(state);
          if (receipt.fingerprint === point.fingerprint) continue;
        }
      }
      // Check raw records before creating; weight notes identify this application's weigh-in.
      if (!receipt.name) {
        const used = new Set(Object.values(state.records).flatMap((item) => item.name ? [item.name] : []));
        receipt.name = await recoverPoint(request, point, clientId, used) ?? undefined;
        if (receipt.name) { receipt.fingerprint = point.fingerprint; save(state); continue; }
      }
      receipt.pending = point;
      save(state);
      let response: Record<string, unknown>;
      try {
        response = await request(receipt.name ?? `users/me/dataTypes/${point.type}/dataPoints`,
          receipt.name ? "PATCH" : "POST", { ...point.body, ...(receipt.name ? { name: receipt.name } : {}) });
        if (response.error) {
          const code = object(response.error).code;
          throw new ScaleRequestError(code === 7 ? "scope" : code === 16 ? "reauthorize" : code === 8 ? "rate_limit"
            : code === 3 ? "invalid" : code === 5 ? "missing" : "sync", true);
        }
      } catch (error) {
        if (error instanceof ScaleRequestError && error.definitive) delete receipt.pending;
        if (error instanceof ScaleRequestError && ["invalid", "missing"].includes(error.code)) {
          if (error.code === "missing") { delete receipt.name; delete receipt.fingerprint; }
          state.error = error.code;
          save(state);
          continue;
        }
        throw error;
      }
      const result = object(response.response ?? response);
      if (response.done !== false && resourceName(result.name, point.type)) {
        receipt.name = result.name;
        receipt.fingerprint = point.fingerprint;
        delete receipt.pending;
        state.lastMeasurementAt = !state.lastMeasurementAt || point.measuredAt > state.lastMeasurementAt ? point.measuredAt : state.lastMeasurementAt;
      } else {
        state.error = "confirming";
      }
      save(state);
    }
    if (!points.some((point) => state.records[point.key]?.fingerprint !== point.fingerprint || state.records[point.key]?.pending))
      state.lastSyncAt = new Date().toISOString();
  } catch (error) {
    state.error = error instanceof ScaleRequestError ? error.code : "sync";
  }
  save(state);
}
