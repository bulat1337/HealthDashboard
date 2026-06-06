import chokidar from "chokidar";
import express from "express";
import fs from "node:fs";
import { timingSafeEqual } from "node:crypto";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { IngestError, ingestScaleMeasurement } from "./health-ingest.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

loadLocalEnvFiles();

function loadLocalEnvFiles() {
  const externalKeys = new Set(Object.keys(process.env));
  for (const filename of [".env", ".env.local"]) {
    const envPath = path.join(rootDir, filename);
    if (!fs.existsSync(envPath)) continue;

    const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;

      const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!match || externalKeys.has(match[1])) continue;

      process.env[match[1]] = parseEnvValue(match[2]);
    }
  }
}

function parseEnvValue(value: string) {
  const trimmed = value.trim();
  const quote = trimmed[0];
  if ((quote === '"' || quote === "'") && trimmed.endsWith(quote)) {
    const inner = trimmed.slice(1, -1);
    return quote === '"' ? inner.replace(/\\n/g, "\n").replace(/\\"/g, '"') : inner;
  }
  return trimmed;
}

const DEFAULT_DATA_DIR = path.join(rootDir, "data", "xiaomi-body-scale");

const DATA_DIR = process.env.HEALTH_DATA_DIR || DEFAULT_DATA_DIR;
const DATA_FILE =
  process.env.HEALTH_DATA_FILE || path.join(DATA_DIR, "xiaomi-body-scale-data.json");
const DEFAULT_MONEY_FILE = path.join(rootDir, "data", "money", "Money.md");
const MONEY_FILE = process.env.MONEY_DATA_FILE || DEFAULT_MONEY_FILE;
const LOCAL_ASSETS_DIR = path.join(rootDir, "data", "assets");
const MONEY_PARTNER_LABEL = process.env.MONEY_PARTNER_LABEL?.trim() || "партнера";
const PORT = Number(process.env.PORT || 5000);
const HOST = process.env.HOST || "127.0.0.1";
const HEALTH_INGEST_TOKEN = process.env.HEALTH_INGEST_TOKEN || "";
const HEALTH_DEFAULT_TIMEZONE = process.env.HEALTH_DEFAULT_TIMEZONE || "UTC";
const isProduction = process.env.NODE_ENV === "production";

function publicPath(filePath: string) {
  const relative = path.relative(rootDir, filePath);
  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) return relative;
  return path.basename(filePath);
}

function errorText(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error);
  return [DATA_FILE, DATA_DIR, MONEY_FILE]
    .sort((a, b) => b.length - a.length)
    .reduce((message, filePath) => message.replaceAll(filePath, publicPath(filePath)), raw);
}

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
};

type RawUser = {
  name?: string;
  account_id?: number | string;
  uid?: number | string;
  type_code?: number | string;
  sex_code?: number | string;
  height_cm?: number;
  weight_target_kg?: number;
  birth_date?: string;
};

type RawData = {
  schema_version?: number;
  source?: Record<string, unknown>;
  summary?: unknown[];
  users?: RawUser[];
  units?: Record<string, string>;
  measurements?: RawMeasurement[];
  weekly_trends_from_ui?: unknown[];
};

type NormalizedMeasurement = {
  rowId: number;
  user: string;
  measuredAt: string;
  measuredAtUnixSeconds: number;
  measuredAtMinute: string;
  timezone: string;
  sameMinuteIndex: number;
  sameMinuteCount: number;
  metrics: Record<string, number>;
  statusCode: number | null;
};

type DashboardUser = {
  id: string;
  name: string;
  accountId: string | null;
  heightCm: number | null;
  targetWeightKg: number | null;
  measurementCount: number;
  firstMeasuredAt: string | null;
  lastMeasuredAt: string | null;
};

type MetricCatalogEntry = {
  key: string;
  label: string;
  unit: string;
  category: string;
  precision: number;
  valueCount: number;
};

type MetricStats = {
  n: number;
  firstMeasuredAt: string | null;
  lastMeasuredAt: string | null;
  spanDays: number;
  mean: number | null;
  median: number | null;
  min: number | null;
  max: number | null;
  q1: number | null;
  q3: number | null;
  iqr: number | null;
  sd: number | null;
  mad: number | null;
  meanCi95: number | null;
  slopePerDay: number | null;
  slopeCi95: number | null;
  r2: number | null;
  outlierCount: number;
  duplicateMinuteCount: number;
  nonZeroStatusCount: number;
  cadenceDays: number | null;
  freshnessDays: number | null;
  precision: number;
  reliabilityScore: number;
  reliabilityLabel: string;
};

type DashboardData = {
  generatedAt: string;
  dataDir: string;
  dataFile: string;
  sourceMtimeMs: number | null;
  schemaVersion: number | null;
  source: {
    app: string | null;
    deviceName: string | null;
    deviceModel: string | null;
    collectedAt: string | null;
    privacyNote: string | null;
    validationNotes: string[];
  };
  users: DashboardUser[];
  metrics: MetricCatalogEntry[];
  measurements: NormalizedMeasurement[];
  stats: Record<string, Record<string, MetricStats>>;
  weeklyTrendsFromUi: unknown[];
  money: MoneyData;
};

