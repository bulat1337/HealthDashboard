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
};

export type HealthDataResponse = {
  version: number;
  data: DashboardData;
};
