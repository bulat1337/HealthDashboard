import type { CSSProperties, FormEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Banknote,
  CalendarClock,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  CreditCard,
  LineChart,
  Landmark,
  Pencil,
  PiggyBank,
  Save,
  Smartphone,
  Wallet,
  X
} from "lucide-react";
import { updateMoneyRecordData, updatePartnerMoneyData } from "../api";
import { formatDateShort, formatDateTime, formatNumber } from "../stats";
import type { MoneyData, MoneyRecord } from "../types";
import { MONEY_SERIES, MoneyTrendChart } from "./MoneyTrendChart";

type MoneyKey = "totalAmount" | "freeAmount" | "investmentAmount" | "reserveAmount" | "creditCardDebt";

type MoneyTile = {
  key: MoneyKey;
  label: string;
  icon: typeof Wallet;
  tone: "blue" | "green" | "teal" | "amber" | "red";
};

type CompositionSegment = {
  label: string;
  value: number;
  color: string;
};

type MoneyDashboardProps = {
  money: MoneyData;
  onMoneyDataUpdated?: () => Promise<void> | void;
};

type RentPaidFormValue = "unknown" | "yes" | "no";

type MoneyRecordForm = {
  dateIso: string;
  totalAmount: string;
  freeAmount: string;
  investmentAmount: string;
  reserveAmount: string;
  creditCardDebt: string;
  rentPaid: RentPaidFormValue;
};

type MoneyRecordAmountField = Exclude<keyof MoneyRecordForm, "dateIso" | "rentPaid">;

const MONEY_TILES: MoneyTile[] = [
  { key: "totalAmount", label: "Общая сумма", icon: Landmark, tone: "blue" },
  { key: "freeAmount", label: "Свободная", icon: Wallet, tone: "green" },
  { key: "investmentAmount", label: "Инвестиции", icon: LineChart, tone: "teal" },
  { key: "reserveAmount", label: "Несгораемая", icon: PiggyBank, tone: "amber" },
  { key: "creditCardDebt", label: "Кредитки", icon: CreditCard, tone: "red" }
];

function formatMoney(value: number | null | undefined) {
  return `${formatNumber(value, 0)} ₽`;
}

function formatMoneyDelta(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${formatNumber(value, 0)} ₽`;
}

function formatMoneyPeriodLabel(firstDateIso: string | null | undefined, lastDateIso: string | null | undefined) {
  const firstDate = formatDateShort(firstDateIso);
  const lastDate = formatDateShort(lastDateIso);
  if (firstDate === "—" || lastDate === "—") return "за период";
  if (firstDate === lastDate) return `за ${lastDate}`;
  return `с ${firstDate} по ${lastDate}`;
}

function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${formatNumber(value * 100, 1)}%`;
}

function recordDelta(latest: MoneyRecord | null, previous: MoneyRecord | null, key: MoneyKey) {
  const latestValue = latest?.[key];
  const previousValue = previous?.[key];
  if (typeof latestValue !== "number" || typeof previousValue !== "number") return null;
  return latestValue - previousValue;
}

function daysLabel(days: number) {
  if (days === 0) return "сегодня";
  if (days === 1) return "завтра";
  if (days > 1) return `через ${days} д`;
  return `${Math.abs(days)} д назад`;
}

function rentPaidLabel(value: boolean | null) {
  if (value === true) return "да";
  if (value === false) return "нет";
  return "—";
}

function buildCompositionSegments(money: MoneyData, latest: MoneyRecord): CompositionSegment[] {
  const segments: CompositionSegment[] = [
    { label: "Свободно", value: Math.max(0, latest.freeAmount ?? 0), color: "#15803d" },
    { label: "Инвестиции", value: Math.max(0, latest.investmentAmount ?? 0), color: "#0f766e" },
    { label: "Несгораемая", value: Math.max(0, latest.reserveAmount ?? 0), color: "#f59e0b" },
    { label: "Деньги партнера", value: Math.max(0, money.partnerMoney ?? 0), color: "#64748b" },
    { label: "Кредитки", value: Math.max(0, latest.creditCardDebt ?? 0), color: "#dc2626" }
  ];

  if (latest.rentPaid === false && money.rentMonthly) {
    segments.push({ label: "Аренда", value: money.rentMonthly, color: "#7c3aed" });
  }

  return segments.filter((segment) => segment.value > 0);
}

