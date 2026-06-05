import { useMemo, useRef, useState } from "react";
import type { ChartPoint } from "../stats";
import { formatDateTime, formatNumber } from "../stats";
import type { MetricCatalogEntry, MetricStats } from "../types";

type HealthChartProps = {
  points: ChartPoint[];
  metric: MetricCatalogEntry;
  stats: MetricStats | undefined;
};

type HoverState = {
  point: ChartPoint;
  x: number;
  y: number;
};

const WIDTH = 920;
const HEIGHT = 420;
const MARGIN = { top: 18, right: 20, bottom: 42, left: 58 };

function pathFromPoints(points: { x: number; y: number }[]) {
  if (points.length === 0) return "";
  return points
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(2)},${point.y.toFixed(2)}`)
    .join(" ");
}

function areaPath(
  upper: { x: number; y: number }[],
  lower: { x: number; y: number }[]
) {
  if (upper.length === 0 || lower.length === 0) return "";
  const first = upper[0];
  const top = upper
    .map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(2)},${point.y.toFixed(2)}`)
    .join(" ");
  const bottom = [...lower]
    .reverse()
    .map((point) => `L${point.x.toFixed(2)},${point.y.toFixed(2)}`)
    .join(" ");
  return `${top} ${bottom} L${first.x.toFixed(2)},${first.y.toFixed(2)} Z`;
}

function ticks(min: number, max: number, count: number) {
  if (min === max) return [min];
  const step = (max - min) / Math.max(1, count - 1);
  return Array.from({ length: count }, (_, index) => min + step * index);
}

export function HealthChart({ points, metric, stats }: HealthChartProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [hover, setHover] = useState<HoverState | null>(null);

  const chart = useMemo(() => {
    if (points.length === 0) return null;
    const plotWidth = WIDTH - MARGIN.left - MARGIN.right;
    const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
    const minTime = Math.min(...points.map((point) => point.time));
    const maxTime = Math.max(...points.map((point) => point.time));
    const timePadding = minTime === maxTime ? 86400000 : 0;
    const yValues = points.flatMap((point) => [point.value, point.ciLow, point.ciHigh]);
    const minValue = Math.min(...yValues);
    const maxValue = Math.max(...yValues);
    const yPadding = Math.max((maxValue - minValue) * 0.12, stats?.precision ?? 0.1);
    const yMin = minValue - yPadding;
    const yMax = maxValue + yPadding;
    const xScale = (time: number) =>
      MARGIN.left +
      ((time - (minTime - timePadding)) / (maxTime + timePadding - (minTime - timePadding))) *
        plotWidth;
    const yScale = (value: number) =>
      MARGIN.top + (1 - (value - yMin) / (yMax - yMin)) * plotHeight;

    const rawPath = pathFromPoints(points.map((point) => ({ x: xScale(point.time), y: yScale(point.value) })));
    const smoothPath = pathFromPoints(
      points.map((point) => ({ x: xScale(point.time), y: yScale(point.smoothed) }))
    );
    const bandPath = areaPath(
      points.map((point) => ({ x: xScale(point.time), y: yScale(point.ciHigh) })),
      points.map((point) => ({ x: xScale(point.time), y: yScale(point.ciLow) }))
    );
    const yTicks = ticks(yMin, yMax, 5);
    const xTicks = ticks(minTime, maxTime, Math.min(5, Math.max(2, points.length)));

    return {
      plotWidth,
      plotHeight,
      xScale,
      yScale,
      rawPath,
      smoothPath,
      bandPath,
      yTicks,
      xTicks
    };
  }, [points, stats?.precision]);

  if (!chart) {
    return (
      <div className="empty-chart">
        <span>Нет данных</span>
      </div>
    );
  }

  function handleMove(event: React.MouseEvent<SVGSVGElement>) {
    if (!svgRef.current || points.length === 0 || !chart) return;
    const rect = svgRef.current.getBoundingClientRect();
    const ratioX = WIDTH / rect.width;
    const x = (event.clientX - rect.left) * ratioX;
    const nearest = points.reduce(
      (best, point) => {
        const pointX = chart.xScale(point.time);
        const distance = Math.abs(pointX - x);
        return distance < best.distance ? { point, distance } : best;
      },
      { point: points[0], distance: Number.POSITIVE_INFINITY }
    ).point;
    setHover({
      point: nearest,
      x: chart.xScale(nearest.time),
      y: chart.yScale(nearest.value)
    });
  }

  return (
    <div className="chart-shell">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="health-chart"
        role="img"
        aria-label={`${metric.label}: ${points.length} измерений`}
        onMouseMove={handleMove}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id="bandFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.24" />
            <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.06" />
          </linearGradient>
        </defs>

        <rect
          x={MARGIN.left}
          y={MARGIN.top}
          width={chart.plotWidth}
          height={chart.plotHeight}
          fill="#fbfdff"
          rx="6"
        />

        {chart.yTicks.map((tick) => (
          <g key={`y-${tick}`}>
            <line
              x1={MARGIN.left}
              x2={WIDTH - MARGIN.right}
              y1={chart.yScale(tick)}
              y2={chart.yScale(tick)}
              stroke="#dbe6f3"
              strokeDasharray="4 5"
            />
            <text x={MARGIN.left - 10} y={chart.yScale(tick) + 4} textAnchor="end" className="axis-label">
              {formatNumber(tick, 1)}
            </text>
          </g>
        ))}

        {chart.xTicks.map((tick) => (
          <text
            key={`x-${tick}`}
            x={chart.xScale(tick)}
            y={HEIGHT - 14}
            textAnchor="middle"
            className="axis-label"
          >
            {new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short" }).format(new Date(tick))}
          </text>
        ))}

        <path d={chart.bandPath} fill="url(#bandFill)" />
        <path d={chart.rawPath} fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeDasharray="5 5" />
        <path d={chart.smoothPath} fill="none" stroke="#1e40af" strokeWidth="3" strokeLinecap="round" />

        {points.map((point) => (
          <circle
            key={point.rowId}
            cx={chart.xScale(point.time)}
            cy={chart.yScale(point.value)}
            r={point.isOutlier ? 5.5 : 4.2}
            fill={point.isOutlier ? "#dc2626" : "#ffffff"}
            stroke={point.isOutlier ? "#dc2626" : "#1e40af"}
            strokeWidth="2"
          />
        ))}

        {hover && (
          <g>
            <line
              x1={hover.x}
              x2={hover.x}
              y1={MARGIN.top}
              y2={HEIGHT - MARGIN.bottom}
              stroke="#b9c1c8"
              strokeDasharray="3 4"
            />
            <circle cx={hover.x} cy={hover.y} r="7" fill="#1e40af" opacity="0.16" />
          </g>
        )}
      </svg>

      {hover && (
        <div
          className="chart-tooltip"
          style={{
            left: `${Math.min(78, Math.max(12, (hover.x / WIDTH) * 100))}%`,
            top: `${Math.min(70, Math.max(12, (hover.y / HEIGHT) * 100))}%`
          }}
        >
          <strong>
            {formatNumber(hover.point.value, 2)} {metric.unit}
          </strong>
          <span>{formatDateTime(hover.point.measuredAt)}</span>
          <span>CI: ±{formatNumber(hover.point.error, 2)}</span>
          {hover.point.isOutlier && <em>выброс</em>}
        </div>
      )}
    </div>
  );
}
