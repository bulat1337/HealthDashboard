import { Activity, ChevronDown, ChevronLeft, ChevronRight, CircleAlert, ClipboardList, Dumbbell, FileImage, Plus, Save, Scale, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { fetchInBodyData, saveInBodyData } from "../api";
import { INBODY_METRICS, INBODY_REQUIRED, INBODY_SEGMENTS, inbodyDate, inbodyDateCompact } from "../inbody-types";
import type { InBodyData, InBodyInput, InBodyMetricKey, InBodyRecord, InBodySegmentKey } from "../inbody-types";
import { formatNumber, formatSigned } from "../stats";
import { useChartSize } from "./useChartSize";

const METRIC_KEYS = Object.keys(INBODY_METRICS) as InBodyMetricKey[];
const SEGMENT_KEYS = Object.keys(INBODY_SEGMENTS) as InBodySegmentKey[];
const QUICK: { key: InBodyMetricKey; icon: typeof Scale; label: string }[] = [
  { key: "weightKg", icon: Scale, label: "Вес" },
  { key: "skeletalMuscleKg", icon: Dumbbell, label: "Скелетные мышцы" },
  { key: "bodyFatPercent", icon: Activity, label: "Доля жира" },
  { key: "score", icon: ClipboardList, label: "Оценка InBody" },
];
const MAIN_FIELDS: InBodyMetricKey[] = [...INBODY_REQUIRED, "score", "bmi", "totalBodyWaterL", "ecwRatio"];

function valueText(key: InBodyMetricKey, value: number | undefined) {
  if (value === undefined) return "—";
  const metric = INBODY_METRICS[key];
  return `${"signed" in metric ? formatSigned(value, metric.digits) : formatNumber(value, metric.digits)}${metric.unit ? ` ${metric.unit}` : ""}`;
}

function InBodyTrend({ records, metric, selected, onSelect }: {
  records: InBodyRecord[]; metric: InBodyMetricKey; selected: string; onSelect: (id: string) => void;
}) {
  const { containerRef, width, compact } = useChartSize();
  const points = records.filter(row => row.metrics[metric] !== undefined);
  const height = 230, left = 46, right = 20, top = 24, bottom = 38;
  const vals = points.map(row => row.metrics[metric]!);
  const padding = Math.max((Math.max(...vals) - Math.min(...vals)) * .25, metric === "ecwRatio" ? .005 : 1);
  const low = "signed" in INBODY_METRICS[metric] ? Math.min(...vals) - padding : Math.max(0, Math.min(...vals) - padding);
  const high = Math.max(...vals) + padding;
  const times = records.map(row => Date.parse(`${row.measuredAtLocal}Z`));
  const t0 = Math.min(...times), t1 = Math.max(...times);
  const position = (row: InBodyRecord) => ({
    x: t0 === t1 ? left + (width - left - right) / 2 : left + (Date.parse(`${row.measuredAtLocal}Z`) - t0) / (t1 - t0) * (width - left - right),
    y: top + (high - row.metrics[metric]!) / (high - low) * (height - top - bottom),
  });
  const selectedPoint = points.find(row => row.id === selected);
  const paths: InBodyRecord[][] = [];
  for (const row of records) {
    if (row.metrics[metric] === undefined) paths.push([]);
    else { if (!paths.length) paths.push([]); paths[paths.length - 1].push(row); }
  }
  return <div className="inbody-trend" ref={containerRef}>
    {points.length ? <>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} role="group" aria-label={`История InBody: ${INBODY_METRICS[metric].label}`}>
        {[0, 1, 2, 3].map(i => {
          const y = top + i / 3 * (height - top - bottom);
          return <g key={i}><line x1={left} x2={width - right} y1={y} y2={y} stroke="var(--line)" strokeDasharray="3 5" />
            <text x={left - 10} y={y + 4} textAnchor="end" className="inbody-axis">{formatNumber(high - i / 3 * (high - low), INBODY_METRICS[metric].digits)}</text></g>;
        })}
        {paths.filter(segment => segment.length > 1).map((segment, index) => <path key={index} d={segment.map((row, i) => { const p = position(row); return `${i ? "L" : "M"}${p.x},${p.y}`; }).join(" ")} stroke="var(--primary-2)" strokeWidth="2.5" fill="none" />)}
        {points.map((row, index) => {
          const p = position(row), active = row.id === selected;
          return <g key={row.id}>
            <circle cx={p.x} cy={p.y} r={active ? 7 : 4} fill={active ? "var(--amber)" : "var(--primary-2)"} stroke="white" strokeWidth="2" />
            <circle cx={p.x} cy={p.y} r="20" fill="transparent" role="button" tabIndex={0} aria-pressed={active}
              aria-label={`${inbodyDate(row.measuredAtLocal)}: ${valueText(metric, row.metrics[metric])}`} onClick={() => onSelect(row.id)}
              onKeyDown={event => {
                let next = index;
                if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(row.id); return; }
                if (event.key === "ArrowLeft") next = Math.max(0, index - 1);
                else if (event.key === "ArrowRight") next = Math.min(points.length - 1, index + 1);
                else if (event.key === "Home") next = 0;
                else if (event.key === "End") next = points.length - 1;
                else return;
                event.preventDefault(); onSelect(points[next].id);
                const circles = event.currentTarget.ownerSVGElement?.querySelectorAll<SVGCircleElement>('[role="button"]');
                circles?.[next]?.focus();
              }}><title>{inbodyDate(row.measuredAtLocal)} · {valueText(metric, row.metrics[metric])}</title></circle>
            {(points.length === 1 || index === 0 || index === points.length - 1 || (!compact && index === Math.floor(points.length / 2))) &&
              <text x={p.x} y={height - 10} textAnchor={points.length === 1 ? "middle" : index === 0 ? "start" : index === points.length - 1 ? "end" : "middle"} className="inbody-axis">{inbodyDate(row.measuredAtLocal, true)}</text>}
          </g>;
        })}
        {selectedPoint && <text x={width - right} y={15} textAnchor="end" className="inbody-chart-value">{valueText(metric, selectedPoint.metrics[metric])}</text>}
      </svg>
      {points.length === 1 && <p className="inbody-chart-note">{records.length === 1 ? "Первое измерение. Динамика появится после следующего замера." : "Показатель записан в одном измерении."}</p>}
    </> : <p className="inbody-empty-chart">Этот показатель ещё не записан. Выберите другой показатель.</p>}
  </div>;
}

