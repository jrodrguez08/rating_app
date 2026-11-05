import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { clubs, initialClub } from "@/config/club";
import { getMessages } from "@/i18n/messages";

import { AppShell } from "./app-shell";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

describe("AppShell navigation", () => {
  it("scopes all public links and theme tokens to Saprissa", () => {
    const { container } = render(
      <AppShell locale="en" messages={getMessages("en")} club={clubs.saprissa}>
        <main>Content</main>
      </AppShell>,
    );
    expect(screen.getByRole("link", { name: "Matches" })).toHaveAttribute(
      "href",
      "/saprissa/matches",
    );
    expect(screen.getByRole("link", { name: "Players" })).toHaveAttribute(
      "href",
      "/saprissa/players",
    );
    expect(screen.getByRole("link", { name: "Studio" })).toHaveAttribute(
      "href",
      "/saprissa/studio",
    );
    const brand = screen.getByRole("link", { name: "FutRate CR" });
    expect(brand).toHaveAttribute("href", "/saprissa");
    expect(brand.querySelector("img")).toHaveAttribute("alt", "");
    expect(brand.querySelector("img")).toHaveAttribute("src", "/icon.svg");
    expect(brand.querySelector(".score-font")).toHaveTextContent("FutRate CR");
    expect(container.firstElementChild).toHaveStyle({
      "--club-primary": "#6f2c91",
      "--club-secondary": "#ffffff",
      "--game-focus": "#ffffff",
    });
  });

  it("enables the product routes with current-route semantics", () => {
    render(
      <AppShell
        locale="es"
        messages={getMessages("es")}
        club={initialClub}
        currentHref="/herediano/players"
      >
        <main>Contenido</main>
      </AppShell>,
    );
    expect(screen.getByRole("link", { name: "Partidos" })).toHaveAttribute(
      "href",
      "/herediano/matches",
    );
    expect(screen.getByRole("link", { name: "Jugadores" })).toHaveAttribute(
      "href",
      "/herediano/players",
    );
    expect(screen.getByRole("link", { name: "Tabla" })).toHaveAttribute(
      "href",
      "/herediano/standings",
    );
    expect(screen.getByRole("link", { name: "Studio" })).toHaveAttribute(
      "href",
      "/herediano/studio",
    );
    expect(screen.getByRole("link", { name: "Jugadores" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "FutRate CR" })).toHaveAttribute(
      "href",
      "/herediano",
    );
  });
});
