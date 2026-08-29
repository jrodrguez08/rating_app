import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { HomeContent } from "./page";

describe("Home", () => {
  it("renders the current product UI in default Spanish", () => {
    render(<HomeContent locale="es" />);
    expect(
      screen.getByRole("heading", { name: "Club Sport Herediano" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: "No hay una calificación activa",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/los resultados permanecen ocultos/i),
    ).toBeInTheDocument();
  });

  it("renders the same product UI in English", () => {
    render(<HomeContent locale="en" />);
    expect(
      screen.getByRole("heading", { name: "No active rating" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/results stay hidden while voting is open/i),
    ).toBeInTheDocument();
  });

  it("exposes semantic primary navigation with future destinations disabled", () => {
    render(<HomeContent locale="es" />);
    const navigation = screen.getByRole("navigation", {
      name: "Navegación principal",
    });
    const homeLink = within(navigation).getByRole("link", { name: "Inicio" });
    expect(homeLink).toHaveAttribute("href", "/");
    expect(homeLink).toHaveAttribute("aria-current", "page");
    expect(within(navigation).getByText("Partidos")).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(within(navigation).getByText("Jugadores")).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  it("provides a keyboard skip link and a labeled main region", () => {
    render(<HomeContent locale="es" />);
    expect(
      screen.getByRole("link", { name: "Ir al contenido" }),
    ).toHaveAttribute("href", "#main-content");
    expect(screen.getByRole("main")).toHaveAttribute("id", "main-content");
  });
});
