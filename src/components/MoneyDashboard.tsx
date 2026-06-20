import type { CSSProperties, FormEvent } from "react";
import { useEffect, useState } from "react";
import {
  Banknote,
  CalendarClock,
  CircleAlert,
  CreditCard,
  LineChart,
  Landmark,
  PiggyBank,
  Save,
  Smartphone,
  Wallet
} from "lucide-react";
import { updateMoneySliceData, type MoneySliceUpdateInput } from "../api";
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
  onMoneyUpdated?: () => Promise<void> | void;
};

type MoneySliceAmountField =
  | "totalAmount"
  | "freeAmount"
  | "investmentAmount"
  | "reserveAmount"
  | "creditCardDebt"
  | "partnerMoney"
  | "partnerCreditCardDebt";

type MoneySliceEditableField = MoneySliceAmountField | "rentPaid";

type MoneySliceForm = Record<MoneySliceAmountField, string> & {
  rentPaid: "yes" | "no" | "";
};

type MoneySliceInput = {
  key: MoneySliceAmountField;
  label: string;
};

const MONEY_TILES: MoneyTile[] = [
  { key: "totalAmount", label: "Общая сумма", icon: Landmark, tone: "blue" },
  { key: "freeAmount", label: "Свободная", icon: Wallet, tone: "green" },
  { key: "investmentAmount", label: "Инвестиции", icon: LineChart, tone: "teal" },
  { key: "reserveAmount", label: "Несгораемая", icon: PiggyBank, tone: "amber" },
  { key: "creditCardDebt", label: "Кредитки", icon: CreditCard, tone: "red" }
];

