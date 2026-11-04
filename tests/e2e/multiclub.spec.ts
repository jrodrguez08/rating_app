import { mkdir, writeFile } from "node:fs/promises";

import { expect, test, type Page } from "@playwright/test";

import { e2eMatches } from "./seed";
import { finalizeVotedMatch, inspectVotedMatch } from "./finalize";

const evidence = "test-results/visual";

test("neutral selector and distinct club themes remain usable on mobile and desktop", async ({
  page,
}) => {
  await mkdir(evidence, { recursive: true });
  await page.goto("/");
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

  for (const club of ["herediano", "saprissa"] as const) {
    await page.goto(`/${club}`);
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
