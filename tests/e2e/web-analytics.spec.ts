import { expect, test } from "@playwright/test";

import { e2eMatches } from "./seed";

test("Web Analytics records public navigation without private paths or URL data", async ({
  page,
  baseURL,
}) => {
  test.setTimeout(120_000);
  const views: string[] = [];
  let scripts = 0;
  await page.exposeFunction("recordAnalyticsView", (url: string) => {
    views.push(url);
  });
  await page.route(
    /\/(?:v1\/script\.debug|_vercel\/insights\/script)\.js$/,
    (route) => {
      scripts += 1;
      // Exercise the real SDK queue and beforeSend callback without sending telemetry.
      return route.fulfill({
        contentType: "application/javascript",
        body: `
        let beforeSend;
        const queued = window.vaq ?? [];
        window.va = (type, value) => {
          if (type === 'beforeSend') beforeSend = value;
          if (type !== 'pageview') return;
          const event = beforeSend({ type, url: window.location.href });
          if (event) return window.recordAnalyticsView(event.url);
        };
        for (const entry of queued) window.va(...entry);
      `,
      });
    },
  );

  for (const path of [
    "/admin?token=private",
    "/api/internal/health",
    "/api/admin/overview",
  ]) {
    await page.goto(path);
  }
  expect(scripts).toBe(0);
  expect(views).toEqual([]);

  const root = await page.goto("/?token=private#voter-id");
  expect(root?.headers()["referrer-policy"]).toBe("strict-origin");
  await expect.poll(() => views).toContain(`${baseURL}/`);
  await page.locator('a[href="/herediano"]').first().click();
  await expect.poll(() => views).toContain(`${baseURL}/herediano`);
  expect(scripts).toBe(1);

  for (const slug of ["herediano", "saprissa"] as const) {
    const matchPath = `/${slug}/matches/${e2eMatches[slug].published}`;
    const resultsPath = `${matchPath}/results`;
    await page.goto(`${matchPath}?token=private#voter-id`);
    await expect.poll(() => views).toContain(`${baseURL}${matchPath}`);
    await page.locator(`a[href="${resultsPath}"]`).first().click();
    await expect.poll(() => views).toContain(`${baseURL}${resultsPath}`);
  }

  // Once loaded, the SDK must still discard excluded paths if it sees an event.
  const beforeExcludedViews = views.length;
  await page.evaluate(async () => {
    const view = () => window.va?.("pageview", { path: location.pathname });
    Object.defineProperty(document, "referrer", {
      configurable: true,
      value: "https://example.test/?token=private",
    });
    await view();
    Reflect.deleteProperty(document, "referrer");
    for (const path of [
      "/admin",
      "/api/internal/health",
      "/api/admin/overview",
    ]) {
      window.history.pushState(null, "", path);
      await view();
    }
  });
  expect(views).toHaveLength(beforeExcludedViews);
  expect(views.every((view) => !/[?#]|\/admin|\/api/.test(view))).toBe(true);
});
