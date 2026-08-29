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
    })) as ReactElement<{ lang: string }>;
    expect(result.props.lang).toBe(expected);
  });

  it("localizes metadata with the resolved locale", async () => {
    cookieValue.current = "en";
    await expect(generateMetadata()).resolves.toMatchObject({
      title: "Rating App",
      description: expect.stringContaining("Supporter ratings"),
    });
    cookieValue.current = "es";
    await expect(generateMetadata()).resolves.toMatchObject({
      description: expect.stringContaining("Calificaciones de aficionados"),
    });
  });
});
