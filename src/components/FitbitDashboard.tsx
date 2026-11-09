import {
  Activity,
  ChartColumn,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Footprints,
  HeartPulse,
  Link2,
  Moon,
  RefreshCw,
  Scale,
  Watch,
} from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { connectFitbit, fetchFitbitData, refreshFitbitData } from "../api";
import type { FitbitDataResponse, FitbitDay } from "../fitbit-types";
import { formatDateTime, formatNumber } from "../stats";
import { FitbitHeartRateChart, FitbitSleepWeek } from "./FitbitHeartRateChart";
import { FitbitSleepDetails } from "./FitbitSleepDetails";

type TrendMetric = "steps" | "sleep" | "restingHeartRate" | "hrv";
const METRICS = [
  {
    key: "steps",
    label: "Шаги",
    unit: "шагов",
    icon: Footprints,
  },
  { key: "sleep", label: "Сон", unit: "", icon: Moon },
  {
    key: "restingHeartRate",
    label: "Пульс в покое",
    unit: "уд/мин",
    icon: HeartPulse,
  },
  {
    key: "hrv",
    label: "Вариабельность пульса",
    unit: "мс",
    icon: Activity,
  },
] as const;
const EXERCISE_LABELS: Record<string, string> = {
  RUNNING: "Бег",
  WALKING: "Ходьба",
  BIKING: "Велосипед",
  OUTDOOR_BIKE: "Велосипед",
  SWIMMING: "Плавание",
  SWIMMING_POOL: "Плавание",
  STRENGTH_TRAINING: "Силовая тренировка",
  YOGA: "Йога",
  PILATES: "Пилатес",
  WORKOUT: "Тренировка",
  HIKING: "Поход",
};

function dateOffset(date: string, offset: number) {
  const result = new Date(`${date}T12:00:00Z`);
  result.setUTCDate(result.getUTCDate() + offset);
  return result.toISOString().slice(0, 10);
}

function todayIso() {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function duration(minutes: number | null | undefined) {
  if (minutes === null || minutes === undefined) return "—";
  const rounded = Math.round(minutes);
  return rounded < 60
    ? `${rounded} мин`
    : `${Math.floor(rounded / 60)} ч ${String(rounded % 60).padStart(2, "0")} мин`;
}

function metricValue(day: FitbitDay | undefined, key: TrendMetric) {
  return key === "sleep"
    ? (day?.sleep?.minutesAsleep ?? null)
    : (day?.[key] ?? null);
}

function valueText(value: number | null, key: TrendMetric) {
  return key === "sleep"
    ? duration(value)
    : formatNumber(value, key === "hrv" ? 1 : 0);
}

function chartDate(date: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));
}

function callbackNotice() {
  const result = new URLSearchParams(window.location.search).get("fitbit");
  const messages: Record<string, string> = {
    connected: "Fitbit подключён. Загружаем ваши показатели.",
    account: "Выберите Google-аккаунт, закреплённый за этим профилем.",
    account_link:
      "Сначала войдите с этим аккаунтом в Google Health на телефоне и синхронизируйте браслет.",
    state: "Ссылка подключения истекла. Начните подключение ещё раз.",
    cancelled: "Подключение отменено. Его можно повторить.",
    scope: "Для подключения разрешите чтение данных Fitbit.",
    reauthorize: "Повторите подключение и разрешите доступ к Fitbit.",
    sync: "Не удалось подключить Fitbit. Повторите попытку.",
  };
  return result
    ? {
        text: messages[result] ?? messages.sync,
        success: result === "connected",
      }
    : null;
}

