import {
  Activity,
  CircleAlert,
  Dumbbell,
  Flame,
  HeartHandshake,
  HeartPulse,
  RefreshCw,
  Scale,
  SlidersHorizontal,
  Users,
  Wallet,
  Waves
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { fetchHealthData, openHealthSocket, refreshMoneyData } from "./api";
import { HealthChart } from "./components/HealthChart";
import { MoneyDashboard } from "./components/MoneyDashboard";
import { RelationshipDashboard } from "./components/RelationshipDashboard";
import { SportDashboard } from "./components/SportDashboard";
import {
  buildChartPoints,
  changeBetweenEdges,
  formatDateShort,
  formatDateTime,
  formatNumber,
  formatSigned,
  latestMetricValue,
  recordsForUser
} from "./stats";
import type { DashboardData, MetricCatalogEntry, NormalizedMeasurement } from "./types";

const DOMAINS = ["health", "money", "relationships", "sport"] as const;
type Domain = (typeof DOMAINS)[number];

const ACTIVE_DOMAIN_STORAGE_KEY = "life-dashboard-active-domain";
const SELECTED_USER_STORAGE_KEY = "life-dashboard-selected-user";

const QUICK_METRICS = [
  "weight_kg",
  "body_fat_percent",
  "muscle_mass_kg",
  "visceral_fat_rating",
  "heart_rate_bpm",
  "body_water_percent"
];

const METRIC_ICONS: Record<string, typeof Scale> = {
  weight_kg: Scale,
  body_fat_percent: Activity,
  muscle_mass_kg: Dumbbell,
  body_water_percent: Waves,
  visceral_fat_rating: Flame,
  heart_rate_bpm: HeartPulse
};

const METRIC_LABEL_OVERRIDES: Record<string, string> = {
  basal_metabolic_rate_kcal: "Базовый обмен",
  estimated_waist_to_hip_ratio: "Индекс талия/бедра",
  body_type_code: "Тип телосложения",
  bioimpedance_resistance_raw: "Сопротивление тела",
  bioimpedance_resistance_2_raw: "Сопротивление тела, низкая частота"
};

const BODY_TYPE_LABELS: Record<number, string> = {
  1: "Скрытое ожирение",
  2: "Ожирение",
  3: "Плотное телосложение",
  4: "Недостаток мышц",
  5: "Стандартное",
  6: "Стандартное мускулистое",
  7: "Худощавое",
  8: "Худощавое мускулистое",
  9: "Очень мускулистое"
};

const DAY_SECONDS = 86400;

function isDomain(value: string | null): value is Domain {
  return DOMAINS.some((domain) => domain === value);
}

function getInitialActiveDomain(): Domain {
  try {
    const storedDomain = window.localStorage.getItem(ACTIVE_DOMAIN_STORAGE_KEY);
    return isDomain(storedDomain) ? storedDomain : "health";
  } catch {
    return "health";
  }
}

function getInitialSelectedUser() {
  try {
    return window.localStorage.getItem(SELECTED_USER_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

function statusText(connected: boolean, lastEventAt: string | null) {
  if (connected && lastEventAt) return `Live, ${formatDateTime(lastEventAt)}`;
  if (connected) return "Live";
  return "Offline";
}

function isAbortError(error: unknown) {
  if (error instanceof DOMException && error.name === "AbortError") return true;
  if (error instanceof Error) {
    return error.name === "AbortError" || error.message.toLowerCase().includes("aborted");
  }
  return false;
}

function metricByKey(metrics: MetricCatalogEntry[], key: string) {
  return metrics.find((metric) => metric.key === key) ?? metrics[0];
}

function displayMetricLabel(metric: MetricCatalogEntry | null | undefined) {
  if (!metric) return "";
  return METRIC_LABEL_OVERRIDES[metric.key] ?? metric.label;
}

function displayMetricUnit(metric: MetricCatalogEntry | null | undefined) {
  if (!metric) return "";
  if (metric.key.startsWith("bioimpedance_resistance")) return "Ω";
  if (!metric.unit) return "";
  if (metric.key === "body_score" && metric.unit === "points") return "баллов";
  if (metric.key === "body_age_years" && metric.unit === "years") return "лет";
  if (metric.key === "basal_metabolic_rate_kcal" && metric.unit.toLowerCase() === "kcal") {
    return "ккал";
  }
  if (metric.key === "bmi" && metric.unit === "kg/m^2") return "кг/м²";
  if (metric.key === "visceral_fat_rating" && metric.unit === "rating") return "";
  if (metric.key === "estimated_waist_to_hip_ratio" && metric.unit === "ratio") return "";
  return metric.unit;
}

function displayMetricValue(metric: MetricCatalogEntry, value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";

  if (metric.key === "body_type_code") {
    const code = Math.round(value);
    if (code <= 0) return "Не определено";
    return BODY_TYPE_LABELS[code] ?? `Тип ${code}`;
  }

  const unit = displayMetricUnit(metric);
  const formattedValue = formatNumber(value, fractionDigitsForMetric(metric));
  return unit ? `${formattedValue} ${unit}` : formattedValue;
}

function pluralRu(value: number, forms: [string, string, string]) {
  const mod10 = value % 10;
  const mod100 = value % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}

function formatPeriodLabel(records: NormalizedMeasurement[]) {
  if (records.length < 2) return "";

  const first = records[0];
  const last = records[records.length - 1];
  const spanDays = Math.max(
    1,
    Math.round((last.measuredAtUnixSeconds - first.measuredAtUnixSeconds) / DAY_SECONDS)
  );

  if (spanDays >= 330) {
    const years = Math.max(1, Math.round(spanDays / 365));
    return years === 1 ? "за год" : `за ${years} ${pluralRu(years, ["год", "года", "лет"])}`;
  }

  if (spanDays >= 25) {
    const months = Math.max(1, Math.round(spanDays / 30));
    return months === 1
      ? "за месяц"
      : `за ${months} ${pluralRu(months, ["месяц", "месяца", "месяцев"])}`;
  }

  return `за ${spanDays} ${pluralRu(spanDays, ["день", "дня", "дней"])}`;
}

function formatMetricChange(records: NormalizedMeasurement[], metricKey: string) {
  const change = changeBetweenEdges(records, metricKey);
  const period = formatPeriodLabel(records);
  return period ? `${formatSigned(change, 2)} ${period}` : formatSigned(change, 2);
}

function fractionDigitsForMetric(metric: MetricCatalogEntry) {
  const precision = metric.precision;
  if (!Number.isFinite(precision) || precision <= 0) return 1;
  if (precision >= 1) return 0;

  let digits = 0;
  while (
    digits < 4 &&
    Math.abs(Math.round(precision * 10 ** digits) - precision * 10 ** digits) > 0.000001
  ) {
    digits += 1;
  }
  return digits;
}

function latestMeasurementForUser(measurements: NormalizedMeasurement[], user: string) {
  return measurements.reduce<NormalizedMeasurement | null>((latest, measurement) => {
    if (measurement.user !== user) return latest;
    if (!latest) return measurement;
    if (measurement.measuredAtUnixSeconds > latest.measuredAtUnixSeconds) return measurement;
    if (
      measurement.measuredAtUnixSeconds === latest.measuredAtUnixSeconds &&
      measurement.rowId > latest.rowId
    ) {
      return measurement;
    }
    return latest;
  }, null);
}

function App() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [selectedUser, setSelectedUser] = useState<string>(() => getInitialSelectedUser());
  const [selectedMetric, setSelectedMetric] = useState<string>("weight_kg");
  const [activeDomain, setActiveDomain] = useState<Domain>(() => getInitialActiveDomain());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [socketConnected, setSocketConnected] = useState(false);
  const [lastEventAt, setLastEventAt] = useState<string | null>(null);
  const [today, setToday] = useState(() => new Date());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [sportRefreshKey, setSportRefreshKey] = useState(0);

  async function load(signal?: AbortSignal) {
    const response = await fetchHealthData(signal);
    setData(response.data);
    setSelectedUser((current) =>
      response.data.users.some((user) => user.name === current)
        ? current
        : response.data.users[0]?.name || ""
    );
    setSelectedMetric((current) =>
      response.data.metrics.some((metric) => metric.key === current)
        ? current
        : response.data.metrics[0]?.key || "weight_kg"
    );
  }

  async function refresh() {
    setIsRefreshing(true);
    setError(null);
    try {
      if (activeDomain === "money") {
        await refreshMoneyData();
      }
      if (activeDomain === "sport") {
        setSportRefreshKey((current) => current + 1);
      }
      await load();
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : String(refreshError));
    } finally {
      setIsRefreshing(false);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    setIsLoading(true);
    load(controller.signal)
      .catch((loadError) => {
        if (controller.signal.aborted || isAbortError(loadError)) return;
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    let retryTimer: number | undefined;
    let socket: WebSocket | null = null;
    let closed = false;

    function connect() {
      socket = openHealthSocket((message) => {
        const event = message as { type?: string; updatedAt?: string };
        if (event.type === "connected") {
          setSocketConnected(true);
        }
        if (event.type === "health-data-updated" || event.type === "money-data-updated") {
          setLastEventAt(event.updatedAt ?? new Date().toISOString());
          load().catch((loadError) =>
            setError(loadError instanceof Error ? loadError.message : String(loadError))
          );
        }
        if (event.type === "sport-data-updated") {
          setLastEventAt(event.updatedAt ?? new Date().toISOString());
          setSportRefreshKey((current) => current + 1);
        }
        if (event.type === "health-data-error" || event.type === "money-data-error") {
          setError("Ошибка чтения обновленных данных");
        }
      });
      socket.addEventListener("open", () => setSocketConnected(true));
      socket.addEventListener("close", () => {
        setSocketConnected(false);
        if (!closed) retryTimer = window.setTimeout(connect, 1200);
      });
      socket.addEventListener("error", () => setSocketConnected(false));
    }

    connect();
    return () => {
      closed = true;
      if (retryTimer) window.clearTimeout(retryTimer);
      socket?.close();
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setToday(new Date()), 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(ACTIVE_DOMAIN_STORAGE_KEY, activeDomain);
    } catch {
      // Ignore storage errors so private browsing or quota issues do not break navigation.
    }
  }, [activeDomain]);

  useEffect(() => {
    if (!selectedUser) return;
    try {
      window.localStorage.setItem(SELECTED_USER_STORAGE_KEY, selectedUser);
    } catch {
      // Ignore storage errors so private browsing or quota issues do not break navigation.
    }
  }, [selectedUser]);

  const selectedMetricInfo = useMemo(() => {
    if (!data) return null;
    return metricByKey(data.metrics, selectedMetric);
  }, [data, selectedMetric]);

  const metricRecords = useMemo(() => {
    if (!data || !selectedUser || !selectedMetric) return [];
    return recordsForUser(data.measurements, selectedUser, selectedMetric);
  }, [data, selectedUser, selectedMetric]);

  const selectedStats = data?.stats[selectedUser]?.[selectedMetric];
  const chartPoints = useMemo(
    () => buildChartPoints(metricRecords, selectedMetric, selectedStats),
    [metricRecords, selectedMetric, selectedStats]
  );

  const quickMetrics = useMemo(() => {
    if (!data) return [];
    return QUICK_METRICS.map((key) => data.metrics.find((metric) => metric.key === key)).filter(
      (metric): metric is MetricCatalogEntry => Boolean(metric)
    );
  }, [data]);

  const latestMeasurement = useMemo(() => {
    if (!data || !selectedUser) return null;
    return latestMeasurementForUser(data.measurements, selectedUser);
  }, [data, selectedUser]);

  const latestMetricRows = useMemo(() => {
    if (!data || !latestMeasurement) return [];
    return data.metrics
      .filter((metric) => Number.isFinite(latestMeasurement.metrics[metric.key]))
      .map((metric) => ({
        metric,
        value: latestMeasurement.metrics[metric.key]
      }));
  }, [data, latestMeasurement]);

  if (isLoading) {
    return (
      <main className="app loading-screen">
        <RefreshCw className="spin" size={28} />
        <span>Загрузка данных</span>
      </main>
    );
  }

  if (error && !data) {
    return (
      <main className="app error-screen">
        <CircleAlert size={32} />
        <h1>Не удалось прочитать данные</h1>
        <p>{error}</p>
      </main>
    );
  }

  if (!data) return null;

  const latestValue = latestMetricValue(metricRecords, selectedMetric);
  const totalChange = changeBetweenEdges(metricRecords, selectedMetric);

  return (
    <main className="app">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">
            <HeartPulse size={24} />
          </div>
          <div>
            <h1>Life Dashboard</h1>
          </div>
        </div>

        <div className="status-strip">
          <div className={socketConnected ? "live-dot online" : "live-dot"} />
          <span>{statusText(socketConnected, lastEventAt)}</span>
          <button
            className="icon-button"
            type="button"
            onClick={() => refresh()}
            disabled={isRefreshing}
            aria-label="Обновить"
            title="Обновить"
          >
            <RefreshCw className={isRefreshing ? "spin" : undefined} size={18} />
          </button>
        </div>
      </header>

      {error ? (
        <section className="error-banner" role="alert">
          <CircleAlert size={18} />
          <span>{error}</span>
        </section>
      ) : null}

      <section className="domain-band">
        <div className="segmented domain-control" aria-label="Раздел">
          <button
            type="button"
            className={activeDomain === "health" ? "active" : ""}
            onClick={() => setActiveDomain("health")}
          >
            <HeartPulse size={16} />
            <span>Здоровье</span>
          </button>
          <button
            type="button"
            className={activeDomain === "money" ? "active" : ""}
            onClick={() => setActiveDomain("money")}
          >
            <Wallet size={16} />
            <span>Деньги</span>
          </button>
          <button
            type="button"
            className={activeDomain === "relationships" ? "active" : ""}
            onClick={() => setActiveDomain("relationships")}
          >
            <HeartHandshake size={16} />
            <span>Отношения</span>
          </button>
          <button
            type="button"
            className={activeDomain === "sport" ? "active" : ""}
            onClick={() => setActiveDomain("sport")}
          >
            <Dumbbell size={16} />
            <span>Спорт</span>
          </button>
        </div>
      </section>

      {activeDomain === "money" ? (
        <MoneyDashboard money={data.money} onMoneyDataUpdated={() => load()} />
      ) : activeDomain === "relationships" ? (
        <RelationshipDashboard today={today} />
      ) : activeDomain === "sport" ? (
        <SportDashboard today={today} refreshKey={sportRefreshKey} />
      ) : selectedMetricInfo ? (
        <>
      <section className="control-band">
        <div className="segmented users-control" aria-label="Пользователь">
          {data.users.map((user) => (
            <button
              key={user.name}
              type="button"
              className={user.name === selectedUser ? "active" : ""}
              onClick={() => setSelectedUser(user.name)}
            >
              <Users size={16} />
              <span>{user.name}</span>
            </button>
          ))}
        </div>

        <label className="select-control">
          <SlidersHorizontal size={17} />
          <select value={selectedMetric} onChange={(event) => setSelectedMetric(event.target.value)}>
            {data.metrics.map((metric) => (
              <option key={metric.key} value={metric.key}>
                {displayMetricLabel(metric)}
                {displayMetricUnit(metric) ? `, ${displayMetricUnit(metric)}` : ""}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="quick-metrics" aria-label="Быстрые метрики">
        {quickMetrics.map((metric) => {
          const Icon = METRIC_ICONS[metric.key] ?? Activity;
          const records = recordsForUser(data.measurements, selectedUser, metric.key);
          const value = latestMetricValue(records, metric.key);
          const isActive = selectedMetric === metric.key;
          const unit = displayMetricUnit(metric);
          return (
            <button
              className={`metric-tile ${isActive ? "active" : ""}`}
              key={metric.key}
              type="button"
              onClick={() => setSelectedMetric(metric.key)}
            >
              <Icon size={20} />
              <span className="tile-label">{displayMetricLabel(metric)}</span>
              <strong>
                {formatNumber(value, 1)}
                {unit ? ` ${unit}` : ""}
              </strong>
              <small>{formatMetricChange(records, metric.key)}</small>
            </button>
          );
        })}
      </section>

      <section className="main-grid">
        <article className="panel chart-panel">
          <div className="panel-heading">
            <div>
              <h2>{displayMetricLabel(selectedMetricInfo)}</h2>
              <span>
                {metricRecords.length} измерений · {formatDateShort(selectedStats?.firstMeasuredAt)} -{" "}
                {formatDateShort(selectedStats?.lastMeasuredAt)}
              </span>
            </div>
            <div className="headline-value">
              <strong>{selectedMetricInfo ? displayMetricValue(selectedMetricInfo, latestValue) : "—"}</strong>
              <span>{formatSigned(totalChange, 2)} за период</span>
            </div>
          </div>

          <HealthChart points={chartPoints} metric={selectedMetricInfo} stats={selectedStats} />

          <div className="legend-row">
            <span>
              <i className="legend-line smooth" /> сглаживание
            </span>
            <span>
              <i className="legend-line raw" /> измерения
            </span>
            <span>
              <i className="legend-band" /> 95% CI
            </span>
            <span>
              <i className="legend-dot" /> выбросы
            </span>
          </div>
        </article>

        <aside className="panel latest-measurement-panel">
          <div className="panel-heading compact">
            <div>
              <h2>Последнее измерение</h2>
              <span>
                {selectedUser} · {formatDateTime(latestMeasurement?.measuredAt)}
              </span>
            </div>
            <div className="latest-count-badge" aria-label="Количество показателей">
              <Activity size={18} />
              <strong>{latestMetricRows.length}</strong>
            </div>
          </div>

          {latestMetricRows.length > 0 ? (
            <dl className="latest-metrics-list">
              {latestMetricRows.map(({ metric, value }) => (
                <div key={metric.key}>
                  <dt>{displayMetricLabel(metric)}</dt>
                  <dd>{displayMetricValue(metric, value)}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <div className="empty-latest-measurement">Нет показателей в последнем измерении.</div>
          )}
        </aside>
      </section>
        </>
      ) : (
        <section className="panel money-empty-panel">
          <CircleAlert size={28} />
          <div>
            <h2>Метрики здоровья недоступны</h2>
            <p>Источник прочитан, каталог метрик пустой.</p>
          </div>
        </section>
      )}
    </main>
  );
}

export default App;
