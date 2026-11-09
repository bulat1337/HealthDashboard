import assert from "node:assert/strict";
import test from "node:test";
import { moneyChartRange } from "../src/money-chart-range.js";
const time = (date: string) => Date.parse(`${date}T00:00:00Z`);

test("money chart month windows respect month ends and leap years", () => {
  assert.equal(moneyChartRange(time("2025-01-01"), time("2026-03-31"), 1).maxStart, time("2026-02-28"));
  assert.equal(moneyChartRange(time("2023-01-01"), time("2024-03-31"), 1).maxStart, time("2024-02-29"));
  for (const [months, expected] of [[1, "2026-10-09"], [3, "2026-08-09"], [6, "2026-05-09"], [12, "2025-11-09"]] as const) {
    assert.equal(moneyChartRange(time("2024-01-01"), time("2026-11-09"), months).maxStart, time(expected));
  }
});
test("money chart all-time and oversized windows cover every record", () => {
  for (const months of [null, 6, 12]) {
    const range = moneyChartRange(time("2026-10-01"), time("2026-11-09"), months);
    assert.equal(range.maxStart, time("2026-10-01"));
    assert.equal(range.span, time("2026-11-09") - time("2026-10-01"));
  }
});
test("a single snapshot retains a finite, nonzero chart window", () => {
  for (const months of [null, 1, 3, 6, 12]) {
    const range = moneyChartRange(time("2026-11-09"), time("2026-11-09"), months);
    assert.equal(range.span, 2 * 86_400_000);
    assert.equal(range.maxStart, range.minTime);
  }
});
