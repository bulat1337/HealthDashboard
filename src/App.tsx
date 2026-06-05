import {
  Activity,
  CircleAlert,
  Dumbbell,
  HeartPulse,
  RefreshCw,
  Scale,
  ShieldCheck,
  SlidersHorizontal,
  Users,
  Waves
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { fetchHealthData, openHealthSocket } from "./api";
import { HealthChart } from "./components/HealthChart";
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
import type { DashboardData, MetricCatalogEntry } from "./types";

const QUICK_METRICS = [
  "weight_kg",
  "body_fat_percent",
  "muscle_mass_kg",
  "body_water_percent",
  "body_score",
  "heart_rate_bpm"
];

const METRIC_ICONS: Record<string, typeof Scale> = {
  weight_kg: Scale,
  body_fat_percent: Activity,
  muscle_mass_kg: Dumbbell,
  body_water_percent: Waves,
  body_score: ShieldCheck,
  heart_rate_bpm: HeartPulse
};

function statusText(connected: boolean, lastEventAt: string | null) {
  if (connected && lastEventAt) return `Live, ${formatDateTime(lastEventAt)}`;
  if (connected) return "Live";
  return "Offline";
}

function metricByKey(metrics: MetricCatalogEntry[], key: string) {
  return metrics.find((metric) => metric.key === key) ?? metrics[0];
}

function App() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [selectedUser, setSelectedUser] = useState<string>("");
  const [selectedMetric, setSelectedMetric] = useState<string>("weight_kg");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [socketConnected, setSocketConnected] = useState(false);
  const [lastEventAt, setLastEventAt] = useState<string | null>(null);

  async function load(signal?: AbortSignal) {
    const response = await fetchHealthData(signal);
    setData(response.data);
    setSelectedUser((current) => current || response.data.users[0]?.name || "");
    setSelectedMetric((current) =>
      response.data.metrics.some((metric) => metric.key === current)
        ? current
        : response.data.metrics[0]?.key || "weight_kg"
    );
  }

  useEffect(() => {
    const controller = new AbortController();
    setIsLoading(true);
    load(controller.signal)
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : String(loadError)))
      .finally(() => setIsLoading(false));
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
        if (event.type === "health-data-updated") {
          setLastEventAt(event.updatedAt ?? new Date().toISOString());
          load().catch((loadError) =>
            setError(loadError instanceof Error ? loadError.message : String(loadError))
          );
        }
        if (event.type === "health-data-error") {
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
    const keys = new Set(QUICK_METRICS);
    return data.metrics.filter((metric) => keys.has(metric.key));
  }, [data]);

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

  if (!data || !selectedMetricInfo) return null;

  const latestValue = latestMetricValue(metricRecords, selectedMetric);
  const totalChange = changeBetweenEdges(metricRecords, selectedMetric);
  const metricUnit = selectedMetricInfo.unit;

  return (
    <main className="app">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">
            <HeartPulse size={24} />
          </div>
          <div>
            <h1>Health Dashboard</h1>
            <span>{data.source.deviceName ?? "Xiaomi Body Scale"}</span>
          </div>
        </div>

        <div className="status-strip">
          <div className={socketConnected ? "live-dot online" : "live-dot"} />
          <span>{statusText(socketConnected, lastEventAt)}</span>
          <button className="icon-button" type="button" onClick={() => load()}>
            <RefreshCw size={18} />
          </button>
        </div>
      </header>

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
                {metric.label} {metric.unit ? `, ${metric.unit}` : ""}
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
          const change = changeBetweenEdges(records, metric.key);
          const isActive = selectedMetric === metric.key;
          return (
            <button
              className={`metric-tile ${isActive ? "active" : ""}`}
              key={metric.key}
              type="button"
              onClick={() => setSelectedMetric(metric.key)}
            >
              <Icon size={20} />
              <span className="tile-label">{metric.label}</span>
              <strong>
                {formatNumber(value, 1)} {metric.unit}
              </strong>
              <small>{formatSigned(change, 2)}</small>
            </button>
          );
        })}
      </section>

      <section className="main-grid">
        <article className="panel chart-panel">
          <div className="panel-heading">
            <div>
              <h2>{selectedMetricInfo.label}</h2>
              <span>
                {metricRecords.length} измерений · {formatDateShort(selectedStats?.firstMeasuredAt)} -{" "}
                {formatDateShort(selectedStats?.lastMeasuredAt)}
              </span>
            </div>
            <div className="headline-value">
              <strong>
                {formatNumber(latestValue, 2)} {metricUnit}
              </strong>
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

        <aside className="panel analysis-panel">
          <div className="panel-heading compact">
            <div>
              <h2>Качество</h2>
              <span>{selectedUser}</span>
            </div>
            <div className="score-ring" style={{ "--score": selectedStats?.reliabilityScore ?? 0 } as React.CSSProperties}>
              <strong>{selectedStats?.reliabilityScore ?? 0}</strong>
            </div>
          </div>

          <div className="quality-badge">
            <ShieldCheck size={18} />
            <span>{selectedStats?.reliabilityLabel ?? "—"}</span>
          </div>

          <dl className="stats-list">
            <div>
              <dt>Среднее</dt>
              <dd>
                {formatNumber(selectedStats?.mean, 2)} {metricUnit}
              </dd>
            </div>
            <div>
              <dt>Медиана</dt>
              <dd>
                {formatNumber(selectedStats?.median, 2)} {metricUnit}
              </dd>
            </div>
            <div>
              <dt>SD</dt>
              <dd>{formatNumber(selectedStats?.sd, 3)}</dd>
            </div>
            <div>
              <dt>CI среднего</dt>
              <dd>±{formatNumber(selectedStats?.meanCi95, 3)}</dd>
            </div>
            <div>
              <dt>Тренд/день</dt>
              <dd>
                {formatSigned(selectedStats?.slopePerDay, 4)} {metricUnit}
              </dd>
            </div>
            <div>
              <dt>R²</dt>
              <dd>{formatNumber(selectedStats?.r2, 3)}</dd>
            </div>
            <div>
              <dt>Выбросы</dt>
              <dd>{selectedStats?.outlierCount ?? 0}</dd>
            </div>
            <div>
              <dt>Статус ≠ 0</dt>
              <dd>{selectedStats?.nonZeroStatusCount ?? 0}</dd>
            </div>
            <div>
              <dt>Шаг данных</dt>
              <dd>{formatNumber(selectedStats?.precision, 4)}</dd>
            </div>
            <div>
              <dt>Интервал</dt>
              <dd>{formatNumber(selectedStats?.cadenceDays, 1)} д</dd>
            </div>
          </dl>
        </aside>
      </section>
    </main>
  );
}

export default App;