function Composition({ record }: { record: InBodyRecord }) {
  const { metrics: m } = record;
  const parts = [
    { label: "Вода", value: m.totalBodyWaterL, unit: "л", color: "var(--primary-2)" },
    { label: "Протеины", value: m.proteinKg, unit: "кг", color: "var(--primary)" },
    { label: "Минералы", value: m.mineralsKg, unit: "кг", color: "#8da9cd" },
    { label: "Жир", value: m.bodyFatKg, unit: "кг", color: "var(--amber)" },
  ];
  const complete = parts.every(part => part.value !== undefined);
  return <section className="panel inbody-panel">
    <div className="panel-heading"><div><h3>Из чего состоит вес</h3><span>Компоненты состава тела с бланка</span></div><Scale size={20} /></div>
    {complete && <div className="inbody-composition-bar" role="img" aria-label={parts.map(p => `${p.label}: ${formatNumber(p.value, 2)} ${p.unit}`).join(", ")}>
      {parts.map(part => <span key={part.label} style={{ flex: part.value, background: part.color }} />)}
    </div>}
    <dl className="inbody-composition-legend">{parts.map(part => <div key={part.label}>
      <dt><i style={{ background: part.color }} />{part.label}</dt><dd>{formatNumber(part.value, 2)} <small>{part.unit}</small></dd>
    </div>)}</dl>
    {!complete && <p className="inbody-chart-note">Для диаграммы заполните воду, протеины, минералы и жировую массу.</p>}
    <div className="inbody-composition-extra"><span>Безжировая масса <strong>{valueText("fatFreeKg", m.fatFreeKg)}</strong></span><span>Жировая масса <strong>{valueText("bodyFatKg", m.bodyFatKg)}</strong></span></div>
  </section>;
}

