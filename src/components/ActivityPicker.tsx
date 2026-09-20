import { Check, Plus, Search, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { SportActivityKey } from "../types";

export type ActivityOption = {
  key: SportActivityKey;
  label: string;
  color: string;
  Icon: LucideIcon;
};

type ActivityPickerProps = {
  options: ActivityOption[];
  selected: SportActivityKey[];
  disabled: boolean;
  onToggle: (key: SportActivityKey) => void;
};

/** A bounded, searchable catalogue; only recorded activities occupy the day. */
export function ActivityPicker({
  options,
  selected,
  disabled,
  onToggle,
}: ActivityPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const id = useId();
  const results = options.filter((option) =>
    option.label
      .toLocaleLowerCase("ru")
      .includes(query.trim().toLocaleLowerCase("ru")),
  );
  const selectedOptions = options.filter((option) =>
    selected.includes(option.key),
  );

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  function close() {
    setOpen(false);
    setQuery("");
    triggerRef.current?.focus();
  }

  return (
    <div className="activity-picker">
      {selectedOptions.length > 0 && (
        <ul className="selected-activities" aria-label="Записанные занятия">
          {selectedOptions.map(({ key, label, color, Icon }) => (
            <li key={key}>
              <Icon size={18} style={{ color }} aria-hidden="true" />
              <span>{label}</span>
              <button
                type="button"
                className="activity-remove"
                disabled={disabled}
                aria-label={`Убрать: ${label}`}
                onClick={() => {
                  // Move focus before the saved row disappears.
                  triggerRef.current?.focus();
                  onToggle(key);
                }}
              >
                <X size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <button
        ref={triggerRef}
        type="button"
        className="activity-add"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <Plus size={18} aria-hidden="true" /> Добавить занятие
      </button>
      {open && (
        <section
          id={id}
          className="activity-catalogue"
          aria-label="Выбор занятий"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              close();
            }
          }}
        >
          <div className="activity-search">
            <Search size={18} aria-hidden="true" />
            <input
              ref={inputRef}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Найти занятие"
              aria-label="Найти занятие"
              autoComplete="off"
            />
          </div>
          <div
            className="activity-options"
            role="group"
            aria-label="Виды занятий"
          >
            {results.map(({ key, label, color, Icon }) => (
              <button
                key={key}
                type="button"
                aria-pressed={selected.includes(key)}
                disabled={disabled}
                onClick={() => onToggle(key)}
              >
                <Icon size={18} style={{ color }} aria-hidden="true" />
                <span>{label}</span>
                {selected.includes(key) ? (
                  <Check size={18} aria-hidden="true" />
                ) : (
                  <Plus size={16} aria-hidden="true" />
                )}
              </button>
            ))}
            {results.length === 0 && <p role="status">Ничего не найдено</p>}
          </div>
          <button type="button" className="activity-done" onClick={close}>
            Готово
          </button>
        </section>
      )}
    </div>
  );
}
