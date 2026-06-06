import type { LucideIcon } from "lucide-react";
import {
  CalendarDays,
  CalendarHeart,
  Camera,
  Flower2,
  Heart,
  HeartHandshake,
  Milestone,
  NotebookTabs,
  Sparkles,
  Timer
} from "lucide-react";
import relationshipDemoPhotoUrl from "../assets/relationship-demo.svg";
import { formatNumber } from "../stats";

type RelationshipDashboardProps = {
  today: Date;
};

type RelationshipTile = {
  label: string;
  value: string;
  detail: string;
  icon: LucideIcon;
  tone: "rose" | "gold" | "blue" | "green";
};

function parseLocalDate(value: string | undefined, fallback: string) {
  const match = (value?.trim() || fallback).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return parseLocalDate(fallback, "2024-01-01");
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

const RELATIONSHIP_TITLE = import.meta.env.VITE_RELATIONSHIP_TITLE?.trim() || "Relationship";
const RELATIONSHIP_PHOTO_CAPTION =
  import.meta.env.VITE_RELATIONSHIP_PHOTO_CAPTION?.trim() || "Demo milestone";
const RELATIONSHIP_PHOTO_URL =
  import.meta.env.VITE_RELATIONSHIP_PHOTO_URL?.trim() || relationshipDemoPhotoUrl;
const RELATIONSHIP_START = parseLocalDate(import.meta.env.VITE_RELATIONSHIP_START, "2024-01-01");
const PHOTO_DATE = parseLocalDate(import.meta.env.VITE_RELATIONSHIP_PHOTO_DATE, "2024-05-20");
const DAY_MS = 24 * 60 * 60 * 1000;

function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function daysBetween(startDate: Date, endDate: Date) {
  return Math.max(
    0,
    Math.floor((startOfLocalDay(endDate).getTime() - startOfLocalDay(startDate).getTime()) / DAY_MS)
  );
}

function russianDayLabel(days: number) {
  const lastTwo = days % 100;
  const last = days % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return "дней";
  if (last === 1) return "день";
  if (last >= 2 && last <= 4) return "дня";
  return "дней";
}

function russianYearLabel(years: number) {
  const lastTwo = years % 100;
  const last = years % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return "лет";
  if (last === 1) return "год";
  if (last >= 2 && last <= 4) return "года";
  return "лет";
}

function fullYearsSince(startDate: Date, referenceDate: Date) {
  let years = referenceDate.getFullYear() - startDate.getFullYear();
  const hasAnniversaryPassed =
    referenceDate.getMonth() > startDate.getMonth() ||
    (referenceDate.getMonth() === startDate.getMonth() && referenceDate.getDate() >= startDate.getDate());
  if (!hasAnniversaryPassed) years -= 1;
  return Math.max(0, years);
}

function nextAnniversary(referenceDate: Date) {
  const currentYear = referenceDate.getFullYear();
  const anniversary = new Date(currentYear, RELATIONSHIP_START.getMonth(), RELATIONSHIP_START.getDate());
  if (startOfLocalDay(anniversary).getTime() >= startOfLocalDay(referenceDate).getTime()) return anniversary;
  return new Date(currentYear + 1, RELATIONSHIP_START.getMonth(), RELATIONSHIP_START.getDate());
}

function previousAnniversary(referenceDate: Date) {
  const next = nextAnniversary(referenceDate);
  return new Date(next.getFullYear() - 1, RELATIONSHIP_START.getMonth(), RELATIONSHIP_START.getDate());
}

function formatLongDate(date: Date) {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric"
  }).format(date);
}

