// Money.md defines the balances and fixed scheduled contributions.
export const savingsColumns = ['Накопления Булата, руб', 'Накопления Дианы, руб'];
export const roundMoney = value => Math.round(value);
const fields = line => line.trim().slice(1, -1).split('|').map(value => value.trim());
export function readSavingsPlan(text) {
  const startDate = text.match(/Начало раздельного учёта:\s*(\d{4}-\d{2}-\d{2})/)?.[1];
  if (!startDate) {
    if (text.includes('Начало раздельного учёта')) throw new Error('Укажите дату начала раздельного учёта в формате YYYY-MM-DD.');
    return null;
  }
  if (!validDate(startDate)) throw new Error('Некорректная дата начала раздельного учёта.');
  const lines = text.split(/\r?\n/);
  function table(marker) {
    const index = lines.findIndex(line => line.trim().startsWith('|') && line.includes(marker));
    if (index < 0) throw new Error(`Money.md: отсутствует таблица ${marker}.`);
    const rows = [];
    for (let i = index + 2; i < lines.length && lines[i].trim().startsWith('|'); i++) {
      const cells = fields(lines[i]);
      if (cells[0]) rows.push(cells);
    }
    return rows;
  }
  const participants = table('Базовые накопления').map(row => {
    const id = row[0] === 'Булат' ? 'bulat' : row[0] === 'Диана' ? 'diana' : null;
    const income = amount(row[1]), monthlySavings = amount(row[2]), baseSavings = amount(row[4]);
    const paydays = row[3].split(',').map(Number);
    if (!id || income === null || monthlySavings === null || baseSavings === null ||
      income < monthlySavings || monthlySavings < 0 || baseSavings < 0 || paydays.length !== 2 ||
      new Set(paydays).size !== 2 || paydays.some(day => !Number.isInteger(day) || day < 1 || day > 30)) {
      throw new Error('Money.md: проверьте доходы, накопления и дни зарплаты.');
    }
    return {id, name: row[0], income, monthlySavings, baseSavings, paydays};
  });
  if (participants.length !== 2 || new Set(participants.map(p => p.id)).size !== 2) {
    throw new Error('Money.md: нужны отдельные правила Булата и Дианы.');
  }
  const exceptions = table('Правило пополнения').map(row => {
    const participant = participants.find(p => p.name === row[1]);
    const income = amount(row[2]);
    const fixed = amount(row[3]);
    if (!validDate(row[0]) || !participant || (income !== null && income < 0) ||
      fixed === null || fixed < 0) {
      throw new Error('Money.md: некорректное переходное начисление.');
    }
    return {dateIso: row[0], participantId: participant.id, income,
      rule: row[3], savingsAmount: fixed};
  });
  if (new Set(exceptions.map(e => `${e.participantId}:${e.dateIso}`)).size !== exceptions.length) {
    throw new Error('Money.md: переходные начисления повторяются.');
  }
  return {startDate, participants, exceptions};
}

