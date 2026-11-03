import { mkdir, writeFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

import { e2eMatches } from "./seed";

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

test("shared fixture keeps ballots and published content in separate club contexts", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await mkdir(evidence, { recursive: true });
  for (const club of ["herediano", "saprissa"] as const) {
    const open = e2eMatches[club].open;
    const published = e2eMatches[club].published;
    await page.goto(`/${club}/matches/${open}`);
    await expect(
      page.getByRole("link", { name: /calificar/i }),
    ).toHaveAttribute("href", `/${club}/matches/${open}/rate`);
    await page.goto(`/${club}/matches/${open}/rate`);
    await expect(page.locator("fieldset")).toHaveCount(17);
    await expect(
      page.getByText(
        `${club === "herediano" ? "Herediano" : "Saprissa"} Entrenador`,
      ),
    ).toBeVisible();
    await page.screenshot({
      path: `${evidence}/${club}-ballot-desktop.png`,
      fullPage: true,
    });
    const fields = page.locator("fieldset");
    for (let index = 0; index < 17; index += 1) {
      await fields.nth(index).getByRole("button", { name: /: 8$/ }).click();
    }
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
