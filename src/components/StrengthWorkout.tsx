import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Check, ChevronDown, ChevronRight, Dumbbell, Play, Plus, Timer, Trash2, Watch, X } from "lucide-react";
import { finishStrengthSession } from "../api";
import {
  groupStrengthSets, isStrengthPlan, STRENGTH_EXERCISES, STRENGTH_PLANS, STRENGTH_PLAN_IDS,
  type StrengthPlanId, type StrengthSession, type StrengthSet
} from "../strength";
import type { SportData, SportEntry } from "../types";

type Draft = {
  id: string;
  date: string;
  planId: StrengthPlanId;
  startedAt: string;
  sets: StrengthSet[];
  exercise: string;
  weight: string;
  reps: string;
  editingIndex: number | null;
};

function readDraft(key: string): Draft | null {
  const raw = window.localStorage.getItem(key);
  if (!raw) return null;
  const draft = JSON.parse(raw) as Draft | null;
  return draft && isStrengthPlan(draft.planId) && Array.isArray(draft.sets) &&
    Number.isFinite(Date.parse(draft.startedAt)) ? draft : null;
}

function normalizeName(name: string) {
  return name.trim().toLowerCase().replaceAll("ё", "е").replace(/\s+/g, " ");
}

function clockText(milliseconds: number) {
  const total = Math.floor(Math.max(0, milliseconds) / 1000);
  const minutes = Math.floor(total / 60) % 60;
  const seconds = total % 60;
  const hours = Math.floor(total / 3600);
  return `${hours ? `${hours}:` : ""}${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function StrengthClock({ startedAt }: { startedAt: string }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return <span className="strength-clock" role="timer" aria-label="Прошло времени">
    <Timer size={17} aria-hidden="true" />
    {clockText(now - Date.parse(startedAt))}
  </span>;
}

const number = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 6 });

function setText(set: StrengthSet, commonNote?: string) {
  const segments = set.segments.map(({ weightKg, reps, note }) => {
    const values = `${weightKg === null ? "—" : `${number.format(weightKg)} кг`} × ${reps ?? "—"}`;
    return note && note !== commonNote ? `${values} · ${note}` : values;
  });
  return `${set.approximate ? "≈ " : ""}${segments.join(" + ")}`;
}

function StrengthSets({ sets, editingIndex, onEdit, disabled }: {
  sets: StrengthSet[];
  editingIndex?: number | null;
  onEdit?: (index: number) => void;
  disabled?: boolean;
}) {
  return <dl className="strength-sets">
    {[...groupStrengthSets(sets)].map(([exercise, group]) => {
      const note = group[0].set.segments[0]?.note;
      const commonNote = note && group.every(({ set }) => set.segments.every((segment) => segment.note === note))
        ? note : undefined;
      return <div className="strength-exercise-sets" key={exercise}>
        <dt>{exercise}{commonNote && <small>{commonNote}</small>}</dt>
        <dd>
          {group.map(({ set, index }, setNumber) => onEdit ? (
            <button type="button" className="strength-set" key={index} disabled={disabled}
              aria-label={`${exercise}, подход ${setNumber + 1}, ${setText(set)}`}
              aria-pressed={editingIndex === index} onClick={() => onEdit(index)}>
              {setText(set)}
            </button>
          ) : <span className="strength-set" key={index}>{setText(set, commonNote)}</span>)}
        </dd>
      </div>;
    })}
  </dl>;
}

export function StrengthWorkoutDetails({ session, children }: {
  session: StrengthSession;
  children?: ReactNode;
}) {
  const duration = session.source === "dashboard"
    ? clockText(Date.parse(session.endedAt) - Date.parse(session.startedAt)) : null;
  return <details className="strength-history" open>
    <summary>
      <Dumbbell size={18} aria-hidden="true" />
      <span className="strength-history-heading">
        <strong>{STRENGTH_PLANS[session.planId].name}</strong>
        {duration && <small>{duration}</small>}
      </span>
      {children && <span className="sport-fitbit-badge"><Watch size={13} aria-hidden="true" /> Fitbit</span>}
      <ChevronDown className="strength-chevron" size={16} aria-hidden="true" />
    </summary>
    <StrengthSets sets={session.sets} />
    {children}
  </details>;
}

export function StrengthWorkout({ userId, entries, dateFor, onComplete }: {
  userId: string;
  entries: SportEntry[];
  dateFor: (date: Date) => string;
  onComplete: (data: SportData, date: string) => void;
}) {
  const storageKey = `life-dashboard-strength-draft-v1:${userId}`;
  const [draft, setDraft] = useState<Draft | null>(() => {
    try { return readDraft(storageKey); } catch { return null; }
  });
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [storageError, setStorageError] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const titleId = useId();

  useEffect(() => {
    function updateFromStorage(event: StorageEvent) {
      if (event.key !== storageKey && event.key !== null) return;
      try { setDraft(readDraft(storageKey)); } catch { setStorageError(true); }
    }
    window.addEventListener("storage", updateFromStorage);
    return () => window.removeEventListener("storage", updateFromStorage);
  }, [storageKey]);

  useEffect(() => {
    if (open && !dialogRef.current?.open) dialogRef.current?.showModal();
  }, [open]);

  function draftIsCurrent() {
    if (storageError) return true;
    try {
      const latest = readDraft(storageKey);
      if (JSON.stringify(latest) === JSON.stringify(draft)) return true;
      setDraft(latest);
      setError("Тренировка изменилась в другой вкладке. Повторите действие.");
      return false;
    } catch {
      setStorageError(true);
      return true;
    }
  }

  function updateDraft(next: Draft | null) {
    if (!draftIsCurrent()) return false;
    setDraft(next);
    try {
      if (next) window.localStorage.setItem(storageKey, JSON.stringify(next));
      else window.localStorage.removeItem(storageKey);
      setStorageError(false);
    } catch {
      setStorageError(true);
    }
    return true;
  }

  function resetPicker() {
    setPicking(false);
    setExpanded(false);
    setQuery("");
  }

  function openWorkout() {
    resetPicker();
    setConfirmCancel(false);
    setError("");
    setOpen(true);
  }

  function start(planId: StrengthPlanId) {
    const now = new Date();
    const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), (value) => value.toString(16).padStart(2, "0")).join("");
    if (updateDraft({
      id, date: dateFor(now), planId, startedAt: now.toISOString(),
      sets: [], exercise: "", weight: "", reps: "", editingIndex: null
    })) {
      resetPicker();
    }
  }

  const history = draft && open ? entries.slice().reverse().flatMap((entry) => (entry.strengthSessions ?? []).slice().reverse()) : [];
  const currentSets = draft?.sets ?? [];
  const plan = draft && STRENGTH_PLANS[draft.planId];
  const recentNames = [...new Set(history.filter((session) => session.planId === draft?.planId)
    .slice(0, 2).flatMap((session) => session.sets.map((set) => set.exercise)))];
  const suggested = [...new Set([...recentNames, ...(plan?.exercises ?? [])])].slice(0, 6);
  const allNames = [...new Set([...suggested, ...(plan?.exercises ?? []), ...currentSets.map((set) => set.exercise),
    ...history.flatMap((session) => session.sets.map((set) => set.exercise)), ...Object.values(STRENGTH_EXERCISES)])];
  const searchText = normalizeName(query);
  const matchingNames = expanded ? allNames.filter((name) => normalizeName(name).includes(searchText)) : suggested;
  const canAddExercise = expanded && searchText && !allNames.some((name) => normalizeName(name) === searchText);

  function chooseExercise(exercise: string, editingIndex: number | null = null) {
    if (!draft) return;
    const lastSet = editingIndex !== null ? draft.sets[editingIndex] :
      draft.sets.filter((set) => set.exercise === exercise).at(-1) ??
      history.find((session) => session.sets.some((set) => set.exercise === exercise))
        ?.sets.filter((set) => set.exercise === exercise).at(-1);
    const last = lastSet?.segments[0];
    if (updateDraft({
      ...draft, exercise, editingIndex, weight: String(last?.weightKg ?? 0).replace(".", ","), reps: String(last?.reps ?? "")
    })) {
      resetPicker();
      setError("");
    }
  }

  function addSet(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft?.exercise || saving) return;
    const weight = draft.weight.trim();
    const weightKg = /^(?:\d+(?:[.,]\d*)?|[.,]\d+)$/.test(weight) ? Number(weight.replace(",", ".")) : NaN;
    const reps = /^\d+$/.test(draft.reps.trim()) ? Number(draft.reps) : NaN;
    if (!(weightKg >= 0 && weightKg <= 1000) || !(reps >= 1 && reps <= 1000)) {
      setError("Проверьте вес и количество повторений.");
      return;
    }
    const set = { exercise: draft.exercise, segments: [{ weightKg, reps }] };
    const sets = [...draft.sets];
    if (draft.editingIndex !== null) sets[draft.editingIndex] = set;
    else if (sets.length < 300) sets.push(set);
    else { setError("В тренировке уже 300 подходов."); return; }
    if (updateDraft({ ...draft, sets, editingIndex: null })) setError("");
  }

  function editSet(index: number) {
    if (!draft) return;
    chooseExercise(draft.sets[index].exercise, index);
    formRef.current?.scrollIntoView({ block: "nearest" });
  }

  function removeSet() {
    if (!draft || draft.editingIndex === null || saving) return;
    const sets = draft.sets.filter((_set, index) => index !== draft.editingIndex);
    if (updateDraft({ ...draft, sets, editingIndex: null })) setError("");
  }

  async function finish() {
    if (!draft?.sets.length || saving || !draftIsCurrent()) return;
    setSaving(true);
    setError("");
    try {
      const { id, date, planId, startedAt, sets } = draft;
      const { data } = await finishStrengthSession(userId, {
        id, date, planId, startedAt, sets, source: "dashboard", endedAt: new Date().toISOString()
      });
      try {
        if (readDraft(storageKey)?.id === id) window.localStorage.removeItem(storageKey);
      } catch { setStorageError(true); }
      setDraft((current) => current?.id === id ? null : current);
      dialogRef.current?.close();
      onComplete(data, date);
    } catch {
      setError("Не удалось сохранить тренировку. Попробуйте ещё раз.");
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    if (!updateDraft(null)) return;
    setConfirmCancel(false);
    dialogRef.current?.close();
  }

  const showPicker = draft && (!draft.exercise || picking);
  return <>
    <button type="button" className="strength-button strength-primary strength-trigger" onClick={openWorkout}>
      {draft ? <Dumbbell size={18} aria-hidden="true" /> : <Play size={18} aria-hidden="true" />}
      <span>{draft ? "Продолжить тренировку" : "Начать тренировку"}</span>
      {draft && <StrengthClock startedAt={draft.startedAt} />}
    </button>
    <dialog className="strength-dialog" ref={dialogRef} aria-labelledby={titleId}
      onCancel={(event) => { if (saving) event.preventDefault(); }} onClose={() => setOpen(false)}>
      {open && <div className="strength-dialog-shell">
        <header className="strength-dialog-header">
          <div>
            <h2 id={titleId}>{plan ? plan.name : "Начать тренировку"}</h2>
            {draft && <StrengthClock startedAt={draft.startedAt} />}
          </div>
          <button type="button" className="strength-button strength-icon-button" disabled={saving}
            aria-label="Закрыть" onClick={() => dialogRef.current?.close()}>
            <X size={20} aria-hidden="true" />
          </button>
        </header>
        <div className="strength-dialog-body">
          {(error || storageError) && <p className="strength-error" role="alert">
            {error || "Браузер не сохраняет черновик. Оставьте вкладку открытой."}
          </p>}
          {!draft ? <div className="strength-choices">
            {STRENGTH_PLAN_IDS.map((id) => <button type="button" className="strength-choice" key={id} onClick={() => start(id)}>
              <span>{STRENGTH_PLANS[id].name}</span><ChevronRight size={18} aria-hidden="true" />
            </button>)}
          </div> : <>
            {showPicker ? <div className="strength-picker">
              <div className="strength-picker-heading">
                <h3>Упражнения</h3>
                {draft.exercise && <button type="button" className="strength-button strength-text-button"
                  disabled={saving} onClick={resetPicker}>Назад</button>}
              </div>
              {expanded && <input className="strength-input" type="search" aria-label="Поиск упражнения"
                maxLength={100} placeholder="Поиск упражнения" value={query} onChange={(event) => setQuery(event.target.value)} />}
              <div className="strength-choices strength-exercise-options">
                {matchingNames.map((name) => <button type="button" className="strength-choice" key={name} disabled={saving}
                  onClick={() => chooseExercise(name)}>
                  <span>{name}</span><ChevronRight size={16} aria-hidden="true" />
                </button>)}
                {canAddExercise && <button type="button" className="strength-choice" disabled={saving}
                  onClick={() => chooseExercise(query.trim().replace(/\s+/g, " "))}>
                  <span>Добавить «{query.trim()}»</span><Plus size={16} aria-hidden="true" />
                </button>}
              </div>
              {!expanded && <button type="button" className="strength-button strength-text-button" disabled={saving}
                onClick={() => setExpanded(true)}>Все упражнения <ChevronDown size={16} aria-hidden="true" /></button>}
            </div> : <form ref={formRef} className="strength-set-form" onSubmit={addSet}>
              <button type="button" className="strength-choice strength-current-exercise" aria-label={`Выбрать упражнение, сейчас ${draft.exercise}`}
                disabled={saving} onClick={() => setPicking(true)}>
                <span>{draft.exercise}</span><ChevronDown size={16} aria-hidden="true" />
              </button>
              <div className="strength-set-fields">
                <label>Вес, кг<input className="strength-input" inputMode="decimal" value={draft.weight} maxLength={12}
                  disabled={saving} onFocus={(event) => event.currentTarget.select()}
                  onChange={(event) => updateDraft({ ...draft, weight: event.target.value })} /></label>
                <label>Повторы<input className="strength-input" inputMode="numeric" value={draft.reps} maxLength={4}
                  disabled={saving} onFocus={(event) => event.currentTarget.select()}
                  onChange={(event) => updateDraft({ ...draft, reps: event.target.value })} /></label>
              </div>
              <button type="submit" className="strength-button strength-primary strength-add-set" disabled={saving}>
                {draft.editingIndex !== null ? <Check size={18} aria-hidden="true" /> : <Plus size={18} aria-hidden="true" />}
                {draft.editingIndex !== null ? "Сохранить подход" : "Добавить подход"}
              </button>
              {draft.editingIndex !== null && <div className="strength-edit-actions">
                <button type="button" className="strength-button strength-text-button" disabled={saving}
                  onClick={() => chooseExercise(draft.exercise)}>Отменить правку</button>
                <button type="button" className="strength-button strength-text-button strength-danger" disabled={saving} onClick={removeSet}>
                  <Trash2 size={16} aria-hidden="true" /> Удалить подход
                </button>
              </div>}
            </form>}
            {draft.sets.length > 0 && <StrengthSets sets={draft.sets} editingIndex={draft.editingIndex} onEdit={editSet} disabled={saving} />}
          </>}
        </div>
        {draft && <footer className="strength-dialog-footer">
          {confirmCancel ? <>
            <strong>Удалить черновик?</strong>
            <button type="button" className="strength-button strength-text-button" onClick={() => setConfirmCancel(false)}>Оставить</button>
            <button type="button" className="strength-button strength-text-button strength-danger" onClick={cancel}>Удалить</button>
          </> : <>
            <button type="button" className="strength-button strength-text-button" disabled={saving}
              onClick={() => setConfirmCancel(true)}>Отменить тренировку</button>
            <button type="button" className="strength-button strength-primary" disabled={saving || !draft.sets.length}
              onClick={() => void finish()}><Check size={18} aria-hidden="true" /> {saving ? "Сохраняется…" : "Завершить"}</button>
          </>}
        </footer>}
      </div>}
    </dialog>
  </>;
}