function Segments({ record }: { record: InBodyRecord }) {
  const [kind, setKind] = useState<"lean" | "fat">("lean");
  const entries = SEGMENT_KEYS.map(key => ({ key, value: record.segments?.[key] }));
  const max = Math.max(150, ...entries.map(({ value }) => (kind === "lean" ? value?.leanPercent : value?.fatPercent) ?? 0)) * 1.08;
  const hasValues = entries.some(({ value }) => kind === "lean"
    ? value?.leanKg !== undefined || value?.leanPercent !== undefined
    : value?.fatKg !== undefined || value?.fatPercent !== undefined);
  return <section className="panel inbody-panel">
    <div className="panel-heading"><div><h3>Состав по сегментам</h3><span>Правая и левая стороны тела</span></div><Dumbbell size={20} /></div>
    <div className="segmented inbody-switch" aria-label="Состав по сегментам">
      <button type="button" className={kind === "lean" ? "active" : ""} aria-pressed={kind === "lean"} onClick={() => setKind("lean")}>Тощая масса</button>
      <button type="button" className={kind === "fat" ? "active" : ""} aria-pressed={kind === "fat"} onClick={() => setKind("fat")}>Жировая масса</button>
    </div>
    {hasValues ? <>
      <div className="inbody-segment-head"><span>Масса, кг</span><span>% от эталона InBody</span></div>
      <div className={`inbody-segments ${kind === "fat" ? "inbody-segments-fat" : ""}`}>
        {entries.map(({ key, value }) => {
          const kg = kind === "lean" ? value?.leanKg : value?.fatKg;
          const percent = kind === "lean" ? value?.leanPercent : value?.fatPercent;
          return <div key={key} className="inbody-segment-row"><div><span>{INBODY_SEGMENTS[key]}</span><strong>{formatNumber(kg, 2)} <small>кг</small></strong></div>
            <div className="inbody-segment-plot"><div className="inbody-segment-track" aria-hidden="true">
              <i className="inbody-segment-reference" style={{ left: `${100 / max * 100}%` }} />
              {percent !== undefined && <span style={{ width: `${percent / max * 100}%` }} />}
            </div><span>{percent === undefined ? "—" : `${formatNumber(percent, 1)}%`}</span></div></div>;
        })}
      </div>
      <p className="inbody-chart-note">Метка на шкале — 100% эталона аппарата. Проценты перенесены из отчёта.</p>
    </> : <p className="inbody-chart-note">Данные по сегментам ещё не добавлены.</p>}
  </section>;
}

function ReportDetails({ record }: { record: InBodyRecord }) {
  return <details className="panel inbody-details">
    <summary><span><ClipboardList size={18} />Все показатели и оценки бланка</span><ChevronDown size={18} /></summary>
    <div className="inbody-details-content">
      <dl className="inbody-values">{METRIC_KEYS.filter(key => record.metrics[key] !== undefined).map(key => {
        const range = record.ranges?.[key];
        return <div key={key}><dt>{INBODY_METRICS[key].label}{range && <small>Диапазон бланка: {formatNumber(range[0], INBODY_METRICS[key].digits)}–{formatNumber(range[1], INBODY_METRICS[key].digits)} {INBODY_METRICS[key].unit}</small>}</dt><dd>{valueText(key, record.metrics[key])}</dd></div>;
      })}</dl>
      {record.assessments && <><h4>Оценки аппарата</h4><dl className="inbody-values">{Object.entries(record.assessments).map(([key, val]) => <div key={key}><dt>{key}</dt><dd>{val}</dd></div>)}</dl></>}
      {!!record.impedance?.length && <><h4>Импеданс, Ом</h4><div className="inbody-impedance">{record.impedance.map(row => <div key={row.frequencyKhz}>
        <strong>{row.frequencyKhz} кГц</strong><dl>{SEGMENT_KEYS.map(key => <div key={key}><dt>{INBODY_SEGMENTS[key]}</dt><dd>{formatNumber(row[key], 1)}</dd></div>)}</dl>
      </div>)}</div></>}
      {record.notes && <p className="inbody-chart-note">{record.notes}</p>}
    </div>
  </details>;
}