function syncStatusLabel(status: MoneyData["sync"]["status"]) {
  if (status === "running") return "идет обновление";
  if (status === "ok") return "обновлено";
  if (status === "error") return "ошибка";
  if (status === "disabled") return "выключено";
  return "ожидание";
}

function inputValue(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

function parseMoneyInput(value: string, label: string) {
  const normalized = value.replace(/\s/g, "").replace(",", ".");
  if (!normalized) throw new Error(`${label}: укажите сумму.`);
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) throw new Error(`${label}: укажите число.`);
  if (parsed < 0) throw new Error(`${label}: значение должно быть 0 или больше.`);
  return Math.round(parsed);
}

function rentPaidFormValue(value: boolean | null | undefined): RentPaidFormValue {
  if (value === true) return "yes";
  if (value === false) return "no";
  return "unknown";
}

function moneyRecordFormValue(record: MoneyRecord | null | undefined): MoneyRecordForm {
  return {
    dateIso: record?.dateIso ?? "",
    totalAmount: inputValue(record?.totalAmount),
    freeAmount: inputValue(record?.freeAmount),
    investmentAmount: inputValue(record?.investmentAmount),
    reserveAmount: inputValue(record?.reserveAmount),
    creditCardDebt: inputValue(record?.creditCardDebt),
    rentPaid: rentPaidFormValue(record?.rentPaid)
  };
}

