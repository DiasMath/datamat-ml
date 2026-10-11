import { test } from "node:test";
import assert from "node:assert/strict";
import { calendarDay, displayDate } from "../src/domain/dates";

test("history filters and displayed dates agree around midnight in Sao Paulo", () => {
  assert.equal(calendarDay("2026-10-10T02:59:59Z"), "2026-10-09");
  assert.equal(calendarDay("2026-10-10T03:00:00Z"), "2026-10-10");
  assert.equal(displayDate("2026-10-10T02:59:59Z"), "09/10/2026");
});
test("date-only deadlines remain the same calendar day across browser timezones", () => {
  assert.equal(calendarDay("2026-10-10"), "2026-10-10");
  assert.equal(displayDate("2026-10-10"), "10/10/2026");
  assert.equal(displayDate(null), "Sem prazo");
});