function InBodyForm({ userId, name, onCancel, onSaved }: {
  userId: string; name: string; onCancel: () => void; onSaved: (data: InBodyData, record: InBodyRecord) => void;
}) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => { formRef.current?.querySelector<HTMLInputElement>("input")?.focus(); }, []);
  const field = (key: InBodyMetricKey) => {
    const metric = INBODY_METRICS[key];
    return <label className="inbody-field" key={key}>{metric.label}{metric.unit ? `, ${metric.unit}` : ""}{INBODY_REQUIRED.includes(key) ? " *" : ""}
      <input name={`metric.${key}`} type="number" inputMode="decimal" step={10 ** -metric.digits} min={"signed" in metric ? -metric.max : 0} max={metric.max} required={INBODY_REQUIRED.includes(key)} />
    </label>;
  };
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    const values = new FormData(event.currentTarget);
    const input: InBodyInput = { userId, measuredAtLocal: String(values.get("measuredAtLocal")), device: String(values.get("device")), metrics: {} };
    for (const key of METRIC_KEYS) { const val = values.get(`metric.${key}`); if (val !== null && val !== "") input.metrics[key] = Number(val); }
    for (const key of ["heightCm", "age"] as const) { const val = values.get(key); if (val !== null && val !== "") input[key] = Number(val); }
    const sex = values.get("sex"); if (sex === "male" || sex === "female") input.sex = sex;
    const notes = values.get("notes"); if (notes) input.notes = String(notes);
    input.segments = {};
    for (const key of SEGMENT_KEYS) {
      const segment: NonNullable<InBodyInput["segments"]>[InBodySegmentKey] = {};
      for (const property of ["leanKg", "leanPercent", "fatKg", "fatPercent"] as const) {
        const value = values.get(`segment.${key}.${property}`);
        if (value !== null && value !== "") segment[property] = Number(value);
      }
      if (Object.keys(segment).length) input.segments[key] = segment;
    }
    setBusy(true); setError("");
    try { const result = await saveInBodyData(input); onSaved(result.data, result.record); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Не удалось сохранить измерение. Попробуйте ещё раз."); }
    finally { setBusy(false); }
  }
  return <form className="panel inbody-panel inbody-form" ref={formRef} onSubmit={submit} aria-label={`Новое измерение InBody: ${name}`}>
    <div className="panel-heading"><div><h3>Новое измерение · {name}</h3><span>Перенесите значения с бланка. Обязательные поля отмечены *.</span></div><button type="button" className="icon-button" onClick={onCancel} disabled={busy} aria-label="Закрыть форму"><X size={18} /></button></div>
    <fieldset disabled={busy}>
      <div className="inbody-form-grid">
        <label className="inbody-field">Дата и время с бланка *<input type="datetime-local" name="measuredAtLocal" required /></label>
        <label className="inbody-field">Аппарат *<input name="device" defaultValue="InBody 570" required maxLength={80} /></label>
        <label className="inbody-field">Рост, см<input type="number" name="heightCm" min={50} max={260} step="0.1" inputMode="decimal" /></label>
        <label className="inbody-field">Возраст на дату измерения<input type="number" name="age" min={1} max={120} inputMode="numeric" /></label>
        <label className="inbody-field">Пол на бланке<select name="sex" defaultValue=""><option value="">Не указан</option><option value="male">Мужской</option><option value="female">Женский</option></select></label>
      </div>
      <div className="inbody-form-grid">{MAIN_FIELDS.map(field)}</div>
      <details><summary>Дополнительные показатели</summary><div className="inbody-form-grid">{METRIC_KEYS.filter(key => !MAIN_FIELDS.includes(key)).map(field)}</div></details>
      <details><summary>Показатели по сегментам</summary><div className="inbody-segment-fields">{SEGMENT_KEYS.map(key => <div key={key}><h4>{INBODY_SEGMENTS[key]}</h4><div className="inbody-form-grid">{([
        ["leanKg", "Тощая масса, кг"], ["leanPercent", "Тощая масса, % эталона"], ["fatKg", "Жировая масса, кг"], ["fatPercent", "Жировая масса, % эталона"],
      ] as const).map(([property, label]) => <label key={property} className="inbody-field">{label}<input aria-label={`${INBODY_SEGMENTS[key]}: ${label}`} name={`segment.${key}.${property}`} type="number" inputMode="decimal" min={0} max={property.endsWith("Percent") ? 1000 : 300} step="0.01" /></label>)}</div></div>)}</div></details>
      <label className="inbody-field">Заметка<textarea name="notes" rows={2} maxLength={2000} /></label>
    </fieldset>
    {error && <p className="error-banner" role="alert"><CircleAlert size={18} />{error}</p>}
    <div className="inbody-form-actions"><button type="submit" className="fitbit-button" disabled={busy}><Save size={17} />{busy ? "Сохраняем…" : "Сохранить измерение"}</button><button type="button" className="inbody-button" disabled={busy} onClick={onCancel}>Отмена</button></div>
  </form>;
}

