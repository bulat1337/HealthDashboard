export type FitbitSleepStage =
  | "AWAKE"
  | "LIGHT"
  | "DEEP"
  | "REM"
  | "ASLEEP"
  | "RESTLESS";

export type FitbitSleepSegment = { start: string; end: string; type: FitbitSleepStage };
export type FitbitHeartRatePoint = {
  time: string;
  minute: number;
  bpm: number;
  min: number;
  max: number;
  count: number;
};
export type FitbitHeartRateZone = {
  type: "LIGHT" | "MODERATE" | "VIGOROUS" | "PEAK";
  min: number;
  max: number;
};

export type FitbitSleep = {
  start: string;
  end: string;
  bedtime: string | null;
  wakeTime: string | null;
  minutesAsleep: number | null;
  minutesAwake: number | null;
  stages: Partial<Record<FitbitSleepStage, number>>;
  processed: boolean | null;
  // Optional for caches created before detailed sleep graphics.
  timeline?: FitbitSleepSegment[];
  shortAwakenings?: FitbitSleepSegment[];
  outOfBed?: { start: string; end: string }[];
  minutesToFallAsleep?: number | null;

};

export type FitbitDay = {
  date: string;
  steps: number | null;
  distanceKm: number | null;
  calories: number | null;
  activeZoneMinutes: number | null;
  restingHeartRate: number | null;
  hrv: number | null;
  spo2: number | null;
  respiratoryRate: number | null;
  temperatureDeviation: number | null;
  sleep: FitbitSleep | null;
  heartRate?: FitbitHeartRatePoint[] | null;
  heartRateZones?: FitbitHeartRateZone[] | null;
};

export type FitbitExercise = {
  id: string;
  date: string;
  start: string;
  label: string;
  type: string;
  durationMinutes: number;
  distanceKm: number | null;
  calories: number | null;
  averageHeartRate: number | null;
  // Keep the complete session data point, including laps, events and metadata.
  // Optional for caches written before calendar integration.
  dataPoint?: Record<string, unknown>;
};

export type FitbitProfile = {
  userId: string;
  name: string;
  status:
    | "not_configured"
    | "disconnected"
    | "connected"
    | "syncing"
    | "error"
    | "reauthorize";
  canConnect: boolean;
  lastSyncAt: string | null;
  lastAttemptAt: string | null;
  error: string | null;
  warnings: string[];
  days: FitbitDay[];
  exercises: FitbitExercise[];
};

export type FitbitDataResponse = {
  generatedAt: string;
  profiles: FitbitProfile[];
};
