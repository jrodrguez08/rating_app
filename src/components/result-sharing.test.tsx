import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getMessages } from "@/i18n/messages";

import { ResultSharing } from "./result-sharing";

const canonicalUrl = "https://rating-app.test/matches/match-1/results";
const storyUrl = `${canonicalUrl}/story`;
const ratingStoryUrl = `${storyUrl}/table?page=1`;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("result sharing", () => {
  it("shares the canonical result URL with the native Share API", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    setNavigator({ share });
    renderSharing();

    await userEvent.click(
      screen.getByRole("button", { name: "Compartir resultados" }),
    );

    expect(share).toHaveBeenCalledWith(
      expect.objectContaining({ url: canonicalUrl }),
    );
    expect(await screen.findByText("Resultados compartidos.")).toBeVisible();
  });

  it("copies the link when native sharing is unavailable", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setNavigator({ clipboard: { writeText } as unknown as Clipboard });
    renderSharing();

    await userEvent.click(
      screen.getByRole("button", { name: "Compartir resultados" }),
    );

    expect(writeText).toHaveBeenCalledWith(canonicalUrl);
    expect(await screen.findByText("Enlace copiado.")).toBeVisible();
  });

  it("treats a cancelled native share as a neutral recoverable outcome", async () => {
    const share = vi
      .fn()
      .mockRejectedValue(new DOMException("cancelled", "AbortError"));
    setNavigator({ share });
    renderSharing();

    await userEvent.click(
      screen.getByRole("button", { name: "Compartir resultados" }),
    );

    expect(await screen.findByText("No se compartió nada.")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Compartir resultados" }),
    ).toBeEnabled();
  });

  it("offers a selectable link when clipboard APIs are unavailable", async () => {
    setNavigator({});
    renderSharing();

    await userEvent.click(
      screen.getByRole("button", { name: "Copiar enlace" }),
    );

    expect(screen.getByLabelText("Copia este enlace:")).toHaveValue(
      canonicalUrl,
    );
  });

  it("offers a deterministic Story download without JavaScript sharing", () => {
    const canShare = vi.fn();
    setNavigator({ canShare });
    renderSharing();

    expect(
      screen.getByRole("link", { name: "Descargar historia" }),
    ).toHaveAttribute("href", storyUrl);
    expect(
      screen.getByRole("link", { name: "Descargar historia" }),
    ).toHaveAttribute("download", "rating-app-match-1-historia.png");
    expect(canShare).not.toHaveBeenCalled();
  });

  it("uses an ordinary user-activated link to open the Story", () => {
    setNavigator({});
    const open = vi.spyOn(window, "open");
    renderSharing();

    const link = screen.getByRole("link", { name: "Ver historia" });
    expect(link).toHaveAttribute("href", `${storyUrl}?view=1`);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(open).not.toHaveBeenCalled();
  });

  it("shows no misleading success status for direct Story actions", () => {
    setNavigator({});
    renderSharing();

    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    expect(
      screen.getByRole("link", { name: "Descargar historia" }),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "Ver historia" })).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Descargar tabla para historia" }),
    ).toHaveAttribute("href", ratingStoryUrl);
    expect(
      screen.getByRole("link", {
        name: "Ver historia de calificaciones",
      }),
    ).toHaveAttribute("href", `${ratingStoryUrl}&view=1`);
  });

  it("offers every table Story page through numbered direct links", () => {
    setNavigator({});
    renderSharing([ratingStoryPage(1, 2), ratingStoryPage(2, 2)]);

    expect(
      screen.getByRole("link", { name: "Descargar historia 1 de 2" }),
    ).toHaveAttribute("download", "rating-app-match-1-tabla-1-de-2.png");
    expect(
      screen.getByRole("link", { name: "Descargar historia 2 de 2" }),
    ).toHaveAttribute("href", `${storyUrl}/table?page=2`);
    expect(
      screen.getByRole("link", { name: "Ver historia 2 de 2" }),
    ).toHaveAttribute("href", `${storyUrl}/table?page=2&view=1`);
  });

  it("keeps Story fallbacks available without file sharing support", () => {
    setNavigator({ share: vi.fn() });
    renderSharing();

    expect(
      screen.getByRole("link", { name: "Descargar historia" }),
    ).toBeEnabled();
    expect(screen.getByRole("link", { name: "Ver historia" })).toBeEnabled();
  });

  it("does not fetch the Story or create a delayed pop-up", () => {
    const fetchStory = vi.fn();
    const open = vi.spyOn(window, "open");
    vi.stubGlobal("fetch", fetchStory);
    setNavigator({});
    renderSharing();

    expect(fetchStory).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    expect(
      screen.getByRole("link", { name: "Descargar historia" }),
    ).toHaveAttribute("href", storyUrl);
    expect(screen.getByRole("link", { name: "Ver historia" })).toHaveAttribute(
      "href",
      `${storyUrl}?view=1`,
    );
  });

  it("keeps every sharing action in a clear keyboard order", async () => {
    setNavigator({});
    renderSharing();
    const user = userEvent.setup();

    await user.tab();
    expect(
      screen.getByRole("button", { name: "Compartir resultados" }),
    ).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Copiar enlace" })).toHaveFocus();
    await user.tab();
    expect(
      screen.getByRole("link", { name: "Descargar historia" }),
    ).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("link", { name: "Ver historia" })).toHaveFocus();
    await user.tab();
    expect(
      screen.getByRole("link", { name: "Descargar tabla para historia" }),
    ).toHaveFocus();
    await user.tab();
    expect(
      screen.getByRole("link", {
        name: "Ver historia de calificaciones",
      }),
    ).toHaveFocus();
  });
});

function renderSharing(ratingStoryPages = [ratingStoryPage(1, 1)]) {
  render(
    <ResultSharing
      canonicalUrl={canonicalUrl}
      storyUrl={storyUrl}
      storyFilename="rating-app-match-1-historia.png"
      ratingStoryPages={ratingStoryPages}
      shareTitle="Herediano 2 - 1 Pérez Zeledón"
      shareText="La afición eligió sus mejores jugadores."
      messages={getMessages("es").results.sharing}
    />,
  );
}

function ratingStoryPage(page: number, pageCount: number) {
  return {
    page,
    pageCount,
    url: `${storyUrl}/table?page=${page}`,
    filename: `rating-app-match-1-tabla-${page}-de-${pageCount}.png`,
  };
}

function setNavigator(value: Partial<Navigator>) {
  Object.defineProperty(window, "navigator", {
    configurable: true,
    value,
  });
}
