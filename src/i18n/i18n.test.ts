import { describe, expect, it } from "vitest";

import { defaultLocale, resolveLocale } from "./config";
import { formatDate, formatNumber, formatRating } from "./format";
import { getMessages } from "./messages";

function keys(value: object, prefix = ""): string[] {
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix === "" ? key : `${prefix}.${key}`;
    return typeof child === "object" && child !== null
      ? keys(child, path)
      : [path];
  });
}

describe("internationalization", () => {
  it("uses Spanish by default and for invalid locale values", () => {
    expect(defaultLocale).toBe("es");
    expect(resolveLocale(undefined)).toBe("es");
    expect(resolveLocale("fr")).toBe("es");
    expect(resolveLocale("en")).toBe("en");
  });

  it("keeps Spanish and English translation structures aligned", () => {
    expect(keys(getMessages("en"))).toEqual(keys(getMessages("es")));
  });

  it("formats product dates, numbers, and ratings for the active locale", () => {
    expect(formatDate("2026-08-29T18:00:00.000Z", "es")).toContain("2026");
    expect(formatNumber(1234.5, "es")).not.toBe(formatNumber(1234.5, "en"));
    expect(formatRating(8.7, "es")).toBe("8,7");
    expect(formatRating(8.7, "en")).toBe("8.7");
  });
});