export function InBodyDashboard({ userId, name, refreshKey }: { userId: string; name: string; refreshKey: number }) {
  const [data, setData] = useState<InBodyData | null>(null), [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null), [metric, setMetric] = useState<InBodyMetricKey>("weightKg");
  const [adding, setAdding] = useState(false), [retry, setRetry] = useState(0), [notice, setNotice] = useState("");
  const addRef = useRef<HTMLButtonElement>(null);
  const sequence = useRef(0);
  useEffect(() => {
    const controller = new AbortController(), current = ++sequence.current;
    fetchInBodyData(controller.signal).then(result => {
      if (!controller.signal.aborted && current === sequence.current) { setData(result.data); setError(""); }
    }).catch(failure => { if (!controller.signal.aborted && current === sequence.current) setError(failure instanceof Error ? failure.message : "Не удалось загрузить InBody"); });
    return () => controller.abort();
  }, [refreshKey, retry]);
  const records = (data?.measurements ?? []).filter(row => row.userId === userId).sort((a, b) => a.measuredAtLocal.localeCompare(b.measuredAtLocal));
  const record = records.find(row => row.id === selectedId) ?? records.at(-1);
  const index = record ? records.findIndex(row => row.id === record.id) : -1;
  const previous = index > 0 ? records[index - 1] : undefined;
  function closeForm() { setAdding(false); requestAnimationFrame(() => addRef.current?.focus()); }
  return <div className="inbody-dashboard">
    <div className="health-body-heading inbody-heading"><div><h3>InBody</h3><span>Аппаратный анализ состава тела · {name}</span></div>
      <button type="button" className="fitbit-button" ref={addRef} disabled={adding || !data} onClick={() => { setAdding(true); setNotice(""); }}><Plus size={18} />Добавить измерение</button>
    </div>
    {notice && <p className="inbody-notice" role="status">{notice}</p>}
    {error && <div className="error-banner" role="alert"><CircleAlert size={18} /><span>{error}</span><button className="inbody-button" type="button" onClick={() => setRetry(value => value + 1)}>Повторить</button></div>}
    {!data && !error && <p role="status">Загружаем измерения InBody…</p>}
    {adding && <InBodyForm userId={userId} name={name} onCancel={closeForm} onSaved={(next, saved) => {
      ++sequence.current; setData(next); setSelectedId(saved.id); setError(""); closeForm(); setNotice("Измерение сохранено");
    }} />}
    {data && !record && <section className="panel inbody-empty"><ClipboardList size={32} /><h3>Первый замер InBody</h3><p>Здесь будут состав тела, показатели по сегментам и история {name}. Добавьте значения с бланка аппарата.</p></section>}
    {record && <>
      <section className="panel inbody-record-toolbar" aria-label="Выбранное измерение InBody">
        <div className="inbody-record-select"><button type="button" className="icon-button" disabled={index <= 0} onClick={() => setSelectedId(records[index - 1].id)} aria-label="Предыдущее измерение InBody"><ChevronLeft size={18} /></button>
          <label><span className="sr-only">Измерение InBody</span><select title={inbodyDate(record.measuredAtLocal)} value={record.id} onChange={event => setSelectedId(event.target.value)}>{[...records].reverse().map(row => <option key={row.id} value={row.id}>{inbodyDateCompact(row.measuredAtLocal)}</option>)}</select></label>
          <button type="button" className="icon-button" disabled={index === records.length - 1} onClick={() => setSelectedId(records[index + 1].id)} aria-label="Следующее измерение InBody"><ChevronRight size={18} /></button>
        </div>
        <div className="inbody-report-meta"><span>{record.device}</span>{record.heightCm !== undefined && <span>{formatNumber(record.heightCm, 1)} см</span>}{record.age !== undefined && <span>Возраст: {record.age}</span>}
          {record.sourceImage && <a className="inbody-source" href={`/api/inbody-data/measurements/${encodeURIComponent(record.id)}/source`} target="_blank" rel="noreferrer"><FileImage size={16} />Бланк</a>}
        </div>
      </section>
      <section className="inbody-quick" aria-label="Основные показатели InBody">{QUICK.map(({ key, icon: Icon, label }) => {
        const value = record.metrics[key], prev = previous?.metrics[key];
        return <button className={`panel inbody-stat ${metric === key ? "selected" : ""}`} type="button" key={key} aria-pressed={metric === key} onClick={() => setMetric(key)}>
          <span><Icon size={18} />{label}</span><strong>{formatNumber(value, INBODY_METRICS[key].digits)} <small>{key === "score" ? "/ 100" : INBODY_METRICS[key].unit}</small></strong>
          <small>{value === undefined ? "Нет в этом бланке" : prev !== undefined ? `${formatSigned(value - prev, INBODY_METRICS[key].digits)} к прошлому замеру` : "Первое значение в истории"}</small>
        </button>;
      })}</section>
      <div className="inbody-grid"><div className="inbody-column">
        <Composition record={record} />
        <section className="panel inbody-panel">
          <div className="panel-heading"><div><h3>Динамика измерений</h3><span>{records.length === 1 ? "1 измерение" : `Измерений: ${records.length}`} · {name}</span></div>
            <label className="inbody-chart-select"><span className="sr-only">Показатель истории InBody</span><select value={metric} onChange={event => setMetric(event.target.value as InBodyMetricKey)}>{METRIC_KEYS.map(key => <option key={key} value={key}>{INBODY_METRICS[key].label}{INBODY_METRICS[key].unit ? `, ${INBODY_METRICS[key].unit}` : ""}</option>)}</select></label>
          </div><InBodyTrend records={records} metric={metric} selected={record.id} onSelect={setSelectedId} />
        </section>
      </div><div className="inbody-column">
        <Segments record={record} />
        <section className="panel inbody-panel"><div className="panel-heading"><div><h3>Контроль веса</h3><span>Целевые значения, напечатанные аппаратом</span></div><Scale size={20} /></div>
          <dl className="inbody-values">{(["targetWeightKg", "weightControlKg", "fatControlKg", "muscleControlKg"] as InBodyMetricKey[]).map(key => <div key={key}><dt>{INBODY_METRICS[key].label}</dt><dd>{valueText(key, record.metrics[key])}</dd></div>)}</dl>
        </section>
      </div></div>
      <ReportDetails record={record} />
    </>}
  </div>;
}
