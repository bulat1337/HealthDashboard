import { Moon } from "lucide-react";
import { useState } from "react";
import type { CSSProperties } from "react";
import type { FitbitDay, FitbitSleep, FitbitSleepSegment, FitbitSleepStage } from "../fitbit-types";
import { personalSleepRange, segmentMinutes, sleepClock, sleepDuration, sleepQuality, stageSegments } from "../fitbit-charts";
import type { SleepQualityKey } from "../fitbit-charts";

const STAGES: { key: FitbitSleepStage; label: string }[] = [
  { key: "AWAKE", label: "Бодрствование" },
  { key: "RESTLESS", label: "Беспокойство" },
  { key: "REM", label: "Быстрый сон" },
  { key: "LIGHT", label: "Поверхностный сон" },
  { key: "DEEP", label: "Глубокий сон" },
  { key: "ASLEEP", label: "Сон" },
];

export function FitbitSleepDetails({ sleep, days, date }: { sleep: FitbitSleep | null | undefined; days: FitbitDay[]; date: string }) {
  const [selected, setSelected] = useState<FitbitSleepSegment | null>(null);
  const start = sleep ? Date.parse(sleep.start) : 0, end = sleep ? Date.parse(sleep.end) : 0;
  const span = end - start;
  const detailed = Boolean(sleep?.timeline?.length && span > 0);
  const rows = sleep ? STAGES.filter(({ key }) => sleep.stages[key] != null || stageSegments(sleep, key).length)
    .map(({ key, label }) => ({ key: key.toLowerCase(), label, minutes: sleep.stages[key] ?? segmentMinutes(stageSegments(sleep, key)), segments: stageSegments(sleep, key) })) : [];
  if (sleep?.shortAwakenings?.length) rows.splice(1, 0, {
    key: "short", label: "Краткие пробуждения", minutes: segmentMinutes(sleep.shortAwakenings), segments: sleep.shortAwakenings,
  });
  const quality = sleep ? sleepQuality(sleep) : null;
  const qualities: { key: SleepQualityKey; label: string }[] = [
    { key: "latency", label: "Время до засыпания" }, { key: "deep", label: "Глубокий сон" },
    { key: "restless", label: sleep?.stages.RESTLESS != null ? "Беспокойство" : "Краткие пробуждения" },
    { key: "breaks", label: "Перерывы вне постели" },
  ];
  return <article className="panel fitbit-sleep-panel fitbit-sleep-details">
    <div className="panel-heading"><h3>Сон</h3><Moon size={20} /></div>
    {!sleep ? <p className="fitbit-panel-empty">Нет записи сна за этот день.</p> : <>
      <div className="fitbit-sleep-total"><strong>{sleepDuration(sleep.minutesAsleep)}</strong>
        <span>{sleep.bedtime ?? sleepClock(sleep, start)} — {sleep.wakeTime ?? sleepClock(sleep, end)}</span></div>
      {sleep.processed === false && <p className="fitbit-subtle">Fitbit ещё обрабатывает сон.</p>}
      {detailed ? <div className="fitbit-sleep-timeline" aria-label="Стадии сна по времени">
        {rows.map((row) => <div className="fitbit-sleep-row" key={row.key}>
          <div className="fitbit-sleep-row-label"><span>{row.label}</span><strong>{sleepDuration(row.minutes)}</strong></div>
          <div className={`fitbit-sleep-track stage-track-${row.key}`}>
            {row.segments.map((segment, index) => {
              const from = Math.max(0, (Date.parse(segment.start) - start) / span * 100);
              const to = Math.min(100, (Date.parse(segment.end) - start) / span * 100);
              const label = `${row.label}: ${sleepClock(sleep, Date.parse(segment.start))}–${sleepClock(sleep, Date.parse(segment.end))}, ${sleepDuration((Date.parse(segment.end) - Date.parse(segment.start)) / 60_000)}`;
              return to > from && <button type="button" className={`fitbit-sleep-segment stage-${row.key}`}
                key={`${segment.start}-${index}`} style={{ left: `${from}%`, width: `${to - from}%` }}
                aria-label={label} title={label} onClick={() => setSelected(segment)} />;
            })}
          </div>
        </div>)}
        <div className="fitbit-sleep-clock" aria-hidden="true"><span>{sleep.bedtime ?? sleepClock(sleep, start)}</span>
          <span>{sleepClock(sleep, start + span / 2)}</span><span>{sleep.wakeTime ?? sleepClock(sleep, end)}</span></div>
        <div className="fitbit-sleep-endpoints"><span>Легли спать</span><span>Встали</span></div>
        <p className="fitbit-sleep-selection" role="status">{selected && Date.parse(selected.start) >= start && Date.parse(selected.end) <= end
          ? `${STAGES.find((stage) => stage.key === selected.type)?.label ?? "Сон"} · ${sleepClock(sleep, Date.parse(selected.start))}–${sleepClock(sleep, Date.parse(selected.end))}`
          : "Нажмите на участок, чтобы увидеть время"}</p>
      </div> : rows.length ? <>
        <p className="fitbit-subtle">Доступна суммарная длительность стадий. Интервалы по времени пока не получены.</p>
        <dl className="fitbit-stage-list">{rows.map((row) => <div key={row.key}><dt><i className={`stage-${row.key}`} />{row.label}</dt><dd>{sleepDuration(row.minutes)}</dd></div>)}</dl>
      </> : <p className="fitbit-subtle">Стадии сна пока недоступны.</p>}
      <div className="fitbit-sleep-quality"><h4>Качество сна</h4>
        {qualities.map(({ key, label }) => {
          const value = quality?.[key] ?? null, range = personalSleepRange(days, date, key);
          const outside = value != null && range && (value < range.min || value > range.max);
          const max = Math.max(30, (range?.max ?? 0) * 1.3, (value ?? 0) * 1.25);
          const position = value == null ? 0 : value / max * 100;
          return <div className={`fitbit-quality-row ${outside ? "outside" : range ? "" : "no-history"}`} key={key}>
            <div className="fitbit-quality-label"><span>{label}<strong>{sleepDuration(value)}{key === "breaks" && sleep.outOfBed && ` · ${sleep.outOfBed.length} эпиз.`}</strong></span>
              {value != null && range && <small>{outside ? value > range.max ? "Выше обычного" : "Ниже обычного" : "В обычном диапазоне"}</small>}</div>
            {value != null ? <>
              <div className="fitbit-quality-track" role="img" aria-label={`${label}: ${sleepDuration(value)}${range ? `, личный диапазон ${Math.round(range.min)}–${Math.round(range.max)} мин` : ""}`}
                style={{ "--quality-value": `${position}%` } as CSSProperties}>
                <span className="fitbit-quality-fill" />
                {range && <span className="fitbit-quality-range" style={{ left: `${range.min / max * 100}%`, width: `${(range.max - range.min) / max * 100}%` }} />}
                <i className="fitbit-quality-marker" />
              </div>
              <div className="fitbit-quality-caption">{range ? `Обычно ${Math.round(range.min)}–${Math.round(range.max)} мин` : "Личный диапазон появится после 7 ночей с данными"}</div>
            </> : null}
          </div>;
        })}
      </div>
    </>}
  </article>;
}