const MONEY_SLICE_INPUTS: MoneySliceInput[] = [
  { key: "totalAmount", label: "Общая" },
  { key: "freeAmount", label: "Свободная" },
  { key: "investmentAmount", label: "Инвестиции" },
  { key: "reserveAmount", label: "Резерв" },
  { key: "creditCardDebt", label: "Кредитки" },
  { key: "partnerMoney", label: "Деньги партнера" },
  { key: "partnerCreditCardDebt", label: "Долг партнера" }
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

function rentPaidInputValue(value: boolean | null | undefined): MoneySliceForm["rentPaid"] {
  if (value === true) return "yes";
  if (value === false) return "no";
  return "";
}

function moneySliceFormFromData(money: MoneyData): MoneySliceForm {
  const latest = money.latestRecord;
  return {
    totalAmount: inputValue(latest?.totalAmount),
    freeAmount: inputValue(latest?.freeAmount),
    investmentAmount: inputValue(latest?.investmentAmount),
    reserveAmount: inputValue(latest?.reserveAmount),
    creditCardDebt: inputValue(latest?.creditCardDebt),
    partnerMoney: inputValue(money.partnerMoney),
    partnerCreditCardDebt: inputValue(money.partnerCreditCardDebt),
    rentPaid: rentPaidInputValue(latest?.rentPaid)
  };
}

function parseDraftMoneyValue(value: string) {
  const normalized = value
    .replace(/₽/g, "")
    .replace(/\s/g, "")
    .replace(/'/g, "")
    .replace(",", ".");
  if (!normalized || normalized === "-") return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

function formatDraftMoneyValue(value: number) {
  return String(Math.round(value));
}

function isMoneySliceFieldVisible(field: MoneySliceAmountField, money: MoneyData, latest: MoneyRecord) {
  if (field === "investmentAmount") return latest.investmentAmount !== null;
  if (field === "reserveAmount") return latest.reserveAmount !== null;
  if (field === "creditCardDebt") return latest.creditCardDebt !== null;
  if (field === "partnerMoney") return money.partnerMoney !== null;
  if (field === "partnerCreditCardDebt") return money.partnerCreditCardDebt !== null && latest.creditCardDebt !== null;
  return true;
}

function formMoneyValue(
  form: MoneySliceForm,
  field: MoneySliceAmountField,
  money: MoneyData,
  latest: MoneyRecord
) {
  const parsed = parseDraftMoneyValue(form[field]);
  if (parsed !== null) return parsed;
  return isMoneySliceFieldVisible(field, money, latest) ? null : 0;
}

function rentPaidFromForm(form: MoneySliceForm) {
  if (form.rentPaid === "yes") return true;
  if (form.rentPaid === "no") return false;
  return null;
}

function recalculateMoneySliceForm(
  form: MoneySliceForm,
  changedField: MoneySliceEditableField,
  money: MoneyData
): MoneySliceForm {
  const latest = money.latestRecord;
  if (!latest) return form;

  const totalAmount = formMoneyValue(form, "totalAmount", money, latest);
  const freeAmount = formMoneyValue(form, "freeAmount", money, latest);
  const investmentAmount = formMoneyValue(form, "investmentAmount", money, latest);
  const reserveAmount = formMoneyValue(form, "reserveAmount", money, latest);
  const creditCardDebt = formMoneyValue(form, "creditCardDebt", money, latest);
  const partnerMoney = formMoneyValue(form, "partnerMoney", money, latest);
  const rentPaid = rentPaidFromForm(form);

  if (
    totalAmount === null ||
    freeAmount === null ||
    investmentAmount === null ||
    reserveAmount === null ||
    creditCardDebt === null ||
    partnerMoney === null
  ) {
    return form;
  }

  const unpaidRent = rentPaid === false ? money.rentMonthly ?? 0 : 0;
  const lockedAmount = reserveAmount + creditCardDebt + partnerMoney + unpaidRent;
  if (changedField === "freeAmount" || changedField === "investmentAmount") {
    return {
      ...form,
      totalAmount: formatDraftMoneyValue(freeAmount + investmentAmount + lockedAmount)
    };
  }

  return {
    ...form,
    freeAmount: formatDraftMoneyValue(totalAmount - investmentAmount - lockedAmount)
  };
}

function parseMoneyInput(value: string, label: string, options: { allowNegative?: boolean } = {}) {
  const normalized = value
    .replace(/₽/g, "")
    .replace(/\s/g, "")
    .replace(/'/g, "")
    .replace(",", ".");
  if (!normalized) throw new Error(`${label}: укажите сумму.`);
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) throw new Error(`${label}: укажите число.`);
  if (!options.allowNegative && parsed < 0) throw new Error(`${label}: значение должно быть 0 или больше.`);
  return Math.round(parsed);
}

export function MoneyDashboard({ money, onMoneyUpdated }: MoneyDashboardProps) {
  const [sliceForm, setSliceForm] = useState(() => moneySliceFormFromData(money));
  const [sliceChangedField, setSliceChangedField] = useState<MoneySliceEditableField | null>(null);
  const [sliceSaveStatus, setSliceSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [sliceSaveError, setSliceSaveError] = useState<string | null>(null);

  useEffect(() => {
    setSliceForm(moneySliceFormFromData(money));
    setSliceChangedField(null);
    setSliceSaveStatus("idle");
    setSliceSaveError(null);
  }, [
    money.latestRecord?.totalAmount,
    money.latestRecord?.freeAmount,
    money.latestRecord?.investmentAmount,
    money.latestRecord?.reserveAmount,
    money.latestRecord?.creditCardDebt,
    money.latestRecord?.rentPaid,
    money.partnerMoney,
    money.partnerCreditCardDebt
  ]);

  function updateSliceAmountField(field: MoneySliceAmountField, value: string) {
    setSliceForm((current) => {
      const next = { ...current, [field]: value };
      if (field === "partnerCreditCardDebt") {
        const previousPartnerDebt = parseDraftMoneyValue(current.partnerCreditCardDebt);
        const nextPartnerDebt = parseDraftMoneyValue(value);
        const currentCreditDebt = parseDraftMoneyValue(current.creditCardDebt);
        if (previousPartnerDebt !== null && nextPartnerDebt !== null && currentCreditDebt !== null) {
          next.creditCardDebt = formatDraftMoneyValue(currentCreditDebt + nextPartnerDebt - previousPartnerDebt);
        }
      }
      return recalculateMoneySliceForm(next, field, money);
    });
    setSliceChangedField(field);
    setSliceSaveStatus("idle");
    setSliceSaveError(null);
  }

  function updateSliceRentPaid(value: MoneySliceForm["rentPaid"]) {
    setSliceForm((current) => recalculateMoneySliceForm({ ...current, rentPaid: value }, "rentPaid", money));
    setSliceChangedField("rentPaid");
    setSliceSaveStatus("idle");
    setSliceSaveError(null);
  }

  async function saveSliceValues(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const latest = money.latestRecord;
    if (!latest) return;

    setSliceSaveStatus("saving");
    setSliceSaveError(null);

    try {
      const visibleInputs = MONEY_SLICE_INPUTS.filter((input) => isMoneySliceFieldVisible(input.key, money, latest));
      const nextValues: MoneySliceUpdateInput = {
        changedField: sliceChangedField ?? undefined
      };

      for (const input of visibleInputs) {
        nextValues[input.key] = parseMoneyInput(sliceForm[input.key], input.label, {
          allowNegative: input.key === "freeAmount"
        });
      }

      if (sliceForm.rentPaid) {
        nextValues.rentPaid = sliceForm.rentPaid === "yes";
      }

      await updateMoneySliceData(nextValues);
      await onMoneyUpdated?.();
      setSliceSaveStatus("saved");
    } catch (error) {
      setSliceSaveStatus("idle");
      setSliceSaveError(error instanceof Error ? error.message : String(error));
    }
  }

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

  const latest = money.latestRecord;
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

  const compositionSegments = buildCompositionSegments(money, latest);
  const compositionTotal = compositionSegments.reduce((sum, segment) => sum + segment.value, 0);
  const latestRows = money.records.slice(-6).reverse();
  const preSync = money.sync.preSync;
  const moneyPeriodLabel = formatMoneyPeriodLabel(money.summary.firstDateIso, money.summary.lastDateIso);
  const initialSliceForm = moneySliceFormFromData(money);
  const visibleSliceInputs = MONEY_SLICE_INPUTS.filter((input) => isMoneySliceFieldVisible(input.key, money, latest));
  const canEditRent = latest.rentPaid !== null;
  const sliceFormChanged =
    visibleSliceInputs.some((input) => sliceForm[input.key] !== initialSliceForm[input.key]) ||
    (canEditRent && sliceForm.rentPaid !== initialSliceForm.rentPaid);

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

          <MoneyTrendChart records={money.records} />

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
              <span>{formatDateShort(latest.dateIso)}</span>
            </div>
            <div className="money-date-badge">
              <Banknote size={18} />
              <strong>{formatMoney(latest.freeAmount)}</strong>
            </div>
          </div>

          <div className="money-composition">
            <div className="composition-track" aria-label="Распределение последнего среза">
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

          <form className="money-slice-form" onSubmit={saveSliceValues}>
            <div className="money-slice-heading">
              <strong>Редактировать срез</strong>
              <span>Сохраняются в Money.md</span>
            </div>
            <div className="money-slice-fields">
              {visibleSliceInputs.map((input) => (
                <label className="money-input-control" key={input.key}>
                  <span>{input.label}</span>
                  <span className="money-input-shell">
                    <input
                      type="text"
                      inputMode="decimal"
                      value={sliceForm[input.key]}
                      onChange={(event) => updateSliceAmountField(input.key, event.target.value)}
                      aria-label={input.label}
                    />
                    <span>₽</span>
                  </span>
                </label>
              ))}
            </div>
            {canEditRent ? (
              <fieldset className="money-rent-toggle">
                <legend>Аренда заплачена</legend>
                <div>
                  <button
                    type="button"
                    className={sliceForm.rentPaid === "yes" ? "active" : ""}
                    aria-pressed={sliceForm.rentPaid === "yes"}
                    onClick={() => updateSliceRentPaid("yes")}
                  >
                    Да
                  </button>
                  <button
                    type="button"
                    className={sliceForm.rentPaid === "no" ? "active" : ""}
                    aria-pressed={sliceForm.rentPaid === "no"}
                    onClick={() => updateSliceRentPaid("no")}
                  >
                    Нет
                  </button>
                </div>
              </fieldset>
            ) : null}
            <div className="money-slice-actions">
              <span className={`money-slice-status ${sliceSaveError ? "error" : ""}`} role="status">
                {sliceSaveError ?? (sliceSaveStatus === "saved" ? "Сохранено" : "")}
              </span>
              <button
                className="money-save-button"
                type="submit"
                disabled={sliceSaveStatus === "saving" || !sliceFormChanged}
              >
                <Save size={15} />
                <span>{sliceSaveStatus === "saving" ? "Сохранение" : "Сохранить"}</span>
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
              <h2>Последние срезы</h2>
              <span>
                Обновлено {formatDateTime(money.sourceMtimeMs ? new Date(money.sourceMtimeMs).toISOString() : null)}
              </span>
            </div>
          </div>

          <div className="money-table-wrap">
            <table className="money-table">
              <thead>
                <tr>
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
                {latestRows.map((record) => (
                  <tr key={record.rowId}>
                    <td>{record.date}</td>
                    <td>{formatMoney(record.totalAmount)}</td>
                    <td>{formatMoney(record.freeAmount)}</td>
                    <td>{formatMoney(record.investmentAmount)}</td>
                    <td>{formatMoney(record.reserveAmount)}</td>
                    <td>{formatMoney(record.creditCardDebt)}</td>
                    <td>{rentPaidLabel(record.rentPaid)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      </section>
    </>
  );
}
