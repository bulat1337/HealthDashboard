type WeekPoint = { date: string; value: number | null };

const weekday = new Intl.DateTimeFormat("ru-RU", { weekday: "narrow", timeZone: "UTC" });

export function FitbitMetricWeek({ points, label, formatValue }: {
  points: WeekPoint[];
  label: string;
  formatValue: (value: number) => string;
}) {
  const week = points.map((point) => ({
    ...point,
    value: point.value !== null && Number.isFinite(point.value) ? point.value : null,
  }));
  const present = week.flatMap((point) => point.value === null ? [] : [point.value]);
  if (!present.length) return null;

  const min = Math.min(...present), max = Math.max(...present);
  const padding = Math.max((max - min) * .15, max * .05, 1);
  const lower = Math.max(0, min - padding), upper = max + padding;
  const x = (index: number) => 14 + index * 28;
  const y = (value: number) => 49 - (value - lower) / (upper - lower) * 42;

  return <span className="fitbit-metric-week">
    <svg viewBox="0 0 196 58" role="img" aria-label={`${label}: динамика за 7 дней`}>
      <line x1="14" x2="182" y1="49" y2="49" stroke="var(--line)" strokeDasharray="2 4" />
      {week.map((point, index) => {
        if (point.value === null) return null;
        const previous = week[index - 1];
        const selected = index === week.length - 1;
        return <g key={point.date}>
          {previous?.value != null && <line x1={x(index - 1)} x2={x(index)} y1={y(previous.value)} y2={y(point.value)} stroke="var(--primary-2)" strokeWidth="2" />}
          <circle cx={x(index)} cy={y(point.value)} r={selected ? 4 : 3} fill={selected ? "var(--primary)" : "var(--primary-2)"}>
            <title>{point.date}: {formatValue(point.value)}</title>
          </circle>
        </g>;
      })}
    </svg>
    <span className="fitbit-metric-week-labels" aria-hidden="true">
      {week.map((point, index) => <span className={index === week.length - 1 ? "selected" : ""} key={point.date}>
        {weekday.format(new Date(`${point.date}T12:00:00Z`))}
      </span>)}
    </span>
  </span>;
}
