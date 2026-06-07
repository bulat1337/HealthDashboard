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
import { updatePartnerMoneyData } from "../api";
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
  onPartnerMoneyUpdated?: () => Promise<void> | void;
};

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

export function MoneyDashboard({ money, onPartnerMoneyUpdated }: MoneyDashboardProps) {
  const [partnerForm, setPartnerForm] = useState({
    partnerMoney: inputValue(money.partnerMoney),
    partnerCreditCardDebt: inputValue(money.partnerCreditCardDebt)
  });
  const [partnerSaveStatus, setPartnerSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [partnerSaveError, setPartnerSaveError] = useState<string | null>(null);

  useEffect(() => {
    setPartnerForm({
      partnerMoney: inputValue(money.partnerMoney),
      partnerCreditCardDebt: inputValue(money.partnerCreditCardDebt)
    });
  }, [money.partnerMoney, money.partnerCreditCardDebt]);

  function updatePartnerField(field: keyof typeof partnerForm, value: string) {
    setPartnerForm((current) => ({ ...current, [field]: value }));
    setPartnerSaveStatus("idle");
    setPartnerSaveError(null);
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
      await onPartnerMoneyUpdated?.();
      setPartnerSaveStatus("saved");
    } catch (error) {
      setPartnerSaveStatus("idle");
      setPartnerSaveError(error instanceof Error ? error.message : String(error));
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
              <span>
                {money.summary.recordCount} срезов · {formatDateShort(money.summary.firstDateIso)} -{" "}
                {formatDateShort(money.summary.lastDateIso)}
              </span>
            </div>
            <div className="headline-value">
              <strong>{formatMoney(latest.totalAmount)}</strong>
              <span>{formatMoneyDelta(money.summary.totalChange)} за период</span>
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
            <div>
              <dt>Деньги партнера</dt>
              <dd>{formatMoney(money.partnerMoney)}</dd>
            </div>
            <div>
              <dt>Долг партнера</dt>
              <dd>{formatMoney(money.partnerCreditCardDebt)}</dd>
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
