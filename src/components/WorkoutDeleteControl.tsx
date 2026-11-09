import { useState } from "react";
import { RefreshCw, Trash2 } from "lucide-react";
import type { SportUser } from "../types";

export function WorkoutDeleteControl({ wholeDay = false, hasFitbit, fitbit, disabled, onDelete, onConnect }: {
  wholeDay?: boolean;
  hasFitbit: boolean;
  fitbit?: SportUser["fitbit"];
  disabled: boolean;
  onDelete: (deleteFromFitbit: boolean) => Promise<void>;
  onConnect: () => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [alsoFitbit, setAlsoFitbit] = useState(false);
  const [busy, setBusy] = useState(false);
  const needsPermission = alsoFitbit && !fitbit?.canDeleteWorkouts;
  async function submit() {
    setBusy(true);
    try {
      if (needsPermission) await onConnect();
      else { await onDelete(alsoFitbit); setConfirming(false); }
    } catch {
      // The parent displays the actionable error and retains the current records.
    } finally { setBusy(false); }
  }
  if (!confirming) return <button type="button" className="sport-delete-button"
    disabled={disabled} onClick={() => setConfirming(true)}>
    <Trash2 size={16} aria-hidden="true" />{wholeDay ? "Очистить день" : "Удалить тренировку"}
  </button>;
  return <div className="sport-delete-confirm" role="group" aria-label={wholeDay ? "Очистка дня" : "Удаление тренировки"}>
    <strong>{wholeDay ? "Очистить все отметки и тренировки за день?" : "Удалить эту тренировку из календаря?"}</strong>
    {hasFitbit && <>
      <p>Удалённые тренировки больше не загрузятся из Fitbit.</p>
      <label><input type="checkbox" checked={alsoFitbit} disabled={disabled || busy}
        onChange={(event) => setAlsoFitbit(event.target.checked)} />Также удалить из Fitbit</label>
      {needsPermission && <p>{fitbit?.canConnect
        ? "Разрешите удаление в Fitbit, затем повторите действие после подключения."
        : "Сначала подключите Fitbit в разделе «Здоровье»."}</p>}
    </>}
    <div className="sport-delete-actions">
      <button type="button" className="sport-delete-button" disabled={disabled || busy || (needsPermission && !fitbit?.canConnect)}
        onClick={() => void submit()}>
        {busy ? <RefreshCw className="spin" size={16} aria-hidden="true" /> : <Trash2 size={16} aria-hidden="true" />}
        {busy ? "Подождите…" : needsPermission ? "Разрешить в Fitbit" : alsoFitbit ? "Удалить везде" : wholeDay ? "Очистить календарь" : "Удалить из календаря"}
      </button>
      <button type="button" className="disclosure-button" disabled={disabled || busy} onClick={() => setConfirming(false)}>Отмена</button>
    </div>
  </div>;
}
