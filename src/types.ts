export type NormalizedMeasurement = {
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

export type DashboardUser = {
  id: string;
  name: string;
  accountId: string | null;
  heightCm: number | null;
  targetWeightKg: number | null;
  measurementCount: number;
  firstMeasuredAt: string | null;
  lastMeasuredAt: string | null;
};

export type MetricCatalogEntry = {
  key: string;
  label: string;
  unit: string;
  category: string;
  precision: number;
  valueCount: number;
};

export type MetricStats = {
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

export type MoneyStatus = "ready" | "missing" | "error";

export type MoneyRecord = {
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

export type MoneyRecordUpdate = {
  dateIso: string;
  totalAmount: number | null;
  freeAmount: number | null;
  investmentAmount: number | null;
  reserveAmount: number | null;
  creditCardDebt: number | null;
  rentPaid: boolean | null;
};

export type MoneyEvent = {
  rowId: number;
  bank: string;
  date: string;
  dateIso: string;
  title: string;
  daysFromToday: number;
};

export type MoneySummary = {
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

export type MoneySyncState = {
  status: "idle" | "running" | "ok" | "error" | "disabled";
  enabled: boolean;
  source: string;
  trigger: "manual" | "schedule" | null;
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

export type MoneyData = {
  status: MoneyStatus;
  sourceFile: string;
  sourceMtimeMs: number | null;
  lastLoadError: string | null;
  sync: MoneySyncState;
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

export type DashboardData = {
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

export type HealthDataResponse = {
  version: number;
  data: DashboardData;
};

export type SportActivityKey =
  | "run"
  | "pilates"
  | "strength_lower"
  | "strength_upper"
  | "strength_whole"
  | "cycling"
  | "pull_ups"
  | "push_ups";

export type SportActivityCatalogEntry = {
  key: SportActivityKey;
  label: string;
  color: string;
};

export type SportMaxReps = {
  pullUps: number | null;
  pushUps: number | null;
};

export type SportEntry = {
  date: string;
  activities: SportActivityKey[];
  runDistanceKm: number | null;
  maxReps: SportMaxReps;
};

export type SportUser = {
  id: string;
  name: string;
  activityTypes: SportActivityKey[];
  entries: SportEntry[];
};

export type SportData = {
  schemaVersion: number;
  generatedAt: string;
  sourceFile: string;
  sourceMtimeMs: number | null;
  activityCatalog: SportActivityCatalogEntry[];
  users: SportUser[];
};

export type SportDataResponse = {
  data: SportData;
};
