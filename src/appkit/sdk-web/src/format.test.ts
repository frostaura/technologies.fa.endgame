import { describe, expect, it } from "vitest";
import { checkDateInput, checkNumberInput, dateInputValue, formatDate, formatDateTime, formatNumber } from "./format.js";

/**
 * R7-1: a built app's preview card formatted a `datetime-local` value the browser let through — a six-digit year such as
 * "202612-12-12T08:00", typed into the field's year segment — with `Intl.DateTimeFormat(...).format(new Date(value))`, which
 * throws `RangeError: Invalid time value`; the throw unmounted the whole app. The kit's helpers never throw.
 */
describe("formatting never throws", () => {
  it("formats a real date and time", () => {
    expect(formatDateTime("2026-12-12T08:00:00Z", { locale: "en-GB", timeZone: "UTC" })).toBe("12 Dec 2026, 08:00");
    expect(formatDate("2026-12-12", { locale: "en-GB" })).toBe("12 Dec 2026");
    expect(formatDateTime(new Date(Date.UTC(2026, 11, 12, 8)), { locale: "en-GB", timeZone: "UTC" })).toBe("12 Dec 2026, 08:00");
  });

  it("reads a datetime-local value as the local time a person typed", () => {
    expect(formatDateTime("2026-12-12T08:00", { locale: "en-GB" })).toBe("12 Dec 2026, 08:00");
  });

  it.each([
    ["a six-digit year a date field lets through", "202612-12-12T08:00"],
    ["the largest year an input takes", "275760-09-13T00:00"],
    ["no year at all", "-12-12"],
    ["words", "next Tuesday"],
    ["an empty field", ""],
    ["nothing", null],
    ["nothing yet", undefined],
    ["a day that is not in its month", "2026-02-31T08:00"],
    ["year zero", "0000-01-01"],
    ["an invalid Date", new Date(Number.NaN)],
    ["a number out of the Date range", 8.65e15],
  ])("formats %s to the fallback", (_, value) => {
    expect(formatDateTime(value)).toBe("No date yet");
    expect(formatDate(value)).toBe("No date yet");
    expect(formatDateTime(value, { fallback: "Pick a date" })).toBe("Pick a date");
  });

  it("falls back when the formatter itself refuses its options", () => {
    expect(formatDateTime("2026-12-12T08:00:00Z", { timeZone: "Not/AZone" })).toBe("No date yet");
    expect(formatNumber(3, { maximumFractionDigits: 200 })).toBe("No number yet");
  });

  it("formats numbers, and an unusable one to the fallback", () => {
    expect(formatNumber(1234.5, { locale: "en-GB" })).toBe("1,234.5");
    expect(formatNumber("42", { locale: "en-GB" })).toBe("42");
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, "", "  ", "abc", null, undefined]) expect(formatNumber(bad)).toBe("No number yet");
    expect(formatNumber(Number.NaN, { fallback: "—" })).toBe("—");
  });
});

describe("checking what a person typed, before it is sent", () => {
  const limits = { min: "2000-01-01T00:00", max: "2099-12-31T23:59" };

  it("answers the date for a value inside the limits", () => {
    const checked = checkDateInput("2026-12-12T08:00", limits);
    expect(checked.error).toBeNull();
    expect(checked.date?.getFullYear()).toBe(2026);
    expect(checkDateInput("", limits)).toEqual({ date: null, error: null });
  });

  it.each([
    ["202612-12-12T08:00", "Enter a date between 1 Jan 2000 and 31 Dec 2099."],
    ["1999-12-31T23:59", "Enter a date between 1 Jan 2000 and 31 Dec 2099."],
    ["2026-02-31T08:00", "Enter a real date."],
    ["soon", "Enter a real date."],
  ])("refuses %s with a field error", (value, error) => {
    expect(checkDateInput(value, { ...limits, locale: "en-GB" })).toEqual({ date: null, error });
  });

  it("asks for a date when one is required", () => {
    expect(checkDateInput("", { ...limits, required: true }).error).toBe("Enter a date.");
  });

  it("refuses a year past 9999 even without limits", () => {
    expect(checkDateInput("202612-12-12").error).toBe("Enter a real date.");
  });

  it("checks numbers against their limits", () => {
    expect(checkNumberInput("12", { min: 0, max: 100 })).toEqual({ value: 12, error: null });
    expect(checkNumberInput("", { min: 0, max: 100 })).toEqual({ value: null, error: null });
    expect(checkNumberInput("", { required: true }).error).toBe("Enter a number.");
    expect(checkNumberInput("99999999999999999999", { min: 0, max: 100, locale: "en-GB" }).error).toBe("Enter a number from 0 to 100.");
    expect(checkNumberInput("2.5", { min: 0, max: 10, whole: true }).error).toBe("Enter a whole number.");
    expect(checkNumberInput("abc").error).toBe("Enter a number.");
  });

  it("writes a Date as an input's value, for min, max and a default", () => {
    expect(dateInputValue(new Date(2026, 11, 12, 8, 5), "datetime-local")).toBe("2026-12-12T08:05");
    expect(dateInputValue(new Date(2026, 11, 12), "date")).toBe("2026-12-12");
    expect(dateInputValue(new Date(Number.NaN), "date")).toBe("");
  });
});