type MoneyStatus = "ready" | "missing" | "error";

type MoneyRecord = {
  rowId: number;
  date: string;
  dateIso: string;
  totalAmount: number | null;
  freeAmount: number | null;
  reserveAmount: number | null;
  creditCardDebt: number | null;
  rentPaid: boolean | null;
};

type MoneyEvent = {
  rowId: number;
  bank: string;
  date: string;
  dateIso: string;
  title: string;
  daysFromToday: number;
};

type MoneySummary = {
  recordCount: number;
  firstDateIso: string | null;
  lastDateIso: string | null;
  totalChange: number | null;
  freeChange: number | null;
  reserveChange: number | null;
  creditCardDebtChange: number | null;
  freeShare: number | null;
  debtToTotalShare: number | null;
};

type MoneyData = {
  status: MoneyStatus;
  sourceFile: string;
  sourceMtimeMs: number | null;
  lastLoadError: string | null;
  monthlyIncome: number | null;
  rentMonthly: number | null;
  partnerMoney: number | null;
  partnerCreditCardDebt: number | null;
  records: MoneyRecord[];
  latestRecord: MoneyRecord | null;
  previousRecord: MoneyRecord | null;
  events: MoneyEvent[];
  upcomingEvents: MoneyEvent[];
  summary: MoneySummary;
};

const METRIC_LABELS: Record<string, string> = {
  weight_kg: "Вес",
  bmi: "BMI",
  body_fat_percent: "Жир",
  body_score: "Оценка тела",
  heart_rate_bpm: "Пульс",
  muscle_mass_kg: "Мышцы",
  muscle_percent: "Мышцы, %",
  body_water_percent: "Вода",
  body_water_mass_kg: "Вода, кг",
  fat_mass_kg: "Жировая масса",
  bone_mineral_content_kg: "Кости",
  bone_mineral_percent: "Кости, %",
  protein_mass_kg: "Белок",
  protein_percent: "Белок, %",
  skeletal_muscle_mass_kg: "Скелетные мышцы",
  visceral_fat_rating: "Висцеральный жир",
  basal_metabolic_rate_kcal: "BMR",
  estimated_waist_to_hip_ratio: "WHR",
  body_age_years: "Возраст тела",
  fat_free_body_weight_kg: "Безжировая масса",
  standard_weight_kg: "Стандартный вес",
  weight_control_kg: "Контроль веса",
  fat_control_raw: "Контроль жира",
  muscle_control_kg: "Контроль мышц",
  bioimpedance_resistance_raw: "Сопротивление 1",
  bioimpedance_resistance_2_raw: "Сопротивление 2"
};

const METRIC_CATEGORIES: Record<string, string> = {
  weight_kg: "Масса",
  bmi: "Масса",
  standard_weight_kg: "Масса",
  weight_control_kg: "Масса",
  body_fat_percent: "Состав тела",
  fat_mass_kg: "Состав тела",
  fat_control_raw: "Состав тела",
  visceral_fat_rating: "Состав тела",
  muscle_mass_kg: "Состав тела",
  muscle_percent: "Состав тела",
  skeletal_muscle_mass_kg: "Состав тела",
  muscle_control_kg: "Состав тела",
  body_water_percent: "Гидратация",
  body_water_mass_kg: "Гидратация",
  protein_mass_kg: "Состав тела",
  protein_percent: "Состав тела",
  bone_mineral_content_kg: "Состав тела",
  bone_mineral_percent: "Состав тела",
  heart_rate_bpm: "Витальные",
  basal_metabolic_rate_kcal: "Метаболизм",
  body_age_years: "Оценки",
  body_score: "Оценки",
  estimated_waist_to_hip_ratio: "Оценки",
  bioimpedance_resistance_raw: "Сырой сигнал",
  bioimpedance_resistance_2_raw: "Сырой сигнал"
};

const PREFERRED_METRIC_ORDER = [
  "weight_kg",
  "body_fat_percent",
  "muscle_mass_kg",
  "body_score",
  "bmi",
  "heart_rate_bpm",
  "body_water_percent",
  "fat_mass_kg",
  "skeletal_muscle_mass_kg",
  "visceral_fat_rating",
  "basal_metabolic_rate_kcal",
  "protein_percent"
];

