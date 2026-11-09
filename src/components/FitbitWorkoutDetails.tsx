import { ChevronDown, Watch, type LucideIcon } from "lucide-react";
import type { FitbitExercise } from "../fitbit-types";
import type { SportFitbitWorkout } from "../types";

const number = (value: number, digits = 2) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: digits }).format(value);
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const LABELS: Record<string, string> = {
  name: "Идентификатор", dataPointName: "Идентификатор записи", dataSource: "Источник данных",
  exercise: "Тренировка", exerciseType: "Тип занятия", displayName: "Название Fitbit",
  interval: "Интервал", startTime: "Начало", endTime: "Окончание", startUtcOffset: "Часовой пояс начала",
  endUtcOffset: "Часовой пояс окончания", civilStartTime: "Местное время начала", civilEndTime: "Местное время окончания",
  activeDuration: "Активное время", metricsSummary: "Показатели", caloriesKcal: "Калории, ккал",
  distanceMillimeters: "Дистанция", steps: "Шаги", averageHeartRateBeatsPerMinute: "Средний пульс, уд/мин",
  minimumHeartRateBeatsPerMinute: "Минимальный пульс, уд/мин", maximumHeartRateBeatsPerMinute: "Максимальный пульс, уд/мин",
  activeZoneMinutes: "Минуты активных зон", averageSpeedMillimetersPerSecond: "Средняя скорость",
  averagePaceSecondsPerMeter: "Средний темп", elevationGainMillimeters: "Набор высоты",
  elevationLossMillimeters: "Снижение высоты", timeInHeartRateZones: "Время в пульсовых зонах",
  heartRateZone: "Пульсовая зона", duration: "Длительность", minutes: "Минуты", zone: "Зона",
  splitSummaries: "Круги и отрезки", splitType: "Тип отрезка", events: "События", exerciseEvents: "События тренировки",
  eventType: "Тип события", type: "Тип", time: "Время", metadata: "Сведения о записи",
  recordingMethod: "Способ записи", application: "Приложение", device: "Устройство", platform: "Платформа",
  packageName: "Приложение", manufacturer: "Производитель", model: "Модель", version: "Версия",
  date: "Дата", year: "Год", month: "Месяц", day: "День", hours: "Часы", seconds: "Секунды", nanos: "Наносекунды",
  createTime: "Создано", updateTime: "Обновлено", originDataSourceId: "Исходный источник",
  heartRateZones: "Пульсовые зоны", fatBurn: "Жиросжигание", cardio: "Кардио", peak: "Пиковая зона",
  heartRateZoneDurations: "Время в пульсовых зонах", lightTime: "Лёгкая нагрузка", moderateTime: "Умеренная нагрузка",
  vigorousTime: "Интенсивная нагрузка", peakTime: "Пиковая нагрузка", runVo2Max: "VO₂ max бега, мл/кг/мин",
  mobilityMetrics: "Техника бега", avgGroundContactTimeDuration: "Время контакта с землёй",
  avgCadenceStepsPerMinute: "Средний каденс, шаг/мин", avgStrideLengthMillimeters: "Средняя длина шага",
  avgVerticalOscillationMillimeters: "Вертикальные колебания", avgVerticalRatio: "Вертикальное соотношение",
  logType: "Способ регистрации", logId: "Идентификатор тренировки", tcxLink: "Файл тренировки",
};
const VALUES: Record<string, string> = {
  RUNNING: "Бег", TRAIL_RUN: "Бег по пересечённой местности", TREADMILL: "Беговая дорожка",
  STRENGTH_TRAINING: "Силовая тренировка", WEIGHTLIFTING: "Тяжёлая атлетика", WEIGHTS: "Тренировка с весами",
  FUNCTIONAL_STRENGTH_TRAINING: "Функциональная силовая тренировка", YOGA: "Йога", PILATES: "Пилатес",
  BIKING: "Велотренировка", STATIONARY_BIKE: "Велотренажёр", SPINNING: "Сайклинг",
  ACTIVELY_MEASURED: "Записано устройством", AUTOMATICALLY_RECORDED: "Распознано автоматически",
  MANUALLY_ENTERED: "Введено вручную в Fitbit", PAUSE: "Пауза", RESUME: "Продолжение",
  FAT_BURN: "Жиросжигание", CARDIO: "Кардио", PEAK: "Пиковая зона", OUT_OF_RANGE: "Вне активных зон",
};

function duration(minutes: number) {
  return minutes < 1 ? `${number(minutes * 60, 0)} с` : `${number(minutes, 1)} мин`;
}

export function fitbitWorkoutClock(exercise: FitbitExercise, end = false) {
  const interval = object(object(exercise.dataPoint?.exercise).interval);
  const civil = object(interval[end ? "civilEndTime" : "civilStartTime"]);
  const time = object(civil.time);
  if (Object.keys(civil).length && Object.keys(time).length) {
    return `${String(time.hours ?? 0).padStart(2, "0")}:${String(time.minutes ?? 0).padStart(2, "0")}`;
  }
  const raw = end ? interval.endTime : exercise.start;
  if (typeof raw !== "string" || !Number.isFinite(Date.parse(raw))) return "—";
  const offset = interval[end ? "endUtcOffset" : "startUtcOffset"];
  if (typeof offset === "string" && /^-?\d+(\.\d+)?s$/.test(offset)) {
    return new Date(Date.parse(raw) + Number(offset.slice(0, -1)) * 1000).toISOString().slice(11, 16);
  }
  return new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" }).format(new Date(raw));
}

