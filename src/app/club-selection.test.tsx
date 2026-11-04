import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import ClubSelectionPage from "./page";

describe("club selection", () => {
  it("offers both clubs without selecting Herediano implicitly", async () => {
    render(await ClubSelectionPage());
    expect(
      screen.getByRole("link", { name: "Club Sport Herediano" }),
    ).toHaveAttribute("href", "/herediano");
    expect(
      screen.getByRole("link", { name: "Deportivo Saprissa" }),
    ).toHaveAttribute("href", "/saprissa");
    expect(screen.getByRole("main")).toBeInTheDocument();
  });
});
