import { useMemo, useRef, useState } from "react";
import { formatDateShort, formatNumber } from "../stats";
import type { MoneyRecord } from "../types";

type MoneySeriesKey = "totalAmount" | "freeAmount" | "investmentAmount" | "reserveAmount" | "creditCardDebt";

type MoneySeries = {
  key: MoneySeriesKey;
  label: string;
  color: string;
  dash?: string;
};

type HoverState = {
  record: MoneyRecord;
  x: number;
};

const WIDTH = 920;
const HEIGHT = 420;
const MARGIN = { top: 18, right: 22, bottom: 42, left: 72 };

const MONEY_SERIES: MoneySeries[] = [
  { key: "totalAmount", label: "Общая", color: "#1e40af" },
  { key: "freeAmount", label: "Свободная", color: "#15803d" },
  { key: "investmentAmount", label: "Инвестиции", color: "#0f766e" },
  { key: "reserveAmount", label: "Несгораемая", color: "#f59e0b" },
  { key: "creditCardDebt", label: "Долг", color: "#dc2626", dash: "6 5" }
];

function pathFromPoints(points: { x: number; y: number }[]) {
  if (points.length === 0) return "";
  return points
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(2)},${point.y.toFixed(2)}`)
    .join(" ");
}

function ticks(min: number, max: number, count: number) {
  if (min === max) return [min];
  const step = (max - min) / Math.max(1, count - 1);
  return Array.from({ length: count }, (_, index) => min + step * index);
}

function moneyValue(record: MoneyRecord, key: MoneySeriesKey) {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function MoneyTrendChart({ records }: { records: MoneyRecord[] }) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [hover, setHover] = useState<HoverState | null>(null);

  const chart = useMemo(() => {
    const drawableRecords = records.filter((record) =>
      MONEY_SERIES.some((series) => moneyValue(record, series.key) !== null)
    );
    if (drawableRecords.length === 0) return null;

    const plotWidth = WIDTH - MARGIN.left - MARGIN.right;
    const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
    const times = drawableRecords.map((record) => Date.parse(record.dateIso));
    const minTime = Math.min(...times);
    const maxTime = Math.max(...times);
    const timePadding = minTime === maxTime ? 86400000 : 0;
    const values = drawableRecords.flatMap((record) =>
      MONEY_SERIES.map((series) => moneyValue(record, series.key)).filter(
        (value): value is number => value !== null
      )
    );
    const minValue = Math.min(0, ...values);
    const maxValue = Math.max(...values);
    const yPadding = Math.max((maxValue - minValue) * 0.08, 10000);
    const yMin = minValue < 0 ? minValue - yPadding : 0;
    const yMax = maxValue + yPadding;
    const xScale = (time: number) =>
      MARGIN.left +
      ((time - (minTime - timePadding)) / (maxTime + timePadding - (minTime - timePadding))) *
        plotWidth;
    const yScale = (value: number) =>
      MARGIN.top + (1 - (value - yMin) / (yMax - yMin)) * plotHeight;
    const paths = MONEY_SERIES.map((series) => ({
      ...series,
      path: pathFromPoints(
        drawableRecords
          .map((record) => {
            const value = moneyValue(record, series.key);
            if (value === null) return null;
            return { x: xScale(Date.parse(record.dateIso)), y: yScale(value) };
          })
          .filter((point): point is { x: number; y: number } => point !== null)
      )
    }));

    return {
      drawableRecords,
      plotWidth,
      plotHeight,
      xScale,
      yScale,
      yTicks: ticks(yMin, yMax, 5),
      xTicks: ticks(minTime, maxTime, Math.min(5, Math.max(2, drawableRecords.length))),
      paths
    };
  }, [records]);

  if (!chart) {
    return (
      <div className="empty-chart">
        <span>Нет денежных данных</span>
      </div>
    );
  }

  function handleMove(event: React.MouseEvent<SVGSVGElement>) {
    if (!svgRef.current || !chart) return;
    const rect = svgRef.current.getBoundingClientRect();
    const ratioX = WIDTH / rect.width;
    const x = (event.clientX - rect.left) * ratioX;
    const nearest = chart.drawableRecords.reduce(
      (best, record) => {
        const pointX = chart.xScale(Date.parse(record.dateIso));
        const distance = Math.abs(pointX - x);
        return distance < best.distance ? { record, distance } : best;
      },
      { record: chart.drawableRecords[0], distance: Number.POSITIVE_INFINITY }
    ).record;

    setHover({
      record: nearest,
      x: chart.xScale(Date.parse(nearest.dateIso))
    });
  }

  return (
    <div className="chart-shell money-chart-shell">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="money-trend-chart"
        role="img"
        aria-label={`Деньги: ${chart.drawableRecords.length} срезов`}
        onMouseMove={handleMove}
        onMouseLeave={() => setHover(null)}
      >
        <rect
          x={MARGIN.left}
          y={MARGIN.top}
          width={chart.plotWidth}
          height={chart.plotHeight}
          fill="#fbfdff"
          rx="6"
        />

        {chart.yTicks.map((tick) => (
          <g key={`money-y-${tick}`}>
            <line
              x1={MARGIN.left}
              x2={WIDTH - MARGIN.right}
              y1={chart.yScale(tick)}
              y2={chart.yScale(tick)}
              stroke="#dbe6f3"
              strokeDasharray="4 5"
            />
            <text x={MARGIN.left - 10} y={chart.yScale(tick) + 4} textAnchor="end" className="axis-label">
              {formatNumber(tick, 0)}
            </text>
          </g>
        ))}

        {chart.xTicks.map((tick) => (
          <text
            key={`money-x-${tick}`}
            x={chart.xScale(tick)}
            y={HEIGHT - 14}
            textAnchor="middle"
            className="axis-label"
          >
            {formatDateShort(new Date(tick).toISOString())}
          </text>
        ))}

        {chart.paths.map((series) => (
          <path
            key={series.key}
            d={series.path}
            fill="none"
            stroke={series.color}
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={series.dash}
          />
        ))}

        {chart.drawableRecords.map((record) =>
          MONEY_SERIES.map((series) => {
            const value = moneyValue(record, series.key);
            if (value === null) return null;
            return (
              <circle
                key={`${record.rowId}-${series.key}`}
                cx={chart.xScale(Date.parse(record.dateIso))}
                cy={chart.yScale(value)}
                r="3.6"
                fill="#ffffff"
                stroke={series.color}
                strokeWidth="2"
              />
            );
          })
        )}

        {hover && (
          <line
            x1={hover.x}
            x2={hover.x}
            y1={MARGIN.top}
            y2={HEIGHT - MARGIN.bottom}
            stroke="#b9c1c8"
            strokeDasharray="3 4"
          />
        )}
      </svg>

      {hover && (
        <div
          className="chart-tooltip money-tooltip"
          style={{
            left: `${Math.min(78, Math.max(14, (hover.x / WIDTH) * 100))}%`,
            top: "20%"
          }}
        >
          <strong>{formatDateShort(hover.record.dateIso)}</strong>
          {MONEY_SERIES.map((series) => (
            <span key={series.key}>
              <i style={{ background: series.color }} /> {series.label}:{" "}
              {formatNumber(moneyValue(hover.record, series.key), 0)} ₽
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export { MONEY_SERIES };
