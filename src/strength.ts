export const STRENGTH_EXERCISES = {
  pullUps: "Подтягивания средним хватом",
  closePullUps: "Подтягивания узким хватом",
  cableRow: "Горизонтальная тяга",
  latPulldown: "Тяга верхнего блока",
  tricepsExtension: "Разгибание гантели из-за головы",
  hyperextension: "Гиперэкстензия",
  lateralRaise: "Разведения гантелей в стороны",
  frontRaise: "Подъёмы гантелей перед собой",
  rearRaise: "Разведения на заднюю дельту с гантелью",
  cableLateralRaise: "Средняя дельта в кроссовере",
  cableFrontRaise: "Передняя дельта в кроссовере",
  cableRearRaise: "Задняя дельта в кроссовере",
  arnoldPress: "Жим Арнольда",
  squat: "Приседания",
  legCurl: "Сгибание ног",
  legExtension: "Разгибание ног",
  legPress: "Жим ногами сидя",
  legRaise: "Подъём ног на пресс",
  reverseCrunch: "Обратные скручивания",
  cableCrunch: "Скручивания на блоке (монах)",
  seatedCrunch: "Скручивания в тренажёре",
  inclinePress: "Жим гантелей на наклонной скамье",
  inclineRow: "Тяга гантелей на наклонной скамье",
  cableFly: "Сведения рук в кроссовере",
  barbellCurl: "Подъём штанги на бицепс",
  dumbbellCurl: "Подъём гантелей на бицепс",
  inclineCurl: "Подъём гантелей на бицепс в наклоне",
  cableCurl: "Сгибание рук на блоке",
  arnoldCurl: "Сгибания Арнольда",
  elevatedPushUps: "Отжимания на возвышении"
} as const;

const exercise = STRENGTH_EXERCISES;

export const STRENGTH_PLANS = {
  back: {
    name: "Спина + Плечи + Трицепс",
    activityKey: "strength_upper",
    exercises: [exercise.pullUps, exercise.cableRow, exercise.tricepsExtension,
      exercise.cableLateralRaise, exercise.cableFrontRaise, exercise.hyperextension,
      exercise.latPulldown, exercise.lateralRaise, exercise.frontRaise, exercise.arnoldPress,
      exercise.cableRearRaise, exercise.rearRaise]
  },
  legs: {
    name: "Ноги + Пресс",
    activityKey: "strength_lower",
    exercises: [exercise.squat, exercise.legRaise, exercise.reverseCrunch, exercise.legExtension, exercise.cableCrunch,
      exercise.legCurl, exercise.legPress, exercise.seatedCrunch]
  },
  chest: {
    name: "Грудь + Бицепс",
    activityKey: "strength_upper",
    exercises: [exercise.inclinePress, exercise.cableFly, exercise.closePullUps,
      exercise.barbellCurl, exercise.cableCurl, exercise.dumbbellCurl, exercise.elevatedPushUps,
      exercise.inclineCurl, exercise.arnoldCurl, exercise.inclineRow]
  }
} as const;

export type StrengthPlanId = keyof typeof STRENGTH_PLANS;
export const STRENGTH_PLAN_IDS = Object.keys(STRENGTH_PLANS) as StrengthPlanId[];

export type StrengthSegment = { weightKg: number | null; reps: number | null; note?: string };
export type StrengthSet = { exercise: string; segments: StrengthSegment[]; approximate?: boolean };
export type StrengthSession = {
  id: string;
  date: string;
  planId: StrengthPlanId;
  sets: StrengthSet[];
} & (
  { source: "obsidian" | "manual" } |
  { source: "dashboard"; startedAt: string; endedAt: string }
);
export type LoggedStrengthSession = Extract<StrengthSession, { source: "dashboard" }>;

export function isStrengthPlan(value: unknown): value is StrengthPlanId {
  return typeof value === "string" && Object.hasOwn(STRENGTH_PLANS, value);
}

export function groupStrengthSets(sets: StrengthSet[]) {
  const groups = new Map<string, { set: StrengthSet; index: number }[]>();
  sets.forEach((set, index) => {
    const group = groups.get(set.exercise) ?? [];
    group.push({ set, index });
    groups.set(set.exercise, group);
  });
  return groups;
}
