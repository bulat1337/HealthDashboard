import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent } from "react";
import { formatDateShort, formatNumber } from "../stats";
import { moneyChartRange } from "../money-chart-range";
import type { MoneyRecord } from "../types";
import { useChartSize } from "./useChartSize";

type MoneySeriesKey = "totalAmount" | "freeAmount" | "investmentAmount" | "reserveAmount" | "bulatSavings" | "dianaSavings" | "creditCardDebt";
type MoneySeries = { key: MoneySeriesKey; label: string; color: string; dash?: string };
type MoneyTrendChartProps = {
  records: MoneyRecord[];
  selectedRecordId?: number | null;
  onRecordSelect?: (record: MoneyRecord) => void;
};
const MARGIN = { top: 18, right: 22, bottom: 42, left: 72 };
const SCALES = [
  { months: 1, label: "1 мес" }, { months: 3, label: "3 мес" },
  { months: 6, label: "6 мес" }, { months: 12, label: "12 мес" },
  { months: null, label: "Всё время" },
];
const MONEY_SERIES: MoneySeries[] = [
  { key: "totalAmount", label: "Общая", color: "#1e40af" },
  { key: "freeAmount", label: "Общий бюджет", color: "#15803d" },
  { key: "investmentAmount", label: "Инвестиции", color: "#0f766e" },
  { key: "reserveAmount", label: "Несгораемая сумма", color: "#f59e0b" },
  { key: "bulatSavings", label: "Булат", color: "#b45309" },
  { key: "dianaSavings", label: "Диана", color: "#eab308" },
  { key: "creditCardDebt", label: "Долг", color: "#dc2626", dash: "6 5" },
];
function ticks(min: number, max: number, count: number) {
  if (min === max) return [min];
  return Array.from({ length: count }, (_, index) => min + (max - min) * index / Math.max(1, count - 1));
}
function moneyValue(record: MoneyRecord, key: MoneySeriesKey) {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function MoneyTrendChart({ records, selectedRecordId = null, onRecordSelect }: MoneyTrendChartProps) {
  const { containerRef, width, height, compact } = useChartSize();
  const helpId = useId();
  const scrollRef = useRef<HTMLDivElement>(null);
  const windowRef = useRef<{ start: number; atEnd: boolean } | null>(null);
  const pendingStart = useRef<number | null>(null);
  const previousSelection = useRef(selectedRecordId);
  const drag = useRef<{ pointerId: number; x: number; scrollLeft: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const [months, setMonths] = useState<number | null>(null);
  const [offset, setOffset] = useState(0);
  const [hover, setHover] = useState<MoneyRecord | null>(null);
  const chart = useMemo(() => {
    const drawableRecords = records.filter((record) => Number.isFinite(Date.parse(record.dateIso)) &&
      MONEY_SERIES.some((series) => moneyValue(record, series.key) !== null))
      .slice().sort((a, b) => Date.parse(a.dateIso) - Date.parse(b.dateIso) || a.rowId - b.rowId);
    if (!drawableRecords.length) return null;
    const range = moneyChartRange(Date.parse(drawableRecords[0].dateIso), Date.parse(drawableRecords.at(-1)!.dateIso), months);
    const plotWidth = Math.max(1, width - MARGIN.left - MARGIN.right - 8);
    const plotHeight = height - MARGIN.top - MARGIN.bottom;
    const canvasWidth = 8 + (range.maxTime - range.minTime) / range.span * plotWidth + MARGIN.right;
    const values = drawableRecords.flatMap((record) => MONEY_SERIES.map((series) => moneyValue(record, series.key)))
      .filter((value): value is number => value !== null);
    const min = Math.min(0, ...values), max = Math.max(...values);
    const padding = Math.max((max - min) * 0.08, 10000);
    const yMin = min < 0 ? min - padding : 0, yMax = max + padding;
    const x = (time: number) => 8 + (time - range.minTime) / range.span * plotWidth;
    const y = (value: number) => MARGIN.top + (1 - (value - yMin) / (yMax - yMin)) * plotHeight;
    const paths = MONEY_SERIES.map((series) => ({ ...series, path: drawableRecords
      .map((record) => {
        const value = moneyValue(record, series.key);
        return value === null ? null : { x: x(Date.parse(record.dateIso)), y: y(value) };
      }).filter((point): point is { x: number; y: number } => point !== null)
      .map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" ") }));
    return { ...range, drawableRecords, plotWidth, plotHeight, canvasWidth, x, y, paths,
      yTicks: ticks(yMin, yMax, 5),
      xTicks: ticks(range.minTime, range.maxTime, Math.max(2, Math.ceil((range.maxTime - range.minTime) / range.span * (compact ? 2 : 4)) + 1)),
    };
  }, [records, width, height, compact, months]);

  // The full SVG moves with native scroll, preserving trackpad/touch inertia.
  useLayoutEffect(() => {
    if (!chart || !scrollRef.current) return;
    const saved = windowRef.current;
    const start = Math.max(chart.minTime, Math.min(chart.maxStart,
      pendingStart.current ?? (!saved || saved.atEnd ? chart.maxStart : saved.start)));
    const nextOffset = (start - chart.minTime) / chart.span * chart.plotWidth;
    let frame: number | null = null;
    const position = (attempt = 0) => {
      if (!scrollRef.current) return;
      scrollRef.current.scrollLeft = nextOffset;
      const actualOffset = scrollRef.current.scrollLeft;
      setOffset(actualOffset);
      windowRef.current = { start, atEnd: Math.abs(start - chart.maxStart) < 1 };
      // WebKit may keep the previous SVG scroll extent until the next paint.
      // Allow two layout frames to apply a newly resized canvas.
      if (Math.abs(actualOffset - nextOffset) > 1 && attempt < 2)
        frame = requestAnimationFrame(() => position(attempt + 1));
    };
    position();
    pendingStart.current = null;
    setHover(null);
    return () => { if (frame !== null) cancelAnimationFrame(frame); };
  }, [chart]);

  useEffect(() => {
    if (!chart || !scrollRef.current || previousSelection.current === selectedRecordId) return;
    previousSelection.current = selectedRecordId;
    const selected = chart.drawableRecords.find((record) => record.rowId === selectedRecordId);
    if (!selected) return;
    const time = Date.parse(selected.dateIso), start = windowRef.current?.start ?? chart.maxStart;
    if (time < start || time > start + chart.span) {
      scrollRef.current.scrollLeft = (Math.max(chart.minTime, Math.min(chart.maxStart, time - chart.span / 2)) - chart.minTime) / chart.span * chart.plotWidth;
    }
  }, [chart, selectedRecordId]);

  if (!chart) return <div className="empty-chart"><span>Нет денежных данных</span></div>;
  // WebKit rounds native scroll offsets to whole pixels. Snap the two edges
  // so the latest snapshot and the interval dates remain included.
  const rawStart = chart.minTime + offset / chart.plotWidth * chart.span;
  const start = chart.maxStart - rawStart <= chart.span / chart.plotWidth
    ? chart.maxStart : Math.max(chart.minTime, rawStart);
  const end = start + chart.span;
  const visibleRecords = chart.drawableRecords.filter((record) => {
    const time = Date.parse(record.dateIso);
    return time >= start - 1 && time <= end + 1;
  });
  const interval = `${formatDateShort(new Date(start).toISOString())} – ${formatDateShort(new Date(end).toISOString())}`;
  const selected = chart.drawableRecords.find((record) => record.rowId === selectedRecordId);
  const hoverX = hover ? MARGIN.left + chart.x(Date.parse(hover.dateIso)) - offset : 0;
  function inspect(event: PointerEvent<SVGSVGElement>) {
    if (!chart) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const nearest = visibleRecords.reduce<MoneyRecord | null>((best, record) => !best ||
      Math.abs(chart.x(Date.parse(record.dateIso)) - x) < Math.abs(chart.x(Date.parse(best.dateIso)) - x) ? record : best, null);
    setHover(nearest);
  }
  function zoom(nextMonths: number | null) {
    if (!chart || nextMonths === months) return;
    const next = moneyChartRange(Date.parse(chart.drawableRecords[0].dateIso), Date.parse(chart.drawableRecords.at(-1)!.dateIso), nextMonths);
    const selectedTime = selected ? Date.parse(selected.dateIso) : null;
    const center = selectedTime !== null && selectedTime >= start && selectedTime <= end
      ? selectedTime : start + chart.span / 2;
    pendingStart.current = Math.max(next.minTime, Math.min(next.maxStart, center - next.span / 2));
    setMonths(nextMonths);
  }
  return <>
    <div className="segmented fitbit-range money-chart-scales" role="group" aria-label="Масштаб денежного графика">
      {SCALES.map((scale) => <button type="button" key={scale.months ?? "all"} className={months === scale.months ? "active" : ""}
        aria-pressed={months === scale.months} onClick={() => zoom(scale.months)}>{scale.label}</button>)}
    </div>
    <p className="money-chart-interval">{interval}</p>
    <div className="chart-shell money-chart-shell" ref={containerRef}>
      <svg className="money-chart-axis" viewBox={`0 0 ${MARGIN.left} ${height}`} style={{ width: MARGIN.left, height }} aria-hidden="true">
        {chart.yTicks.map((tick) => <text key={tick} x={MARGIN.left - 8} y={chart.y(tick) + 4} textAnchor="end" className="axis-label">
          {compact ? new Intl.NumberFormat("ru-RU", { notation: "compact", maximumFractionDigits: 1 }).format(tick) : formatNumber(tick, 0)}
        </text>)}
      </svg>
      <div className={`money-chart-scroll${chart.maxStart > chart.minTime ? " pannable" : ""}`} ref={scrollRef} tabIndex={0}
        role="group" aria-label="Прокрутка денежного графика" aria-describedby={helpId}
        onScroll={(event) => {
          const nextOffset = event.currentTarget.scrollLeft;
          windowRef.current = { start: chart.minTime + nextOffset / chart.plotWidth * chart.span,
            atEnd: event.currentTarget.scrollWidth - event.currentTarget.clientWidth - nextOffset <= 1 };
          setOffset(nextOffset);
          setHover(null);
        }}
        onBlur={() => setHover(null)}
        onKeyDown={(event) => {
          if (event.key === "Escape") { setHover(null); return; }
          if ((event.key === "Enter" || event.key === " ") && hover) { event.preventDefault(); onRecordSelect?.(hover); return; }
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          if (event.shiftKey && event.key.startsWith("Arrow")) {
            if (scrollRef.current) scrollRef.current.scrollLeft += (event.key === "ArrowLeft" ? -1 : 1) * chart.plotWidth / 2;
            return;
          }
          const index = visibleRecords.findIndex((record) => record.rowId === (hover?.rowId ?? selectedRecordId));
          const next = event.key === "Home" ? 0 : event.key === "End" ? visibleRecords.length - 1
            : index < 0 ? event.key === "ArrowLeft" ? visibleRecords.length - 1 : 0
            : Math.max(0, Math.min(visibleRecords.length - 1, index + (event.key === "ArrowLeft" ? -1 : 1)));
          setHover(visibleRecords[next] ?? null);
        }}>
        <svg viewBox={`0 0 ${chart.canvasWidth} ${height}`} style={{ width: chart.canvasWidth, height }} className="money-trend-chart"
          role="img" aria-label={`Деньги: ${chart.drawableRecords.length} срезов. Интервал ${interval}`}
          onPointerDown={(event) => {
            if (event.button !== 0 || !event.isPrimary) return;
            suppressClick.current = false;
            inspect(event);
            if (event.pointerType === "mouse" && scrollRef.current && chart.maxStart > chart.minTime)
              drag.current = { pointerId: event.pointerId, x: event.clientX, scrollLeft: scrollRef.current.scrollLeft, moved: false };
          }}
          onPointerMove={(event) => {
            const gesture = drag.current;
            if (gesture?.pointerId === event.pointerId) {
              const delta = event.clientX - gesture.x;
              if (Math.abs(delta) > 6) {
                gesture.moved = true;
                suppressClick.current = true;
                event.currentTarget.setPointerCapture(event.pointerId);
              }
              if (gesture.moved && scrollRef.current) { scrollRef.current.scrollLeft = gesture.scrollLeft - delta; setHover(null); }
            } else if (event.pointerType === "mouse") inspect(event);
          }}
          onPointerUp={(event) => {
            if (!drag.current?.moved) inspect(event);
            drag.current = null;
            if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onPointerCancel={() => { drag.current = null; setHover(null); }}
          onPointerLeave={(event) => { if (event.pointerType === "mouse" && !drag.current) setHover(null); }}
          onClickCapture={(event) => { if (suppressClick.current) { event.preventDefault(); event.stopPropagation(); suppressClick.current = false; } }}>
          {chart.yTicks.map((tick) => <line key={tick} x1={0} x2={chart.canvasWidth} y1={chart.y(tick)} y2={chart.y(tick)} stroke="#dbe6f3" strokeDasharray="4 5" />)}
          {chart.xTicks.map((tick, index) => <text key={tick} x={chart.x(tick)} y={height - 14}
            textAnchor={index === 0 ? "start" : index === chart.xTicks.length - 1 ? "end" : "middle"} className="axis-label">
            {formatDateShort(new Date(tick).toISOString())}
          </text>)}
          {chart.paths.map((series) => <path key={series.key} d={series.path} fill="none" stroke={series.color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" strokeDasharray={series.dash} />)}
          {selected && <line x1={chart.x(Date.parse(selected.dateIso))} x2={chart.x(Date.parse(selected.dateIso))} y1={MARGIN.top} y2={height - MARGIN.bottom} stroke="#1e40af" strokeDasharray="5 5" strokeWidth="1.5" />}
          {chart.drawableRecords.map((record) => MONEY_SERIES.map((series) => {
            const value = moneyValue(record, series.key);
            if (value === null) return null;
            const isSelected = record.rowId === selectedRecordId;
            return <circle key={`${record.rowId}-${series.key}`} className={`money-chart-point${isSelected ? " selected" : ""}`}
              cx={chart.x(Date.parse(record.dateIso))} cy={chart.y(value)} r={isSelected ? 5.2 : 3.6} fill="#fff" stroke={series.color} strokeWidth={isSelected ? 3 : 2}
              role={onRecordSelect ? "button" : undefined} tabIndex={-1} aria-label={`Перейти к срезу ${formatDateShort(record.dateIso)}, ${series.label}`}
              onClick={() => onRecordSelect?.(record)} onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); onRecordSelect?.(record); }
              }} />;
          }))}
          {hover && <line x1={chart.x(Date.parse(hover.dateIso))} x2={chart.x(Date.parse(hover.dateIso))} y1={MARGIN.top} y2={height - MARGIN.bottom} stroke="#b9c1c8" strokeDasharray="3 4" pointerEvents="none" />}
        </svg>
      </div>
      {!visibleRecords.length && <span className="money-chart-window-empty">Нет срезов в этом интервале</span>}
      {hover && <div className="chart-tooltip money-tooltip" style={{ left: Math.max(110, Math.min(width - 110, hoverX)), top: 12 }}>
        <strong>{formatDateShort(hover.dateIso)}</strong>
        {MONEY_SERIES.filter((series) => moneyValue(hover, series.key) !== null).map((series) => <span key={series.key}>
          <i style={{ background: series.color }} /> {series.label}: {formatNumber(moneyValue(hover, series.key), 0)} ₽
        </span>)}
      </div>}
      <span className="sr-only" id={helpId}>Прокручивайте увеличенный график трекпадом, свайпом или перетаскиванием мышью. Стрелки, Home и End выбирают срез. Enter открывает срез. Shift со стрелками перемещает интервал.</span>
      <span className="sr-only" role="status">{hover ? `Срез ${formatDateShort(hover.dateIso)}, общая сумма ${formatNumber(hover.totalAmount, 0)} ₽` : ""}</span>
    </div>
  </>;
}
export { MONEY_SERIES };