function amount(value) {
  if (!value || ['—', '-'].includes(value)) return null;
  const n = Number(value.replace(/['’\s]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? roundMoney(n) : null;
}
function validDate(iso) {
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) && Number.isFinite(Date.parse(iso)) && new Date(iso).toISOString().slice(0,10) === iso;
}

const manualMarker = /<!-- money-manual-adjustments: ([\s\S]*?) -->/g;

export function readMoneyManualAdjustments(text) {
  const matches = [...text.matchAll(manualMarker)];
  if (!matches.length) return {version: 1, savings: [], rent: []};
  if (matches.length !== 1) throw new Error('Money.md: повторяются ручные поправки.');
  const state = JSON.parse(matches[0][1]);
  if (state.version !== 1 || !Array.isArray(state.savings) || !Array.isArray(state.rent) ||
    state.savings.some(e => !['bulat', 'diana'].includes(e.participantId) || !validDate(e.dateIso) ||
      !Number.isSafeInteger(e.amount) || e.amount < 0 || !Array.isArray(e.handledDates) ||
      e.handledDates.some(date => !validDate(date))) ||
    state.rent.some(e => !validDate(e.dateIso) || (e.rentPaid !== null && typeof e.rentPaid !== 'boolean'))) {
    throw new Error('Money.md: некорректные ручные поправки.');
  }
  return state;
}

// The snapshot editor sends every field. Only actual changes create overrides.
export function recordMoneyManualChanges(text, plan, original, update) {
  const state = readMoneyManualAdjustments(text);
  const dateIso = update.dateIso ?? original.dateIso;
  if (!validDate(dateIso)) throw new Error('Некорректная дата ручной поправки.');
  let changed = false;
  if (plan && dateIso >= plan.startDate) {
    const through = new Date(`${dateIso}T00:00:00Z`);
    through.setUTCDate(through.getUTCDate() + 2);
    const upcoming = savingsEvents(plan, through.toISOString().slice(0,10));
    for (const participantId of ['bulat', 'diana']) {
      const key = participantId === 'bulat' ? 'bulatSavings' : 'dianaSavings';
      if (typeof update[key] !== 'number' || update[key] === original[key]) continue;
      const existing = state.savings.find(e => e.participantId === participantId && e.dateIso === dateIso);
      const event = upcoming.find(e => e.participantId === participantId && e.dateIso > dateIso && e.savingsAmount > 0);
      const handledDates = [...new Set([...(existing?.handledDates ?? []), ...(event ? [event.dateIso] : [])])];
      state.savings = state.savings.filter(e => e !== existing);
      state.savings.push({participantId, dateIso, amount: update[key], handledDates});
      changed = true;
    }
  }
  if (update.rentPaid !== undefined && update.rentPaid !== original.rentPaid) {
    state.rent = state.rent.filter(e => e.dateIso !== dateIso);
    state.rent.push({dateIso, rentPaid: update.rentPaid});
    changed = true;
  }
  if (!changed) return text;
  const marker = `<!-- money-manual-adjustments: ${JSON.stringify(state)} -->`;
  if ([...text.matchAll(manualMarker)].length) return text.replace(manualMarker, () => marker);
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  return `${text.trimEnd()}${newline}${newline}${marker}${newline}`;
}

export function moneyRentPaid(adjustments, targetDate) {
  const manual = adjustments.rent.filter(e => e.dateIso <= targetDate && e.dateIso.slice(0,7) === targetDate.slice(0,7))
    .sort((a,b) => b.dateIso.localeCompare(a.dateIso))[0];
  const day = Number(targetDate.slice(8));
  return manual?.rentPaid ?? !(day >= 10 && day <= 18);
}

export function savingsEvents(plan, throughDate) {
  if (!validDate(throughDate)) throw new Error('Некорректная дата расчёта накоплений.');
  const events = plan.exceptions.filter(e => e.dateIso < plan.startDate).map(e => ({...e, transition: true}));
  const start = new Date(`${plan.startDate}T00:00:00Z`);
  const end = new Date(`${throughDate}T00:00:00Z`);
  for (let year = start.getUTCFullYear(), month = start.getUTCMonth(); Date.UTC(year, month, 1) <= end.getTime();) {
    for (const participant of plan.participants) {
      for (const day of participant.paydays) {
        // Day 30 means the last day in a shorter month.
        const actualDay = Math.min(day, new Date(Date.UTC(year, month + 1, 0)).getUTCDate());
        const dateIso = new Date(Date.UTC(year, month, actualDay)).toISOString().slice(0,10);
        if (dateIso < plan.startDate || dateIso > throughDate) continue;
        const exception = plan.exceptions.find(e => e.participantId === participant.id && e.dateIso === dateIso);
        events.push(exception ? {...exception, transition: true} : {dateIso, participantId: participant.id,
          income: participant.income / 2, savingsAmount: participant.monthlySavings / 2, rule: '', transition: false});
      }
    }
    month++; if (month === 12) {year++; month = 0;}
  }
  // Explicit transitions may have a date outside the normal salary calendar.
  for (const exception of plan.exceptions) {
    if (exception.dateIso >= plan.startDate && exception.dateIso <= throughDate &&
      !events.some(e => e.participantId === exception.participantId && e.dateIso === exception.dateIso)) {
      events.push({...exception, transition: true});
    }
  }
  return events.filter(e => e.dateIso <= throughDate).sort((a,b) => a.dateIso.localeCompare(b.dateIso));
}

export function calculateSavings(plan, records, targetDate, adjustments = {savings: []}) {
  if (targetDate < plan.startDate) throw new Error('Дата предшествует началу раздельного учёта.');
  const events = savingsEvents(plan, targetDate);
  const values = {};
  for (const participant of plan.participants) {
    const key = participant.id === 'bulat' ? 'bulatSavings' : 'dianaSavings';
    const manual = adjustments.savings.filter(e => e.participantId === participant.id && e.dateIso >= plan.startDate && e.dateIso <= targetDate)
      .sort((a,b) => b.dateIso.localeCompare(a.dateIso))[0];
    const previous = [...records].filter(r => r.dateIso >= plan.startDate && r.dateIso <= targetDate && typeof r[key] === 'number')
      .sort((a,b) => b.dateIso.localeCompare(a.dateIso))[0];
    values[key] = manual?.amount ?? previous?.[key] ?? participant.baseSavings;
    const since = manual?.dateIso ?? previous?.dateIso;
    for (const event of events) {
      if (event.participantId !== participant.id || (since && event.dateIso <= since) || manual?.handledDates.includes(event.dateIso)) continue;
      values[key] += event.savingsAmount;
    }
  }
  return values;
}

export function savingsOverview(plan, records, today, adjustments) {
  const balances = calculateSavings(plan, records, today, adjustments);
  return {...plan, ...balances, monthlyIncome: plan.participants.reduce((n,p) => n + p.income,0),
    monthlySavings: plan.participants.reduce((n,p) => n + p.monthlySavings,0)};
}
