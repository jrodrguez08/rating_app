import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

const cookieValue = vi.hoisted(() => ({
  current: undefined as string | undefined,
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () =>
      cookieValue.current === undefined
        ? undefined
        : { value: cookieValue.current },
  }),
}));

vi.mock("next/font/google", () => ({
  DotGothic16: () => ({ variable: "font-dot-gothic-test" }),
}));

import RootLayout, { generateMetadata } from "./layout";

describe("RootLayout", () => {
  it.each([
    [undefined, "es"],
    ["invalid", "es"],
    ["en", "en"],
  ])("uses cookie value %s to render html lang=%s", async (value, expected) => {
    cookieValue.current = value;
    const result = (await RootLayout({
      children: <main />,
      params: Promise.resolve({}),
    })) as ReactElement<{ lang: string; className: string }>;
    expect(result.props.lang).toBe(expected);
    expect(result.props.className).toContain("font-dot-gothic-test");
  });

  it("keeps canonical public metadata in Spanish while UI locale remains independent", () => {
    cookieValue.current = "en";
    expect(generateMetadata()).toMatchObject({
      title: { default: "Rating App" },
      description: expect.stringContaining("Calificaciones de la afición"),
    });
  });
});