export function FitbitDashboard({
  userId,
  name,
  refreshKey,
}: {
  userId: string;
  name: string;
  refreshKey: number;
}) {
  const [data, setData] = useState<FitbitDataResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice] = useState(callbackNotice);
  const [selectedDate, setSelectedDate] = useState(todayIso);
  const [chartEnd, setChartEnd] = useState(todayIso);
  const [metric, setMetric] = useState<TrendMetric>("steps");
  const [range, setRange] = useState<7 | 30>(7);
  const sequence = useRef(0);
  const chartId = useId();
  const today = todayIso();
  const isSyncing =
    data?.profiles.find((entry) => entry.userId === userId)?.status ===
    "syncing";

  useEffect(() => {
    const params = new URL(window.location.href);
    if (params.searchParams.has("fitbit")) {
      params.searchParams.delete("fitbit");
      params.searchParams.delete("fitbitUser");
      window.history.replaceState(
        null,
        "",
        `${params.pathname}${params.search}${params.hash}`,
      );
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const current = ++sequence.current;
    fetchFitbitData(controller.signal)
      .then((response) => {
        if (current !== sequence.current || controller.signal.aborted) return;
        setData(response);
        setError(null);
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted && current === sequence.current)
          setError(
            failure instanceof Error
              ? failure.message
              : "Fitbit временно недоступен",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted && current === sequence.current)
          setLoading(false);
      });
    return () => controller.abort();
  }, [refreshKey]);

  useEffect(() => {
    if (!isSyncing) return;
    const controller = new AbortController();
    const timer = window.setInterval(() => {
      fetchFitbitData(controller.signal)
        .then((response) => {
          if (!controller.signal.aborted) setData(response);
        })
        .catch(() => {
          /* The source status and manual retry remain visible while offline. */
        });
    }, 4000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [isSyncing]);

  const profile = data?.profiles.find((entry) => entry.userId === userId);
  const isLinked = Boolean(
    profile &&
      !["not_configured", "disconnected"].includes(profile.status) &&
      (profile.lastAttemptAt ||
        profile.lastSyncAt ||
        profile.status === "syncing" ||
        profile.status === "reauthorize"),
  );
  const syncing = busy || profile?.status === "syncing";
  const dayMap = useMemo(
    () => new Map(profile?.days.map((day) => [day.date, day]) ?? []),
    [profile?.days],
  );
  const selectedDay = dayMap.get(selectedDate);
  const chartDays = useMemo(
    () =>
      Array.from({ length: range }, (_, index) =>
        dateOffset(chartEnd, index - range + 1),
      ),
    [chartEnd, range],
  );
  const values = chartDays.map((date) => metricValue(dayMap.get(date), metric));
  const presentValues = values.filter(
    (value): value is number => value !== null,
  );
  const maxPresent = Math.max(0, ...presentValues);
  const axisStep = metric === "sleep" ? 60 : metric === "steps" ? 1000 : 10;
  const maxValue = Math.max(
    axisStep,
    Math.ceil(maxPresent / axisStep) * axisStep,
  );
  const currentMetric = METRICS.find((entry) => entry.key === metric)!;
  const sleep = selectedDay?.sleep;
  const exercises =
    profile?.exercises.filter((entry) => entry.date === selectedDate) ?? [];

  function selectDate(date: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today) return;
    setSelectedDate(date);
    if (date < chartDays[0] || date > chartEnd) setChartEnd(date);
  }

  async function refresh() {
    setBusy(true);
    setError(null);
    try {
      if (isLinked && profile?.status !== "reauthorize")
        setData(await refreshFitbitData(userId));
      else setData(await fetchFitbitData());
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Не удалось обновить Fitbit",
      );
    } finally {
      setBusy(false);
    }
  }

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      window.location.assign(await connectFitbit(userId));
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Не удалось начать подключение",
      );
      setBusy(false);
    }
  }

  if (loading)
    return (
      <section
        className="panel fitbit-loading"
        aria-label="Fitbit"
        aria-busy="true"
      >
        <RefreshCw size={20} className="spin" />
        <span role="status">Загрузка Fitbit</span>
      </section>
    );

  return (
    <section className="fitbit-dashboard" aria-label={`Fitbit · ${name}`}>
      {notice && !notice.success && (
        <p className="fitbit-notice" role="status">
          {notice.text}
        </p>
      )}
      {(error || profile?.error) && (
        <div className="fitbit-notice" role="alert">
          <CircleAlert size={18} />
          <span>{error || profile?.error}</span>
          {profile?.status === "reauthorize" && profile.canConnect ? (
            <button
              type="button"
              onClick={() => void connect()}
              disabled={busy}
            >
              Подключить снова
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={busy}
            >
              Повторить
            </button>
          )}
        </div>
      )}
      {profile?.warnings.map((warning) => (
        <p key={warning} className="fitbit-notice" role="status">
          {warning}
        </p>
      ))}

      {isLinked && profile?.scaleSync && (
        <div className="fitbit-notice" role="status" aria-label="Передача измерений Xiaomi в Fitbit">
          <Scale size={18} aria-hidden="true" />
          <span>
            <strong>Xiaomi → Fitbit</strong>{" · "}
            {profile.scaleSync.status === "permission_required"
              ? "Разрешите передачу измерений из весов."
              : profile.scaleSync.total === 0
                ? "Новые измерения появятся здесь после взвешивания."
                : `${profile.scaleSync.status === "syncing" ? "Отправляем" : "Передано"} ${profile.scaleSync.synced} из ${profile.scaleSync.total} записей.`}
            {profile.scaleSync.error && <> {profile.scaleSync.error}</>}
            {profile.scaleSync.skipped > 0 && <> Пропущено измерений с неполными данными: {profile.scaleSync.skipped}.</>}
            <br />
            <small>Вес и процент жира передаются как показатели. Остальной состав тела сохраняется в примечании к весу; расчётные значения помечены.</small>
          </span>
          {profile.scaleSync.status === "permission_required" && profile.canConnect ? (
            <button type="button" onClick={() => void connect()} disabled={syncing}>Разрешить передачу</button>
          ) : profile.scaleSync.status === "error" ? (
            <button type="button" onClick={() => void refresh()} disabled={syncing}>Повторить отправку</button>
          ) : null}
        </div>
      )}

      {!isLinked ? (
        <div className="panel fitbit-connect-panel">
          <div className="fitbit-connect-copy">
            <div className="fitbit-watch-mark">
              <Watch size={30} />
            </div>
            <div>
              <h3>Fitbit · {name}</h3>
            </div>
          </div>
          <div className="fitbit-connect-action">
            <button
              className="fitbit-button"
              type="button"
              disabled={!profile?.canConnect || busy}
              onClick={() => void connect()}
            >
              <Link2 size={17} />
              {busy ? "Открываем Google…" : "Подключить Fitbit"}
            </button>
            <span>
              {profile?.canConnect
                ? "Войдите в свой Google-аккаунт"
                : "Подключение станет доступно после настройки доступа"}
            </span>
          </div>
          <div className="fitbit-connect-features">
            <span>
              <Footprints size={17} />
              Активность за день
            </span>
            <span>
              <Moon size={17} />
              Сон и его стадии
            </span>
            <span>
              <HeartPulse size={17} />
              Пульс и HRV
            </span>
            <span>
              <Scale size={17} />
              Xiaomi → Fitbit
            </span>
          </div>
        </div>
      ) : (
        <>
          <div className="fitbit-day-toolbar">
            <div className="fitbit-date-control">
              <button
                type="button"
                className="icon-button"
                aria-label="Предыдущий день Fitbit"
                onClick={() => selectDate(dateOffset(selectedDate, -1))}
              >
                <ChevronLeft size={18} />
              </button>
              <label>
                <span className="sr-only">Дата показателей Fitbit</span>
                <input
                  type="date"
                  value={selectedDate}
                  max={today}
                  onChange={(event) => selectDate(event.target.value)}
                />
              </label>
              <button
                type="button"
                className="icon-button"
                aria-label="Следующий день Fitbit"
                disabled={selectedDate >= today}
                onClick={() => selectDate(dateOffset(selectedDate, 1))}
              >
                <ChevronRight size={18} />
              </button>
            </div>
            <span className="fitbit-day-label">
              {selectedDate === today
                ? "Сегодня"
                : selectedDate === dateOffset(today, -1)
                  ? "Вчера"
                  : chartDate(selectedDate)}
            </span>
            {selectedDate !== today && (
              <button
                type="button"
                className="fitbit-text-button"
                onClick={() => {
                  setSelectedDate(today);
                  setChartEnd(today);
                }}
              >
                К сегодняшнему дню
              </button>
            )}
          </div>
          <div
            className="fitbit-metrics"
            aria-label="Показатели Fitbit за выбранный день"
          >
            {METRICS.map(({ key, label, unit, icon: Icon }) => {
              const value = metricValue(selectedDay, key);
              return (
                <button
                  type="button"
                  key={key}
                  className={`metric-tile fitbit-metric ${metric === key ? "active" : ""}`}
                  aria-pressed={metric === key}
                  aria-controls={chartId}
                  onClick={() => setMetric(key)}
                >
                  <Icon size={20} />
                  <span className="tile-label">{label}</span>
                  <strong>
                    {valueText(value, key)}
                    {unit && value !== null && (
                      <span className="metric-unit"> {unit}</span>
                    )}
                  </strong>
                  {key === "sleep" && <FitbitSleepWeek days={profile?.days ?? []} date={selectedDate} />}
                  {value === null && <small>Нет данных за этот день</small>}
                </button>
              );
            })}
          </div>
          <div className="fitbit-detail-grid">
            <FitbitHeartRateChart key={`${userId}:${selectedDate}:heart`} day={selectedDay} />
            <article className="panel fitbit-trend-panel" id={chartId}>
              <div className="panel-heading">
                <div>
                  <h3>{currentMetric.label}</h3>
                  <span>
                    {chartDate(chartDays[0])} — {chartDate(chartEnd)}
                  </span>
                </div>
                <div
                  className="segmented fitbit-range"
                  aria-label="Период Fitbit"
                >
                  {([7, 30] as const).map((days) => (
                    <button
                      type="button"
                      key={days}
                      className={range === days ? "active" : ""}
                      aria-pressed={range === days}
                      onClick={() => setRange(days)}
                    >
                      {days} дней
                    </button>
                  ))}
                </div>
              </div>
              {presentValues.length ? (
                <div className={`fitbit-trend ${range === 30 ? "dense" : ""}`}>
                  <div className="fitbit-chart-axis" aria-hidden="true">
                    <span>
                      {metric === "sleep"
                        ? `${Math.ceil(maxValue / 60)} ч`
                        : formatNumber(maxValue, 0)}
                    </span>
                    <span>0</span>
                  </div>
                  <div
                    className="fitbit-chart-bars"
                    style={{
                      gridTemplateColumns: `repeat(${range}, minmax(0, 1fr))`,
                    }}
                    aria-label={`Динамика: ${currentMetric.label}`}
                  >
                    {chartDays.map((date, index) => {
                      const value = values[index],
                        selected = date === selectedDate;
                      const label = `${chartDate(date)}: ${value === null ? "нет данных" : `${valueText(value, metric)} ${currentMetric.unit}`}`;
                      return (
                        <button
                          type="button"
                          className={`fitbit-chart-day ${selected ? "selected" : ""} ${value === null ? "missing" : ""}`}
                          key={date}
                          title={label}
                          aria-label={label}
                          aria-pressed={selected}
                          onClick={() => setSelectedDate(date)}
                        >
                          <span className="fitbit-bar-track" aria-hidden="true">
                            <span
                              className="fitbit-bar"
                              style={{
                                height:
                                  value === null
                                    ? 0
                                    : `${(value / maxValue) * 100}%`,
                              }}
                            />
                          </span>
                          <span className="fitbit-bar-date" aria-hidden="true">
                            {range === 7 ||
                            index === 0 ||
                            index === range - 1 ||
                            index % 7 === 0
                              ? Number(date.slice(8))
                              : ""}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="fitbit-chart-empty">
                  <ChartColumn size={30} />
                  <p>
                    {syncing
                      ? "Загружаем историю показателей"
                      : "За этот период данных пока нет"}
                  </p>
                </div>
              )}
            </article>
            <FitbitSleepDetails key={`${userId}:${selectedDate}`} sleep={sleep} days={profile?.days ?? []} date={selectedDate} />
            <article className="panel fitbit-detail-panel">
              <div className="panel-heading">
                <h3>Активность</h3>
                <Footprints size={20} />
              </div>
              <dl className="fitbit-detail-list">
                <div>
                  <dt>Дистанция</dt>
                  <dd>
                    {selectedDay?.distanceKm == null
                      ? "—"
                      : `${formatNumber(selectedDay.distanceKm, 2)} км`}
                  </dd>
                </div>
                <div>
                  <dt>Всего калорий</dt>
                  <dd>
                    {selectedDay?.calories == null
                      ? "—"
                      : `${formatNumber(selectedDay.calories, 0)} ккал`}
                  </dd>
                </div>
                <div>
                  <dt>Минуты активных зон</dt>
                  <dd>
                    {selectedDay?.activeZoneMinutes == null
                      ? "—"
                      : `${formatNumber(selectedDay.activeZoneMinutes, 0)} мин`}
                  </dd>
                </div>
              </dl>
            </article>
          </div>
          <article className="panel fitbit-workouts">
            <div className="panel-heading">
              <div>
                <h3>Тренировки</h3>
                <span>{chartDate(selectedDate)}</span>
              </div>
              <Activity size={20} />
            </div>
            {exercises.length ? (
              <ul>
                {exercises.map((entry) => (
                  <li key={entry.id}>
                    <span>
                      <strong>
                        {EXERCISE_LABELS[entry.type] ?? entry.label}
                      </strong>
                      <small>
                        {new Intl.DateTimeFormat("ru-RU", {
                          hour: "2-digit",
                          minute: "2-digit",
                        }).format(new Date(entry.start))}
                      </small>
                    </span>
                    <span>
                      {duration(entry.durationMinutes)}
                      {entry.distanceKm !== null && (
                        <small>{formatNumber(entry.distanceKm, 2)} км</small>
                      )}
                    </span>
                    <span>
                      {entry.calories === null
                        ? "—"
                        : `${formatNumber(entry.calories, 0)} ккал`}
                      {entry.averageHeartRate !== null && (
                        <small>
                          {formatNumber(entry.averageHeartRate, 0)} уд/мин
                        </small>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="fitbit-panel-empty">
                За этот день в Fitbit нет записанных тренировок.
              </p>
            )}
          </article>
        </>
      )}
    </section>
  );
}
