import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getMessages } from "@/i18n/messages";

import { ResultSharing } from "./result-sharing";

const canonicalUrl = "https://rating-app.test/matches/match-1/results";
const storyUrl = `${canonicalUrl}/story`;

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

  it("shares the Story file when file sharing is supported", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const canShare = vi.fn().mockReturnValue(true);
    setNavigator({ share, canShare });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("png", {
          status: 200,
          headers: { "content-type": "image/png" },
        }),
      ),
    );
    renderSharing();

    await userEvent.click(
      screen.getByRole("button", { name: "Compartir historia" }),
    );

    await waitFor(() => expect(share).toHaveBeenCalled());
    expect(canShare).toHaveBeenCalledWith(
      expect.objectContaining({ files: [expect.any(File)] }),
    );
  });

  it("downloads the Story when native file sharing is unavailable", async () => {
    setNavigator({});
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("png", {
          status: 200,
          headers: { "content-type": "image/png" },
        }),
      ),
    );
    const createObjectURL = vi.fn().mockReturnValue("blob:story");
    const revokeObjectURL = vi.fn();
    Object.defineProperties(URL, {
      createObjectURL: { configurable: true, value: createObjectURL },
      revokeObjectURL: { configurable: true, value: revokeObjectURL },
    });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    renderSharing();

    await userEvent.click(
      screen.getByRole("button", { name: "Compartir historia" }),
    );

    expect(await screen.findByText(/Historia lista/)).toBeVisible();
    expect(createObjectURL).toHaveBeenCalled();
    expect(click).toHaveBeenCalled();
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
      screen.getByRole("button", { name: "Compartir historia" }),
    ).toHaveFocus();
    await user.tab();
    expect(
      screen.getByRole("link", { name: "Descargar historia" }),
    ).toHaveFocus();
  });
});

function renderSharing() {
  render(
    <ResultSharing
      canonicalUrl={canonicalUrl}
      storyUrl={storyUrl}
      storyFilename="rating-app-match-1-historia.png"
      shareTitle="Herediano 2 - 1 Pérez Zeledón"
      shareText="La afición eligió sus mejores jugadores."
      messages={getMessages("es").results.sharing}
    />,
  );
}

function setNavigator(value: Partial<Navigator>) {
  Object.defineProperty(window, "navigator", {
    configurable: true,
    value,
  });
}
