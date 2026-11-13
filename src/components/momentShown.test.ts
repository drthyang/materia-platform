import { describe, expect, it } from "vitest";
import { momentShown } from "@/components/KSearchPanel";

describe("a moment amplitude as its field shows it at rest", () => {
  it("keeps four decimals of a refined value", () => {
    expect(momentShown(0.4150031234567)).toBe(0.415);
    expect(momentShown(-1.23456789)).toBe(-1.2346);
  });
  it("leaves a short value as typed", () => {
    expect(momentShown(2)).toBe(2);
    expect(momentShown(0.1)).toBe(0.1);
    expect(momentShown(0)).toBe(0);
  });
  it("passes a non-finite value through", () => {
    expect(momentShown(Number.NaN)).toBeNaN();
  });
});
