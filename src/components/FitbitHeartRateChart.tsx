import { HeartPulse } from "lucide-react";
import { useId, useState } from "react";
import type { PointerEvent } from "react";
import type { FitbitDay, FitbitHeartRateZone } from "../fitbit-types";
import { useChartSize } from "./useChartSize";

const ZONES: Record<FitbitHeartRateZone["type"], { label: string; color: string }> = {
  LIGHT: { label: "Лёгкая", color: "#0785a3" },
  MODERATE: { label: "Умеренная", color: "#25864e" },
  VIGOROUS: { label: "Высокая", color: "#b87910" },
  PEAK: { label: "Пиковая", color: "#c14e61" },
};
const clock = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;

export function FitbitHeartRateChart({ day }: { day: FitbitDay | undefined }) {
  const { containerRef, width, compact } = useChartSize();
  const clipId = useId();
  const [selection, setSelection] = useState(0);
  const points = day?.heartRate ?? [], zones = day?.heartRateZones ?? [];
  const selected = points[Math.min(selection, points.length - 1)];
  const min = points.reduce((value, point) => Math.min(value, point.min), Infinity);
  const max = points.reduce((value, point) => Math.max(value, point.max), 0);
  const lower = Math.max(0, Math.floor(Math.min(min, ...zones.map((zone) => zone.min)) / 10) * 10 - 10);
  const upper = Math.ceil(Math.max(max, ...zones.map((zone) => zone.min)) / 10) * 10 + 15;
  const top = 14, bottom = 220, left = 10, right = width - 40, plotWidth = right - left;
  const x = (minute: number) => left + minute / 1440 * plotWidth;
  const y = (bpm: number) => bottom - (bpm - lower) / (upper - lower) * (bottom - top);
  const path = points.map((point, index) => {
    const previous = points[index - 1];
    const connected = previous && Date.parse(point.time) - Date.parse(previous.time) <= 10 * 60_000 && point.minute > previous.minute;
    return `${connected ? "L" : "M"}${x(point.minute).toFixed(2)},${y(point.bpm).toFixed(2)}`;
  }).join(" ");
  const ticks = zones.length ? zones.map((zone) => ({ value: zone.min, color: ZONES[zone.type].color })) : [lower + 10, Math.round((lower + upper) / 20) * 10, upper - 15].map((value) => ({ value, color: "#8492a6" }));
  function inspect(event: PointerEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const minute = ((event.clientX - rect.left) * width / rect.width - left) / plotWidth * 1440;
    let nearest = 0;
    for (let index = 1; index < points.length; index++)
      if (Math.abs(points[index].minute - minute) < Math.abs(points[nearest].minute - minute)) nearest = index;
    setSelection(nearest);
  }
  return <article className="panel fitbit-heart-panel">
    <div className="panel-heading"><h3>Пульс в течение дня</h3><HeartPulse size={20} /></div>
    {points.length ? <>
      <div className="fitbit-heart-summary"><strong>{min}–{max}<span> уд/мин</span></strong>
        <span>{day?.restingHeartRate != null ? `В покое · ${day.restingHeartRate} уд/мин` : "Диапазон за выбранный день"}</span></div>
      <div className="fitbit-heart-chart" ref={containerRef}>
        <svg viewBox={`0 0 ${width} 254`} role="img" aria-label={`Пульс за день: от ${min} до ${max} ударов в минуту`}
          onPointerMove={(event) => { if (event.pointerType === "mouse") inspect(event); }} onPointerDown={inspect}>
          <defs>{zones.map((zone) => <clipPath id={`${clipId}-${zone.type}`} key={zone.type}>
            <rect x={left} y={Math.max(top, y(zone.max))} width={plotWidth} height={Math.max(0, Math.min(bottom, y(zone.min)) - Math.max(top, y(zone.max)))} />
          </clipPath>)}</defs>
          {ticks.map(({ value, color }) => <g key={value}>
            <line x1={left} x2={right} y1={y(value)} y2={y(value)} stroke={color} strokeWidth="2" strokeDasharray="1 7" strokeLinecap="round" opacity=".75" />
            <text x={right + 8} y={y(value) + 4} className="fitbit-heart-axis">{value}</text>
          </g>)}
          <g stroke="var(--line-strong)" strokeWidth={Math.max(2, plotWidth / 480)} strokeLinecap="round" opacity=".6">
            {points.map((point) => <line key={point.time} x1={x(point.minute)} x2={x(point.minute)} y1={y(point.min)} y2={y(point.max)} />)}
          </g>
          <path d={path} fill="none" stroke={ZONES.LIGHT.color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
          {zones.map((zone) => <path key={zone.type} d={path} fill="none" stroke={ZONES[zone.type].color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" clipPath={`url(#${clipId}-${zone.type})`} />)}
          {points.filter((point, index) => !points[index - 1] || Date.parse(point.time) - Date.parse(points[index - 1].time) > 10 * 60_000)
            .map((point) => <circle key={point.time} cx={x(point.minute)} cy={y(point.bpm)} r="2.5" fill={ZONES.LIGHT.color} />)}
          {selected && <g><line x1={x(selected.minute)} x2={x(selected.minute)} y1={top} y2={bottom} stroke="var(--ink)" strokeDasharray="3 4" opacity=".4" />
            <circle cx={x(selected.minute)} cy={y(selected.bpm)} r="4" fill="var(--surface)" stroke={ZONES.LIGHT.color} strokeWidth="2" /></g>}
          {(compact ? [0, 360, 720, 1080, 1380] : [0, 240, 480, 720, 960, 1200, 1380]).map((minute) =>
            <text key={minute} x={x(minute)} y="247" textAnchor={minute === 0 ? "start" : "middle"} className="fitbit-heart-axis">{clock(minute)}</text>)}
        </svg>
        <label className="fitbit-heart-inspect"><span role="status">{selected ? `${clock(selected.minute)} · ${Math.round(selected.bpm)} уд/мин` : ""}</span>
          <span className="sr-only">Время измерения пульса</span>
          <input type="range" min="0" max={points.length - 1} value={Math.min(selection, points.length - 1)}
            onChange={(event) => setSelection(Number(event.target.value))} aria-valuetext={selected ? `${clock(selected.minute)}, ${Math.round(selected.bpm)} уд/мин` : ""} />
        </label>
      </div>
      {zones.length > 0 && <ul className="fitbit-heart-legend" aria-label="Пульсовые зоны Fitbit">{zones.map((zone) => <li key={zone.type}>
        <i style={{ background: ZONES[zone.type].color }} />{ZONES[zone.type].label}<span>{zone.min}–{zone.max}</span></li>)}</ul>}
      <p className="fitbit-subtle">Разрывы линии — периоды без измерений. Серые отрезки показывают разброс пульса в течение минуты.</p>
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
