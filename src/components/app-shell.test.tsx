import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { initialClub } from "@/config/club";
import { getMessages } from "@/i18n/messages";

import { AppShell } from "./app-shell";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

describe("AppShell navigation", () => {
  it("enables Partidos and Jugadores with current-route semantics", () => {
    render(
      <AppShell
        locale="es"
        messages={getMessages("es")}
        theme={initialClub.theme}
        currentHref="/players"
      >
        <main>Contenido</main>
      </AppShell>,
    );
    expect(screen.getByRole("link", { name: "Partidos" })).toHaveAttribute(
      "href",
      "/matches",
    );
    expect(screen.getByRole("link", { name: "Jugadores" })).toHaveAttribute(
      "href",
      "/players",
    );
    expect(screen.getByRole("link", { name: "Jugadores" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});
