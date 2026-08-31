import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { initialClub } from "@/config/club";
import { getMessages } from "@/i18n/messages";

import { AppShell } from "./app-shell";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

describe("AppShell navigation", () => {
  it("enables Partidos while keeping Jugadores disabled", () => {
    render(
      <AppShell
        locale="es"
        messages={getMessages("es")}
        theme={initialClub.theme}
        currentHref="/matches"
      >
        <main>Contenido</main>
      </AppShell>,
    );
    expect(screen.getByRole("link", { name: "Partidos" })).toHaveAttribute(
      "href",
      "/matches",
    );
    expect(screen.getByText("Jugadores")).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(screen.getByRole("link", { name: "Partidos" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});
