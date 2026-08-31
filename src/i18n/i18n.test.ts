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

function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (typeof value !== "object" || value === null) return [];
  return Object.values(value).flatMap(strings);
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

  it("keeps accented Spanish copy readable across product surfaces", () => {
    const messages = getMessages("es");

    expect(messages.players.introduction).toBe(
      "La calificación de la afición a lo largo de los partidos publicados.",
    );
    expect(messages.players.unranked).toBe("Aún sin ranking");
    expect(messages.home.introduction).toContain("técnico");
    expect(messages.home.introduction).toContain("calificación");
    expect(messages.matches.introduction).toContain("Próximos");
    expect(messages.results.players).toBe("Clasificación de jugadores");
    expect(messages.navigation.label).toBe("Navegación principal");
    expect(messages.ballot.ratingLabel).toContain("Calificación");
  });

  it("contains no known mojibake markers in localized messages", () => {
    const markers = ["\u00c3", "\u00c2", "\ufffd", "\u00e2\u20ac"];

    for (const locale of ["es", "en"] as const) {
      const corrupted = strings(getMessages(locale)).filter((message) =>
        markers.some((marker) => message.includes(marker)),
      );
      expect(corrupted).toEqual([]);
    }
  });

  it("formats product dates, numbers, and ratings for the active locale", () => {
    expect(formatDate("2026-08-29T18:00:00.000Z", "es")).toContain("2026");
    expect(formatNumber(1234.5, "es")).not.toBe(formatNumber(1234.5, "en"));
    expect(formatRating(8.7, "es")).toBe("8,7");
    expect(formatRating(8.7, "en")).toBe("8.7");
  });
});
