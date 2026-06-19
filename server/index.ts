import chokidar from "chokidar";
import express from "express";
import { execFile } from "node:child_process";
import fs from "node:fs";
import { timingSafeEqual } from "node:crypto";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { WebSocketServer } from "ws";
import { IngestError, ingestScaleMeasurement } from "./health-ingest.js";

const execFileAsync = promisify(execFile);
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
const DEFAULT_SPORT_FILE = path.join(rootDir, "data", "sport", "sport-tracker.json");
const SPORT_FILE = process.env.SPORT_DATA_FILE || DEFAULT_SPORT_FILE;
const LOCAL_ASSETS_DIR = path.join(rootDir, "data", "assets");
const MONEY_PARTNER_LABEL = process.env.MONEY_PARTNER_LABEL?.trim() || "партнера";
const PORT = Number(process.env.PORT || 5000);
const HOST = process.env.HOST || "127.0.0.1";
const HEALTH_INGEST_TOKEN = process.env.HEALTH_INGEST_TOKEN || "";
const HEALTH_DEFAULT_TIMEZONE = process.env.HEALTH_DEFAULT_TIMEZONE || "UTC";
const isProduction = process.env.NODE_ENV === "production";
const MONEY_SYNC_SCRIPT = path.join(rootDir, "scripts", "zenmoney-money-sync.mjs");
const MONEY_SYNC_ENABLED =
  process.env.MONEY_SYNC_ENABLED === "true" ||
  (isProduction && process.env.MONEY_SYNC_ENABLED !== "false");
const MONEY_SYNC_TIMEZONE = process.env.MONEY_SYNC_TIMEZONE || HEALTH_DEFAULT_TIMEZONE || "Europe/Moscow";
const MONEY_SYNC_START_HOUR = Number(process.env.MONEY_SYNC_START_HOUR || 8);
const MONEY_SYNC_END_HOUR = Number(process.env.MONEY_SYNC_END_HOUR || 23);
const MONEY_SYNC_FINAL_MINUTE = Number(process.env.MONEY_SYNC_FINAL_MINUTE || 30);
const MONEY_SYNC_TIMEOUT_MS = Number(process.env.MONEY_SYNC_TIMEOUT_MS || 180000);
const MONEY_SYNC_SOURCE = "zenmoney";
const MONEY_PRE_SYNC_URL_CONFIGURED = Boolean(process.env.ZENMONEY_PRE_SYNC_URL?.trim());
const MONEY_PRE_SYNC_COMMAND_CONFIGURED = Boolean(process.env.ZENMONEY_PRE_SYNC_COMMAND?.trim());
const MONEY_PRE_SYNC_WAIT_MS = Number(process.env.ZENMONEY_PRE_SYNC_WAIT_MS || 45000);
const MONEY_PARTNER_CREDIT_CARD_DEBT_LABELS = [
  `Долг по кредиткам ${MONEY_PARTNER_LABEL}`,
  "Долг по кредиткам партнера",
  "Долг по кредиткам партнёра",
  "Partner credit card debt"
];
const MONEY_PARTNER_MONEY_LABELS = [
  `Деньги ${MONEY_PARTNER_LABEL}`,
  "Деньги партнера",
  "Деньги партнёра",
  "Partner money"
];

function publicPath(filePath: string) {
  const relative = path.relative(rootDir, filePath);
  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) return relative;
  return path.basename(filePath);
}

function errorText(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error);
  return [DATA_FILE, DATA_DIR, MONEY_FILE, SPORT_FILE]
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
  investmentAmount: number | null;
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
  investmentChange: number | null;
  reserveChange: number | null;
  creditCardDebtChange: number | null;
  freeShare: number | null;
  investmentShare: number | null;
  debtToTotalShare: number | null;
};

type MoneyRuntimeSyncState = {
  status: "idle" | "running" | "ok" | "error" | "disabled";
  enabled: boolean;
  source: string;
  trigger: MoneySyncTrigger | null;
  startedAt: string | null;
  finishedAt: string | null;
  nextRunAt: string | null;
  lastError: string | null;
  preSync: {
    configured: boolean;
    urlConfigured: boolean;
    commandConfigured: boolean;
    waitMs: number;
  };
};

