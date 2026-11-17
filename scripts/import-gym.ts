import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { localDate } from "../server/fitbit-data.js";
import { storeStrengthSessions } from "../server/sport-strength.js";
import {
  STRENGTH_EXERCISES as exercise, STRENGTH_PLANS, type StrengthPlanId, type StrengthSegment, type StrengthSession, type StrengthSet
} from "../src/strength.js";

const aliases = new Map<string, string>();
function addAliases(name: string, ...variants: string[]) {
  for (const variant of [name, ...variants]) aliases.set(normalize(variant), name);
}

function normalize(text: string) {
  return text.trim().toLowerCase().replaceAll("ё", "е").replace(/\s+/g, " ");
}

addAliases(exercise.pullUps, "Подтягивания средним зватом", "Подтягивания средний хват");
addAliases(exercise.closePullUps, "Подтягивание узким хватом");
addAliases(exercise.cableRow, "Гребная тяга", "Гребля");
addAliases(exercise.latPulldown, "Lat pull down (close grip)", "Тяга сверху");
addAliases(exercise.tricepsExtension, "Гантели над головой - трицепс", "Подъем гантели, трицепс", "Трицепс",
  "Трицепс через голову", "Трицепс над головой");
addAliases(exercise.hyperextension);
addAliases(exercise.lateralRaise, "Разведение гантелей в стороны", "Подъем гантелей дельты", "Разведение гантелей",
  "Latgeral raise", "Lateral raise", "Средние дельты гантели");
addAliases(exercise.frontRaise, "Переднике дельты гантели", "Передние дельты гантели");
addAliases(exercise.rearRaise, "Гантеля задняя дельта");
addAliases(exercise.cableLateralRaise, "Кабель средние дельты", "Кабель средняя дельта");
addAliases(exercise.cableFrontRaise, "Кабель Передние дельты", "Кабель передняя дельта");
addAliases(exercise.cableRearRaise, "Кабель задние дельты");
addAliases(exercise.arnoldPress, "Arnold press", "Arnold");
addAliases(exercise.squat, "Присед");
addAliases(exercise.legCurl, "Сгибание ног, задняя часть", "Сгибание ног лёжа");
addAliases(exercise.legExtension);
addAliases(exercise.legPress);
addAliases(exercise.legRaise, "Подъем ног", "Подъем ног в висе", "Подъем ног на бруьях", "Подъем ног на брусьях");
addAliases(exercise.reverseCrunch);
addAliases(exercise.cableCrunch, "Монах", "Monk");
addAliases(exercise.seatedCrunch, "Пресс сидя чередуя");
addAliases(exercise.inclinePress, "Жим полулёжа", "Жим гантелей полулёжа", "Грудь полулёжа");
addAliases(exercise.inclineRow, "Тяга гантелей полулёжа");
addAliases(exercise.cableFly, "Cable chest", "Грудь кабель", "Кабель грудь");
addAliases(exercise.barbellCurl, "Бы ицепс на грифе", "Бицепс гриф");
addAliases(exercise.dumbbellCurl, "Dumbell curl", "Бицепс");
addAliases(exercise.cableCurl, "Бицепс кабель");
addAliases(exercise.arnoldCurl, "Arnold curl");
addAliases(exercise.elevatedPushUps, "Отжимания с возвышенностью(2 платформы)", "Отжимания на возвышенности",
  "Отжимания с возвышенностью");

const bodyweight = new Set<string>([exercise.pullUps, exercise.closePullUps, exercise.legRaise, exercise.reverseCrunch, exercise.elevatedPushUps]);
const variants: Record<string, string> = {
  "lat pull down (close grip)": "Узкий хват",
  "подъем ног в висе": "В висе",
  "подъем ног на бруьях": "На брусьях",
  "подъем ног на брусьях": "На брусьях",
  "сгибание ног лежа": "Лёжа",
  "отжимания с возвышенностью(2 платформы)": "2 платформы",
  "пресс сидя чередуя": "Чередование"
};

function identify(name: string) {
  const normalized = normalize(name);
  const canonical = aliases.get(normalized);
  if (!canonical) throw new Error(`Неизвестное упражнение «${name}»`);
  return { canonical, variant: variants[normalized] };
}