function fieldValue(key: string, value: unknown): string {
  if (value === null) return "Нет данных";
  if (typeof value === "boolean") return value ? "Да" : "Нет";
  const parsed = typeof value === "number" || (typeof value === "string" && value.trim()) ? Number(value) : NaN;
  if (Number.isFinite(parsed)) {
    if (key === "distanceMillimeters") return `${number(parsed / 1_000_000, 3)} км`;
    if (key.endsWith("MillimetersPerSecond")) return `${number(parsed * .0036)} км/ч`;
    if (key.endsWith("Millimeters")) return `${number(parsed / 1000)} м`;
    if (key === "averagePaceSecondsPerMeter") {
      const seconds = Math.round(parsed * 1000);
      return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} мин/км`;
    }
    return number(parsed, 6);
  }
  if (typeof value === "string") {
    if (["activeDuration", "duration", "lightTime", "moderateTime", "vigorousTime", "peakTime"].includes(key) && /^\d+(\.\d+)?s$/.test(value)) return duration(Number(value.slice(0, -1)) / 60);
    return VALUES[value] ?? value;
  }
  return String(value);
}

/** Every returned field stays reachable, including new Fitbit fields unknown to this client. */
function DataFields({ value }: { value: Record<string, unknown> | unknown[] }) {
  return <dl className="sport-fitbit-fields">{Object.entries(value).map(([key, item]) => {
    const label = Array.isArray(value) ? `Запись ${Number(key) + 1}` : LABELS[key] ?? key.replace(/([a-z])([A-Z])/g, "$1 $2");
    return <div key={key}>{item !== null && typeof item === "object" ? (
      <details><summary>{label}{Array.isArray(item) ? ` · ${item.length}` : ""}</summary>
        {Object.keys(item).length ? <DataFields value={item as Record<string, unknown>} /> : <p className="sport-fitbit-note">Нет данных</p>}
      </details>
    ) : <><dt>{label}</dt><dd>{fieldValue(key, item)}</dd></>}</div>;
  })}</dl>;
}

export function FitbitWorkoutDetails({ workout, label, Icon, children }: { workout: SportFitbitWorkout; label: string; Icon: LucideIcon; children?: import("react").ReactNode }) {
  const exercise = workout.exercise;
  const session = object(exercise.dataPoint?.exercise);
  const extraMetrics = Object.fromEntries(Object.entries(object(session.metricsSummary))
    .filter(([key]) => !["caloriesKcal", "distanceMillimeters", "averageHeartRateBeatsPerMinute"].includes(key)));
  return <details className="sport-fitbit-workout">
    <summary className="sport-fitbit-summary">
      <Icon size={18} aria-hidden="true" />
      <span className="sport-fitbit-title"><strong>{label}{exercise.distanceKm !== null ? ` · ${number(exercise.distanceKm)} км` : ""}</strong>
        <small>{fitbitWorkoutClock(exercise)} · {duration(exercise.durationMinutes)}</small></span>
      <span className="sport-fitbit-badge"><Watch size={13} aria-hidden="true" /> Fitbit</span>
      <ChevronDown className="sport-fitbit-chevron" size={16} aria-hidden="true" />
    </summary>
    <div className="sport-fitbit-content">
      <p className="sport-fitbit-note">Добавлено автоматически из Fitbit</p>
      {children}
      <dl className="sport-fitbit-fields">
        <div><dt>Название Fitbit</dt><dd>{exercise.label}</dd></div>
        <div><dt>Начало — окончание</dt><dd>{fitbitWorkoutClock(exercise)} — {fitbitWorkoutClock(exercise, true)}</dd></div>
        <div><dt>Длительность</dt><dd>{duration(exercise.durationMinutes)}</dd></div>
        {exercise.distanceKm !== null && <div><dt>Дистанция</dt><dd>{number(exercise.distanceKm, 3)} км</dd></div>}
        {exercise.calories !== null && <div><dt>Калории</dt><dd>{number(exercise.calories, 0)} ккал</dd></div>}
        {exercise.averageHeartRate !== null && <div><dt>Средний пульс</dt><dd>{number(exercise.averageHeartRate, 0)} уд/мин</dd></div>}
      </dl>
      {session.activeDuration !== undefined && <DataFields value={{ activeDuration: session.activeDuration }} />}
      {Object.keys(extraMetrics).length > 0 && <DataFields value={extraMetrics} />}
      {exercise.dataPoint ? <details className="sport-fitbit-all"><summary>Все данные тренировки</summary><DataFields value={exercise.dataPoint} /></details>
        : <p className="sport-fitbit-note">Дополнительные сведения появятся после обновления Fitbit.</p>}
    </div>
  </details>;
}