type MoneyData = {
  status: MoneyStatus;
  sourceFile: string;
  sourceMtimeMs: number | null;
  lastLoadError: string | null;
  sync: MoneyRuntimeSyncState;
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

type SportActivityKey = "run" | "pilates" | "strength";

type SportActivityCatalogEntry = {
  key: SportActivityKey;
  label: string;
  color: string;
};

type SportEntry = {
  date: string;
  activities: SportActivityKey[];
};

type SportUser = {
  id: string;
  name: string;
  activityTypes: SportActivityKey[];
  entries: SportEntry[];
};

type SportData = {
  schemaVersion: number;
  generatedAt: string;
  sourceFile: string;
  sourceMtimeMs: number | null;
  activityCatalog: SportActivityCatalogEntry[];
  users: SportUser[];
};

type SportDayUpdate = {
  userId: string;
  date: string;
  activities: SportActivityKey[];
};

const SPORT_ACTIVITY_CATALOG: SportActivityCatalogEntry[] = [
  { key: "run", label: "Бег", color: "#2563eb" },
  { key: "pilates", label: "Пилатес", color: "#db2777" },
  { key: "strength", label: "Силовая", color: "#f59e0b" }
];

const SPORT_USERS: Omit<SportUser, "entries">[] = [
  { id: "bulat", name: "Булат", activityTypes: ["strength", "run", "pilates"] },
  { id: "diana", name: "Диана", activityTypes: ["run", "pilates"] }
];

const SPORT_ACTIVITY_KEYS = new Set<SportActivityKey>(
  SPORT_ACTIVITY_CATALOG.map((activity) => activity.key)
);

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
  basal_metabolic_rate_kcal: "Базовый обмен",
  estimated_waist_to_hip_ratio: "Индекс талия/бедра",
  body_age_years: "Возраст тела",
  fat_free_body_weight_kg: "Безжировая масса",
  standard_weight_kg: "Стандартный вес",
  weight_control_kg: "Контроль веса",
  fat_control_raw: "Контроль жира",
  muscle_control_kg: "Контроль мышц",
  body_type_code: "Тип телосложения",
  bioimpedance_resistance_raw: "Сопротивление тела",
  bioimpedance_resistance_2_raw: "Сопротивление тела, низкая частота"
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
  body_type_code: "Оценки",
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

function formatMoneyAmount(value: number) {
  return Math.round(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, "'");
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

function parseIsoDate(value: string): string | null {
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return `${match[1]}-${match[2]}-${match[3]}`;
}

function parseMoneyDateInput(value: unknown, label = "Дата") {
  if (typeof value !== "string") {
    throw new Error(`${label}: укажите дату.`);
  }

  const trimmed = value.trim();
  const isoDate = parseIsoDate(trimmed) ?? parseMoneyDate(trimmed);
  if (!isoDate) {
    throw new Error(`${label}: используйте формат YYYY-MM-DD или ДД.ММ.ГГ.`);
  }

  return isoDate;
}

function formatMoneyDateIso(dateIso: string) {
  const [year, month, day] = dateIso.split("-");
  return `${day}.${month}.${year.slice(-2)}`;
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
  key: keyof Pick<MoneyRecord, "totalAmount" | "freeAmount" | "investmentAmount" | "reserveAmount" | "creditCardDebt">
) {
  const latestValue = latest?.[key];
  const previousValue = previous?.[key];
  if (typeof latestValue !== "number" || typeof previousValue !== "number") return null;
  return latestValue - previousValue;
}

function firstRecordWithValue(
  records: MoneyRecord[],
  key: keyof Pick<MoneyRecord, "totalAmount" | "freeAmount" | "investmentAmount" | "reserveAmount" | "creditCardDebt">
) {
  return records.find((record) => typeof record[key] === "number") ?? null;
}

function emptyMoneyData(status: MoneyStatus, stat: fs.Stats | null, error: string | null): MoneyData {
  return {
    status,
    sourceFile: publicPath(MONEY_FILE),
    sourceMtimeMs: stat?.mtimeMs ?? null,
    lastLoadError: error,
    sync: publicMoneySyncState(),
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
      investmentChange: null,
      reserveChange: null,
      creditCardDebtChange: null,
      freeShare: null,
      investmentShare: null,
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
    const investmentColumn = findColumn(moneyTable?.headers ?? [], "Инвестиции");
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
          investmentAmount: parseMoneyAmount(row[investmentColumn]),
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
    const partnerCreditCardDebt = parseLabeledMoneyAmount(text, MONEY_PARTNER_CREDIT_CARD_DEBT_LABELS);
    const partnerMoney = parseLabeledMoneyAmount(text, MONEY_PARTNER_MONEY_LABELS);
    const freeShare =
      typeof latestRecord?.freeAmount === "number" && latestRecord.totalAmount
        ? round(latestRecord.freeAmount / latestRecord.totalAmount, 4)
        : null;
    const investmentShare =
      typeof latestRecord?.investmentAmount === "number" && latestRecord.totalAmount
        ? round(latestRecord.investmentAmount / latestRecord.totalAmount, 4)
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
      sync: publicMoneySyncState(),
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
        investmentChange: valueDelta(
          latestRecord,
          firstRecordWithValue(records, "investmentAmount"),
          "investmentAmount"
        ),
        reserveChange: valueDelta(latestRecord, firstRecordWithValue(records, "reserveAmount"), "reserveAmount"),
        creditCardDebtChange: valueDelta(
          latestRecord,
          firstRecordWithValue(records, "creditCardDebt"),
          "creditCardDebt"
        ),
        freeShare,
        investmentShare,
        debtToTotalShare
      }
    };
  } catch (error) {
    return emptyMoneyData("error", stat, errorText(error));
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isDateKey(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

function isSportActivity(value: unknown): value is SportActivityKey {
  return typeof value === "string" && SPORT_ACTIVITY_KEYS.has(value as SportActivityKey);
}

function normalizeSportActivities(raw: unknown, allowedActivities: SportActivityKey[]) {
  if (!Array.isArray(raw)) return [];

  const allowed = new Set(allowedActivities);
  const activities: SportActivityKey[] = [];
  for (const item of raw) {
    if (!isSportActivity(item) || !allowed.has(item) || activities.includes(item)) continue;
    activities.push(item);
  }
  return activities;
}

function normalizeSportEntries(rawUser: unknown, allowedActivities: SportActivityKey[]) {
  if (!isPlainObject(rawUser) || !isPlainObject(rawUser.entries)) return [];

  return Object.entries(rawUser.entries)
    .map(([date, rawActivities]) => ({
      date,
      activities: normalizeSportActivities(rawActivities, allowedActivities)
    }))
    .filter((entry): entry is SportEntry => isDateKey(entry.date) && entry.activities.length > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function loadSportRawFile() {
  if (!fs.existsSync(SPORT_FILE)) return { schemaVersion: 1, users: {} };
  return JSON.parse(fs.readFileSync(SPORT_FILE, "utf8")) as unknown;
}

function loadSportData(): SportData {
  const stat = fs.existsSync(SPORT_FILE) ? fs.statSync(SPORT_FILE) : null;
  const raw = loadSportRawFile();
  const rawUsers = isPlainObject(raw) && isPlainObject(raw.users) ? raw.users : {};
  const rawSchemaVersion =
    isPlainObject(raw) && typeof raw.schemaVersion === "number" ? raw.schemaVersion : 1;

  return {
    schemaVersion: rawSchemaVersion,
    generatedAt: new Date().toISOString(),
    sourceFile: publicPath(SPORT_FILE),
    sourceMtimeMs: stat?.mtimeMs ?? null,
    activityCatalog: SPORT_ACTIVITY_CATALOG,
    users: SPORT_USERS.map((user) => ({
      ...user,
      entries: normalizeSportEntries(rawUsers[user.id], user.activityTypes)
    }))
  };
}

function sportDayUpdateFromBody(body: unknown): SportDayUpdate {
  if (!isPlainObject(body)) {
    throw new Error("Тело запроса должно быть JSON-объектом.");
  }

  const userId = typeof body.userId === "string" ? body.userId : "";
  const user = SPORT_USERS.find((candidate) => candidate.id === userId);
  if (!user) {
    throw new Error("Укажите пользователя: bulat или diana.");
  }

  if (!isDateKey(body.date)) {
    throw new Error("Дата должна быть в формате YYYY-MM-DD.");
  }

  if (!Array.isArray(body.activities)) {
    throw new Error("activities должен быть массивом.");
  }

  const allowed = new Set(user.activityTypes);
  const activities: SportActivityKey[] = [];
  for (const activity of body.activities) {
    if (!isSportActivity(activity) || !allowed.has(activity)) {
      throw new Error(`Тип спорта недоступен для ${user.name}.`);
    }
    if (!activities.includes(activity)) activities.push(activity);
  }

  return {
    userId: user.id,
    date: body.date,
    activities
  };
}

function writeSportDay(update: SportDayUpdate) {
  const raw = loadSportRawFile();
  const rawObject = isPlainObject(raw) ? raw : {};
  const users = isPlainObject(rawObject.users) ? { ...rawObject.users } : {};
  const existingUserRecord = users[update.userId];
  const userRecord = isPlainObject(existingUserRecord) ? { ...existingUserRecord } : {};
  const entries = isPlainObject(userRecord.entries) ? { ...userRecord.entries } : {};

  if (update.activities.length > 0) {
    entries[update.date] = update.activities;
  } else {
    delete entries[update.date];
  }

  users[update.userId] = {
    ...userRecord,
    entries
  };

  const nextRaw = {
    ...rawObject,
    schemaVersion: 1,
    users
  };

  fs.mkdirSync(path.dirname(SPORT_FILE), { recursive: true });
  fs.writeFileSync(SPORT_FILE, `${JSON.stringify(nextRaw, null, 2)}\n`, "utf8");
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

type MoneyPartnerUpdate = {
  partnerMoney?: number;
  partnerCreditCardDebt?: number;
};

type MoneyRecordAmountKey = "totalAmount" | "freeAmount" | "investmentAmount" | "reserveAmount" | "creditCardDebt";

type MoneyRecordUpdate = Partial<Record<MoneyRecordAmountKey, number | null>> & {
  dateIso?: string;
  rentPaid?: boolean | null;
};

const MONEY_RECORD_AMOUNT_LABELS: Record<MoneyRecordAmountKey, string> = {
  totalAmount: "Общая сумма",
  freeAmount: "Свободная сумма",
  investmentAmount: "Инвестиции",
  reserveAmount: "Несгораемая сумма",
  creditCardDebt: "Долг по кредиткам"
};

function normalizeMoneyPartnerInput(value: unknown, label: string) {
  const amount = typeof value === "number" ? value : parseMoneyAmount(typeof value === "string" ? value : undefined);
  if (amount === null || !Number.isFinite(amount)) {
    throw new Error(`${label}: укажите число в рублях.`);
  }
  if (amount < 0) {
    throw new Error(`${label}: значение должно быть 0 или больше.`);
  }
  if (amount > 1_000_000_000_000) {
    throw new Error(`${label}: значение слишком большое.`);
  }
  return Math.round(amount);
}

function moneyPartnerUpdateFromBody(body: unknown): MoneyPartnerUpdate {
  if (!body || typeof body !== "object") {
    throw new Error("Тело запроса должно быть JSON-объектом.");
  }

  const candidate = body as {
    partnerMoney?: unknown;
    partnerCreditCardDebt?: unknown;
  };
  const update: MoneyPartnerUpdate = {};

  if ("partnerMoney" in candidate) {
    update.partnerMoney = normalizeMoneyPartnerInput(candidate.partnerMoney, "Деньги партнера");
  }
  if ("partnerCreditCardDebt" in candidate) {
    update.partnerCreditCardDebt = normalizeMoneyPartnerInput(candidate.partnerCreditCardDebt, "Долг партнера");
  }
  if (update.partnerMoney === undefined && update.partnerCreditCardDebt === undefined) {
    throw new Error("Передайте partnerMoney или partnerCreditCardDebt.");
  }

  return update;
}

function normalizeMoneyRecordAmountInput(value: unknown, label: string): number | null {
  if (value === null) return null;
  if (typeof value === "string" && value.trim() === "") return null;

  const amount = typeof value === "number" ? value : parseMoneyAmount(typeof value === "string" ? value : undefined);
  if (amount === null || !Number.isFinite(amount)) {
    throw new Error(`${label}: укажите число в рублях или оставьте поле пустым.`);
  }
  if (Math.abs(amount) > 1_000_000_000_000) {
    throw new Error(`${label}: значение слишком большое.`);
  }
  return Math.round(amount);
}

function normalizeMoneyRentPaidInput(value: unknown): boolean | null {
  if (value === null) return null;
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") {
    throw new Error("Аренда: выберите да, нет или пусто.");
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === "-" || normalized === "—") return null;
  if (["да", "yes", "true", "1"].includes(normalized)) return true;
  if (["нет", "no", "false", "0"].includes(normalized)) return false;
  throw new Error("Аренда: выберите да, нет или пусто.");
}

function moneyRecordUpdateFromBody(body: unknown): MoneyRecordUpdate {
  if (!body || typeof body !== "object") {
    throw new Error("Тело запроса должно быть JSON-объектом.");
  }

  const candidate = body as Record<string, unknown>;
  const update: MoneyRecordUpdate = {};

  if ("dateIso" in candidate) {
    update.dateIso = parseMoneyDateInput(candidate.dateIso);
  } else if ("date" in candidate) {
    update.dateIso = parseMoneyDateInput(candidate.date);
  }

  for (const key of Object.keys(MONEY_RECORD_AMOUNT_LABELS) as MoneyRecordAmountKey[]) {
    if (key in candidate) {
      update[key] = normalizeMoneyRecordAmountInput(candidate[key], MONEY_RECORD_AMOUNT_LABELS[key]);
    }
  }

  if ("rentPaid" in candidate) {
    update.rentPaid = normalizeMoneyRentPaidInput(candidate.rentPaid);
  }

  if (Object.keys(update).length === 0) {
    throw new Error("Передайте хотя бы одно поле среза.");
  }

  return update;
}

function replaceLabeledMoneyAmount(text: string, labels: string[], value: number) {
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const rendered = formatMoneyAmount(value);

  for (const label of labels) {
    const pattern = new RegExp(`^(.*?${escapeRegExp(label)}\\s*:\\*?\\*?\\s*)(.*)$`, "i");
    const lineIndex = lines.findIndex((line) => pattern.test(line));
    if (lineIndex !== -1) {
      lines[lineIndex] = lines[lineIndex].replace(pattern, `$1${rendered}`);
      return lines.join(newline);
    }
  }

  throw new Error(`Money.md is missing editable value: ${labels[0]}.`);
}

function renderMarkdownTableRow(cells: string[], widths: number[]) {
  return `| ${cells.map((cell, index) => cell.padEnd(widths[index] ?? 0)).join(" | ")} |`;
}

function formatNullableMoneyAmount(value: number | null) {
  return value === null ? "—" : formatMoneyAmount(value);
}

function formatMoneyRentPaid(value: boolean | null) {
  if (value === true) return "да";
  if (value === false) return "нет";
  return "—";
}

function tableColumnWidth(parsedRows: { lineIndex: number; cells: string[] }[], nextCells: string[], nextLineIndex: number) {
  const tableCells = parsedRows
    .filter((row) => !isMarkdownSeparator(row.cells))
    .map((row) => (row.lineIndex === nextLineIndex ? nextCells : row.cells));
  const columnCount = Math.max(...tableCells.map((cells) => cells.length), nextCells.length);
  return Array.from({ length: columnCount }, (_, columnIndex) =>
    Math.max(...tableCells.map((cells) => cells[columnIndex]?.length ?? 0))
  );
}

function updateMoneyRecordText(text: string, rowId: number, update: MoneyRecordUpdate) {
  if (!Number.isInteger(rowId) || rowId < 1) {
    throw new Error("rowId должен быть положительным целым числом.");
  }

  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  let index = 0;

  while (index < lines.length) {
    if (!lines[index].trim().startsWith("|")) {
      index += 1;
      continue;
    }

    const blockStart = index;
    while (index < lines.length && lines[index].trim().startsWith("|")) index += 1;

    const parsedRows = lines
      .slice(blockStart, index)
      .map((line, offset) => ({
        lineIndex: blockStart + offset,
        cells: parseMarkdownTableLine(line)
      }))
      .filter((row) => row.cells.length > 0);

    if (parsedRows.length < 2) continue;

    const headers = parsedRows[0].cells;
    const dateColumn = findColumn(headers, "Дата");
    const totalColumn = findColumn(headers, "Общая сумма");
    if (dateColumn === -1 || totalColumn === -1) continue;

    const columns: Record<MoneyRecordAmountKey, number> = {
      totalAmount: totalColumn,
      freeAmount: findColumn(headers, "Свободная сумма"),
      investmentAmount: findColumn(headers, "Инвестиции"),
      reserveAmount: findColumn(headers, "Несгораемая сумма"),
      creditCardDebt: findColumn(headers, "Долг по кредиткам")
    };
    const rentPaidColumn = findColumn(headers, "Аренда заплачена");
    const dataRows = parsedRows.slice(1).filter((row) => !isMarkdownSeparator(row.cells));
    let recordIndex = 0;

    for (const row of dataRows) {
      if (!parseMoneyDate(row.cells[dateColumn])) continue;
      recordIndex += 1;
      if (recordIndex !== rowId) continue;

      const nextCells = [...row.cells];
      if (update.dateIso !== undefined) {
        nextCells[dateColumn] = formatMoneyDateIso(update.dateIso);
      }

      for (const key of Object.keys(MONEY_RECORD_AMOUNT_LABELS) as MoneyRecordAmountKey[]) {
        const value = update[key];
        if (value === undefined) continue;
        const column = columns[key];
        if (column === -1) {
          if (value === null) continue;
          throw new Error(`Money.md is missing editable column: ${MONEY_RECORD_AMOUNT_LABELS[key]}.`);
        }
        nextCells[column] = formatNullableMoneyAmount(value);
      }

      if (update.rentPaid !== undefined) {
        if (rentPaidColumn === -1) {
          if (update.rentPaid === null) {
            lines[row.lineIndex] = renderMarkdownTableRow(
              nextCells,
              tableColumnWidth(parsedRows, nextCells, row.lineIndex)
            );
            return lines.join(newline);
          }
          throw new Error("Money.md is missing editable column: Аренда заплачена.");
        }
        nextCells[rentPaidColumn] = formatMoneyRentPaid(update.rentPaid);
      }

      lines[row.lineIndex] = renderMarkdownTableRow(nextCells, tableColumnWidth(parsedRows, nextCells, row.lineIndex));
      return lines.join(newline);
    }

    throw new Error(`Срез #${rowId} не найден в таблице денег.`);
  }

  throw new Error("Money table with columns Дата and Общая сумма was not found.");
}

function updateLatestMoneyRowForPartnerValues(
  text: string,
  oldValues: Required<MoneyPartnerUpdate>,
  nextValues: Required<MoneyPartnerUpdate>
) {
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  let index = 0;

  while (index < lines.length) {
    if (!lines[index].trim().startsWith("|")) {
      index += 1;
      continue;
    }

    const blockStart = index;
    while (index < lines.length && lines[index].trim().startsWith("|")) index += 1;

    const parsedRows = lines
      .slice(blockStart, index)
      .map((line, offset) => ({
        lineIndex: blockStart + offset,
        cells: parseMarkdownTableLine(line)
      }))
      .filter((row) => row.cells.length > 0);

    if (parsedRows.length < 2) continue;

    const headers = parsedRows[0].cells;
    const dateColumn = findColumn(headers, "Дата");
    const freeColumn = findColumn(headers, "Свободная сумма");
    const debtColumn = findColumn(headers, "Долг по кредиткам");
    if (dateColumn === -1 || freeColumn === -1 || debtColumn === -1) continue;

    const dataRows = parsedRows.slice(1).filter((row) => !isMarkdownSeparator(row.cells));
    const latestRow = [...dataRows].reverse().find((row) => parseMoneyDate(row.cells[dateColumn]) !== null);
    if (!latestRow) continue;

    const freeAmount = parseMoneyAmount(latestRow.cells[freeColumn]);
    const creditCardDebt = parseMoneyAmount(latestRow.cells[debtColumn]);
    if (freeAmount === null || creditCardDebt === null) {
      throw new Error("Latest Money.md row is missing readable free amount or credit card debt.");
    }

    const partnerMoneyDelta = nextValues.partnerMoney - oldValues.partnerMoney;
    const partnerDebtDelta = nextValues.partnerCreditCardDebt - oldValues.partnerCreditCardDebt;
    const nextFreeAmount = freeAmount - partnerMoneyDelta - partnerDebtDelta;
    const nextCreditCardDebt = creditCardDebt + partnerDebtDelta;
    const nextCells = [...latestRow.cells];
    nextCells[freeColumn] = formatMoneyAmount(nextFreeAmount);
    nextCells[debtColumn] = formatMoneyAmount(nextCreditCardDebt);

    const tableCells = parsedRows
      .filter((row) => !isMarkdownSeparator(row.cells))
      .map((row) => (row.lineIndex === latestRow.lineIndex ? nextCells : row.cells));
    const columnCount = Math.max(...tableCells.map((cells) => cells.length), nextCells.length);
    const widths = Array.from({ length: columnCount }, (_, columnIndex) =>
      Math.max(...tableCells.map((cells) => cells[columnIndex]?.length ?? 0))
    );
    lines[latestRow.lineIndex] = renderMarkdownTableRow(nextCells, widths);
    return lines.join(newline);
  }

  throw new Error("Money table with columns Дата and Долг по кредиткам was not found.");
}

function updateMoneyPartnerValuesText(text: string, update: MoneyPartnerUpdate) {
  const oldPartnerMoney = parseLabeledMoneyAmount(text, MONEY_PARTNER_MONEY_LABELS);
  const oldPartnerCreditCardDebt = parseLabeledMoneyAmount(text, MONEY_PARTNER_CREDIT_CARD_DEBT_LABELS);
  if (oldPartnerMoney === null || oldPartnerCreditCardDebt === null) {
    throw new Error("Money.md is missing readable partner money values.");
  }

  const nextValues: Required<MoneyPartnerUpdate> = {
    partnerMoney: update.partnerMoney ?? oldPartnerMoney,
    partnerCreditCardDebt: update.partnerCreditCardDebt ?? oldPartnerCreditCardDebt
  };
  const oldValues: Required<MoneyPartnerUpdate> = {
    partnerMoney: oldPartnerMoney,
    partnerCreditCardDebt: oldPartnerCreditCardDebt
  };

  let nextText = text;
  if (update.partnerCreditCardDebt !== undefined) {
    nextText = replaceLabeledMoneyAmount(
      nextText,
      MONEY_PARTNER_CREDIT_CARD_DEBT_LABELS,
      nextValues.partnerCreditCardDebt
    );
  }
  if (update.partnerMoney !== undefined) {
    nextText = replaceLabeledMoneyAmount(nextText, MONEY_PARTNER_MONEY_LABELS, nextValues.partnerMoney);
  }
  if (
    nextValues.partnerMoney !== oldValues.partnerMoney ||
    nextValues.partnerCreditCardDebt !== oldValues.partnerCreditCardDebt
  ) {
    nextText = updateLatestMoneyRowForPartnerValues(nextText, oldValues, nextValues);
  }

  return {
    text: nextText,
    values: nextValues
  };
}

type MoneySyncTrigger = "manual" | "schedule";

type MoneySyncState = {
  status: "idle" | "running" | "ok" | "error" | "disabled";
  enabled: boolean;
  source: string;
  trigger: MoneySyncTrigger | null;
  startedAt: string | null;
  finishedAt: string | null;
  nextRunAt: string | null;
  lastError: string | null;
  lastResult: unknown | null;
};

let moneySyncInFlight: Promise<unknown> | null = null;
let moneySyncTimer: NodeJS.Timeout | null = null;
const moneySyncState: MoneySyncState = {
  status: MONEY_SYNC_ENABLED ? "idle" : "disabled",
  enabled: MONEY_SYNC_ENABLED,
  source: MONEY_SYNC_SOURCE,
  trigger: null,
  startedAt: null,
  finishedAt: null,
  nextRunAt: null,
  lastError: null,
  lastResult: null
};

function publicMoneySyncState(): MoneyRuntimeSyncState {
  return {
    status: moneySyncState.status,
    enabled: moneySyncState.enabled,
    source: moneySyncState.source,
    trigger: moneySyncState.trigger,
    startedAt: moneySyncState.startedAt,
    finishedAt: moneySyncState.finishedAt,
    nextRunAt: moneySyncState.nextRunAt,
    lastError: moneySyncState.lastError,
    preSync: {
      configured: MONEY_PRE_SYNC_URL_CONFIGURED || MONEY_PRE_SYNC_COMMAND_CONFIGURED,
      urlConfigured: MONEY_PRE_SYNC_URL_CONFIGURED,
      commandConfigured: MONEY_PRE_SYNC_COMMAND_CONFIGURED,
      waitMs: MONEY_PRE_SYNC_WAIT_MS
    }
  };
}

function parseJsonOutput(stdout: string) {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  return JSON.parse(trimmed);
}

function publicMoneySyncResult(result: unknown) {
  if (!result || typeof result !== "object") return result;
  const candidate = result as {
    row?: unknown;
    source?: unknown;
    serverTimestamp?: unknown;
  };
  return {
    source: candidate.source ?? MONEY_SYNC_SOURCE,
    row: candidate.row ?? null,
    serverTimestamp: candidate.serverTimestamp ?? null
  };
}

function childErrorText(error: unknown) {
  if (error && typeof error === "object") {
    const candidate = error as { stderr?: unknown; stdout?: unknown; message?: unknown };
    const stderr = typeof candidate.stderr === "string" ? candidate.stderr.trim() : "";
    const stdout = typeof candidate.stdout === "string" ? candidate.stdout.trim() : "";
    if (stderr) return stderr;
    if (stdout) return stdout;
    if (typeof candidate.message === "string") return candidate.message;
  }
  return errorText(error);
}

async function runMoneySync(trigger: MoneySyncTrigger) {
  if (moneySyncInFlight) return moneySyncInFlight;

  moneySyncState.status = "running";
  moneySyncState.source = MONEY_SYNC_SOURCE;
  moneySyncState.trigger = trigger;
  moneySyncState.startedAt = new Date().toISOString();
  moneySyncState.finishedAt = null;
  moneySyncState.lastError = null;

  moneySyncInFlight = (async () => {
    try {
      const { stdout } = await execFileAsync(
        process.execPath,
        [MONEY_SYNC_SCRIPT, "write", "--json"],
        {
          cwd: rootDir,
          env: {
            ...process.env,
            MONEY_DATA_FILE: MONEY_FILE,
            MONEY_SYNC_SOURCE,
            MONEY_SYNC_TIMEZONE
          },
          encoding: "utf8",
          maxBuffer: 2 * 1024 * 1024,
          timeout: MONEY_SYNC_TIMEOUT_MS
        }
      );
      const result = parseJsonOutput(stdout);
      const publicResult = publicMoneySyncResult(result);
      refreshCache();
      const updatedAt = new Date().toISOString();
      moneySyncState.status = "ok";
      moneySyncState.finishedAt = updatedAt;
      moneySyncState.lastResult = publicResult;
      broadcast({
        type: "money-data-updated",
        event: trigger,
        path: publicPath(MONEY_FILE),
        version: dataVersion,
        updatedAt,
        result: publicResult
      });
      return publicResult;
    } catch (error) {
      const message = childErrorText(error);
      moneySyncState.status = "error";
      moneySyncState.finishedAt = new Date().toISOString();
      moneySyncState.lastError = message;
      broadcast({
        type: "money-data-error",
        event: trigger,
        path: publicPath(MONEY_FILE),
        error: message,
        updatedAt: moneySyncState.finishedAt
      });
      throw new Error(message);
    } finally {
      moneySyncInFlight = null;
    }
  })();

  return moneySyncInFlight;
}

function zonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second)
  };
}

function utcTimestamp(parts: {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}) {
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
}

function zonedDate(parts: {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}, timeZone: string) {
  const desired = utcTimestamp(parts);
  const guess = new Date(desired);
  const actual = utcTimestamp(zonedParts(guess, timeZone));
  return new Date(desired + (desired - actual));
}

function moneySyncTimes() {
  const times = [];
  for (let hour = MONEY_SYNC_START_HOUR; hour <= MONEY_SYNC_END_HOUR; hour += 1) {
    times.push({ hour, minute: 0 });
  }
  if (MONEY_SYNC_FINAL_MINUTE > 0) {
    times.push({ hour: MONEY_SYNC_END_HOUR, minute: MONEY_SYNC_FINAL_MINUTE });
  }
  return times
    .filter((time) => time.hour >= 0 && time.hour <= 23 && time.minute >= 0 && time.minute <= 59)
    .sort((a, b) => a.hour - b.hour || a.minute - b.minute);
}

function nextMoneySyncDate(now = new Date()) {
  const current = zonedParts(now, MONEY_SYNC_TIMEZONE);
  for (let dayOffset = 0; dayOffset < 3; dayOffset += 1) {
    for (const time of moneySyncTimes()) {
      const candidate = zonedDate(
        {
          year: current.year,
          month: current.month,
          day: current.day + dayOffset,
          hour: time.hour,
          minute: time.minute,
          second: 0
        },
        MONEY_SYNC_TIMEZONE
      );
      if (candidate.getTime() > now.getTime() + 1000) return candidate;
    }
  }
  return null;
}

function scheduleNextMoneySync() {
  if (!MONEY_SYNC_ENABLED) return;
  if (moneySyncTimer) clearTimeout(moneySyncTimer);

  const nextRun = nextMoneySyncDate();
  moneySyncState.nextRunAt = nextRun?.toISOString() ?? null;
  if (!nextRun) return;

  const delayMs = Math.max(1000, nextRun.getTime() - Date.now());
  moneySyncTimer = setTimeout(() => {
    runMoneySync("schedule")
      .catch((error) => {
        console.error(`Money sync failed: ${childErrorText(error)}`);
      })
      .finally(() => scheduleNextMoneySync());
  }, delayMs);
}

const app = express();
const server = http.createServer(app);
const sockets = new WebSocketServer({ noServer: true });

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

    if (result.updated) {
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
      updated: result.updated,
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

app.get("/api/sport-data", (_request, response) => {
  try {
    response.json({ data: loadSportData() });
  } catch (error) {
    response.status(500).json({
      error: errorText(error),
      dataFile: publicPath(SPORT_FILE)
    });
  }
});

app.patch("/api/sport-data/day", (request, response) => {
  try {
    const update = sportDayUpdateFromBody(request.body);
    writeSportDay(update);

    const data = loadSportData();
    const updatedAt = new Date().toISOString();
    broadcast({
      type: "sport-data-updated",
      event: "day-update",
      path: publicPath(SPORT_FILE),
      updatedAt
    });

    response.json({
      ok: true,
      updatedAt,
      data
    });
  } catch (error) {
    response.status(400).json({
      ok: false,
      error: errorText(error)
    });
  }
});

app.post("/api/money-data/refresh", async (_request, response) => {
  try {
    const result = await runMoneySync("manual");
    response.json({
      ok: true,
      version: dataVersion,
      updatedAt: moneySyncState.finishedAt,
      result,
      sync: publicMoneySyncState()
    });
  } catch (error) {
    response.status(500).json({
      ok: false,
      error: errorText(error),
      sync: publicMoneySyncState()
    });
  }
});

app.patch("/api/money-data/partner", (request, response) => {
  try {
    const update = moneyPartnerUpdateFromBody(request.body);
    const currentText = fs.readFileSync(MONEY_FILE, "utf8");
    const result = updateMoneyPartnerValuesText(currentText, update);

    if (result.text !== currentText) {
      fs.writeFileSync(MONEY_FILE, result.text, "utf8");
    }

    const data = refreshCache();
    const updatedAt = new Date().toISOString();
    broadcast({
      type: "money-data-updated",
      event: "partner-settings",
      path: publicPath(MONEY_FILE),
      version: dataVersion,
      updatedAt
    });

    response.json({
      ok: true,
      version: dataVersion,
      updatedAt,
      partnerMoney: result.values.partnerMoney,
      partnerCreditCardDebt: result.values.partnerCreditCardDebt,
      money: data.money
    });
  } catch (error) {
    response.status(400).json({
      ok: false,
      error: errorText(error)
    });
  }
});

app.patch("/api/money-data/records/:rowId", (request, response) => {
  try {
    const rowId = Number(request.params.rowId);
    const update = moneyRecordUpdateFromBody(request.body);
    const currentText = fs.readFileSync(MONEY_FILE, "utf8");
    const nextText = updateMoneyRecordText(currentText, rowId, update);

    if (nextText !== currentText) {
      fs.writeFileSync(MONEY_FILE, nextText, "utf8");
    }

    const data = refreshCache();
    const updatedAt = new Date().toISOString();
    const record = data.money.records.find((moneyRecord) => moneyRecord.rowId === rowId) ?? null;
    broadcast({
      type: "money-data-updated",
      event: "money-record",
      rowId,
      path: publicPath(MONEY_FILE),
      version: dataVersion,
      updatedAt
    });

    response.json({
      ok: true,
      version: dataVersion,
      updatedAt,
      rowId,
      record,
      money: data.money
    });
  } catch (error) {
    response.status(400).json({
      ok: false,
      error: errorText(error)
    });
  }
});

app.get("/api/status", (_request, response) => {
  const exists = fs.existsSync(DATA_FILE);
  const stat = exists ? fs.statSync(DATA_FILE) : null;
  const moneyExists = fs.existsSync(MONEY_FILE);
  const moneyStat = moneyExists ? fs.statSync(MONEY_FILE) : null;
  const sportExists = fs.existsSync(SPORT_FILE);
  const sportStat = sportExists ? fs.statSync(SPORT_FILE) : null;
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
      lastLoadError: money.lastLoadError,
      sync: {
        ...moneySyncState,
        preSync: publicMoneySyncState().preSync
      }
    },
    sport: {
      sourceFile: publicPath(SPORT_FILE),
      sourceMtimeMs: sportStat?.mtimeMs ?? null
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
scheduleNextMoneySync();

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
      hmr: { server, clientPort: PORT }
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

server.on("upgrade", (request, socket, head) => {
  const pathname = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`).pathname;
  if (pathname !== "/ws") return;

  sockets.handleUpgrade(request, socket, head, (webSocket) => {
    sockets.emit("connection", webSocket, request);
  });
});

server.listen(PORT, HOST, () => {
  const shownHost = HOST === "0.0.0.0" ? "localhost" : HOST;
  console.log(`Life Dashboard: http://${shownHost}:${PORT}`);
  console.log(`Data source: ${publicPath(DATA_FILE)}`);
  if (MONEY_SYNC_ENABLED) {
    console.log(`Money sync: enabled, next run ${moneySyncState.nextRunAt ?? "not scheduled"}`);
  } else {
    console.log("Money sync: disabled");
  }
});