function parseRow(line: string): StrengthSet[] {
  const average = line.match(/^(.+?)\s*[,—–:-]\s*(\d+) подход[а-я]* в среднем по (\d+)(?:,\s*([\d.]+)\s*кг)?$/i);
  if (average) {
    const { canonical } = identify(average[1]);
    const weightKg = average[4] ? Number(average[4]) : bodyweight.has(canonical) ? 0 : null;
    return Array.from({ length: Number(average[2]) }, () => ({
      exercise: canonical, approximate: true, segments: [{ weightKg, reps: Number(average[3]) }]
    }));
  }
  const row = line.match(/^(.+?)\s*[:—–-]\s*(?=\d)(.+)$/);
  if (!row) throw new Error(`Не удалось прочитать строку «${line}»`);
  const { canonical, variant } = identify(row[1]);
  let weightKg: number | null = bodyweight.has(canonical) ? 0 : null;
  const parts = row[2]
    .replace(/[\[\]]/g, "")
    .replace(/(?<=\d)\s+(?=\d+(?:\.\d+)?\s*(?:кг)?\s*-)/g, ",")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.map((part) => {
    const inclined = canonical === exercise.dumbbellCurl && /\s+в наклоне$/i.test(part);
    const segments = part.replace(/\s+в наклоне$/i, "").split("+").map((raw): StrengthSegment => {
      const token = raw.trim().match(/^(?:(\d+(?:\.\d+)?)\s*(?:кг)?\s*-\s*)?(\d+)\s*(?:\(([^)]+)\)|\.)?$/i);
      const weightOnly = raw.trim().match(/^(\d+(?:\.\d+)?)\s*кг?$/i);
      if (weightOnly) return { weightKg: weightKg = Number(weightOnly[1]), reps: null };
      if (!token) throw new Error(`Не удалось прочитать подход «${raw}»`);
      if (token[1]) weightKg = Number(token[1]);
      const note = [variant, token[3]].filter(Boolean).join(" · ");
      return { weightKg, reps: Number(token[2]), ...(note ? { note } : {}) };
    });
    return { exercise: inclined ? exercise.inclineCurl : canonical, segments };
  });
}

function inferPlan(sets: StrengthSet[]): StrengthPlanId {
  const names = new Set(sets.map((set) => set.exercise));
  const planIds = ["legs", "chest", "back"] as const;
  const score = (plan: StrengthPlanId) => STRENGTH_PLANS[plan].exercises.reduce((total, name) =>
    names.has(name) ? total + (name === exercise.inclinePress || name === exercise.cableFly ? 2 : 1) : total, 0);
  return planIds.reduce((best, plan) => score(plan) > score(best) ? plan : best, planIds[0] as StrengthPlanId);
}

export function parseGymNote(markdown: string, id: string, date: string): StrengthSession {
  const sets = markdown.split(/^\s*Love:\s*$/im)[0].split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("**Tags:**") && !/^Me:$/i.test(line))
    .flatMap(parseRow);
  if (sets.length === 0) throw new Error("В заметке нет подходов.");
  return { id, date, planId: inferPlan(sets), source: "obsidian", sets };
}

function main() {
  const [folder, ...options] = process.argv.slice(2);
  if (!folder || folder.startsWith("--") || options.some((option) => option !== "--write")) {
    throw new Error('Использование: npm run sport:gym:import -- "/путь/к/GYM" [--write]');
  }
  const files = fs.readdirSync(folder).filter((name) => /^Day \d+\.md$/.test(name));
  if (!files.length) throw new Error("В папке нет заметок Day N.md.");
  const sessions = files.map((filename) => {
    const notePath = path.join(folder, filename);
    try {
      const id = `obsidian-gym-${Number(filename.match(/\d+/)![0])}`;
      const date = localDate(fs.statSync(notePath).birthtime, "Europe/Moscow");
      return parseGymNote(fs.readFileSync(notePath, "utf8"), id, date);
    } catch (error) {
      throw new Error(`${filename}: ${error instanceof Error ? error.message : error}`);
    }
  }).sort((a, b) => a.date.localeCompare(b.date));
  console.log(`Прочитано тренировок: ${sessions.length}. Подходов: ${sessions.reduce((sum, { sets }) => sum + sets.length, 0)}.`);
  if (options.includes("--write")) {
    const target = process.env.SPORT_DATA_FILE || fileURLToPath(new URL("../data/sport/sport-tracker.json", import.meta.url));
    console.log(`Добавлено тренировок: ${storeStrengthSessions(target, "bulat", sessions)}.`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
