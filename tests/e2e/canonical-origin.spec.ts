import { mkdir, writeFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

import { getMessages } from "../../src/i18n/messages";

import { e2eMatches } from "./seed";

const origin = (process.env.E2E_SITE_URL ?? "https://rating-app.test").trim();
const canonicalOrigin = origin || "https://www.futratecr.com";

test("canonical URLs survive server rendering and browser hydration for both clubs", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await mkdir("test-results/visual", { recursive: true });
  const captured: string[] = [];
  await page.exposeFunction("recordPublicUrl", (url: string) => {
    captured.push(url);
  });
  await page.addInitScript(() => {
    const record = (url: string) =>
      (
        window as Window & {
          recordPublicUrl?: (url: string) => Promise<void>;
        }
      ).recordPublicUrl?.(url);
    Object.defineProperty(navigator, "share", {
      value: async (data: ShareData) => record(data.url ?? ""),
    });
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: async (url: string) => record(url) },
    });
  });

  for (const slug of ["herediano", "saprissa"] as const) {
    await page.goto(`/${slug}`);
    const whatsapp = page.locator('a[href^="https://wa.me/"]');
    await expect(whatsapp).toBeVisible();
    const payload = new URL((await whatsapp.getAttribute("href"))!);
    expect(payload.searchParams.get("text")).toContain(
      `${canonicalOrigin}/${slug}/matches/${e2eMatches[slug].open}/rate`,
    );

    for (const locale of ["es", "en"] as const) {
      await page.context().addCookies([
        {
          name: "rating-app-locale",
          value: locale,
          url: new URL(page.url()).origin,
        },
      ]);
      const path = `/${slug}/matches/${e2eMatches[slug].published}/results`;
      const expected = `${canonicalOrigin}${path}`;
      await page.goto(path);
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
        "href",
        expected,
      );
      await expect(page.locator('meta[property="og:url"]')).toHaveAttribute(
        "content",
        expected,
      );
      for (const selector of [
        'meta[property="og:image"]',
        'meta[name="twitter:image"]',
      ]) {
        const image = new URL(
          (await page.locator(selector).getAttribute("content"))!,
        );
        expect(image.origin).toBe(canonicalOrigin);
        expect(image.pathname).toBe(`${path}/opengraph-image`);
        expect(image.searchParams.get("lang")).toBe(locale);
        expect(image.searchParams.get("v")).toBeTruthy();
      }
      const messages = getMessages(locale).results.sharing;
      const beforeShare = captured.length;
      await page
        .getByRole("button", { name: messages.shareResults, exact: true })
        .click();
      await expect.poll(() => captured.length).toBe(beforeShare + 1);
      await expect.poll(() => captured.at(-1)).toBe(expected);
      await page
        .getByRole("button", { name: messages.copyLink, exact: true })
        .click();
      await expect.poll(() => captured.length).toBe(beforeShare + 2);
      await expect.poll(() => captured.at(-1)).toBe(expected);
      const links = await page
        .locator('a[href*="/results/story"]')
        .evaluateAll((elements) =>
          elements.map((element) => (element as HTMLAnchorElement).href),
        );
      expect(links.length).toBeGreaterThanOrEqual(4);
      for (const href of links) {
        const image = new URL(href);
        expect(image.origin).toBe(canonicalOrigin);
        expect(image.pathname.startsWith(`${path}/story`)).toBe(true);
        expect(image.searchParams.get("lang")).toBe(locale);
        if (image.pathname.endsWith("/table")) {
          expect(Number(image.searchParams.get("page"))).toBeGreaterThan(0);
        }
      }
    }
    await page.goto(`/${slug}/studio?match=${e2eMatches[slug].published}`);
    await expect(
      page.getByLabel(getMessages("en").studio.overlayUrl),
    ).toHaveValue(
      `${canonicalOrigin}/${slug}/studio/overlay/${e2eMatches[slug].published}`,
    );
    const beforeOverlayCopy = captured.length;
    await page
      .getByRole("button", { name: getMessages("en").studio.copyOverlay })
      .click();
    await expect.poll(() => captured.length).toBe(beforeOverlayCopy + 1);
    await expect
      .poll(() => captured.at(-1))
      .toBe(
        `${canonicalOrigin}/${slug}/studio/overlay/${e2eMatches[slug].published}`,
      );
    for (const format of ["story", "story/table"] as const) {
      const response = await page.request.get(
        `/${slug}/matches/${e2eMatches[slug].published}/results/${format}?lang=en&page=1`,
      );
      expect(response.status()).toBe(200);
      const png = await response.body();
      expect(png.readUInt32BE(16)).toBe(1080);
      expect(png.readUInt32BE(20)).toBe(1920);
      await writeFile(
        `test-results/visual/canonical-${new URL(canonicalOrigin).hostname}-${slug}-${format.replace("/", "-")}.png`,
        png,
      );
    }
  }
});