let cachedData: DashboardData | null = null;
let lastLoadError: string | null = null;
let dataVersion = 0;

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function parseMoneyAmount(value: string | undefined): number | null {
  const raw = value?.trim() ?? "";
  if (!raw || raw === "-" || raw === "—") return null;

  const compact = raw
    .replace(/₽/g, "")
    .replace(/руб(?:\.|лей|ля|ль)?/gi, "")
    .replace(/['’\s]/g, "")
    .replace(/[~≈]/g, "");
  const match = compact.match(/-?\d+(?:[.,]\d+)?/);
  if (!match) return null;

  const numeric = Number(match[0].replace(",", "."));
  if (!Number.isFinite(numeric)) return null;
  const lower = compact.toLowerCase();
  const multiplier = lower.includes("k") || lower.includes("к") ? 1000 : 1;
  return Math.round(numeric * multiplier);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseLabeledMoneyAmount(text: string, labels: string[]) {
  for (const label of labels) {
    const match = text.match(new RegExp(`${escapeRegExp(label)}\\s*:\\s*([^\\n]+)`, "i"));
    const amount = parseMoneyAmount(match?.[1]);
    if (amount !== null) return amount;
  }
  return null;
}

function parseMoneyDate(date: string | undefined): string | null {
  const match = date?.trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const rawYear = Number(match[3]);
  const year = rawYear < 100 ? 2000 + rawYear : rawYear;
  if (!Number.isInteger(day) || !Number.isInteger(month) || !Number.isInteger(year)) return null;
  if (day < 1 || day > 31 || month < 1 || month > 12) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function daysFromToday(dateIso: string): number {
  const [year, month, day] = dateIso.split("-").map(Number);
  const eventDate = Date.UTC(year, month - 1, day);
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((eventDate - today) / 86400000);
}

function parseRentPaid(value: string | undefined): boolean | null {
  const normalized = value?.trim().toLowerCase() ?? "";
  if (normalized === "да") return true;
  if (normalized === "нет") return false;
  return null;
}

function parseMarkdownTableLine(line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return [];
  return trimmed
    .slice(1, -1)
    .split("|")
    .map((cell) => cell.replace(/\*\*/g, "").trim());
}

function isMarkdownSeparator(cells: string[]) {
  return cells.length > 0 && cells.every((cell) => /^:?-{2,}:?$/.test(cell.replace(/\s/g, "")));
}

function extractMarkdownTables(text: string) {
  const tables: { headers: string[]; rows: string[][] }[] = [];
  const lines = text.split(/\r?\n/);
  let index = 0;

  while (index < lines.length) {
    if (!lines[index].trim().startsWith("|")) {
      index += 1;
      continue;
    }

    const block: string[] = [];
    while (index < lines.length && lines[index].trim().startsWith("|")) {
      block.push(lines[index]);
      index += 1;
    }

    const parsedRows = block.map(parseMarkdownTableLine).filter((row) => row.length > 0);
    if (parsedRows.length < 2) continue;

    const headers = parsedRows[0];
    const rows = parsedRows.slice(1).filter((row) => !isMarkdownSeparator(row));
    tables.push({ headers, rows });
  }

  return tables;
}

function findColumn(headers: string[], text: string) {
  return headers.findIndex((header) => header.toLowerCase().includes(text.toLowerCase()));
}

function valueDelta(
  latest: MoneyRecord | null,
  previous: MoneyRecord | null,
  key: keyof Pick<MoneyRecord, "totalAmount" | "freeAmount" | "reserveAmount" | "creditCardDebt">
) {
  const latestValue = latest?.[key];
  const previousValue = previous?.[key];
  if (typeof latestValue !== "number" || typeof previousValue !== "number") return null;
  return latestValue - previousValue;
}

function firstRecordWithValue(
  records: MoneyRecord[],
  key: keyof Pick<MoneyRecord, "totalAmount" | "freeAmount" | "reserveAmount" | "creditCardDebt">
) {
  return records.find((record) => typeof record[key] === "number") ?? null;
}

function emptyMoneyData(status: MoneyStatus, stat: fs.Stats | null, error: string | null): MoneyData {
  return {
    status,
    sourceFile: publicPath(MONEY_FILE),
    sourceMtimeMs: stat?.mtimeMs ?? null,
    lastLoadError: error,
    monthlyIncome: null,
    rentMonthly: null,
    partnerMoney: null,
    partnerCreditCardDebt: null,
    records: [],
    latestRecord: null,
    previousRecord: null,
    events: [],
    upcomingEvents: [],
    summary: {
      recordCount: 0,
      firstDateIso: null,
      lastDateIso: null,
      totalChange: null,
      freeChange: null,
      reserveChange: null,
      creditCardDebtChange: null,
      freeShare: null,
      debtToTotalShare: null
    }
  };
}

function loadMoneyData(): MoneyData {
  const stat = fs.existsSync(MONEY_FILE) ? fs.statSync(MONEY_FILE) : null;
  if (!stat) return emptyMoneyData("missing", null, null);

  try {
    const text = fs.readFileSync(MONEY_FILE, "utf8");
    const tables = extractMarkdownTables(text);
    const moneyTable = tables.find(
      (table) => findColumn(table.headers, "Дата") !== -1 && findColumn(table.headers, "Общая сумма") !== -1
    );
    const eventTable = tables.find(
      (table) => findColumn(table.headers, "Банк") !== -1 && findColumn(table.headers, "Событие") !== -1
    );

    const moneyDateColumn = findColumn(moneyTable?.headers ?? [], "Дата");
    const totalColumn = findColumn(moneyTable?.headers ?? [], "Общая сумма");
    const freeColumn = findColumn(moneyTable?.headers ?? [], "Свободная сумма");
    const reserveColumn = findColumn(moneyTable?.headers ?? [], "Несгораемая сумма");
    const debtColumn = findColumn(moneyTable?.headers ?? [], "Долг по кредиткам");
    const rentPaidColumn = findColumn(moneyTable?.headers ?? [], "Аренда заплачена");

    const records = (moneyTable?.rows ?? [])
      .map((row) => {
        const date = row[moneyDateColumn];
        const dateIso = parseMoneyDate(date);
        if (!dateIso) return null;
        return {
          rowId: 0,
          date,
          dateIso,
          totalAmount: parseMoneyAmount(row[totalColumn]),
          freeAmount: parseMoneyAmount(row[freeColumn]),
          reserveAmount: parseMoneyAmount(row[reserveColumn]),
          creditCardDebt: parseMoneyAmount(row[debtColumn]),
          rentPaid: parseRentPaid(row[rentPaidColumn])
        } satisfies MoneyRecord;
      })
      .filter((record): record is MoneyRecord => record !== null)
      .map((record, index) => ({ ...record, rowId: index + 1 }));

    const eventBankColumn = findColumn(eventTable?.headers ?? [], "Банк");
    const eventDateColumn = findColumn(eventTable?.headers ?? [], "Дата");
    const eventTitleColumn = findColumn(eventTable?.headers ?? [], "Событие");
    const events = (eventTable?.rows ?? [])
      .map((row) => {
        const date = row[eventDateColumn];
        const dateIso = parseMoneyDate(date);
        const bank = row[eventBankColumn]?.trim() ?? "";
        const title = row[eventTitleColumn]?.trim() ?? "";
        if (!dateIso || !bank || !title) return null;
        return {
          rowId: 0,
          bank,
          date,
          dateIso,
          title,
          daysFromToday: daysFromToday(dateIso)
        } satisfies MoneyEvent;
      })
      .filter((event): event is MoneyEvent => event !== null)
      .sort((a, b) => a.dateIso.localeCompare(b.dateIso))
      .map((event, index) => ({ ...event, rowId: index + 1 }));

    const latestRecord = records[records.length - 1] ?? null;
    const previousRecord = records.length > 1 ? records[records.length - 2] : null;
    const firstRecord = records[0] ?? null;
    const monthlyIncome = parseMoneyAmount(text.match(/\*\*Доход:\*\*\s*([^\n]+)/)?.[1]);
    const rentMonthly = parseMoneyAmount(text.match(/аренда:\s*([^\n]+)/i)?.[1]);
    const partnerCreditCardDebt = parseLabeledMoneyAmount(text, [
      `Долг по кредиткам ${MONEY_PARTNER_LABEL}`,
      "Долг по кредиткам партнера",
      "Долг по кредиткам партнёра",
      "Partner credit card debt"
    ]);
    const partnerMoney = parseLabeledMoneyAmount(text, [
      `Деньги ${MONEY_PARTNER_LABEL}`,
      "Деньги партнера",
      "Деньги партнёра",
      "Partner money"
    ]);
    const freeShare =
      typeof latestRecord?.freeAmount === "number" && latestRecord.totalAmount
        ? round(latestRecord.freeAmount / latestRecord.totalAmount, 4)
        : null;
    const debtToTotalShare =
      typeof latestRecord?.creditCardDebt === "number" && latestRecord.totalAmount
        ? round(latestRecord.creditCardDebt / latestRecord.totalAmount, 4)
        : null;

    return {
      status: "ready",
      sourceFile: MONEY_FILE,
      sourceMtimeMs: stat.mtimeMs,
      lastLoadError: null,
      monthlyIncome,
      rentMonthly,
      partnerMoney,
      partnerCreditCardDebt,
      records,
      latestRecord,
      previousRecord,
      events,
      upcomingEvents: events.filter((event) => event.daysFromToday >= 0).slice(0, 5),
      summary: {
        recordCount: records.length,
        firstDateIso: firstRecord?.dateIso ?? null,
        lastDateIso: latestRecord?.dateIso ?? null,
        totalChange: valueDelta(latestRecord, firstRecordWithValue(records, "totalAmount"), "totalAmount"),
        freeChange: valueDelta(latestRecord, firstRecordWithValue(records, "freeAmount"), "freeAmount"),
        reserveChange: valueDelta(latestRecord, firstRecordWithValue(records, "reserveAmount"), "reserveAmount"),
        creditCardDebtChange: valueDelta(
          latestRecord,
          firstRecordWithValue(records, "creditCardDebt"),
          "creditCardDebt"
        ),
        freeShare,
        debtToTotalShare
      }
    };
  } catch (error) {
    return emptyMoneyData("error", stat, errorText(error));
  }
}

function measuredAtIso(measurement: RawMeasurement): string {
  const unixSeconds = asNumber(measurement.measured_at_unix_seconds);
  if (unixSeconds) return new Date(unixSeconds * 1000).toISOString();

  const text = measurement.measured_at;
  if (!text) return new Date(0).toISOString();
  const normalized = text.includes("T") ? text : text.replace(" ", "T");
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? new Date(0).toISOString() : parsed.toISOString();
}

function measuredAtUnixSeconds(measurement: RawMeasurement): number {
  const unixSeconds = asNumber(measurement.measured_at_unix_seconds);
  if (unixSeconds) return unixSeconds;
  return Math.floor(new Date(measuredAtIso(measurement)).getTime() / 1000);
}

function quantile(values: number[], q: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * q;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  const weight = index - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sampleSd(values: number[]): number | null {
  if (values.length < 2) return null;
  const avg = mean(values);
  if (avg === null) return null;
  const variance =
    values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function medianAbsoluteDeviation(values: number[], medianValue: number | null): number | null {
  if (values.length === 0 || medianValue === null) return null;
  const deviations = values.map((value) => Math.abs(value - medianValue));
  return quantile(deviations, 0.5);
}

function inferPrecision(values: number[]): number {
  const finite = values.filter(Number.isFinite);
  if (finite.length === 0) return 0.1;
  const decimals = Math.max(
    ...finite.map((value) => {
      const text = String(value);
      const fraction = text.includes(".") ? text.split(".")[1] : "";
      return Math.min(fraction.length, 4);
    })
  );
  return round(1 / 10 ** Math.max(decimals, 1), 4);
}

function computeRegression(points: { x: number; y: number }[]) {
  if (points.length < 2) {
    return { slope: null, slopeCi95: null, r2: null };
  }

  const xMean = mean(points.map((point) => point.x));
  const yMean = mean(points.map((point) => point.y));
  if (xMean === null || yMean === null) {
    return { slope: null, slopeCi95: null, r2: null };
  }

  const sxx = points.reduce((sum, point) => sum + (point.x - xMean) ** 2, 0);
  const syy = points.reduce((sum, point) => sum + (point.y - yMean) ** 2, 0);
  const sxy = points.reduce((sum, point) => sum + (point.x - xMean) * (point.y - yMean), 0);

  if (sxx === 0) {
    return { slope: null, slopeCi95: null, r2: null };
  }

  const slope = sxy / sxx;
  const intercept = yMean - slope * xMean;
  const residuals = points.map((point) => point.y - (intercept + slope * point.x));
  const rss = residuals.reduce((sum, residual) => sum + residual ** 2, 0);
  const residualVariance = points.length > 2 ? rss / (points.length - 2) : 0;
  const seSlope = Math.sqrt(residualVariance / sxx);
  const r2 = syy === 0 ? 1 : Math.max(0, Math.min(1, (sxy * sxy) / (sxx * syy)));

  return {
    slope,
    slopeCi95: points.length > 2 ? 1.96 * seSlope : null,
    r2
  };
}

function reliabilityLabel(score: number): string {
  if (score >= 78) return "Высокая";
  if (score >= 55) return "Средняя";
  return "Низкая";
}

function computeMetricStats(
  records: NormalizedMeasurement[],
  metricKey: string,
  latestUnixSeconds: number
): MetricStats {
  const metricRecords = records
    .map((record) => ({
      record,
      value: record.metrics[metricKey]
    }))
    .filter((item) => Number.isFinite(item.value))
    .sort((a, b) => a.record.measuredAtUnixSeconds - b.record.measuredAtUnixSeconds);

  const values = metricRecords.map((item) => item.value);
  const n = values.length;
  const avg = mean(values);
  const med = quantile(values, 0.5);
  const q1 = quantile(values, 0.25);
  const q3 = quantile(values, 0.75);
  const iqr = q1 !== null && q3 !== null ? q3 - q1 : null;
  const sd = sampleSd(values);
  const mad = medianAbsoluteDeviation(values, med);
  const precision = inferPrecision(values);
  const first = metricRecords[0]?.record ?? null;
  const last = metricRecords[metricRecords.length - 1]?.record ?? null;
  const spanDays =
    first && last
      ? Math.max(0, (last.measuredAtUnixSeconds - first.measuredAtUnixSeconds) / 86400)
      : 0;
  const regressionBase = first
    ? metricRecords.map((item) => ({
        x: (item.record.measuredAtUnixSeconds - first.measuredAtUnixSeconds) / 86400,
        y: item.value
      }))
    : [];
  const regression = computeRegression(regressionBase);
  const robustSigma = mad === null ? null : mad * 1.4826;
  const outlierCount =
    robustSigma && robustSigma > 0 && med !== null
      ? values.filter((value) => Math.abs(value - med) / robustSigma > 3.5).length
      : 0;
  const duplicateMinuteCount = metricRecords.filter(
    (item) => item.record.sameMinuteCount > 1
  ).length;
  const nonZeroStatusCount = metricRecords.filter((item) => {
    const status = item.record.statusCode;
    return status !== null && status !== 0;
  }).length;
  const cadenceDays = n > 1 ? spanDays / (n - 1) : null;
  const freshnessDays = last ? Math.max(0, (latestUnixSeconds - last.measuredAtUnixSeconds) / 86400) : null;

  const sampleScore = Math.min(1, n / 14) * 30;
  const cadenceScore =
    cadenceDays === null ? 4 : Math.max(0, Math.min(1, (4 - cadenceDays) / 4)) * 18;
  const recencyScore =
    freshnessDays === null ? 0 : Math.max(0, Math.min(1, (10 - freshnessDays) / 10)) * 18;
  const outlierScore = n === 0 ? 0 : Math.max(0, 1 - outlierCount / Math.max(1, n)) * 14;
  const statusScore = n === 0 ? 0 : Math.max(0, 1 - nonZeroStatusCount / Math.max(1, n)) * 12;
  const duplicateScore = n === 0 ? 0 : Math.max(0, 1 - duplicateMinuteCount / Math.max(1, n)) * 8;
  const reliabilityScore = Math.round(
    Math.max(0, Math.min(100, sampleScore + cadenceScore + recencyScore + outlierScore + statusScore + duplicateScore))
  );

  return {
    n,
    firstMeasuredAt: first?.measuredAt ?? null,
    lastMeasuredAt: last?.measuredAt ?? null,
    spanDays: round(spanDays, 2),
    mean: avg === null ? null : round(avg, 3),
    median: med === null ? null : round(med, 3),
    min: values.length ? Math.min(...values) : null,
    max: values.length ? Math.max(...values) : null,
    q1: q1 === null ? null : round(q1, 3),
    q3: q3 === null ? null : round(q3, 3),
    iqr: iqr === null ? null : round(iqr, 3),
    sd: sd === null ? null : round(sd, 4),
    mad: mad === null ? null : round(mad, 4),
    meanCi95: sd === null || n === 0 ? null : round((1.96 * sd) / Math.sqrt(n), 4),
    slopePerDay: regression.slope === null ? null : round(regression.slope, 5),
    slopeCi95: regression.slopeCi95 === null ? null : round(regression.slopeCi95, 5),
    r2: regression.r2 === null ? null : round(regression.r2, 4),
    outlierCount,
    duplicateMinuteCount,
    nonZeroStatusCount,
    cadenceDays: cadenceDays === null ? null : round(cadenceDays, 2),
    freshnessDays: freshnessDays === null ? null : round(freshnessDays, 2),
    precision,
    reliabilityScore,
    reliabilityLabel: reliabilityLabel(reliabilityScore)
  };
}

function normalizeMeasurement(raw: RawMeasurement, index: number): NormalizedMeasurement {
  const metrics: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw.metrics ?? {})) {
    const numeric = asNumber(value);
    if (numeric !== null) metrics[key] = numeric;
  }

  const heartRate = asNumber(raw.heart_rate_bpm);
  if (heartRate !== null && heartRate > 0) {
    metrics.heart_rate_bpm = heartRate;
  }

  return {
    rowId: Number(raw.row_id ?? index + 1),
    user: String(raw.user ?? "Unknown"),
    measuredAt: measuredAtIso(raw),
    measuredAtUnixSeconds: measuredAtUnixSeconds(raw),
    measuredAtMinute: String(raw.measured_at_minute ?? ""),
    timezone: String(raw.measured_at_timezone ?? HEALTH_DEFAULT_TIMEZONE),
    sameMinuteIndex: Number(raw.same_minute_index ?? 1),
    sameMinuteCount: Number(raw.same_minute_count ?? 1),
    metrics,
    statusCode: asNumber(raw.measurement_status_code)
  };
}

function metricSort(a: string, b: string): number {
  const aIndex = PREFERRED_METRIC_ORDER.indexOf(a);
  const bIndex = PREFERRED_METRIC_ORDER.indexOf(b);
  if (aIndex !== -1 || bIndex !== -1) {
    return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex);
  }
  return a.localeCompare(b);
}

function buildDashboardData(raw: RawData, stat: fs.Stats | null): DashboardData {
  const measurements = (raw.measurements ?? [])
    .map(normalizeMeasurement)
    .sort((a, b) => a.measuredAtUnixSeconds - b.measuredAtUnixSeconds);
  const latestUnixSeconds =
    measurements.length > 0
      ? Math.max(...measurements.map((measurement) => measurement.measuredAtUnixSeconds))
      : Math.floor(Date.now() / 1000);

  const usersByName = new Map<string, DashboardUser>();
  for (const user of raw.users ?? []) {
    const name = String(user.name ?? user.account_id ?? "Unknown");
    usersByName.set(name, {
      id: name,
      name,
      accountId: user.account_id === undefined ? null : String(user.account_id),
      heightCm: typeof user.height_cm === "number" ? user.height_cm : null,
      targetWeightKg:
        typeof user.weight_target_kg === "number" ? user.weight_target_kg : null,
      measurementCount: 0,
      firstMeasuredAt: null,
      lastMeasuredAt: null
    });
  }

  for (const measurement of measurements) {
    const existing =
      usersByName.get(measurement.user) ??
      ({
        id: measurement.user,
        name: measurement.user,
        accountId: null,
        heightCm: null,
        targetWeightKg: null,
        measurementCount: 0,
        firstMeasuredAt: null,
        lastMeasuredAt: null
      } satisfies DashboardUser);
    existing.measurementCount += 1;
    existing.firstMeasuredAt ??= measurement.measuredAt;
    existing.lastMeasuredAt = measurement.measuredAt;
    usersByName.set(measurement.user, existing);
  }

  const metricValues = new Map<string, number[]>();
  for (const measurement of measurements) {
    for (const [metric, value] of Object.entries(measurement.metrics)) {
      if (!metricValues.has(metric)) metricValues.set(metric, []);
      metricValues.get(metric)?.push(value);
    }
  }

  const metrics = [...metricValues.entries()]
    .map(([key, values]) => ({
      key,
      label: METRIC_LABELS[key] ?? key,
      unit: raw.units?.[key] ?? "",
      category: METRIC_CATEGORIES[key] ?? "Прочее",
      precision: inferPrecision(values),
      valueCount: values.length
    }))
    .sort((a, b) => metricSort(a.key, b.key));

  const stats: Record<string, Record<string, MetricStats>> = {};
  for (const user of usersByName.values()) {
    const userRecords = measurements.filter((measurement) => measurement.user === user.name);
    stats[user.name] = {};
    for (const metric of metrics) {
      stats[user.name][metric.key] = computeMetricStats(
        userRecords,
        metric.key,
        latestUnixSeconds
      );
    }
  }

  const source = raw.source ?? {};

  return {
    generatedAt: new Date().toISOString(),
    dataDir: publicPath(DATA_DIR),
    dataFile: publicPath(DATA_FILE),
    sourceMtimeMs: stat?.mtimeMs ?? null,
    schemaVersion: raw.schema_version ?? null,
    source: {
      app: typeof source.app === "string" ? source.app : null,
      deviceName: typeof source.device_name === "string" ? source.device_name : null,
      deviceModel: typeof source.device_model === "string" ? source.device_model : null,
      collectedAt: typeof source.collected_at === "string" ? source.collected_at : null,
      privacyNote: typeof source.privacy_note === "string" ? source.privacy_note : null,
      validationNotes: Array.isArray(source.validation_notes)
        ? source.validation_notes.filter((note): note is string => typeof note === "string")
        : []
    },
    users: [...usersByName.values()].sort((a, b) => a.name.localeCompare(b.name)),
    metrics,
    measurements,
    stats,
    weeklyTrendsFromUi: raw.weekly_trends_from_ui ?? [],
    money: loadMoneyData()
  };
}

function loadDashboardData(): DashboardData {
  const stat = fs.existsSync(DATA_FILE) ? fs.statSync(DATA_FILE) : null;
  const rawText = fs.readFileSync(DATA_FILE, "utf8");
  const raw = JSON.parse(rawText) as RawData;
  return buildDashboardData(raw, stat);
}

function refreshCache() {
  try {
    cachedData = loadDashboardData();
    lastLoadError = null;
    dataVersion += 1;
    return cachedData;
  } catch (error) {
    lastLoadError = errorText(error);
    throw error;
  }
}

function getCachedData() {
  if (!cachedData) refreshCache();
  return cachedData;
}

const app = express();
const server = http.createServer(app);
const sockets = new WebSocketServer({ server, path: "/ws" });

app.use(express.json({ limit: "64kb" }));
app.use("/local-assets", express.static(LOCAL_ASSETS_DIR));

app.get("/api/health-data", (_request, response) => {
  try {
    const data = getCachedData();
    response.json({ version: dataVersion, data });
  } catch (error) {
    response.status(500).json({
      error: errorText(error),
      dataFile: publicPath(DATA_FILE)
    });
  }
});

app.post("/api/health-data/measurements", (request, response) => {
  if (!HEALTH_INGEST_TOKEN) {
    response.status(503).json({
      error: "Health ingest is disabled. Set HEALTH_INGEST_TOKEN to enable POST ingestion."
    });
    return;
  }

  if (!tokenMatches(requestIngestToken(request))) {
    response.status(401).json({ error: "Invalid health ingest token" });
    return;
  }

  try {
    const result = ingestScaleMeasurement(request.body, {
      dataDir: DATA_DIR,
      dataFile: DATA_FILE
    });

    if (!result.duplicate) {
      refreshCache();
      broadcast({
        type: "health-data-updated",
        event: "ingest",
        path: publicPath(DATA_FILE),
        version: dataVersion,
        updatedAt: new Date().toISOString()
      });
    }

    response.status(result.duplicate ? 200 : 201).json({
      duplicate: result.duplicate,
      measurementCount: result.measurementCount,
      rowId: result.measurement.row_id,
      user: result.measurement.user,
      measuredAt: result.measurement.measured_at,
      dataFile: publicPath(result.dataFile)
    });
  } catch (error) {
    if (error instanceof IngestError) {
      response.status(error.statusCode).json({ error: error.message });
      return;
    }
    response.status(500).json({ error: errorText(error) });
  }
});

app.get("/api/status", (_request, response) => {
  const exists = fs.existsSync(DATA_FILE);
  const stat = exists ? fs.statSync(DATA_FILE) : null;
  const moneyExists = fs.existsSync(MONEY_FILE);
  const moneyStat = moneyExists ? fs.statSync(MONEY_FILE) : null;
  const money = cachedData?.money ?? loadMoneyData();
  response.json({
    ok: exists && lastLoadError === null,
    version: dataVersion,
    dataDir: publicPath(DATA_DIR),
    dataFile: publicPath(DATA_FILE),
    sourceMtimeMs: stat?.mtimeMs ?? null,
    money: {
      status: money.status,
      sourceFile: publicPath(MONEY_FILE),
      sourceMtimeMs: moneyStat?.mtimeMs ?? null,
      lastLoadError: money.lastLoadError
    },
    lastLoadError
  });
});

sockets.on("connection", (socket) => {
  socket.send(
    JSON.stringify({
      type: "connected",
      version: dataVersion,
      generatedAt: cachedData?.generatedAt ?? null
    })
  );
});

function broadcast(payload: unknown) {
  const message = JSON.stringify(payload);
  for (const socket of sockets.clients) {
    if (socket.readyState === socket.OPEN) socket.send(message);
  }
}

function requestIngestToken(request: express.Request): string | null {
  const authorization = request.headers.authorization;
  if (authorization?.toLowerCase().startsWith("bearer ")) {
    return authorization.slice("bearer ".length).trim();
  }

  const header = request.headers["x-health-ingest-token"];
  if (typeof header === "string") return header.trim();
  if (Array.isArray(header)) return header[0]?.trim() ?? null;
  return null;
}

function tokenMatches(actual: string | null) {
  if (!actual || !HEALTH_INGEST_TOKEN) return false;
  const expectedBuffer = Buffer.from(HEALTH_INGEST_TOKEN);
  const actualBuffer = Buffer.from(actual);
  return (
    expectedBuffer.length === actualBuffer.length &&
    timingSafeEqual(expectedBuffer, actualBuffer)
  );
}

let refreshTimer: NodeJS.Timeout | null = null;
const watcher = chokidar.watch([DATA_FILE, path.join(DATA_DIR, "*.csv"), path.join(DATA_DIR, "*.md"), MONEY_FILE], {
  ignoreInitial: true,
  awaitWriteFinish: {
    stabilityThreshold: 350,
    pollInterval: 80
  }
});

watcher.on("all", (event, changedPath) => {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    try {
      refreshCache();
      broadcast({
        type: "health-data-updated",
        event,
        path: publicPath(changedPath),
        version: dataVersion,
        updatedAt: new Date().toISOString()
      });
    } catch (error) {
      broadcast({
        type: "health-data-error",
        path: publicPath(changedPath),
        error: errorText(error),
        updatedAt: new Date().toISOString()
      });
    }
  }, 120);
});

refreshCache();

async function configureFrontend() {
  if (isProduction) {
    const distDir = path.join(rootDir, "dist");
    app.use(express.static(distDir));
    app.use((_request, response) => {
      response.sendFile(path.join(distDir, "index.html"));
    });
    return;
  }

  const { createServer: createViteServer } = await import("vite");
  const vite = await createViteServer({
    root: rootDir,
    appType: "custom",
    server: {
      middlewareMode: true,
      hmr: { server }
    }
  });

  app.use(vite.middlewares);
  app.use(async (request, response, next) => {
    try {
      const url = request.originalUrl;
      const template = fs.readFileSync(path.join(rootDir, "index.html"), "utf8");
      const html = await vite.transformIndexHtml(url, template);
      response.status(200).set({ "Content-Type": "text/html" }).end(html);
    } catch (error) {
      vite.ssrFixStacktrace(error as Error);
      next(error);
    }
  });
}

await configureFrontend();

server.listen(PORT, HOST, () => {
  const shownHost = HOST === "0.0.0.0" ? "localhost" : HOST;
  console.log(`Life Dashboard: http://${shownHost}:${PORT}`);
  console.log(`Data source: ${publicPath(DATA_FILE)}`);
});