function parseOptionalMoneyInput(value: string, label: string) {
  const normalized = value.replace(/['’\s]/g, "").replace(",", ".");
  if (!normalized) return null;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) throw new Error(`${label}: укажите число.`);
  if (Math.abs(parsed) > 1_000_000_000_000) throw new Error(`${label}: значение слишком большое.`);
  return Math.round(parsed);
}

function parseRentPaidFormValue(value: RentPaidFormValue) {
  if (value === "yes") return true;
  if (value === "no") return false;
  return null;
}

function parseRecordDraftAmount(value: string) {
  const normalized = value
    .replace(/₽/g, "")
    .replace(/['’\s]/g, "")
    .replace(",", ".");
  if (!normalized || normalized === "-") return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

function recordDraftAmount(form: MoneyRecordForm, field: MoneyRecordAmountField) {
  return parseRecordDraftAmount(form[field]) ?? 0;
}

function formatRecordDraftAmount(value: number) {
  return String(Math.round(value));
}

function unpaidRentFromForm(form: MoneyRecordForm, rentMonthly: number | null) {
  return parseRentPaidFormValue(form.rentPaid) === false ? rentMonthly ?? 0 : 0;
}

function recalculateMoneyRecordForm(
  form: MoneyRecordForm,
  changedField: keyof MoneyRecordForm,
  money: MoneyData
) {
  if (changedField === "dateIso") return form;

  const freeAmount = recordDraftAmount(form, "freeAmount");
  const investmentAmount = recordDraftAmount(form, "investmentAmount");
  const reserveAmount = recordDraftAmount(form, "reserveAmount");
  const creditCardDebt = recordDraftAmount(form, "creditCardDebt");
  const partnerMoney = money.partnerMoney ?? 0;
  const unpaidRent = unpaidRentFromForm(form, money.rentMonthly);

  if (changedField === "freeAmount") {
    return {
      ...form,
      totalAmount: formatRecordDraftAmount(
        freeAmount + investmentAmount + reserveAmount + creditCardDebt + partnerMoney + unpaidRent
      )
    };
  }

  const totalAmount = recordDraftAmount(form, "totalAmount");
  return {
    ...form,
    freeAmount: formatRecordDraftAmount(
      totalAmount - investmentAmount - reserveAmount - creditCardDebt - partnerMoney - unpaidRent
    )
  };
}

function formChanged(current: MoneyRecordForm, original: MoneyRecordForm) {
  return (Object.keys(current) as (keyof MoneyRecordForm)[]).some((key) => current[key] !== original[key]);
}

export function MoneyDashboard({ money, onMoneyDataUpdated }: MoneyDashboardProps) {
  const latest = money.latestRecord;
  const [partnerForm, setPartnerForm] = useState({
    partnerMoney: inputValue(money.partnerMoney),
    partnerCreditCardDebt: inputValue(money.partnerCreditCardDebt)
  });
  const [partnerSaveStatus, setPartnerSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [partnerSaveError, setPartnerSaveError] = useState<string | null>(null);
  const [showAllRecords, setShowAllRecords] = useState(false);
  const [selectedRecordId, setSelectedRecordId] = useState<number | null>(latest?.rowId ?? null);
  const [editingRecordId, setEditingRecordId] = useState<number | null>(null);
  const [scrollTargetId, setScrollTargetId] = useState<number | null>(null);
  const selectedRecordRef = useRef<HTMLTableRowElement | null>(null);
  const selectedRecord = useMemo(() => {
    if (selectedRecordId === null) return latest;
    return money.records.find((record) => record.rowId === selectedRecordId) ?? latest;
  }, [latest, money.records, selectedRecordId]);
  const [recordForm, setRecordForm] = useState<MoneyRecordForm>(() => moneyRecordFormValue(selectedRecord));
  const [recordSaveStatus, setRecordSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [recordSaveError, setRecordSaveError] = useState<string | null>(null);

  useEffect(() => {
    setPartnerForm({
      partnerMoney: inputValue(money.partnerMoney),
      partnerCreditCardDebt: inputValue(money.partnerCreditCardDebt)
    });
  }, [money.partnerMoney, money.partnerCreditCardDebt]);

  useEffect(() => {
    setSelectedRecordId((current) => {
      if (current !== null && money.records.some((record) => record.rowId === current)) return current;
      return latest?.rowId ?? null;
    });
  }, [latest?.rowId, money.records]);

  useEffect(() => {
    setRecordForm(moneyRecordFormValue(selectedRecord));
    setRecordSaveStatus("idle");
    setRecordSaveError(null);
  }, [
    selectedRecord?.rowId,
    selectedRecord?.dateIso,
    selectedRecord?.totalAmount,
    selectedRecord?.freeAmount,
    selectedRecord?.investmentAmount,
    selectedRecord?.reserveAmount,
    selectedRecord?.creditCardDebt,
    selectedRecord?.rentPaid
  ]);

  useEffect(() => {
    if (scrollTargetId === null || selectedRecord?.rowId !== scrollTargetId) return;
    selectedRecordRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    setScrollTargetId(null);
  }, [scrollTargetId, selectedRecord?.rowId, showAllRecords]);

  function updatePartnerField(field: keyof typeof partnerForm, value: string) {
    setPartnerForm((current) => ({ ...current, [field]: value }));
    setPartnerSaveStatus("idle");
    setPartnerSaveError(null);
  }

  function updateRecordField<Key extends keyof MoneyRecordForm>(field: Key, value: MoneyRecordForm[Key]) {
    setRecordForm((current) => recalculateMoneyRecordForm({ ...current, [field]: value }, field, money));
    setRecordSaveStatus("idle");
    setRecordSaveError(null);
  }

  function selectMoneyRecord(record: MoneyRecord, options?: { revealAll?: boolean; scroll?: boolean }) {
    setSelectedRecordId(record.rowId);
    setEditingRecordId(null);
    setRecordSaveStatus("idle");
    setRecordSaveError(null);
    if (options?.revealAll) setShowAllRecords(true);
    if (options?.scroll) setScrollTargetId(record.rowId);
  }

  function editMoneyRecord(record: MoneyRecord) {
    setSelectedRecordId(record.rowId);
    setEditingRecordId(record.rowId);
    setRecordForm(moneyRecordFormValue(record));
    setRecordSaveStatus("idle");
    setRecordSaveError(null);
  }

  async function savePartnerValues(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPartnerSaveStatus("saving");
    setPartnerSaveError(null);

    try {
      const nextValues = {
        partnerMoney: parseMoneyInput(partnerForm.partnerMoney, "Деньги партнера"),
        partnerCreditCardDebt: parseMoneyInput(partnerForm.partnerCreditCardDebt, "Долг партнера")
      };
      await updatePartnerMoneyData(nextValues);
      await onMoneyDataUpdated?.();
      setPartnerSaveStatus("saved");
    } catch (error) {
      setPartnerSaveStatus("idle");
      setPartnerSaveError(error instanceof Error ? error.message : String(error));
    }
  }

  async function saveMoneyRecord(record: MoneyRecord) {
    setRecordSaveStatus("saving");
    setRecordSaveError(null);

    try {
      if (!recordForm.dateIso) throw new Error("Дата: укажите дату.");
      await updateMoneyRecordData(record.rowId, {
        dateIso: recordForm.dateIso,
        totalAmount: parseOptionalMoneyInput(recordForm.totalAmount, "Общая сумма"),
        freeAmount: parseOptionalMoneyInput(recordForm.freeAmount, "Свободная сумма"),
        investmentAmount: parseOptionalMoneyInput(recordForm.investmentAmount, "Инвестиции"),
        reserveAmount: parseOptionalMoneyInput(recordForm.reserveAmount, "Несгораемая сумма"),
        creditCardDebt: parseOptionalMoneyInput(recordForm.creditCardDebt, "Долг по кредиткам"),
        rentPaid: parseRentPaidFormValue(recordForm.rentPaid)
      });
      await onMoneyDataUpdated?.();
      setEditingRecordId(null);
      setRecordSaveStatus("saved");
    } catch (error) {
      setRecordSaveStatus("idle");
      setRecordSaveError(error instanceof Error ? error.message : String(error));
    }
  }

  const partnerFormChanged =
    partnerForm.partnerMoney !== inputValue(money.partnerMoney) ||
    partnerForm.partnerCreditCardDebt !== inputValue(money.partnerCreditCardDebt);

  if (money.status !== "ready") {
    return (
      <section className="panel money-empty-panel">
        <CircleAlert size={28} />
        <div>
          <h2>Деньги недоступны</h2>
          <p>
            Источник: {money.sourceFile}. {money.lastLoadError ?? "Файл пока не найден сервером."}
          </p>
        </div>
      </section>
    );
  }

  if (!latest) {
    return (
      <section className="panel money-empty-panel">
        <CircleAlert size={28} />
        <div>
          <h2>В Money.md нет строк</h2>
          <p>Сервер прочитал файл, таблица денег пока пустая.</p>
        </div>
      </section>
    );
  }

  const activeRecord = selectedRecord ?? latest;
  const visibleRows = showAllRecords ? [...money.records].reverse() : money.records.slice(-6).reverse();
  const compositionSegments = buildCompositionSegments(money, activeRecord);
  const compositionTotal = compositionSegments.reduce((sum, segment) => sum + segment.value, 0);
  const preSync = money.sync.preSync;
  const moneyPeriodLabel = formatMoneyPeriodLabel(money.summary.firstDateIso, money.summary.lastDateIso);

  return (
    <>
      <section className="quick-metrics money-metrics" aria-label="Денежные метрики">
        {MONEY_TILES.map((tile) => {
          const Icon = tile.icon;
          const value = latest[tile.key];
          const delta = recordDelta(latest, money.previousRecord, tile.key);
          return (
            <article className={`metric-tile money-tile tone-${tile.tone}`} key={tile.key}>
              <Icon size={20} />
              <span className="tile-label">{tile.label}</span>
              <strong>{formatMoney(value)}</strong>
              <small>{formatMoneyDelta(delta)} к прошлому срезу</small>
            </article>
          );
        })}
      </section>

      <section className={`money-sync-strip ${preSync.configured ? "ready" : "needs-setup"}`}>
        {preSync.configured ? <Smartphone size={20} /> : <CircleAlert size={20} />}
        <div>
          <strong>
            {preSync.configured ? "Мобильный запуск ZenMoney подключен" : "Мобильный запуск ZenMoney отсутствует"}
          </strong>
          <span>
            {preSync.configured
              ? `${syncStatusLabel(money.sync.status)} · ожидание ${Math.round(preSync.waitMs / 1000)} сек`
              : "ZENMONEY_PRE_SYNC_URL или ZENMONEY_PRE_SYNC_COMMAND ждёт настройки на VaioServer"}
          </span>
        </div>
      </section>

      <section className="main-grid money-grid">
        <article className="panel chart-panel">
          <div className="panel-heading">
            <div>
              <h2>Денежная динамика</h2>
            </div>
            <div className="headline-value">
              <strong>{formatMoney(latest.totalAmount)}</strong>
              <span>
                {formatMoneyDelta(money.summary.totalChange)} {moneyPeriodLabel}
              </span>
            </div>
          </div>

          <MoneyTrendChart
            records={money.records}
            selectedRecordId={activeRecord.rowId}
            onRecordSelect={(record) => selectMoneyRecord(record, { revealAll: true, scroll: true })}
          />

          <div className="legend-row money-legend">
            {MONEY_SERIES.map((series) => (
              <span key={series.key}>
                <i className="legend-line" style={{ borderTopColor: series.color }} /> {series.label}
              </span>
            ))}
          </div>
        </article>

        <aside className="panel analysis-panel money-analysis">
          <div className="panel-heading compact">
            <div>
              <h2>Срез</h2>
              <span>
                {formatDateShort(activeRecord.dateIso)} · строка #{activeRecord.rowId}
              </span>
            </div>
            <div className="money-date-badge">
              <Banknote size={18} />
              <strong>{formatMoney(activeRecord.freeAmount)}</strong>
            </div>
          </div>

          <div className="money-composition">
            <div className="composition-track" aria-label="Распределение выбранного среза">
              {compositionSegments.map((segment) => (
                <span
                  key={segment.label}
                  className="composition-segment"
                  title={`${segment.label}: ${formatMoney(segment.value)}`}
                  style={
                    {
                      "--segment-color": segment.color,
                      "--segment-width": `${(segment.value / Math.max(1, compositionTotal)) * 100}%`
                    } as CSSProperties
                  }
                />
              ))}
            </div>
            <div className="composition-list">
              {compositionSegments.map((segment) => (
                <div key={segment.label}>
                  <span>
                    <i style={{ background: segment.color }} /> {segment.label}
                  </span>
                  <strong>{formatMoney(segment.value)}</strong>
                </div>
              ))}
            </div>
          </div>

          <form className="money-partner-form" onSubmit={savePartnerValues}>
            <div className="money-partner-heading">
              <strong>Ручные суммы партнера</strong>
              <span>Сохраняются в Money.md</span>
            </div>
            <div className="money-partner-fields">
              <label className="money-input-control">
                <span>Деньги партнера</span>
                <span className="money-input-shell">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={partnerForm.partnerMoney}
                    onChange={(event) => updatePartnerField("partnerMoney", event.target.value)}
                    aria-label="Деньги партнера"
                  />
                  <span>₽</span>
                </span>
              </label>
              <label className="money-input-control">
                <span>Долг партнера</span>
                <span className="money-input-shell">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={partnerForm.partnerCreditCardDebt}
                    onChange={(event) => updatePartnerField("partnerCreditCardDebt", event.target.value)}
                    aria-label="Долг партнера"
                  />
                  <span>₽</span>
                </span>
              </label>
            </div>
            <div className="money-partner-actions">
              <span className={`money-partner-status ${partnerSaveError ? "error" : ""}`} role="status">
                {partnerSaveError ?? (partnerSaveStatus === "saved" ? "Сохранено" : "")}
              </span>
              <button
                className="money-save-button"
                type="submit"
                disabled={partnerSaveStatus === "saving" || !partnerFormChanged}
              >
                <Save size={15} />
                <span>{partnerSaveStatus === "saving" ? "Сохранение" : "Сохранить"}</span>
              </button>
            </div>
          </form>

          <dl className="stats-list money-stats-list">
            <div>
              <dt>Свободная доля</dt>
              <dd>{formatPercent(money.summary.freeShare)}</dd>
            </div>
            <div>
              <dt>Инвест. доля</dt>
              <dd>{formatPercent(money.summary.investmentShare)}</dd>
            </div>
            <div>
              <dt>Долг / сумма</dt>
              <dd>{formatPercent(money.summary.debtToTotalShare)}</dd>
            </div>
            <div>
              <dt>Доход / мес</dt>
              <dd>{formatMoney(money.monthlyIncome)}</dd>
            </div>
            <div>
              <dt>Аренда</dt>
              <dd>{formatMoney(money.rentMonthly)}</dd>
            </div>
          </dl>
        </aside>
      </section>

      <section className="money-bottom-grid">
        <article className="panel money-events-panel">
          <div className="panel-heading compact">
            <div>
              <h2>Кредитные события</h2>
              <span>Ближайшие даты из Money.md</span>
            </div>
            <CalendarClock size={22} />
          </div>

          <div className="event-list">
            {money.upcomingEvents.length > 0 ? (
              money.upcomingEvents.map((event) => (
                <div className="event-row" key={event.rowId}>
                  <div>
                    <strong>{event.bank}</strong>
                    <span>{event.title}</span>
                  </div>
                  <time dateTime={event.dateIso}>
                    {formatDateShort(event.dateIso)}
                    <small>{daysLabel(event.daysFromToday)}</small>
                  </time>
                </div>
              ))
            ) : (
              <p className="muted-line">Будущие события не указаны.</p>
            )}
          </div>
        </article>

        <article className="panel money-history-panel">
          <div className="panel-heading compact">
            <div>
              <h2>{showAllRecords ? "Все срезы" : "Последние срезы"}</h2>
              <span>
                Показано {visibleRows.length} из {money.records.length} · обновлено{" "}
                {formatDateTime(money.sourceMtimeMs ? new Date(money.sourceMtimeMs).toISOString() : null)}
              </span>
            </div>
            <button
              className="money-secondary-button"
              type="button"
              onClick={() => {
                if (showAllRecords) {
                  setEditingRecordId(null);
                  setRecordSaveStatus("idle");
                  setRecordSaveError(null);
                }
                setShowAllRecords((current) => !current);
              }}
              aria-expanded={showAllRecords}
            >
              {showAllRecords ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
              <span>{showAllRecords ? "Свернуть" : "Все срезы"}</span>
            </button>
          </div>

          <div className="money-table-wrap">
            <table className="money-table">
              <thead>
                <tr>
                  <th>Действия</th>
                  <th>Дата</th>
                  <th>Общая</th>
                  <th>Свободная</th>
                  <th>Инвестиции</th>
                  <th>Резерв</th>
                  <th>Кредитки</th>
                  <th>Аренда</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((record) => {
                  const isSelected = record.rowId === activeRecord.rowId;
                  const isEditing = record.rowId === editingRecordId;
                  const rowFormChanged = isEditing && formChanged(recordForm, moneyRecordFormValue(record));
                  const rowClassName = [isSelected ? "selected" : "", isEditing ? "editing" : ""]
                    .filter(Boolean)
                    .join(" ");
                  return (
                    <tr
                      key={record.rowId}
                      ref={isSelected ? selectedRecordRef : null}
                      className={rowClassName || undefined}
                      onClick={() => {
                        if (!isEditing) selectMoneyRecord(record);
                      }}
                    >
                      <td>
                        <div className="money-table-actions">
                          {isEditing ? (
                            <>
                              <button
                                className="money-icon-action"
                                type="button"
                                title="Сбросить"
                                aria-label={`Сбросить срез ${record.date}`}
                                disabled={recordSaveStatus === "saving"}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setRecordForm(moneyRecordFormValue(record));
                                  setEditingRecordId(null);
                                  setRecordSaveStatus("idle");
                                  setRecordSaveError(null);
                                }}
                              >
                                <X size={15} />
                              </button>
                              <button
                                className="money-icon-action primary"
                                type="button"
                                title="Сохранить"
                                aria-label={`Сохранить срез ${record.date}`}
                                disabled={recordSaveStatus === "saving" || !rowFormChanged}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  saveMoneyRecord(record);
                                }}
                              >
                                <Save size={15} />
                              </button>
                            </>
                          ) : (
                            <button
                              className="money-icon-action"
                              type="button"
                              title="Редактировать"
                              aria-label={`Редактировать срез ${record.date}`}
                              onClick={(event) => {
                                event.stopPropagation();
                                editMoneyRecord(record);
                              }}
                            >
                              <Pencil size={15} />
                            </button>
                          )}
                        </div>
                      </td>
                      <td>
                        {isEditing ? (
                          <span className="money-table-input-shell">
                            <input
                              type="date"
                              value={recordForm.dateIso}
                              onClick={(event) => event.stopPropagation()}
                              onChange={(event) => updateRecordField("dateIso", event.target.value)}
                              aria-label={`Дата среза ${record.date}`}
                            />
                          </span>
                        ) : (
                          <button
                            className="money-row-button"
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              selectMoneyRecord(record);
                            }}
                          >
                            <span>{record.date}</span>
                          </button>
                        )}
                      </td>
                      <td>
                        {isEditing ? (
                          <span className="money-table-input-shell">
                            <input
                              type="text"
                              inputMode="decimal"
                              value={recordForm.totalAmount}
                              onClick={(event) => event.stopPropagation()}
                              onChange={(event) => updateRecordField("totalAmount", event.target.value)}
                              aria-label={`Общая сумма среза ${record.date}`}
                            />
                            <span>₽</span>
                          </span>
                        ) : (
                          formatMoney(record.totalAmount)
                        )}
                      </td>
                      <td>
                        {isEditing ? (
                          <span className="money-table-input-shell">
                            <input
                              type="text"
                              inputMode="decimal"
                              value={recordForm.freeAmount}
                              onClick={(event) => event.stopPropagation()}
                              onChange={(event) => updateRecordField("freeAmount", event.target.value)}
                              aria-label={`Свободная сумма среза ${record.date}`}
                            />
                            <span>₽</span>
                          </span>
                        ) : (
                          formatMoney(record.freeAmount)
                        )}
                      </td>
                      <td>
                        {isEditing ? (
                          <span className="money-table-input-shell">
                            <input
                              type="text"
                              inputMode="decimal"
                              value={recordForm.investmentAmount}
                              onClick={(event) => event.stopPropagation()}
                              onChange={(event) => updateRecordField("investmentAmount", event.target.value)}
                              aria-label={`Инвестиции среза ${record.date}`}
                            />
                            <span>₽</span>
                          </span>
                        ) : (
                          formatMoney(record.investmentAmount)
                        )}
                      </td>
                      <td>
                        {isEditing ? (
                          <span className="money-table-input-shell">
                            <input
                              type="text"
                              inputMode="decimal"
                              value={recordForm.reserveAmount}
                              onClick={(event) => event.stopPropagation()}
                              onChange={(event) => updateRecordField("reserveAmount", event.target.value)}
                              aria-label={`Несгораемая сумма среза ${record.date}`}
                            />
                            <span>₽</span>
                          </span>
                        ) : (
                          formatMoney(record.reserveAmount)
                        )}
                      </td>
                      <td>
                        {isEditing ? (
                          <span className="money-table-input-shell">
                            <input
                              type="text"
                              inputMode="decimal"
                              value={recordForm.creditCardDebt}
                              onClick={(event) => event.stopPropagation()}
                              onChange={(event) => updateRecordField("creditCardDebt", event.target.value)}
                              aria-label={`Долг по кредиткам в срезе ${record.date}`}
                            />
                            <span>₽</span>
                          </span>
                        ) : (
                          formatMoney(record.creditCardDebt)
                        )}
                      </td>
                      <td>
                        {isEditing ? (
                          <span className="money-table-input-shell money-table-select-shell">
                            <select
                              value={recordForm.rentPaid}
                              onClick={(event) => event.stopPropagation()}
                              onChange={(event) => updateRecordField("rentPaid", event.target.value as RentPaidFormValue)}
                              aria-label={`Аренда заплачена в срезе ${record.date}`}
                            >
                              <option value="unknown">—</option>
                              <option value="yes">да</option>
                              <option value="no">нет</option>
                            </select>
                          </span>
                        ) : (
                          rentPaidLabel(record.rentPaid)
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {recordSaveError || recordSaveStatus === "saved" ? (
            <div className={`money-table-status ${recordSaveError ? "error" : ""}`} role="status">
              {recordSaveError ?? "Срез сохранен"}
            </div>
          ) : null}
        </article>
      </section>
    </>
  );
}