export function RelationshipDashboard({ today }: RelationshipDashboardProps) {
  const relationshipDays = daysBetween(RELATIONSHIP_START, today);
  const relationshipYears = relationshipDays / 365.2425;
  const fullYears = fullYearsSince(RELATIONSHIP_START, today);
  const nextDate = nextAnniversary(today);
  const previousDate = previousAnniversary(today);
  const daysToAnniversary = daysBetween(today, nextDate);
  const anniversarySpan = Math.max(1, daysBetween(previousDate, nextDate));
  const anniversaryPassed = daysBetween(previousDate, today);
  const anniversaryProgress = Math.min(100, Math.max(0, (anniversaryPassed / anniversarySpan) * 100));

  const tiles: RelationshipTile[] = [
    {
      label: "Вместе",
      value: relationshipDays.toLocaleString("ru-RU"),
      detail: russianDayLabel(relationshipDays),
      icon: HeartHandshake,
      tone: "rose"
    },
    {
      label: "Полных лет",
      value: fullYears.toLocaleString("ru-RU"),
      detail: russianYearLabel(fullYears),
      icon: Sparkles,
      tone: "gold"
    },
    {
      label: "До годовщины",
      value: daysToAnniversary.toLocaleString("ru-RU"),
      detail: russianDayLabel(daysToAnniversary),
      icon: CalendarDays,
      tone: "blue"
    },
    {
      label: "Фото",
      value: formatLongDate(PHOTO_DATE),
      detail: RELATIONSHIP_PHOTO_CAPTION,
      icon: Camera,
      tone: "green"
    }
  ];

  return (
    <div className="relationship-page">
      <section className="relationship-hero-grid" aria-label="Раздел отношений">
        <article className="panel relationship-photo-panel">
          <div className="relationship-photo-frame">
            <img src={RELATIONSHIP_PHOTO_URL} alt={RELATIONSHIP_TITLE} />
            <div className="relationship-photo-caption">
              <Camera size={18} />
              <span>{RELATIONSHIP_PHOTO_CAPTION} · {formatLongDate(PHOTO_DATE)}</span>
            </div>
          </div>
        </article>

        <article className="panel relationship-story-panel">
          <div className="section-kicker relationship-kicker">
            <CalendarHeart size={18} />
            <span>Отношения</span>
          </div>

          <div className="relationship-title-block">
            <h2>{RELATIONSHIP_TITLE}</h2>
            <p>Вместе с {formatLongDate(RELATIONSHIP_START)}</p>
          </div>

          <div className="relationship-big-counter" aria-label={`В отношениях ${relationshipDays} ${russianDayLabel(relationshipDays)}`}>
            <Heart className="relationship-counter-heart" size={30} />
            <strong>{relationshipDays.toLocaleString("ru-RU")}</strong>
            <span>{russianDayLabel(relationshipDays)} в отношениях</span>
          </div>

          <dl className="relationship-story-list">
            <div>
              <dt>Рядом</dt>
              <dd>{formatNumber(relationshipYears, 1)} года</dd>
            </div>
            <div>
              <dt>Следующая годовщина</dt>
              <dd>{formatLongDate(nextDate)}</dd>
            </div>
          </dl>
        </article>
      </section>

      <section className="quick-metrics relationship-metrics" aria-label="Метрики отношений">
        {tiles.map((tile) => {
          const Icon = tile.icon;
          return (
            <article className={`metric-tile relationship-tile tone-${tile.tone}`} key={tile.label}>
              <Icon size={20} />
              <span className="tile-label">{tile.label}</span>
              <strong>{tile.value}</strong>
              <small>{tile.detail}</small>
            </article>
          );
        })}
      </section>

      <section className="relationship-bottom-grid">
        <article className="panel relationship-progress-panel">
          <div className="panel-heading compact">
            <div>
              <h2>Год отношений</h2>
              <span>
                {formatLongDate(previousDate)} - {formatLongDate(nextDate)}
              </span>
            </div>
            <Timer size={22} />
          </div>

          <div className="relationship-progress">
            <div className="relationship-progress-track" aria-label="Прогресс до следующей годовщины">
              <span style={{ width: `${anniversaryProgress}%` }} />
            </div>
            <div className="relationship-progress-labels">
              <strong>{formatNumber(anniversaryProgress, 0)}%</strong>
              <span>
                {daysToAnniversary} {russianDayLabel(daysToAnniversary)} до годовщины
              </span>
            </div>
          </div>
        </article>

        <article className="panel relationship-timeline-panel">
          <div className="panel-heading compact">
            <div>
              <h2>Опорные даты</h2>
              <span>личная временная шкала</span>
            </div>
            <NotebookTabs size={22} />
          </div>

          <div className="relationship-timeline">
            <div className="relationship-timeline-item">
              <span>
                <Milestone size={18} />
              </span>
              <div>
                <strong>{formatLongDate(RELATIONSHIP_START)}</strong>
                <p>начало отношений</p>
              </div>
            </div>
            <div className="relationship-timeline-item">
              <span>
                <Flower2 size={18} />
              </span>
              <div>
                <strong>{formatLongDate(PHOTO_DATE)}</strong>
                <p>{RELATIONSHIP_PHOTO_CAPTION}</p>
              </div>
            </div>
            <div className="relationship-timeline-item">
              <span>
                <CalendarHeart size={18} />
              </span>
              <div>
                <strong>{formatLongDate(nextDate)}</strong>
                <p>следующая годовщина</p>
              </div>
            </div>
          </div>
        </article>
      </section>
    </div>
  );
}
