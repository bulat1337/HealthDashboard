export const INBODY_METRICS = {
  weightKg: { label: "Вес", unit: "кг", digits: 1, max: 500 },
  skeletalMuscleKg: { label: "Скелетные мышцы", unit: "кг", digits: 1, max: 250 },
  bodyFatPercent: { label: "Доля жира", unit: "%", digits: 1, max: 100 },
  bodyFatKg: { label: "Жировая масса", unit: "кг", digits: 1, max: 400 },
  score: { label: "Оценка InBody", unit: "баллов", digits: 0, max: 200 },
  bmi: { label: "ИМТ", unit: "кг/м²", digits: 1, max: 100 },
  totalBodyWaterL: { label: "Общая вода", unit: "л", digits: 1, max: 300 },
  proteinKg: { label: "Протеины", unit: "кг", digits: 1, max: 100 },
  mineralsKg: { label: "Минералы", unit: "кг", digits: 2, max: 30 },
  softLeanKg: { label: "Тощая масса", unit: "кг", digits: 1, max: 400 },
  fatFreeKg: { label: "Безжировая масса", unit: "кг", digits: 1, max: 400 },
  ecwRatio: { label: "Внеклеточная / общая вода", unit: "", digits: 3, max: 1 },
  intracellularWaterL: { label: "Внутриклеточная вода", unit: "л", digits: 1, max: 200 },
  extracellularWaterL: { label: "Внеклеточная вода", unit: "л", digits: 1, max: 200 },
  basalMetabolismKcal: { label: "Базовый обмен", unit: "ккал", digits: 0, max: 10000 },
  visceralFatLevel: { label: "Уровень висцерального жира", unit: "", digits: 0, max: 100 },
  boneMineralsKg: { label: "Минералы в костях", unit: "кг", digits: 2, max: 30 },
  armCircumferenceCm: { label: "Окружность руки", unit: "см", digits: 1, max: 150 },
  recommendedCaloriesKcal: { label: "Рекомендуемая калорийность", unit: "ккал", digits: 0, max: 15000 },
  obesityDegreePercent: { label: "Степень ожирения по бланку", unit: "%", digits: 0, max: 500 },
  targetWeightKg: { label: "Идеальный вес по бланку", unit: "кг", digits: 1, max: 500 },
  weightControlKg: { label: "Контроль веса", unit: "кг", digits: 1, max: 400, signed: true },
  fatControlKg: { label: "Контроль жира", unit: "кг", digits: 1, max: 400, signed: true },
  muscleControlKg: { label: "Контроль мышц", unit: "кг", digits: 1, max: 250, signed: true },
} as const;

export type InBodyMetricKey = keyof typeof INBODY_METRICS;
export type InBodyMetrics = Partial<Record<InBodyMetricKey, number>>;
export const INBODY_REQUIRED: InBodyMetricKey[] = ["weightKg", "skeletalMuscleKg", "bodyFatPercent", "bodyFatKg"];
export const INBODY_SEGMENTS = {
  rightArm: "Правая рука", leftArm: "Левая рука", trunk: "Туловище", rightLeg: "Правая нога", leftLeg: "Левая нога",
} as const;
export type InBodySegmentKey = keyof typeof INBODY_SEGMENTS;
export type InBodySegment = { leanKg?: number; leanPercent?: number; fatKg?: number; fatPercent?: number };
export type InBodyInput = {
  userId: string;
  // Preserve the device's wall-clock date: the paper report has no time zone.
  measuredAtLocal: string;
  device: string;
  heightCm?: number;
  age?: number;
  sex?: "male" | "female";
  metrics: InBodyMetrics;
  ranges?: Partial<Record<InBodyMetricKey, [number, number]>>;
  segments?: Partial<Record<InBodySegmentKey, InBodySegment>>;
  assessments?: Record<string, string>;
  impedance?: ({ frequencyKhz: number } & Partial<Record<InBodySegmentKey, number>>)[];
  notes?: string;
};
export type InBodyRecord = InBodyInput & { id: string; createdAt: string; sourceImage?: string };
export type InBodyData = { schemaVersion: 1; measurements: InBodyRecord[] };
export type InBodyResponse = { data: InBodyData };

export function inbodyDate(value: string, short = false) {
  return new Intl.DateTimeFormat("ru-RU", short
    ? { day: "numeric", month: "short", timeZone: "UTC" }
    : { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }
  ).format(new Date(`${value}Z`));
}

export function inbodyDateCompact(value: string) {
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }).format(new Date(`${value}Z`));
}
