import { HeartPulse } from "lucide-react";
import { useId, useLayoutEffect, useRef, useState } from "react";
import type { PointerEvent } from "react";
import type { FitbitDay, FitbitHeartRateZone } from "../fitbit-types";
import { useChartSize } from "./useChartSize";

const ZONES: Record<FitbitHeartRateZone["type"], { label: string; color: string }> = {
  LIGHT: { label: "Лёгкая", color: "#0785a3" },
  MODERATE: { label: "Умеренная", color: "#25864e" },
  VIGOROUS: { label: "Высокая", color: "#b87910" },
  PEAK: { label: "Пиковая", color: "#c14e61" },
};
const clock = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(Math.floor(minute % 60)).padStart(2, "0")}`;
const SCALES = [
  { minutes: 1440, label: "1 день" }, { minutes: 720, label: "12 часов" },
  { minutes: 360, label: "6 часов" }, { minutes: 180, label: "3 часа" }, { minutes: 60, label: "1 час" },
];

export function FitbitHeartRateChart({ day }: { day: FitbitDay | undefined }) {
  const { containerRef, width, compact } = useChartSize();
  const clipId = useId();
  const [selection, setSelection] = useState<number | null>(null);
  const [span, setSpan] = useState(1440);
  const [start, setStart] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const startRef = useRef(0);
  const drag = useRef<{ pointerId: number; x: number; scrollLeft: number; moved: boolean } | null>(null);
  const points = day?.heartRate ?? [], zones = day?.heartRateZones ?? [];
  const end = start + span;
  const selected = selection == null ? undefined : points[selection];
  const visibleSelection = selected && selected.minute >= start && selected.minute <= end ? selected : undefined;
  const visiblePoints = points.filter((point) => point.minute >= start && point.minute <= end);
  const min = points.reduce((value, point) => Math.min(value, point.min), Infinity);
  const max = points.reduce((value, point) => Math.max(value, point.max), 0);
  const lower = Math.max(0, Math.floor(Math.min(min, ...zones.map((zone) => zone.min)) / 10) * 10 - 10);
  const upper = Math.ceil(Math.max(max, ...zones.map((zone) => zone.min)) / 10) * 10 + 15;
  const top = 14, bottom = 220, left = 10, right = width - 40, plotWidth = right - left;
  const canvasWidth = left + plotWidth * 1440 / span;
  const viewportOffset = start / span * plotWidth;
  const hasPoints = points.length > 0;
  // Move the complete SVG with native scrolling so touch/trackpad inertia does
  // not depend on React drawing a new window for every scroll frame.
  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollLeft = startRef.current / span * plotWidth;
  }, [span, plotWidth, hasPoints]);
  const x = (minute: number) => left + minute / span * plotWidth;
  const y = (bpm: number) => bottom - (bpm - lower) / (upper - lower) * (bottom - top);
  const path = points.map((point, index) => {
    const previous = points[index - 1];
    const connected = previous && Date.parse(point.time) - Date.parse(previous.time) <= 10 * 60_000 && point.minute > previous.minute;
    return `${connected ? "L" : "M"}${x(point.minute).toFixed(2)},${y(point.bpm).toFixed(2)}`;
  }).join(" ");
  const ticks = zones.length ? zones.map((zone) => ({ value: zone.min, color: ZONES[zone.type].color })) : [lower + 10, Math.round((lower + upper) / 20) * 10, upper - 15].map((value) => ({ value, color: "#8492a6" }));
  const clampStart = (minute: number, duration = span) => Math.max(0, Math.min(1440 - duration, minute));
  function pan(minutes: number) {
    if (scrollRef.current) scrollRef.current.scrollLeft += minutes / span * plotWidth;
    setSelection(null);
  }
  function zoom(minutes: number) {
    if (minutes === span) return;
    const center = visibleSelection?.minute ?? (span === 1440 ? points.at(-1)?.minute ?? 720 : start + span / 2);
    startRef.current = clampStart(center - minutes / 2, minutes);
    setStart(startRef.current);
    setSpan(minutes);
    setSelection(null);
  }
  function inspect(event: PointerEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const minute = ((event.clientX - rect.left) * canvasWidth / rect.width - left) / plotWidth * span;
    const nearest = visiblePoints.reduce<typeof points[number] | undefined>((result, point) =>
      !result || Math.abs(point.minute - minute) < Math.abs(result.minute - minute) ? point : result, undefined);
    setSelection(nearest ? points.indexOf(nearest) : null);
  }
  const tickStep = span === 1440 ? compact ? 360 : 240 : span === 720 ? compact ? 180 : 120
    : span === 360 ? compact ? 120 : 60 : span === 180 ? compact ? 60 : 30 : compact ? 30 : 15;
  const timeTicks = Array.from({ length: 1440 / tickStep + 1 }, (_, index) => index * tickStep);
  const interval = `${clock(start)}–${clock(end)}`;
  return <article className="panel fitbit-heart-panel">
    <div className="panel-heading"><h3>Пульс в течение дня</h3><HeartPulse size={20} /></div>
    {points.length ? <>
      <div className="fitbit-heart-summary"><strong>{min}–{max}<span> уд/мин</span></strong>
        <span>{day?.restingHeartRate != null ? `В покое · ${day.restingHeartRate} уд/мин` : "Диапазон за выбранный день"}</span></div>
      <div className="segmented fitbit-range fitbit-heart-scales" role="group" aria-label="Масштаб графика пульса">
        {SCALES.map(({ minutes, label }) => <button type="button" key={minutes} className={span === minutes ? "active" : ""}
          aria-pressed={span === minutes} onClick={() => zoom(minutes)}>{label}</button>)}
      </div>
      {span < 1440 && <p className="fitbit-heart-interval">{interval}</p>}
      <div className="fitbit-heart-chart" ref={containerRef}>
        <div ref={scrollRef} className={`fitbit-heart-scroll ${span < 1440 ? "pannable" : ""}`} tabIndex={0}
          role="group" aria-label="Прокрутка графика пульса" aria-describedby={`${clipId}-help`}
          onScroll={(event) => {
            startRef.current = clampStart(event.currentTarget.scrollLeft / plotWidth * span);
            setStart(startRef.current);
            setSelection(null);
          }}
          onBlur={() => setSelection(null)}
          onKeyDown={(event) => {
            if (event.key === "Escape") { setSelection(null); return; }
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
            event.preventDefault();
            if (event.shiftKey && event.key.startsWith("Arrow")) { pan(event.key === "ArrowLeft" ? -span / 2 : span / 2); return; }
            const index = visibleSelection ? visiblePoints.indexOf(visibleSelection) : -1;
            const next = event.key === "Home" ? 0 : event.key === "End" ? visiblePoints.length - 1
              : index < 0 ? event.key === "ArrowLeft" ? visiblePoints.length - 1 : 0
              : Math.max(0, Math.min(visiblePoints.length - 1, index + (event.key === "ArrowLeft" ? -1 : 1)));
            setSelection(visiblePoints[next] ? points.indexOf(visiblePoints[next]) : null);
          }}>
        <svg viewBox={`0 0 ${canvasWidth} 254`} style={{ width: canvasWidth, height: 254 }} role="img"
          aria-label={`Пульс за день: от ${min} до ${max} ударов в минуту. Интервал ${interval}`}
          onPointerDown={(event) => {
            if (event.button !== 0 || !event.isPrimary) return;
            inspect(event);
            if (span < 1440 && event.pointerType === "mouse" && scrollRef.current) {
              drag.current = { pointerId: event.pointerId, x: event.clientX, scrollLeft: scrollRef.current.scrollLeft, moved: false };
              event.currentTarget.setPointerCapture(event.pointerId);
            }
          }}
          onPointerMove={(event) => {
            const gesture = drag.current;
            if (gesture && gesture.pointerId === event.pointerId) {
              const delta = event.clientX - gesture.x;
              if (Math.abs(delta) > 6) gesture.moved = true;
              if (gesture.moved && scrollRef.current) {
                scrollRef.current.scrollLeft = gesture.scrollLeft - delta;
                setSelection(null);
              }
            } else if (event.pointerType === "mouse") inspect(event);
          }}
          onPointerUp={(event) => {
            if (!drag.current) { if (event.pointerType !== "mouse") inspect(event); return; }
            if (drag.current.pointerId !== event.pointerId) return;
            if (!drag.current.moved) inspect(event);
            drag.current = null;
            event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onPointerCancel={() => { drag.current = null; setSelection(null); }} onLostPointerCapture={() => { drag.current = null; }}
          onPointerLeave={(event) => { if (!drag.current && event.pointerType === "mouse") setSelection(null); }}
          >
          <defs><clipPath id={`${clipId}-plot`}><rect x={left} y={top} width={canvasWidth - left} height={bottom - top} /></clipPath>
            {zones.map((zone) => <clipPath id={`${clipId}-${zone.type}`} key={zone.type}>
            <rect x={left} y={Math.max(top, y(zone.max))} width={canvasWidth - left} height={Math.max(0, Math.min(bottom, y(zone.min)) - Math.max(top, y(zone.max)))} />
          </clipPath>)}</defs>
          {ticks.map(({ value, color }) => <g key={value}>
            <line x1={left} x2={canvasWidth} y1={y(value)} y2={y(value)} stroke={color} strokeWidth="2" strokeDasharray="1 7" strokeLinecap="round" opacity=".75" />
          </g>)}
          <g clipPath={`url(#${clipId}-plot)`}>
          <g stroke="var(--line-strong)" strokeWidth={Math.max(2, plotWidth / 480)} strokeLinecap="round" opacity=".6">
            {points.map((point) => <line key={point.time} x1={x(point.minute)} x2={x(point.minute)} y1={y(point.min)} y2={y(point.max)} />)}
          </g>
          <path d={path} fill="none" stroke={ZONES.LIGHT.color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
          {zones.map((zone) => <path key={zone.type} d={path} fill="none" stroke={ZONES[zone.type].color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" clipPath={`url(#${clipId}-${zone.type})`} />)}
          {points.filter((point, index) => !points[index - 1] || Date.parse(point.time) - Date.parse(points[index - 1].time) > 10 * 60_000)
            .map((point) => <circle key={point.time} cx={x(point.minute)} cy={y(point.bpm)} r="2.5" fill={ZONES.LIGHT.color} />)}
          {visibleSelection && <g><line x1={x(visibleSelection.minute)} x2={x(visibleSelection.minute)} y1={top} y2={bottom} stroke="var(--ink)" strokeDasharray="3 4" opacity=".4" />
            <circle cx={x(visibleSelection.minute)} cy={y(visibleSelection.bpm)} r="4" fill="var(--surface)" stroke={ZONES.LIGHT.color} strokeWidth="2" /></g>}
          </g>
          {timeTicks.filter((minute) => minute === 0 ? start === 0 : minute === 1440 ? end >= 1440
            : x(minute) - viewportOffset >= 18 && x(minute) - viewportOffset <= right - 18).map((minute) =>
            <text key={minute} x={x(minute)} y="247" textAnchor={minute === 0 ? "start" : minute === 1440 ? "end" : "middle"} className="fitbit-heart-axis">{clock(minute)}</text>)}
          {visibleSelection && <g className="fitbit-heart-tooltip" transform={`translate(${Math.max(viewportOffset + left, Math.min(viewportOffset + right - 146, x(visibleSelection.minute) - 73))},${Math.max(top, y(visibleSelection.bpm) - 40)})`}>
            <rect width="146" height="28" rx="4" fill="var(--surface)" stroke="var(--line-strong)" />
            <text x="73" y="18" textAnchor="middle">{clock(visibleSelection.minute)} · {Math.round(visibleSelection.bpm)} уд/мин</text>
          </g>}
        </svg>
        </div>
        <svg className="fitbit-heart-axis-labels" viewBox="0 0 40 254" aria-hidden="true">
          {ticks.map(({ value }) => <text key={value} x="8" y={y(value) + 4} className="fitbit-heart-axis">{value}</text>)}
        </svg>
        {!visiblePoints.length && <span className="fitbit-heart-window-empty">Нет измерений в этом интервале</span>}
        <span className="sr-only" id={`${clipId}-help`}>Перемещайтесь по увеличенному графику двумя пальцами на трекпаде или свайпом. Стрелки клавиатуры выбирают измерение, Home и End — первое и последнее в интервале. Shift со стрелками перемещает интервал.</span>
        <span className="sr-only" role="status">{visibleSelection ? `${clock(visibleSelection.minute)} · ${Math.round(visibleSelection.bpm)} уд/мин` : ""}</span>
      </div>
    </> : <p className="fitbit-panel-empty">Детализация пульса по времени пока не получена. График появится после синхронизации измерений Fitbit.</p>}
  </article>;
}

export function FitbitSleepWeek({ days, date }: { days: FitbitDay[]; date: string }) {
  const end = Date.parse(`${date}T12:00:00Z`);
  const week = Array.from({ length: 7 }, (_, index) => {
    const day = new Date(end + (index - 6) * 86_400_000).toISOString().slice(0, 10);
    return { date: day, minutes: days.find((entry) => entry.date === day)?.sleep?.minutesAsleep ?? null };
  });
  const present = week.flatMap((day) => day.minutes == null ? [] : [day.minutes]);
  if (!present.length) return null;
  const min = Math.min(...present) - 30, max = Math.max(...present) + 30;
  const x = (index: number) => 8 + index * 30;
  const y = (minutes: number) => 49 - (minutes - min) / (max - min) * 42;
  return <div className="fitbit-sleep-week" aria-label="Продолжительность сна за 7 дней">
    <svg viewBox="0 0 196 58" role="img" aria-label="Недельная динамика сна">
      <line x1="8" x2="188" y1="49" y2="49" stroke="var(--line)" strokeDasharray="2 4" />
      {week.map((day, index) => day.minutes != null && <g key={day.date}>
        {index > 0 && week[index - 1].minutes != null && <line x1={x(index - 1)} x2={x(index)} y1={y(week[index - 1].minutes!)} y2={y(day.minutes)} stroke="var(--primary-2)" strokeWidth="2" />}
        <circle cx={x(index)} cy={y(day.minutes)} r={index === 6 ? 4 : 3} fill={index === 6 ? "var(--primary)" : "var(--primary-2)"}><title>{day.date}: {Math.round(day.minutes)} мин</title></circle>
      </g>)}
    </svg>
    <div>{week.map((day) => <span className={day.date === date ? "selected" : ""} key={day.date}>{new Intl.DateTimeFormat("ru-RU", { weekday: "narrow", timeZone: "UTC" }).format(new Date(`${day.date}T12:00:00Z`))}</span>)}</div>
  </div>;
}
