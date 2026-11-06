import { mkdir, writeFile } from "node:fs/promises";

import { expect, test, type Page } from "@playwright/test";

import { getMessages } from "../../src/i18n/messages";

import { e2eMatches } from "./seed";
import { finalizeVotedMatch, inspectVotedMatch } from "./finalize";

const evidence = "test-results/visual";

test("neutral selector and distinct club themes remain usable on mobile and desktop", async ({
  page,
}) => {
  await mkdir(evidence, { recursive: true });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "FutRate CR" })).toBeVisible();
  await expect(page.getByRole("link", { name: "FutRate CR" })).toHaveAttribute(
    "href",
    "/",
  );
  const iconResponse = await page.request.get("/icon.svg");
  expect(iconResponse.ok()).toBe(true);
  expect(iconResponse.headers()["content-type"]).toContain("image/svg+xml");
  expect(await iconResponse.text()).toContain('viewBox="0 0 32 32"');
  await expect(
    page.getByRole("link", { name: "Club Sport Herediano" }),
  ).toHaveAttribute("href", "/herediano");
  await expect(
    page.getByRole("link", { name: "Deportivo Saprissa" }),
  ).toHaveAttribute("href", "/saprissa");
  await page.screenshot({
    path: `${evidence}/selector-desktop.png`,
    fullPage: true,
  });
  await page.setViewportSize({ width: 320, height: 700 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
  ).toBe(false);
  await page.screenshot({
    path: `${evidence}/selector-320.png`,
    fullPage: true,
  });
  await page.setViewportSize({ width: 1280, height: 800 });

  for (const club of ["herediano", "saprissa"] as const) {
    await page.goto(`/${club}`);
    const brand = page.getByRole("link", { name: "FutRate CR" });
    await expect(brand).toHaveAttribute("href", `/${club}`);
    await expect(brand.locator("img")).toHaveAttribute("alt", "");
    await expect(brand.locator("img")).toHaveJSProperty("complete", true);
    expect(
      await brand
        .locator("img")
        .evaluate((image) => (image as HTMLImageElement).naturalWidth),
    ).toBeGreaterThan(0);
    expect(
      await brand
        .locator("span")
        .evaluate((wordmark) => getComputedStyle(wordmark).fontFamily),
    ).toMatch(/DotGothic/i);
    await brand.focus();
    await expect(brand).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/${club}$`));
    await page.evaluate(() => (document.activeElement as HTMLElement).blur());
    const faviconPaths = await page
      .locator('link[rel="icon"]')
      .evaluateAll((links) =>
        links.map((link) => new URL((link as HTMLLinkElement).href).pathname),
      );
    expect(faviconPaths).toContain("/icon.svg");
    expect(faviconPaths.every((path) => path === "/icon.svg")).toBe(true);
    await expect(page.locator("h1")).toContainText(
      club === "herediano" ? "Club Sport Herediano" : "Deportivo Saprissa",
    );
    await expect(page.locator("header nav a")).toHaveCount(5);
    const primary = await page
      .locator("#main-content")
      .locator("..")
      .evaluate((element) =>
        getComputedStyle(element).getPropertyValue("--club-primary").trim(),
      );
    expect(primary).toBe(club === "herediano" ? "#b20d24" : "#6f2c91");
    await page.screenshot({
      path: `${evidence}/${club}-home-desktop.png`,
      fullPage: true,
    });
    await page.setViewportSize({ width: 320, height: 700 });
    await expect(page.locator("body")).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(overflow).toBe(false);
    await page.screenshot({
      path: `${evidence}/${club}-home-320.png`,
      fullPage: true,
    });
    await page.setViewportSize({ width: 1280, height: 800 });
  }
});

test("selected-club copy follows Matches, Players and profiles in both languages", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto("/");
  for (const locale of ["es", "en"] as const) {
    await selectLanguage(page, locale);
    for (const club of ["herediano", "saprissa"] as const) {
      const name =
        club === "herediano" ? "Club Sport Herediano" : "Deportivo Saprissa";
      await page.goto(`/${club}/matches`);
      await expect(
        page.getByText(
          locale === "es" ? `Temporada de ${name}` : `${name} season`,
        ),
      ).toBeVisible();
      await page.goto(`/${club}/players`);
      await expect(
        page.getByText(
          locale === "es" ? `Historial de ${name}` : `${name} history`,
        ),
      ).toBeVisible();
      await page.goto(`/${club}/players/e2e-${club}-player-1`);
      await expect(page.locator("#player-heading")).toBeVisible();
      await expect(
        page.locator("#player-heading").locator("..").getByText(name),
      ).toBeVisible();
    }
  }
});

test("seeded published fixture supplies visual coverage for both clubs", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await mkdir(evidence, { recursive: true });
  for (const club of ["herediano", "saprissa"] as const) {
    const published = e2eMatches[club].published;
    await page.goto(`/${club}/matches/${published}/results`);
    await expect(page.locator("#results-heading")).toBeVisible();
    await expect(
      page
        .getByText(
          `${club === "herediano" ? "Herediano" : "Saprissa"} Nombre extraordinariamente largo`,
        )
        .first(),
    ).toBeVisible();
    await page.screenshot({
      path: `${evidence}/${club}-results-desktop.png`,
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      ),
    ).toBe(false);
    await page.screenshot({
      path: `${evidence}/${club}-results-mobile.png`,
      fullPage: true,
    });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`/${club}/players`);
    await expect(page.locator("#main-content")).toContainText(
      `${club === "herediano" ? "Herediano" : "Saprissa"} Nombre extraordinariamente largo`,
    );
    await page.screenshot({
      path: `${evidence}/${club}-players-desktop.png`,
      fullPage: true,
    });
    await page.goto(`/${club}/standings`);
    await expect(page.locator("table")).toContainText("Herediano");
    await expect(page.locator("table")).toContainText("Saprissa");
    await page.screenshot({
      path: `${evidence}/${club}-standings-desktop.png`,
      fullPage: true,
    });
    await page.goto(`/${club}/studio?match=${published}`);
    await expect(page.locator("body")).toContainText("2 - 1");
    await page.screenshot({
      path: `${evidence}/${club}-studio-desktop.png`,
      fullPage: true,
    });
    await page.goto(`/${club}/studio/overlay/${published}`);
    await expect(page.locator("#main-content")).toContainText("2 - 1");
    await page.screenshot({
      path: `${evidence}/${club}-overlay-desktop.png`,
      fullPage: true,
    });

    for (const [imageType, path, width, height] of [
      ["og", `opengraph-image`, 1200, 630],
      ["podium", `story`, 1080, 1920],
      ["ratings", `story/table`, 1080, 1920],
    ] as const) {
      const response = await page.request.get(
        `/${club}/matches/${published}/results/${path}`,
      );
      expect(response.status()).toBe(200);
      expect(response.headers()["content-type"]).toContain("image/png");
      const png = await response.body();
      expect(png.readUInt32BE(16)).toBe(width);
      expect(png.readUInt32BE(20)).toBe(height);
      await writeFile(`${evidence}/${club}-${imageType}.png`, png);
    }
  }
});

test("the same shared fixture aggregates each club's browser ballot independently", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const clubs = ["herediano", "saprissa"] as const;
  const teamIds = {
    herediano: "club-sport-herediano",
    saprissa: "deportivo-saprissa",
  } as const;

  for (const club of clubs) {
    const matchId = e2eMatches[club].open;
    await page.goto(`/${club}/matches/${matchId}`);
    await expect(
      page.getByRole("link", { name: /calificar/i }),
    ).toHaveAttribute("href", `/${club}/matches/${matchId}/rate`);
    await page.goto(`/${club}/matches/${matchId}/rate`);
    const fields = page.locator("fieldset");
    await expect(fields).toHaveCount(17);
    await page.screenshot({
      path: `${evidence}/${club}-voted-ballot-es.png`,
      fullPage: true,
    });
    for (let index = 0; index < 17; index += 1) {
      const rating =
        index === 16
          ? club === "herediano"
            ? 7
            : 5
          : club === "herediano"
            ? 6
            : 4;
      await fields
        .nth(index)
        .getByRole("button", { name: new RegExp(`: ${rating}$`) })
        .click();
    }
    await fields
      .filter({
        hasText:
          club === "herediano"
            ? "Herediano Nombre extraordinariamente largo"
            : "Saprissa Jugador 2",
      })
      .first()
      .getByRole("button", { name: club === "herediano" ? /: 10$/ : /: 9$/ })
      .click();
    await page
      .getByRole("button", { name: /enviar|votar|confirmar calificaciones/i })
      .last()
      .click();
    const confirmation = page.getByRole("alertdialog");
    await expect(confirmation).toBeVisible();
    await confirmation.getByRole("button").first().click();
    await expect(page.locator("#submitted-heading")).toBeVisible();
    await page.reload();
    await expect(page.locator("#submitted-heading")).toBeVisible();

    const before = await inspectVotedMatch(matchId, teamIds[club]);
    expect(before.ratingState).toBe("rating_ready");
    expect(before.ballotIds).toHaveLength(1);
    expect(before.resultExists).toBe(false);
    expect(before.page.state).toBe("locked");
    expect(
      (
        await page.request.get(
          `/${club}/matches/${matchId}/results/story?lang=en`,
        )
      ).status(),
    ).toBe(404);
  }

  const heredianoId = e2eMatches.herediano.open;
  const saprissaId = e2eMatches.saprissa.open;
  const heredianoBefore = await inspectVotedMatch(
    heredianoId,
    teamIds.herediano,
  );
  const saprissaBefore = await inspectVotedMatch(saprissaId, teamIds.saprissa);
  expect(heredianoBefore.ballotIds[0]).toBe(saprissaBefore.ballotIds[0]);

  const herediano = await finalizeVotedMatch(heredianoId, teamIds.herediano);
  expect(herediano.result.ballotCount).toBe(1);
  expect(herediano.result.coachResult.average).toBe(7);
  expect(herediano.result.mvpPlayerIds).toEqual(["e2e-herediano-player-1"]);
  expect(herediano.result.playerResults["e2e-herediano-player-1"].average).toBe(
    10,
  );
  expect(Object.keys(herediano.result.playerResults)).toHaveLength(16);
  expect(
    Object.keys(herediano.result.playerResults).every((id) =>
      id.startsWith("e2e-herediano-"),
    ),
  ).toBe(true);
  const saprissaStillOpen = await inspectVotedMatch(
    saprissaId,
    teamIds.saprissa,
  );
  expect(saprissaStillOpen.ratingState).toBe("rating_ready");
  expect(saprissaStillOpen.resultExists).toBe(false);
  await page.goto(`/saprissa/matches/${saprissaId}/results`);
  await expect(page.locator("#result-state-heading")).toBeVisible();
  expect(
    (
      await page.request.get(
        `/saprissa/matches/${saprissaId}/results/opengraph-image?lang=en`,
      )
    ).status(),
  ).toBe(404);
  await inspectActualPublishedViews(page, "herediano", heredianoId, 10);

  const saprissa = await finalizeVotedMatch(saprissaId, teamIds.saprissa);
  expect(saprissa.result.ballotCount).toBe(1);
  expect(saprissa.result.coachResult.average).toBe(5);
  expect(saprissa.result.mvpPlayerIds).toEqual(["e2e-saprissa-player-2"]);
  expect(saprissa.result.playerResults["e2e-saprissa-player-2"].average).toBe(
    9,
  );
  expect(Object.keys(saprissa.result.playerResults)).toHaveLength(16);
  expect(
    Object.keys(saprissa.result.playerResults).every((id) =>
      id.startsWith("e2e-saprissa-"),
    ),
  ).toBe(true);
  await inspectActualPublishedViews(page, "saprissa", saprissaId, 9);
});

async function inspectActualPublishedViews(
  page: Page,
  club: "herediano" | "saprissa",
  matchId: string,
  mvpRating: number,
) {
  const resultPath = `/${club}/matches/${matchId}/results`;
  await page.goto(resultPath);
  await selectLanguage(page, "es");
  for (const locale of ["es", "en"] as const) {
    await selectLanguage(page, locale);
    const title = locale === "es" ? "Resultados del partido" : "Match results";
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    await expect(page.locator('meta[property="og:locale"]')).toHaveAttribute(
      "content",
      locale === "es" ? "es_CR" : "en_US",
    );
    const imageUrl = await page
      .locator('meta[property="og:image"]')
      .getAttribute("content");
    expect(imageUrl).toContain(`lang=${locale}`);
    expect(imageUrl).toContain("&v=");
    await expect(page.locator("a[download]").first()).toHaveAttribute(
      "href",
      new RegExp(`story\\?lang=${locale}$`),
    );
    await expect(page.locator("ol li").first()).toContainText(
      locale === "es" ? `${mvpRating},0` : `${mvpRating}.0`,
    );
    await page.screenshot({
      path: `${evidence}/${club}-voted-results-${locale}.png`,
      fullPage: true,
    });
    for (const [kind, route, width, height] of [
      ["og", "opengraph-image", 1200, 630],
      ["podium", "story", 1080, 1920],
      ["ratings", "story/table?page=1", 1080, 1920],
    ] as const) {
      const separator = route.includes("?") ? "&" : "?";
      const response = await page.request.get(
        `${resultPath}/${route}${separator}lang=${locale}`,
      );
      expect(response.status()).toBe(200);
      expect(response.headers()["content-type"]).toContain("image/png");
      const png = await response.body();
      expect(png.readUInt32BE(16)).toBe(width);
      expect(png.readUInt32BE(20)).toBe(height);
      await writeFile(`${evidence}/${club}-voted-${kind}-${locale}.png`, png);
    }
  }
  const mvpIndex = club === "herediano" ? 1 : 2;
  await page.goto(`/${club}/players/e2e-${club}-player-${mvpIndex}`);
  await expect(page.locator("#main-content")).toContainText(
    club === "herediano" ? "Nombre extraordinariamente largo" : "Jugador 2",
  );
  await page.goto(`/${club}/studio?match=${matchId}`);
  await expect(page.locator("#main-content")).toContainText("2 - 1");
  await page.goto(`/${club}/studio/overlay/${matchId}`);
  await expect(page.locator("#main-content")).toContainText("2 - 1");
}

async function selectLanguage(page: Page, locale: "es" | "en") {
  if ((await page.locator("html").getAttribute("lang")) === locale) return;
  await page.locator('header button[aria-haspopup="menu"]').click();
  await page
    .getByRole("menuitemradio", {
      name: locale === "es" ? "Español" : "English",
    })
    .click();
  await expect(page.locator("html")).toHaveAttribute("lang", locale);
}

test("Player search debounces input and keeps lineup edits local", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const messages = getMessages("es").admin;
  const requests: Array<{ query: string; club: string }> = [];
  let searchAborted = false;
  await page.exposeFunction("observeSearchAbort", () => {
    searchAborted = true;
  });
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const target = new URL(
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url,
        location.href,
      );
      if (
        target.pathname === "/api/admin/players" &&
        target.searchParams.get("query") === "late"
      ) {
        init?.signal?.addEventListener(
          "abort",
          () => {
            void (
              window as Window & { observeSearchAbort?: () => Promise<void> }
            ).observeSearchAbort?.();
          },
          { once: true },
        );
      }
      return originalFetch(input, init);
    };
  });
  let releaseLate = () => {};
  let signalLateStarted = () => {};
  const lateStarted = new Promise<void>((resolve) => {
    signalLateStarted = resolve;
  });
  await page.route("**/api/admin/players?**", async (route) => {
    if (new URL(route.request().url()).searchParams.get("query") !== "late") {
      await route.continue();
      return;
    }
    // The real endpoint has finished its reads before this browser cancellation.
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    await new Promise<void>((resolve) => {
      releaseLate = resolve;
      signalLateStarted();
    });
    await route.fulfill({ response }).catch(() => {
      /* Navigation canceled it. */
    });
  });
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/api/admin/players")
      requests.push({
        query: url.searchParams.get("query") ?? "",
        club: url.searchParams.get("club") ?? "",
      });
  });
  await page.goto("/admin?club=herediano");
  await page
    .getByRole("textbox", { name: /correo|email/i })
    .fill("owner@e2e.test");
  await page.getByLabel(/contraseña/i).fill("E2e-owner-password-2026!");
  const session = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/admin/session") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Ingresar" }).click();
  expect((await session).status()).toBe(200);

  for (const club of ["herediano", "saprissa"] as const) {
    const initial = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return (
        url.pathname === "/api/admin/players" &&
        url.searchParams.get("club") === club &&
        url.searchParams.get("query") === ""
      );
    });
    await page.goto(
      `/admin/matches/${e2eMatches[club].preparation}?club=${club}`,
    );
    expect((await initial).status()).toBe(200);
    if (club === "saprissa") {
      await expect(
        page.getByText("Herediano Jugador 12", { exact: true }),
      ).toHaveCount(0);
    }
    const input = page.getByLabel(messages.searchPlayers);
    await expect(input).toBeVisible();
    const responseFor = (query: string) =>
      page.waitForResponse((response) => {
        const url = new URL(response.url());
        return (
          url.pathname === "/api/admin/players" &&
          url.searchParams.get("club") === club &&
          url.searchParams.get("query") === query
        );
      });
    const typed = responseFor("jua");
    await input.pressSequentially("jua", { delay: 30 });
    expect((await typed).status()).toBe(200);
    await input.fill("jua ");
    await page.waitForTimeout(300); // Observe one full debounce interval.
    expect(
      requests
        .filter((request) => request.club === club)
        .map((request) => request.query),
    ).toEqual(["", "jua"]);
    const changed = responseFor("agui");
    await input.fill("");
    await input.fill("agui");
    expect((await changed).status()).toBe(200);
    const name = `${club === "herediano" ? "Herediano" : "Saprissa"} Jugador 12`;
    const row = page
      .locator("li")
      .filter({ has: page.getByText(name, { exact: true }) });
    await row.getByRole("button", { name: messages.markNotEntered }).click();
    await row.getByRole("button", { name: messages.markEntered }).click();
    await row.getByRole("button", { name: messages.markNotEntered }).click();
    await page.waitForTimeout(1000); // Detect repeat work after typing/edits stop.
    expect(
      requests
        .filter((request) => request.club === club)
        .map((request) => request.query),
    ).toEqual(["", "jua", "agui"]);
    if (club === "herediano") {
      await input.fill("late");
      await lateStarted;
      await page.locator('a[href="/admin?club=herediano"]').first().click();
      await expect(page).toHaveURL(/\/admin\?club=herediano$/);
      await expect.poll(() => searchAborted).toBe(true);
      releaseLate();
    }
  }
});

test("the real emulator owner can switch club dashboards", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/admin?club=herediano");
  await page
    .getByRole("textbox", { name: /correo|email/i })
    .fill("owner@e2e.test");
  await page.getByLabel(/contraseña/i).fill("E2e-owner-password-2026!");
  const sessionResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/admin/session") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Ingresar" }).click();
  expect((await sessionResponse).status()).toBe(200);
  await expect(page.locator('a[href="/admin?club=saprissa"]')).toBeVisible({
    timeout: 20_000,
  });
  await page.screenshot({
    path: `${evidence}/admin-herediano-desktop.png`,
    fullPage: true,
  });
  await page.setViewportSize({ width: 320, height: 740 });
  await expect(page.locator("main")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `${evidence}/admin-herediano-320.png`,
    fullPage: true,
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/admin/matches/${e2eMatches.herediano.open}?club=herediano`);
  await expect(page.locator("main h1")).toBeVisible();
  await expect(page.locator("main")).toContainText("Club Sport Herediano");
  expect(
    (
      await page.goto(
        `/admin/matches/${e2eMatches.saprissa.open}?club=herediano`,
      )
    )?.status(),
  ).toBe(404);
  await page.goto("/admin?club=herediano");
  await page.locator('a[href="/admin?club=saprissa"]').click();
  await expect(page).toHaveURL(/\/admin\?club=saprissa$/);
  await expect(
    page.locator('a[href="/admin?club=saprissa"][aria-current="page"]'),
  ).toBeVisible();
  await page.screenshot({
    path: `${evidence}/admin-saprissa-desktop.png`,
    fullPage: true,
  });
  await page.setViewportSize({ width: 320, height: 740 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `${evidence}/admin-saprissa-320.png`,
    fullPage: true,
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  const catalogCalls: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/admin/catalog-import/"))
      catalogCalls.push(request.url());
  });
  await page.locator('a[href="/admin/catalog-import?club=saprissa"]').click();
  await expect(
    page.getByRole("heading", { name: "Catálogo de partidos recientes" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Consultar catálogo de API-Football" }),
  ).toBeVisible();
  expect(catalogCalls).toEqual([]);
  await page.setViewportSize({ width: 320, height: 740 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/admin/matches/${e2eMatches.saprissa.open}?club=saprissa`);
  await expect(page.locator("main")).toContainText("Deportivo Saprissa");
  expect(
    (
      await page.goto(
        `/admin/matches/${e2eMatches.herediano.open}?club=saprissa`,
      )
    )?.status(),
  ).toBe(404);

  for (const club of ["herediano", "saprissa"] as const) {
    const other = club === "herediano" ? "Saprissa" : "Herediano";
    await page.goto(
      `/admin/matches/${e2eMatches[club].preparation}?club=${club}`,
    );
    await page.screenshot({
      path: `${evidence}/admin-${club}-preparation-desktop.png`,
      fullPage: true,
    });
    const coachPanel = page.locator("#coach-assignment");
    await coachPanel.getByRole("button", { name: "Buscar directores" }).click();
    await expect(
      coachPanel.getByRole("radio", { name: new RegExp(club, "i") }),
    ).toBeVisible();
    await expect(
      coachPanel.getByRole("radio", { name: new RegExp(other, "i") }),
    ).toHaveCount(0);
    const saveResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/admin/lineup-draft" &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Guardar borrador" }).click();
    expect((await saveResponse).status()).toBe(200);
    await expect(page.getByText("El borrador quedó guardado.")).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Guardar borrador" }),
    ).toBeDisabled();

    const lineupForm = page.locator("form").filter({
      has: page.getByRole("button", { name: "Aplicar preparación verificada" }),
    });
    await lineupForm
      .locator('input[name="passphrase"]')
      .fill("e2e-owner-confirmation-2026");
    const lineupPreview = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/admin/lineup/preview",
    );
    const lineupApply = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/admin/lineup/apply",
    );
    await lineupForm
      .getByRole("button", { name: "Aplicar preparación verificada" })
      .click();
    expect((await lineupPreview).status()).toBe(200);
    expect((await lineupApply).status()).toBe(200);
    await expect(
      page.getByRole("button", { name: "Aplicar preparación verificada" }),
    ).toHaveCount(0);

    const coachForm = page.locator("#coach-assignment form").filter({
      has: page.getByRole("button", { name: "Aplicar asignación" }),
    });
    await coachForm
      .locator('input[name="passphrase"]')
      .fill("e2e-owner-confirmation-2026");
    const coachPreview = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname ===
        "/api/admin/coach-assignment/preview",
    );
    const coachApply = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname ===
        "/api/admin/coach-assignment/apply",
    );
    await coachForm.getByRole("button", { name: "Aplicar asignación" }).click();
    expect((await coachPreview).status()).toBe(200);
    expect((await coachApply).status()).toBe(200);
    await expect(page.locator("#coach-assignment")).toHaveCount(0);
    await expect(
      page.locator('p[role="status"]').filter({
        hasText: `${club === "herediano" ? "Herediano" : "Saprissa"} Entrenador`,
      }),
    ).toBeVisible();
  }
});

test("foreign and obsolete public URLs fail closed", async ({ page }) => {
  for (const club of ["herediano", "saprissa"] as const) {
    const other = club === "herediano" ? "saprissa" : "herediano";
    expect(
      (await page.goto(`/${club}/matches/${e2eMatches[other].open}`))?.status(),
    ).toBe(404);
    expect(
      (
        await page.request.get(
          `/${club}/matches/${e2eMatches[other].published}/results/story`,
        )
      ).status(),
    ).toBe(404);
  }
  for (const path of [
    "/matches",
    "/players",
    "/standings",
    "/studio",
    "/unknown-club",
  ]) {
    expect((await page.goto(path))?.status()).toBe(404);
  }
});
