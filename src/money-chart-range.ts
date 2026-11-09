const DAY_MS = 86_400_000;

/** Calendar months ending on the latest snapshot, clamped to the data extent. */
export function moneyChartRange(firstTime: number, lastTime: number, months: number | null) {
  const minTime = firstTime === lastTime ? firstTime - DAY_MS : firstTime;
  const maxTime = firstTime === lastTime ? lastTime + DAY_MS : lastTime;
  const start = new Date(maxTime);
  if (months !== null) {
    const day = start.getUTCDate();
    start.setUTCDate(1);
    start.setUTCMonth(start.getUTCMonth() - months);
    const lastDay = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate();
    start.setUTCDate(Math.min(day, lastDay));
  }
  const span = months === null ? maxTime - minTime : Math.min(maxTime - minTime, maxTime - start.getTime());
  return { minTime, maxTime, span, maxStart: maxTime - span };
}
